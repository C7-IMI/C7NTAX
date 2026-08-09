import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Plug, RefreshCw, Trash2, Key, Settings, Users, Building, ShieldCheck } from "lucide-react";

interface Integration {
  id: string; kind: string; name: string; enabled: boolean;
  status: string; lastSyncAt: string | null; settings?: Record<string, any>;
}

interface SyncLog {
  id: string; entityType: string; status: string;
  recordsProcessed: number; recordsCreated: number; recordsUpdated: number;
  recordsFailed: number; startedAt: string; completedAt: string | null;
}

const KIND_LABELS: Record<string, string> = {
  flexpoint: "Flexpoint Payments", quickbooks: "QuickBooks Online", pax8: "Pax8",
  avanan: "Avanan", proofpoint: "Proofpoint", sentinelone: "SentinelOne",
  itglue: "ITGlue", microsoft365: "Microsoft 365", azure: "Azure", aws: "AWS",
  connectwise: "ConnectWise PSA", halopsa: "HaloPSA",
  kantata: "Kantata", scoro: "Scoro", autotask: "AutoTask PSA",
};

const M365_SCOPES = [
  "User.Read.All", "Group.Read.All", "Organization.Read.All",
  "Directory.Read.All", "SubscribedSku.Read.All", "offline_access",
];

