/**
 * EWS (Exchange Web Services) transport for the email connector.
 *
 * EWS is the pre-Graph Exchange protocol. Microsoft is retiring it for Exchange
 * Online (Graph is the supported path there), but on-premises Exchange 2016/2019
 * servers — and hybrid/legacy tenants that still expose it — are read over EWS on
 * the same process-then-mark contract as the other transports:
 *
 *   1. `FindItem`  — unread messages in the folder, oldest first (id + change key)
 *   2. `GetItem`   — the same items with `IncludeMimeContent`, so the message is
 *                    parsed from its own MIME by the shared mailparser mapping
 *   3. `UpdateItem`— `message:IsRead = true`, only after the ticket work succeeded
 *
 * Authentication is HTTP Basic (username + password) against the Exchange
 * virtual directory, which on-premises deployments still support; NTLM and
 * OAuth are deliberately not attempted here. `EWS_ENDPOINT` overrides the
 * derived `https://<host>:<port>/EWS/Exchange.asmx` URL and
 * `EWS_ALLOW_SELF_SIGNED=true` accepts the self-signed certificate internal
 * servers commonly use.
 *
 * References: "EWS FindItem operation", "EWS GetItem operation",
 * "EWS UpdateItem operation", "Exchange Web Services endpoint" and
 * "Exchange Web Services (EWS) retirement" (Microsoft Learn).
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { simpleParser } from "mailparser";
import type { ParsedEmail } from "./EmailConnector";
import { parseMailToEmail } from "./parseMail";

const TYPES_NS = "http://schemas.microsoft.com/exchange/services/2006/types";
const MESSAGES_NS = "http://schemas.microsoft.com/exchange/services/2006/messages";
const MAX_MESSAGES_PER_POLL = Number(process.env.EMAIL_EWS_MAX_MESSAGES || 25);
const REQUEST_TIMEOUT_MS = Number(process.env.EMAIL_EWS_TIMEOUT_MS || 30_000);

export interface EwsConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
  folder?: string;
  /** Full EWS endpoint; overrides host/port/secure when set. */
  endpoint?: string;
}

export class EwsError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "EwsError";
    this.status = status;
  }
}

/** A parsed email plus what EWS needs to mark it processed. */
export interface FetchedEwsEmail {
  itemId: string;
  changeKey: string;
  email: ParsedEmail;
}

export interface EwsItemRef {
  itemId: string;
  changeKey?: string;
}

/** Folder names Exchange knows by heart; anything else cannot be addressed. */
const DISTINGUISHED_FOLDERS: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  sentitems: "sentitems",
  sentmail: "sentitems",
  drafts: "drafts",
  draft: "drafts",
  deleted: "deleteditems",
  deleteditems: "deleteditems",
  trash: "deleteditems",
  junk: "junkemail",
  junkemail: "junkemail",
  spam: "junkemail",
  archive: "archive",
};

/** "INBOX" / "Sent Items" → the distinguished name EWS expects. */
export function normalizeEwsFolder(folder?: string | null): string {
  const key = (folder || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  return DISTINGUISHED_FOLDERS[key || "inbox"] || "";
}

export function ewsEndpoint(config: EwsConfig): string {
  if (config.endpoint) return config.endpoint;
  const scheme = config.secure === false ? "http" : "https";
  const port = config.port && config.port > 0 && config.port !== (scheme === "https" ? 443 : 80) ? `:${config.port}` : "";
  return `${scheme}://${config.host}${port}/EWS/Exchange.asmx`;
}

// ── XML plumbing ────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface XmlNode {
  attrs: Record<string, string>;
  inner: string;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-z0-9:_-]+)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[(m[1] || "").toLowerCase().replace(/^[a-z]+:/, "")] = decodeXml(m[2] || "");
  return out;
}

