/**
 * Email connector management API (Prisma EmailConnector model).
 *
 * Secrets (the mailbox password, the Entra client secret, the delegated OAuth
 * refresh token) are encrypted with kumoCrypto and never returned; the UI is told
 * whether one is set instead.
 *
 * Three transports, because Microsoft 365 and on-premises Exchange need
 * different ones:
 *  - `imap`  — host/port/secure + user/password. Fine for mailboxes that still
 *              accept a password; Exchange Online has Basic authentication
 *              disabled in every tenant.
 *  - `ews`   — Exchange Web Services over SOAP with the same credentials, for
 *              on-premises Exchange servers (Microsoft is retiring EWS for
 *              Exchange Online, where Graph is the supported path).
 *  - `graph` — Microsoft Graph, either app-only (`clientSecret`: tenant id,
 *              client id and secret, mailbox scoped with Exchange RBAC for
 *              Applications) or `delegated` ("Connect to Microsoft": an
 *              administrator signs in and the stored refresh token reads their
 *              own mailbox — no application permission needed).
 */
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { encryptPassword, decryptPassword } from "../services/emailConnectorCrypto";
import {
  startEmailConnector,
  stopEmailConnector,
  testEmailConnector,
  pollEmailConnectorNow,
  readConnectorState,
  refreshConnectorRules,
  storeDelegatedTokens,
  recordDelegatedAccount,
  isGraphTransport,
  isEwsTransport,
  isDelegated,
  connectorTransport,
  type ConnectorRow,
} from "../services/emailConnectorRuntime";
import {
  buildGraphAuthorizeUrl,
  createPkcePair,
  exchangeGraphCode,
  normalizeEwsFolder,
} from "@C7NTAX/email";

export const emailConnectorsRouter = Router();

const TRANSPORTS = ["imap", "ews", "graph"] as const;
type Transport = (typeof TRANSPORTS)[number];
const AUTH_TYPES = ["basic", "clientSecret", "delegated"] as const;
type AuthType = (typeof AUTH_TYPES)[number];

const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3010";

export function normalizeTransport(value: unknown, fallback: Transport = "imap"): Transport {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s._-]/g, "");
  if (!raw) return fallback;
  if (["graph", "microsoftgraph", "o365", "office365", "m365", "microsoft365", "exchangeonline"].includes(raw)) return "graph";
  if (["ews", "exchange", "exchangewebservices", "exchangewebservice", "onprem", "onpremises", "exchangeonprem"].includes(raw)) return "ews";
  if (raw === "imap" || raw === "imaps") return "imap";
  throw new AppError(`Unsupported transport "${raw}" — use "imap", "ews" or "graph"`, 400);
}

/** The credentials a transport can carry: basic for imap/ews, OAuth for graph. */
export function normalizeAuthType(value: unknown, transport: Transport): AuthType {
  const fallback: AuthType = transport === "graph" ? "clientSecret" : "basic";
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s._-]/g, "");
  if (!raw) return fallback;
  if (["delegated", "user", "oauth", "oauth2", "authorizationcode", "connect", "signedin"].includes(raw)) return "delegated";
  if (["clientsecret", "secret", "app", "application", "apponly", "clientcredentials", "serviceprincipal"].includes(raw)) return "clientSecret";
  if (["basic", "password", "legacy", "usernamepassword"].includes(raw)) return "basic";
  throw new AppError(`Unsupported authType "${raw}" — use "basic", "clientSecret" or "delegated"`, 400);
}

function assertTransportAuthPair(transport: Transport, authType: AuthType): void {
  if (transport === "graph" && authType === "basic") {
    throw new AppError("Microsoft 365 uses OAuth — choose the app-only (client secret) or delegated (Connect to Microsoft) sign-in", 400);
  }
  if (transport !== "graph" && authType !== "basic") {
    throw new AppError(`${transport.toUpperCase()} authenticates with a mailbox username and password — OAuth applies to the Microsoft 365 (Graph) transport`, 400);
  }
}

