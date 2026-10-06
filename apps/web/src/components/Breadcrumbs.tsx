import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import { UI_KUMO_BREADCRUMBS } from "../lib/uiFlags";

export interface BreadcrumbSegment {
  label: string;
  /** Omit on the current page — that segment renders as text, not a link. */
  to?: string;
}

interface TrailContextValue {
  segments: BreadcrumbSegment[];
  setSegments: (segments: BreadcrumbSegment[]) => void;
}

const TrailContext = createContext<TrailContextValue | null>(null);

/** Lets a screen contribute its own trail; mounted once, around the app shell. */
export function BreadcrumbTrailProvider({ children }: { children: React.ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[]>([]);
  const value = useMemo(() => ({ segments, setSegments }), [segments]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}

/**
 * A screen's own trail, which replaces the one derived from the navigation tree
 * — for names the tree cannot know (a client, a record, a selected type). It is
 * withdrawn when the screen unmounts, so nothing leaks between pages.
 *
 * Pass null while the data is still loading.
 */
export function useBreadcrumbTrail(segments: BreadcrumbSegment[] | null) {
  const contextRef = useRef<TrailContextValue | null>(null);
  contextRef.current = useContext(TrailContext);
  const latest = useRef(segments);
  latest.current = segments;
  const key = JSON.stringify(segments ?? null);

  useEffect(() => {
    const context = contextRef.current;
    if (!context) return;
    context.setSegments(UI_KUMO_BREADCRUMBS ? latest.current ?? [] : []);
    return () => context.setSegments([]);
  }, [key]);
}

/** Home › Kumo › …rest */
export function kumoTrail(...rest: BreadcrumbSegment[]): BreadcrumbSegment[] {
  return [{ label: "Home", to: "/home" }, { label: "Kumo", to: "/kumo" }, ...rest];
}

/** Home › Kumo › Organizations › client › …rest — for a client-scoped screen. */
export function kumoClientTrail(
  clientId: string,
  clientName: string | null | undefined,
  ...rest: BreadcrumbSegment[]
): BreadcrumbSegment[] {
  return kumoTrail(
    { label: "Organizations", to: "/kumo/organizations" },
    { label: clientName || "Client", to: `/kumo/organizations/${clientId}` },
    ...rest
  );
}

export function Breadcrumbs({ segments }: { segments: BreadcrumbSegment[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  // A screen's own trail wins over the navigation tree's.
  const pageTrail = useContext(TrailContext)?.segments ?? [];
  const trail = pageTrail.length > 0 ? pageTrail : segments;

  // React Router keeps its position in history; at 0 there is nothing to return to.
  const canGoBack = typeof window !== "undefined" && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const parent = [...trail].reverse().find((seg) => seg.to && seg.to !== location.pathname);

  if (trail.length < 2) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs min-w-0" aria-label="Breadcrumb">
      <button
        type="button"
        onClick={() => {
          if (canGoBack) navigate(-1);
          else navigate(parent?.to ?? "/home");
        }}
        title={canGoBack ? "Back to the previous screen" : `Back to ${parent?.label ?? "Home"}`}
        aria-label="Back"
        className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors"
      >
        <ArrowLeft size={13} />
      </button>
      {trail.map((seg, i) => {
        const isLast = i === trail.length - 1;
        const isHome = i === 0;
        const label = isHome ? (
          <span className="flex items-center gap-1">
            <Home size={12} />
            {seg.label}
          </span>
        ) : (
          seg.label
        );
        return (
          <span key={`${seg.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <ChevronRight size={11} className="text-gray-600 shrink-0" />}
            {seg.to && !isLast ? (
              <Link to={seg.to} title={seg.label} className="transition-colors truncate max-w-[200px] text-gray-500 hover:text-white">
                {label}
              </Link>
            ) : (
              <span className="truncate max-w-[200px] text-white font-medium" aria-current={isLast ? "page" : undefined} title={seg.label}>
                {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Build breadcrumb segments from the NAV_TREE based on the current pathname.
 * The **deepest** matching node wins: matching in tree order is not enough,
 * because a section's own root ("/kumo") is a prefix of every one of its
 * children ("/kumo/passwords") and would otherwise swallow every sub-page.
 * The first segment is always "Home" linking to /home.
 */
export function buildBreadcrumbs(
  navTree: Array<{ id: string; to?: string; label: string; icon?: unknown; children?: Array<{ id: string; to?: string; label: string }> }>,
  pathname: string
): BreadcrumbSegment[] {
  const crumbs: BreadcrumbSegment[] = [{ label: "Home", to: "/home" }];

  // Home page itself — no further segments
  if (pathname === "/home") return crumbs;

  const path = pathname.replace(/\/+$/, "") || "/";
  const matches = (to?: string): boolean =>
    !!to && (path === to || path.startsWith(to.endsWith("/") ? to : `${to}/`));

  let bestSection: (typeof navTree)[number] | null = null;
  let bestChild: { id: string; to?: string; label: string } | null = null;
  let bestLength = -1;

  for (const section of navTree) {
    if (section.id === "home") continue;

    for (const child of section.children ?? []) {
      if (matches(child.to) && child.to!.length > bestLength) {
        bestSection = section;
        bestChild = child;
        bestLength = child.to!.length;
      }
    }

    if (matches(section.to) && section.to!.length > bestLength) {
      bestSection = section;
      bestChild = null;
      bestLength = section.to!.length;
    }
  }

  if (!bestSection) return crumbs;

  crumbs.push(
    bestChild
      ? { label: bestSection.label, to: `/section/${bestSection.id}` }
      : { label: bestSection.label, to: bestSection.to }
  );
  if (bestChild) crumbs.push({ label: bestChild.label, to: bestChild.to });

  return crumbs;
}
