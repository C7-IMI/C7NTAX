import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * The list chrome every Modern list page shares.
 *
 * A list in this application answers three questions in the same order every time: *which slice of it
 * am I looking at* (views), *what have I narrowed it to* (filters, count) and *how much of it is
 * there* (the footer). The mockup draws that once and repeats it on every list, so it lives here
 * rather than in nineteen pages — which is also how a page keeps its own columns and still reads as
 * part of the same application.
 */

export interface ListViewOption {
  id: string;
  label: string;
  /** Shown beside the label when a list can say how many rows the view holds. */
  count?: number;
}

/** The views strip: the saved slices, as chips you press rather than a dialog you fill in. */
export function ListViews({
  views,
  value,
  onChange,
  label,
}: {
  views: ListViewOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          onClick={() => onChange(view.id)}
          aria-pressed={value === view.id}
          className={`chip ${value === view.id ? "chip--on" : ""}`}
        >
          {view.label}
          {view.count === undefined ? null : <> <span className="chip__n">{view.count}</span></>}
        </button>
      ))}
    </div>
  );
}

/**
 * The line under a list: what slice of it you are looking at, and the way to the next one.
 *
 * The range is stated in words ("1–25 of 109") rather than implied by a scrollbar, because a list you
 * cannot count is a list you cannot trust — which is the point the mockup makes when it labels its
 * own footer.
 */
export function ListFooter({
  from,
  to,
  total,
  page,
  pages,
  onPage,
  note,
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 text-xs text-gray-500">
      <span className="tabular-nums">{total === 0 ? "No rows" : `${from}–${to} of ${total}`}</span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="chip px-1.5 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="tabular-nums text-gray-400">{page} / {pages}</span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pages}
            className="chip px-1.5 disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}
      {note ? <span className="ml-auto text-[11px] text-gray-600">{note}</span> : null}
    </div>
  );
}
