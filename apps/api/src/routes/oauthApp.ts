/**
 * The API behind the "Deploy OAuth app" wizard in the Microsoft 365 email connector.
 *
 * The wizard does three things a person would otherwise do by hand, in the order that stops the
 * "why can't it sign in" week:
 *
 *   1. **Sign in** — a device code the administrator approves in their own browser, so this
 *      application never holds a credential for their tenant. `POST /start` → `POST /:id/poll`.
 *   2. **Build or reuse the registration** — the same sequence as `O365/New-C7NTAXMailboxApp.ps1`,
 *      including admin consent, the client secret, and the Exchange Online commands that scope an
 *      app-only registration to one mailbox. `POST /:id/deploy`.
 *   3. **Or take the script's output** — `POST /import` accepts the JSON the script writes, which is
 *      the path for a tenant where this instance cannot reach the Microsoft sign-in endpoint.
 *
 * Everything is gated on `integration:manage`, the permission that already governs the connector
 * this configures, and each deployment or import writes an audit row — issuing a credential is the
 * kind of act that belongs in that trail.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { deployApplication, deploymentFacts, deploymentState, importCredentials, pollDeployment, startDeployment } from "../services/oauthAppDeploy";
import { oauthRedirectUri } from "./email-connectors";

export const oauthAppRouter = Router();
oauthAppRouter.use(authenticate);

/** The command that produces the same result by hand, for anyone who would rather see it. */
function scriptTemplate(redirectUri: string): { file: string; command: string; delegatedCommand: string } {
  const file = "O365/New-C7NTAXMailboxApp.ps1";
  return {
    file,
    command: `pwsh -File ${file} -TenantId <tenant> -DelegateMailbox <mailbox>`,
    delegatedCommand: `pwsh -File ${file} -TenantId <tenant> -Mode Delegated -RedirectUri ${redirectUri}`,
  };
}

/**
 * What the wizard needs before it shows anything: the permissions it will request, the redirect URI
 * this instance must be registered with, and the by-hand equivalents.
 */
oauthAppRouter.get("/", requirePermission(Permission.IntegrationManage), (req: AuthRequest, res) => {
  const redirectUri = oauthRedirectUri(req);
  res.json({
    ...deploymentFacts(),
    redirectUri,
    script: scriptTemplate(redirectUri),
  });
});

/** Start a sign-in: a code the administrator approves in their browser. */
oauthAppRouter.post("/start", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, string>;
    const started = await startDeployment({
      tenant: String(body.tenant ?? ""),
      mode: body.mode === "Delegated" || body.mode === "Both" ? body.mode : "AppOnly",
      displayName: body.displayName,
      mailbox: body.mailbox,
      // The delegated flow has to be registered against the URI this instance actually answers on;
      // a caller may override it, which is what a host behind a proxy would do.
      redirectUri: body.redirectUri || oauthRedirectUri(req),
      actorEmail: req.user?.email ?? undefined,
    });
    res.status(201).json(started);
  } catch (e) { next(e); }
});

/** Where a deployment got to, without contacting Microsoft. */
oauthAppRouter.get("/:sessionId", requirePermission(Permission.IntegrationManage), (req: AuthRequest, res, next) => {
  try {
    res.json(deploymentState(String(req.params.sessionId)));
  } catch (e) { next(e); }
});

/** Has the administrator approved the sign-in yet? */
oauthAppRouter.post("/:sessionId/poll", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    res.json(await pollDeployment(String(req.params.sessionId)));
  } catch (e) { next(e); }
});

/** Create or reuse the registration, grant consent, mint the secret. */
oauthAppRouter.post("/:sessionId/deploy", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const result = await deployApplication(String(req.params.sessionId));
    await audit(req, "oauth_app.deployed", result.objectId, {
      displayName: result.displayName,
      clientId: result.clientId,
      tenantId: result.tenantId,
      mode: result.mode,
      reusedRegistration: result.reusedRegistration,
      permissions: result.permissions,
      mailbox: result.mailbox || null,
      secretExpiry: result.secretExpiry,
      account: result.account,
    });
    // The secret is returned once, in this response. It is never stored by this API, and the audit
    // row deliberately records the expiry rather than the value.
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** The script's output, or the four values by hand — the offline path through the wizard. */
oauthAppRouter.post("/import", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const imported = importCredentials((req.body ?? {}) as Record<string, unknown>);
    await audit(req, "oauth_app.imported", imported.clientId, {
      tenantId: imported.tenantId,
      clientId: imported.clientId,
      mode: imported.mode,
      source: imported.source,
      mailbox: imported.mailbox || null,
      hasSecret: Boolean(imported.clientSecret),
      secretExpiry: imported.secretExpiry,
    });
    res.json(imported);
  } catch (e) { next(e); }
});

/** Issuing a credential belongs in the trail: who deployed what, for which tenant. */
async function audit(req: AuthRequest, action: string, entityId: string, changes: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity: "oauth_app",
        entityId,
        changes: changes as never,
        userId: req.user!.userId,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
  } catch { /* the deployment happened either way; an audit write must not fail the thing it records */ }
}
