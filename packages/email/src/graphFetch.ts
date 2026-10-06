/**
 * Microsoft Graph transport for the email connector (app-only, client credentials).
 *
 * Exchange Online has Basic authentication disabled in every tenant, so an IMAP
 * connection with a username and password can no longer read a Microsoft 365
 * mailbox — the mailbox has to be read with an OAuth token. For an unattended
 * "watcher" mailbox the supported arrangement is an app-only Graph call:
 *
 *   1. Microsoft Entra app registration with the *application* permission
 *      `Mail.ReadWrite` granted (admin consent). Read alone is `Mail.Read`, but
 *      marking a message processed needs write.
 *   2. Access scoped to the single watched mailbox with Exchange Online RBAC for
 *      Applications (the successor to Application Access Policies), so the app
 *      can read nothing else.
 *   3. A token from the client-credentials flow, then the mailbox and mail APIs:
 *      `GET  /users/{mailbox}/mailFolders/{folder}/messages`
 *      `GET  /users/{mailbox}/messages/{id}/attachments`
 *      `PATCH /users/{mailbox}/messages/{id}`  { "isRead": true }
 *
 * References: "Deprecation of Basic authentication in Exchange Online",
 * "Role Based Access Control for Applications in Exchange Online",
 * "List attachments" / "message: update" (Microsoft Graph v1.0).
 *
 * Everything here is transport only: it returns ParsedEmail objects and marks
 * messages processed when the caller says the work succeeded. Nothing is
 * written back to the mailbox before that.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ParsedEmail } from "./EmailConnector";

const GRAPH_BASE = (process.env.GRAPH_API_BASE || "https://graph.microsoft.com/v1.0").replace(/\/+$/, "");
const TOKEN_BASE = (process.env.GRAPH_TOKEN_BASE || "https://login.microsoftonline.com").replace(/\/+$/, "");
const MAX_ATTACHMENT_BYTES = Number(process.env.EMAIL_MAX_ATTACHMENT_BYTES || 10 * 1024 * 1024);
const MAX_ATTACHMENTS_PER_MESSAGE = 20;

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Mailbox UPN (or id) to watch, e.g. servicedesk@cyber7group.com */
  mailbox: string;
  /** Well-known folder name (Inbox), a folder id, or a mailFolder path. */
  folder?: string;
  /**
   * `clientSecret` (app-only, the unattended watcher default) or `delegated`
   * (a signed-in account's own mailbox, refreshed from a stored refresh token).
   */
  authType?: "clientSecret" | "delegated";
  /** Stored, encrypted elsewhere; only ever passed in for `authType: delegated`. */
  refreshToken?: string;
  /** Overrides the token's mailbox path (`/me` when the mailbox is empty). */
  endpointBase?: string;
}

/** Default delegated scope set: read/write mail plus the account's own profile. */
export const DELEGATED_GRAPH_SCOPES =
  "offline_access openid profile email https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read";

/** `/users/<mailbox>` for a named mailbox, `/me` for the signed-in account. */
export function mailboxBase(config: Pick<GraphConfig, "mailbox">): string {
  const mailbox = (config.mailbox || "").trim();
  return mailbox ? `/users/${encodeURIComponent(mailbox)}` : "/me";
}

export interface GraphMessage {
  graphId: string;
  email: ParsedEmail;
}

/** A Graph failure with enough detail for the UI: status, message, retry hint. */
export class GraphError extends Error {
  status: number;
  retryAfterMs: number;

  constructor(message: string, status = 0, retryAfterMs = 0) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** IMAP names people actually type → the well-known names Graph expects. */
const WELL_KNOWN_FOLDERS: Record<string, string> = {
  inbox: "Inbox",
  drafts: "Drafts",
  draft: "Drafts",
  sent: "SentItems",
  sentitems: "SentItems",
  sentmail: "SentItems",
  junk: "JunkEmail",
  junkemail: "JunkEmail",
  spam: "JunkEmail",
  deleted: "DeletedItems",
  deleteditems: "DeletedItems",
  trash: "DeletedItems",
  archive: "Archive",
  outbox: "Outbox",
};

export function normalizeGraphFolder(folder?: string | null): string {
  const raw = (folder || "").trim();
  if (!raw) return "Inbox";
  const mapped = WELL_KNOWN_FOLDERS[raw.toLowerCase().replace(/[\s_-]/g, "")];
  return mapped || raw;
}

async function graphFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e: any) {
    throw new GraphError(`${label}: ${e?.message || e}`, 0, 0);
  }
  if (resp.ok) return resp;
  if (resp.status === 429 || resp.status === 503) {
    const retryAfter = Number(resp.headers.get("retry-after"));
    const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000;
    throw new GraphError(`${label}: throttled (HTTP ${resp.status}), retry in ${Math.round(ms / 1000)}s`, resp.status, ms);
  }
  const body = (await resp.text().catch(() => "")).slice(0, 400);
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    const graphMessage = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    detail = graphMessage || parsed.error_description || body;
  } catch { /* not JSON — keep the raw body */ }
  throw new GraphError(`${label}: HTTP ${resp.status} — ${detail}`, resp.status, 0);
}

