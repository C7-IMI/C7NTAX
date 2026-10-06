import { useState, useEffect, useCallback } from "react";
import api from "../api";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import toast from "react-hot-toast";
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

const SOURCE_LABELS: Record<string, string> = {
  rss: "RSS Feed",
  statuspage: "Status Page",
  downdetector: "DownDetector",
  website: "Website",
  ssl: "SSL",
  dns: "DNS",
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

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-gray-500">Loading Service Alerts…</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Alerts</h2>
          <p className="text-sm text-gray-400">
            Live status of critical cloud, SaaS, and ISP services, resolved from their vendor feeds, status-page APIs, DownDetector, and uptime monitors.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                {statusOf(a.service.id) && (
                  <div className="mt-2 pt-2 border-t border-surface-border/60">
                    <SourceChips status={statusOf(a.service.id)} />
                  </div>
                )}
              </div>
            </div>
          ))}
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

      {/* Recently resolved */}
      {resolved.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Recently Resolved</h3>
          <div className="card divide-y divide-surface-border !p-0">
            {resolved.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 truncate">
                    <span className="text-white font-medium">{a.service.name}</span> — {a.title}
                  </p>
                </div>
                <span className="text-xs text-gray-500 shrink-0">{a.resolvedAt ? `resolved ${timeAgo(a.resolvedAt)}` : "resolved"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
