import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, FileText, History } from "lucide-react";
import { Permission } from "@C7NTAX/shared";
import api from "../api";
import { EmptyState, ListFooter, ListViews, PageHeader, StatCard, TableSkeleton } from "../components/ui";
import { activityIcon } from "../components/activityIcons";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import {
  activitiesFromAudit,
  activityHref,
  mergeRecent,
  readVisits,
  relativeTime,
  type AuditRow,
  type RecentActivity,
  type VisitRecord,
} from "../lib/recentActivity";

/**
 * My activity — where the Recent menu's "Show All" goes, and only ever this person's own history.
 *
 * The menu is a five-entry glance and this is the same list read at length, so it is built from the same
 * two sources and rendered the same way. Two deliberate differences from the audit trail at
 * `/admin/logs`, and they are the reason this is a page rather than a link to it:
 *
 * 1. **It is scoped to the caller.** Every entry is a change *you* made (`?mine=true`) or a page *you*
 *    stayed on. That is what makes it useful when you are looking for your own thread — and what makes it
 *    offerable to everybody, where the audit trail needs `system:config` because it names who did what
 *    across the whole instance.
 * 2. **Repeated changes are kept.** The menu collapses two identical changes into one entry because five
 *    lines have no room to repeat themselves; a history is the wrong place for that rule, since two
 *    deletions of two different clients summarize identically and would look like one.
 *
 * The menu keeps its own copy of the same decision, so the two surfaces cannot drift: same merge, same
 * links, same `?hl=` arrival target that scrolls to and flashes the exact place.
 */
const HISTORY_LIMIT = 200;

interface DayGroup {
  key: string;
  label: string;
  items: RecentActivity[];
}

/** The words someone would use for a day: "Today", "Yesterday", then the day itself. */
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Group into days, newest first. The activities arrive sorted, so the first day a date is seen is the
 * position it keeps — no second sort, and no re-ordering that could disagree with the entries' own order.
 */
