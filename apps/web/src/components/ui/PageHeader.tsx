import type { ReactNode } from "react";
import { useRedesign } from "../../hooks/useNavigationStyle";

/**
 * Standard page header: title + optional subtitle on the left, optional
 * actions on the right. Replaces the hand-rolled header markup that was
 * duplicated across pages.
 *
 * The redesigned interface asks a page to spend less height on chrome, so the
 * header has two shapes and the page does not have to know which one it gets:
 *
 * - **`variant="page"`** (the default) is the header of a page — a title and its
 *   description, above the content the page exists for.
 * - **`variant="section"`** is the header a page used to hand-roll for a section
 *   of itself: an `h2` with a `p` under it. It reproduces that markup exactly in
 *   the classic interface, so converting a page to this component changes the
 *   redesigned screens and *not* the classic ones.
 *
 * In the redesigned interface both variants draw one compact row, because two
 * lines of heading for one line of title is height taken from the content. See
 * INTERFACE-ROLLBACK.md.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className = "",
  variant = "page",
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  variant?: "page" | "section";
  /** A leading glyph, for the pages whose header names its subject with an icon. */
  icon?: ReactNode;
}) {
  const redesign = useRedesign();
  const right = actions ?? children;

  if (redesign) {
    return (
      <div className={`flex flex-wrap items-end justify-between gap-x-3 gap-y-2 ${className}`}>
        <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-1.5">
            {icon}{title}
          </h2>
          {subtitle ? <p className="text-xs text-gray-500 min-w-0">{subtitle}</p> : null}
        </div>
        {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
      </div>
    );
  }

  // ── Classic: the markup this page had before the redesign, unchanged ──────
  if (variant === "section") {
    const block = (
      <div>
        <h2 className={icon ? "text-lg font-semibold text-white flex items-center gap-2" : "text-lg font-semibold text-white"}>
          {icon}{title}
        </h2>
        {subtitle ? <p className="text-sm text-gray-400">{subtitle}</p> : null}
      </div>
    );
    if (!right) return block;
    return (
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}>
        {block}
        <div className="flex items-center gap-2 shrink-0">{right}</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="page-title text-xl font-semibold text-white tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex items-center gap-2 shrink-0">{right}</div> : null}
    </div>
  );
}
