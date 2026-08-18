/**
 * FI-060 — Service Alerts monitor
 *
 * Polls configured RSS/status feeds on a schedule and maintains
 * ServiceAlert records:
 *  - outage/degraded keywords  → create or update an ACTIVE alert
 *  - restored/resolved keywords → auto-resolve the active alert
 * Keeps a lightweight in-memory status snapshot for the UI.
 */
import { prisma } from "../index";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const ITEM_WINDOW_MS = 24 * 60 * 60 * 1000; // consider items from last 24h

const OUTAGE_PATTERNS = [
  /major outage/i, /outage/i, /degraded performance/i, /degraded/i, /service disruption/i,
  /disruption/i, /interruption/i, /interrupted/i, /is down\b/i, /\bdown\b/i, /unavailable/i,
  /not working/i, /connection issues/i, /connectivity issues/i, /incident reported/i,
  /investigating/i, /monitoring a potential/i, /possible service interruption/i,
  /experiencing issues/i, /experiencing problems/i, /performance issues/i,
];

const RESTORED_PATTERNS = [
  /resolved/i, /restored/i, /back to normal/i, /back online/i, /all systems operational/i,
  /mitigated/i, /fix deployed/i, /fix has been deployed/i, /service restored/i, /operational again/i,
  /post.?incident/i, /has been fixed/i, /normal service/i,
];

export interface MonitorSnapshot {
  lastCheckAt: string | null;
  lastRunMs: number | null;
  checkedServices: number;
  created: number;
  updated: number;
  resolved: number;
  errors: string[];
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
}

let snapshot: MonitorSnapshot = {
  lastCheckAt: null,
  lastRunMs: null,
  checkedServices: 0,
  created: 0,
  updated: 0,
  resolved: 0,
  errors: [],
  log: [],
};

// Per-service consecutive "all clear" observations. An active alert is only
// auto-resolved after two consecutive polls show no outage items, so a single
// transient fetch gap or missed item can't flap the alert.
const clearStreak = new Map<string, number>();

export function getMonitorStatus(): MonitorSnapshot {
  return snapshot;
}

function log(level: "info" | "warn" | "error", msg: string) {
  snapshot.log.unshift({ at: new Date().toISOString(), level, msg });
  if (snapshot.log.length > 60) snapshot.log.length = 60;
  if (level !== "info") console.log(`[ServiceAlerts-${level.toUpperCase()}] ${msg}`);
}

/** Minimal RSS/Atom item extraction (no external deps). */
function parseFeedItems(xml: string): Array<{ title: string; description: string; link: string; pubDate: Date | null }> {
  const items: Array<{ title: string; description: string; link: string; pubDate: Date | null }> = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1).concat(xml.split(/<entry[\s>]/i).slice(1));
  for (const block of blocks) {
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const description = (block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    const link = (block.match(/<link[^>]*href="([^"]+)"/i) || block.match(/<link[^>]*>([^<]+)<\/link>/i) || [])[1]?.trim() || "";
    const pubRaw = (block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i) || [])[1]?.trim() || "";
    const pubDate = pubRaw ? new Date(pubRaw) : null;
    if (!title && !description) continue;
    items.push({ title, description, link, pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null });
  }
  return items;
}

function classify(text: string): "outage" | "restored" | null {
  if (RESTORED_PATTERNS.some((r) => r.test(text))) return "restored";
  if (OUTAGE_PATTERNS.some((r) => r.test(text))) return "outage";
  return null;
}