/** What the client may see: config and flags, never a secret. */
function toPublic(row: ConnectorRow & { enabled: boolean; lastPollAt: Date | null; oauthAccount?: string | null; oauthScopes?: string | null; oauthConnectedAt?: Date | null; createdAt?: Date; updatedAt?: Date }) {
  const transport = connectorTransport(row);
  return {
    id: row.id,
    boardId: row.boardId,
    transport,
    authType: isDelegated(row) ? "delegated" : transport === "graph" ? "clientSecret" : "basic",
    host: row.host,
    port: row.port,
    secure: row.secure,
    user: row.user,
    folder: row.folder,
    pollIntervalSec: row.pollIntervalSec,
    enabled: row.enabled,
    lastPollAt: row.lastPollAt,
    tenantId: row.tenantId,
    clientId: row.clientId,
    hasPassword: Boolean(row.passwordEncrypted),
    hasClientSecret: Boolean(row.clientSecretEncrypted),
    // Delegated sign-in state; the refresh token itself is never exposed.
    hasRefreshToken: Boolean(row.oauthRefreshTokenEncrypted),
    oauthAccount: row.oauthAccount ?? null,
    oauthScopes: row.oauthScopes ?? null,
    oauthConnectedAt: row.oauthConnectedAt ?? null,
    // Ingestion rules
    defaultCompanyId: row.defaultCompanyId,
    autoCreateCompany: row.autoCreateCompany,
    autoCreateContact: row.autoCreateContact,
    markSeenOnSuccess: row.markSeenOnSuccess,
    ignoreAutoReplies: row.ignoreAutoReplies,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validate a create/update body. `existing` is the stored row on update, so a
 * secret already saved can stay while the rest of the config changes.
 */
function validateConfig(
  body: Record<string, unknown>,
  transport: Transport,
  authType: AuthType,
  existing: { passwordEncrypted?: string; clientSecretEncrypted?: string | null; oauthRefreshTokenEncrypted?: string | null } | null,
): void {
  const missing: string[] = [];
  if (!body.boardId && !existing) missing.push("boardId");

  if (transport === "graph") {
    if (!body.tenantId) missing.push("tenantId");
    if (!body.clientId) missing.push("clientId");
    if (authType === "clientSecret") {
      if (!body.clientSecret && !existing?.clientSecretEncrypted) {
        missing.push("clientSecret (or switch to Connect to Microsoft for a delegated sign-in)");
      }
      // An app-only token is minted for a mailbox, so it has to be named.
      if (!body.user && !existing) missing.push("user (mailbox)");
    }
  } else {
    if (!body.host) missing.push("host");
    if (!body.user) missing.push("user");
    if (!body.password && !existing?.passwordEncrypted) missing.push("password");
    if (transport === "ews" && body.folder && !normalizeEwsFolder(String(body.folder))) {
      missing.push("folder (EWS needs a well-known name: Inbox, SentItems, Drafts, DeletedItems, JunkEmail, Archive)");
    }
  }

  if (missing.length) {
    const label = transport === "graph" ? (authType === "delegated" ? "Microsoft 365 (Graph, delegated sign-in)" : "Microsoft 365 (Graph)") : transport.toUpperCase();
    const hint = transport === "graph" && authType === "clientSecret"
      ? " The app registration needs the application permission Mail.ReadWrite, consented, and its access scoped to this mailbox."
      : transport === "graph"
        ? " Save the tenant and client id, then use \"Connect to Microsoft\"."
        : "";
    throw new AppError(`${label} needs: ${missing.join(", ")}.${hint}`, 400);
  }
}

/** Loads a row as the runtime wants it. */
async function loadRow(id: string) {
  const row = await prisma.emailConnector.findUnique({ where: { id } });
  if (!row) throw new AppError("Connector not found", 404);
  return row;
}

// ── OAuth callback ──
// Public on purpose: Microsoft redirects the administrator's browser here with no
// bearer token. Registered before the authenticate() middleware below so the
// callback is reachable, and the signed, single-use state row is what proves the
// request belongs to the connector we started the flow for.
const oauthStateKey = (id: string) => `email_connector:${id}:oauth`;

/** The exact redirect URI this instance must have on the registration for the delegated flow. */
export function oauthRedirectUri(req: AuthRequest): string {
  if (process.env.EMAIL_OAUTH_REDIRECT_URI) return process.env.EMAIL_OAUTH_REDIRECT_URI;
  const base = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/+$/, "")}/api/email-connectors/oauth/callback`;
}

emailConnectorsRouter.get("/oauth/callback", async (req: AuthRequest, res) => {
  const back = (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    res.redirect(`${WEB_ORIGIN.replace(/\/+$/, "")}/cloudconnect?${query}`);
  };
  const { code, state, error, error_description: errorDescription } = req.query as Record<string, string>;
  if (error) {
    back({ emailConnector: "", connected: "0", reason: `${error}: ${errorDescription || ""}`.slice(0, 300) });
    return;
  }
  if (!code || !state) {
    back({ emailConnector: "", connected: "0", reason: "Microsoft did not return an authorization code" });
    return;
  }
  try {
    // The state carries the connector id (the random half is what validates it),
    // so the pending row is found directly instead of by scanning.
    const connectorId = state.split(".")[0];
    const pending = connectorId ? await prisma.systemConfig.findUnique({ where: { key: oauthStateKey(connectorId) } }) : null;
    const match = pending && (pending.value as { state?: string })?.state === state ? pending : null;
    if (!match || !connectorId) {
      back({ emailConnector: "", connected: "0", reason: "This sign-in link is no longer valid — start Connect to Microsoft again" });
      return;
    }
    const { verifier, redirectUri } = match.value as { verifier?: string; redirectUri?: string };
    await prisma.systemConfig.delete({ where: { key: match.key } }).catch(() => {});

    const row = await loadRow(connectorId);
    if (!verifier || !redirectUri) {
      back({ emailConnector: connectorId, connected: "0", reason: "The pending sign-in record was incomplete — try again" });
      return;
    }
    const tokens = await exchangeGraphCode({
      tenantId: row.tenantId,
      clientId: row.clientId || "",
      // Confidential clients send their secret; public clients rely on PKCE alone.
      clientSecret: row.clientSecretEncrypted ? decryptPassword(row.clientSecretEncrypted) : undefined,
      code,
      redirectUri,
      codeVerifier: verifier,
    });
    if (!tokens.refreshToken) {
      back({ emailConnector: connectorId, connected: "0", reason: "Microsoft returned no refresh token — make sure the app requests the offline_access scope" });
      return;
    }
    const account = await recordDelegatedAccount(connectorId, tokens.accessToken);
    await storeDelegatedTokens(connectorId, tokens.refreshToken, tokens.scope, account);
    const updated = await loadRow(connectorId);
    stopEmailConnector(updated.id);
    if (updated.enabled) startEmailConnector(updated);
    back({ emailConnector: connectorId, connected: "1", account: account || "" });
  } catch (e: any) {
    const reason = String(e?.message || e).slice(0, 300);
    back({ emailConnector: "", connected: "0", reason });
  }
});

// ── Everything past this line needs a session ──
emailConnectorsRouter.use(authenticate);

// ── List ──
// Carries the connector's health from the runtime's state row (last error, how
// much mail it has processed) so a broken mailbox is visible in the list.
emailConnectorsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.emailConnector.findMany({ orderBy: { createdAt: "asc" } });
    const keys = rows.map((r) => `email_connector:${r.id}:state`);
    const states = keys.length ? await prisma.systemConfig.findMany({ where: { key: { in: keys } } }) : [];
    const byKey = new Map(states.map((s) => [s.key, (s.value || {}) as { processed?: unknown; lastError?: unknown; lastErrorAt?: unknown; lastProcessedAt?: unknown }]));
    res.json({
      data: rows.map((row) => {
        const state = byKey.get(`email_connector:${row.id}:state`) || {};
        return {
          ...toPublic(row),
          lastError: typeof state.lastError === "string" ? state.lastError : null,
          lastErrorAt: typeof state.lastErrorAt === "string" ? state.lastErrorAt : null,
          lastProcessedAt: typeof state.lastProcessedAt === "string" ? state.lastProcessedAt : null,
          processedCount: Array.isArray(state.processed) ? state.processed.length : 0,
        };
      }),
    });
  } catch (e) { next(e); }
});

/** Ingestion-rule fields shared by create and update. */
function rulesData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (body.defaultCompanyId !== undefined) data.defaultCompanyId = body.defaultCompanyId ? String(body.defaultCompanyId) : null;
  if (body.autoCreateCompany !== undefined) data.autoCreateCompany = Boolean(body.autoCreateCompany);
  if (body.autoCreateContact !== undefined) data.autoCreateContact = Boolean(body.autoCreateContact);
  if (body.markSeenOnSuccess !== undefined) data.markSeenOnSuccess = Boolean(body.markSeenOnSuccess);
  if (body.ignoreAutoReplies !== undefined) data.ignoreAutoReplies = Boolean(body.ignoreAutoReplies);
  return data;
}

async function assertCompany(id: unknown): Promise<void> {
  if (!id) return;
  const company = await prisma.company.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!company) throw new AppError("Default company not found", 404);
}

// ── Create ──
emailConnectorsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const transport = normalizeTransport(body.transport);
    const authType = normalizeAuthType(body.authType, transport);
    assertTransportAuthPair(transport, authType);
    validateConfig(body, transport, authType, null);
    await assertCompany(body.defaultCompanyId);
    const board = await prisma.serviceBoard.findUnique({ where: { id: String(body.boardId) } });
    if (!board) throw new AppError("Service board not found", 404);

    const isGraph = transport === "graph";
    const row = await prisma.emailConnector.create({
      data: {
        boardId: String(body.boardId),
        transport,
        authType,
        host: isGraph ? "" : String(body.host),
        port: isGraph ? 443 : Number(body.port) || (transport === "ews" ? 443 : 993),
        secure: body.secure !== false,
        user: String(body.user ?? ""),
        passwordEncrypted: body.password ? encryptPassword(String(body.password)) : "",
        clientId: isGraph ? String(body.clientId) : null,
        clientSecretEncrypted: isGraph && body.clientSecret ? encryptPassword(String(body.clientSecret)) : null,
        tenantId: isGraph ? String(body.tenantId) : null,
        folder: body.folder ? String(body.folder) : isGraph ? "Inbox" : "INBOX",
        pollIntervalSec: Math.max(30, Number(body.pollIntervalSec ?? body.pollIntervalSeconds) || 300),
        ...rulesData(body),
        // Created disabled: the admin tests the connection, then switches it on.
        enabled: false,
      },
    });
    res.status(201).json(toPublic(row));
  } catch (e) { next(e); }
});

// ── Update ──
emailConnectorsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const existing = await loadRow(String(req.params.id));
    const body = (req.body || {}) as Record<string, unknown>;
    const transport = body.transport !== undefined ? normalizeTransport(body.transport) : connectorTransport(existing);
    const authType = body.authType !== undefined
      ? normalizeAuthType(body.authType, transport)
      : ((existing.authType || (transport === "graph" ? "clientSecret" : "basic")) as AuthType);
    assertTransportAuthPair(transport, authType);

    const data: Record<string, unknown> = {};
    if (body.transport !== undefined) data.transport = transport;
    if (body.authType !== undefined || body.transport !== undefined) data.authType = authType;
    if (body.host !== undefined) data.host = String(body.host);
    if (body.port !== undefined) data.port = Number(body.port) || 993;
    if (body.secure !== undefined) data.secure = body.secure !== false;
    if (body.user !== undefined) data.user = String(body.user);
    if (body.password !== undefined && body.password !== "") data.passwordEncrypted = encryptPassword(String(body.password));
    if (body.folder !== undefined) data.folder = String(body.folder);
    if (body.pollIntervalSec !== undefined) data.pollIntervalSec = Math.max(30, Number(body.pollIntervalSec ?? body.pollIntervalSeconds) || 300);
    if (body.boardId !== undefined) {
      const board = await prisma.serviceBoard.findUnique({ where: { id: String(body.boardId) } });
      if (!board) throw new AppError("Service board not found", 404);
      data.boardId = String(body.boardId);
    }
    if (body.tenantId !== undefined) data.tenantId = body.tenantId ? String(body.tenantId) : null;
    if (body.clientId !== undefined) data.clientId = body.clientId ? String(body.clientId) : null;
    if (body.clientSecret !== undefined && body.clientSecret !== "") data.clientSecretEncrypted = encryptPassword(String(body.clientSecret));
    if (body.defaultCompanyId !== undefined) await assertCompany(body.defaultCompanyId);
    Object.assign(data, rulesData(body));

    if (
      body.enabled === true || body.transport !== undefined || body.authType !== undefined || body.host !== undefined
      || body.user !== undefined || body.password !== undefined || body.clientId !== undefined || body.tenantId !== undefined
      || body.folder !== undefined
    ) {
      const pending = { ...existing, ...data } as Record<string, unknown>;
      validateConfig(pending, transport, authType, {
        passwordEncrypted: String(pending.passwordEncrypted ?? ""),
        clientSecretEncrypted: (pending.clientSecretEncrypted as string | null) ?? null,
        oauthRefreshTokenEncrypted: (pending.oauthRefreshTokenEncrypted as string | null) ?? null,
      });
    }
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);

    const updated = await prisma.emailConnector.update({ where: { id: existing.id }, data: data as any });

    // Restart the poller so the running transport always matches the row.
    stopEmailConnector(updated.id);
    if (updated.enabled) startEmailConnector(updated);
    else refreshConnectorRules(updated);
    res.json(toPublic(updated));
  } catch (e) { next(e); }
});

// ── Delete ──
emailConnectorsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    stopEmailConnector(String(req.params.id));
    await prisma.emailConnector.deleteMany({ where: { id: String(req.params.id) } });
    await prisma.systemConfig.deleteMany({ where: { key: { in: [`email_connector:${req.params.id}:state`, oauthStateKey(String(req.params.id))] } } });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Connect to Microsoft (delegated OAuth, authorization code + PKCE) ──
// Returns the consent URL for the browser to open; the code comes back to the
// public callback above, so no session is needed to finish the flow.
emailConnectorsRouter.post("/:id/oauth/start", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    if (!isGraphTransport(row)) throw new AppError("Connect to Microsoft applies to the Microsoft 365 (Graph) transport", 400);
    if (!row.clientId) throw new AppError("Save the application (client) ID first — Connect to Microsoft needs it", 400);

    const { verifier, challenge } = createPkcePair();
    const state = `${row.id}.${randomBytes(24).toString("hex")}`;
    const redirectUri = oauthRedirectUri(req);
    await prisma.systemConfig.upsert({
      where: { key: oauthStateKey(row.id) },
      update: { value: { state, verifier, redirectUri, startedAt: new Date().toISOString() } },
      create: { key: oauthStateKey(row.id), value: { state, verifier, redirectUri, startedAt: new Date().toISOString() } },
    });

    res.json({
      url: buildGraphAuthorizeUrl({
        tenantId: row.tenantId,
        clientId: row.clientId,
        redirectUri,
        state,
        codeChallenge: challenge,
      }),
      redirectUri,
      note: `Add this exact redirect URI to the app registration as a Web platform URI: ${redirectUri}`,
    });
  } catch (e) { next(e); }
});

// ── Disconnect (forget the delegated sign-in) ──
emailConnectorsRouter.post("/:id/oauth/disconnect", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    await prisma.emailConnector.update({
      where: { id: row.id },
      data: { oauthRefreshTokenEncrypted: null, oauthAccount: null, oauthScopes: null, oauthConnectedAt: null },
    });
    await prisma.systemConfig.deleteMany({ where: { key: oauthStateKey(row.id) } });
    stopEmailConnector(row.id);
    const updated = await loadRow(row.id);
    if (updated.enabled) startEmailConnector(updated);
    res.json({ message: "Disconnected", account: null });
  } catch (e) { next(e); }
});

// ── Test connection ──
emailConnectorsRouter.post("/:id/test", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    const result = await testEmailConnector(row);
    if (result.ok) {
      await prisma.emailConnector.update({ where: { id: row.id }, data: { lastPollAt: new Date() } });
      res.json(result);
      return;
    }
    res.status(502).json(result);
  } catch (e) { next(e); }
});

// ── Poll now ──
emailConnectorsRouter.post("/:id/poll", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    if (!row.enabled) throw new AppError("Connector is disabled — enable it first", 400);
    await pollEmailConnectorNow(row);
    const state = await readConnectorState(row.id);
    res.json({ ok: !state.lastError, transport: connectorTransport(row), lastError: state.lastError, processedCount: state.processed.length });
  } catch (e) { next(e); }
});

// ── Status ──
emailConnectorsRouter.get("/:id/status", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    const state = await readConnectorState(row.id);
    res.json({
      id: row.id,
      enabled: row.enabled,
      transport: connectorTransport(row),
      authType: isDelegated(row) ? "delegated" : connectorTransport(row) === "graph" ? "clientSecret" : "basic",
      delegated: isDelegated(row),
      oauthAccount: row.oauthAccount,
      oauthConnectedAt: row.oauthConnectedAt,
      isEws: isEwsTransport(row),
      lastPollAt: row.lastPollAt,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
      lastProcessedAt: state.lastProcessedAt,
      processedCount: state.processed.length,
    });
  } catch (e) { next(e); }
});
