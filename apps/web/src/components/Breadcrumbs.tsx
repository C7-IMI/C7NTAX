import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  to?: string;  // undefined for the current (last) segment
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
            {isLast ? (
              <span className="text-white font-medium truncate max-w-[200px]">{seg.label}</span>
            ) : seg.to ? (
              <Link to={seg.to} className="text-gray-500 hover:text-white transition-colors truncate max-w-[160px]">
                {i === 0 ? (
                  <span className="flex items-center gap-1"><Home size={12} />{seg.label}</span>
                ) : (
                  seg.label
                )}
              </Link>
            ) : (
              <span className="text-gray-400 truncate max-w-[160px]">{seg.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Build breadcrumb segments from the NAV_TREE based on the current pathname.
 * Each nav node's label becomes a breadcrumb segment, linked to its `to` path.
 * Only nodes that match the current path are included.
 */
export function buildBreadcrumbs(
  navTree: Array<{ id: string; to?: string; label: string; icon?: unknown; children?: Array<{ id: string; to?: string; label: string }> }>,
  pathname: string
): BreadcrumbSegment[] {
  const crumbs: BreadcrumbSegment[] = [];

  // Always start with Dashboard
  crumbs.push({ label: "Dashboard", to: "/" });

  // Find the deepest matching node
  for (const section of navTree) {
    // Check if the current path is within this section
    if (section.to && pathname === section.to) {
      crumbs.push({ label: section.label, to: section.to });
      return crumbs;
    }

    if (section.children) {
      for (const child of section.children) {
        if (child.to && (pathname === child.to || pathname.startsWith(child.to + "/"))) {
          crumbs.push({ label: section.label });
          crumbs.push({ label: child.label, to: pathname === child.to ? undefined : child.to });
          return crumbs;
        }
      }

      // Check if path starts with a parent path without exact match (e.g., /admin/*)
      if (section.to && pathname.startsWith(section.to)) {
        crumbs.push({ label: section.label });
        // Try to find deeper matches
        for (const child of section.children) {
          if (child.to && pathname.startsWith(child.to)) {
            crumbs.push({ label: child.label });
            return crumbs;
          }
        }
        return crumbs;
      }
    }

    // Direct top-level match
    if (section.to && pathname.startsWith(section.to + "/")) {
      crumbs.push({ label: section.label, to: section.to });
      return crumbs;
    }
  }

  return crumbs;
}
