import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Search, Monitor, Server, Laptop, Wifi, Edit3, Trash2, AlertTriangle } from "lucide-react";

interface KumoAsset {
  id: string; name: string; templateId: string; status: string; companyId: string | null;
  template?: { name: string; icon?: string; color?: string };
  createdAt: string;
}

export function KumoAssetsPage() {
  const [assets, setAssets] = useState<KumoAsset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({ name: "" });
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const navigate = useNavigate();

  const fetchAll = async () => {
    try {
      const [aRes, tRes] = await Promise.all([
        api.get("/kumo/assets"),
        api.get("/kumo/templates"),
      ]);
      setAssets(aRes.data.data || []);
      setTemplates(tRes.data.data || []);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const filtered = assets.filter(a => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (templateFilter && a.templateId !== templateFilter) return false;
    return true;
  });

  const startCreate = (tpl?: any) => {
    setSelectedTemplate(tpl || null);
    setForm({ name: "" });
    setFieldValues({});
    setShowCreate(true);
    if (tpl) {
      const defaults: Record<string, any> = {};
      tpl.fields?.forEach((f: any) => {
        if (f.defaultValue !== undefined && f.defaultValue !== null) defaults[f.key] = f.defaultValue;
      });
      setFieldValues(defaults);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/kumo/assets", {
        templateId: selectedTemplate.id,
        name: form.name,
        fieldValues,
      });
      toast.success("Asset created");
      setShowCreate(false);
      fetchAll();
    } catch { toast.error("Failed to create"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this asset?")) return;
    try { await api.delete(`/kumo/assets/${id}`); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const iconMap: Record<string, any> = { Monitor, Server, Laptop, Wifi };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Kumo Assets</h2>
          <p className="text-sm text-gray-400">{filtered.length} assets</p>
        </div>
        <button onClick={() => startCreate()} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} /> New Asset
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={templateFilter} onChange={e => setTemplateFilter(e.target.value)}>
          <option value="">All Templates</option>
          {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Templates quick-create */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {templates.filter((t:any) => t.isActive).map((tpl: any) => {
          const Icon = iconMap[tpl.icon || "Monitor"] || Monitor;
          return (
            <button key={tpl.id} onClick={() => startCreate(tpl)}
              className="card hover:border-cyber-500/30 transition-colors p-3 text-left group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20">
                  <Icon size={16} className="text-cyber-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white">{tpl.name}</p>
                  <p className="text-[10px] text-gray-500">{tpl.fields?.length || 0} fields</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Asset list */}
      {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> :
       filtered.length === 0 ? <div className="card text-center py-8 text-gray-500">No assets found</div> :
       <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-400">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 hidden md:table-cell">Template</th>
              <th className="px-4 py-3 hidden sm:table-cell">Status</th>
              <th className="px-4 py-3 w-20"></th>
            </tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 cursor-pointer"
                  onClick={() => navigate(`/kumo/assets/${a.id}`)}>
                  <td className="px-4 py-3 text-white font-medium">{a.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">{a.template?.name || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`badge text-xs ${a.status === "active" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={e => { e.stopPropagation(); handleDelete(a.id); }}
                      className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-lg mx-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">
              {selectedTemplate ? `New ${selectedTemplate.name}` : "New Asset"}
            </h3>
            {!selectedTemplate ? (
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Select Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {templates.filter((t:any) => t.isActive).map((tpl: any) => (
                    <button type="button" key={tpl.id} onClick={() => startCreate(tpl)}
                      className="card p-3 text-left hover:border-cyber-500/30 transition-colors">
                      <p className="text-sm text-white">{tpl.name}</p>
                      <p className="text-xs text-gray-500">{tpl.description?.slice(0, 40)}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Name *</label>
                  <input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
                </div>
                {selectedTemplate.fields?.map((f: any) => (
                  <div key={f.key}>
                    <label className="text-xs text-gray-500 block mb-1">
                      {f.label} {f.required && <span className="text-red-400">*</span>}
                    </label>
                    {f.fieldType === "boolean" ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={fieldValues[f.key] === true}
                          onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.checked }))} />
                        <span className="text-sm text-gray-300">{f.helpText || f.label}</span>
                      </label>
                    ) : f.fieldType === "select" && f.options ? (
                      <select className="input-field" value={fieldValues[f.key] || ""}
                        onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}>
                        <option value="">—</option>
                        {(Array.isArray(f.options) ? f.options : []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="input-field" type={f.fieldType === "number" ? "number" : "text"}
                        placeholder={f.placeholder || ""}
                        value={fieldValues[f.key] || ""}
                        onChange={e => setFieldValues(p => ({ ...p, [f.key]: f.fieldType === "number" ? Number(e.target.value) : e.target.value }))}
                        required={f.required} />
                    )}
                    {f.helpText && <p className="text-[10px] text-gray-600 mt-0.5">{f.helpText}</p>}
                  </div>
                ))}
              </>
            )}
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
              {selectedTemplate && <button type="submit" className="btn-primary text-sm">Create</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
