/**
 * Email connector runtime — owns the EmailConnectorManager singleton, hydrates
 * enabled EmailConnector rows at boot, and wires the create/update ticket
 * handlers with Message-ID dedup.
 */
import { EmailConnectorManager, type EmailConnectorConfig, type ParsedEmail } from "@C7NTAX/email";
import { prisma } from "../index";
import { decryptPassword } from "./emailConnectorCrypto";
import { createTicketFromEmail, appendEmailToTicket } from "./emailToTicket";

export const emailConnectorManager = new EmailConnectorManager();

async function getCursor(key: string): Promise<string[]> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  if (!row?.value) return [];
  const v = row.value as { seen?: string[] };
  return Array.isArray(v.seen) ? v.seen : [];
}

async function recordCursor(key: string, messageIds: string[]): Promise<void> {
  const capped = messageIds.slice(-100);
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: { seen: capped } },
    create: { key, value: { seen: capped } },
  });
}

async function withDedup(scopeKey: string, messageId: string, fn: () => Promise<string>): Promise<void> {
  const seen = await getCursor(scopeKey);
  if (seen.includes(messageId)) return;
  const id = await fn();
  if (id) {
    await recordCursor(scopeKey, [...seen, messageId]);
  }
}

/** Load enabled EmailConnector rows and start polling (guarded). */
export async function hydrateEmailConnectors(): Promise<void> {
  if (process.env.EMAIL_CONNECTORS_ENABLED === "false") return;

  emailConnectorManager.onNewTicket(async ({ boardId, email }: { boardId: string; email: ParsedEmail }): Promise<string> => {
    try {
      let createdId = "";
      await withDedup(`email_connector:${boardId}:seen`, email.messageId, async () => {
        const id = await createTicketFromEmail(boardId, email);
        if (id) console.log(`[EmailConnector] Created ticket ${id} from ${email.from.email}`);
        createdId = id;
        return id;
      });
      return createdId;
    } catch (e) {
      console.error(`[EmailConnector] Ticket creation failed for ${email.from.email}:`, e);
      return "";
    }
  });

  emailConnectorManager.onUpdateTicket(async ({ ticketId, email }: { ticketId: string; email: ParsedEmail }) => {
    try {
      await withDedup(`email_connector:reply:seen`, email.messageId, async () => {
        await appendEmailToTicket(ticketId, email);
        return email.messageId;
      });
    } catch (e) {
      console.error(`[EmailConnector] Reply append failed for ${email.from.email}:`, e);
    }
  });

  const rows = await prisma.emailConnector.findMany({ where: { enabled: true } });
  for (const row of rows) {
    try {
      const config: EmailConnectorConfig = {
        id: row.id,
        boardId: row.boardId,
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.user,
        password: decryptPassword(row.passwordEncrypted),
        folder: row.folder,
        pollIntervalSeconds: Math.max(30, row.pollIntervalSec || 300),
        enabled: true,
      };
      emailConnectorManager.addConnector(config);
    } catch (e) {
      console.error(`[EmailConnector] Failed to hydrate connector ${row.id}:`, e);
    }
  }
}
