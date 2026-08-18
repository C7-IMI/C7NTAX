/**
 * Email connector runtime — owns the EmailConnectorManager singleton, hydrates
 * enabled connectors from the Integration table at boot, and wires the
 * create/update ticket handlers with Message-ID dedup.
 */
import { EmailConnectorManager, type EmailConnectorConfig, type ParsedEmail } from "@C7NTAX/email";
import { prisma } from "../index";
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

/** Load enabled email_connector integrations and start polling (guarded). */
export async function hydrateEmailConnectors(): Promise<void> {
  if (process.env.EMAIL_CONNECTORS_ENABLED === "false") return;

  emailConnectorManager.onNewTicket(async ({ boardId, email }: { boardId: string; email: ParsedEmail }) => {
    try {
      await withDedup(`email_connector:${boardId}:seen`, email.messageId, async () => {
        const id = await createTicketFromEmail(boardId, email);
        if (id) console.log(`[EmailConnector] Created ticket ${id} from ${email.from.email}`);
        return id;
      });
    } catch (e) {
      console.error(`[EmailConnector] Ticket creation failed for ${email.from.email}:`, e);
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

  const rows = await prisma.integration.findMany({ where: { kind: "email_connector" } });
  for (const row of rows) {
    try {
      const creds = (row.credentials || {}) as Record<string, unknown>;
      const settings = (row.settings || {}) as Record<string, unknown>;
      if (!row.enabled) continue;
      if (!creds.host || !creds.user || !settings.boardId) continue;
      const config: EmailConnectorConfig = {
        id: row.id,
        boardId: String(settings.boardId),
        host: String(creds.host),
        port: Number(creds.port) || 993,
        secure: creds.secure !== false,
        user: String(creds.user),
        password: String(creds.password || ""),
        folder: settings.folder ? String(settings.folder) : undefined,
        pollIntervalSeconds: Math.max(30, Number(settings.pollIntervalSeconds) || 300),
        enabled: true,
      };
      emailConnectorManager.addConnector(config);
    } catch (e) {
      console.error(`[EmailConnector] Failed to hydrate connector ${row.id}:`, e);
      await prisma.integration.update({ where: { id: row.id }, data: { errorMessage: `Hydration failed: ${(e as Error).message}` } }).catch(() => {});
    }
  }
}
