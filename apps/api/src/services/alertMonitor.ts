/**
 * FI-060 - Service Alerts monitor
 *
 * Each poll gathers an independent observation from every source a service has
 * configured - its RSS/Atom feed, the Statuspage.io API behind its status page,
 * its DownDetector page (via the reader), and its website/ssl/dns monitor -
 * and keeps ServiceAlert records in step with what those sources actually say:
 *
 *   - any source reporting a problem       -> create or refresh an ACTIVE alert
 *   - a source reporting the incident over -> auto-resolve
 *   - every readable source clear          -> auto-resolve (after two clear
 *                                             polls in a row, anti-flap)
 *   - no source readable at all            -> keep the alert, but never past
 *                                             the stale ceiling, so a blocked
 *                                             source cannot pin an incident
 *                                             from weeks ago to the banner
 *
 * An unreadable source is "unknown", never "not clear": it cannot veto the
 * resolution the readable sources agree on, and it is reported per service so
 * the UI can show exactly which source went silent and why.
 */
import { prisma } from "../index";
import { assertSafeOutboundUrl, safeFetch } from "./egress";
import tls from "node:tls";
import { promises as dns } from "node:dns";
import { configFlag, configNumber, refreshSettings } from "./appSettings";

/**
 * The poll interval is read when the monitor starts rather than per poll: it also defines the
 * shortest life an alert can have, so changing it mid-flight would move a finish line that
 * alerts are already running against. The configuration screen marks it restart-required.
 */
/**
 * The poll interval and the stale ceiling are sampled when the monitor starts rather than per
 * poll, because the interval also defines the shortest life an alert may have — moving it
 * mid-flight would shift a finish line that open alerts are already running against. Both are
 * marked restart-required in the configuration registry, which is exactly this.
 */
let POLL_INTERVAL_MS = 5 * 60 * 1000;
let STALE_AFTER_MS = 72 * 60 * 60 * 1000;
let STALE_AFTER_HOURS = 72;
const ITEM_WINDOW_MS = 24 * 60 * 60 * 1000; // consider feed items from last 24h
const REQUIRED_CLEAR_POLLS = 2; // consecutive all-clear polls before resolving
const SOCIAL_WINDOW_MS = 2 * 60 * 60 * 1000; // social posts older than two hours are not evidence
const USER_AGENT = "C7NTAX-ServiceAlerts/1.0";

/** Samples the configured timing. Called once, as the monitor starts. */
function readMonitorTiming(): void {
  POLL_INTERVAL_MS = Math.max(1, configNumber("monitoring", "pollIntervalMinutes", 5)) * 60 * 1000;
  STALE_AFTER_HOURS = Math.max(1, configNumber("monitoring", "staleAfterHours", 72));
  STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;
}

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

export type SourceVerdict = "problem" | "restored" | "clear" | "unknown";

export interface SourceObservation {
  source: "rss" | "statuspage" | "downdetector" | "website" | "ssl" | "dns" | "social";
  verdict: SourceVerdict;
  /** Human-readable reason, shown per source in the UI. */
  detail: string;
  title?: string;
  body?: string;
  link?: string | null;
  severity?: "outage" | "degraded" | "informational";
}

export interface ServiceSourceStatus {
  name: string;
  checkedAt: string;
  verdict: SourceVerdict;
  sources: Array<{ source: string; verdict: SourceVerdict; detail: string }>;
}

export interface MonitorSnapshot {
  lastCheckAt: string | null;
  lastRunMs: number | null;
  checkedServices: number;
  created: number;
  updated: number;
  resolved: number;
  /** Alerts retired by the stale ceiling rather than by a positive all-clear. */
  staleResolved: number;
  errors: string[];
  pollIntervalMs: number;
  staleAfterHours: number;
  /** serviceId -> what each of that service's sources reported on the last poll. */
  sourceStatus: Record<string, ServiceSourceStatus>;
  log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
}

const snapshot: MonitorSnapshot = {
  lastCheckAt: null,
  lastRunMs: null,
  checkedServices: 0,
  created: 0,
  updated: 0,
  resolved: 0,
  staleResolved: 0,
  errors: [],
  pollIntervalMs: POLL_INTERVAL_MS,
  staleAfterHours: STALE_AFTER_HOURS,
  sourceStatus: {},
  log: [],
};

