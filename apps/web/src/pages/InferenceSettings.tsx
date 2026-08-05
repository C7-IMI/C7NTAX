import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Zap, Trash2, Check, X, Cpu, TestTube } from "lucide-react";

interface Provider { id: string; name: string; provider: string; model: string; isActive: boolean; isDefault: boolean; hasApiKey: boolean; temperature: number; maxTokens: number; }

const PROVIDER_LABELS: Record<string, string> = {
  local: "Local (keyword search only)", openai: "OpenAI", anthropic: "Anthropic (Claude)",
  azure_openai: "Azure OpenAI", custom: "Custom Endpoint",
};

export function InferenceSettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "local", model: "gpt-4o-mini", apiKey: "", apiEndpoint: "", temperature: 0.3, maxTokens: 2000, isActive: false, isDefault: false });
  const [testing, setTesting] = useState<string | null>(null);

  const fetch = async () => {
    try { const r = await api.get("/inference/providers"); setProviders(r.data); }
    catch { toast.error("Failed to load providers"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/inference/providers", form); toast.success("Provider added"); setShowForm(false); setForm({ name: "", provider: "local", model: "gpt-4o-mini", apiKey: "", apiEndpoint: "", temperature: 0.3, maxTokens: 2000, isActive: false, isDefault: false }); fetch(); }
    catch { toast.error("Failed"); }
  };

  const handleToggle = async (id: string, field: "isActive" | "isDefault", value: boolean) => {
    try { await api.patch(`/inference/providers/${id}`, { [field]: value }); fetch(); toast.success("Updated"); }
    catch { toast.error("Failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this provider?")) return;
    try { await api.delete(`/inference/providers/${id}`); fetch(); toast.success("Removed"); }
    catch { toast.error("Failed"); }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try { const r = await api.post(`/inference/providers/${id}/test`); toast.success(r.data.success ? "Connection OK" : "Connection failed"); }
    catch { toast.error("Test failed"); }
    finally { setTesting(null); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">AI Inference Configuration</h2>
          <p className="text-sm text-gray-400 mt-0.5">Configure AI providers for ticket analysis and solution suggestions</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Provider</button>
      </div>

      {/* Info card about local mode */}
      <div className="card border-cyber-600/30 bg-cyber-600/5">
        <div className="flex items-start gap-3">
          <Cpu size={20} className="text-cyber-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-medium text-white text-sm">How it works</h3>
            <p className="text-sm text-gray-400 mt-1">
              The inference engine layers keyword search with optional LLM enrichment. The <strong>Local</strong> provider
              uses PostgreSQL full-text search to find similar resolved tickets — no API key needed. Add an LLM provider
              (OpenAI, Anthropic, Azure) for AI-generated solution analysis. Set one provider as <strong>Default</strong> for the ticket screen.
            </p>
          </div>
        </div>
      </div>

      {/* Add provider form */}
      {showForm && (
        <div className="card">
          <h3 className="font-semibold text-white mb-4">New Provider</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field" placeholder="Display name" value={form.name}
                onChange={e => setForm({...form, name: e.target.value})} required />
              <select className="input-field" value={form.provider}
                onChange={e => setForm({...form, provider: e.target.value, model: e.target.value === "local" ? "" : form.model})}>
                {Object.entries(PROVIDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {form.provider !== "local" && (
              <>
                <input className="input-field" placeholder="Model name (e.g. gpt-4o-mini)" value={form.model}
                  onChange={e => setForm({...form, model: e.target.value})} required />
                <div className="grid grid-cols-2 gap-3">
                  <input className="input-field" type="password" placeholder="API Key" value={form.apiKey}
                    onChange={e => setForm({...form, apiKey: e.target.value})} />
                  <input className="input-field" placeholder="Custom endpoint URL (optional)" value={form.apiEndpoint}
                    onChange={e => setForm({...form, apiEndpoint: e.target.value})} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-xs text-gray-500">Temperature</label>
                    <input className="input-field" type="number" min={0} max={2} step={0.1} value={form.temperature}
                      onChange={e => setForm({...form, temperature: Number(e.target.value)})} /></div>
                  <div><label className="text-xs text-gray-500">Max Tokens</label>
                    <input className="input-field" type="number" min={100} max={32000} step={100} value={form.maxTokens}
                      onChange={e => setForm({...form, maxTokens: Number(e.target.value)})} /></div>
                  <div className="flex items-end gap-4 pb-2">
                    <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={form.isActive}
                      onChange={e => setForm({...form, isActive: e.target.checked})} /> Active</label>
                    <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={form.isDefault}
                      onChange={e => setForm({...form, isDefault: e.target.checked})} /> Default</label>
                  </div>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">Add Provider</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Provider list */}
      {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> : providers.length === 0 ? (
        <div className="text-center py-12 card">
          <Zap size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No AI providers configured</p>
          <p className="text-xs text-gray-600 mt-1">Add a local provider (no API key needed) or connect an LLM</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map(p => (
            <div key={p.id} className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${p.isActive ? "bg-green-600/10" : "bg-gray-600/10"}`}>
                  <Zap size={18} className={p.isActive ? "text-green-400" : "text-gray-500"} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-white text-sm">{p.name}</h3>
                    {p.isDefault && <span className="badge bg-cyber-600/20 text-cyber-400">Default</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {PROVIDER_LABELS[p.provider] || p.provider} {p.model ? `· ${p.model}` : ""} · temp: {p.temperature} · max tokens: {p.maxTokens}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${p.isActive ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                  {p.isActive ? "Active" : "Inactive"}
                </span>
                <button onClick={() => handleToggle(p.id, "isActive", !p.isActive)}
                  className="text-xs px-2 py-1 rounded hover:bg-surface-lighter text-gray-400 hover:text-white transition-colors"
                  title={p.isActive ? "Deactivate" : "Activate"}>
                  {p.isActive ? <X size={14} /> : <Check size={14} />}
                </button>
                <button onClick={() => handleToggle(p.id, "isDefault", !p.isDefault)}
                  className={`text-xs px-2 py-1 rounded hover:bg-surface-lighter transition-colors ${p.isDefault ? "text-cyber-400" : "text-gray-400 hover:text-white"}`}
                  title={p.isDefault ? "Unset default" : "Set as default"}>
                  {p.isDefault ? "★" : "☆"}
                </button>
                {p.provider !== "local" && (
                  <button onClick={() => handleTest(p.id)} disabled={testing === p.id}
                    className="text-xs px-2 py-1 rounded hover:bg-surface-lighter text-gray-400 hover:text-cyber-400 transition-colors"
                    title="Test connection">
                    {testing === p.id ? <div className="animate-spin h-3 w-3 border border-cyber-400 border-t-transparent rounded-full" /> : <TestTube size={14} />}
                  </button>
                )}
                <button onClick={() => handleDelete(p.id)}
                  className="text-xs px-2 py-1 rounded hover:bg-red-600/10 text-gray-400 hover:text-red-400 transition-colors"
                  title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
