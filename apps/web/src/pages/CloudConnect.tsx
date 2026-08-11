import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Plug, RefreshCw, Trash2, Key, Settings,
  ShieldCheck, Globe, Server, Cloud, CreditCard, FileText, Database,
  Wifi, Monitor, AlertTriangle, CheckCircle, XCircle, Loader2, X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────

interface FieldError {
  field: string;
  message: string;
  fix: string;
  example: string;
}

interface Integration {
  id: string; kind: string; name: string; enabled: boolean;
  status: string; lastSyncAt: string | null;
  credentials?: Record<string, string>;
  settings?: Record<string, any>;
}

interface SyncLog {
  id: string; entityType: string; status: string;
  recordsProcessed: number; recordsCreated: number; recordsUpdated: number;
  recordsFailed: number; startedAt: string; completedAt: string | null;
}

interface IntegrationType {
  kind: string; name: string; description: string;
  requiredCredentials: string[];
  requiredScopes?: string[];
  settings?: Array<{
    key: string; label: string; type: string; default?: any;
    options?: string[];
  }>;
}

const KIND_LABELS: Record<string, string> = {
  flexpoint: "Flexpoint Payments", quickbooks: "QuickBooks Online", pax8: "Pax8",
  avanan: "Avanan", proofpoint: "Proofpoint", sentinelone: "SentinelOne",
  itglue: "ITGlue", microsoft365: "Microsoft 365", azure: "Azure", aws: "AWS",
  connectwise: "ConnectWise PSA", halopsa: "HaloPSA",
  kantata: "Kantata", scoro: "Scoro", autotask: "AutoTask PSA",
  azure_ad_sso: "Azure AD SSO",
};

const KIND_ICONS: Record<string, LucideIcon> = {
  microsoft365: Server, azure: Cloud, azure_ad_sso: ShieldCheck,
  connectwise: Plug, halopsa: Plug, kantata: Plug, scoro: Plug,
  autotask: Plug, flexpoint: CreditCard, quickbooks: FileText,
  pax8: Globe, avanan: AlertTriangle, proofpoint: ShieldCheck,
  sentinelone: ShieldCheck, itglue: Database, aws: Cloud,
};

const POLL_INTERVAL_MS = 10000;

// ── Credential formatting ──────────────────────────────────────────

function formatCredLabel(cred: string): string {
  return cred.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
}

function isSecretCred(cred: string): boolean {
  const lower = cred.toLowerCase();
  return lower.includes("secret") || lower.includes("password") || lower.includes("key")
      || lower.includes("token") || lower === "privatekey" || lower === "apisecret";
}

// ── Main Component ──────────────────────────────────────────────────