async function checkService(service: { id: string; name: string; rssUrl: string | null; downDetectorUrl: string | null }): Promise<void> {
  if (!service.rssUrl && !service.downDetectorUrl) return; // no monitored source → no auto-detection

  let outageText: { title: string; description: string; link: string } | null = null;
  let restoredText: { title: string; description: string; link: string } | null = null;
  let rssClean = false;   // RSS fetch succeeded with no outage/restored items in window
  let ddAllClear = false; // DownDetector page positively shows no problems
  let ddProblems = false; // DownDetector page positively shows problems

  if (service.rssUrl) {
    try {
      const resp = await fetch(service.rssUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { "user-agent": "C7NTAX-ServiceAlerts/1.0", accept: "application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.8" },
      });
      if (!resp.ok) {
        snapshot.errors.push(`${service.name}: HTTP ${resp.status} from ${service.rssUrl}`);
      } else {
        const body = await resp.text();
        const items = parseFeedItems(body);
        const now = Date.now();
        for (const item of items) {
          const age = item.pubDate ? now - item.pubDate.getTime() : 0;
          if (item.pubDate && age > ITEM_WINDOW_MS) continue;
          const cls = classify(`${item.title} ${item.description}`);
          if (cls === "outage" && !outageText) {
            outageText = { title: item.title, description: item.description.slice(0, 500), link: item.link };
          } else if (cls === "restored" && !restoredText) {
            restoredText = { title: item.title, description: item.description.slice(0, 500), link: item.link };
          }
        }
        if (!outageText && !restoredText) rssClean = true;
      }
    } catch (e: any) {
      snapshot.errors.push(`${service.name}: fetch failed for ${service.rssUrl} (${e?.name || "error"})`);
    }
  }

  // DownDetector: page-level check. DownDetector's Cloudflare blocks
  // non-browser TLS fingerprints (Node fetch gets 403 regardless of UA), so
  // fetch the public status page through the r.jina.ai reader (base URL is
  // env-overridable for self-hosting). Only a POSITIVE "no current
  // problems" status line counts as all-clear; unknown or unclassifiable
  // pages never auto-resolve anything (fail-safe). Classification uses the
  // page's own H1 status line only — sidebar tweets about OTHER services
  // must not trigger false problem alerts.
  if (service.downDetectorUrl) {
    try {
      const readerBase = process.env.DD_READER_BASE_URL || "https://r.jina.ai/";
      const resp = await fetch(readerBase + service.downDetectorUrl, {
        signal: AbortSignal.timeout(20000),
        headers: { "user-agent": "C7NTAX-ServiceAlerts/1.0" },
      });
      if (!resp.ok) {
        snapshot.errors.push(`${service.name}: DownDetector reader HTTP ${resp.status} for ${service.downDetectorUrl}`);
      } else {
        const body = await resp.text();
        const h1 = body.match(/^#\s*User reports[^\n]*/m)?.[0] ?? "";
        if (/no current problems/i.test(h1)) ddAllClear = true;
        else if (/problems|issues|outage|degraded|disruption/i.test(h1)) ddProblems = true;
        // else: no recognizable status line — leave both false (fail-safe)
      }
    } catch (e: any) {
      snapshot.errors.push(`${service.name}: DownDetector fetch failed for ${service.downDetectorUrl} (${e?.name || "error"})`);
    }
  }

  const active = await prisma.serviceAlert.findFirst({
    where: { serviceId: service.id, status: "active" },
    orderBy: { detectedAt: "desc" },
  });

  if (outageText || ddProblems) {
    clearStreak.delete(service.id);
    if (outageText) {
      if (active) {
      const sameTitle = active.title === outageText.title;
      await prisma.serviceAlert.update({
        where: { id: active.id },
        data: {
          title: outageText.title || active.title,
          description: outageText.description || active.description,
          sourceUrl: outageText.link || active.sourceUrl,
          severity: active.severity === "informational" ? "degraded" : active.severity,
        },
      });
      if (!sameTitle) snapshot.updated++;
    } else {
      await prisma.serviceAlert.create({
        data: {
          serviceId: service.id,
          title: outageText.title || `Possible outage reported for ${service.name}`,
          description: outageText.description || null,
          severity: /major|down\b|unavailable/i.test(`${outageText.title} ${outageText.description}`) ? "outage" : "degraded",
          status: "active",
          source: "rss",
          sourceUrl: outageText.link || null,
          detectedAt: new Date(),
        },
      });
      snapshot.created++;
      log("warn", `New active alert for ${service.name}: ${outageText.title}`);
      }
    } else {
      // DownDetector reports problems
      if (!active) {
        await prisma.serviceAlert.create({
          data: {
            serviceId: service.id,
            title: `Possible service degradation reported for ${service.name} (DownDetector)`,
            description: `DownDetector is reporting problems for ${service.name}.`,
            severity: "degraded",
            status: "active",
            source: "downdetector",
            sourceUrl: service.downDetectorUrl,
            detectedAt: new Date(),
          },
        });
        snapshot.created++;
        log("warn", `New active alert for ${service.name} (DownDetector)`);
      }
    }
  } else if (restoredText && active) {
    clearStreak.delete(service.id);
    await prisma.serviceAlert.update({
      where: { id: active.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        description: `Auto-resolved: ${restoredText.title}${active.description ? `\n\n${active.description}` : ""}`,
      },
    });
    snapshot.resolved++;
    log("info", `Auto-resolved alert for ${service.name}: ${restoredText.title}`);
  } else if (active && active.source !== "manual") {
    // All clear: every configured monitored source is positively clean —
    // RSS (no outage/restored items) and/or DownDetector (page says no
    // current problems). Resolve once the all-clear has persisted for two
    // consecutive polls (anti-flap) and the alert is at least one poll
    // interval old. Manual alerts are never auto-resolved. Any unknown
    // source state restarts the streak (fail-safe).
    const rssOk = service.rssUrl ? rssClean : true;
    const ddOk = service.downDetectorUrl ? ddAllClear : true;
    const allClear = rssOk && ddOk;
    if (!allClear) {
      clearStreak.delete(service.id);
      return;
    }
    const MIN_ALERT_AGE_MS = POLL_INTERVAL_MS;
    const streak = (clearStreak.get(service.id) || 0) + 1;
    clearStreak.set(service.id, streak);
    const alertAge = Date.now() - new Date(active.detectedAt).getTime();
    if (streak >= 2 && alertAge >= MIN_ALERT_AGE_MS) {
      await prisma.serviceAlert.update({
        where: { id: active.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          description: `Auto-resolved: monitored sources for ${service.name} report no active incidents or degradations (all clear).${active.description ? `\n\n${active.description}` : ""}`,
        },
      });
      clearStreak.delete(service.id);
      snapshot.resolved++;
      log("info", `Auto-resolved alert for ${service.name} (all clear confirmed)`);
    }
  }
}

