/**
 * Deploying the Microsoft 365 app registration from inside C7NTAX.
 *
 * `O365/New-C7NTAXMailboxApp.ps1` already does this correctly, and this file is the same sequence
 * with the same ids — the difference is who is holding the keyboard. The script needs a terminal, a
 * tenant id typed into it and the output copied by hand into the connector; this runs from the
 * wizard in the connector dialog, so the person doing it is already signed into the product they
 * are configuring, and the values end up in the form rather than in a console buffer.
 *
 * Three things are deliberately the same as the script, because getting them wrong is silent:
 *
 *   · **`Mail.ReadWrite`, not `Mail.Read`.** The connector marks a message read once it has become a
 *     ticket; a read-only app connects, reads, and then fails on the first message it tries to mark.
 *   · **The application role id and the delegated scope id are different GUIDs for the same name.**
 *     `Mail.ReadWrite` as a role is `e2a3a72e-…`, as a scope it is `024d486e-…`; using one where the
 *     other belongs is a no-op that consent does not report.
 *   · **Consent is three ids** — principal (the app's service principal), resource (Graph) and
 *     appRole (the permission). Graph rejects the assignment if any one of them is wrong.
 *
 * Sign-in is the OAuth **device-code** flow against Microsoft's own Graph command-line client, which
 * needs no app of its own to bootstrap and carries the delegated `Application.ReadWrite.All` it takes
 * to register an app. It is a public client, so there is no secret to hold, and the administrator
 * signs in themselves — this application never sees a credential for their tenant, only the token
 * they granted it for this one task.
 *
 * Nothing here is reached without `integration:manage`, and every deployment is written to the audit
 * log. Endpoints are overridable through `GRAPH_TOKEN_BASE` / `GRAPH_API_BASE` (the same variables
 * `packages/email/src/graphFetch.ts` uses), which is also what lets a stub stand in for Microsoft in
 * the harness.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "../middleware/errorHandler";
import { logger } from "./logger";

const TOKEN_BASE = (process.env.GRAPH_TOKEN_BASE || "https://login.microsoftonline.com").replace(/\/+$/, "");
const GRAPH_BASE = (process.env.GRAPH_API_BASE || "https://graph.microsoft.com/v1.0").replace(/\/+$/, "");

/** Microsoft's Graph command-line client: public, pre-consented for app registration, no secret. */
const AUTH_CLIENT_ID = process.env.EMAIL_OAUTH_DEPLOY_CLIENT_ID || "14d82eec-204b-4c2f-b7e8-296a70dab67e";

/** The Graph resource every one of these calls is against. Fixed, not looked up. */
const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

/** Permission name → the two ids Microsoft gives it. See the note at the top about why both exist. */
const GRAPH_PERMISSIONS: Record<string, { application?: string; delegated?: string }> = {
  "Mail.ReadWrite": { application: "e2a3a72e-5f79-4c64-b1b1-878b674786c9", delegated: "024d486e-b451-40bb-833d-3e66d98c5c73" },
  "Mail.Read": { application: "810c84a8-4a9e-49e6-bf7d-12d183f40d01", delegated: "570282fd-fa5c-430d-a7fd-fc8dc98a9dca" },
  "Mail.Send": { application: "b633e1c5-b582-4048-a93e-9f11b44c7e96", delegated: "e383f46e-2787-4529-855e-0e479a3ffac0" },
  "User.Read.All": { application: "df021288-bdef-4463-88db-98f22de89214", delegated: "a154be20-db9c-4678-8ab7-66f6cc099a59" },
  "User.Read": { delegated: "e1fe6dd8-ba31-4d61-89e7-88639da4683d" },
};

const APPLICATION_PERMISSIONS = ["Mail.ReadWrite"];
/** `offline_access` is an OIDC scope with no role id: it is consented by name at sign-in, not here. */
const DELEGATED_PERMISSIONS = ["Mail.ReadWrite", "User.Read"];
const DELEGATED_SCOPES_CONSENTED_AT_SIGN_IN = ["offline_access"];

export const DEFAULT_DISPLAY_NAME = "C7NTAX Email Connector";
const SESSION_TTL_MS = 15 * 60 * 1000;

export type DeployMode = "AppOnly" | "Delegated" | "Both";

export interface DeployInput {
  tenant: string;
  mode: DeployMode;
  displayName?: string;
  mailbox?: string;
  redirectUri?: string;
  actorEmail?: string;
}

