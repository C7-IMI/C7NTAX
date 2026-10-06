import type { ReactNode } from "react";

/** Section wrapper with an optional uppercase label and right-aligned actions. */
export function Section({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-3 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
