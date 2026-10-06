/**
 * mailparser output → the connector's ParsedEmail.
 *
 * Shared by the IMAP and EWS transports, which both hand raw MIME to
 * mailparser and need identical field mapping (including attachment buffers and
 * the In-Reply-To/References headers the ticket-threading logic depends on).
 */
import type { ParsedMail } from "mailparser";
import type { ParsedEmail } from "./EmailConnector";

const MAX_ATTACHMENT_BYTES = Number(process.env.EMAIL_MAX_ATTACHMENT_BYTES || 10 * 1024 * 1024);

export function parseMailToEmail(parsed: ParsedMail, fallbackMessageId: string): ParsedEmail {
  const firstFrom = parsed.from?.value?.[0];
  return {
    messageId: parsed.messageId || fallbackMessageId,
    from: {
      name: firstFrom?.name || "",
      email: firstFrom?.address || "",
    },
    to: (parsed.to && !Array.isArray(parsed.to) ? parsed.to.value : []).map((a) => a.address || ""),
    cc: (parsed.cc && !Array.isArray(parsed.cc) ? parsed.cc.value : []).map((a) => a.address || ""),
    subject: parsed.subject || "",
    bodyText: parsed.text || "",
    bodyHtml: typeof parsed.html === "string" ? parsed.html : "",
    attachments: (parsed.attachments || []).map((a) => {
      const content = a.content instanceof Buffer ? a.content : Buffer.alloc(0);
      return {
        filename: a.filename || "attachment",
        contentType: a.contentType || "application/octet-stream",
        size: a.size || content.length,
        content: content.length > MAX_ATTACHMENT_BYTES ? Buffer.alloc(0) : content,
      };
    }),
    date: parsed.date || new Date(),
    inReplyTo: parsed.inReplyTo || null,
    references: Array.isArray(parsed.references)
      ? parsed.references
      : typeof parsed.references === "string"
        ? parsed.references.split(/\s+/).filter(Boolean)
        : [],
  };
}