interface DeploySession {
  id: string;
  tenant: string;
  mode: DeployMode;
  displayName: string;
  mailbox: string;
  redirectUri: string;
  actorEmail: string | null;
  createdAt: number;
  deviceCode: string;
  intervalSec: number;
  expiresAt: number;
  status: "pending" | "authorized" | "expired" | "declined" | "failed";
  account: string | null;
  resolvedTenantId: string | null;
  accessToken: string | null;
  error: string | null;
}

/** Live sign-in attempts, keyed by session id. In memory: a device code is worthless in a minute. */
const sessions = new Map<string, DeploySession>();

function sweep(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt + SESSION_TTL_MS) sessions.delete(id);
  }
}

function session(id: string): DeploySession {
  sweep();
  const found = sessions.get(id);
  if (!found) throw new AppError("That deployment has expired — start it again", 410);
  return found;
}

/** The error body is the only useful part of a Graph failure; PowerShell and fetch both hide it. */
async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string; message?: string };
    if (typeof parsed.error === "string" && parsed.error_description) return `${parsed.error}: ${parsed.error_description.split(/\r?\n/)[0]}`;
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch { /* not JSON: the body itself is the message */ }
  return text.slice(0, 400) || `HTTP ${res.status}`;
}

export interface GraphCall {
  method: string;
  path: string;
  ok: boolean;
  detail: string;
}

/**
 * One Graph call, recorded.
 *
 * The record matters as much as the call: the wizard shows it, so "which step failed" is answered by
 * reading the wizard rather than by re-running anything against the tenant.
 */
async function graph(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  log?: GraphCall[],
): Promise<any> {
  const url = `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const detail = res.ok ? "" : await readError(res);
  log?.push({ method, path: path.split("?")[0]!, ok: res.ok, detail: detail.slice(0, 300) });
  if (!res.ok) throw new GraphFailure(`${method} ${path.split("?")[0]} failed: ${detail}`, res.status, detail);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

class GraphFailure extends Error {
  constructor(message: string, readonly status: number, readonly detail: string) {
    super(message);
  }
}

/** A Graph refusal an administrator can act on, rather than a status code and a shrug. */
function explain(e: unknown, what: string): AppError {
  if (!(e instanceof GraphFailure)) return new AppError(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`, 502);
  const detail = e.detail.toLowerCase();
  if (e.status === 401) return new AppError(`Microsoft refused the sign-in while trying to ${what}. Sign in again as an administrator of the tenant.`, 502);
  if (e.status === 403 || detail.includes("insufficient privileges") || detail.includes("authorization_requestdenied")) {
    return new AppError(
      `The account that signed in may not ${what}. Registering an app and consenting to application permissions both need the Application Administrator (or Global Administrator) role.`,
      403,
    );
  }
  if (detail.includes("already exists") || detail.includes("conflicting object")) {
    return new AppError(`Microsoft says that already exists while trying to ${what} — open the registration named "C7NTAX Email Connector" in Entra and remove the duplicate, then run the wizard again.`, 409);
  }
  return new AppError(`Could not ${what}: ${e.detail}`, 502);
}

/** The tenant id and the account, out of the token the administrator just granted. */
function claimsOf(accessToken: string): { tenantId: string | null; account: string | null } {
  try {
    const payload = accessToken.split(".")[1] ?? "";
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json) as { tid?: string; upn?: string; preferred_username?: string };
    return { tenantId: claims.tid ?? null, account: claims.upn ?? claims.preferred_username ?? null };
  } catch {
    return { tenantId: null, account: null };
  }
}

/**
 * Ask Microsoft for a code the administrator types into their browser. Nothing is granted by this
 * call; it only says "somebody intends to sign in".
 */