export interface GraphToken {
  token: string;
  expiresAt: number;
}

/** Token endpoint parameters shared by every grant type. */
function tokenRequest(tenantId: string, params: Record<string, string>): Promise<Response> {
  const tenant = (tenantId || "").trim() || "common";
  return graphFetch(
    `${TOKEN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    },
    "Graph token",
  );
}

async function readTokenResponse(resp: Response): Promise<GraphOAuthTokens> {
  const data = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) throw new GraphError("Graph token response carried no access_token", 0, 0);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    scope: data.scope || "",
    expiresIn: data.expires_in ?? 3600,
  };
}

/** Client-credentials token for the app registration. */
export async function acquireGraphToken(config: Pick<GraphConfig, "tenantId" | "clientId" | "clientSecret">): Promise<GraphToken> {
  if (!config.clientId || !config.clientSecret) {
    throw new GraphError("Graph needs a tenant id, a client id and a client secret", 0, 0);
  }
  const resp = await tokenRequest(config.tenantId, {
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });
  const tokens = await readTokenResponse(resp);
  return { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
}

// ── Delegated OAuth (authorization code + PKCE) ──────────────────────
// "Connect to Microsoft": an administrator signs in, consents to Mail.ReadWrite
// for their own mailbox, and the connector polls that mailbox with the refresh
// token. No application permission or Exchange RBAC scoping is involved, which
// makes this the quick way to watch a genuine mailbox; the app-only flow stays
// the right choice for a shared mailbox nobody is signed into.

export interface GraphOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  expiresIn: number;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** PKCE verifier/challenge pair (S256) for the authorization-code flow. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Consent URL to send the administrator's browser to. */
export function buildGraphAuthorizeUrl(options: {
  tenantId?: string | null;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
  loginHint?: string | null;
}): string {
  const tenant = (options.tenantId || "common").trim() || "common";
  const params = new URLSearchParams({
    client_id: options.clientId,
    response_type: "code",
    redirect_uri: options.redirectUri,
    response_mode: "query",
    scope: options.scope || DELEGATED_GRAPH_SCOPES,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (options.loginHint) params.set("login_hint", options.loginHint);
  return `${TOKEN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Trade the authorization code for a first access/refresh token pair. */
export async function exchangeGraphCode(options: {
  tenantId?: string | null;
  clientId: string;
  clientSecret?: string | null;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GraphOAuthTokens> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: options.clientId,
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    scope: DELEGATED_GRAPH_SCOPES,
  };
  // Confidential clients send their secret; public clients rely on PKCE alone.
  if (options.clientSecret) params.client_secret = options.clientSecret;
  return readTokenResponse(await tokenRequest(options.tenantId || "common", params));
}

/** Refresh an expired delegated access token (the refresh token rotates). */
export async function refreshGraphToken(options: {
  tenantId?: string | null;
  clientId: string;
  clientSecret?: string | null;
  refreshToken: string;
}): Promise<GraphOAuthTokens> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: options.clientId,
    refresh_token: options.refreshToken,
    scope: DELEGATED_GRAPH_SCOPES,
  };
  if (options.clientSecret) params.client_secret = options.clientSecret;
  try {
    return readTokenResponse(await tokenRequest(options.tenantId || "common", params));
  } catch (e) {
    // invalid_grant means the consent is gone (password change, revoked, or the
    // refresh token expired) — the connector needs re-connecting, not retrying.
    const message = e instanceof Error ? e.message : String(e);
    if (/invalid_grant|AADSTS70008|AADSTS50173|AADSTS65001/i.test(message)) {
      throw new GraphError(`Microsoft sign-in has expired or was revoked — reconnect the connector. (${message.slice(0, 200)})`, 401, 0);
    }
    throw e;
  }
}

/** The signed-in account, recorded so the UI can show whose mailbox is watched. */
export async function getGraphAccount(
  accessToken: string,
): Promise<{ userPrincipalName: string | null; mail: string | null; displayName: string | null }> {
  const resp = await graphFetch(
    `${GRAPH_BASE}/me?$select=userPrincipalName,mail,displayName`,
    { headers: { authorization: `Bearer ${accessToken}` } },
    "Graph account",
  );
  const data = (await resp.json()) as { userPrincipalName?: string; mail?: string; displayName?: string };
  return {
    userPrincipalName: data.userPrincipalName || null,
    mail: data.mail || null,
    displayName: data.displayName || null,
  };
}

interface GraphRecipient { emailAddress?: { name?: string; address?: string } }

interface GraphMessagePayload {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
}

const MESSAGE_SELECT = [
  "id", "internetMessageId", "subject", "from", "toRecipients", "ccRecipients",
  "receivedDateTime", "hasAttachments", "body", "internetMessageHeaders",
].join(",");

function headerValue(headers: GraphMessagePayload["internetMessageHeaders"], name: string): string | null {
  const found = (headers || []).find((h) => (h.name || "").toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || null;
}

function addresses(list: GraphRecipient[] | undefined, key: "address" | "name"): string[] {
  return (list || [])
    .map((r) => (key === "address" ? r.emailAddress?.address : r.emailAddress?.name))
    .filter((v): v is string => Boolean(v));
}

/** Fetch one message's file attachments (base64 → Buffer); inline parts included, size-capped. */
export async function fetchGraphAttachments(
  config: GraphConfig,
  token: string,
  messageId: string,
): Promise<ParsedEmail["attachments"]> {
  const url = `${GRAPH_BASE}${mailboxBase(config)}/messages/${encodeURIComponent(messageId)}`
    + "/attachments?$select=id,name,contentType,size,isInline,contentBytes";
  const resp = await graphFetch(url, { headers: { authorization: `Bearer ${token}` } }, "Graph attachments");
  const data = (await resp.json()) as {
    value?: Array<{ name?: string; contentType?: string; size?: number; contentBytes?: string }>;
  };
  const out: ParsedEmail["attachments"] = [];
  for (const att of data.value || []) {
    if (out.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
    if (!att.contentBytes) continue; // reference/online attachments carry no content
    if ((att.size ?? 0) > MAX_ATTACHMENT_BYTES) continue; // over the cap: skipped, not failed
    const content = Buffer.from(att.contentBytes, "base64");
    if (!content.length) continue;
    out.push({
      filename: (att.name || "attachment").slice(0, 255),
      contentType: att.contentType || "application/octet-stream",
      size: content.length,
      content,
    });
  }
  return out;
}

/** Unread messages in the configured folder, oldest first, with attachments. */
export async function fetchGraphUnread(config: GraphConfig, token: string, top = 25): Promise<GraphMessage[]> {
  const folder = normalizeGraphFolder(config.folder);
  const url = `${GRAPH_BASE}${mailboxBase(config)}/mailFolders/${encodeURIComponent(folder)}/messages`
    + `?$filter=${encodeURIComponent("isRead eq false")}&$top=${top}&$orderby=${encodeURIComponent("receivedDateTime asc")}&$select=${MESSAGE_SELECT}`;
  const resp = await graphFetch(url, { headers: { authorization: `Bearer ${token}` } }, "Graph message list");
  const data = (await resp.json()) as { value?: GraphMessagePayload[] };
  const messages: GraphMessage[] = [];
  for (const m of data.value || []) {
    const isHtml = (m.body?.contentType || "").toLowerCase() === "html";
    const content = m.body?.content || "";
    const attachments = m.hasAttachments ? await fetchGraphAttachments(config, token, m.id) : [];
    messages.push({
      graphId: m.id,
      email: {
        messageId: m.internetMessageId || `graph-${m.id}`,
        from: {
          name: m.from?.emailAddress?.name || "",
          email: m.from?.emailAddress?.address || "",
        },
        to: addresses(m.toRecipients, "address"),
        cc: addresses(m.ccRecipients, "address"),
        subject: m.subject || "",
        bodyText: isHtml ? "" : content,
        bodyHtml: isHtml ? content : "",
        attachments,
        date: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
        inReplyTo: headerValue(m.internetMessageHeaders, "In-Reply-To"),
        references: (headerValue(m.internetMessageHeaders, "References") || "").split(/\s+/).filter(Boolean),
      },
    });
  }
  return messages;
}

/** Mark one message as read — called only after the ticket work succeeded. */
export async function markGraphMessageRead(config: GraphConfig, token: string, messageId: string): Promise<void> {
  await graphFetch(
    `${GRAPH_BASE}${mailboxBase(config)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    },
    "Graph mark read",
  );
}

/**
 * Connection probe for the UI: token first, then the folder the connector points
 * at. A caller that already holds a delegated token passes it in, so the probe
 * never has to fall back to client credentials.
 */
export async function probeGraphMailbox(
  config: GraphConfig,
  existingToken?: string,
): Promise<{ mailbox: string; folder: string; unread: number; total: number }> {
  const token = existingToken || (await acquireGraphToken(config)).token;
  const folder = normalizeGraphFolder(config.folder);
  const resp = await graphFetch(
    `${GRAPH_BASE}${mailboxBase(config)}/mailFolders/${encodeURIComponent(folder)}?$select=displayName,totalItemCount,unreadItemCount`,
    { headers: { authorization: `Bearer ${token}` } },
    "Graph folder lookup",
  );
  const data = (await resp.json()) as { displayName?: string; totalItemCount?: number; unreadItemCount?: number };
  return {
    mailbox: config.mailbox,
    folder: data.displayName || folder,
    unread: data.unreadItemCount ?? 0,
    total: data.totalItemCount ?? 0,
  };
}

export { MAX_ATTACHMENT_BYTES };
