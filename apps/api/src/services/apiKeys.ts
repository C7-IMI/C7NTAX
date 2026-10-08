/**
 * API keys — credentials for programs rather than people.
 *
 * A PSA has to be reachable by things that cannot hold a cookie: an RMM raising an alert, a SIEM
 * reporting a detection, a scheduled job pulling an accounting sync. Password sign-in is the wrong
 * shape for all of them — it needs a human, it hands out the *account's* whole authority, and it
 * cannot be revoked without locking a person out.
 *
 * A key therefore:
 *   · belongs to an account (`userId`) and **acts as it**, narrowed to `permissions`. Writes are
 *     attributed to a real user, so the audit trail and every `createdById` column still mean
 *     something, and the key can never do more than the person who issued it (the scopes are
 *     intersected with the owner's permissions on every request, so a role change takes effect at
 *     once);
 *   · carries its own scopes, which is how "may create tickets" is separated from "may read billing";
 *   · is stored as a SHA-256 of the secret half only — the presented key is looked up by its clear
 *     prefix, and the secret is compared in constant time, so a database copy yields no usable key;
 *   · records when it was last used, how often, and from where, because an unused credential is one
 *     that should be revoked;
 *   · can expire, can be rotated, and is revoked rather than deleted so the inventory keeps its history.
 *
 * Signing in with a password is unchanged. This is a second way to present an identity, and it ends
 * at the same place: `req.user`, with permissions, in `middleware/auth.ts`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import type { Permission, SystemRole } from "@C7NTAX/shared";

/** The prefix every key starts with, so a bearer token can be told apart from a JWT. */
export const API_KEY_PREFIX = "c7k_";

/** What a key is for, recorded for the inventory rather than enforced. */
export const API_KEY_SOURCES = ["rmm", "siem", "flexpoint", "quickbooks", "monitoring", "scheduler", "other"] as const;
export type ApiKeySource = typeof API_KEY_SOURCES[number];

export interface ApiKeyOwner {
  id: string;
  email: string;
  companyId: string | null;
  tokenVersion: number;
  isActive: boolean;
  role: SystemRole;
  rolePermissions: string[];
  userPermissions: string[];
}

export interface VerifiedApiKey {
  key: {
    id: string;
    name: string;
    prefix: string;
    sourceKind: string;
    permissions: string[];
    expiresAt: Date | null;
  };
  owner: ApiKeyOwner;
}

export interface IssuedApiKey {
  id: string;
  name: string;
  prefix: string;
  /** The full key. Returned once, at creation or rotation, and never retrievable again. */
  key: string;
  sourceKind: string;
  permissions: string[];
  expiresAt: Date | null;
}

const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** A bearer token with this shape is an API key, not a session token. */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

function mint(): { prefix: string; secret: string; key: string } {
  const prefix = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { prefix, secret, key: `${API_KEY_PREFIX}${prefix}.${secret}` };
}

function split(presented: string): { prefix: string; secret: string } | null {
  if (!looksLikeApiKey(presented)) return null;
  const body = presented.slice(API_KEY_PREFIX.length);
  const separator = body.indexOf(".");
  if (separator <= 0) return null;
  const prefix = body.slice(0, separator);
  const secret = body.slice(separator + 1);
  if (!/^[0-9a-f]{8,64}$/.test(prefix) || secret.length < 16) return null;
  return { prefix, secret };
}

/**
 * Issue a key. The scopes are validated against the permission names the application actually has,
 * because a key that asks for a permission nobody holds is a key that silently does nothing.
 */
export async function createApiKey(input: {
  name: string;
  sourceKind?: string;
  description?: string;
  userId: string;
  permissions: string[];
  expiresAt?: string | null;
}, actor: { userId: string; email: string }): Promise<IssuedApiKey> {
  const name = String(input.name || "").trim();
  if (!name) throw new AppError("name is required — a key with no name cannot be found in the inventory", 400);

  const permissions = [...new Set((input.permissions || []).map(p => String(p).trim()).filter(Boolean))];
  if (permissions.length === 0) throw new AppError("permissions must name at least one scope the key may use", 400);

  const owner = await prisma.user.findUnique({
    where: { id: input.userId || actor.userId },
    select: { id: true, isActive: true, email: true },
  });
  if (!owner) throw new AppError("Unknown account for the key", 400);
  if (owner.isActive === false) throw new AppError("That account is deactivated, so a key issued to it could not be used", 400);

  const sourceKind = API_KEY_SOURCES.includes(input.sourceKind as ApiKeySource) ? String(input.sourceKind) : "other";
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new AppError("expiresAt must be an ISO date", 400);
    if (parsed.getTime() <= Date.now()) throw new AppError("expiresAt must be in the future", 400);
    expiresAt = parsed;
  }

  const { prefix, secret, key } = mint();
  const row = await prisma.apiKey.create({
    data: {
      name: name.slice(0, 120),
      prefix,
      hash: hashSecret(secret),
      sourceKind,
      description: input.description ? String(input.description).slice(0, 400) : null,
      userId: owner.id,
      createdById: actor.userId,
      createdByEmail: actor.email,
      permissions,
      expiresAt,
    },
    select: { id: true, name: true, prefix: true, sourceKind: true, permissions: true, expiresAt: true },
  });

  return { ...row, key, permissions: row.permissions };
}

/**
 * Verify a presented key and answer with the identity it acts as.
 *
 * The owner's own permissions are returned unresolved (`rolePermissions` + `userPermissions`) so the
 * middleware, which already knows how to combine them, does the intersection with the key's scopes —
 * one place that decides what a permission list means.
 */
