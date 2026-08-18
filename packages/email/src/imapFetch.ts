/**
 * Real IMAP mailbox fetching for the email connector (node-imap + mailparser).
 * Fetches UNSEEN messages and maps them to ParsedEmail. Marking seen /
 * cursor management is deliberately left to the caller so the
 * "process first, mark seen only after success" contract is enforced
 * by the API layer.
 */
import Imap from "imap";
import { simpleParser } from "mailparser";
import type { ParsedEmail } from "./EmailConnector";

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder?: string;
}

export function fetchUnseenEmails(config: ImapConnectionConfig): Promise<ParsedEmail[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.secure,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 12000,
    });

    const results: ParsedEmail[] = [];
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try { imap.end(); } catch {}
      reject(err);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      try { imap.end(); } catch {}
      resolve(results);
    };

    imap.once("ready", () => {
      imap.openBox(config.folder || "INBOX", true, (err) => {
        if (err) return fail(err);
        imap.search(["UNSEEN"], (err2, uids) => {
          if (err2) return fail(err2);
          if (!uids || uids.length === 0) return done();
          const fetch = imap.fetch(uids.slice(0, 100), { bodies: "", struct: true });
          let pending = uids.length;
          fetch.on("message", (msg, seqno) => {
            const chunks: Buffer[] = [];
            msg.on("body", (stream) => {
              stream.on("data", (c: Buffer) => chunks.push(c));
            });
            msg.once("end", () => {
              void (async () => {
                try {
                  const parsed = await simpleParser(Buffer.concat(chunks));
                  results.push({
                    messageId: parsed.messageId || `${config.user}-${seqno}`,
                    from: {
                      name: parsed.from?.value?.[0]?.name || "",
                      email: parsed.from?.value?.[0]?.address || "",
                    },
                    to: (parsed.to?.value || []).map((a) => a.address || ""),
                    cc: (parsed.cc?.value || []).map((a) => a.address || ""),
                    subject: parsed.subject || "",
                    bodyText: parsed.text || "",
                    bodyHtml: parsed.html || "",
                    attachments: (parsed.attachments || []).map((a) => ({
                      filename: a.filename || "attachment",
                      contentType: a.contentType || "application/octet-stream",
                      size: a.size || 0,
                      content: a.content instanceof Buffer ? a.content : Buffer.alloc(0),
                    })),
                    date: parsed.date || new Date(),
                    inReplyTo: parsed.inReplyTo || null,
                    references: Array.isArray(parsed.references) ? (parsed.references as string[]) : [],
                  });
                } catch {
                  // skip unparseable messages
                } finally {
                  pending -= 1;
                  if (pending <= 0) done();
                }
              })();
            });
          });
          fetch.once("error", (e) => fail(e));
          fetch.once("end", () => {
            if (pending <= 0) done();
          });
        });
      });
    });
    imap.once("error", (err) => fail(err));
    imap.connect();
  });
}
