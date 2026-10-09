import { useAuth } from "./useAuth";
import { Permission } from "@C7NTAX/shared";

/**
 * Who may see the Developer section, and who may act inside it.
 *
 * Two permissions, deliberately separate, because *looking* and *destroying* are different decisions:
 *
 * 1. **`developer:view`** decides whether the section exists for this person at all — the rail row, the
 *    tree, the palette entries and the routes. Nothing is drawn without it, and the four routes render
 *    the not-found screen rather than an empty page, so a typed URL discloses nothing.
 * 2. **`developer:purge`** decides whether the destructive controls inside it will arm. A role can be
 *    given the environment inspector and the deployment checklist without being given the purge.
 *
 * Neither is inherited by an ordinary administrator. `ROLE_PERMISSIONS` subtracts both from the **Admin**
 * blanket grant and adds them to **Super Admin** and **Developer Admin** — the break-glass role and the
 * narrow one — which is why "am I an administrator?" is not a useful question here and "do I hold the
 * permission?" is. The API gates its own routes on the same two permissions, so a hidden control and a
 * refused request are the same answer.
 *
 * There is no per-browser or per-deployment kill switch, unlike the console: the console is a surface a
 * build may ship without, whereas this one is already invisible to every role that has not been given
 * it on purpose.
 */
export function useDeveloperAccess(): { canView: boolean; canPurge: boolean } {
  const { permissions } = useAuth();
  return {
    canView: permissions.includes(Permission.DeveloperView),
    canPurge: permissions.includes(Permission.DeveloperPurge),
  };
}
