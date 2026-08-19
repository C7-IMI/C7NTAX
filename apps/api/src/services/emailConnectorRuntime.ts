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

  const handleNewEmail = async (boardId: string, email: ParsedEmail): Promise<string> => {
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
  };

  emailConnectorManager.onNewTicket(async ({ boardId, email }: { boardId: string; email: ParsedEmail }): Promise<string> => handleNewEmail(boardId, email));

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
      if (row.transport === "graph" && process.env.EMAIL_GRAPH_ENABLED !== "false") {
        startGraphPoll(row);
        continue;
      }
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

// Backlog item 9 — M365 Graph transport for email connectors (gated by EMAIL_GRAPH_ENABLED).
// Uses client-credentials OAuth + the Graph mail API; IMAP connectors are untouched.
async function graphToken(row: { tenantId: string | null; clientId: string | null; clientSecretEncrypted: string | null }): Promise<string> {
  const tenant = row.tenantId || "common";
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: row.clientId || "",
      client_secret: row.clientSecretEncrypted ? decryptPassword(row.clientSecretEncrypted) : "",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!resp.ok) throw new Error(`Graph token HTTP ${resp.status}`);
  const data = (await resp.json()) as { access_token: string };
  if (!data.access_token) throw new Error("No access_token in Graph response");
  return data.access_token;
}

async function pollGraphOnce(row: {
  id: string; boardId: string; user: string; folder: string;
  tenantId: string | null; clientId: string | null; clientSecretEncrypted: string | null;
}): Promise<void> {
  const token = await graphToken(row);
  const folder = row.folder || "Inbox";
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(row.user)}/mailFolders/${encodeURIComponent(folder)}/messages?$filter=isRead eq false&$top=25&$select=internetMessageId,from,subject,body,receivedDateTime`;
  const resp = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Graph mail HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    value?: Array<{
      internetMessageId?: string;
      from?: { emailAddress?: { address?: string; name?: string } };
      subject?: string;
      body?: { content?: string; contentType?: string };
      receivedDateTime?: string;
    }>;
  };
  for (const m of data.value || []) {
    const messageId = m.internetMessageId || `graph-${m.receivedDateTime || ""}-${m.subject || ""}`;
    const isHtml = m.body?.contentType === "html";
    const email: ParsedEmail = {
      messageId,
      from: { name: m.from?.emailAddress?.name || "", email: m.from?.emailAddress?.address || "" },
      to: [], cc: [],
      subject: m.subject || "(no subject)",
      bodyText: isHtml ? "" : (m.body?.content || ""),
      bodyHtml: isHtml ? (m.body?.content || "") : "",
      attachments: [],
      date: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
      inReplyTo: null,
      references: [],
    };
    await withDedup(`email_connector:${row.boardId}:seen`, messageId, () => createTicketFromEmail(row.boardId, email));
  }
}

function startGraphPoll(row: {
  id: string; boardId: string; user: string; folder: string; pollIntervalSec: number;
  tenantId: string | null; clientId: string | null; clientSecretEncrypted: string | null;
}): void {
  const intervalMs = Math.max(60, row.pollIntervalSec || 300) * 1000;
  const tick = () => { void pollGraphOnce(row).catch((e) => console.error(`[EmailConnector] Graph poll failed for ${row.id}:`, e?.message || e)); };
  setTimeout(tick, 10_000);
  setInterval(tick, intervalMs);
}
