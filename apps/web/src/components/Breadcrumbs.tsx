import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  to: string;  // Always defined — every segment is clickable
}

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

/**
 * Build breadcrumb segments from the NAV_TREE based on the current pathname.
 * Every nav node matching the current path becomes a clickable segment.
 * The first segment is always "Home" linking to /home.
 */
export function buildBreadcrumbs(
  navTree: Array<{ id: string; to?: string; label: string; icon?: unknown; children?: Array<{ id: string; to?: string; label: string }> }>,
  pathname: string
): BreadcrumbSegment[] {
  const crumbs: BreadcrumbSegment[] = [];

  // Always start with Home
  crumbs.push({ label: "Home", to: "/home" });

  // Home page itself — no further segments
  if (pathname === "/home") return crumbs;

  // Find the deepest matching node
  for (const section of navTree) {
    // Skip the "home" nav node itself when building breadcrumbs
    if (section.id === "home") continue;

    // Direct match on Dashboard / first-level pages
    if (section.to && pathname === section.to) {
      crumbs.push({ label: section.label, to: section.to });
      return crumbs;
    }

    if (section.children) {
      for (const child of section.children) {
        if (child.to && (pathname === child.to || pathname.startsWith(child.to + "/"))) {
          crumbs.push({ label: section.label, to: `/section/${section.id}` });
          crumbs.push({ label: child.label, to: child.to });
          return crumbs;
        }
      }

      // Check if path starts with a parent path without exact match (e.g., /admin/*)
      if (section.to && pathname.startsWith(section.to)) {
        crumbs.push({ label: section.label, to: section.to });
        for (const child of section.children) {
          if (child.to && pathname.startsWith(child.to)) {
            crumbs.push({ label: child.label, to: child.to });
            return crumbs;
          }
        }
        return crumbs;
      }
    }

    // Direct top-level match for sub-paths
    if (section.to && pathname.startsWith(section.to + "/")) {
      crumbs.push({ label: section.label, to: section.to });
      return crumbs;
    }
  }

  return crumbs;
}