export async function startDeployment(input: DeployInput): Promise<{
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  message: string;
  expiresIn: number;
  interval: number;
}> {
  const tenant = (input.tenant || "").trim();
  if (!tenant) {
    throw new AppError(
      "A tenant is required — the Directory (tenant) ID from Entra (Overview), or the tenant's primary domain such as contoso.onmicrosoft.com.",
      400,
    );
  }
  const mode: DeployMode = input.mode === "Delegated" || input.mode === "Both" ? input.mode : "AppOnly";

  let res: Response;
  try {
    res = await fetch(`${TOKEN_BASE}/${encodeURIComponent(tenant)}/oauth2/v2.0/devicecode`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: AUTH_CLIENT_ID, scope: "https://graph.microsoft.com/.default" }),
    });
  } catch (e) {
    throw new AppError(`Could not reach the Microsoft sign-in endpoint (${TOKEN_BASE}): ${e instanceof Error ? e.message : String(e)}`, 502);
  }

  if (!res.ok) {
    const detail = await readError(res);
    // The first thing anyone gets wrong is the tenant, so it is the one failure worth naming.
    if (/AADSTS90002|90002/.test(detail)) {
      throw new AppError(
        `Tenant "${tenant}" was not found. Use the Directory (tenant) ID from Entra admin centre → Overview, or the tenant's primary domain such as contoso.onmicrosoft.com.`,
        400,
      );
    }
    throw new AppError(`Microsoft would not start the sign-in: ${detail}`, 502);
  }

  const device = (await res.json()) as {
    device_code: string; user_code: string; verification_uri: string;
    verification_uri_complete?: string; message?: string; expires_in: number; interval?: number;
  };

  const session: DeploySession = {
    id: randomUUID(),
    tenant,
    mode,
    displayName: (input.displayName || "").trim() || DEFAULT_DISPLAY_NAME,
    mailbox: (input.mailbox || "").trim(),
    redirectUri: (input.redirectUri || "").trim(),
    actorEmail: input.actorEmail ?? null,
    createdAt: Date.now(),
    deviceCode: device.device_code,
    intervalSec: Math.max(1, device.interval ?? 5),
    expiresAt: Date.now() + Math.max(60, device.expires_in ?? 900) * 1000,
    status: "pending",
    account: null,
    resolvedTenantId: null,
    accessToken: null,
    error: null,
  };
  sessions.set(session.id, session);

  return {
    sessionId: session.id,
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete ?? null,
    message: device.message ?? `Open ${device.verification_uri} and enter ${device.user_code}.`,
    expiresIn: Math.max(60, device.expires_in ?? 900),
    interval: session.intervalSec,
  };
}

export interface PollResult {
  status: DeploySession["status"];
  account: string | null;
  tenantId: string | null;
  error: string | null;
  interval: number;
}

/** What the session looks like right now, without asking Microsoft anything. */
export function deploymentState(id: string): PollResult & { tenant: string; mode: DeployMode; displayName: string; mailbox: string; redirectUri: string } {
  const current = session(id);
  return {
    status: current.status,
    account: current.account,
    tenantId: current.resolvedTenantId,
    error: current.error,
    interval: current.intervalSec,
    tenant: current.tenant,
    mode: current.mode,
    displayName: current.displayName,
    mailbox: current.mailbox,
    redirectUri: current.redirectUri,
  };
}

