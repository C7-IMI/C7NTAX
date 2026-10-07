/** Shimmer placeholder (respects prefers-reduced-motion via the global .skeleton class). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** Ready-made skeleton rows for a table body. */
export function TableSkeleton({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * The shape of a page that is still arriving: a header line and a few blocks. Used where a
 * table skeleton would promise columns the page is not going to show (a detail or settings
 * screen), because a skeleton that lies about the layout is worse than a spinner that does not.
 */
export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-6 w-56" />
      {Array.from({ length: blocks }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

/** A card-shaped placeholder, for panels that load independently of the page around them. */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card space-y-2" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
