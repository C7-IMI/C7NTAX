/**
 * Email connector runtime — hydrates enabled EmailConnector rows at boot and
 * keeps one poller running per connector, chosen by transport:
 *
 *   imap  → EmailConnectorManager (node-imap + a mailbox password; still fine
 *           for mailboxes that accept one, but not for Microsoft 365)
 *   ews   → Exchange Web Services over SOAP with Basic auth (on-premises
 *           Exchange; Microsoft is retiring EWS for Exchange Online)
 *   graph → Microsoft Graph. Either app-only (client credentials — the
 *           unattended watcher arrangement) or delegated (an administrator
 *           connects their own mailbox with "Connect to Microsoft" and the
 *           stored refresh token is used).
 *
 * Every transport shares one processing path: match the message to a ticket,
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
  refreshGraphToken,
  fetchGraphUnread,
  markGraphMessageRead,
  probeGraphMailbox,
  normalizeGraphFolder,
  getGraphAccount,
  fetchEwsUnread,
  markEwsItemsRead,
  probeEwsMailbox,
  isAutoReply,
} from "@C7NTAX/email";
import { prisma } from "../index";
import { decryptPassword, encryptPassword } from "./emailConnectorCrypto";
import { createTicketFromEmail, appendEmailToTicket, type EmailIngestOptions } from "./emailToTicket";

export const emailConnectorManager = new EmailConnectorManager();

export type ConnectorTransport = "imap" | "ews" | "graph";
export type ConnectorAuthType = "basic" | "clientSecret" | "delegated";

/** The columns the runtime needs; routes pass whole EmailConnector rows. */
export interface ConnectorRow {
  id: string;
  boardId: string;
  transport: string | null;
  authType: string | null;
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
  oauthRefreshTokenEncrypted: string | null;
  oauthAccount: string | null;
  defaultCompanyId: string | null;
  autoCreateCompany: boolean;
  autoCreateContact: boolean;
  markSeenOnSuccess: boolean;
  ignoreAutoReplies: boolean;
}

export interface ConnectorState {
  /** Message ids already dealt with, newest last. */
  processed: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessedAt: string | null;
}

const PROCESSED_CAP = 500;
const DELEGATED_TOKEN_SKEW_MS = 60_000;

export function connectorTransport(row: { transport: string | null }): ConnectorTransport {
  const transport = (row.transport || "imap").toLowerCase();
  return transport === "graph" || transport === "ews" ? transport : "imap";
}

export function isGraphTransport(row: { transport: string | null }): boolean {
  return connectorTransport(row) === "graph";
}

export function isEwsTransport(row: { transport: string | null }): boolean {
  return connectorTransport(row) === "ews";
}

