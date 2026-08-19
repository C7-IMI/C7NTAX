import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  AlertTriangle, Plus, Pencil, Trash2, RefreshCw, Globe, Rss, TrendingDown,
  Power, EyeOff, Activity, TerminalSquare,
} from "lucide-react";

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
  alerts: Array<{ id: string; title: string; severity: string; status: string }>;
}

interface MonitorSnapshot {
  lastCheckAt: string | null;
  lastRunMs: number | null;
  checkedServices: number;
  created: number;
  updated: number;
  resolved: number;
  errors: string[];
  log: Array<{ at: string; level: string; msg: string }>;
}

const CATEGORIES = ["cloud", "isp", "telecom", "collaboration", "other"];

const emptyForm = {
  id: "",
  name: "",
  category: "other",
  description: "",
  statusPageUrl: "",
  downDetectorUrl: "",
  rssUrl: "",
  monitorEnabled: true,
  enabled: true,
  sortOrder: 0,
};

export function ServiceAlertsSettingsPage() {
  const [services, setServices] = useState<AlertService[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitor, setMonitor] = useState<MonitorSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState({ serviceId: "", title: "", severity: "degraded" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [svc, mon] = await Promise.all([
        api.get("/service-alerts/services"),
        api.get("/service-alerts/monitor-status").catch(() => ({ data: null })),
      ]);
      setServices(svc.data?.data || svc.data || []);
      setMonitor(mon.data || null);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to load Service Alerts configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runCheck = async () => {
    setRefreshing(true);
    try {
      const r = await api.post("/service-alerts/refresh");
      toast.success(`Monitor check complete — ${r.data?.created || 0} created, ${r.data?.resolved || 0} resolved`);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Monitor check failed");
    } finally {
      setRefreshing(false);
    }
  };

  const openNew = () => { setForm({ ...emptyForm }); setEditing(false); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setForm({ ...emptyForm }); setEditing(false); };
  const openEdit = (s: AlertService) => {
    setForm({
      id: s.id, name: s.name, category: s.category, description: s.description || "",
      statusPageUrl: s.statusPageUrl || "", downDetectorUrl: s.downDetectorUrl || "",
      rssUrl: s.rssUrl || "", monitorEnabled: s.monitorEnabled, enabled: s.enabled, sortOrder: s.sortOrder,
    });
    setEditing(true);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Service name is required"); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        description: form.description || null,
        statusPageUrl: form.statusPageUrl || null,
        downDetectorUrl: form.downDetectorUrl || null,
        rssUrl: form.rssUrl || null,
        monitorEnabled: form.monitorEnabled,
        enabled: form.enabled,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) {
        await api.patch(`/service-alerts/services/${form.id}`, payload);
        toast.success("Service updated");
      } else {
        await api.post("/service-alerts/services", payload);
        toast.success("Service added");
      }
      setForm({ ...emptyForm }); setEditing(false); setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: AlertService) => {
    if (!window.confirm(`Delete "${s.name}" and all of its alert history?`)) return;
    try {
      await api.delete(`/service-alerts/services/${s.id}`);
      toast.success("Service deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Delete failed");
    }
  };

  const toggleEnabled = async (s: AlertService, enabled: boolean) => {
    try {
      await api.patch(`/service-alerts/services/${s.id}`, { enabled });
      setServices(prev => prev.map(x => x.id === s.id ? { ...x, enabled } : x));
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Update failed");
    }
  };

  const createManualAlert = async () => {
    if (!manual.serviceId || !manual.title.trim()) { toast.error("Select a service and enter a title"); return; }
    try {
      await api.post("/service-alerts", {
        serviceId: manual.serviceId,
        title: manual.title.trim(),
        severity: manual.severity,
        description: "Created manually from the Service Alerts administration page.",
      });
      toast.success("Manual alert created — the outage banner is now active");
      setManual({ serviceId: "", title: "", severity: "degraded" });
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Failed to create alert");
    }
  };

  const activeAlerts = services.reduce((n, s) => n + s.alerts.length, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Alerts — Administration</h2>
          <p className="text-sm text-gray-400">Configure monitored services, RSS/status feeds, and the outage alerting mechanism.</p>
        </div>
        <button onClick={runCheck} disabled={refreshing} className="btn-primary text-sm flex items-center gap-1.5">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Checking…" : "Run Monitor Check Now"}
        </button>
      </div>

      {/* Monitor status */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-cyber-400" />
          <h3 className="text-sm font-semibold text-white">Alerting Mechanism</h3>
          <span className="badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active — polls RSS feeds every 5 minutes</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div className="bg-surface-lighter/50 rounded-lg p-3 border border-surface-border">
            <p className="text-gray-500 text-xs">Last check</p>
            <p className="text-white font-medium">{monitor?.lastCheckAt ? new Date(monitor.lastCheckAt).toLocaleString() : "Not run yet"}</p>
          </div>
          <div className="bg-surface-lighter/50 rounded-lg p-3 border border-surface-border">
            <p className="text-gray-500 text-xs">Services polled</p>
            <p className="text-white font-medium">{monitor?.checkedServices ?? 0}</p>
          </div>
          <div className="bg-surface-lighter/50 rounded-lg p-3 border border-surface-border">
            <p className="text-gray-500 text-xs">Alerts created (last run)</p>
            <p className="text-white font-medium">{monitor?.created ?? 0}</p>
          </div>
          <div className="bg-surface-lighter/50 rounded-lg p-3 border border-surface-border">
            <p className="text-gray-500 text-xs">Auto-resolved (last run)</p>
            <p className="text-white font-medium">{monitor?.resolved ?? 0}</p>
          </div>
          <div className="bg-surface-lighter/50 rounded-lg p-3 border border-surface-border">
            <p className="text-gray-500 text-xs">Active alerts</p>
            <p className={`font-medium ${activeAlerts > 0 ? "text-red-400" : "text-emerald-400"}`}>{activeAlerts}</p>
          </div>
        </div>
        {(monitor?.errors?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 max-h-32 overflow-y-auto">
            <p className="text-xs font-medium text-amber-400 mb-1 flex items-center gap-1.5"><TerminalSquare size={12} /> Feed errors from last check</p>
            {monitor!.errors.map((e, i) => <p key={i} className="text-xs text-amber-200/80 font-mono">{e}</p>)}
          </div>
        )}
      </div>

      {/* Manual alert */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Create Manual Alert</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Service</label>
            <select className="input-field" value={manual.serviceId} onChange={e => setManual(m => ({ ...m, serviceId: e.target.value }))}>
              <option value="">Select service…</option>
              {services.filter(s => s.enabled).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500 block mb-1">Alert title</label>
            <input className="input-field" placeholder="e.g. Possible Service Interruption has been reported for …" value={manual.title} onChange={e => setManual(m => ({ ...m, title: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Severity</label>
            <select className="input-field" value={manual.severity} onChange={e => setManual(m => ({ ...m, severity: e.target.value }))}>
              <option value="outage">Outage</option>
              <option value="degraded">Degraded</option>
              <option value="informational">Informational</option>
            </select>
          </div>
          <div className="md:col-span-4 flex justify-end">
            <button onClick={createManualAlert} className="btn-secondary text-sm flex items-center gap-1.5">
              <Plus size={14} /> Create Alert
            </button>
          </div>
        </div>
      </div>

      {/* Services table */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Globe size={16} className="text-cyber-400" /> Monitored Services ({services.length})</h3>
          <button onClick={openNew} className="btn-primary text-sm flex items-center gap-1.5"><Plus size={14} /> Add Service</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading services…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-surface-border">
                  <th className="px-5 py-3 font-medium">Service</th>
                  <th className="px-3 py-3 font-medium">Category</th>
                  <th className="px-3 py-3 font-medium">Sources</th>
                  <th className="px-3 py-3 font-medium">Active Alerts</th>
                  <th className="px-3 py-3 font-medium">Visible</th>
                  <th className="px-3 py-3 font-medium">Feed Polling</th>
                  <th className="px-3 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map(s => (
                  <tr key={s.id} className={`border-b border-surface-border/60 ${s.enabled ? "" : "opacity-50"}`}>
                    <td className="px-5 py-3">
                      <p className="text-white font-medium">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-500 truncate max-w-[260px]">{s.description}</p>}
                    </td>
                    <td className="px-3 py-3 text-gray-400 capitalize">{s.category}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {s.rssUrl && <span className="badge bg-surface-lighter text-gray-300"><Rss size={11} /> RSS</span>}
                        {s.statusPageUrl && <span className="badge bg-surface-lighter text-gray-300"><Globe size={11} /> Status</span>}
                        {s.downDetectorUrl && <span className="badge bg-surface-lighter text-gray-300"><TrendingDown size={11} /> DownDetector</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {s.alerts.length > 0
                        ? <span className="badge bg-red-500/10 text-red-400 border border-red-500/20">{s.alerts.length}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => toggleEnabled(s, !s.enabled)}
                        className="text-gray-400 hover:text-white p-1 rounded"
                        title={s.enabled ? "Disable on dashboard" : "Enable on dashboard"}
                      >
                        {s.enabled ? <Power size={16} className="text-emerald-400" /> : <EyeOff size={16} className="text-gray-600" />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => { void api.patch(`/service-alerts/services/${s.id}`, { monitorEnabled: !s.monitorEnabled }).then(load).catch(() => {}); }} className="text-gray-400 hover:text-white p-1 rounded" title={s.monitorEnabled ? "Feed polling on" : "Feed polling off"}>
                        <Activity size={16} className={s.monitorEnabled ? "text-cyber-400" : "text-gray-600"} />
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(s)} className="text-gray-400 hover:text-cyber-400 p-1.5 rounded" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => void remove(s)} className="text-gray-400 hover:text-red-400 p-1.5 rounded" title="Delete"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={closeForm}>
          <div className="card w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-4">{editing ? "Edit Service" : "Add Service"}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name *</label>
                <input className="input-field" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Microsoft 365" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Category</label>
                <select className="input-field" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Description</label>
                <input className="input-field" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">Official status page URL</label>
                <input className="input-field" value={form.statusPageUrl} onChange={e => setForm(f => ({ ...f, statusPageUrl: e.target.value }))} placeholder="https://status.example.com" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">DownDetector URL</label>
                <input className="input-field" value={form.downDetectorUrl} onChange={e => setForm(f => ({ ...f, downDetectorUrl: e.target.value }))} placeholder="https://downdetector.com/status/…" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500 block mb-1">RSS feed URL (polled by the alerting mechanism)</label>
                <input className="input-field" value={form.rssUrl} onChange={e => setForm(f => ({ ...f, rssUrl: e.target.value }))} placeholder="https://status.example.com/rss" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Sort order</label>
                <input type="number" className="input-field" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) }))} />
              </div>
              <div className="flex items-end gap-4 pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} className="accent-cyber-500" />
                  Show on dashboard
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={form.monitorEnabled} onChange={e => setForm(f => ({ ...f, monitorEnabled: e.target.checked }))} className="accent-cyber-500" />
                  Poll RSS feed
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeForm} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">{saving ? "Saving…" : "Save Service"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
