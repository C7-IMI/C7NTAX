/**
 * Microsoft 365 inactive-user reporting and offboarding (PLAN-015 Phase B #12).
 *
 * Twenty dormant accounts per client are twenty licences nobody is using, and the person who left
 * is usually the one whose mailbox is still enabled. The data to answer that arrives with the M365
 * sync; what these functions add is the honest reading of it and a way to act on it.
 *
 * Two rules:
 *   - an unknown last sign-in is **not** an inactive user. Azure only reports sign-in activity with
 *     Entra ID P1 and the `AuditLog.Read.All` permission, and a report that quietly counts "we do
 *     not know" as "dormant" would have an MSP disabling live accounts. The report says which of
 *     the two it is holding;
 *   - offboarding does not disable anything by itself. It raises a checklist naming the account, so
 *     the work is done deliberately and recorded, rather than a button quietly cutting off access.
 */
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import { logger } from "./logger";
import { configFlag } from "./appSettings";

export function offboardEnabled(): boolean {
  return configFlag("integrations", "m365Offboarding");
}

export const INACTIVITY_BUCKETS = [
  { id: "active", label: "Active (under 30 days)", min: 0, max: 30 },
  { id: "30_60", label: "30–60 days", min: 30, max: 60 },
  { id: "60_90", label: "60–90 days", min: 60, max: 90 },
  { id: "dormant", label: "Over 90 days", min: 90, max: null },
] as const;

export type InactivityBucketId = (typeof INACTIVITY_BUCKETS)[number]["id"] | "unknown";

/** Which bucket a last sign-in falls in. `null` is its own answer, never "dormant". */
export function bucketFor(lastSignInAt: Date | null, now = Date.now()): InactivityBucketId {
  if (!lastSignInAt) return "unknown";
  const days = (now - lastSignInAt.getTime()) / 86400000;
  if (days < 30) return "active";
  if (days < 60) return "30_60";
  if (days < 90) return "60_90";
  return "dormant";
}

export interface InactivityUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean;
  lastSignInAt: string | null;
  daysSinceSignIn: number | null;
  bucket: InactivityBucketId;
  integrationId: string;
  integrationName: string;
}

export interface InactivityClient {
  companyId: string | null;
  clientName: string;
  counts: Record<InactivityBucketId, number>;
  disabled: number;
  users: InactivityUser[];
}

export interface InactivityReport {
  generatedAt: string;
  /** Users with a sign-in timestamp, and users without one, so the reader knows what is known. */
  withSignInData: number;
  withoutSignInData: number;
  signInDataUnavailable: boolean;
  totals: Record<InactivityBucketId, number>;
  disabledAccounts: number;
  clients: InactivityClient[];
  offboardingEnabled: boolean;
  note: string;
}

/** Per-client inactivity, with dormant accounts first inside each client. */
export async function inactivityReport(now = Date.now()): Promise<InactivityReport> {
  const users = await prisma.m365User.findMany({ orderBy: { displayName: "asc" } });
  // M365User holds its integration id rather than a relation, so the names are looked up once.
  const integrationIds = [...new Set(users.map(u => u.integrationId))];
  const integrations = integrationIds.length
    ? await prisma.integration.findMany({ where: { id: { in: integrationIds } }, select: { id: true, name: true } })
    : [];
  const integrationNameById = new Map(integrations.map(i => [i.id, i.name]));
  // The client comes from the contact the sync matched, which is the only link a tenant user has
  // to a client record; a user nobody has mapped is reported as unmapped rather than attributed.
  const contactIds = [...new Set(users.map(u => u.contactId).filter((id): id is string => !!id))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, companyId: true, company: { select: { name: true } } } })
    : [];
  const contactById = new Map(contacts.map(c => [c.id, c]));

  const totals: Record<InactivityBucketId, number> = { active: 0, "30_60": 0, "60_90": 0, dormant: 0, unknown: 0 };
  const byClient = new Map<string, InactivityClient>();
  let withSignInData = 0;

  for (const user of users) {
    const bucket = bucketFor(user.lastSignInAt, now);
    totals[bucket]++;
    if (user.lastSignInAt) withSignInData++;
    const contact = user.contactId ? contactById.get(user.contactId) : undefined;
    const companyId = contact?.companyId ?? null;
    const key = companyId ?? "unmapped";
    if (!byClient.has(key)) {
      byClient.set(key, {
        companyId,
        clientName: contact?.company?.name ?? "Not mapped to a client",
        counts: { active: 0, "30_60": 0, "60_90": 0, dormant: 0, unknown: 0 },
        disabled: 0,
        users: [],
      });
    }
    const group = byClient.get(key)!;
    group.counts[bucket]++;
    if (!user.accountEnabled) group.disabled++;
    group.users.push({
      id: user.id,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      jobTitle: user.jobTitle,
      department: user.department,
      accountEnabled: user.accountEnabled,
      lastSignInAt: user.lastSignInAt ? user.lastSignInAt.toISOString() : null,
      daysSinceSignIn: user.lastSignInAt ? Math.floor((now - user.lastSignInAt.getTime()) / 86400000) : null,
      bucket,
      integrationId: user.integrationId,
      integrationName: integrationNameById.get(user.integrationId) ?? "",
    });
  }

  const order: InactivityBucketId[] = ["dormant", "unknown", "60_90", "30_60", "active"];
  for (const group of byClient.values()) {
    group.users.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || a.displayName.localeCompare(b.displayName));
  }

  const clients = [...byClient.values()].sort((a, b) => b.counts.dormant - a.counts.dormant || a.clientName.localeCompare(b.clientName));
  const signInDataUnavailable = users.length > 0 && withSignInData === 0;

  return {
    generatedAt: new Date(now).toISOString(),
    withSignInData,
    withoutSignInData: users.length - withSignInData,
    signInDataUnavailable,
    totals,
    disabledAccounts: users.filter(u => !u.accountEnabled).length,
    clients,
    offboardingEnabled: offboardEnabled(),
    note: signInDataUnavailable
      ? `No sign-in activity is stored for any of the ${users.length} synced accounts. Reading it needs Entra ID P1 and the AuditLog.Read.All permission granted to the app registration, plus a sync after that. Until then every account reads as "unknown", not as dormant.`
      : `${withoutSignInDataCount(users.length, withSignInData)} of ${users.length} synced accounts have no sign-in timestamp, and are reported as unknown rather than dormant.`,
  };
}

