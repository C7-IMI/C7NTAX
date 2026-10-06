import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import { UI_KUMO_BREADCRUMBS } from "../lib/uiFlags";
import { useRegisteredTrail, type TrailSegment } from "./Breadcrumbs";

/**
 * Kumo's own trail, shown at the top of the Kumo content area — separate from
 * the global trail in the header, which stays exactly as it was.
 *
 * A Kumo screen can name what the navigation tree cannot (its client, a record,
 * the type the rail has open) by calling `useBreadcrumbTrail`; screens that do
 * not simply fall back to the trail derived from the navigation tree.
 */
export function KumoTrail({ segments }: { segments: TrailSegment[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const registered = useRegisteredTrail();
  const trail = registered.length > 0 ? registered : segments;

  // Kumo only — never shown on another module's screens.
  const inKumo =
    location.pathname === "/kumo" ||
    location.pathname.startsWith("/kumo/") ||
    location.pathname === "/section/kumo";

  // React Router keeps its position in history; at 0 there is nothing to return to.
  const canGoBack = typeof window !== "undefined" && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const parent = [...trail].reverse().find((seg) => seg.to && seg.to !== location.pathname);

  if (!UI_KUMO_BREADCRUMBS || !inKumo || trail.length < 2) return null;

  return (
    <nav aria-label="Kumo breadcrumb" className="flex items-center gap-1 min-w-0 text-sm mb-4">
      <button
        type="button"
        onClick={() => {
          if (canGoBack) navigate(-1);
          else navigate(parent?.to ?? "/kumo");
        }}
        title={canGoBack ? "Back to the previous screen" : `Back to ${parent?.label ?? "Kumo"}`}
        aria-label="Back"
        className="shrink-0 w-7 h-7 grid place-items-center rounded-lg text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors"
      >
        <ArrowLeft size={15} />
      </button>
      <ol className="flex items-center gap-1 min-w-0 flex-wrap">
        {trail.map((seg, i) => {
          const isLast = i === trail.length - 1;
          const label =
            i === 0 ? (
              <span className="flex items-center gap-1">
                <Home size={12} />
                {seg.label}
              </span>
            ) : (
              seg.label
            );
          return (
            <li key={`${seg.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 && <ChevronRight size={12} className="text-gray-600 shrink-0" />}
              {seg.to && !isLast ? (
                <Link
                  to={seg.to}
                  title={seg.label}
                  className="text-gray-500 hover:text-cyber-300 truncate max-w-[18rem] transition-colors"
                >
                  {label}
                </Link>
              ) : (
                <span
                  className="text-gray-400 truncate max-w-[20rem]"
                  aria-current={isLast ? "page" : undefined}
                  title={seg.label}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
