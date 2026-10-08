/**
 * The dashboard widget catalogue (PLAN-015 Phase B #4).
 *
 * A saved dashboard layout is a list of widget ids the user dragged into an order. That list is
 * input, so it is checked against this catalogue rather than trusted: an unknown id is dropped,
 * an unknown size falls back to the widget's own default, and the order is the order the server
 * hands back. The catalogue lives on the server so a widget that is added, renamed or retired
 * behaves the same for everybody, and an existing layout picks up a new widget's default instead
 * of silently missing it.
 */

export interface DashboardWidget {
  id: string;
  label: string;
  description: string;
  /** How many of the twelve dashboard columns the widget occupies by default. */
  defaultSize: 1 | 2 | 3;
  /** Shown in the palette only to an account that holds the permission. */
  permission?: string;
}

export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "open_tickets", label: "Open tickets", description: "Tickets currently in progress", defaultSize: 1, permission: "ticket:view" },
  { id: "waiting_on_client", label: "Waiting on client", description: "Tickets parked with the customer", defaultSize: 1, permission: "ticket:view" },
  { id: "all_tickets", label: "All tickets", description: "Every ticket you can see", defaultSize: 1, permission: "ticket:view" },
  { id: "resolved", label: "Resolved", description: "Tickets closed out", defaultSize: 1, permission: "ticket:view" },
  { id: "overdue_invoices", label: "Overdue invoices", description: "Invoices past their due date", defaultSize: 1, permission: "billing:view" },
  { id: "active_clients", label: "Active clients", description: "Client accounts on the books", defaultSize: 1, permission: "client:view" },
  { id: "service_alerts", label: "Active alerts", description: "Monitoring alerts currently firing", defaultSize: 1, permission: "servicealert:view" },
  { id: "my_time", label: "My time this week", description: "Hours you logged since Monday", defaultSize: 1, permission: "billing:view" },
  // Full width by default: at half width the list makes its row as tall as the list itself, which
  // left the counters it shared that row with sitting above a pool of empty space. A user who wants
  // it half width can still choose M.
  { id: "recent_tickets", label: "Recent tickets", description: "The eight most recently updated tickets", defaultSize: 3, permission: "ticket:view" },
  { id: "quick_links", label: "Quick links", description: "Shortcuts into the areas you use", defaultSize: 3 },
];

export const DASHBOARD_SIZES = [1, 2, 3] as const;

export interface DashboardWidgetState {
  id: string;
  size: 1 | 2 | 3;
  visible: boolean;
}

const byId = new Map(DASHBOARD_WIDGETS.map(w => [w.id, w]));

/** The widgets an account may see, in catalogue order. */
export function widgetsFor(permissions: string[]): DashboardWidget[] {
  return DASHBOARD_WIDGETS.filter(w => !w.permission || permissions.includes(w.permission));
}

/**
 * A saved layout reconciled against the catalogue: unknown ids removed, duplicates collapsed,
 * sizes corrected, invisibility preserved, and anything the user has never seen appended in
 * catalogue order so a new widget shows up without wiping the arrangement around it.
 */
export function normaliseLayout(saved: unknown, available: DashboardWidget[]): DashboardWidgetState[] {
  const allowed = new Map(available.map(w => [w.id, w]));
  const seen = new Set<string>();
  const result: DashboardWidgetState[] = [];

  for (const raw of Array.isArray(saved) ? saved : []) {
    const entry = raw as Record<string, unknown>;
    const id = typeof entry?.id === "string" ? entry.id : "";
    const widget = allowed.get(id);
    if (!widget || seen.has(id)) continue;
    seen.add(id);
    const size = DASHBOARD_SIZES.includes(entry.size as 1 | 2 | 3) ? (entry.size as 1 | 2 | 3) : widget.defaultSize;
    result.push({ id, size, visible: entry.visible !== false });
  }

  for (const widget of available) {
    if (seen.has(widget.id)) continue;
    result.push({ id: widget.id, size: widget.defaultSize, visible: true });
  }
  return result;
}
