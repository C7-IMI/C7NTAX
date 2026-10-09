/**
 * How a ticket's status is written and coloured.
 *
 * Shared because a status appears in several lists — the dashboard's recent tickets, the portal's
 * own ticket list and the portal preview — and "In Progress" in one place beside "in_progress" in
 * another is the kind of inconsistency nobody reports and everybody notices.
 *
 * The colours live in `index.css` (`--status-*` and `.badge-status*`) rather than here, because
 * they have to change with the theme twice over: a label dark enough to read on the light theme is
 * invisible on the dark one, and the tint has to follow whichever the label is. That is also why
 * this does not use `bg-<colour>-600/20`: the theme's colours are bare `var()` values, so an opacity
 * modifier on one of them emits no rule and leaves the badge with no background at all.
 */

const LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  in_progress: "In Progress",
  waiting_on_client: "Waiting on Client",
  waiting_on_vendor: "Waiting on Vendor",
  resolved: "Resolved",
  closed: "Closed",
  customer_reopened: "Customer Reopened",
};

/** "in_progress" → "In Progress"; anything unrecognised is still made readable. */
export function ticketStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BADGE_CLASSES: Record<string, string> = {
  new: "badge-status-new",
  open: "badge-status-open",
  in_progress: "badge-status-in_progress",
  waiting_on_client: "badge-status-waiting_on_client",
  waiting_on_vendor: "badge-status-waiting_on_vendor",
  resolved: "badge-status-resolved",
  closed: "badge-status-closed",
  customer_reopened: "badge-status-customer_reopened",
};

/** The colour classes for an element that also carries the `badge` component class. */
export function ticketStatusBadge(status: string | null | undefined): string {
  return `badge-status ${BADGE_CLASSES[status ?? ""] ?? "badge-status-closed"}`;
}
