import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Monitor } from "lucide-react";

interface Asset { id: string; name: string; assetTag: string; type: string; status: string; serialNumber?: string; company?: { name: string }; }

const TYPE_COLORS: Record<string, string> = { hardware: "bg-blue-600/20 text-blue-400", software: "bg-purple-600/20 text-purple-400", license: "bg-amber-600/20 text-amber-400", peripheral: "bg-gray-600/20 text-gray-400", network: "bg-cyber-600/20 text-cyber-400" };
const STATUS_COLORS: Record<string, string> = { available: "bg-green-600/20 text-green-400", assigned: "bg-cyber-600/20 text-cyber-400", retired: "bg-gray-600/20 text-gray-400", lost: "bg-red-600/20 text-red-400" };

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "" });

  const fetch = async () => { try { const r = await api.get("/inventory/assets"); setAssets(r.data.data); } catch { toast.error("Failed"); } finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/inventory/assets", form); toast.success("Asset created"); setShowNew(false); fetch(); } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Asset Inventory</h2><p className="text-sm text-gray-400">{assets.length} assets</p></div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Asset</button>
      </div>

      {showNew && (
        <div className="card"><form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="input-field" placeholder="Asset name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            <input className="input-field" placeholder="Asset tag" value={form.assetTag} onChange={e => setForm({...form, assetTag: e.target.value})} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>{Object.keys(TYPE_COLORS).map(t => <option key={t} value={t}>{t}</option>)}</select>
            <input className="input-field" placeholder="Serial number" value={form.serialNumber} onChange={e => setForm({...form, serialNumber: e.target.value})} />
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Add</button><button type="button" onClick={() => setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
        </form></div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : assets.length === 0 ? (
        <div className="text-center py-12 card"><Monitor size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No assets tracked</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Asset</th><th className="p-3">Tag</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Serial</th></tr></thead>
          <tbody>{assets.map(a => (
            <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
              <td className="p-3"><p className="font-medium text-white">{a.name}</p>{a.company && <p className="text-xs text-gray-500">{a.company.name}</p>}</td>
              <td className="p-3 text-gray-300 font-mono text-xs">{a.assetTag}</td>
              <td className="p-3"><span className={`badge ${TYPE_COLORS[a.type] || ""}`}>{a.type}</span></td>
              <td className="p-3"><span className={`badge ${STATUS_COLORS[a.status] || ""}`}>{a.status}</span></td>
              <td className="p-3 text-gray-500 text-xs font-mono">{a.serialNumber || "-"}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}
