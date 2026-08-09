import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  field: string;
  direction: SortDirection;
}

/**
 * Clickable table header that toggles sort direction.
 * - First click: ascending
 * - Second click: descending
 * - Subsequent clicks: toggle between asc/desc
 * Pass `sort` and `onSort` from the parent page.
 */
export function SortableHeader({
  field,
  label,
  sort,
  onSort,
  className = "",
}: {
  field: string;
  label: string;
  sort: SortState | null;
  onSort: (field: string) => void;
  className?: string;
}) {
  const active = sort?.field === field;
  const Icon = active
    ? sort!.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      className={`${className} cursor-pointer select-none hover:text-white transition-colors ${active ? "text-cyber-400" : ""}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon
          size={12}
          className={`transition-opacity ${active ? "text-cyber-400 opacity-100" : "text-gray-600 opacity-40 group-hover:opacity-80"}`}
        />
      </span>
    </th>
  );
}

/**
 * Utility: sort an array of objects by a field.
 * Handles strings, numbers, dates, and null/undefined values.
 */
export function sortData<T extends Record<string, any>>(
  data: T[],
  field: string,
  direction: SortDirection
): T[] {
  const sorted = [...data].sort((a, b) => {
    let va = a[field];
    let vb = b[field];

    // Handle nested fields like "role.name" or "company.name"
    if (field.includes(".")) {
      const parts = field.split(".");
      va = parts.reduce((obj, key) => obj?.[key], a);
      vb = parts.reduce((obj, key) => obj?.[key], b);
    }

    // Null/undefined handling — push to end
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;

    // Date strings
    if (typeof va === "string" && typeof vb === "string") {
      const da = Date.parse(va);
      const db = Date.parse(vb);
      if (!isNaN(da) && !isNaN(db)) {
        return direction === "asc" ? da - db : db - da;
      }
    }

    // Numbers
    if (typeof va === "number" && typeof vb === "number") {
      return direction === "asc" ? va - vb : vb - va;
    }

    // Strings (case-insensitive)
    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();
    if (sa < sb) return direction === "asc" ? -1 : 1;
    if (sa > sb) return direction === "asc" ? 1 : -1;
    return 0;
  });

  return sorted;
}

/**
 * Hook-friendly sort toggler:
 * - If field not active → set asc
 * - If field active asc → set desc
 * - If field active desc → set asc
 */
export function nextSort(current: SortState | null, field: string): SortState {
  if (current?.field !== field) return { field, direction: "asc" };
  return {
    field,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}