// Per-service consecutive "all clear" observations. An active alert is only
// auto-resolved after two consecutive polls show no outage items, so a single
// transient fetch gap or missed item cannot flap the alert.
const clearStreak = new Map<string, number>();

/** Counted during a run, flushed into `errors` as one line instead of one per service. */
let downDetectorBlocked = 0;

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

function looksLikeChallenge(body: string): boolean {
  return /just a moment|requiring CAPTCHA|cf-chl|enable javascript and cookies to continue/i.test(body);
}

/** Vendor incident feed. An item inside the 24h window decides; otherwise the feed is positively clear. */
async function observeFeed(service: { name: string; rssUrl: string | null }): Promise<SourceObservation | null> {
  if (!service.rssUrl) return null;
  try {
    const resp = await safeFetch(service.rssUrl, {
      purpose: "monitor",
      timeoutMs: 12000,
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.8" },
    });
    if (!resp.ok) {
      snapshot.errors.push(`${service.name}: HTTP ${resp.status} from ${service.rssUrl}`);
      return { source: "rss", verdict: "unknown", detail: `feed returned HTTP ${resp.status}` };
    }
    const body = await resp.text();
    if (!/<(?:rss|feed|channel)[\s>]/i.test(body)) {
      return { source: "rss", verdict: "unknown", detail: "feed URL did not return a feed document" };
    }
    const now = Date.now();
    let problem: SourceObservation | null = null;
    let restored: SourceObservation | null = null;
    let youngest: number | null = null;
    for (const item of parseFeedItems(body)) {
      if (item.pubDate) {
        const age = now - item.pubDate.getTime();
        if (age > ITEM_WINDOW_MS) continue;
        if (youngest === null || age < youngest) youngest = age;
      }
      const cls = classify(`${item.title} ${item.description}`);
      if (cls === "outage" && !problem) {
        problem = {
          source: "rss",
          verdict: "problem",
          title: item.title,
          body: item.description.slice(0, 500),
          link: item.link,
          severity: /major|down\b|unavailable/i.test(`${item.title} ${item.description}`) ? "outage" : "degraded",
          detail: `incident item published ${item.pubDate ? item.pubDate.toISOString().slice(0, 16).replace("T", " ") + "Z" : "undated"}`,
        };
      } else if (cls === "restored" && !restored) {
        restored = { source: "rss", verdict: "restored", title: item.title, link: item.link, detail: "resolution item published" };
      }
    }
    if (problem) return problem;
    if (restored) return restored;
    return {
      source: "rss",
      verdict: "clear",
      detail: youngest === null ? "no incidents in the feed" : `no incidents in the last 24h (newest item ${Math.round(youngest / 3600000)}h old)`,
    };
  } catch (e: any) {
    snapshot.errors.push(`${service.name}: fetch failed for ${service.rssUrl} (${e?.message || e?.name || "error"})`);
    return { source: "rss", verdict: "unknown", detail: `feed unreachable (${e?.message || e?.name || "error"})` };
  }
}

/**
 * Statuspage.io JSON API behind the service's status page. This is the one
 * source that states the vendor's current state directly, and unlike
 * DownDetector it is not behind a bot challenge - so it keeps the resolver
 * honest when a feed is empty and the DownDetector page is unreadable. Status
 * pages that are not Statuspage.io answer 404/HTML and stay unknown.
 */
