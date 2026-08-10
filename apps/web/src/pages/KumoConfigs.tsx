import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Server, Search } from "lucide-react";

export function KumoConfigsPage() {
  const [configs, setConfigs] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState({name:"",hostname:"",templateId:"",os:"",cpu:"",ram:"",storage:"",ip:"",virt:""});

  const fetch = () => {
    api.get("/kumo/configs/servers").then(r => setConfigs(r.data.data||[])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => {
    fetch();
    api.get("/clients?limit=100").then(r => setCompanies(r.data.data||[])).catch(() => {});
    api.get("/kumo/templates").then(r => setTemplates(r.data.data||[])).catch(() => {});
  }, []);

  const filtered = companyFilter ? configs.filter(c => c.kumoAsset?.companyId === companyFilter) : configs;

  const handleCreate = (e) => {
    e.preventDefault();
    api.post("/kumo/configs/servers", {
      name: form.name, hostname: form.hostname, templateId: form.templateId,
      operatingSystem: form.os, cpuCores: Number(form.cpu)||0, ramGb: Number(form.ram)||0,
      storageGb: Number(form.storage)||0, ipAddress: form.ip, virtualization: form.virt
    }).then(() => { toast.success("Created"); setShowCreate(false); fetch(); }).catch(() => toast.error("Failed"));
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-lg font-semibold text-white">Configurations</h2><p className="text-sm text-gray-400">{filtered.length} servers</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Server</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input className="input-field pl-9" placeholder="Search..." onChange={() => {}} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="">All Clients</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-1">
          {loading ? <div className="text-center py-8 text-gray-500">Loading...</div> :
           filtered.length === 0 ? <div className="card py-8 text-center text-gray-500 text-sm">No configurations</div> :
           filtered.map(c => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={"w-full text-left card px-4 py-3 hover:border-cyber-500/30 " + (selected?.id === c.id ? "border-cyber-500/50 bg-cyber-600/5" : "")}>
              <div className="flex items-center gap-2">
                <Server size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{c.kumoAsset?.name || c.hostname}</p>
                  <p className="text-xs text-gray-500">{c.operatingSystem || "-"}</p>
                </div>
              </div>
            </button>
          ))}
          }
        </div>
        <div className="lg:col-span-2">
          {!selected ? (
            <div className="card flex items-center justify-center py-16 text-gray-500 text-sm">
              <div className="text-center"><Server size={40} className="text-gray-600 mx-auto mb-3" /><p>Select a server to view details</p></div>
            </div>
          ) : (
            <div className="card space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-600/10"><Server size={20} className="text-green-400" /></div>
                <div><h3 className="text-white font-semibold">{selected.kumoAsset?.name || selected.hostname}</h3><p className="text-xs text-gray-500">{selected.operatingSystem || "-"}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <KV label="Hostname" value={selected.hostname} />
                <KV label="FQDN" value={selected.fqdn} />
                <KV label="IP Address" value={selected.ipAddress} />
                <KV label="OS" value={selected.operatingSystem} />
                <KV label="CPU Cores" value={selected.cpuCores} />
                <KV label="RAM (GB)" value={selected.ramGb} />
                <KV label="Storage (GB)" value={selected.storageGb} />
                <KV label="Virtualization" value={selected.virtualization} />
              </div>
            </div>
          )}
        </div>
      </div>
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">Add Server</h3>
            <input className="input-field" placeholder="Name*" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            <input className="input-field" placeholder="Hostname*" value={form.hostname} onChange={e => setForm({...form, hostname: e.target.value})} required />
            <select className="input-field" value={form.templateId} onChange={e => setForm({...form, templateId: e.target.value})} required>
              <option value="">Select template*</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" placeholder="OS" value={form.os} onChange={e => setForm({...form, os: e.target.value})} />
              <input className="input-field" placeholder="IP Address" value={form.ip} onChange={e => setForm({...form, ip: e.target.value})} />
              <input className="input-field" type="number" placeholder="CPU Cores" value={form.cpu} onChange={e => setForm({...form, cpu: e.target.value})} />
              <input className="input-field" type="number" placeholder="RAM GB" value={form.ram} onChange={e => setForm({...form, ram: e.target.value})} />
              <input className="input-field" type="number" placeholder="Storage GB" value={form.storage} onChange={e => setForm({...form, storage: e.target.value})} />
              <input className="input-field" placeholder="Virtualization" value={form.virt} onChange={e => setForm({...form, virt: e.target.value})} />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function KV({ label, value }) {
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><p className="text-sm text-white">{value || "-"}</p></div>;
}