/** Every `<tag …>inner</tag>` / `<tag …/>` node, with namespace prefixes removed. */
function nodes(xml: string, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const re = new RegExp(`<${tag}((?:\\s[^>]*)?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: parseAttrs(m[1] || ""), inner: m[2] ?? "" });
  return out;
}

/**
 * Exchange namespaces everything (`<t:RootFolder>`, `<m:ResponseCode>`), and the
 * parsers above match bare tag names, so prefixes are stripped once per response.
 * Only tag names are touched — attribute values keep their text.
 */
function stripNamespaces(xml: string): string {
  return xml.replace(/<(\/?)([a-z0-9]+):/gi, "<$1");
}

function firstText(xml: string, tag: string): string {
  return (nodes(xml, tag)[0]?.inner || "").trim();
}

/** Exchange answers with per-item ResponseCodes; anything else is a failure. */
function assertEwsOk(xml: string, label: string): void {
  const codes = nodes(xml, "ResponseCode").map((n) => decodeXml(n.inner.trim()));
  if (codes.length === 0) return; // no response messages at all (empty folder)
  const bad = codes.find((c) => c !== "NoError");
  if (bad) {
    const text = firstText(xml, "MessageText") || firstText(xml, "Message");
    throw new EwsError(`${label}: Exchange returned ${bad}${text ? ` — ${text}` : ""}`, 0);
  }
}

function soapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="${TYPES_NS}" xmlns:m="${MESSAGES_NS}">
  <soap:Header><t:RequestServerVersion Version="Exchange2016"/></soap:Header>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

function soapRequest(config: EwsConfig, operation: string, body: string, label: string): Promise<string> {
  const url = new URL(ewsEndpoint(config));
  const payload = Buffer.from(soapEnvelope(body), "utf8");
  const transport = url.protocol === "http:" ? httpRequest : httpsRequest;
  const auth = Buffer.from(`${config.user}:${config.password}`, "utf8").toString("base64");

  return new Promise<string>((resolve, reject) => {
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "text/xml; charset=utf-8",
          "content-length": payload.length,
          // EWS wants the action as a bare SOAP action header.
          SOAPAction: `${MESSAGES_NS}/${operation}`,
          authorization: `Basic ${auth}`,
          "user-agent": "C7NTAX-EmailConnector/1.0",
        },
        // Internal Exchange servers routinely carry a self-signed certificate.
        rejectUnauthorized: process.env.EWS_ALLOW_SELF_SIGNED !== "true",
      } as never,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode || 0;
          if (status === 401 || status === 403) {
            reject(new EwsError(`${label}: authentication failed (HTTP ${status}) — EWS needs Basic authentication enabled on the Exchange virtual directory and a mailbox-enabled account`, status));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new EwsError(`${label}: HTTP ${status} — ${text.slice(0, 300)}`, status));
            return;
          }
          resolve(stripNamespaces(text));
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new EwsError(`${label}: timed out after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on("error", (e: Error) => reject(e instanceof EwsError ? e : new EwsError(`${label}: ${e.message}`)));
    req.end(payload);
  });
}

// ── SOAP bodies ─────────────────────────────────────────────────────

function folderElement(folder?: string | null): string {
  const distinguished = normalizeEwsFolder(folder);
  if (!distinguished) {
    throw new EwsError(`EWS needs a well-known folder name (Inbox, SentItems, Drafts, DeletedItems, JunkEmail, Archive) — got "${folder}"`);
  }
  return `<t:DistinguishedFolderId Id="${distinguished}"/>`;
}

function findItemBody(folder: string | undefined, max: number, unreadOnly: boolean): string {
  const restriction = unreadOnly
    ? `<m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="message:IsRead"/><t:FieldURIOrConstant><t:Constant Value="false"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction>`
    : "";
  return `<m:FindItem Traversal="Shallow">
      <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>
      ${restriction}
      <m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="message:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
      <m:Viewport><t:MaxEntriesReturned>${max}</t:MaxEntriesReturned><t:BasePoint>Beginning</t:BasePoint></m:Viewport>
      <m:ParentFolderIds>${folderElement(folder)}</m:ParentFolderIds>
    </m:FindItem>`;
}

function itemIdElement(item: EwsItemRef): string {
  const changeKey = item.changeKey ? ` ChangeKey="${escapeXml(item.changeKey)}"` : "";
  return `<t:ItemId Id="${escapeXml(item.itemId)}"${changeKey}/>`;
}