/** Has the administrator finished signing in yet? Answers `pending` while they have not. */
export async function pollDeployment(id: string): Promise<PollResult> {
  const current = session(id);
  if (current.status !== "pending") {
    return { status: current.status, account: current.account, tenantId: current.resolvedTenantId, error: current.error, interval: current.intervalSec };
  }
  if (Date.now() > current.expiresAt) {
    current.status = "expired";
    current.error = "The code expired before it was approved. Start the deployment again.";
    return { status: "expired", account: null, tenantId: null, error: current.error, interval: current.intervalSec };
  }

  const res = await fetch(`${TOKEN_BASE}/${encodeURIComponent(current.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: AUTH_CLIENT_ID,
      device_code: current.deviceCode,
    }),
  });

  if (!res.ok) {
    const detail = await readError(res);
    if (/authorization_pending/.test(detail)) return { status: "pending", account: null, tenantId: null, error: null, interval: current.intervalSec };
    if (/slow_down/.test(detail)) {
      current.intervalSec += 2;
      return { status: "pending", account: null, tenantId: null, error: null, interval: current.intervalSec };
    }
    if (/authorization_declined|access_denied/.test(detail)) {
      current.status = "declined";
      current.error = "Sign-in was declined in the browser.";
      return { status: "declined", account: null, tenantId: null, error: current.error, interval: current.intervalSec };
    }
    if (/expired_token|code_expired/.test(detail)) {
      current.status = "expired";
      current.error = "The code expired before it was approved. Start the deployment again.";
      return { status: "expired", account: null, tenantId: null, error: current.error, interval: current.intervalSec };
    }
    current.status = "failed";
    current.error = detail;
    return { status: "failed", account: null, tenantId: null, error: detail, interval: current.intervalSec };
  }

  const tokens = (await res.json()) as { access_token?: string };
  if (!tokens.access_token) {
    current.status = "failed";
    current.error = "Microsoft returned no access token.";
    return { status: "failed", account: null, tenantId: null, error: current.error, interval: current.intervalSec };
  }

  const claims = claimsOf(tokens.access_token);
  current.accessToken = tokens.access_token;
  current.account = claims.account;
  current.resolvedTenantId = claims.tenantId;
  current.status = "authorized";
  logger.info("oauth-app", `Deployment authorised by ${claims.account ?? "an administrator"} in tenant ${claims.tenantId ?? current.tenant}`);
  return { status: "authorized", account: current.account, tenantId: current.resolvedTenantId, error: null, interval: current.intervalSec };
}

export interface DeploymentResult {
  tenantId: string;
  clientId: string;
  clientSecret: string | null;
  secretExpiry: string | null;
  secretDisplayName: string | null;
  objectId: string;
  servicePrincipalId: string;
  displayName: string;
  mode: DeployMode;
  reusedRegistration: boolean;
  mailbox: string;
  redirectUri: string | null;
  permissions: { application: string[]; delegated: string[] };
  scopingCommands: string | null;
  account: string | null;
  steps: GraphCall[];
  warnings: string[];
}

/**
 * The Exchange Online half, which Graph has no route to — printed for a person to run.
 *
 * It takes **one or several** mailboxes because one registration usually watches several: `alerts@`
 * files to the NOC board and `servicedesk@` to the service desk, and Exchange scopes an application
 * per mailbox rather than per app. Each address gets its own management scope and its own role
 * assignment, numbered from 2 so the app's identity (step 1) is still created once. A single address
 * reads exactly as it always did.
 */
export function scopingCommands(clientId: string, servicePrincipalId: string | null, displayName: string, mailbox: string | string[]): string {
  const short = clientId.slice(0, 8);
  const addresses = (Array.isArray(mailbox) ? mailbox : [mailbox])
    .map((address) => String(address || "").trim())
    .filter((address, index, all) => address.length > 0 && all.indexOf(address) === index);
  if (addresses.length === 0) addresses.push("<service-desk-mailbox>");

  const lines = [
    "Install-Module ExchangeOnlineManagement -Scope CurrentUser",
    "Connect-ExchangeOnline",
    "",
    "# 1. The app's identity inside Exchange Online — once per registration",
    servicePrincipalId
      ? `New-ServicePrincipal -AppId ${clientId} -ObjectId ${servicePrincipalId} -DisplayName "${displayName}"`
      : `#    Already created when "${displayName}" was deployed. If it is missing:\n#    New-ServicePrincipal -AppId ${clientId} -ObjectId <enterprise application object id> -DisplayName "${displayName}"`,
  ];

  addresses.forEach((address, index) => {
    // One scope per mailbox: the first keeps the name the deployment used, the rest are numbered.
    const scopeName = index === 0 ? `C7NTAX-${short}` : `C7NTAX-${short}-${index + 1}`;
    lines.push(
      "",
      `# ${index + 2}. ${address} — its own scope, and the mailbox role restricted to it`,
      `New-ManagementScope -Name "${scopeName}" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '${address}'"`,
      `New-ManagementRoleAssignment -Name "${scopeName}-Assignment" -App "${displayName}" \``,
      `  -Role "Application Mail.ReadWrite" -CustomResourceScope "${scopeName}"`,
    );
  });

  lines.push(
    "",
    "# Verify both halves — the first proves access, the second proves it is scoped",
    ...addresses.map((address) => `Test-ServicePrincipalAuthorization -Identity ${clientId} -Resource ${address}`),
    `Get-ManagementRoleAssignment -RoleAssignee "${displayName}" | Format-Table Name, Role, CustomResourceScope`,
  );
  return lines.join("\n");
}

/**
 * Create (or reuse) the registration, grant consent, mint the secret.
 *
 * Idempotent by display name, exactly as the script is: a second run reuses the registration, asks
 * for the permissions again and asserts consent again. The one thing it cannot do twice is show the
 * same secret, so a second run mints a further secret rather than pretending to return the first.
 */
