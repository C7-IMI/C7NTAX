import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import { useAuth } from "./useAuth";
import { NAV_TREE } from "../components/Layout";
import { buildBreadcrumbs } from "../components/Breadcrumbs";
import {
  DWELL_MS,
  activitiesFromAudit,
  mergeRecent,
  readVisits,
  recordVisit,
  type AuditRow,
  type RecentActivity,
  type VisitRecord,
} from "../lib/recentActivity";

/**
 * The recent-activity list: changes from the audit trail, visits from this browser.
 *
 * **One request per session**, not one per open of the menu — the menu is opened to look at, not to
 * poll, and the tail it shows changes only when *this* person changes something (which is what the
 * local `refresh` is for). The audit read is capped at what the menu can show plus a little slack, so
 * the request is small: the trail is the last 500 rows for an auditor and the last handful for a menu.
 *
 * **A change this browser made is reflected immediately** rather than at the next page load, because a
 * menu that does not show the thing you just did looks broken even when it is only stale.
 */
const FETCH_LIMIT = 25;

let cache: RecentActivity[] | null = null;
let inflight: Promise<RecentActivity[]> | null = null;
const subscribers = new Set<(changes: RecentActivity[]) => void>();

function notify(changes: RecentActivity[]): void {
  cache = changes;
  subscribers.forEach((subscriber) => subscriber(changes));
}

function fetchChanges(): Promise<RecentActivity[]> {
  inflight ??= api
    .get("/system/audit-logs", { params: { mine: "true", limit: FETCH_LIMIT } })
    .then((res) => {
      const rows: AuditRow[] = Array.isArray(res.data?.data)
        ? res.data.data
        : [];
      const changes = activitiesFromAudit(rows, FETCH_LIMIT);
      cache = changes;
      return changes;
    })
    .catch(() => {
      // A failure is an empty list rather than an error: the menu has a second source and a page that
      // cannot read its own audit trail should still show where you were.
      cache = [];
      return [];
    });
  return inflight;
}

/**
 * Called after this browser performs a write, so the new activity appears without a reload.
 *
 * The write and the audit row are not simultaneous — the row is written when the response finishes, in
 * another request the browser cannot see — so this re-reads once, shortly after, and gives up quietly.
 * Concurrent writes collapse into one re-read: a page that saves five fields has done one thing.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function refreshRecentActivity(delayMs = 600): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    inflight = null;
    void fetchChanges().then((changes) => notify(changes));
  }, delayMs);
}

/** Forget the cache — for a sign-out, so one person's activity is not shown to the next. */
export function clearRecentActivityCache(): void {
  cache = null;
  inflight = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export function useRecentActivity(limit = 5): {
  activities: RecentActivity[];
  refresh: () => void;
} {
  const { user } = useAuth();
  const userKey = user?.email ?? "anon";

  const [changes, setChanges] = useState<RecentActivity[]>(() => cache ?? []);
  const [visits, setVisits] = useState<VisitRecord[]>(() =>
    readVisits(userKey),
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setVisits(readVisits(userKey));
  }, [userKey]);

  useEffect(() => {
    let active = true;
    const onChange = (next: RecentActivity[]) => {
      if (active) setChanges(next);
    };
    subscribers.add(onChange);
    void fetchChanges().then(onChange);
    return () => {
      active = false;
      subscribers.delete(onChange);
    };
  }, [nonce]);

  const refresh = useCallback(() => {
    inflight = null;
    setNonce((n) => n + 1);
  }, []);

  const activities = useMemo(
    () => mergeRecent(changes, visits, limit),
    [changes, visits, limit],
  );

  return { activities, refresh };
}

/**
 * Count a page as an activity once it has held someone's attention for two minutes.
 *
 * The timer restarts on every navigation, so the threshold measures *dwelling on one page* rather than
 * time in the application — which is the operator's rule, and the reason a page you glanced at is not
 * in the list while the page you worked on is. Navigating away cancels the timer, so leaving before the
 * two minutes are up records nothing.
 */
export function useDwellActivity(): void {
  const { user } = useAuth();
  const location = useLocation();
  const userKey = user?.email ?? "anon";
  const path = `${location.pathname}${location.search}`;
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    // A page with a highlight parameter is a link being followed, not a place someone sat down.
    if (new URLSearchParams(location.search).has("hl")) return;
    if (recorded.current === path) return;

    const timer = setTimeout(() => {
      const crumbs = buildBreadcrumbs(NAV_TREE, location.pathname);
      const label =
        crumbs.length > 1
          ? crumbs
              .map((crumb) => crumb.label)
              .slice(1)
              .join(" → ")
          : "C7NTAX";
      recorded.current = path;
      recordVisit(userKey, path, label);
    }, DWELL_MS);

    return () => clearTimeout(timer);
  }, [path, location.pathname, location.search, userKey]);
}
