import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Search, Monitor, Server, Laptop, Smartphone, Network, Database, Wrench } from "lucide-react";

interface Asset {
  id: string; name: string; assetTag: string; type: string; category?: string;
  status: string; manufacturer?: string; model?: string; serialNumber?: string;
  location?: string; department?: string; assignedToId?: string;
  purchasePrice?: number; warrantyExpiry?: string;
  assignments?: Array<{ assignedTo?: { firstName?: string; lastName?: string } }>;
}

const TYPE_ICONS: Record<string, typeof Monitor> = {
  hardware: Monitor, software: Database, license: FileText, server: Server,
  laptop: Laptop, mobile: Smartphone, network: Network, other: Wrench,
};

const TYPE_LABELS: Record<string, string> = {
  hardware: "Hardware", software: "Software", license: "License",
  server: "Server", laptop: "Laptop", mobile: "Mobile Device",
  network: "Network Equipment", other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-600/20 text-green-400", assigned: "bg-cyber-600/20 text-cyber-400",
  maintenance: "bg-amber-600/20 text-amber-400", retired: "bg-gray-600/20 text-gray-400",
  lost: "bg-red-600/20 text-red-400",
};

// Need FileText from lucide
import { FileText } from "lucide-react";

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "", manufacturer: "", location: "", department: "", category: "", purchasePrice: "", notes: "" });

  const fetchAssets = () => {
    let url = "/inventory/assets?limit=200";
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (typeFilter) url += `&type=${typeFilter}`;
    api.get(url).then(r => setAssets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAssets(); }, [search, typeFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/inventory/assets", form);
      toast.success("Asset created");
      setShowNew(false);
      setForm({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "", manufacturer: "", location: "", department: "", category: "", purchasePrice: "", notes: "" });
      fetchAssets();
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Asset Inventory</h2><p className="text-sm text-gray-400 mt-0.5">Manage hardware, software, and licenses</p></div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 self-start"><Plus size={16} /> Add Asset</button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Create modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowNew(false)}>
          <form className="card w-full max-w-xl mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Asset</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Name *</label><input className="input-field" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Asset Tag *</label><input className="input-field" value={form.assetTag} onChange={e => setForm(p => ({ ...p, assetTag: e.target.value }))} required /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Type *</label><select className="input-field" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Category</label><input className="input-field" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Serial Number</label><input className="input-field" value={form.serialNumber} onChange={e => setForm(p => ({ ...p, serialNumber: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Model</label><input className="input-field" value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Manufacturer</label><input className="input-field" value={form.manufacturer} onChange={e => setForm(p => ({ ...p, manufacturer: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Department</label><input className="input-field" value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Location</label><input className="input-field" value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Purchase Price</label><input className="input-field" type="number" value={form.purchasePrice} onChange={e => setForm(p => ({ ...p, purchasePrice: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Notes</label><input className="input-field" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button type="button" className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create Asset</button>
            </div>
          </form>
        </div>
      )}

      {/* Asset list */}
      <div className="card overflow-hidden p-0">
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> :
         assets.length === 0 ? <div className="p-8 text-center text-gray-500">No assets found</div> :
         <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-400">
              <th className="px-4 py-3">Asset</th><th className="px-4 py-3 hidden md:table-cell">Tag</th><th className="px-4 py-3 hidden lg:table-cell">Type</th><th className="px-4 py-3 hidden sm:table-cell">Status</th><th className="px-4 py-3 hidden lg:table-cell">Location</th><th className="px-4 py-3 hidden md:table-cell">Assigned To</th>
            </tr></thead>
            <tbody>
              {assets.map(a => {
                const Icon = TYPE_ICONS[a.type] || Monitor;
                return (
                  <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-light/50 cursor-pointer" onClick={() => window.location.href = `/assets/${a.id}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded bg-cyber-600/10"><Icon size={16} className="text-cyber-400" /></div>
                        <div>
                          <p className="text-white font-medium hover:text-cyber-400">{a.name}</p>
                          {a.model && <p className="text-xs text-gray-500">{a.manufacturer} {a.model}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-300 font-mono text-xs">{a.assetTag}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{TYPE_LABELS[a.type] || a.type}</td>
                    <td className="px-4 py-3 hidden sm:table-cell"><span className={`badge text-xs ${STATUS_COLORS[a.status] || ""}`}>{a.status}</span></td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{a.location || a.department || "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400">{a.assignments?.[0]?.assignedTo ? `${a.assignments[0].assignedTo.firstName} ${a.assignments[0].assignedTo.lastName}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