export function isDelegated(row: { authType?: string | null }): boolean {
  return (row.authType || "") === "delegated";
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

// ── Ingestion rules per connector ───────────────────────────────────
// Attribution ("where does a sender that matches nothing go?") is a property of
// the connector, and the message handler only receives the connector id, so the
// rules are kept here and refreshed whenever the connector is started or polled.

export interface EmailConnectorRules extends EmailIngestOptions {
  markSeenOnSuccess: boolean;
}

const connectorRules = new Map<string, EmailConnectorRules>();

function rulesFrom(row: ConnectorRow): EmailConnectorRules {
  return {
    defaultCompanyId: row.defaultCompanyId ?? null,
    autoCreateCompany: row.autoCreateCompany === true,
    autoCreateContact: row.autoCreateContact !== false,
    // These two default to on: an operator has to switch them off.
    markSeenOnSuccess: row.markSeenOnSuccess !== false,
    ignoreAutoReplies: row.ignoreAutoReplies !== false,
  };
}

/**
 * The single processing path shared by every transport. Returns true only when
 * the message is finished with (ticket created, reply appended, or deliberately
 * ignored) — the caller marks the message read on true and leaves it otherwise.
 */
async function processIncoming({ connectorId, boardId, email, match }: IncomingEmail): Promise<boolean> {
  const rules = connectorRules.get(connectorId);
  const state = await readConnectorState(connectorId);
  if (state.processed.includes(email.messageId)) return true;

  if (rules?.ignoreAutoReplies !== false && isAutoReply(email.subject, email.bodyText)) {
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

  const ticketId = await createTicketFromEmail(boardId, email, rules);
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

/**
 * A message's own "mark processed" step, so the SOAP and Graph poll loops stay
 * identical. Failures here never fail the message: the ticket work already
 * succeeded, and the cursor means the message is not processed twice — at worst
 * it is seen once more.
 */
async function markAfterSuccess(row: ConnectorRow, mark: () => Promise<unknown>): Promise<void> {
  if (row.markSeenOnSuccess === false) return;
  try {
    await mark();
  } catch (e: any) {
    console.error(`[EmailConnector] Could not mark a message read for connector ${row.id}:`, e?.message || e);
  }
}

// ── Graph transport ─────────────────────────────────────────────────

const apiTimers = new Map<string, ReturnType<typeof setInterval>>();
/** The deferred first tick a new poller fires shortly after start. Tracked so
 *  switching a connector off (or deleting it) cannot leave that tick running —
 *  it would poll a connector that no longer exists and recreate its state row. */
const apiBootTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Per-connector throttling/backoff deadline (Graph 429s and hard failures). */
const apiBackoff = new Map<string, number>();
/** Delegated access tokens, keyed by connector (refreshed a minute early). */
const delegatedTokens = new Map<string, { token: string; expiresAt: number }>();
/**
 * Connectors with a poll in flight. The interval, the deferred first tick and an
 * administrator's "poll now" can otherwise overlap and race each other over the
 * same unread message.
 */
const pollsInFlight = new Set<string>();
/**
 * Connectors stopped (or deleted) while a poll was in flight. The poll finishes
 * its current message but must not write its "last poll"/error state back — that
 * would recreate the state row of a connector that no longer exists.
 */
const stoppedConnectors = new Set<string>();

function graphConfig(row: ConnectorRow) {
  return {
    tenantId: (row.tenantId || "common").trim() || "common",
    clientId: row.clientId || "",
    clientSecret: row.clientSecretEncrypted ? decryptPassword(row.clientSecretEncrypted) : "",
    mailbox: row.user,
    folder: normalizeGraphFolder(row.folder),
    authType: isDelegated(row) ? ("delegated" as const) : ("clientSecret" as const),
  };
}

/**
 * Access token for a connector: client credentials for app-only, or a refresh of
 * the stored delegated token. A rotated refresh token is written straight back,
 * because Microsoft invalidates the old one on use.
 */
async function graphAccessToken(row: ConnectorRow): Promise<string> {
  const config = graphConfig(row);
  if (!isDelegated(row)) return (await acquireGraphToken(config)).token;

  const cached = delegatedTokens.get(row.id);
  if (cached && cached.expiresAt - DELEGATED_TOKEN_SKEW_MS > Date.now()) return cached.token;

  const refreshToken = row.oauthRefreshTokenEncrypted ? decryptPassword(row.oauthRefreshTokenEncrypted) : "";
  if (!refreshToken) {
    throw new GraphError('This connector has not been connected to Microsoft yet — use "Connect to Microsoft" first', 401, 0);
  }
  const tokens = await refreshGraphToken({
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken,
  });
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    await storeDelegatedTokens(row.id, tokens.refreshToken, tokens.scope, row.oauthAccount);
  }
  delegatedTokens.set(row.id, { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 });
  return tokens.accessToken;
}

/** Persist a delegated refresh token (encrypted) plus what it was granted for. */
export async function storeDelegatedTokens(
  connectorId: string,
  refreshToken: string,
  scope?: string | null,
  account?: string | null,
): Promise<void> {
  await prisma.emailConnector.update({
    where: { id: connectorId },
    data: {
      oauthRefreshTokenEncrypted: encryptPassword(refreshToken),
      oauthScopes: scope ?? null,
      oauthConnectedAt: new Date(),
    },
  });
  delegatedTokens.delete(connectorId);
}

/** The account a delegated connector is connected as — also fills in `user`. */
export async function recordDelegatedAccount(connectorId: string, accessToken: string): Promise<string | null> {
  const account = await getGraphAccount(accessToken);
  const upn = account.userPrincipalName || account.mail;
  await prisma.emailConnector.update({
    where: { id: connectorId },
    data: { oauthAccount: upn ?? null, ...(upn ? { user: upn } : {}) },
  });
  return upn;
}

async function pollGraphOnce(row: ConnectorRow): Promise<void> {
  const config = graphConfig(row);
  const token = await graphAccessToken(row);
  const messages = await fetchGraphUnread(config, token);
  let handled = 0;
  for (const message of messages) {
    const ok = await emailConnectorManager.processEmail(row.id, row.boardId, message.email);
    if (!ok) continue;
    handled++;
    await markAfterSuccess(row, () => markGraphMessageRead(config, token, message.graphId));
  }
  if (handled > 0) console.log(`[EmailConnector] Graph poll handled ${handled} message(s) for ${row.user || "the signed-in account"}`);
}

// ── EWS transport ───────────────────────────────────────────────────

function ewsConfig(row: ConnectorRow) {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    user: row.user,
    password: decryptPassword(row.passwordEncrypted),
    folder: row.folder,
    endpoint: process.env.EWS_ENDPOINT,
  };
}

async function pollEwsOnce(row: ConnectorRow): Promise<void> {
  const config = ewsConfig(row);
  const items = await fetchEwsUnread(config);
  let handled = 0;
  for (const item of items) {
    const ok = await emailConnectorManager.processEmail(row.id, row.boardId, item.email);
    if (!ok) continue;
    handled++;
    await markAfterSuccess(row, () => markEwsItemsRead(config, [{ itemId: item.itemId, changeKey: item.changeKey }]));
  }
  if (handled > 0) console.log(`[EmailConnector] EWS poll handled ${handled} message(s) for ${row.user}`);
}

// ── Shared poller (Graph + EWS) ─────────────────────────────────────

async function pollOnlineOnce(row: ConnectorRow): Promise<void> {
  const until = apiBackoff.get(row.id) || 0;
  if (Date.now() < until) return;
  if (pollsInFlight.has(row.id)) return;
  pollsInFlight.add(row.id);

  try {
    if (isEwsTransport(row)) await pollEwsOnce(row);
    else await pollGraphOnce(row);

    if (stoppedConnectors.has(row.id)) return;
    await prisma.emailConnector.update({ where: { id: row.id }, data: { lastPollAt: new Date() } }).catch(() => {});
    await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 400);
    // Graph says how long to wait when it throttles; everything else backs off a minute.
    const retry = e instanceof GraphError && e.retryAfterMs > 0 ? e.retryAfterMs : 60_000;
    apiBackoff.set(row.id, Date.now() + retry);
    if (stoppedConnectors.has(row.id)) return;
    await writeConnectorState(row.id, { lastError: message, lastErrorAt: new Date().toISOString() });
    console.error(`[EmailConnector] ${connectorTransport(row)} poll failed for connector ${row.id}: ${message}`);
  } finally {
    pollsInFlight.delete(row.id);
  }
}

