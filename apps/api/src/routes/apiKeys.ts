/**
 * API keys — issuing, listing, rotating and revoking the credentials programs use.
 *
 * Gated on `user:manage`, the same permission that governs other people's accounts, because a key
 * *is* an account's authority in another form: issuing one can grant an outsider the ability to
 * create tickets or read billing. The secret is shown exactly once — at creation or rotation — and
 * the list never returns it, nor the hash, so a key cannot be recovered from the API afterwards;
 * losing it means rotating it, which is the property that makes rotation meaningful.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { API_KEY_SOURCES, createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "../services/apiKeys";

export const apiKeysRouter = Router();
apiKeysRouter.use(authenticate);

/** Every scope a key may be given, so a client can build a key without hard-coding the list. */
apiKeysRouter.get("/permissions", requirePermission(Permission.UserManage), (_req, res) => {
  res.json({
    permissions: Object.values(Permission).sort(),
    sources: API_KEY_SOURCES,
  });
});

apiKeysRouter.get("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const includeRevoked = String(req.query.includeRevoked || "") === "true";
    res.json({ data: await listApiKeys(includeRevoked) });
  } catch (e) { next(e); }
});

apiKeysRouter.post("/", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const issued = await createApiKey({
      name: req.body?.name,
      sourceKind: req.body?.sourceKind,
      description: req.body?.description,
      userId: req.body?.userId || req.user!.userId,
      permissions: Array.isArray(req.body?.permissions) ? req.body.permissions : [],
      expiresAt: req.body?.expiresAt ?? null,
    }, { userId: req.user!.userId, email: req.user!.email });

    await record(req, "api_key.created", issued.id, {
      name: issued.name,
      sourceKind: issued.sourceKind,
      permissions: issued.permissions,
      expiresAt: issued.expiresAt,
    });
    // The only time the secret leaves the server.
    res.status(201).json({ ...issued, warning: "This is the only time the key is shown. Store it where the client can read it, and revoke it if it is lost." });
  } catch (e) { next(e); }
});

apiKeysRouter.post("/:id/rotate", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const issued = await rotateApiKey(req.params.id!);
    await record(req, "api_key.rotated", issued.id, { name: issued.name, prefix: issued.prefix });
    res.json({ ...issued, warning: "The previous secret stopped working when this one was issued." });
  } catch (e) { next(e); }
});

/** Revoking keeps the row: the inventory is a credential history, not a list of live keys. */
apiKeysRouter.delete("/:id", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const revoked = await revokeApiKey(req.params.id!, req.body?.reason);
    await record(req, "api_key.revoked", revoked.id, { name: revoked.name, prefix: revoked.prefix, reason: req.body?.reason ?? null });
    res.json(revoked);
  } catch (e) { next(e); }
});

/** Credential changes belong in the audit trail: who issued what, and when it was taken away. */
async function record(req: AuthRequest, action: string, entityId: string, changes: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity: "api_key",
        entityId,
        changes: changes as never,
        userId: req.user!.userId,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
  } catch { /* the key was issued either way; an audit write must not fail the action it records */ }
}
