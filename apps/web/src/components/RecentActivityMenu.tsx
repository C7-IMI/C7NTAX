import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Bot,
  Building2,
  Clock,
  FileText,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Lock,
  Package,
  Plug,
  Receipt,
  Server,
  Settings2,
  Ticket,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useRecentActivity } from "../hooks/useRecentActivity";
import {
  activityHref,
  relativeTime,
  type RecentIcon,
} from "../lib/recentActivity";

/**
 * The header's Recent menu: what this person changed, and where they were.
 *
 * Reading the two halves: a **change** is someone's work and links to the record it touched, so it can
 * put you back in front of the thing you were doing. A **visit** is the exception the operator asked
 * for — a page you stayed on for two minutes — and links to the page. The two are told apart visually
 * rather than only by their wording, because "I changed this" and "I was reading this" are different
 * reasons to click and a list that blurs them is a list nobody trusts.
 *
 * Five entries, because that is what fits before the menu becomes a page somebody has to read, and
 * because "where was I" is a question about the last few minutes rather than the last few weeks.
 */
const ICONS: Record<RecentIcon, LucideIcon> = {
  ticket: Ticket,
  client: Building2,
  billing: Receipt,
  asset: Package,
  kumo: Lock,
  integration: Plug,
  ai: Bot,
  admin: KeyRound,
  alert: LifeBuoy,
  board: LayoutGrid,
  kb: FileText,
  report: BarChart3,
  settings: Settings2,
  page: Server,
};

export function RecentActivityMenu() {
  const { activities, refresh } = useRecentActivity(5);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click or `Esc`, the same contract every other header menu keeps.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Falling back to a stale cache and then re-reading on open: the list is a convenience, and the
  // freshest answer is worth a request when somebody has just asked for it.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    refresh();
  }, [open, refresh]);

  // Keep the relative times honest while the menu is on screen, without re-rendering the app for it.
  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
        title="Recent activity"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="recent-button"
      >
        <Clock size={14} />
        <span>Recent</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Recent activity"
          className="absolute right-0 mt-2 w-80 rounded-lg border border-surface-border bg-surface shadow-lg z-50 overflow-hidden"
          data-testid="recent-menu"
        >
          <div className="px-3 pt-3 pb-2 border-b border-surface-border">
            <p className="text-xs font-medium text-white">Recent activity</p>
            <p className="text-[11px] text-gray-500">
              Where you were, and what you changed
            </p>
          </div>

          {activities.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-gray-500">
              Nothing yet. Changes you make appear here, and so does a page you
              stay on for two minutes.
            </p>
          ) : (
            <ul className="py-1">
              {activities.map((activity) => {
                const Icon = ICONS[activity.icon] ?? Workflow;
                return (
                  <li key={activity.id}>
                    <Link
                      to={activityHref(activity)}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 hover:bg-surface-lighter transition-colors"
                      data-testid="recent-item"
                    >
                      {/* Where, then what — the two questions in the order they are asked. */}
                      <span className="flex items-center gap-2">
                        <span
                          className={`shrink-0 ${
                            activity.kind === "change"
                              ? "text-cyber-400"
                              : "text-gray-500"
                          }`}
                        >
                          <Icon size={13} />
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-400"
                          title={activity.where}
                        >
                          {activity.where}
                        </span>
                        <span className="shrink-0 text-[10px] text-gray-600">
                          {relativeTime(activity.at, now)}
                        </span>
                      </span>
                      <span
                        className="block mt-0.5 pl-[21px] pr-1 text-xs text-gray-200 truncate"
                        title={
                          activity.subject
                            ? `${activity.action} — ${activity.subject}`
                            : activity.action
                        }
                      >
                        {activity.action}
                        {activity.subject ? (
                          <span className="text-gray-400">
                            {" "}
                            — {activity.subject}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <Link
            to="/admin/logs"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 border-t border-surface-border text-[11px] text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors"
          >
            Full audit trail
          </Link>
        </div>
      )}
    </div>
  );
}
