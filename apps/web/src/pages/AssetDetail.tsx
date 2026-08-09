import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Save, X, Monitor, ChevronLeft, Clock, User, FileText, MapPin, DollarSign, Wifi, HardDrive, Package } from "lucide-react";

const TYPE_COLORS: Record<string, string> = { hardware: "bg-blue-600/20 text-blue-400", software: "bg-purple-600/20 text-purple-400", license: "bg-amber-600/20 text-amber-400", server: "bg-cyber-600/20 text-cyber-400", laptop: "bg-green-600/20 text-green-400", mobile: "bg-pink-600/20 text-pink-400", network: "bg-orange-600/20 text-orange-400", other: "bg-gray-600/20 text-gray-400" };
const STATUS_COLORS: Record<string, string> = { available: "bg-green-600/20 text-green-400", assigned: "bg-cyber-600/20 text-cyber-400", maintenance: "bg-amber-600/20 text-amber-400", retired: "bg-gray-600/20 text-gray-400", lost: "bg-red-600/20 text-red-400" };

const EDIT_FIELDS = [
  { key: "name", label: "Name", section: "general", required: true },
  { key: "assetTag", label: "Asset Tag", section: "general", required: true },
  { key: "type", label: "Type", section: "general", type: "select", options: ["hardware", "software", "license", "server", "laptop", "mobile", "network", "other"] },
  { key: "status", label: "Status", section: "general", type: "select", options: ["available", "assigned", "maintenance", "retired", "lost"] },
  { key: "category", label: "Category", section: "general", type: "select", options: ["", "workstation", "peripheral", "infrastructure", "cloud", "saas"] },
  { key: "serialNumber", label: "Serial Number", section: "details" },
  { key: "model", label: "Model", section: "details" },
  { key: "manufacturer", label: "Manufacturer", section: "details" },
  { key: "department", label: "Department", section: "details" },
  { key: "vendor", label: "Vendor", section: "details" },
  { key: "purchaseDate", label: "Purchase Date", section: "purchase", type: "date" },
  { key: "purchasePrice", label: "Purchase Price", section: "purchase", type: "number" },
  { key: "purchaseOrder", label: "PO Number", section: "purchase" },
  { key: "warrantyExpiry", label: "Warranty Expiry", section: "purchase", type: "date" },
  { key: "costCenter", label: "Cost Center", section: "purchase" },
  { key: "depreciationMethod", label: "Depreciation", section: "purchase", type: "select", options: ["", "straight_line", "declining_balance", "none"] },
  { key: "usefulLife", label: "Useful Life (months)", section: "purchase", type: "number" },
  { key: "salvageValue", label: "Salvage Value", section: "purchase", type: "number" },
  { key: "location", label: "Location", section: "location" },
  { key: "building", label: "Building", section: "location" },
  { key: "room", label: "Room", section: "location" },
  { key: "ipAddress", label: "IP Address", section: "network" },
  { key: "macAddress", label: "MAC Address", section: "network" },
  { key: "osName", label: "OS Name", section: "network" },
  { key: "osVersion", label: "OS Version", section: "network" },
  { key: "notes", label: "Notes", section: "general", type: "textarea" },
];