export async function deployApplication(id: string): Promise<DeploymentResult> {
  const current = session(id);
  if (current.status !== "authorized" || !current.accessToken) {
    throw new AppError("Sign in as the tenant administrator before deploying anything.", 409);
  }
  const token = current.accessToken;
  const steps: GraphCall[] = [];
  const warnings: string[] = [];
  const wantsApplication = current.mode === "AppOnly" || current.mode === "Both";
  const wantsDelegated = current.mode === "Delegated" || current.mode === "Both";

  if (wantsDelegated && !current.redirectUri) {
    throw new AppError(
      "The delegated flow needs this instance's redirect URI, which the wizard reads from the API — reopen the wizard and try again.",
      400,
    );
  }

  // ── 1. The registration, reused when one already carries this name ────────
  let app: { id: string; appId: string; displayName: string } | null = null;
  let reusedRegistration = false;
  try {
    const existing = await graph(
      "GET",
      `/applications?$filter=displayName eq '${encodeURIComponent(current.displayName)}'&$select=id,appId,displayName`,
      token,
      undefined,
      steps,
    );
    const found = (existing?.value ?? [])[0];
    if (found) {
      app = found;
      reusedRegistration = true;
      await graph("PATCH", `/applications/${found.id}`, token, {
        signInAudience: "AzureADMyOrg",
        isFallbackPublicClient: current.mode !== "AppOnly",
      }, steps);
    } else {
      app = await graph("POST", "/applications", token, {
        displayName: current.displayName,
        signInAudience: "AzureADMyOrg",
        isFallbackPublicClient: current.mode !== "AppOnly",
      }, steps);
    }
  } catch (e) {
    throw explain(e, "create the app registration");
  }
  if (!app?.id || !app.appId) throw new AppError("Microsoft did not return the new registration's ids.", 502);

  // ── 2. The permissions it will ask for ────────────────────────────────────
  const access: Array<{ id: string; type: "Role" | "Scope" }> = [];
  if (wantsApplication) {
    for (const name of APPLICATION_PERMISSIONS) {
      const roleId = GRAPH_PERMISSIONS[name]?.application;
      if (!roleId) throw new AppError(`${name} has no application role id — that is a bug in this deployment, not in your tenant.`, 500);
      access.push({ id: roleId, type: "Role" });
    }
  }
  if (wantsDelegated) {
    for (const name of DELEGATED_PERMISSIONS) {
      const scopeId = GRAPH_PERMISSIONS[name]?.delegated;
      if (scopeId) access.push({ id: scopeId, type: "Scope" });
    }
  }
  try {
    await graph("PATCH", `/applications/${app.id}`, token, {
      requiredResourceAccess: [{ resourceAppId: GRAPH_RESOURCE_APP_ID, resourceAccess: access }],
      ...(wantsDelegated ? { web: { redirectUris: [current.redirectUri] } } : {}),
    }, steps);
  } catch (e) {
    throw explain(e, "record the permissions on the registration");
  }

  // ── 3. The service principal: what consent is actually granted *to* ───────
  let servicePrincipalId: string;
  try {
    const existing = await graph("GET", `/servicePrincipals?$filter=appId eq '${app.appId}'&$select=id,appId`, token, undefined, steps);
    const found = (existing?.value ?? [])[0];
    if (found) servicePrincipalId = found.id as string;
    else {
      const created = await graph("POST", "/servicePrincipals", token, { appId: app.appId }, steps);
      servicePrincipalId = created.id as string;
    }
  } catch (e) {
    throw explain(e, "create the service principal");
  }
  if (!servicePrincipalId) throw new AppError("Microsoft did not return a service principal for the new registration.", 502);

  // ── 4. Graph's own service principal: the resource half of every grant ────
  let graphServicePrincipalId: string;
  try {
    const res = await graph("GET", `/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appId`, token, undefined, steps);
    graphServicePrincipalId = (res?.value ?? [])[0]?.id as string;
  } catch (e) {
    throw explain(e, "read the Microsoft Graph service principal");
  }
  if (!graphServicePrincipalId) {
    throw new AppError("The Microsoft Graph service principal is missing from this tenant, which should not be possible.", 502);
  }

  // ── 5. Consent ────────────────────────────────────────────────────────────
  if (wantsApplication) {
    for (const name of APPLICATION_PERMISSIONS) {
      try {
        await graph("POST", `/servicePrincipals/${graphServicePrincipalId}/appRoleAssignedTo`, token, {
          principalId: servicePrincipalId,
          resourceId: graphServicePrincipalId,
          appRoleId: GRAPH_PERMISSIONS[name]!.application,
        }, steps);
      } catch (e) {
        // Consent already granted is the normal second-run answer, not a failure.
        const detail = e instanceof GraphFailure ? e.detail.toLowerCase() : "";
        if (detail.includes("already exists") || detail.includes("permission being added already exists")) {
          steps.push({ method: "POST", path: `/servicePrincipals/${graphServicePrincipalId}/appRoleAssignedTo`, ok: true, detail: "already granted" });
        } else {
          throw explain(e, `grant admin consent for the application permission ${name}`);
        }
      }
    }
  }

  if (wantsDelegated) {
    // offline_access is consented by name at sign-in, so it is deliberately not in this grant.
    const scope = DELEGATED_PERMISSIONS.join(" ");
    try {
      const existing = await graph(
        "GET",
        `/oauth2PermissionGrants?$filter=clientId eq '${servicePrincipalId}' and resourceId eq '${graphServicePrincipalId}'`,
        token,
        undefined,
        steps,
      );
      const grant = (existing?.value ?? [])[0];
      if (grant) {
        await graph("PATCH", `/oauth2PermissionGrants/${grant.id}`, token, { scope }, steps);
      } else {
        await graph("POST", "/oauth2PermissionGrants", token, {
          clientId: servicePrincipalId,
          consentType: "AllPrincipals",
          resourceId: graphServicePrincipalId,
          scope,
        }, steps);
      }
    } catch (e) {
      throw explain(e, "grant admin consent for the delegated permissions");
    }
  }

  // ── 6. The credential. Delegated uses PKCE and must not have one ──────────
  let clientSecret: string | null = null;
  let secretExpiry: string | null = null;
  let secretDisplayName: string | null = null;
  if (wantsApplication) {
    const months = Number(process.env.EMAIL_OAUTH_SECRET_MONTHS || 12);
    const end = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
    secretDisplayName = `${current.displayName}-${new Date().toISOString().slice(0, 7)}`;
    try {
      const created = await graph("POST", `/applications/${app.id}/addPassword`, token, {
        passwordCredential: { displayName: secretDisplayName, endDateTime: end.toISOString() },
      }, steps);
      clientSecret = (created?.secretText as string) ?? null;
      secretExpiry = (created?.endDateTime as string) ?? end.toISOString();
    } catch (e) {
      throw explain(e, "create the client secret");
    }
    if (!clientSecret) throw new AppError("Microsoft accepted the secret but returned no value, which means it cannot be shown again. Remove the new secret in Entra and run the wizard again.", 502);
    warnings.push(`Diary this expiry 30 days ahead: a dead secret reaches the connector as AADSTS7000222 and nothing warns you first. Expires ${secretExpiry?.slice(0, 10)}.`);
  } else {
    warnings.push("No client secret was created: the delegated flow uses PKCE, and a secret would only be a thing to lose.");
  }

  const mailbox = current.mailbox;
  if (wantsApplication) {
    if (mailbox) warnings.push("Run the Exchange Online commands below, or the app can read every mailbox in the tenant until it is scoped.");
    else warnings.push("No mailbox was given, so the app is unscoped: until the Exchange Online commands are run with a mailbox it can read EVERY mailbox in the tenant.");
    warnings.push("Consent can take 30–60 minutes to reach the mailbox layer. An immediate ErrorAccessDenied is expected, not a misconfiguration.");
  }

  logger.info("oauth-app", `Deployed "${current.displayName}" (${app.appId}) in tenant ${current.resolvedTenantId ?? current.tenant} as ${current.account ?? "an administrator"}`);

  return {
    tenantId: current.resolvedTenantId || current.tenant,
    clientId: app.appId,
    clientSecret,
    secretExpiry,
    secretDisplayName,
    objectId: app.id,
    servicePrincipalId,
    displayName: current.displayName,
    mode: current.mode,
    reusedRegistration,
    mailbox,
    redirectUri: wantsDelegated ? current.redirectUri : null,
    permissions: {
      application: wantsApplication ? APPLICATION_PERMISSIONS : [],
      delegated: wantsDelegated ? [...DELEGATED_PERMISSIONS, ...DELEGATED_SCOPES_CONSENTED_AT_SIGN_IN] : [],
    },
    scopingCommands: wantsApplication ? scopingCommands(app.appId, servicePrincipalId, current.displayName, mailbox) : null,
    account: current.account,
    steps,
    warnings,
  };
}

