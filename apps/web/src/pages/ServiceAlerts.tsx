import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import toast from "react-hot-toast";
import {
  AlertTriangle, WifiOff, Activity, CheckCircle2, RefreshCw, ExternalLink,
  Globe, TrendingDown, Info, ShieldCheck, CircleDot, Radio, Settings,
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
  service: { id: string; name: string; category: string; statusPageUrl: string | null; downDetectorUrl: string | null; rssUrl: string | null };
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
  manual: "Manual",
};

export function ServiceAlertsPage() {
  const [services, setServices] = useState<AlertService[]>([]);
  const [active, setActive] = useState<ServiceAlertItem[]>([]);
  const [resolved, setResolved] = useState<ServiceAlertItem[]>([]);
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

  const enabledServices = services.filter((s) => s.enabled);
  const outageCount = active.filter((a) => a.severity === "outage").length;
  const degradedCount = active.filter((a) => a.severity === "degraded").length;
  const operational = enabledServices.filter((s) => s.alerts.length === 0);

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
            Live status of critical cloud, SaaS, and ISP services monitored from RSS feeds, status pages, and DownDetector.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/service-alerts" className="btn-secondary text-sm flex items-center gap-1.5">
            <Settings size={15} /> Configure
          </Link>
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            onClick={() => { setRefreshing(true); void load(true); }}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

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
          {active.map((a) => (
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

                <div className="flex items-center gap-3 pt-1 border-t border-surface-border">
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
