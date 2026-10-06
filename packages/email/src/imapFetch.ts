// @ts-nocheck — the legacy `imap` package ships no TypeScript declarations
/**
 * Real IMAP mailbox fetching for the email connector (node-imap + mailparser).
 * Fetches UNSEEN messages and maps them to ParsedEmail, keeping the IMAP UID on
 * each one so the caller can mark it seen once the ticket work succeeded.
 *
 * Note for Microsoft 365 mailboxes: Basic authentication (username + password)
 * is disabled in every Exchange Online tenant, so this transport only works for
 * mailboxes that still accept a password (or an app password). M365 mailboxes
 * must use the Graph transport in graphFetch.ts.
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

/** A parsed email plus the mailbox identifier needed to mark it processed. */
export interface FetchedImapEmail extends ParsedEmail {
  uid: number;
}

function connect(config: ImapConnectionConfig) {
  return new Imap({
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    tls: config.secure,
    // Certificates are verified unless an operator explicitly opts out for a
    // self-signed internal server.
    tlsOptions: { rejectUnauthorized: process.env.EMAIL_IMAP_ALLOW_SELF_SIGNED !== "true" },
    connTimeout: 30000,
    authTimeout: 12000,
  });
}

export function fetchUnseenEmails(config: ImapConnectionConfig): Promise<FetchedImapEmail[]> {
  return new Promise((resolve, reject) => {
    const imap = connect(config);

    const results: FetchedImapEmail[] = [];
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
      // Read-write: marking a message seen needs it, and nothing is modified
      // until the caller asks for it.
      imap.openBox(config.folder || "INBOX", false, (err) => {
        if (err) return fail(err);
        imap.search(["UNSEEN"], (err2, uids) => {
          if (err2) return fail(err2);
          if (!uids || uids.length === 0) return done();
          const fetch = imap.fetch(uids.slice(0, 100), { bodies: "", struct: true });
          let pending = uids.length;
          fetch.on("message", (msg, seqno) => {
            const chunks: Buffer[] = [];
            let uid = 0;
            msg.once("attributes", (attrs) => { uid = attrs?.uid || 0; });
            msg.on("body", (stream) => {
              stream.on("data", (c: Buffer) => chunks.push(c));
            });
            msg.once("end", () => {
              void (async () => {
                try {
                  const parsed = await simpleParser(Buffer.concat(chunks));
                  results.push({
                    uid,
                    messageId: parsed.messageId || `${config.user}-${uid || seqno}`,
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

/** Mark messages seen — called only after the ticket work for them succeeded. */
export function markEmailsSeen(config: ImapConnectionConfig, uids: number[]): Promise<number> {
  const unique = [...new Set(uids.filter((u) => Number.isFinite(u) && u > 0))];
  if (unique.length === 0) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const imap = connect(config);
    let settled = false;
    const finish = (err: unknown, count: number) => {
      if (settled) return;
      settled = true;
      try { imap.end(); } catch {}
      err ? reject(err) : resolve(count);
    };
    imap.once("ready", () => {
      imap.openBox(config.folder || "INBOX", false, (err) => {
        if (err) return finish(err, 0);
        imap.addFlags(unique, "\\Seen", (err2) => finish(err2, err2 ? 0 : unique.length));
      });
    });
    imap.once("error", (err) => finish(err, 0));
    imap.connect();
  });
}