export interface ImportedCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  mode: DeployMode | null;
  displayName: string | null;
  secretExpiry: string | null;
  source: "script" | "values";
  warnings: string[];
}

/**
 * What `O365/New-C7NTAXMailboxApp.ps1` prints, without a transcription step.
 *
 * The script writes `out/c7ntax-m365-app.json` (and prints the same four values). Pasting that file
 * is the offline path through the wizard: it needs no admin sign-in here, and it also works for a
 * tenant where this instance cannot reach Microsoft's sign-in endpoint at all.
 */
export function importCredentials(input: Record<string, unknown>): ImportedCredentials {
  const first = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const scriptJson = typeof input.scriptJson === "string" ? input.scriptJson : "";
  let parsed: Record<string, unknown> = {};
  if (scriptJson.trim()) {
    try {
      parsed = JSON.parse(scriptJson) as Record<string, unknown>;
    } catch {
      throw new AppError(
        "That is not the JSON the script writes. Paste the whole contents of out/c7ntax-m365-app.json, or fill the four fields in by hand.",
        400,
      );
    }
  }

  const tenantId = first(parsed.tenantId, input.tenantId);
  const clientId = first(parsed.clientId, input.clientId);
  const clientSecret = first(parsed.secret, parsed.clientSecret, input.clientSecret);
  const permissions = (parsed.permissions ?? {}) as { application?: unknown };
  const applicationPermissions = Array.isArray(permissions.application) ? permissions.application.map(String) : [];
  const modeValue = first(parsed.mode, input.mode);
  const mode: DeployMode | null = modeValue === "AppOnly" || modeValue === "Delegated" || modeValue === "Both" ? modeValue : null;
  const mailbox = first(parsed.mailbox, input.mailbox, parsed.delegateMailbox);
  const source: "script" | "values" = scriptJson.trim() ? "script" : "values";

  if (!tenantId || !clientId) {
    throw new AppError("A Directory (tenant) ID and an Application (client) ID are both required — the secret alone is not enough to connect.", 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new AppError(`"${clientId}" is not an Application (client) ID — it should be a GUID such as 1a2b3c4d-…. The tenant may be a domain name, but the client id is always a GUID.`, 400);
  }

  const warnings: string[] = [];
  if (mode === "AppOnly" || (mode === null && applicationPermissions.includes("Mail.ReadWrite"))) {
    if (applicationPermissions.includes("Mail.Read") && !applicationPermissions.includes("Mail.ReadWrite")) {
      throw new AppError(
        "That registration was granted Mail.Read, not Mail.ReadWrite. The connector marks a message read once it has become a ticket, so it needs write — add the application permission Mail.ReadWrite with admin consent and run the wizard again.",
        400,
      );
    }
    warnings.push("Confirm the Exchange Online scoping commands were run: until they are, an app-only registration can read every mailbox in the tenant.");
  }
  if (!clientSecret && mode !== "Delegated") {
    warnings.push("No client secret was supplied. An app-only connector cannot sign in without one — create a secret in Entra and paste it, or use the delegated flow which needs none.");
  }
  if (!mailbox && (mode === "AppOnly" || mode === null)) {
    warnings.push("No mailbox was supplied. Fill in the mailbox to watch before testing the connection.");
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    mailbox,
    mode,
    displayName: first(parsed.displayName) || null,
    secretExpiry: first(parsed.secretExpiry) || null,
    source,
    warnings,
  };
}

/** Exposed for the wizard's first screen and for the harness. */
export function deploymentFacts() {
  return {
    authClientId: AUTH_CLIENT_ID,
    defaultDisplayName: DEFAULT_DISPLAY_NAME,
    permissions: {
      application: APPLICATION_PERMISSIONS,
      delegated: [...DELEGATED_PERMISSIONS, ...DELEGATED_SCOPES_CONSENTED_AT_SIGN_IN],
    },
    graphResourceAppId: GRAPH_RESOURCE_APP_ID,
    graphBase: GRAPH_BASE,
    tokenBase: TOKEN_BASE,
    secretMonths: Number(process.env.EMAIL_OAUTH_SECRET_MONTHS || 12),
  };
}
