/**
 * Company scoping.
 *
 * The convention this follows is the one already used for tickets in
 * `routes/tickets/index.ts`: a user carrying no `companyId` is internal staff and sees
 * everything, while a user carrying one is scoped to that company. Rows that belong to
 * no company (or to a company the user cannot see) are simply not returned.
 *
 * Two shapes are provided on purpose:
 *  - `companyWhere` for list/count/aggregate queries, merged into the `where`
 *  - `canAccessCompany` for a single record already loaded, so detail and write routes
 *    can answer 404 rather than 403 (an id that exists but is not yours should not be
 *    distinguishable from an id that does not exist)
 *
 * Not yet applied to every router — see PLAN-018 Phase 0 status. Applied to clients,
 * contacts, billing and reports first because those are the endpoints a client-scoped
 * account can use to enumerate other companies' records.
 */
import type { AuthUser } from "./auth";

/** True when the account is not restricted to a single company. */
export function isUnscoped(user?: AuthUser): boolean {
  return !user || !user.companyId;
}

/**
 * Merge into a Prisma `where`. Returns `{}` for internal staff so the query is
 * unchanged, or `{ companyId }` for a company-scoped account. Typed as an optional
 * property (rather than an index signature) so it is assignable to every Prisma
 * `WhereInput` that has a companyId.
 */
export function companyWhere(user?: AuthUser): { companyId?: string } {
  if (isUnscoped(user)) return {};
  return { companyId: user!.companyId as string };
}

/** Narrows to the company of the related ticket — for models (time entries) that have no companyId. */
export function ticketCompanyWhere(user?: AuthUser): Record<string, unknown> {
  if (isUnscoped(user)) return {};
  return { ticket: { companyId: user!.companyId as string } };
}

/** Guard for a single record: internal staff pass, a scoped account must match. */
export function canAccessCompany(user: AuthUser | undefined, rowCompanyId: string | null | undefined): boolean {
  if (isUnscoped(user)) return true;
  return !!rowCompanyId && rowCompanyId === user!.companyId;
}
