/**
 * Email connector runtime — hydrates enabled EmailConnector rows at boot and
 * keeps one poller running per connector, chosen by transport:
 *
 *   imap  → EmailConnectorManager (node-imap + a mailbox password; still fine
 *           for mailboxes that accept one, but not for Microsoft 365)
 *   graph → Microsoft Graph, app-only. Exchange Online has Basic authentication
 *           disabled in every tenant, so this is the transport an M365 mailbox
 *           has to use. See graphFetch.ts for the endpoints and the app
 *           registration/permission requirements.
 *
 * Both transports share one processing path: match the message to a ticket,
 * create a ticket or append a reply, record it as processed, and only then mark
 * it read in the mailbox. Anything that fails stays unread, so the next poll
 * retries it instead of losing the email.
 */
import {
  EmailConnectorManager,
  type EmailConnectorConfig,
  type IncomingEmail,
  GraphError,
  acquireGraphToken,
  fetchGraphUnread,
  markGraphMessageRead,
  probeGraphMailbox,
  normalizeGraphFolder,
  isAutoReply,
} from "@C7NTAX/email";
import { prisma } from "../index";
import { decryptPassword } from "./emailConnectorCrypto";
import { createTicketFromEmail, appendEmailToTicket } from "./emailToTicket";

export const emailConnectorManager = new EmailConnectorManager();

/** The columns the runtime needs; routes pass whole EmailConnector rows. */
export interface ConnectorRow {
  id: string;
  boardId: string;
  transport: string | null;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passwordEncrypted: string;
  folder: string;
  pollIntervalSec: number;
  tenantId: string | null;
  clientId: string | null;
  clientSecretEncrypted: string | null;
}

export interface ConnectorState {
  /** Message ids already dealt with, newest last. */
  processed: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessedAt: string | null;
}

const PROCESSED_CAP = 500;
const EMPTY_STATE: ConnectorState = { processed: [], lastError: null, lastErrorAt: null, lastProcessedAt: null };

export function isGraphTransport(row: { transport: string | null }): boolean {
  return (row.transport || "imap").toLowerCase() === "graph";
}

function stateKey(id: string): string {
  return `email_connector:${id}:state`;
}

export async function readConnectorState(id: string): Promise<ConnectorState> {
  const row = await prisma.systemConfig.findUnique({ where: { key: stateKey(id) } });
  const value = (row?.value || {}) as Partial<ConnectorState>;
  return {
    processed: Array.isArray(value.processed) ? value.processed : [],
    lastError: value.lastError ?? null,
    lastErrorAt: value.lastErrorAt ?? null,
    lastProcessedAt: value.lastProcessedAt ?? null,
  };
}

async function writeConnectorState(id: string, patch: Partial<ConnectorState>): Promise<ConnectorState> {
  const current = await readConnectorState(id);
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: ConnectorState = { ...current, ...defined } as ConnectorState;
  await prisma.systemConfig.upsert({
    where: { key: stateKey(id) },
    update: { value: next as any },
    create: { key: stateKey(id), value: next as any },
  });
  return next;
}

async function rememberProcessed(id: string, messageId: string): Promise<void> {
  const state = await readConnectorState(id);
  if (state.processed.includes(messageId)) return;
  const processed = [...state.processed, messageId].slice(-PROCESSED_CAP);
  await writeConnectorState(id, { processed, lastProcessedAt: new Date().toISOString() });
}

/**
 * The single processing path shared by both transports. Returns true only when
 * the message is finished with (ticket created, reply appended, or deliberately
 * ignored) — the caller marks the message read on true and leaves it otherwise.
 */
async function processIncoming({ connectorId, boardId, email, match }: IncomingEmail): Promise<boolean> {
  const state = await readConnectorState(connectorId);
  if (state.processed.includes(email.messageId)) return true;

  if (isAutoReply(email.subject, email.bodyText)) {
    await rememberProcessed(connectorId, email.messageId);
    return true;
  }

  if (match.action === "update" && match.ticketId) {
    const appended = await appendEmailToTicket(match.ticketId, email);
    if (appended) {
      await rememberProcessed(connectorId, email.messageId);
      return true;
    }
    // The subject quoted a ticket that does not exist — fall through and raise a
    // new ticket rather than dropping the email.
    console.warn(`[EmailConnector] ${email.from.email} quoted ticket "${match.ticketId}", which was not found — creating a ticket instead`);
  }

  const ticketId = await createTicketFromEmail(boardId, email);
  if (!ticketId) throw new Error("ticket creation returned no ticket");
  console.log(`[EmailConnector] Created ticket ${ticketId} from ${email.from.email}`);
  await rememberProcessed(connectorId, email.messageId);
  return true;
}

emailConnectorManager.onEmail(processIncoming);

// ── IMAP transport ──────────────────────────────────────────────────

