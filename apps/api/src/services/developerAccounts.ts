import { prisma } from "../index";
import { SystemRole } from "@C7NTAX/shared";

/**
 * Which accounts are on the developer surface, asked of the database.
 *
 * A Super Admin is the only person who may see or change the account wearing the **Developer Admin**
 * role, and "not in this list" is how every other caller's query is narrowed — so the exclusion is in
 * the query rather than a filter over a page of results, which is what keeps a `total`, a page count or
 * a `search` from counting an account the caller may not see.
 *
 * Two queries rather than one because the role is what identifies the account, and the schema does not
 * make `systemRole` unique (the seed has created two roles with the same system role before now), so
 * the ids are read rather than the name assumed.
 *
 * See `packages/shared/src/developerAccess.ts` for the rule this serves.
 */

/** The Developer Admin roles in this database — usually one. */
export async function developerRoleIds(): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: { systemRole: SystemRole.DeveloperAdmin },
    select: { id: true },
  });
  return roles.map((role) => role.id);
}

/** The accounts wearing one of them. */
export async function developerRoleUserIds(): Promise<string[]> {
  const roleIds = await developerRoleIds();
  if (roleIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { roleId: { in: roleIds } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/**
 * Their addresses.
 *
 * Needed because a sign-in row records **what was typed** rather than only an account, and a sign-in
 * event can be written with no `userId` at all — so narrowing by id alone would leave rows naming the
 * address in front of a caller who may not see the account. Compared case-insensitively, since what was
 * typed does not always match the stored capitalisation.
 */
export async function developerRoleUserEmails(): Promise<string[]> {
  const roleIds = await developerRoleIds();
  if (roleIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { roleId: { in: roleIds } },
    select: { email: true },
  });
  return users.map((user) => user.email);
}
