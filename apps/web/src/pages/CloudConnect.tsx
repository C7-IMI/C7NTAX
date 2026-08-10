import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Plug, RefreshCw, Trash2, Key, Settings, Users, Building,
  ShieldCheck, Globe, Server, Cloud, CreditCard, FileText, Database,
  Wifi, Monitor, AlertTriangle, CheckCircle, XCircle, Loader2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────

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
  microsoft365: Building, azure: Cloud, azure_ad_sso: ShieldCheck,
  connectwise: Plug, halopsa: Plug, kantata: Plug, scoro: Plug,
  autotask: Plug, flexpoint: CreditCard, quickbooks: FileText,
  pax8: Globe, avanan: AlertTriangle, proofpoint: ShieldCheck,
  sentinelone: ShieldCheck, itglue: Database, aws: Cloud,
};

// ── Credential field help text (module-level) ───────────────────

const CRED_HELP: Record<string, string> = {
  tenantid: "Your directory tenant ID or domain (e.g., contoso.onmicrosoft.com)",
  clientid: "Application (client) ID from the app registration",
  clientsecret: "Client secret value or certificate thumbprint",
  apikey: "API key or access token from the service provider",
  apisecret: "API secret or signing key",
  domain: "Your organization domain (e.g., contoso.com)",
  username: "Service account email or username",
  password: "Service account password or app password",
  instanceurl: "Full URL of your instance (e.g., https://company.halopsa.com)",
  webhooksecret: "Secret used to validate incoming webhooks",
  accesstoken: "OAuth access token or personal access token",
  refreshtoken: "OAuth refresh token for long-lived sessions",
  subscriptionkey: "Azure subscription key or equivalent",
  awsaccesskeyid: "AWS IAM access key ID (starts with AKIA)",
  awssecretaccesskey: "AWS IAM secret access key",
  region: "AWS region (e.g., us-east-1)",
};