function groupByDay(activities: readonly RecentActivity[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const activity of activities) {
    const date = new Date(activity.at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: dayLabel(activity.at), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(activity);
  }
  return groups;
}

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export function MyActivityPage() {
  const { user, permissions } = useAuth();
  const redesign = useRedesign();
  const userKey = user?.email ?? "anon";

  const [view, setView] = useState("all");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>(() => readVisits(userKey));
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    api
      .get("/system/audit-logs", {
        params: { mine: "true", limit: HISTORY_LIMIT },
      })
      .then((res) => {
        if (active)
          setRows(Array.isArray(res.data?.data) ? res.data.data : []);
      })
      // An empty history rather than an error card: the visit half is local and is still worth showing,
      // and "you have done nothing" is the same page as "we could not read your changes".
      .catch(() => {
        if (active) setRows([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setVisits(readVisits(userKey));
  }, [userKey]);

  // Keep the relative times honest while the page is open, without re-rendering the rest of the app.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const activities = useMemo(
    () =>
      mergeRecent(
        activitiesFromAudit(rows, HISTORY_LIMIT, { dedupe: false }),
        visits,
        HISTORY_LIMIT,
      ),
    [rows, visits],
  );
  const allDays = useMemo(() => groupByDay(activities), [activities]);

  /*
   * The two halves of a history — what you changed and where you were — are the slices this list can
   * honestly offer, and the counts come from the merged list rather than a second read of the API.
   */
  const kindCount = (kind: string) => activities.filter((activity) => activity.kind === kind).length;
  const shown = useMemo(
    () => (view === "all" ? activities : activities.filter((activity) => activity.kind === view)),
    [activities, view],
  );
  const days = useMemo(() => groupByDay(shown), [shown]);

  const canSeeAuditTrail = permissions.includes(Permission.SystemConfig);
  const truncated = rows.length >= HISTORY_LIMIT;

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl" data-testid="my-activity">
      <PageHeader
        title="My activity"
        subtitle="Everything you changed, and the pages that held you for two minutes. This is your own history — changes other people made are not shown here."
        actions={
          canSeeAuditTrail ? (
            <Link
              to="/admin/logs"
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
              title="Every change across the entire instance, whoever made it"
            >
              <FileText size={13} /> System-wide audit trail
            </Link>
          ) : undefined
        }
      />

      {loading ? (
        <TableSkeleton />
      ) : activities.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Clock size={28} />}
            title="Nothing yet"
            description="Changes you make appear here, and so does a page you stay on for two minutes. Nothing you have done yet has been recorded."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* The figures this history already holds: its two halves, how many days it covers, and
              how long it is — read from the list above rather than asked for again. */}
          {redesign && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Entries" value={activities.length} icon={<History size={13} />} tone="cyber" />
                <StatCard label="Changes you made" value={kindCount("change")} icon={<FileText size={13} />} tone="neutral" />
                <StatCard label="Pages visited" value={kindCount("visit")} icon={<Clock size={13} />} tone="neutral" />
                <StatCard label="Days covered" value={allDays.length} icon={<CalendarDays size={13} />} tone="neutral" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ListViews
                  views={[
                    { id: "all", label: "All", count: activities.length },
                    { id: "change", label: "Changes", count: kindCount("change") },
                    { id: "visit", label: "Visits", count: kindCount("visit") },
                  ]}
                  value={view}
                  onChange={setView}
                  label="Activity views"
                />
                <span className="text-xs text-gray-500 tabular-nums">
                  {shown.length} shown
                  {truncated ? ` · your ${HISTORY_LIMIT} most recent changes` : ""}
                </span>
              </div>
            </>
          )}

          {days.map((day) => (
            <section key={day.key} data-testid="activity-day">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-medium text-gray-400">
                  {day.label}
                </h3>
                <span className={redesign ? "text-[10px] text-gray-600 tabular-nums" : "text-[10px] text-gray-600"}>
                  {day.items.length}{" "}
                  {day.items.length === 1 ? "activity" : "activities"}
                </span>
              </div>
              <div className="card divide-y divide-surface-border p-0 overflow-hidden">
                {day.items.map((activity) => {
                  const Icon = activityIcon(activity.icon);
                  return (
                    <Link
                      key={activity.id}
                      to={activityHref(activity)}
                      className="flex items-start gap-3 px-3 py-2.5 hover:bg-surface-lighter transition-colors"
                      data-testid="activity-item"
                    >
                      <span
                        className={`mt-0.5 shrink-0 ${
                          activity.kind === "change"
                            ? "text-cyber-400"
                            : "text-gray-500"
                        }`}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[11px] font-medium text-gray-400"
                          title={activity.where}
                        >
                          {activity.where}
                        </span>
                        <span className="block text-sm text-gray-200">
                          {activity.action}
                          {activity.subject ? (
                            <span className="text-gray-400">
                              {" "}
                              — {activity.subject}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={redesign ? "block text-[11px] text-gray-500 tabular-nums" : "block text-[11px] text-gray-500"}
                          title={new Date(activity.at).toLocaleString()}
                        >
                          {timeOfDay(activity.at)}
                        </span>
                        <span className="block text-[10px] text-gray-600">
                          {relativeTime(activity.at, now)}
                        </span>
                      </span>
                      {redesign && <span className="chip shrink-0 text-[10px]">{activity.kind}</span>}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}

          {redesign && shown.length === 0 && (
            <p className="text-sm text-gray-500">Nothing in this view.</p>
          )}

          {redesign && shown.length > 0 && (
            <ListFooter
              from={1}
              to={shown.length}
              total={shown.length}
              page={1}
              pages={1}
              onPage={() => {}}
              note={truncated ? `Kept to the ${HISTORY_LIMIT} most recent changes` : undefined}
            />
          )}

          <p className="text-[11px] text-gray-600 leading-relaxed">
            {truncated
              ? `Your ${HISTORY_LIMIT} most recent changes are shown. `
              : null}
            Pages you stayed on are recorded in this browser, so they do not
            follow you to another machine.
          </p>
        </div>
      )}
    </div>
  );
}
