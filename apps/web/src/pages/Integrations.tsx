import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Plug, RefreshCw, Trash2 } from "lucide-react";

interface Integration { id: string; kind: string; name: string; enabled: boolean; status: string; lastSyncAt: string | null; }

const KIND_LABELS: Record<string, string> = {
  flexpoint: "Flexpoint Payments", quickbooks: "QuickBooks Online", pax8: "Pax8",
  avanan: "Avanan", proofpoint: "Proofpoint", sentinelone: "SentinelOne",
  itglue: "ITGlue", microsoft365: "Microsoft 365", azure: "Azure", aws: "AWS",
};

export function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ kind: "", name: "", apiKey: "" });

  const fetchAll = async () => {
    try {
      const [intRes, typeRes] = await Promise.all([api.get("/integrations"), api.get("/integrations/types")]);
      setIntegrations(intRes.data);
      setTypes(typeRes.data);
    } catch { toast.error("Failed to load integrations"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/integrations", { ...form, credentials: { apiKey: form.apiKey } });
      toast.success("Integration added");
      setShowAdd(false);
      setForm({ kind: "", name: "", apiKey: "" });
      fetchAll();
    } catch { toast.error("Failed to add integration"); }
  };

  const handleSync = async (id: string) => {
    try {
      const res = await api.post(`/integrations/${id}/sync`);
      toast.success(res.data.success ? `Synced ${res.data.recordsProcessed} records` : "Sync failed");
      fetchAll();
    } catch { toast.error("Sync failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this integration?")) return;
    try {
      await api.delete(`/integrations/${id}`);
      toast.success("Integration removed");
      fetchAll();
    } catch { toast.error("Failed to remove"); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading integrations...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Integrations</h2><p className="text-sm text-gray-400">{integrations.length} configured</p></div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Integration</button>
      </div>

      {showAdd && (
        <div className="card">
          <form onSubmit={handleAdd} className="space-y-3">
            <select className="input-field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, name: KIND_LABELS[e.target.value] || "" })} required>
              <option value="">Select service...</option>
              {types.map((t) => <option key={t} value={t}>{KIND_LABELS[t] || t}</option>)}
            </select>
            <input className="input-field" placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input-field" placeholder="API Key" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">Add</button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integrations.map((i) => (
          <div key={i.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${i.status === "connected" ? "bg-green-600/10" : i.status === "error" ? "bg-red-600/10" : "bg-gray-600/10"}`}>
                <Plug size={18} className={i.status === "connected" ? "text-green-400" : i.status === "error" ? "text-red-400" : "text-gray-500"} />
              </div>
              <div>
                <h3 className="font-medium text-white text-sm">{i.name || KIND_LABELS[i.kind] || i.kind}</h3>
                <p className="text-xs text-gray-500">{i.status}{i.lastSyncAt ? ` · Last sync: ${new Date(i.lastSyncAt).toLocaleString()}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => handleSync(i.id)} className="p-1.5 text-gray-500 hover:text-cyber-400 transition-colors" title="Sync"><RefreshCw size={15} /></button>
              <button onClick={() => handleDelete(i.id)} className="p-1.5 text-gray-500 hover:text-red-400 transition-colors" title="Remove"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {integrations.length === 0 && !loading && (
        <div className="text-center py-12 card">
          <Plug size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No integrations configured</p>
          <p className="text-xs text-gray-600 mt-1">Connect QuickBooks, Pax8, Microsoft 365, and more</p>
        </div>
      )}
    </div>
  );
}