function getItemBody(items: EwsItemRef[]): string {
  return `<m:GetItem>
      <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape>
      <m:ItemIds>${items.map(itemIdElement).join("")}</m:ItemIds>
    </m:GetItem>`;
}

function updateIsReadBody(items: EwsItemRef[], isRead: boolean): string {
  const change = (item: EwsItemRef) =>
    `<t:ItemChange>${itemIdElement(item)}<t:Updates><t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>${isRead}</t:IsRead></t:Message></t:SetItemField></t:Updates></t:ItemChange>`;
  return `<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite">
      <m:ItemChanges>${items.map(change).join("")}</m:ItemChanges>
    </m:UpdateItem>`;
}

/** Item ids (with change keys) out of a FindItem or GetItem response. */
function itemRefs(xml: string): EwsItemRef[] {
  return nodes(xml, "ItemId")
    .map((n) => ({ itemId: n.attrs.id || "", changeKey: n.attrs.changekey || "" }))
    .filter((i) => i.itemId);
}

/** `TotalItemsInView` on the response's RootFolder. */
function totalInView(xml: string): number {
  const total = nodes(xml, "RootFolder")[0]?.attrs.totalitemsinview;
  return Number.isFinite(Number(total)) ? Number(total) : 0;
}

// ── Operations ──────────────────────────────────────────────────────

/** Unread messages in the folder, oldest first, parsed from their own MIME. */
export async function fetchEwsUnread(config: EwsConfig): Promise<FetchedEwsEmail[]> {
  const findXml = await soapRequest(config, "FindItem", findItemBody(config.folder, MAX_MESSAGES_PER_POLL, true), "EWS FindItem");
  assertEwsOk(findXml, "EWS FindItem");
  const ids = itemRefs(findXml).slice(0, MAX_MESSAGES_PER_POLL);
  if (ids.length === 0) return [];

  const getXml = await soapRequest(config, "GetItem", getItemBody(ids), "EWS GetItem");
  assertEwsOk(getXml, "EWS GetItem");

  const results: FetchedEwsEmail[] = [];
  for (const item of nodes(getXml, "Message")) {
    const ref = nodes(item.inner, "ItemId")[0];
    const mime = firstText(item.inner, "MimeContent");
    if (!ref?.attrs.id || !mime) continue;
    try {
      const parsed = await simpleParser(Buffer.from(mime.replace(/\s+/g, ""), "base64"));
      results.push({
        itemId: ref.attrs.id,
        changeKey: ref.attrs.changekey || "",
        email: parseMailToEmail(parsed, `ews-${ref.attrs.id}`),
      });
    } catch {
      // Unparseable MIME: leave it unread so it stays visible rather than lost.
    }
  }
  return results;
}

/** Mark messages read — called only after the ticket work for them succeeded. */
export async function markEwsItemsRead(config: EwsConfig, items: EwsItemRef[]): Promise<number> {
  const unique = items.filter((i) => i.itemId);
  if (unique.length === 0) return 0;
  const xml = await soapRequest(config, "UpdateItem", updateIsReadBody(unique, true), "EWS UpdateItem");
  assertEwsOk(xml, "EWS UpdateItem");
  const codes = nodes(xml, "ResponseCode").map((n) => n.inner.trim());
  return codes.filter((c) => c === "NoError").length || unique.length;
}

/** Folder probe for the connection test: unread and total message counts. */
export async function probeEwsMailbox(config: EwsConfig): Promise<{ mailbox: string; folder: string; unread: number; total: number }> {
  const totalXml = await soapRequest(config, "FindItem", findItemBody(config.folder, 1, false), "EWS FindItem");
  assertEwsOk(totalXml, "EWS FindItem");
  const unreadXml = await soapRequest(config, "FindItem", findItemBody(config.folder, 1, true), "EWS FindItem");
  assertEwsOk(unreadXml, "EWS FindItem");
  return {
    mailbox: config.user,
    folder: normalizeEwsFolder(config.folder) || "inbox",
    unread: totalInView(unreadXml),
    total: totalInView(totalXml),
  };
}
