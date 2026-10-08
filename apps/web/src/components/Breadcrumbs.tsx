import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { STANDALONE_PAGE_TITLES } from "../lib/pageTitles";

export interface BreadcrumbSegment {
  label: string;
  to: string; // Always defined — every segment is clickable
}

/**
 * A segment of Kumo's own trail. The last one is the page you are on, so it
 * carries no link.
 */
export interface TrailSegment {
  label: string;
  to?: string;
}

/**
 * The global, app-wide trail in the header. Unchanged in behaviour: it is built
 * from the navigation tree alone, with no back button and no page-supplied
 * segments — Kumo has its own trail for that (see KumoTrail.tsx).
 */
export function Breadcrumbs({ segments }: { segments: BreadcrumbSegment[] }) {
  if (segments.length < 2) return null;

  return (
    <nav className="flex items-center gap-1.5 text-xs" aria-label="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={11} className="text-gray-600 shrink-0" />}
            <Link
              to={seg.to}
              className={`transition-colors truncate max-w-[200px] ${
                isLast
                  ? "text-white font-medium hover:text-cyber-400"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              {i === 0 ? (
                <span className="flex items-center gap-1">
                  <Home size={12} />
                  {seg.label}
                </span>
              ) : (
                seg.label
              )}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Kumo's own trail: what a Kumo screen registers, plus the helpers for it.
//  Consumed by KumoTrail.tsx, never by the global trail above.
// ─────────────────────────────────────────────────────────────────────

interface TrailContextValue {
  segments: TrailSegment[];
  setSegments: (segments: TrailSegment[]) => void;
}

const TrailContext = createContext<TrailContextValue | null>(null);

/** Holds what the current screen registered; mounted once, around the app shell. */
export function BreadcrumbTrailProvider({ children }: { children: React.ReactNode }) {
  const [segments, setSegments] = useState<TrailSegment[]>([]);
  const value = useMemo(() => ({ segments, setSegments }), [segments]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}

/**
 * A screen's own trail, for names the navigation tree cannot know (a client, a
 * record, a selected type, an active filter). It is withdrawn when the screen
 * unmounts, so nothing leaks between pages.
 *
 * Must be called on every render — pass null while the data is still loading.
 */
export function useBreadcrumbTrail(segments: TrailSegment[] | null) {
  const contextRef = useRef<TrailContextValue | null>(null);
  contextRef.current = useContext(TrailContext);
  const latest = useRef(segments);
  latest.current = segments;
  const key = JSON.stringify(segments ?? null);

  useEffect(() => {
    const context = contextRef.current;
    if (!context) return;
    context.setSegments(latest.current ?? []);
    return () => context.setSegments([]);
  }, [key]);
}

/** What the current screen registered, for Kumo's trail bar. */
export function useRegisteredTrail(): TrailSegment[] {
  return useContext(TrailContext)?.segments ?? [];
}

/** Home › Kumo › …rest */
export function kumoTrail(...rest: TrailSegment[]): TrailSegment[] {
  return [{ label: "Home", to: "/home" }, { label: "Kumo", to: "/kumo" }, ...rest];
}

/** Home › Kumo › Organizations › client › …rest — for a client-scoped screen. */
export function kumoClientTrail(
  clientId: string,
  clientName: string | null | undefined,
  ...rest: TrailSegment[]
): TrailSegment[] {
  return kumoTrail(
    { label: "Organizations", to: "/kumo/organizations" },
    { label: clientName || "Client", to: `/kumo/organizations/${clientId}` },
    ...rest
  );
}

/**
 * Organizations › client › …rest — the same trail without Kumo's own root, for
 * a screen outside Kumo that an organization opened (its contacts, its tickets).
 * Those modules carry their own trail in the header already; this adds the
 * client the header cannot know.
 */
export function orgTrail(
  clientId: string,
  clientName: string | null | undefined,
  ...rest: TrailSegment[]
): TrailSegment[] {
  return [
    { label: "Organizations", to: "/kumo/organizations" },
    { label: clientName || "Client", to: `/kumo/organizations/${clientId}` },
    ...rest,
  ];
}

/**
 * Build breadcrumb segments from the NAV_TREE based on the current pathname.
 * The **deepest** matching node wins: matching in tree order is not enough,
 * because a section's own root ("/kumo") is a prefix of every one of its
 * children ("/kumo/passwords") and would otherwise claim every sub-page.
 * The first segment is always "Home" linking to /home.
 *
 * Two paths are handled outside the tree, because the tree cannot describe them:
 *
 * - **`/` is the Dashboard's own row and matches nothing else.** A bare `startsWith("/")` is true of
 *   every path in the application, so before this the Dashboard node quietly claimed every page with no
 *   row of its own — the header console, Settings, My activity — and each of them read "Home › Dashboard".
 * - **A page with no row anywhere gets its name from `STANDALONE_PAGE_TITLES`**, so a visit recorded
 *   against it (the Recent menu stores the trail's words) says "Console" rather than "Dashboard".
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
    !!to &&
    (path === to ||
      (to !== "/" && path.startsWith(to.endsWith("/") ? to : `${to}/`)));

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

  if (!bestSection) {
    const standalone = STANDALONE_PAGE_TITLES[path];
    if (standalone) crumbs.push({ label: standalone, to: path });
    return crumbs;
  }

  const sectionTo = bestSection.to;
  if (!bestChild && !sectionTo) return crumbs;

  crumbs.push(
    bestChild
      ? { label: bestSection.label, to: `/section/${bestSection.id}` }
      : { label: bestSection.label, to: sectionTo! }
  );
  if (bestChild) crumbs.push({ label: bestChild.label, to: bestChild.to! });

  return crumbs;
}