function withoutSignInDataCount(total: number, withData: number): number {
  return total - withData;
}

/** The standard departure, in the order it should actually be done. */
export const OFFBOARDING_TASKS = [
  "Sign the user out of all sessions (revoke refresh tokens)",
  "Reset the password and disable the account",
  "Convert the mailbox to shared and grant access to the manager",
  "Remove Microsoft 365 licences and reclaim them",
  "Transfer OneDrive contents to the manager",
  "Check group memberships and remove the account from any distribution lists",
  "Reassign open tickets and update the client contact record",
  "Document the departure date and who authorised it in the client file",
];

export interface OffboardResult {
  checklistId: string;
  name: string;
  tasks: number;
  clientName: string;
  user: { id: string; displayName: string; userPrincipalName: string };
}

/**
 * Raises an offboarding checklist for a synced account. The checklist is the output because the
 * work is risky, benefits from being done in order and by a person, and should leave a record.
 */
export async function offboardUser(m365UserId: string, actorId: string, options: { assignToId?: string; dueDate?: Date } = {}): Promise<OffboardResult> {
  if (!offboardEnabled()) throw new AppError("M365 offboarding is switched off", 404);

  const user = await prisma.m365User.findUnique({ where: { id: m365UserId } });
  if (!user) throw new AppError("Synced user not found", 404);
  const integration = await prisma.integration.findUnique({ where: { id: user.integrationId }, select: { name: true } });

  const contact = user.contactId
    ? await prisma.contact.findUnique({ where: { id: user.contactId }, select: { companyId: true, company: { select: { name: true } } } })
    : null;
  if (!contact?.companyId) {
    throw new AppError("This account is not mapped to a client, so there is nowhere to file the checklist", 409);
  }

  const existing = await prisma.checklist.findFirst({
    where: { companyId: contact.companyId, name: { contains: user.userPrincipalName } },
    select: { id: true, name: true },
  });
  if (existing) throw new AppError(`An offboarding checklist already exists for ${user.userPrincipalName}`, 409);

  const name = `M365 offboarding — ${user.displayName} (${user.userPrincipalName})`;
  const checklist = await prisma.checklist.create({
    data: {
      name,
      description: `Raised from the synced Microsoft 365 directory${integration?.name ? ` (${integration.name})` : ""}. Last sign-in: ${user.lastSignInAt ? user.lastSignInAt.toISOString().slice(0, 10) : "not recorded"}.`,
      companyId: contact.companyId,
      assignedToId: options.assignToId ?? null,
      dueDate: options.dueDate ?? null,
      createdById: actorId,
      tasks: { create: OFFBOARDING_TASKS.map((title, index) => ({ title, position: index })) },
    },
    select: { id: true, name: true, _count: { select: { tasks: true } } },
  });

  logger.info("m365", `Offboarding checklist raised for ${user.userPrincipalName} (${contact.company?.name ?? "client"})`);
  return {
    checklistId: checklist.id,
    name: checklist.name,
    tasks: checklist._count.tasks,
    clientName: contact.company?.name ?? "",
    user: { id: user.id, displayName: user.displayName, userPrincipalName: user.userPrincipalName },
  };
}