export function CloudConnectPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [types, setTypes] = useState<IntegrationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState<IntegrationType | null>(null);
  const [credForm, setCredForm] = useState<Record<string, string>>({});
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({});
  const [formName, setFormName] = useState("");
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: "testing" | "pass" | "fail"; error?: string; fieldErrors?: FieldError[] }>>({});

  // ── Error Fix Dialog state ──
  const [fixDialog, setFixDialog] = useState<{
    open: boolean;
    integration: Integration;
    fieldErrors: FieldError[];
  } | null>(null);
  // Editable field values in the dialog (keyed by field name)
  const [fixFieldValues, setFixFieldValues] = useState<Record<string, string>>({});
  // Per-field test results within the dialog
  const [fixTestResults, setFixTestResults] = useState<Record<string, { status: "idle" | "testing" | "pass" | "fail"; error?: string }>>({});

  const fetchAll = useCallback(async () => {
    try {
      const [intRes, typeRes] = await Promise.all([
        api.get("/cloudconnect"),
        api.get("/cloudconnect/types"),
      ]);
      setIntegrations(intRes.data?.data || []);
      setTypes(typeRes.data?.types || []);
    } catch { /* silent — avoid toast storms on poll */ }
    finally { setLoading(false); }
  }, []);

  // Auto-poll for real-time state
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const fetchLogs = async (id: string) => {
    try {
      const res = await api.get(`/cloudconnect/${id}/sync-logs`);
      setSyncLogs(res.data?.data || []);
      setShowLogs(id);
    } catch { toast.error("Failed to load logs"); }
  };

  // ── Actions ──────────────────────────────────────────────────────

  const handleSelectType = (t: IntegrationType) => {
    setSelectedType(t);
    setCredForm({});
    setSettingsForm({});
    setFormName(t.name || KIND_LABELS[t.kind] || t.kind);
    if (t.settings) {
      const defaults: Record<string, any> = {};
      t.settings.forEach(s => { if (s.default !== undefined) defaults[s.key] = s.default; });
      setSettingsForm(defaults);
    }
    setShowAdd(true);
  };

  const handleCreate = async () => {
    try {
      await api.post("/cloudconnect", {
        kind: selectedType!.kind,
        name: formName,
        credentials: credForm,
        settings: settingsForm,
      });
      toast.success(`${selectedType!.name} connection created`);
      setShowAdd(false); setSelectedType(null);
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  const handleTest = async (id: string) => {
    setTestResults(p => ({ ...p, [id]: { status: "testing" } }));
    try {
      const res = await api.post(`/cloudconnect/${id}/test`);
      if (res.data.connected) {
        setTestResults(p => ({ ...p, [id]: { status: "pass" } }));
        fetchAll();
      } else {
        const errs: FieldError[] = res.data.fieldErrors || [];
        setTestResults(p => ({ ...p, [id]: { status: "fail", error: "Connection test failed", fieldErrors: errs } }));
        fetchAll();
      }
    } catch (e: any) {
      const errData = e?.response?.data;
      const msg = typeof errData?.error === "string" ? errData.error : "Connection failed";
      const errs: FieldError[] = errData?.fieldErrors || [];
      setTestResults(p => ({ ...p, [id]: { status: "fail", error: msg, fieldErrors: errs } }));
      fetchAll();
    }
  };

  // ── Error Fix Dialog handlers ──

  const openFixDialog = (integration: Integration, fieldErrors: FieldError[]) => {
    const vals: Record<string, string> = {};
    const tests: Record<string, { status: "idle" | "testing" | "pass" | "fail"; error?: string }> = {};
    for (const fe of fieldErrors) {
      vals[fe.field] = integration.credentials?.[fe.field] || "";
      tests[fe.field] = { status: "idle" };
    }
    setFixFieldValues(vals);
    setFixTestResults(tests);
    setFixDialog({ open: true, integration, fieldErrors });
  };

  const closeFixDialog = () => {
    setFixDialog(null);
    setFixFieldValues({});
    setFixTestResults({});
    fetchAll(); // refresh landing page
  };

  const testSingleField = async (field: string) => {
    if (!fixDialog) return;
    setFixTestResults(p => ({ ...p, [field]: { status: "testing" } }));
    try {
      // PATCH just this one field + test the full integration
      const creds = { ...fixDialog.integration.credentials, [field]: fixFieldValues[field] };
      await api.patch(`/cloudconnect/${fixDialog.integration.id}`, { credentials: creds });
      const res = await api.post(`/cloudconnect/${fixDialog.integration.id}/test`);
      if (res.data.connected) {
        setFixTestResults(p => ({ ...p, [field]: { status: "pass" } }));
        // Remove this field from the error list
        setFixDialog(prev => prev ? {
          ...prev,
          fieldErrors: prev.fieldErrors.filter(fe => fe.field !== field),
        } : null);
      } else {
        const remaining = (res.data.fieldErrors || []) as FieldError[];
        const thisFieldErr = remaining.find((r: FieldError) => r.field === field);
        const msg = thisFieldErr?.message || "Still failing";
        setFixTestResults(p => ({ ...p, [field]: { status: "fail", error: msg } }));
        // Update dialog errors with fresh server response
        if (remaining.length > 0) {
          setFixDialog(prev => prev ? { ...prev, fieldErrors: remaining } : null);
        }
      }
    } catch {
      setFixTestResults(p => ({ ...p, [field]: { status: "fail", error: "Test request failed" } }));
    }
  };

  const submitAllFixes = async () => {
    if (!fixDialog) return;
    try {
      const updatedCreds = { ...fixDialog.integration.credentials, ...fixFieldValues };
      await api.patch(`/cloudconnect/${fixDialog.integration.id}`, { credentials: updatedCreds });
      toast.success("Credentials updated");
      closeFixDialog();
    } catch { toast.error("Failed to save fixes"); }
  };

  const allFieldsPassed =
    fixDialog && fixDialog.fieldErrors.length === 0 &&
    Object.values(fixTestResults).every(r => r.status === "pass" || r.status === "idle");

  const handleSync = async (id: string) => {
    try { const r = await api.post(`/cloudconnect/${id}/sync`); toast.success(`Synced ${r.data?.recordsProcessed || 0} records`); fetchAll(); }
    catch { toast.error("Sync failed"); }
  };

  const handleToggle = async (id: string, v: boolean) => {
    try { await api.patch(`/cloudconnect/${id}`, { enabled: v }); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this connection?")) return;
    try { await api.delete(`/cloudconnect/${id}`); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  // ── Render Helpers ────────────────────────────────────────────────

  const statusColor = (s: string) =>
    s === "connected" ? "text-green-400 bg-green-600/20" :
    s === "error" ? "text-red-400 bg-red-600/20" : "text-gray-400 bg-gray-600/20";

  const IconFor = (kind: string): LucideIcon => KIND_ICONS[kind] || Plug;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">CloudConnect</h2><p className="text-sm text-gray-400 mt-0.5">Connect third-party services — 16 connectors available</p></div>
        {!showAdd && <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Connection</button>}
      </div>

      {/* Type Selection Grid */}
      {showAdd && !selectedType && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Select Service Type</h3>
            <button onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-white">Cancel</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {types.map(t => {
              const Icon = IconFor(t.kind);
              return (
                <button key={t.kind} onClick={() => handleSelectType(t)}
                  className="card hover:border-cyber-500/30 transition-colors text-left p-4 cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                      <Icon size={18} className="text-cyber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-medium text-sm truncate">{t.name}</p>
                      <p className="text-xs text-gray-500 truncate">{t.description?.slice(0, 60)}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Configuration Form */}
      {showAdd && selectedType && (
        <div className="card space-y-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Configure {selectedType.name}</h3>
            <button onClick={() => { setShowAdd(false); setSelectedType(null); }} className="text-gray-500 hover:text-white">Cancel</button>
          </div>
          <p className="text-sm text-gray-400 -mt-3">{selectedType.description}</p>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Connection Name</label>
            <input className="input-field" value={formName} onChange={e => setFormName(e.target.value)} />
          </div>
          {selectedType.requiredCredentials?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Key size={13} /> Credentials</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedType.requiredCredentials.map(c => (
                  <div key={c}>
                    <label className="text-xs text-gray-500 block mb-1">{formatCredLabel(c)}</label>
                    <input className="input-field" type={isSecretCred(c) ? "password" : "text"}
                      value={credForm[c] || ""} onChange={e => setCredForm(p => ({ ...p, [c]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {selectedType.settings?.length && <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase flex items-center gap-2"><Settings size={13} /> Settings</h4>
            {selectedType.settings.map(s => (
              s.type === "boolean" ? (
                <label key={s.key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={settingsForm[s.key] !== false}
                    onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-gray-300">{s.label}</span>
                </label>
              ) : s.type === "select" && s.options ? (
                <div key={s.key}><label className="text-xs text-gray-500 block mb-1">{s.label}</label>
                  <select className="input-field" value={settingsForm[s.key] || ""}
                    onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.value }))}>
                    {s.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select></div>
              ) : (
                <div key={s.key}><label className="text-xs text-gray-500 block mb-1">{s.label}</label>
                  <input className="input-field" type={s.type === "number" ? "number" : "text"}
                    value={settingsForm[s.key] ?? ""}
                    onChange={e => setSettingsForm(p => ({ ...p, [s.key]: s.type === "number" ? Number(e.target.value) : e.target.value }))} /></div>
              )
            ))}
          </div>}
          <div className="flex gap-3 pt-2">
            <button onClick={handleCreate} className="btn-primary">Create Connection</button>
            <button onClick={() => { setShowAdd(false); setSelectedType(null); }} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      {/* Integration List */}
      {!showAdd && (
        loading ? <div className="text-center py-8 text-gray-500"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> Loading...</div> :
        integrations.length === 0 ? <div className="card text-center py-8 text-gray-500">No connections configured.</div> :
        <div className="space-y-3">
          {integrations.map((int: any) => {
            const IconComp = IconFor(int.kind);
            const tr = testResults[int.id];
            return (
              <div key={int.id} className={`card space-y-4 ${int.enabled ? "border-l-2 border-l-cyber-500" : "opacity-60"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-cyber-600/10">
                      <IconComp size={18} className="text-cyber-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-medium text-sm truncate">{int.name}</p>
                        <span className={`badge text-xs ${statusColor(int.status)}`}>
                          {int.status === "connected" ? <CheckCircle size={10} className="inline mr-0.5" /> :
                           int.status === "error" ? <XCircle size={10} className="inline mr-0.5" /> : null}
                          {int.status || "disconnected"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{KIND_LABELS[int.kind] || int.kind}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => handleTest(int.id)} className={`p-1.5 rounded-md transition-colors ${
                      tr?.status === "testing" ? "text-yellow-400 bg-yellow-600/10" :
                      tr?.status === "pass" ? "text-green-400 bg-green-600/10" :
                      tr?.status === "fail" ? "text-red-400 bg-red-600/10" : "text-gray-500 hover:text-white hover:bg-surface-lighter"}`}
                      title="Test Connection">
                      {tr?.status === "testing" ? <Loader2 size={14} className="animate-spin" /> :
                       tr?.status === "pass" ? <CheckCircle size={14} /> :
                       tr?.status === "fail" ? <AlertTriangle size={14} /> : <Wifi size={14} />}
                    </button>
                    <button onClick={() => handleSync(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors" title="Sync">
                      <RefreshCw size={14} />
                    </button>
                    <button onClick={() => fetchLogs(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter transition-colors" title="Sync Logs">
                      <FileText size={14} />
                    </button>
                    <button onClick={() => handleToggle(int.id, !int.enabled)} className={`p-1.5 rounded-md transition-colors ${int.enabled ? "text-green-400" : "text-gray-500"} hover:bg-surface-lighter`}
                      title={int.enabled ? "Disable" : "Enable"}>
                      {int.enabled ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    </button>
                    <button onClick={() => handleDelete(int.id)} className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-surface-lighter transition-colors" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Clickable error banner → opens fix dialog */}
                {tr?.status === "fail" && (
                  <button
                    onClick={() => openFixDialog(int, tr.fieldErrors || [])}
                    className="w-full text-left bg-red-600/5 border border-red-500/20 rounded-lg p-3 text-sm hover:border-red-500/40 transition-colors cursor-pointer group"
                  >
                    <p className="text-red-400 font-medium flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Connection Failed — <span className="underline group-hover:text-red-300">Click to fix</span>
                    </p>
                    <p className="text-gray-400 text-xs mt-1">{tr.error}</p>
                    {tr.fieldErrors && tr.fieldErrors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {tr.fieldErrors.map((fe: FieldError) => (
                          <div key={fe.field} className="flex items-start gap-2 text-xs">
                            <span className="text-red-400 font-mono shrink-0">{formatCredLabel(fe.field)}:</span>
                            <span className="text-gray-500">{fe.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                )}

                {/* Sync Logs */}
                {showLogs === int.id && (
                  <div className="border-t border-surface-border pt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Recent Sync Logs</h4>
                    {syncLogs.length === 0 ? (
                      <p className="text-xs text-gray-600">No sync history yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {syncLogs.map(log => (
                          <div key={log.id} className="flex items-center justify-between text-xs bg-surface rounded p-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded ${log.status === "success" ? "bg-green-600/20 text-green-400" : log.status === "failed" ? "bg-red-600/20 text-red-400" : "bg-yellow-600/20 text-yellow-400"}`}>
                                {log.status}
                              </span>
                              <span className="text-gray-400">{log.entityType}</span>
                            </div>
                            <div className="flex items-center gap-3 text-gray-500">
                              <span>{log.recordsProcessed} processed</span>
                              <span>{new Date(log.startedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ Error Fix Dialog ═══ */}
      {fixDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeFixDialog}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-navy-800 border border-surface-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-surface-border">
              <div>
                <h3 className="text-white font-semibold text-base">Fix Connection Errors</h3>
                <p className="text-xs text-gray-500 mt-0.5">{fixDialog.integration.name} — {KIND_LABELS[fixDialog.integration.kind]}</p>
              </div>
              <button onClick={closeFixDialog} className="p-1 rounded-md text-gray-500 hover:text-white hover:bg-surface-lighter">
                <X size={18} />
              </button>
            </div>

            {/* Body: errored fields */}
            <div className="p-5 space-y-4">
              {fixDialog.fieldErrors.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                  <p className="text-white font-medium">All errors resolved!</p>
                  <p className="text-sm text-gray-400 mt-1">Click OK to save your fixes.</p>
                </div>
              ) : (
                fixDialog.fieldErrors.map((fe) => {
                  const ft = fixTestResults[fe.field];
                  return (
                    <div key={fe.field} className="card border-l-2 border-l-red-500 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white text-sm font-medium">{formatCredLabel(fe.field)}</p>
                          <p className="text-xs text-red-400 mt-0.5">{fe.message}</p>
                        </div>
                      </div>

                      {/* Fix instructions */}
                      <div className="bg-surface-lighter rounded-lg p-3 space-y-1 text-xs">
                        <p className="text-gray-400">
                          <span className="text-cyber-400 font-medium">Fix:</span> {fe.fix}
                        </p>
                        <p className="text-gray-500">
                          <span className="text-cyber-400 font-medium">Example:</span>{" "}
                          <code className="bg-surface px-1 py-0.5 rounded text-gray-300 font-mono">{fe.example}</code>
                        </p>
                      </div>

                      {/* Editable input + Test button */}
                      <div className="flex gap-2">
                        <input
                          className="input-field flex-1"
                          type={isSecretCred(fe.field) ? "password" : "text"}
                          value={fixFieldValues[fe.field] || ""}
                          onChange={e => setFixFieldValues(p => ({ ...p, [fe.field]: e.target.value }))}
                          placeholder={fe.example}
                        />
                        <button
                          onClick={() => testSingleField(fe.field)}
                          disabled={ft?.status === "testing"}
                          className={`px-3 py-2 rounded-lg text-xs font-medium shrink-0 transition-colors flex items-center gap-1.5 ${
                            ft?.status === "testing" ? "bg-yellow-600/20 text-yellow-400" :
                            ft?.status === "pass" ? "bg-green-600/20 text-green-400" :
                            ft?.status === "fail" ? "bg-red-600/20 text-red-400" :
                            "bg-cyber-600/20 text-cyber-400 hover:bg-cyber-600/30"
                          }`}
                        >
                          {ft?.status === "testing" ? <Loader2 size={12} className="animate-spin" /> :
                           ft?.status === "pass" ? <CheckCircle size={12} /> :
                           ft?.status === "fail" ? <XCircle size={12} /> : <Wifi size={12} />}
                          {ft?.status === "testing" ? "Testing..." :
                           ft?.status === "pass" ? "Pass" :
                           ft?.status === "fail" ? "Fail" : "Test"}
                        </button>
                      </div>

                      {/* Test result message */}
                      {ft?.status === "fail" && ft.error && (
                        <p className="text-xs text-red-400 flex items-center gap-1">
                          <XCircle size={10} /> {ft.error}
                        </p>
                      )}
                      {ft?.status === "pass" && (
                        <p className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle size={10} /> Verified — this field is now correct
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-5 border-t border-surface-border">
              <button onClick={closeFixDialog} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={submitAllFixes}
                disabled={!allFieldsPassed && fixDialog.fieldErrors.length > 0}
                className={`btn-primary text-sm ${(!allFieldsPassed && fixDialog.fieldErrors.length > 0) ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                OK — Save All Fixes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
