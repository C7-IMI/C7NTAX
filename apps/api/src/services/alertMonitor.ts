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

async function checkService(service: { id: string; name: string; rssUrl: string | null }): Promise<void> {
  if (!service.rssUrl) return; // no RSS feed → no auto-detection (status-page HTML is too noisy for keyword probing)

  let outageText: { title: string; description: string; link: string } | null = null;
  let restoredText: { title: string; description: string; link: string } | null = null;

  try {
    const resp = await fetch(service.rssUrl, {
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "C7NTAX-ServiceAlerts/1.0", accept: "application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.8" },
    });
    if (!resp.ok) {
      snapshot.errors.push(`${service.name}: HTTP ${resp.status} from ${service.rssUrl}`);
      return;
    }
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
  } catch (e: any) {
    snapshot.errors.push(`${service.name}: fetch failed for ${service.rssUrl} (${e?.name || "error"})`);
  }

  const active = await prisma.serviceAlert.findFirst({
    where: { serviceId: service.id, status: "active" },
    orderBy: { detectedAt: "desc" },
  });

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
  } else if (restoredText && active) {
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