export function AssetDetailPage() {
  const { id } = useParams();
  const [asset, setAsset] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { const r = await api.get(`/inventory/assets/${id}`); setAsset(r.data); setForm(r.data); }
    catch { toast.error("Asset not found"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/inventory/assets/${id}`, form);
      toast.success("Asset updated");
      setEditing(false);
      load();
    } catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!asset) return <div className="text-center py-12 text-gray-500">Asset not found</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/assets" className="text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft size={14} /> Assets</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyber-600/10"><Monitor size={20} className="text-cyber-400" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">{editing ? "Edit Asset" : asset.name}</h2>
            <p className="text-sm text-gray-400">{asset.assetTag}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="btn-secondary flex items-center gap-1"><X size={14} /> Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1"><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-primary">Edit Asset</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Details */}
        <div className="lg:col-span-2 space-y-4">
          {/* General */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">General</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {EDIT_FIELDS.filter(f => f.section === "general").map(f => renderField(f, editing, form, setForm, asset))}
            </div>
          </div>

          {/* Hardware Details */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Hardware Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {EDIT_FIELDS.filter(f => f.section === "details").map(f => renderField(f, editing, form, setForm, asset))}
            </div>
          </div>

          {/* Purchase */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Purchase & Financial</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {EDIT_FIELDS.filter(f => f.section === "purchase").map(f => renderField(f, editing, form, setForm, asset))}
            </div>
          </div>

          {/* Location & Network */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Location</h3>
              <div className="grid grid-cols-2 gap-3">
                {EDIT_FIELDS.filter(f => f.section === "location").map(f => renderField(f, editing, form, setForm, asset))}
              </div>
            </div>
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Network & OS</h3>
              <div className="grid grid-cols-2 gap-3">
                {EDIT_FIELDS.filter(f => f.section === "network").map(f => renderField(f, editing, form, setForm, asset))}
              </div>
            </div>
          </div>

          {/* Assignment History */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Assignment History</h3>
            {asset.assignments?.length > 0 ? (
              <div className="space-y-2">
                {asset.assignments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-surface-lighter">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-gray-500" />
                      <span className="text-white">{a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}` : "Unassigned"}</span>
                      {a.ticket && <span className="text-xs text-gray-500">via {a.ticket.ticketNumber}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>Out: {new Date(a.checkedOutAt).toLocaleDateString()}</span>
                      {a.checkedInAt && <span>In: {new Date(a.checkedInAt).toLocaleDateString()}</span>}
                      {!a.checkedInAt && <span className="badge bg-cyber-600/20 text-cyber-400">Active</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-600">No assignment history</p>}
          </div>
        </div>

        {/* Right column - Summary */}
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Type</span><span className={`badge text-xs ${TYPE_COLORS[asset.type] || ""}`}>{asset.type}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><span className={`badge text-xs ${STATUS_COLORS[asset.status] || ""}`}>{asset.status}</span></div>
              {asset.category && <div className="flex justify-between text-sm"><span className="text-gray-500">Category</span><span className="text-white">{asset.category}</span></div>}
              {asset.department && <div className="flex justify-between text-sm"><span className="text-gray-500">Department</span><span className="text-white">{asset.department}</span></div>}
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Quick Info</h3>
            <div className="space-y-2 text-sm">
              {asset.manufacturer && <div className="flex items-center gap-2"><Package size={13} className="text-gray-500" /><span className="text-gray-400">{asset.manufacturer} {asset.model || ""}</span></div>}
              {asset.serialNumber && <div className="flex items-center gap-2"><HardDrive size={13} className="text-gray-500" /><span className="text-gray-400">S/N: {asset.serialNumber}</span></div>}
              {asset.ipAddress && <div className="flex items-center gap-2"><Wifi size={13} className="text-gray-500" /><span className="text-gray-400">{asset.ipAddress}</span></div>}
              {asset.purchasePrice != null && <div className="flex items-center gap-2"><DollarSign size={13} className="text-gray-500" /><span className="text-gray-400">${Number(asset.purchasePrice).toLocaleString()}</span></div>}
              {asset.createdAt && <div className="flex items-center gap-2"><Clock size={13} className="text-gray-500" /><span className="text-gray-400">Created {new Date(asset.createdAt).toLocaleDateString()}</span></div>}
            </div>
          </div>

          {asset.notes && (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><FileText size={13} /> Notes</h3>
              <p className="text-sm text-gray-400 whitespace-pre-wrap">{asset.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderField(
  f: { key: string; label: string; type?: string; options?: string[]; required?: boolean },
  editing: boolean,
  form: Record<string, any>,
  setForm: (v: any) => void,
  asset: Record<string, any>
) {
  const value = editing ? (form[f.key] ?? "") : (asset[f.key] ?? "");
  if (!editing && !value) return null;

  if (!editing) {
    let display = String(value);
    if (f.type === "date" && value) display = new Date(value).toLocaleDateString();
    if (f.type === "number" && value) display = f.key.includes("Price") || f.key.includes("Value") ? `$${Number(value).toLocaleString()}` : String(value);
    return (
      <div key={f.key}>
        <p className="text-xs text-gray-500">{f.label}</p>
        <p className="text-sm text-white">{display || "—"}</p>
      </div>
    );
  }

  if (f.type === "select" && f.options) {
    return (
      <div key={f.key}>
        <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
        <select className="input-field text-sm py-1.5" value={String(form[f.key] ?? "")} onChange={e => setForm((p: any) => ({ ...p, [f.key]: e.target.value }))}>
          {f.options.map(o => <option key={o} value={o}>{o || "—"}</option>)}
        </select>
      </div>
    );
  }

  if (f.type === "textarea") {
    return (
      <div key={f.key} className="col-span-full">
        <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
        <textarea className="input-field text-sm" rows={3} value={String(form[f.key] ?? "")} onChange={e => setForm((p: any) => ({ ...p, [f.key]: e.target.value }))} />
      </div>
    );
  }

  return (
    <div key={f.key}>
      <label className="text-xs text-gray-500 block mb-1">{f.label}</label>
      <input className="input-field text-sm py-1.5" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={f.type === "date" ? String(form[f.key] ?? "").slice(0, 10) : String(form[f.key] ?? "")} onChange={e => setForm((p: any) => ({ ...p, [f.key]: f.type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value }))} />
    </div>
  );
}
