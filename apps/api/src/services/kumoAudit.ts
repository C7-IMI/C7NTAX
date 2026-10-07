/**
 * Kumo audit trail (PLAN-015 Phase B #6).
 *
 * Kumo holds shared credentials and documents, and the thing a SOC 2 auditor asks is not "what
 * does this row say" but "who changed it, when, and what did they change". Passwords already keep
 * an access log for *reveals*; this records the edits around it — created, updated, deleted,
 * revealed — for passwords and documents, with a sentence a human can read in the panel.
 */
import { prisma } from "../index";
import { logger } from "./logger";

export type KumoItemType = "password" | "document" | "asset" | "config" | "link";
export type KumoAction = "created" | "updated" | "deleted" | "revealed" | "viewed";

export interface KumoAuditEntry {
  itemType: KumoItemType;
  itemId: string;
  action: KumoAction;
  userId?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
}

/**
 * Records an entry. Auditing must never break the action it describes, so failures are logged
 * and swallowed: a password save that worked is not rolled back because the trail could not be
 * written, and the log line is what makes that visible.
 */
export async function recordKumoAudit(entry: KumoAuditEntry): Promise<void> {
  try {
    await prisma.kumoAuditLog.create({
      data: {
        itemType: entry.itemType,
        itemId: entry.itemId,
        action: entry.action,
        userId: entry.userId ?? null,
        summary: entry.summary?.slice(0, 300) ?? null,
        details: (entry.details ?? {}) as object,
      },
    });
  } catch (err) {
    logger.warn("kumo", `could not write the audit trail for ${entry.itemType} ${entry.itemId}: ${(err as Error).message}`);
  }
}

/** The trail for one item, newest first, with the acting user resolved for the panel. */
export async function kumoAuditTrail(itemType: string, itemId: string, limit = 50) {
  const entries = await prisma.kumoAuditLog.findMany({
    where: { itemType, itemId },
    orderBy: { at: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(entries.map(e => e.userId).filter((id): id is string => !!id))] } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const byId = new Map(users.map(u => [u.id, u]));
  return entries.map(entry => {
    const user = entry.userId ? byId.get(entry.userId) : undefined;
    return {
      ...entry,
      user: user ? { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email } : null,
    };
  });
}

/**
 * The field names that changed, without their values — the point is accountability, and copying
 * a credential's contents into the audit table would defeat the vault it came from.
 * Bookkeeping columns are skipped: "updatedById" and "updatedAt" change on every edit and naming
 * them would bury the fields the reader actually wants to see.
 */
const BOOKKEEPING = new Set(["id", "createdAt", "updatedAt", "createdById", "updatedById", "lastEditorId"]);

export function changedFields(before: Record<string, unknown>, update: Record<string, unknown>): string[] {
  return Object.keys(update).filter(key => {
    if (BOOKKEEPING.has(key)) return false;
    const next = update[key];
    if (next === undefined) return false;
    const previous = before[key];
    if (previous instanceof Date && next instanceof Date) return previous.getTime() !== next.getTime();
    return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
  });
}