async function observeStatusPage(service: { statusPageUrl: string | null }): Promise<SourceObservation | null> {
  if (!service.statusPageUrl) return null;
  let origin: string;
  try {
    const parsed = new URL(service.statusPageUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    origin = parsed.origin;
  } catch {
    return { source: "statuspage", verdict: "unknown", detail: "status page URL is not a valid URL" };
  }
  try {
    const resp = await safeFetch(`${origin}/api/v2/status.json`, {
      purpose: "monitor",
      timeoutMs: 12000,
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok || !contentType.includes("json")) {
      return { source: "statuspage", verdict: "unknown", detail: `no Statuspage.io API (HTTP ${resp.status})` };
    }
    const json: any = await resp.json().catch(() => null);
    const indicator = String(json?.status?.indicator ?? "");
    const description = String(json?.status?.description ?? "").trim();
    if (indicator === "none") {
      return { source: "statuspage", verdict: "clear", detail: description || "all systems operational" };
    }
    if (indicator === "minor" || indicator === "major" || indicator === "critical") {
      return {
        source: "statuspage",
        verdict: "problem",
        severity: indicator === "minor" ? "degraded" : "outage",
        title: description || `Status page reports a ${indicator} incident`,
        body: `${origin} reports "${description || indicator}".`,
        link: service.statusPageUrl,
        detail: `status indicator: ${indicator}`,
      };
    }
    return { source: "statuspage", verdict: "unknown", detail: `unrecognised status indicator "${indicator || "missing"}"` };
  } catch (e: any) {
    return { source: "statuspage", verdict: "unknown", detail: `status API unreachable (${e?.name || "error"})` };
  }
}

/**
 * DownDetector user-report page through the r.jina.ai reader (DownDetector's
 * Cloudflare blocks non-browser TLS fingerprints). The page's own H1 status
 * line decides - sidebar chatter about other services must not raise an alert.
 * A challenge page is "unknown", never "no reports".
 */
async function observeDownDetector(service: { name: string; downDetectorUrl: string | null }): Promise<SourceObservation | null> {
  if (!service.downDetectorUrl) return null;
  try {
    const readerBase = process.env.DD_READER_BASE_URL || "https://r.jina.ai/";
    const resp = await safeFetch(readerBase + service.downDetectorUrl, {
      purpose: "monitor",
      timeoutMs: 20000,
      headers: { "user-agent": USER_AGENT },
    });
    if (!resp.ok) {
      snapshot.errors.push(`${service.name}: DownDetector reader HTTP ${resp.status} for ${service.downDetectorUrl}`);
      return { source: "downdetector", verdict: "unknown", detail: `reader returned HTTP ${resp.status}` };
    }
    const body = await resp.text();
    const h1 = body.match(/^#\s*User reports[^\n]*/m)?.[0] ?? "";
    if (/no current problems/i.test(h1)) {
      return { source: "downdetector", verdict: "clear", detail: "page reports no current problems" };
    }
    if (/problems|issues|outage|degraded|disruption/i.test(h1)) {
      return {
        source: "downdetector",
        verdict: "problem",
        severity: "degraded",
        title: `Possible service degradation reported for ${service.name} (DownDetector)`,
        body: `DownDetector is reporting problems for ${service.name}.`,
        link: service.downDetectorUrl,
        detail: h1.replace(/^#\s*/, ""),
      };
    }
    const blocked = looksLikeChallenge(body);
    if (blocked) downDetectorBlocked++;
    return {
      source: "downdetector",
      verdict: "unknown",
      detail: blocked ? "challenge page - source blocked" : "no recognisable status line",
    };
  } catch (e: any) {
    snapshot.errors.push(`${service.name}: DownDetector fetch failed for ${service.downDetectorUrl} (${e?.message || e?.name || "error"})`);
    return { source: "downdetector", verdict: "unknown", detail: `page unreachable (${e?.message || e?.name || "error"})` };
  }
}

/**
 * Social reports (X / Twitter), behind configuration.
 *
 * This is the weakest source in the set and is treated as such: it reads the recent-search endpoint
 * for the service's own name, and a complaint is recorded as an **informational** observation, never
 * as proof of an outage — social chatter earns a notice on the board, not a red banner. A post must
 * also name the service itself before it counts for anything, so a post about something else cannot
 * raise a notice here. Nothing is fetched at all unless a bearer token is configured, so a
 * deployment that has not set one does not silently look like it is watching a source it cannot
 * read.
 */
async function observeSocial(service: { name: string }): Promise<SourceObservation | null> {
  if (!configFlag("monitoring", "socialSource")) return null;
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return null;
  const base = process.env.X_API_BASE_URL || "https://api.x.com";
  const query = `"${service.name}" (outage OR down OR "not working" OR degraded) -is:retweet lang:en`;
  try {
    const url = `${base.replace(/\/$/, "")}/2/tweets/search/recent?max_results=10&tweet.fields=created_at,text&query=${encodeURIComponent(query)}`;
    const resp = await safeFetch(url, {
      purpose: "monitor",
      timeoutMs: 12000,
      headers: { authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
    });
    if (resp.status === 401 || resp.status === 403) {
      return { source: "social", verdict: "unknown", detail: `X rejected the credentials (HTTP ${resp.status})` };
    }
    if (resp.status === 429) {
      return { source: "social", verdict: "unknown", detail: "X rate limit reached for this window" };
    }
    if (!resp.ok) {
      snapshot.errors.push(`${service.name}: X search HTTP ${resp.status}`);
      return { source: "social", verdict: "unknown", detail: `X returned HTTP ${resp.status}` };
    }
    const payload = (await resp.json().catch(() => null)) as { data?: Array<{ id: string; text: string; created_at?: string }> } | null;
    const tweets = payload?.data ?? [];
    const now = Date.now();
    const recent = tweets.filter((t) => !t.created_at || now - Date.parse(t.created_at) <= SOCIAL_WINDOW_MS);
    // The query asks for the name, but the search can answer with posts that merely share its words —
    // and a base URL pointed somewhere it should not be answers with anything at all. A post that
    // never names the service is not evidence about it, so it can neither raise nor retire a notice;
    // without this, one stranger's post raises notices on every service on the board.
    const named = recent.filter((t) => t.text.toLowerCase().includes(service.name.toLowerCase()));
    const read = `${recent.length} recent post${recent.length === 1 ? "" : "s"} read, ${named.length} naming ${service.name}`;
    const complaining = named.find((t) => classify(t.text) === "outage" && !RESTORED_PATTERNS.some((r) => r.test(t.text)));
    if (complaining) {
      const when = complaining.created_at ? new Date(complaining.created_at).toISOString().slice(0, 16).replace("T", " ") + "Z" : "undated";
      return {
        source: "social",
        verdict: "problem",
        severity: "informational",
        title: `Social reports about ${service.name} on X`,
        body: complaining.text.slice(0, 300),
        link: `https://x.com/i/web/status/${complaining.id}`,
        detail: `a post ${when} names ${service.name} and reports a problem (${read})`,
      };
    }
    const resolving = named.find((t) => classify(t.text) === "restored");
    if (resolving) {
      return { source: "social", verdict: "restored", detail: `a recent post naming ${service.name} says it is resolved` };
    }
    return {
      source: "social",
      verdict: "clear",
      detail: recent.length
        ? `${read}, none reporting a problem`
        : `no recent post names ${service.name}`,
    };
  } catch (e: any) {
    return { source: "social", verdict: "unknown", detail: `X unreachable (${e?.message || e?.name || "error"})` };
  }
}

/** website / ssl / dns monitors (gated by UPTIME_MONITORS_ENABLED). */async function observeMonitor(service: { name: string; monitorKind: string; monitorUrl: string | null; monitorConfig: unknown }): Promise<SourceObservation | null> {
  if (service.monitorKind === "vendor" || !service.monitorUrl) return null;
  if (!configFlag("monitoring", "uptimeMonitors")) return null;
  const kind = service.monitorKind as "website" | "ssl" | "dns";
  const cfg = (service.monitorConfig || {}) as { expectStatus?: number; sslWarnDays?: number };
  try {
    if (kind === "website") {
      const resp = await safeFetch(service.monitorUrl, { purpose: "monitor", timeoutMs: 15000 });
      const expect = cfg.expectStatus || 200;
      if (resp.status !== expect) {
        return { source: "website", verdict: "problem", severity: "outage", title: `${service.name}: HTTP ${resp.status} (expected ${expect})`, body: `website monitor (${service.monitorUrl})`, link: service.monitorUrl, detail: `HTTP ${resp.status}` };
      }
      return { source: "website", verdict: "clear", detail: `HTTP ${resp.status} as expected` };
    }
    if (kind === "ssl") {
      // The ssl and dns checks open a connection straight to the host below, so they apply
      // the same address policy as a fetch rather than relying on one.
      await assertSafeOutboundUrl(service.monitorUrl, "monitor");
      const u = new URL(service.monitorUrl);
      const host = u.hostname;
      const port = u.port ? Number(u.port) : 443;
      const days = await new Promise<number>((resolve, reject) => {
        const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
          const cert = socket.getPeerCertificate();
          socket.destroy();
          const ms = Date.parse(String(cert.valid_to));
          if (isNaN(ms)) return reject(new Error("no certificate"));
          resolve(Math.floor((ms - Date.now()) / 86400000));
        });
        socket.on("error", reject);
      });
      const warnDays = cfg.sslWarnDays || 30;
      if (days <= 0) {
        return { source: "ssl", verdict: "problem", severity: "outage", title: `${service.name}: SSL certificate expired`, body: `ssl monitor (${service.monitorUrl})`, link: service.monitorUrl, detail: "certificate expired" };
      }
      if (days <= warnDays) {
        return { source: "ssl", verdict: "problem", severity: "informational", title: `${service.name}: SSL certificate expires in ${days} days`, body: `ssl monitor (${service.monitorUrl})`, link: service.monitorUrl, detail: `${days} days left` };
      }
      return { source: "ssl", verdict: "clear", detail: `certificate valid for ${days} more days` };
    }
    const u = new URL(service.monitorUrl);
    await assertSafeOutboundUrl(service.monitorUrl, "monitor");
    await dns.resolve4(u.hostname);
    return { source: "dns", verdict: "clear", detail: `${u.hostname} resolves` };
  } catch (e: any) {
    return {
      source: kind,
      verdict: "problem",
      severity: "outage",
      title: `${service.name}: ${kind} check failed: ${e?.message || e}`,
      body: `${kind} monitor (${service.monitorUrl})`,
      link: service.monitorUrl,
      detail: e?.message || String(e),
    };
  }
}

const SEVERITY_RANK: Record<string, number> = { informational: 0, degraded: 1, outage: 2 };

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/** The report worth showing as the alert: a titled source beats DownDetector's generic line. */
function primaryProblem(problems: SourceObservation[]): SourceObservation {
  const titled = problems.find((o) => o.source !== "downdetector" && o.title) ?? problems.find((o) => o.title);
  return titled ?? problems[0] ?? { source: "rss", verdict: "problem", detail: "unclassified problem report" };
}

function overallVerdict(observations: SourceObservation[]): SourceVerdict {
  if (observations.some((o) => o.verdict === "problem")) return "problem";
  if (observations.some((o) => o.verdict === "restored")) return "restored";
  if (observations.some((o) => o.verdict === "clear")) return "clear";
  return "unknown";
}

function describeSources(observations: SourceObservation[]): string {
  return observations.map((o) => `${o.source} ${o.verdict}`).join(", ") || "no monitored sources configured";
}

async function applyObservations(service: { id: string; name: string }, observations: SourceObservation[]): Promise<void> {
  const problems = observations.filter((o) => o.verdict === "problem");
  const restored = observations.filter((o) => o.verdict === "restored");
  const clears = observations.filter((o) => o.verdict === "clear");

  const active = await prisma.serviceAlert.findFirst({
    where: { serviceId: service.id, status: "active" },
    orderBy: { detectedAt: "desc" },
  });

  if (problems.length) {
    clearStreak.delete(service.id);
    const primary = primaryProblem(problems);
    const severity = problems.reduce<string>(
      (worst, p) => (severityRank(p.severity || "degraded") > severityRank(worst) ? p.severity || "degraded" : worst),
      "informational",
    );
    if (!active) {
      await prisma.serviceAlert.create({
        data: {
          serviceId: service.id,
          title: primary.title || `Possible outage reported for ${service.name}`,
          description: primary.body || null,
          severity,
          status: "active",
          source: primary.source,
          sourceUrl: primary.link || null,
          detectedAt: new Date(),
        },
      });
      snapshot.created++;
      log("warn", `New active alert for ${service.name}: ${primary.title} (${describeSources(problems)})`);
      return;
    }
    if (active.source === "manual") return; // a human is tracking this one
    const nextTitle = primary.title || active.title;
    const nextDescription = primary.body || active.description;
    const nextUrl = primary.link || active.sourceUrl;
    if (nextTitle !== active.title || nextDescription !== active.description || nextUrl !== active.sourceUrl || severity !== active.severity || primary.source !== active.source) {
      await prisma.serviceAlert.update({
        where: { id: active.id },
        data: { title: nextTitle, description: nextDescription, sourceUrl: nextUrl, severity, source: primary.source },
      });
      snapshot.updated++;
    }
    return;
  }

  if (!active || active.source === "manual") {
    clearStreak.delete(service.id);
    return;
  }

  const append = (reason: string) => `${reason}${active.description ? `\n\n${active.description}` : ""}`;

  const restoredItem = restored[0];
  if (restoredItem) {
    clearStreak.delete(service.id);
    await prisma.serviceAlert.update({
      where: { id: active.id },
      data: { status: "resolved", resolvedAt: new Date(), description: append(`Auto-resolved: ${restoredItem.title}`) },
    });
    snapshot.resolved++;
    log("info", `Auto-resolved alert for ${service.name}: ${restoredItem.title}`);
    return;
  }

  const alertAge = Date.now() - new Date(active.detectedAt).getTime();

  if (clears.length) {
    // At least one source is readable and positively clear and none reports a
    // problem - an unreadable source does not veto that. Two polls in a row,
    // so a single missed item cannot flap the alert off and on.
    const streak = (clearStreak.get(service.id) || 0) + 1;
    clearStreak.set(service.id, streak);
    if (streak >= REQUIRED_CLEAR_POLLS && alertAge >= POLL_INTERVAL_MS) {
      await prisma.serviceAlert.update({
        where: { id: active.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          description: append(`Auto-resolved: no monitored source reports an active incident or degradation for ${service.name} (${describeSources(observations)}).`),
        },
      });
      clearStreak.delete(service.id);
      snapshot.resolved++;
      log("info", `Auto-resolved alert for ${service.name} (all clear from ${clears.map((c) => c.source).join(", ")})`);
    }
    return;
  }

  // Nothing readable: no source can confirm or deny the incident. Hold the
  // alert - but not past the ceiling, or a permanently blocked source would
  // keep an incident from weeks ago on the banner.
  clearStreak.delete(service.id);
  if (alertAge < STALE_AFTER_MS) return;
  await prisma.serviceAlert.update({
    where: { id: active.id },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      description: append(`Auto-resolved as stale: no monitored source has reported this incident in the last ${STALE_AFTER_HOURS}h, so it is treated as over (${describeSources(observations)}).`),
    },
  });
  snapshot.staleResolved++;
  snapshot.resolved++;
  log("info", `Auto-resolved stale alert for ${service.name} (${STALE_AFTER_HOURS}h with no readable source: ${describeSources(observations)})`);
}

export async function runAlertCheck(): Promise<MonitorSnapshot> {
  const started = Date.now();
  snapshot.checkedServices = 0;
  snapshot.created = 0;
  snapshot.updated = 0;
  snapshot.resolved = 0;
  snapshot.staleResolved = 0;
  snapshot.errors = [];
  const sourceStatus: Record<string, ServiceSourceStatus> = {};
  downDetectorBlocked = 0;
  try {
    const services = await prisma.serviceAlertService.findMany({
      where: { enabled: true, monitorEnabled: true },
      orderBy: { sortOrder: "asc" },
    });
    for (const service of services) {
      snapshot.checkedServices++;
      try {
        const observations = (
          await Promise.all([
            observeFeed(service),
            observeStatusPage(service),
            observeDownDetector(service),
            observeMonitor(service),
            observeSocial(service),
          ])
        ).filter((o): o is SourceObservation => o !== null);
        sourceStatus[service.id] = {
          name: service.name,
          checkedAt: new Date().toISOString(),
          verdict: overallVerdict(observations),
          sources: observations.map((o) => ({ source: o.source, verdict: o.verdict, detail: o.detail })),
        };
        await applyObservations(service, observations);
      } catch (e: any) {
        snapshot.errors.push(`${service.name}: ${e?.message || String(e)}`);
      }
    }
    if (downDetectorBlocked > 0) {
      snapshot.errors.push(`DownDetector: ${downDetectorBlocked} page(s) returned a challenge page - treated as unknown, they no longer block auto-resolution`);
    }
    snapshot.sourceStatus = sourceStatus;
    snapshot.lastCheckAt = new Date().toISOString();
    snapshot.lastRunMs = Date.now() - started;
    log("info", `Check finished: ${services.length} services, ${snapshot.created} created, ${snapshot.updated} updated, ${snapshot.resolved} resolved (${snapshot.staleResolved} stale), ${snapshot.errors.length} errors`);
  } catch (e: any) {
    snapshot.lastCheckAt = new Date().toISOString();
    snapshot.lastRunMs = Date.now() - started;
    snapshot.errors.push(`monitor: ${e?.message || String(e)}`);
    log("error", `Monitor run failed: ${e?.message || e}`);
  }
  return snapshot;
}

export async function startAlertMonitor(): Promise<void> {
  await refreshSettings(true);
  readMonitorTiming();
  log("info", `Service Alerts monitor started (${POLL_INTERVAL_MS / 60000}-minute interval, ${STALE_AFTER_HOURS}h stale ceiling)`);
  // First run shortly after boot so the dashboard is populated quickly.
  setTimeout(() => { void runAlertCheck(); }, 20_000);
  setInterval(() => { void runAlertCheck(); }, POLL_INTERVAL_MS);
}
