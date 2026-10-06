/**
 * Ticket attachment storage — the on-disk layout and the TicketAttachment rows
 * in one place, shared by the ticket routes and the email connector (which
 * turns inbound email attachments into ticket attachments).
 *
 * Layout: <root>/<ticketId>/<uuid>, root defaulting to apps/api/data/ticket-attachments
 * (override with TICKET_ATTACHMENT_DIR). `storagePath` is stored relative to the
 * root and resolved defensively before any read or write.
 */
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { v4 as uuid } from "uuid";
import { prisma } from "../index";

const apiRoot = process.env.C7NTAX_ROOT
  ? path.resolve(process.env.C7NTAX_ROOT, "apps", "api")
  : path.basename(process.cwd()).toLowerCase() === "api"
    ? process.cwd()
    : path.resolve(process.cwd(), "apps", "api");

export const ticketAttachmentRoot = path.resolve(
  process.env.TICKET_ATTACHMENT_DIR || path.join(apiRoot, "data", "ticket-attachments"),
);

export const MAX_TICKET_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface PreparedAttachment {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

/** Resolve a stored path, refusing anything that escapes the attachment root. */
export function resolveStoredAttachment(storagePath: string): string | null {
  if (!storagePath || storagePath === "pending-upload") return null;
  const filePath = path.resolve(ticketAttachmentRoot, ...storagePath.split(/[\\/]/));
  const relativePath = path.relative(ticketAttachmentRoot, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return filePath;
}

/** Strip any path component and control characters from an incoming filename. */
export function sanitizeAttachmentFilename(raw: unknown): string {
  return typeof raw === "string"
    ? raw.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || ""
    : "";
}

/** Writes the files to disk and records them, cleaning up if any write or insert fails. */
export async function storeTicketAttachments(
  files: PreparedAttachment[],
  meta: { ticketId: string; uploadedById: string; commentId?: string | null },
) {
  const written: string[] = [];
  try {
    const rows = [];
    for (const file of files) {
      const storagePath = `${meta.ticketId}/${uuid()}`;
      const filePath = resolveStoredAttachment(storagePath)!;
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.buffer, { flag: "wx" });
      written.push(filePath);
      rows.push(await prisma.ticketAttachment.create({
        data: {
          ticketId: meta.ticketId,
          commentId: meta.commentId ?? undefined,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.buffer.length,
          storagePath,
          uploadedById: meta.uploadedById,
        },
      }));
    }
    return rows;
  } catch (e) {
    await Promise.all(written.map((p) => unlink(p).catch(() => {})));
    throw e;
  }
}