const PERMISSION_SCOPES: Record<string, string> = {
  "User.Read.All": "Read all user profiles",
  "Group.Read.All": "Read all groups",
  "Organization.Read.All": "Read organization info",
  "Directory.Read.All": "Read directory data",
  "SubscribedSku.Read.All": "Read license/subscription info",
  "offline_access": "Maintain access without user presence",
};

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedKind, setSelectedKind] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showLogs, setShowLogs] = useState<string | null>(null);

  // M365-specific form fields
  const [m365Form, setM365Form] = useState({
    name: "Microsoft 365", tenantId: "", clientId: "", clientSecret: "",
    syncIntervalMinutes: "60", syncUsers: true, syncContacts: true,
    fieldMapping: JSON.stringify({
      displayName: "firstName",
      mail: "email",
      jobTitle: "title",
      mobilePhone: "phone",
    }, null, 2),
  });

  const fetchAll = async () => {
    try {
      const [intRes, typeRes] = await Promise.all([
        api.get("/integrations"),
        api.get("/integrations/types"),
      ]);
      setIntegrations(intRes.data?.data || []);
      setTypes(typeRes.data?.types || []);
    } catch {
      toast.error("Failed to load integrations");
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (integrationId: string) => {
    try {
      const res = await api.get(`/integrations/${integrationId}/logs`);
      setSyncLogs(res.data);
      setShowLogs(integrationId);
    } catch {
      toast.error("Failed to load sync logs");
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAdd = async (kind: string) => {
    setSelectedKind(kind);
    setShowAdd(true);
    if (kind === "microsoft365") {
      setM365Form(prev => ({ ...prev, name: "Microsoft 365" }));
    } else {
      setForm({ kind, name: "", apiKey: "" });
    }
  };

  const handleCreateM365 = async () => {
    try {
      await api.post("/integrations/microsoft365", {
        name: m365Form.name,
        credentials: {
          tenantId: m365Form.tenantId,
          clientId: m365Form.clientId,
          clientSecret: m365Form.clientSecret,
        },
        settings: {
          syncIntervalMinutes: parseInt(m365Form.syncIntervalMinutes) || 60,
          syncUsers: m365Form.syncUsers,
          syncContacts: m365Form.syncContacts,
          fieldMapping: JSON.parse(m365Form.fieldMapping || "{}"),
        },
      });
      toast.success("Microsoft 365 integration created");
      setShowAdd(false);
      fetchAll();
    } catch {
      toast.error("Failed to create integration");
    }
  };

  const handleCreate = async () => {
    try {
      await api.post("/integrations", form);
      toast.success("Integration created");
      setShowAdd(false);
      setForm({ kind: "", name: "", apiKey: "" });
      fetchAll();
    } catch {
      toast.error("Failed to create integration");
    }
  };

  const handleTest = async (id: string) => {
    try {
      await api.post(`/integrations/${id}/test`);
      toast.success("Connection successful");
      fetchAll();
    } catch {
      toast.error("Connection failed");
    }
  };

  const handleSync = async (id: string) => {
    try {
      const res = await api.post(`/integrations/${id}/sync`);
      toast.success(`Synced ${res.data.recordsProcessed || 0} records`);
      fetchAll();
    } catch {
      toast.error("Sync failed");
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/integrations/${id}`, { enabled });
      fetchAll();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this integration?")) return;
    try {
      await api.delete(`/integrations/${id}`);
      toast.success("Deleted");
      fetchAll();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const statusColor = (s: string) =>
    s === "connected" ? "text-green-400 bg-green-600/20" :
    s === "error" ? "text-red-400 bg-red-600/20" : "text-gray-400 bg-gray-600/20";

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Integrations</h2>
          <p className="text-sm text-gray-400 mt-0.5">Connect third-party services</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} /> Add Integration
        </button>
      </div>

      {/* Available integration types */}
      {showAdd && !selectedKind && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Select Integration Type
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {types.map((t: any) => (
              <button
                key={t.kind}
                onClick={() => handleAdd(t.kind)}
                className="card hover:border-cyber-500/30 transition-colors text-left p-4 cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20 transition-colors">
                    {t.kind === "microsoft365" ? (
                      <Building size={18} className="text-cyber-400" />
                    ) : (
                      <Plug size={18} className="text-cyber-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {KIND_LABELS[t.kind] || t.name || t.kind}
                    </p>
                    <p className="text-xs text-gray-500">{t.description || t.kind}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAdd(false)}
            className="text-sm text-gray-500 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Microsoft 365 Configuration Form */}
      {showAdd && selectedKind === "microsoft365" && (
        <div className="card space-y-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              Configure Microsoft 365 Integration
            </h3>
            <button
              onClick={() => { setShowAdd(false); setSelectedKind(""); }}
              className="text-gray-500 hover:text-white"
            >
              Cancel
            </button>
          </div>

          {/* Azure AD App Registration */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Key size={13} /> Azure AD Authentication
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Tenant ID *</label>
                <input
                  className="input-field"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={m365Form.tenantId}
                  onChange={e => setM365Form(p => ({ ...p, tenantId: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Integration Name</label>
                <input
                  className="input-field"
                  value={m365Form.name}
                  onChange={e => setM365Form(p => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Client ID *</label>
                <input
                  className="input-field"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={m365Form.clientId}
                  onChange={e => setM365Form(p => ({ ...p, clientId: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Client Secret *</label>
                <input
                  className="input-field"
                  type="password"
                  placeholder="Enter client secret"
                  value={m365Form.clientSecret}
                  onChange={e => setM365Form(p => ({ ...p, clientSecret: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* Permission Scopes */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-2">
              <ShieldCheck size={13} /> Required API Permissions
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {M365_SCOPES.map(scope => (
                <div key={scope} className="flex items-center gap-2 text-xs text-gray-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyber-400" />
                  <span className="font-mono text-[11px]">{scope}</span>
                  <span className="text-gray-600">
                    — {PERMISSION_SCOPES[scope] || ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Sync Settings */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Settings size={13} /> Sync Configuration
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  Sync Interval (minutes)
                </label>
                <input
                  className="input-field"
                  type="number"
                  min="5"
                  value={m365Form.syncIntervalMinutes}
                  onChange={e =>
                    setM365Form(p => ({ ...p, syncIntervalMinutes: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-end gap-3 pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={m365Form.syncUsers}
                    onChange={e =>
                      setM365Form(p => ({ ...p, syncUsers: e.target.checked }))
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-300">Sync Users</span>
                </label>
              </div>
              <div className="flex items-end gap-3 pb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={m365Form.syncContacts}
                    onChange={e =>
                      setM365Form(p => ({ ...p, syncContacts: e.target.checked }))
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-300">Import as Contacts</span>
                </label>
              </div>
            </div>
          </div>

          {/* Field Mapping */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-2">
              <Users size={13} /> Field Mapping (M365 → Contact)
            </h4>
            <textarea
              className="input-field font-mono text-xs"
              rows={6}
              value={m365Form.fieldMapping}
              onChange={e =>
                setM365Form(p => ({ ...p, fieldMapping: e.target.value }))
              }
              placeholder='{"displayName": "firstName", "mail": "email", ...}'
            />
            <p className="text-xs text-gray-600 mt-1">
              JSON mapping of Microsoft Graph user properties to Contact fields.
              Available M365 properties: displayName, givenName, surname, mail, jobTitle,
              department, officeLocation, mobilePhone, businessPhones, usageLocation
            </p>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
            <button
              onClick={() => { setShowAdd(false); setSelectedKind(""); }}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button onClick={handleCreateM365} className="btn-primary">
              Save & Connect
            </button>
          </div>
        </div>
      )}

      {/* Generic Integration Form (non-M365) */}
      {showAdd && selectedKind && selectedKind !== "microsoft365" && (
        <div className="card space-y-4 animate-fade-in">
          <h3 className="text-lg font-semibold text-white">
            Add {KIND_LABELS[selectedKind] || selectedKind}
          </h3>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Name</label>
            <input
              className="input-field"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">API Key / Token</label>
            <input
              className="input-field"
              type="password"
              value={form.apiKey}
              onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAdd(false); setSelectedKind(""); }} className="btn-secondary">Cancel</button>
            <button onClick={handleCreate} className="btn-primary">Save</button>
          </div>
        </div>
      )}

      {/* Integration List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : integrations.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No integrations configured. Add one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {integrations.map((int: any) => (
            <div key={int.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-cyber-600/10">
                    {int.kind === "microsoft365" ? (
                      <Building size={18} className="text-cyber-400" />
                    ) : (
                      <Plug size={18} className="text-cyber-400" />
                    )}
                  </div>
                  <div>
                    <p className="text-white font-medium">{int.name}</p>
                    <p className="text-xs text-gray-500">
                      {KIND_LABELS[int.kind] || int.kind}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${statusColor(int.status)}`}>
                    {int.status}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={int.enabled}
                      onChange={e => handleToggle(int.id, e.target.checked)}
                    />
                    <div className="w-8 h-4 bg-gray-600 rounded-full peer peer-checked:bg-cyber-600 peer-focus:ring-1 peer-focus:ring-cyber-400 transition-colors" />
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleTest(int.id)}
                  className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                >
                  <Plug size={11} /> Test
                </button>
                <button
                  onClick={() => handleSync(int.id)}
                  className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                >
                  <RefreshCw size={11} /> Sync
                </button>
                <button
                  onClick={() => fetchLogs(int.id)}
                  className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                >
                  Logs
                </button>
                <button
                  onClick={() => handleDelete(int.id)}
                  className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 size={11} />
                </button>
                {int.lastSyncAt && (
                  <span className="text-xs text-gray-600">
                    Last sync: {new Date(int.lastSyncAt).toLocaleString()}
                  </span>
                )}
              </div>

              {/* Sync Logs Panel */}
              {showLogs === int.id && (
                <div className="mt-3 pt-3 border-t border-surface-border">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2">
                    Sync History
                  </h4>
                  {syncLogs.length === 0 ? (
                    <p className="text-xs text-gray-600">No sync logs yet</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {syncLogs.map(log => (
                        <div
                          key={log.id}
                          className="flex items-center justify-between text-xs py-1 px-2 rounded bg-surface-lighter"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`badge text-[10px] ${
                                log.status === "success"
                                  ? "bg-green-600/20 text-green-400"
                                  : log.status === "failed"
                                  ? "bg-red-600/20 text-red-400"
                                  : "bg-amber-600/20 text-amber-400"
                              }`}
                            >
                              {log.status}
                            </span>
                            <span className="text-gray-400">{log.entityType}</span>
                          </div>
                          <div className="text-gray-500 flex items-center gap-3">
                            <span>
                              {log.recordsCreated}c / {log.recordsUpdated}u /{" "}
                              {log.recordsFailed}f
                            </span>
                            <span>
                              {new Date(log.startedAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