export async function verifyApiKey(presented: string, ip?: string): Promise<VerifiedApiKey | null> {
  const parts = split(presented);
  if (!parts) return null;

  const row = await prisma.apiKey.findUnique({
    where: { prefix: parts.prefix },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          companyId: true,
          isActive: true,
          tokenVersion: true,
          permissions: true,
          role: { select: { systemRole: true, permissions: true } },
        },
      },
    },
  });
  if (!row) return null;

  const presentedHash = Buffer.from(hashSecret(parts.secret), "hex");
  const storedHash = Buffer.from(row.hash, "hex");
  if (presentedHash.length !== storedHash.length || !timingSafeEqual(presentedHash, storedHash)) return null;

  // Revoked, expired and deactivated all mean the same thing to a caller: not usable.
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (row.user.isActive === false) return null;
  // Usage is recorded, not awaited: a failed write must never fail the request it describes.
  void prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date(), lastUsedIp: ip ? ip.slice(0, 64) : null, requestCount: { increment: 1 } },
  }).catch(() => { /* the request is already served */ });

  return {
    key: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      sourceKind: row.sourceKind,
      permissions: row.permissions,
      expiresAt: row.expiresAt,
    },
    owner: {
      id: row.user.id,
      email: row.user.email,
      companyId: row.user.companyId ?? null,
      tokenVersion: row.user.tokenVersion,
      isActive: row.user.isActive,
      role: row.user.role.systemRole as SystemRole,
      rolePermissions: (row.user.role.permissions || []) as string[],
      userPermissions: (row.user.permissions || []) as string[],
    },
  };
}

/** What the inventory shows. Never the hash, never the secret, never the full key. */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  sourceKind: string;
  description: string | null;
  permissions: string[];
  owner: { id: string; email: string };
  createdByEmail: string | null;
  requestCount: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  state: "active" | "revoked" | "expired";
}

/** The state a caller cares about, derived rather than stored, so it cannot go stale. */
export function keyState(row: { revokedAt: Date | null; expiresAt: Date | null }): ApiKeySummary["state"] {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

export function summarise(row: {
  id: string; name: string; prefix: string; sourceKind: string; description: string | null;
  permissions: string[]; createdByEmail: string | null; requestCount: number;
  lastUsedAt: Date | null; lastUsedIp: string | null; expiresAt: Date | null;
  revokedAt: Date | null; createdAt: Date; user: { id: string; email: string };
}): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: `${API_KEY_PREFIX}${row.prefix}`,
    sourceKind: row.sourceKind,
    description: row.description,
    permissions: row.permissions,
    owner: { id: row.user.id, email: row.user.email },
    createdByEmail: row.createdByEmail,
    requestCount: row.requestCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: row.lastUsedIp,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    state: keyState(row),
  };
}

export interface ApiKeyRowShape {
  id: string; name: string; prefix: string; sourceKind: string; description: string | null;
  permissions: string[]; createdByEmail: string | null; requestCount: number;
  lastUsedAt: Date | null; lastUsedIp: string | null; expiresAt: Date | null;
  revokedAt: Date | null; createdAt: Date; user: { id: string; email: string };
}

export const API_KEY_SELECT = {
  id: true, name: true, prefix: true, sourceKind: true, description: true, permissions: true,
  createdByEmail: true, requestCount: true, lastUsedAt: true, lastUsedIp: true,
  expiresAt: true, revokedAt: true, createdAt: true,
  user: { select: { id: true, email: true } },
} as const;

export async function listApiKeys(includeRevoked = false): Promise<ApiKeySummary[]> {
  const rows = await prisma.apiKey.findMany({
    where: includeRevoked ? {} : { revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: API_KEY_SELECT,
  });
  return rows.map(row => summarise(row as ApiKeyRowShape));
}

/** Revoke rather than delete: the inventory is a credential history, not a list of live keys. */
export async function revokeApiKey(id: string, reason?: string): Promise<ApiKeySummary> {
  const existing = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, revokedAt: true, description: true } });
  if (!existing) throw new AppError("Unknown API key", 404);
  if (existing.revokedAt) throw new AppError("That key is already revoked", 409);
  const note = reason ? `Revoked: ${String(reason).slice(0, 200)}` : null;
  const row = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date(), ...(note ? { description: [existing.description, note].filter(Boolean).join(" · ") } : {}) },
    select: API_KEY_SELECT,
  });
  return summarise(row as ApiKeyRowShape);
}

/** A new secret for the same key: the scopes, owner and name stay, the old secret stops working. */
export async function rotateApiKey(id: string): Promise<IssuedApiKey> {
  const existing = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, revokedAt: true, name: true, sourceKind: true, permissions: true, expiresAt: true, userId: true } });
  if (!existing) throw new AppError("Unknown API key", 404);
  if (existing.revokedAt) throw new AppError("That key is revoked — issue a new one instead of rotating it", 409);

  const { prefix, secret, key } = mint();
  const row = await prisma.apiKey.update({
    where: { id },
    data: { prefix, hash: hashSecret(secret), lastUsedAt: null, lastUsedIp: null, requestCount: 0 },
    select: { id: true, name: true, prefix: true, sourceKind: true, permissions: true, expiresAt: true },
  });
  return { ...row, key, permissions: row.permissions };
}

/** The scopes a key may be given: every permission the application defines. */
export function assignablePermissions(all: string[]): string[] {
  return [...all].sort();
}

/** Type-only re-export so callers can name the permission type without reaching into shared. */
export type { Permission };
