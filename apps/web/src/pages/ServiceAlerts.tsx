import { useState, useEffect, useCallback } from "react";
import api from "../api";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import toast from "react-hot-toast";
import { PageHeader, Tabs } from "../components/ui";
import {
  AlertTriangle, WifiOff, Activity, CheckCircle2, RefreshCw, ExternalLink,
  Globe, TrendingDown, Info, ShieldCheck, CircleDot, Radio,
} from "lucide-react";

interface ServiceAlertItem {
  id: string;
  serviceId: string;
  title: string;
  description: string | null;
  severity: "outage" | "degraded" | "informational";
  status: "active" | "resolved";
  source: string;
  sourceUrl: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  service: { id: string; name: string; category: string; statusPageUrl: string | null; downDetectorUrl: string | null; rssUrl: string | null; sortOrder: number };
}

type SourceVerdict = "problem" | "restored" | "clear" | "unknown";

interface ServiceSourceStatus {
  name: string;
  checkedAt: string;
  verdict: SourceVerdict;
  sources: Array<{ source: string; verdict: SourceVerdict; detail: string }>;
}

interface MonitorSummary {
  lastCheckAt: string | null;
  checkedServices: number;
  pollIntervalMs: number;
  staleAfterHours: number;
}

interface AlertService {
  id: string;
  name: string;
  category: string;
  description: string | null;
  statusPageUrl: string | null;
  downDetectorUrl: string | null;
  rssUrl: string | null;
  monitorEnabled: boolean;
  enabled: boolean;
  sortOrder: number;
  sourceStatus: ServiceSourceStatus | null;
  alerts: ServiceAlertItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  cloud: "Cloud Platform",
  isp: "Internet Provider",
  telecom: "Telecom",
  collaboration: "Collaboration",
  other: "Other",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** The date and time behind a relative "2h ago", for the tooltip that a timestamp deserves. */
function absolute(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

/** The host of an advisory link, so the tooltip can say where it goes before it is opened. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

/** The page that explains an incident: its own source, or the vendor's status page behind it. */
function advisoryUrl(a: ServiceAlertItem): string | null {
  return a.sourceUrl || a.service.statusPageUrl || null;
}

const SOURCE_LABELS: Record<string, string> = {
  rss: "RSS Feed",
  statuspage: "Status Page",
  downdetector: "DownDetector",
  website: "Website",
  ssl: "SSL",
  dns: "DNS",
  social: "X (Twitter)",
  manual: "Manual",
};

const VERDICT_STYLE: Record<SourceVerdict, { dot: string; text: string; word: string }> = {
  clear: { dot: "bg-emerald-500", text: "text-emerald-300", word: "clear" },
  problem: { dot: "bg-red-500", text: "text-red-300", word: "reporting a problem" },
  restored: { dot: "bg-cyber-500", text: "text-cyber-300", word: "reports it recovered" },
  unknown: { dot: "bg-gray-600", text: "text-gray-500", word: "not readable" },
};

/** What each of a service's sources reported on the last poll. */
function SourceChips({ status }: { status: ServiceSourceStatus | null }) {
  if (!status) return null;
  if (status.sources.length === 0) {
    return <span className="text-xs text-gray-600">No monitored sources configured</span>;
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {status.sources.map((s) => {
        const v = VERDICT_STYLE[s.verdict];
        return (
          <span
            key={s.source}
            className={`inline-flex items-center gap-1.5 text-xs ${v.text}`}
            title={`${SOURCE_LABELS[s.source] || s.source}: ${v.word} — ${s.detail}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.dot}`} />
            {SOURCE_LABELS[s.source] || s.source}
          </span>
        );
      })}
    </div>
  );
}

export function ServiceAlertsPage() {
  const [services, setServices] = useState<AlertService[]>([]);
  const [active, setActive] = useState<ServiceAlertItem[]>([]);
  const [resolved, setResolved] = useState<ServiceAlertItem[]>([]);
  const [monitor, setMonitor] = useState<MonitorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"live" | "board">(() =>
    new URLSearchParams(window.location.search).get("tab") === "board" ? "board" : "live");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [alertsRes, servicesRes] = await Promise.all([
        api.get("/service-alerts"),
        api.get("/service-alerts/services"),
      ]);
      setActive(alertsRes.data?.data || []);
      setResolved(alertsRes.data?.resolved || []);
      setServices(servicesRes.data?.data || []);
      setMonitor(servicesRes.data?.monitor || null);
    } catch {
      if (!silent) toast.error("Could not load Service Alerts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // TOKEN-SAVE-06: visibility-gated background refresh
  useVisibilityPolling(() => void load(true), 60_000);

  const enabledServices = services
    .filter((s) => s.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const orderedActive = [...active].sort((a, b) =>
    a.service.sortOrder - b.service.sortOrder || new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
  );
  const outageCount = active.filter((a) => a.severity === "outage").length;
  const degradedCount = active.filter((a) => a.severity === "degraded").length;
  const operational = enabledServices.filter((s) => s.alerts.length === 0);
  const statusOf = (serviceId: string) => enabledServices.find((s) => s.id === serviceId)?.sourceStatus ?? null;
  const unreadableBySource = new Map<string, number>();
  enabledServices.forEach((s) => s.sourceStatus?.sources.forEach((src) => {
    if (src.verdict === "unknown") unreadableBySource.set(src.source, (unreadableBySource.get(src.source) ?? 0) + 1);
  }));
  const unreadable = [...unreadableBySource.entries()].sort((a, b) => b[1] - a[1]);

  /**
   * The outage board: one row per monitored service, problems first, each with its most recent
   * incident — active or already resolved — so the board answers "what is happening, and what
   * happened last" without anybody opening a service at a time.
   */
  const boardRows = enabledServices.map(s => {
    const activeAlert = s.alerts.find(a => a.status === "active") ?? null;
    const history = resolved.filter(a => a.serviceId === s.id);
    const lastIncident = activeAlert ?? history.sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))[0] ?? null;
    const state: "outage" | "degraded" | "notice" | "operational" = activeAlert
      ? (activeAlert.severity === "outage" ? "outage" : activeAlert.severity === "degraded" ? "degraded" : "notice")
      : "operational";
    const unreadableSources = (s.sourceStatus?.sources ?? []).filter(src => src.verdict === "unknown").length;
    const configuredSources = s.sourceStatus?.sources.length ?? 0;
    return { service: s, state, lastIncident, activeAlert, unreadableSources, configuredSources };
  }).sort((a, b) => {
    const rank = { outage: 0, degraded: 1, notice: 2, operational: 3 } as const;
    return rank[a.state] - rank[b.state] || a.service.sortOrder - b.service.sortOrder || a.service.name.localeCompare(b.service.name);
  });

  const notifyCount = boardRows.filter(r => r.state === "notice").length;
  const blindCount = boardRows.filter(r => r.configuredSources > 0 && r.configuredSources === r.unreadableSources).length;

  const STATE_STYLE = {
    outage: { badge: "bg-red-600/20 text-red-300", dot: "bg-red-500", icon: WifiOff, label: "Outage" },
    degraded: { badge: "bg-amber-500/20 text-amber-300", dot: "bg-amber-500", icon: TrendingDown, label: "Degraded" },
    notice: { badge: "bg-cyber-600/20 text-cyber-300", dot: "bg-cyber-500", icon: Info, label: "Notice" },
    operational: { badge: "bg-emerald-500/20 text-emerald-300", dot: "bg-emerald-500", icon: CheckCircle2, label: "Operational" },
  } as const;

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-gray-500">Loading Service Alerts…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <PageHeader variant="section" title="Service Alerts" subtitle="Live status of critical cloud, SaaS, and ISP services, resolved from their vendor feeds, status-page APIs, DownDetector, and uptime monitors." />
        <div className="flex items-center gap-2">
          <Tabs
            items={[{ id: "live", label: "Live" }, { id: "board", label: "Outage Board" }] as const}
            value={tab}
            onChange={setTab}
            label="Service Alerts view"
          />
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            onClick={() => { setRefreshing(true); void load(true); }}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {/* Monitor strip — how the poller is reading the sources right now */}
      {monitor && (
        <div className="card !py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <Activity size={13} className="text-cyber-400" />
            Polled {monitor.checkedServices || enabledServices.length} services{" "}
            {monitor.lastCheckAt ? timeAgo(monitor.lastCheckAt) : "—"} · every {Math.max(1, Math.round(monitor.pollIntervalMs / 60000))} min
          </span>
          <span className="inline-flex items-center gap-1.5" title="A source that cannot be read is reported as unknown: it can never be mistaken for an all-clear, and it never blocks the resolution the readable sources agree on">
            <Radio size={13} className={unreadable.length > 0 ? "text-amber-400" : "text-gray-500"} />
            {unreadable.length === 0
              ? "Every configured source is readable"
              : `Unreadable: ${unreadable.map(([source, count]) => `${SOURCE_LABELS[source] || source} ×${count}`).join(", ")}`}
          </span>
          <span className="inline-flex items-center gap-1.5" title="The resolver needs every readable source to agree before it retires an alert, and gives up on an alert nothing has reported for this long">
            <CheckCircle2 size={13} className="text-emerald-400" />
            Auto-resolves when every readable source agrees, or after {monitor.staleAfterHours}h with nothing reporting the incident
          </span>
        </div>
      )}

      {tab === "board" ? (
        <div className="space-y-4">
          {/* One line answering "how bad is it right now, and what are we blind to" */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {([
              { key: "outage", value: outageCount, label: "Outages" },
              { key: "degraded", value: degradedCount, label: "Degraded" },
              { key: "notice", value: notifyCount, label: "Notices" },
              { key: "operational", value: operational.length, label: "Operational" },
            ] as const).map(item => {
              const style = STATE_STYLE[item.key];
              return (
                <div key={item.key} className="card flex items-center gap-3 !py-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${style.badge}`}><style.icon size={17} /></div>
                  <div>
                    <p className="text-xl font-bold text-white leading-none">{item.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.label}</p>
                  </div>
                </div>
              );
            })}
            <div className="card flex items-center gap-3 !py-3" title="Services where every configured source is unreadable — nothing is being detected for them right now">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${blindCount > 0 ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}><Radio size={17} /></div>
              <div>
                <p className="text-xl font-bold text-white leading-none">{blindCount}</p>
                <p className="text-xs text-gray-400 mt-0.5">Unreadable</p>
              </div>
            </div>
          </div>

          <div className="card !p-0 overflow-hidden">
            <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-surface-border">
              <span className="col-span-3">Service</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-4">Last incident</span>
              <span className="col-span-3">Sources</span>
            </div>
            <div className="divide-y divide-surface-border">
              {boardRows.map(row => {
                const style = STATE_STYLE[row.state];
                const incident = row.lastIncident;
                return (
                  <div key={row.service.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 px-5 py-3 items-start">
                    <div className="md:col-span-3 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                        <span className="font-medium text-white text-sm truncate">{row.service.name}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{CATEGORY_LABELS[row.service.category] || row.service.category}</p>
                    </div>
                    <div className="md:col-span-2">
                      <span className={`badge ${style.badge}`}>{style.label}</span>
                    </div>
                    <div className="md:col-span-4 min-w-0">
                      {incident ? (
                        <>
                          <p className="text-sm text-gray-200 line-clamp-2">{incident.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {row.activeAlert ? "active" : "resolved"} · detected {timeAgo(incident.detectedAt)}
                            {incident.sourceUrl && (
                              <a href={incident.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-0.5">
                                source <ExternalLink size={11} />
                              </a>
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-500">No incident on record.</p>
                      )}
                    </div>
                    <div className="md:col-span-3 space-y-1.5">
                      <SourceChips status={row.service.sourceStatus} />
                      <div className="flex items-center gap-3 flex-wrap">
                        {row.service.downDetectorUrl && (
                          <a href={row.service.downDetectorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-cyber-300" title="DownDetector">
                            <Radio size={12} /> DownDetector
                          </a>
                        )}
                        {row.service.statusPageUrl && (
                          <a href={row.service.statusPageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-cyber-300" title="Official status page">
                            <Globe size={12} /> Status
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {boardRows.length === 0 && (
                <p className="px-5 py-6 text-sm text-gray-500">No monitored services are configured.</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Problems sort to the top. The board refreshes on the same poll as the rest of this page ({Math.max(1, Math.round((monitor?.pollIntervalMs ?? 300000) / 60000))} min), and only while the tab is visible.
            {monitor?.lastCheckAt && <> Last check {timeAgo(monitor.lastCheckAt)}.</>}
          </p>
        </div>
      ) : (
      <>
      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card flex items-center gap-3 !py-4">
          <div className="w-10 h-10 rounded-lg bg-red-600/15 text-red-400 flex items-center justify-center shrink-0"><WifiOff size={20} /></div>
          <div>
            <p className="text-2xl font-bold text-white leading-none">{outageCount}</p>
            <p className="text-xs text-gray-400 mt-1">Outages</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !py-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0"><TrendingDown size={20} /></div>
          <div>
            <p className="text-2xl font-bold text-white leading-none">{degradedCount}</p>
            <p className="text-xs text-gray-400 mt-1">Degraded</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !py-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0"><CheckCircle2 size={20} /></div>
          <div>
            <p className="text-2xl font-bold text-white leading-none">{operational.length}</p>
            <p className="text-xs text-gray-400 mt-1">Operational</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !py-4">
          <div className="w-10 h-10 rounded-lg bg-cyber-600/20 text-cyber-400 flex items-center justify-center shrink-0"><Activity size={20} /></div>
          <div>
            <p className="text-2xl font-bold text-white leading-none">{enabledServices.length}</p>
            <p className="text-xs text-gray-400 mt-1">Monitored Services</p>
          </div>
        </div>
      </div>

      {/* Active alerts */}
      {active.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Active Alerts</h3>
          {orderedActive.map((a) => (
            <div
              key={a.id}
              className={`card border-l-4 flex items-start gap-4 ${
                a.severity === "outage" ? "!border-l-red-500" : a.severity === "degraded" ? "!border-l-amber-500" : "!border-l-cyber-500"
              }`}
            >
              <div className={`mt-0.5 shrink-0 ${
                a.severity === "outage" ? "text-red-400" : a.severity === "degraded" ? "text-amber-400" : "text-cyber-400"
              }`}>
                <AlertTriangle size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{a.service.name}</span>
                  <span className={`badge ${
                    a.severity === "outage" ? "bg-red-600/20 text-red-300"
                    : a.severity === "degraded" ? "bg-amber-500/20 text-amber-300"
                    : "bg-cyber-600/20 text-cyber-300"
                  }`}>
                    {a.severity === "outage" ? "Outage" : a.severity === "degraded" ? "Degraded" : "Info"}
                  </span>
                  <span className="badge bg-surface-lighter text-gray-400">{SOURCE_LABELS[a.source] || a.source}</span>
                  <span className="text-xs text-gray-500">detected {timeAgo(a.detectedAt)}</span>
                </div>
                <p className="text-sm text-gray-200 mt-1">{a.title}</p>
                {a.description && <p className="text-xs text-gray-400 mt-0.5">{a.description}</p>}
                {a.sourceUrl && (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300 mt-1.5">
                    View source <ExternalLink size={12} />
                  </a>
                )}
                {statusOf(a.service.id)?.sources.length ? (
                  <div className="mt-2 pt-2 border-t border-surface-border">
                    <SourceChips status={statusOf(a.service.id)} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Recently resolved — above the cards, because what just cleared is the more useful thing to
          see first when you open this page. Each row links to the advisory behind it: "GitHub had an
          incident" is only useful next to the page that says what the incident was. */}
      {resolved.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Recently Resolved</h3>
          <div className="card !p-0 overflow-hidden">
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_8rem_8rem] items-center gap-3 px-5 py-2 border-b border-surface-border text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <span>Incident</span>
              <span>First reported</span>
              <span className="text-right">Resolved</span>
            </div>
            <div className="divide-y divide-surface-border">
              {resolved.slice(0, 8).map((a) => {
                const url = advisoryUrl(a);
                const host = hostOf(url);
                // An incident's own link goes to the advisory; a service status page is a fair place to
                // look when there is none, but it is not the same thing and the tooltip says so.
                const own = Boolean(a.sourceUrl);
                const target = own ? "the advisory" : "the status page";
                return (
                  <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] sm:grid-cols-[minmax(0,1fr)_8rem_8rem] items-center gap-3 px-5 py-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                      <p className="text-sm text-gray-300 truncate">
                        <span className="text-white font-medium">{a.service.name}</span> —{" "}
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-cyber-300 hover:underline"
                            aria-label={`${a.service.name}: ${a.title} — open ${target}${host ? ` on ${host}` : ""}`}
                            // The title is clipped to one line on the card, so the tooltip carries it in
                            // full and says where the link goes: both halves of "what is this, and what
                            // happens if I click it".
                            data-tooltip={`${a.title} — open ${target}${host ? ` on ${host}` : ""}`}
                          >
                            {a.title}
                            <ExternalLink size={11} className="inline-block ml-1 align-[-1px]" />
                          </a>
                        ) : (
                          a.title
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-gray-500" title={absolute(a.detectedAt) || undefined}>
                      {a.detectedAt ? timeAgo(a.detectedAt) : "—"}
                    </span>
                    <span className="text-xs text-gray-500 text-right" title={absolute(a.resolvedAt) || undefined}>
                      {a.resolvedAt ? timeAgo(a.resolvedAt) : "resolved"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Service cards */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Monitored Services</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {enabledServices.map((s) => {
            const a = s.alerts[0];
            const status = a ? (a.severity === "outage" ? "outage" : a.severity === "degraded" ? "degraded" : "info") : "operational";
            return (
              <div key={s.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      status === "outage" ? "bg-red-600/15 text-red-400"
                      : status === "degraded" ? "bg-amber-500/15 text-amber-400"
                      : "bg-emerald-500/15 text-emerald-400"
                    }`}>
                      {status === "operational" ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{s.name}</p>
                      <p className="text-xs text-gray-500">{CATEGORY_LABELS[s.category] || s.category}</p>
                    </div>
                  </div>
                  <span className={`badge shrink-0 ${
                    status === "outage" ? "bg-red-600/20 text-red-300"
                    : status === "degraded" ? "bg-amber-500/20 text-amber-300"
                    : "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    {status === "outage" ? "Outage" : status === "degraded" ? "Degraded" : status === "info" ? "Notice" : "Operational"}
                  </span>
                </div>

                {a ? (
                  <div className="text-xs">
                    <p className="text-gray-200 font-medium line-clamp-2">{a.title}</p>
                    {a.description && <p className="text-gray-500 mt-1 line-clamp-2">{a.description}</p>}
                    <p className="text-gray-600 mt-1.5">detected {timeAgo(a.detectedAt)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 flex-1">{s.description || "No active alerts for this service."}</p>
                )}

                <div className="space-y-2 pt-1 border-t border-surface-border">
                  <SourceChips status={s.sourceStatus} />
                  <div className="flex items-center gap-3">
                    {s.statusPageUrl && (
                      <a href={s.statusPageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-cyber-300 transition-colors" title="Official status page">
                        <Globe size={13} /> Status
                      </a>
                    )}
                    {s.downDetectorUrl && (
                      <a href={s.downDetectorUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-cyber-300 transition-colors" title="DownDetector">
                        <Radio size={13} /> DownDetector
                      </a>
                    )}
                    {s.rssUrl && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600" title="RSS monitored">
                        <CircleDot size={13} /> RSS
                      </span>
                    )}
                    {!s.monitorEnabled && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600"><Info size={13} /> Manual</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      </>
      )}
    </div>
  );
}
