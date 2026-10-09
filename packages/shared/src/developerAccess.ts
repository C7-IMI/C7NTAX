import { Permission, SystemRole } from "./enums";

/**
 * The rule for the **Developer Admin** role, the two permissions it holds, and the accounts wearing it:
 * *only a Super Admin may see any of them, and only a Super Admin may set any of them.*
 *
 * `developer:view` and `developer:purge` are the only permissions whose worst case is removing the
 * instance's contents, and `Developer Admin` is the one role that holds them away from Super Admin.
 * Everything else in the permission list widens what somebody may do inside the application; these
 * decide whether the application keeps its contents at all. So the API refuses the same four things
 * that the interface declines to draw, to everybody who is not a Super Admin:
 *
 *   1. listing the role, or any `developer:*` key, to anybody else;
 *   2. creating or editing a role with those keys in it, or editing the Developer Admin role;
 *   3. moving a person onto the Developer Admin role, or granting them `developer:*` one at a time;
 *   4. seeing or changing the **account** that wears it — not in Manage Users, not in a picker, not in
 *      an export, and not through an edit of any kind.
 *
 * Two roles hold the developer surface: **Super Admin**, which holds everything because it is the
 * break-glass role, and **Developer Admin**, which is the named hat for it. Admin holds everything
 * except these two keys. A Developer Admin is deliberately **not** a Super Admin for this purpose: it
 * holds `role:manage`, so the ordinary route guards would let it administer its own role — and a role
 * that can widen itself is not a role. Role administration therefore stays with Super Admin even for
 * the person wearing the developer hat.
 *
 * The predicates live here rather than in either application so that the sentence a person is shown in
 * the interface is the sentence the API would have answered with.
 */

/** The keys only Developer Admin holds, named once so a subtraction and an addition cannot drift. */
export const DEVELOPER_PERMISSION_KEYS: string[] = [Permission.DeveloperView, Permission.DeveloperPurge];

/** The one sentence every refusal and every locked control uses, so the two cannot disagree. */
export const DEVELOPER_ROLE_REFUSAL =
  "Only a Super Admin may see or set the Developer Admin role and the developer permissions.";

/**
 * The refusal for acting on **the account itself** — the person wearing the Developer Admin role.
 *
 * A separate sentence from `DEVELOPER_ROLE_REFUSAL` because the two refusals are different questions:
 * one is about the role and its two permissions, the other is about seeing or changing a person. Both
 * are answered by the API and shown in the interface in these words.
 */
export const DEVELOPER_ACCOUNT_REFUSAL =
  "Only a Super Admin may see or change an account on the Developer Admin role.";

/** `role.systemRole === "super_admin"` — the only caller who may see or set any of the above. */
export function isSuperAdminRole(systemRole: string | null | undefined): boolean {
  return systemRole === SystemRole.SuperAdmin;
}

/** The Developer Admin system role itself, which only a Super Admin may name. */
export function isDeveloperRole(systemRole: string | null | undefined): boolean {
  return systemRole === SystemRole.DeveloperAdmin;
}

/**
 * Whether a loaded account wears the Developer Admin role, for the routes that must not show or touch
 * one. It takes the record with its relation loaded (`include: { role: true }`), so the question is
 * asked of the database's answer rather than of anything the caller sent.
 */
export function wearsDeveloperRole(user: { role?: { systemRole?: string | null } | null } | null | undefined): boolean {
  return isDeveloperRole(user?.role?.systemRole);
}

/** The `developer:*` keys present in a submitted list, so a refusal can name what it refused. */
export function developerPermissionsIn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && DEVELOPER_PERMISSION_KEYS.includes(entry));
}

/** The same list with those keys removed, for a caller who may not be told they are there. */
export function withoutDeveloperPermissions(permissions: readonly string[] | null | undefined): string[] {
  return (permissions ?? []).filter(permission => !DEVELOPER_PERMISSION_KEYS.includes(permission));
}

/**
 * The refusal, with the offending role or permission **named** so the answer is diagnosable rather
 * than a flat "forbidden" — the caller is told which key they may not touch, and why.
 */
export function developerRefusalMessage(offending: readonly string[]): string {
  return `Refused: ${[...new Set(offending)].join(", ")}. ${DEVELOPER_ROLE_REFUSAL}`;
}

/** The same, for an action aimed at a person who wears the role rather than at the role itself. */
export function developerAccountRefusalMessage(name: string): string {
  return `Refused: ${name}. ${DEVELOPER_ACCOUNT_REFUSAL}`;
}
