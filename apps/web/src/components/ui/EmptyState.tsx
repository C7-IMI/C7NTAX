import type { ReactNode } from "react";

/** Consistent empty state: icon, title, optional description and action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      {icon ? <div className="text-gray-600 mb-3">{icon}</div> : null}
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {description ? <p className="text-xs text-gray-500 mt-1 max-w-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
