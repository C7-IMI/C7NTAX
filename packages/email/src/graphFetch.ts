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

/** Client-credentials token for the app registration. */
export async function acquireGraphToken(config: Pick<GraphConfig, "tenantId" | "clientId" | "clientSecret">): Promise<GraphToken> {
  const tenant = (config.tenantId || "").trim() || "common";
  if (!config.clientId || !config.clientSecret) {
    throw new GraphError("Graph needs a tenant id, a client id and a client secret", 0, 0);
  }
  const resp = await graphFetch(
    `${TOKEN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
    "Graph token",
  );
  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new GraphError("Graph token response carried no access_token", 0, 0);
  return { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
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
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(messageId)}`
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
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages`
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
    `${GRAPH_BASE}/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    },
    "Graph mark read",
  );
}

/** Connection probe for the UI: token first, then the folder the connector points at. */
export async function probeGraphMailbox(config: GraphConfig): Promise<{ mailbox: string; folder: string; unread: number; total: number }> {
  const { token } = await acquireGraphToken(config);
  const folder = normalizeGraphFolder(config.folder);
  const resp = await graphFetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(folder)}?$select=displayName,totalItemCount,unreadItemCount`,
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
