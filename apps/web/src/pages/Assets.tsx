import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Search, Monitor, Server, Laptop, Smartphone, Network, Database, Wrench, FileText, Upload, Download, AlertTriangle, CheckCircle, XCircle, ArrowUpDown } from "lucide-react";

interface Asset {
  id: string; name: string; assetTag: string; type: string; category?: string;
  status: string; manufacturer?: string; model?: string; serialNumber?: string;
  location?: string; department?: string; assignedToId?: string;
  purchasePrice?: number; warrantyExpiry?: string; createdAt?: string; updatedAt?: string;
  assignments?: Array<{ assignedTo?: { firstName?: string; lastName?: string } }>;
}

interface ImportError { line: number; field: string; message: string; }
interface ImportResult { success: boolean; imported: number; skipped: number; errors: ImportError[]; }

const TYPE_ICONS: Record<string, typeof Monitor> = {
  hardware: Monitor, software: Database, license: FileText, server: Server,
  laptop: Laptop, mobile: Smartphone, network: Network, other: Wrench,
  firewall: Server, switch: Network, access_point: Wifi,
};
const TYPE_LABELS: Record<string, string> = {
  hardware: "Hardware", software: "Software", license: "License",
  server: "Server", laptop: "Laptop", mobile: "Mobile Device",
  network: "Network Equipment", other: "Other", firewall: "Firewall",
  switch: "Switch", access_point: "Access Point",
};

// Import needed icons
import { Wifi, ArrowUpDown as ArrowUpDownIcon } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-600/20 text-green-400", assigned: "bg-cyber-600/20 text-cyber-400",
  active: "bg-cyber-600/20 text-cyber-400",
  maintenance: "bg-amber-600/20 text-amber-400", retired: "bg-gray-600/20 text-gray-400",
  lost: "bg-red-600/20 text-red-400",
};

const SORT_OPTIONS = [
  { value: "name", label: "Asset Name" },
  { value: "type", label: "Type" },
  { value: "status", label: "Status" },
  { value: "createdAt", label: "Date Added" },
  { value: "updatedAt", label: "Last Modified" },
  { value: "assetTag", label: "Asset Tag" },
  { value: "location", label: "Location" },
  { value: "purchasePrice", label: "Purchase Price" },
];

const ASSET_FIELDS = [
  "name", "assetTag", "type", "category", "status", "serialNumber", "model",
  "manufacturer", "department", "vendor", "location", "building", "room",
  "purchaseDate", "purchasePrice", "purchaseOrder", "warrantyExpiry",
  "costCenter", "depreciationMethod", "usefulLife", "salvageValue",
  "ipAddress", "macAddress", "osName", "osVersion", "notes",
];

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ name: "", assetTag: "", type: "hardware", serialNumber: "", model: "", manufacturer: "", location: "", department: "", category: "", purchasePrice: "", notes: "" });

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fetchAssets = () => {
    let url = `/inventory/assets?limit=200&sort=${sortBy}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (typeFilter) url += `&type=${typeFilter}`;
    api.get(url).then(r => setAssets(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAssets(); }, [search, typeFilter, sortBy]);

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

  // ── Import ────────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const headers = ASSET_FIELDS.join(",");
    const sample = "ThinkPad T14,ASSET-001,laptop,workstation,available,SN123,ThinkPad T14,Lenovo,Engineering,CDW,Austin,Building A,201,2024-01-15,1899,PO-2024-001,2027-01-15,CC-ENG,straight_line,36,0,10.0.1.1,AA:BB:CC:DD:EE:FF,Windows 11,23H2,Test asset";
    const csv = headers + "\n" + sample;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "asset_import_template.csv"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Template downloaded");
  };

  const handleImport = async () => {
    if (!importFile) { toast.error("Select a file first"); return; }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await api.post("/inventory/assets/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(res.data);
      if (res.data.success && res.data.imported > 0) {
        toast.success(`Imported ${res.data.imported} assets`);
        fetchAssets();
      }
    } catch (err: any) {
      const data = err.response?.data;
      if (data) setImportResult(data);
      else toast.error("Import failed");
    } finally { setImporting(false); }
  };

  const hasCriticalErrors = importResult?.errors?.some(
    e => e.message.includes("required") || e.message.includes("invalid type") || e.message.includes("duplicate")
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Asset Inventory</h2><p className="text-sm text-gray-400 mt-0.5">Manage hardware, software, and licenses</p></div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); }} className="btn-secondary flex items-center gap-1.5"><Upload size={14} /> Import</button>
          <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Asset</button>
        </div>
      </div>

      {/* Filters + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <ArrowUpDownIcon size={14} className="text-gray-500" />
          <select className="input-field text-sm py-1.5 w-auto" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Import Dialog */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowImport(false)}>
          <div className="card w-full max-w-lg mx-4 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Import Assets</h3>
              <button onClick={() => setShowImport(false)} className="text-gray-500 hover:text-white"><XCircle size={18} /></button>
            </div>

            {/* Step 1: File picker */}
            {!importResult && (
              <>
                <p className="text-sm text-gray-400">Select a CSV or XLS file with asset data. Column names must match the application fields.</p>
                <div className="flex items-center gap-2">
                  <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13} /> Download Template</button>
                </div>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyber-600/20 file:text-cyber-400 hover:file:bg-cyber-600/30"
                />
                {importFile && <p className="text-xs text-gray-500">Selected: {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)</p>}
                <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
                  <button onClick={() => setShowImport(false)} className="btn-secondary">Cancel</button>
                  <button onClick={handleImport} disabled={importing || !importFile} className="btn-primary flex items-center gap-1.5">
                    {importing ? "Importing..." : <><Upload size={14} /> Import</>}
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Results */}
            {importResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {importResult.success ? (
                    <CheckCircle size={20} className="text-green-400" />
                  ) : (
                    <AlertTriangle size={20} className="text-amber-400" />
                  )}
                  <span className="text-white font-medium">
                    {importResult.success ? "Import Complete" : "Validation Issues Found"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-green-900/20 rounded-lg p-2"><p className="text-green-400 font-bold text-lg">{importResult.imported}</p><p className="text-xs text-gray-500">Imported</p></div>
                  <div className="bg-amber-900/20 rounded-lg p-2"><p className="text-amber-400 font-bold text-lg">{importResult.skipped}</p><p className="text-xs text-gray-500">Skipped</p></div>
                  <div className="bg-red-900/20 rounded-lg p-2"><p className="text-red-400 font-bold text-lg">{importResult.errors?.length || 0}</p><p className="text-xs text-gray-500">Errors</p></div>
                </div>

                {/* Error list */}
                {importResult.errors?.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    <p className="text-xs text-gray-500 font-medium">Validation Errors:</p>
                    {importResult.errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs py-1 px-2 rounded bg-red-950/30">
                        <span className="text-red-400 font-mono shrink-0">Line {e.line}</span>
                        {e.field && <span className="text-amber-400 shrink-0">[{e.field}]</span>}
                        <span className="text-gray-400">{e.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action: allow continue if non-critical */}
                {!importResult.success && !hasCriticalErrors && (
                  <button
                    onClick={() => { setImportResult(null); toast.success("Import continued"); }}
                    className="btn-primary w-full text-sm"
                  >
                    Continue Anyway (non-critical errors)
                  </button>
                )}
                <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
                  <button onClick={() => { setShowImport(false); setImportResult(null); }} className="btn-secondary">Close</button>
                  <button onClick={() => { setImportResult(null); setImportFile(null); }} className="btn-primary text-sm">Import Another</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