function getCredHelp(field: string): string | null {
  const lower = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (CRED_HELP[lower]) return CRED_HELP[lower];
  for (const [key, help] of Object.entries(CRED_HELP)) {
    if (lower.includes(key) || key.includes(lower)) return help;
  }
  return null;
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
  const [testResults, setTestResults] = useState<Record<string, { status: "testing" | "pass" | "fail"; error?: string; fieldErrors?: Record<string, string> }>>({});

  const fetchAll = async () => {
    try {
      const [intRes, typeRes] = await Promise.all([
        api.get("/cloudconnect"),
        api.get("/cloudconnect/types"),
      ]);
      setIntegrations(intRes.data?.data || []);
      setTypes(typeRes.data?.types || []);
    } catch { toast.error("Failed to load CloudConnect integrations"); }
    finally { setLoading(false); }
  };

  const fetchLogs = async (id: string) => {
    try {
      const res = await api.get(`/cloudconnect/${id}/sync-logs`);
      setSyncLogs(res.data?.data || []);
      setShowLogs(id);
    } catch { toast.error("Failed to load logs"); }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Actions ──────────────────────────────────────────────────────

  const handleSelectType = (t: IntegrationType) => {
    setSelectedType(t);
    setCredForm({});
    setSettingsForm({});
    setFormName(t.name || KIND_LABELS[t.kind] || t.kind);
    // Pre-fill settings defaults
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
      await api.post(`/cloudconnect/${id}/test`);
      setTestResults(p => ({ ...p, [id]: { status: "pass" } }));
      fetchAll();
    } catch (e: any) {
      const errData = e?.response?.data?.error;
      const msg = typeof errData === "string" ? errData : errData?.message || "Connection failed";
      // Parse field-level errors from the response
      let fieldErrors: Record<string, string> | undefined;
      if (e?.response?.data?.fieldErrors) {
        fieldErrors = e.response.data.fieldErrors;
      } else if (msg.toLowerCase().includes("tenant") || msg.toLowerCase().includes("domain")) {
        fieldErrors = { tenantId: msg };
      } else if (msg.toLowerCase().includes("client id") || msg.toLowerCase().includes("app")) {
        fieldErrors = { clientId: msg };
      } else if (msg.toLowerCase().includes("secret") || msg.toLowerCase().includes("password")) {
        fieldErrors = { clientSecret: msg };
      }
      setTestResults(p => ({ ...p, [id]: { status: "fail", error: msg, fieldErrors } }));
    }
  };

  const handleSync = async (id: string) => {
    try { const r = await api.post(`/cloudconnect/${id}/sync`); toast.success(`Synced ${r.data?.recordsProcessed || 0} records`); fetchAll(); }
    catch { toast.error("Sync failed"); }
  };

  const handleToggle = async (id: string, v: boolean) => {
    try { await api.patch(`/cloudconnect/${id}`, { enabled: v }); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete?")) return;
    try { await api.delete(`/cloudconnect/${id}`); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  // ── Render Helpers ────────────────────────────────────────────────

  const statusColor = (s: string) =>
    s === "connected" ? "text-green-400 bg-green-600/20" :
    s === "error" ? "text-red-400 bg-red-600/20" : "text-gray-400 bg-gray-600/20";

  function renderCredField(cred: string) {
    const isSecret = cred.toLowerCase().includes("secret") || cred.toLowerCase().includes("password") || cred.toLowerCase().includes("key");
    const help = getCredHelp(cred);
    return (
      <div key={cred}>
        <label className="text-xs text-gray-500 block mb-1 capitalize">{cred.replace(/([A-Z])/g, " $1").trim()}</label>
        <input
          className="input-field"
          type={isSecret ? "password" : "text"}
          placeholder={help ? help.slice(0, 70) + "…" : `Enter ${cred}`}
          value={credForm[cred] || ""}
          onChange={e => setCredForm(p => ({ ...p, [cred]: e.target.value }))}
        />
        {help && <p className="text-[10px] text-gray-600 mt-1">{help}</p>}
      </div>
    );
  }

  function renderSettingsField(s: IntegrationType["settings"] extends Array<infer T> ? T : any) {
    if (!s) return null;
    if (s.type === "boolean") {
      return (
        <label key={s.key} className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={settingsForm[s.key] !== false}
            onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.checked }))} className="rounded" />
          <span className="text-sm text-gray-300">{s.label}</span>
        </label>
      );
    }
    if (s.type === "select" && s.options) {
      return (
        <div key={s.key}>
          <label className="text-xs text-gray-500 block mb-1">{s.label}</label>
          <select className="input-field" value={settingsForm[s.key] || ""}
            onChange={e => setSettingsForm(p => ({ ...p, [s.key]: e.target.value }))}>
            {s.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    if (s.type === "json") {
      return (
        <div key={s.key}>
          <label className="text-xs text-gray-500 block mb-1">{s.label}</label>
          <textarea className="input-field font-mono text-xs" rows={4}
            value={typeof settingsForm[s.key] === "string" ? settingsForm[s.key] : JSON.stringify(settingsForm[s.key] || {}, null, 2)}
            onChange={e => { try { setSettingsForm(p => ({ ...p, [s.key]: JSON.parse(e.target.value) })); } catch { setSettingsForm(p => ({ ...p, [s.key]: e.target.value })); } }}
          />
        </div>
      );
    }
    return (
      <div key={s.key}>
        <label className="text-xs text-gray-500 block mb-1">{s.label}</label>
        <input className="input-field" type={s.type === "number" ? "number" : "text"}
          value={settingsForm[s.key] ?? ""}
          onChange={e => setSettingsForm(p => ({ ...p, [s.key]: s.type === "number" ? Number(e.target.value) : e.target.value }))}
        />
      </div>
    );
  }

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

          {/* Name */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Connection Name</label>
            <input className="input-field" value={formName} onChange={e => setFormName(e.target.value)} />
          </div>

          {/* Credentials */}
          {selectedType.requiredCredentials?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Key size={13} /> Credentials</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedType.requiredCredentials.map(c => renderCredField(c))}
              </div>
            </div>
          )}

          {/* Settings */}
          {selectedType.settings?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Settings size={13} /> Settings</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {selectedType.settings.map(s => renderSettingsField(s))}
              </div>
            </div>
          )}

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

                {/* Test Result Details */}
                {tr?.status === "fail" && (
                  <div className="bg-red-600/5 border border-red-500/20 rounded-lg p-3 text-sm">
                    <p className="text-red-400 font-medium flex items-center gap-1.5"><AlertTriangle size={13} /> Connection Failed</p>
                    <p className="text-gray-400 text-xs mt-1">{tr.error}</p>
                    {tr.fieldErrors && (
                      <div className="mt-2 space-y-1">
                        {Object.entries(tr.fieldErrors).map(([field, msg]) => (
                          <div key={field} className="flex items-start gap-2 text-xs">
                            <span className="text-red-400 font-mono shrink-0">{field}:</span>
                            <span className="text-gray-500">{msg}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
    </div>
  );
}