function imapConfig(row: ConnectorRow): EmailConnectorConfig {
  return {
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
}

// ── Graph transport ─────────────────────────────────────────────────

const graphTimers = new Map<string, ReturnType<typeof setInterval>>();
/** Per-connector throttling/backoff deadline (Graph 429s and hard failures). */
const graphBackoff = new Map<string, number>();

function graphConfig(row: ConnectorRow) {
  return {
    tenantId: (row.tenantId || "common").trim() || "common",
    clientId: row.clientId || "",
    clientSecret: row.clientSecretEncrypted ? decryptPassword(row.clientSecretEncrypted) : "",
    mailbox: row.user,
    folder: normalizeGraphFolder(row.folder),
  };
}

async function pollGraphOnce(row: ConnectorRow): Promise<void> {
  const until = graphBackoff.get(row.id) || 0;
  if (Date.now() < until) return;

  const config = graphConfig(row);
  try {
    const { token } = await acquireGraphToken(config);
    const messages = await fetchGraphUnread(config, token);
    let handled = 0;
    for (const message of messages) {
      // processed through the same path as IMAP, including reply matching
      const ok = await emailConnectorManager.processEmail(row.id, row.boardId, message.email);
      if (!ok) continue;
      handled++;
      try {
        await markGraphMessageRead(config, token, message.graphId);
      } catch (e: any) {
        // The ticket exists; a failed mark means the next poll re-sees an
        // already-processed message, which the cursor then skips.
        console.error(`[EmailConnector] Could not mark message read for connector ${row.id}:`, e?.message || e);
      }
    }
    await prisma.emailConnector.update({ where: { id: row.id }, data: { lastPollAt: new Date() } }).catch(() => {});
    await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
    if (handled > 0) console.log(`[EmailConnector] Graph poll handled ${handled} message(s) for ${config.mailbox}`);
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 400);
    const retry = e instanceof GraphError && e.retryAfterMs > 0 ? e.retryAfterMs : 60_000;
    graphBackoff.set(row.id, Date.now() + retry);
    await writeConnectorState(row.id, { lastError: message, lastErrorAt: new Date().toISOString() });
    console.error(`[EmailConnector] Graph poll failed for connector ${row.id}: ${message}`);
  }
}

function startGraphPoller(row: ConnectorRow): void {
  const intervalMs = Math.max(30, row.pollIntervalSec || 300) * 1000;
  const tick = () => { void pollGraphOnce(row).catch((e) => console.error(`[EmailConnector] Graph poll crashed for ${row.id}:`, e?.message || e)); };
  graphTimers.set(row.id, setInterval(tick, intervalMs));
  setTimeout(tick, 5_000);
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function stopEmailConnector(id: string): void {
  emailConnectorManager.removeConnector(id);
  const timer = graphTimers.get(id);
  if (timer) {
    clearInterval(timer);
    graphTimers.delete(id);
  }
  graphBackoff.delete(id);
}

/** Start (or restart) the poller that matches the connector's transport. */
export function startEmailConnector(row: ConnectorRow): void {
  stopEmailConnector(row.id);
  if (isGraphTransport(row)) {
    if (process.env.EMAIL_GRAPH_ENABLED === "false") return;
    startGraphPoller(row);
    return;
  }
  emailConnectorManager.addConnector(imapConfig(row));
}

/**
 * Connection test used by the UI. IMAP: open the folder and count unseen mail.
 * Graph: acquire a token and read the folder the connector points at — which
 * also proves the app registration, the permission and the mailbox scope.
 * The outcome is recorded either way, so the connector row can show why it last
 * failed without anyone reading a log.
 */
export async function testEmailConnector(row: ConnectorRow): Promise<
  { ok: true; transport: "imap" | "graph"; unseen: number; folder: string; detail: string }
  | { ok: false; transport: "imap" | "graph"; error: string }
> {
  if (isGraphTransport(row)) {
    try {
      const config = graphConfig(row);
      const probe = await probeGraphMailbox(config);
      await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
      return {
        ok: true,
        transport: "graph",
        unseen: probe.unread,
        folder: probe.folder,
        detail: `Connected to ${probe.mailbox} — ${probe.folder}: ${probe.unread} unread of ${probe.total}`,
      };
    } catch (e: any) {
      const error = String(e?.message || e).slice(0, 300);
      await writeConnectorState(row.id, { lastError: error, lastErrorAt: new Date().toISOString() });
      return { ok: false, transport: "graph", error };
    }
  }
  const { fetchUnseenEmails } = await import("@C7NTAX/email");
  try {
    const emails = await fetchUnseenEmails({
      host: row.host,
      port: row.port,
      secure: row.secure,
      user: row.user,
      password: decryptPassword(row.passwordEncrypted),
      folder: row.folder,
    });
    await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
    return {
      ok: true,
      transport: "imap",
      unseen: emails.length,
      folder: row.folder || "INBOX",
      detail: `Connected to ${row.user}@${row.host} — ${emails.length} unseen message(s)`,
    };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300);
    await writeConnectorState(row.id, { lastError: error, lastErrorAt: new Date().toISOString() });
    return { ok: false, transport: "imap", error };
  }
}

/** Poll one connector immediately, whichever transport it uses. */
export async function pollEmailConnectorNow(row: ConnectorRow): Promise<void> {
  if (isGraphTransport(row)) {
    graphBackoff.delete(row.id);
    await pollGraphOnce(row);
    return;
  }
  await emailConnectorManager.pollOnce(imapConfig(row));
}

/** Load enabled EmailConnector rows and start polling each one. */
export async function hydrateEmailConnectors(): Promise<void> {
  if (process.env.EMAIL_CONNECTORS_ENABLED === "false") return;
  const rows = await prisma.emailConnector.findMany({ where: { enabled: true } });
  for (const row of rows) {
    try {
      startEmailConnector(row);
    } catch (e) {
      console.error(`[EmailConnector] Failed to hydrate connector ${row.id}:`, e);
    }
  }
  if (rows.length > 0) {
    const graphCount = rows.filter((r) => isGraphTransport(r)).length;
    console.log(`[EmailConnector] Polling ${rows.length} connector(s) (${graphCount} via Microsoft Graph)`);
  }
}
