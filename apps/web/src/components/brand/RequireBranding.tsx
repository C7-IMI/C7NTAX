import type { ReactNode } from "react";
import { Permission } from "@C7NTAX/shared";
import { useAuth } from "../../hooks/useAuth";
import { NotFoundPage } from "../../pages/NotFound";

/**
 * The route gate for anything under `/admin/branding`.
 *
 * It renders the **not-found** screen for a person who does not hold `branding:view`, rather than a
 * "you do not have permission" message, and for the reason `RequireDeveloper` does: a page that says
 * "you may not see this" has told somebody the page exists, which is what the navigation already
 * declined to say by not drawing the row. It also keeps one screen for "there is nothing here", which
 * is what a mistyped URL gets anyway.
 *
 * Branding is not a Developer capability — an ordinary administrator is expected to be able to set the
 * company's own logo — so this gate is about `branding:view` alone.
 */
export function RequireBranding({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  if (!permissions.includes(Permission.BrandingView)) return <NotFoundPage />;
  return <>{children}</>;
}
