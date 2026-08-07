import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Monitor, Search, Link2, CheckCircle } from "lucide-react";

interface Asset { id: string; name: string; assetTag: string; type: string; status: string; serialNumber?: string; model?: string; location?: string; }
const TC: Record<string, string> = { hardware: "bg-blue-600/20 text-blue-400", software: "bg-purple-600/20 text-purple-400", license: "bg-amber-600/20 text-amber-400", server: "bg-green-600/20 text-green-400", laptop: "bg-indigo-600/20 text-indigo-400" };
const SC: Record<string, string> = { available: "bg-green-600/20 text-green-400", assigned: "bg-cyber-600/20 text-cyber-400", maintenance: "bg-amber-600/20 text-amber-400", retired: "bg-gray-600/20 text-gray-400" };

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "", location: "" });
  const [showAssign, setShowAssign] = useState<Asset | null>(null);
  const [assignForm, setAssignForm] = useState({ assignedToId: "", ticketId: "", notes: "" });
  const [users, setUsers] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);

  const fetch = () => { api.get("/inventory/assets?limit=200").then(r => setAssets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { fetch(); api.get("/users?limit=50").then(r => setUsers(r.data.data || [])).catch(() => {}); }, []);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault(); try { await api.post("/inventory/assets", form); toast.success("Created"); setShowNew(false); setForm({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "", location: "" }); fetch(); } catch { toast.error("Failed"); } };
  const handleCheckout = async () => { if (!showAssign) return; try { await api.post(`/inventory/assets/${showAssign.id}/checkout`, assignForm); toast.success("Checked out"); setShowAssign(null); fetch(); } catch { toast.error("Failed"); } };
  const filtered = assets.filter(a => (!search || a.name.toLowerCase().includes(search.toLowerCase()) || a.assetTag.toLowerCase().includes(search.toLowerCase())));
  const activeCount = assets.filter(a => a.status !== "retired").length;

  return (<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3"><div><h2 className="text-lg font-semibold text-white">Asset Inventory</h2><p className="text-sm text-gray-400">{activeCount} active · {assets.length} total</p></div>
      <div className="flex items-center gap-2"><button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Asset</button></div></div>
    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input className="input-field pl-9" placeholder="Search by name, tag, or serial..." value={search} onChange={e => setSearch(e.target.value)} /></div>

    {showNew && (<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Add Asset</h3><button type="button" onClick={() => setShowNew(false)} className="text-gray-500 hover:text-white">X</button></div>
      <div className="grid grid-cols-2 gap-3"><input className="input-field" placeholder="Name*" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /><input className="input-field" placeholder="Tag*" value={form.assetTag} onChange={e => setForm({ ...form, assetTag: e.target.value })} required /></div>
      <div className="grid grid-cols-3 gap-3"><select className="input-field" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{Object.keys(TC).map(t => <option key={t} value={t}>{t}</option>)}</select><input className="input-field" placeholder="Serial" value={form.serialNumber} onChange={e => setForm({ ...form, serialNumber: e.target.value })} /><input className="input-field" placeholder="Model" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></div>
      <input className="input-field" placeholder="Location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Add</button><button type="button" onClick={() => setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : filtered.length === 0 ? <div className="text-center py-12 card"><Monitor size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No assets</p></div> : (
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Asset</th><th className="p-3">Tag</th><th className="p-3 hidden md:table-cell">Type</th><th className="p-3">Status</th><th className="p-3 hidden lg:table-cell">Location</th><th className="p-3 hidden md:table-cell">Serial</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>{filtered.map(a => (<tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
          <td className="p-3"><p className="font-medium text-white">{a.name}</p>{a.model && <p className="text-xs text-gray-500">{a.model}</p>}</td>
          <td className="p-3 text-gray-300 font-mono text-xs">{a.assetTag}</td><td className="p-3 hidden md:table-cell"><span className={`badge text-xs ${TC[a.type] || ""}`}>{a.type}</span></td>
          <td className="p-3"><span className={`badge text-xs ${SC[a.status] || ""}`}>{a.status}</span></td><td className="p-3 text-gray-400 text-xs hidden lg:table-cell">{a.location || "—"}</td>
          <td className="p-3 text-gray-500 text-xs font-mono hidden md:table-cell">{a.serialNumber || "—"}</td>
          <td className="p-3 text-right">{a.status === "available" ? <button onClick={() => setShowAssign(a)} className="text-xs text-cyber-400 hover:text-cyber-300"><Link2 size={13} className="inline mr-1" />Assign</button> : <span className="text-xs text-gray-600">In use</span>}</td>
        </tr>))}</tbody></table></div></div>)}

    {showAssign && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAssign(null)}><div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}>
      <h3 className="text-lg font-semibold text-white">Assign: {showAssign.name}</h3><p className="text-xs text-gray-500">{showAssign.assetTag} · {showAssign.type}</p>
      <select className="input-field" value={assignForm.assignedToId} onChange={e => setAssignForm({ ...assignForm, assignedToId: e.target.value })} required><option value="">Select user...</option>{users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select>
      <input className="input-field" placeholder="Ticket ID (optional)" value={assignForm.ticketId} onChange={e => setAssignForm({ ...assignForm, ticketId: e.target.value })} />
      <textarea className="input-field" placeholder="Notes" rows={2} value={assignForm.notes} onChange={e => setAssignForm({ ...assignForm, notes: e.target.value })} />
      <div className="flex gap-2"><button onClick={handleCheckout} className="btn-primary text-sm"><CheckCircle size={14} className="inline mr-1" />Check Out</button><button onClick={() => setShowAssign(null)} className="btn-secondary text-sm">Cancel</button></div>
    </div></div>)}
  </div>);
}