export async function runAlertCheck(): Promise<MonitorSnapshot> {
  const started = Date.now();
  snapshot.checkedServices = 0;
  snapshot.created = 0;
  snapshot.updated = 0;
  snapshot.resolved = 0;
  snapshot.errors = [];
  try {
    const services = await prisma.serviceAlertService.findMany({
      where: { enabled: true, monitorEnabled: true },
      orderBy: { sortOrder: "asc" },
    });
    for (const service of services) {
      snapshot.checkedServices++;
      await checkService(service);
    }
    snapshot.lastCheckAt = new Date().toISOString();
    snapshot.lastRunMs = Date.now() - started;
    log("info", `Check finished: ${services.length} services, ${snapshot.created} created, ${snapshot.resolved} resolved, ${snapshot.errors.length} errors`);
  } catch (e: any) {
    snapshot.lastCheckAt = new Date().toISOString();
    snapshot.lastRunMs = Date.now() - started;
    snapshot.errors.push(`monitor: ${e?.message || String(e)}`);
    log("error", `Monitor run failed: ${e?.message || e}`);
  }
  return snapshot;
}

export function startAlertMonitor(): void {
  log("info", "Service Alerts monitor started (5-minute interval)");
  // First run shortly after boot so the dashboard is populated quickly.
  setTimeout(() => { void runAlertCheck(); }, 20_000);
  setInterval(() => { void runAlertCheck(); }, POLL_INTERVAL_MS);
}
