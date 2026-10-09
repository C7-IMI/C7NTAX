import { useAuth } from "./useAuth";
import { isSuperAdminRole } from "@C7NTAX/shared";

/**
 * Whether the signed-in caller is a Super Admin — the only person who may see or set the Developer
 * Admin role and the `developer:*` permissions. The rule and the wording live in
 * `packages/shared/src/developerAccess.ts`; the API enforces the same three refusals, so a control
 * this hook hides is a request the API would have answered `Refused: …` to.
 *
 * It asks the question as a **role**, not as a permission, and that is deliberate: every
 * administrator holds `role:manage`, so a permission test could not tell a Super Admin from an Admin,
 * and the Developer Admin holds every permission yet is not allowed to administer its own role.
 */
export function useSuperAdmin(): boolean {
  const { user } = useAuth();
  const role = user?.role;
  return isSuperAdminRole(typeof role === "string" ? role : role?.systemRole);
}