function cloudTransportsDisabled(): boolean {
  return process.env.EMAIL_CONNECTORS_CLOUD_ENABLED === "false" || process.env.EMAIL_GRAPH_ENABLED === "false";
}

function startOnlinePoller(row: ConnectorRow): void {
  const intervalMs = Math.max(30, row.pollIntervalSec || 300) * 1000;
  const tick = () => { void pollOnlineOnce(row).catch((e) => console.error(`[EmailConnector] Poll crashed for ${row.id}:`, e?.message || e)); };
  apiTimers.set(row.id, setInterval(tick, intervalMs));
  apiBootTimers.set(row.id, setTimeout(() => { apiBootTimers.delete(row.id); tick(); }, 5_000));
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function stopEmailConnector(id: string): void {
  emailConnectorManager.removeConnector(id);
  const timer = apiTimers.get(id);
  if (timer) {
    clearInterval(timer);
    apiTimers.delete(id);
  }
  const boot = apiBootTimers.get(id);
  if (boot) {
    clearTimeout(boot);
    apiBootTimers.delete(id);
  }
  apiBackoff.delete(id);
  delegatedTokens.delete(id);
  connectorRules.delete(id);
  stoppedConnectors.add(id);
}

/** Start (or restart) the poller that matches the connector's transport. */
export function startEmailConnector(row: ConnectorRow): void {
  stopEmailConnector(row.id);
  stoppedConnectors.delete(row.id);
  connectorRules.set(row.id, rulesFrom(row));
  if (isGraphTransport(row) || isEwsTransport(row)) {
    if (cloudTransportsDisabled()) return;
    startOnlinePoller(row);
    return;
  }
  emailConnectorManager.addConnector(imapConfig(row));
}

/** Refresh the in-memory ingestion rules without touching the running poller. */
export function refreshConnectorRules(row: ConnectorRow): void {
  if (connectorRules.has(row.id)) connectorRules.set(row.id, rulesFrom(row));
}

/**
 * Connection test used by the UI. IMAP: open the folder and count unseen mail.
 * EWS: read the folder over SOAP. Graph: acquire a token (client credentials, or
 * a refresh of the delegated token) and read the folder — which also proves the
 * app registration, the permission and the mailbox scope. The outcome is recorded
 * either way, so the connector row can show why it last failed without anyone
 * reading a log.
 */
export async function testEmailConnector(row: ConnectorRow): Promise<
  | { ok: true; transport: ConnectorTransport; unseen: number; folder: string; detail: string }
  | { ok: false; transport: ConnectorTransport; error: string }
> {
  const transport = connectorTransport(row);

  if (transport === "graph") {
    try {
      const config = graphConfig(row);
      const token = await graphAccessToken(row);
      const probe = await probeGraphMailbox(config, token);
      await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
      const who = isDelegated(row)
        ? `signed in as ${row.oauthAccount || row.user || (await getGraphAccount(token)).userPrincipalName || "the connected account"}`
        : probe.mailbox;
      return {
        ok: true,
        transport,
        unseen: probe.unread,
        folder: probe.folder,
        detail: `Connected to ${who} — ${probe.folder}: ${probe.unread} unread of ${probe.total}`,
      };
    } catch (e: any) {
      return { ok: false, transport, error: await recordFailure(row, e) };
    }
  }

  if (transport === "ews") {
    try {
      const probe = await probeEwsMailbox(ewsConfig(row));
      await writeConnectorState(row.id, { lastError: null, lastErrorAt: null });
      return {
        ok: true,
        transport,
        unseen: probe.unread,
        folder: probe.folder,
        detail: `Connected to ${probe.mailbox} over EWS — ${probe.folder}: ${probe.unread} unread of ${probe.total}`,
      };
    } catch (e: any) {
      return { ok: false, transport, error: await recordFailure(row, e) };
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
      transport,
      unseen: emails.length,
      folder: row.folder || "INBOX",
      detail: `Connected to ${row.user}@${row.host} — ${emails.length} unseen message(s)`,
    };
  } catch (e: any) {
    return { ok: false, transport, error: await recordFailure(row, e) };
  }
}

async function recordFailure(row: ConnectorRow, e: unknown): Promise<string> {
  const error = String((e as Error)?.message || e).slice(0, 300);
  await writeConnectorState(row.id, { lastError: error, lastErrorAt: new Date().toISOString() });
  return error;
}

/** Poll one connector immediately, whichever transport it uses. */
export async function pollEmailConnectorNow(row: ConnectorRow): Promise<void> {
  connectorRules.set(row.id, rulesFrom(row));
  if (isGraphTransport(row) || isEwsTransport(row)) {
    apiBackoff.delete(row.id);
    await pollOnlineOnce(row);
    return;
  }
  if (pollsInFlight.has(row.id)) return;
  pollsInFlight.add(row.id);
  try {
    await emailConnectorManager.pollOnce(imapConfig(row));
  } finally {
    pollsInFlight.delete(row.id);
  }
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
    const byTransport = rows.reduce<Record<string, number>>((acc, r) => {
      const t = connectorTransport(r);
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    console.log(`[EmailConnector] Polling ${rows.length} connector(s) — ${JSON.stringify(byTransport)}`);
  }
}
