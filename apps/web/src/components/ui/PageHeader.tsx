import type { ReactNode } from "react";

/**
 * Standard page header: title + optional subtitle on the left, optional
 * actions on the right. Replaces the hand-rolled header markup that was
 * duplicated across pages.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const right = actions ?? children;
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
