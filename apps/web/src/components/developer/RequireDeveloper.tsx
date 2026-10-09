import type { ReactNode } from "react";
import { useDeveloperAccess } from "../../hooks/useDeveloperAccess";
import { NotFoundPage } from "../../pages/NotFound";

/**
 * The route gate for anything under `/developer`.
 *
 * It renders the **not-found** screen for a person who does not hold `developer:view`, rather than a
 * "you do not have permission" message, and that is the point: the section is hidden, not refused. A
 * page that says "you may not see this" has told somebody the page exists, which is exactly what the
 * navigation refused to say by not drawing the row. It also means there is one screen to maintain for
 * "there is nothing here", which is what a mistyped URL already gets.
 */
export function RequireDeveloper({ children }: { children: ReactNode }) {
  const { canView } = useDeveloperAccess();
  if (!canView) return <NotFoundPage />;
  return <>{children}</>;
}
