import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Server, Search, ExternalLink, SquareArrowOutUpRight, AppWindow, Copy, Download, RotateCw, Eraser, Monitor, Network, Building2 } from "lucide-react";
import { kumoClientTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { TableSkeleton } from "../components/ui/Skeleton";
import { ListFooter, ListViews, PageHeader, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

export function KumoConfigsPage() {
  const redesign = useRedesign();
  const [configs, setConfigs] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState("");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({name:"",hostname:"",templateId:"",companyId:"",os:"",cpu:"",ram:"",storage:"",ip:"",virt:""});
  const [serverView, setServerView] = useState("");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Set by the organization screen, e.g. /kumo/configs?select=<id>
  const selectId = searchParams.get("select");
  const companyParam = searchParams.get("companyId") ?? "";

  // The organization rail opens the list pre-filtered to one client.
  useEffect(() => { if (companyParam) setCompanyFilter(companyParam); }, [companyParam]);

  useBreadcrumbTrail(
    companyFilter
      ? kumoClientTrail(companyFilter, companies.find((c: { id: string; name: string }) => c.id === companyFilter)?.name, { label: "Configurations" })
      : null
  );

  const fetch = () => {
    api.get("/kumo/configs/servers").then(r => setConfigs(r.data.data||[])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => {
    fetch();
    api.get("/clients?limit=100").then(r => setCompanies(r.data.data||[])).catch(() => {});
    api.get("/kumo/templates").then(r => setTemplates(r.data.data||[])).catch(() => {});
  }, []);

  // Open the server a deep link points at.
  useEffect(() => {
    if (!selectId) return;
    const match = configs.find((c: any) => c.id === selectId);
    if (match && selected?.id !== match.id) setSelected(match);
  }, [selectId, configs]);

  /** The redesigned views strip: virtual machines and bare metal, from rows already loaded. */
  const serverSlice = (c: Record<string, any>) =>
    !redesign || serverView === "" || (serverView === "virtual" ? !!c.virtualization : !c.virtualization);

  const filtered = configs.filter(c => {
    if (!serverSlice(c)) return false;
    if (companyFilter && c.kumoAsset?.companyId !== companyFilter) return false;
    if (search) {
      const haystack = [c.kumoAsset?.name, c.hostname, c.fqdn, c.ipAddress, c.operatingSystem]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  /*
   * The figures and the one slice this list can honestly offer — how many of the servers are
   * virtual machines and how many run on their own hardware — taken from the rows already loaded.
   * The slice applies only while the redesigned interface is on, so the classic list is unchanged.
   */
  const virtualised = configs.filter((c: any) => !!c.virtualization).length;
  const withIp = configs.filter((c: any) => !!c.ipAddress).length;
  const serverClients = new Set(configs.map((c: any) => c.kumoAsset?.companyId).filter(Boolean)).size;
  const serverViews = [
    { id: "", label: "All", count: configs.length },
    { id: "virtual", label: "Virtualised", count: virtualised },
    { id: "bare", label: "Bare metal", count: configs.length - virtualised },
  ];

  // ── Right-click menu: Kumo Configurations ──
  const menu = useContextMenu();

  const csvColumns: CsvColumn<Record<string, any>>[] = [
    { key: "name", label: "Server", value: c => c.kumoAsset?.name ?? c.hostname ?? "" },
    { key: "hostname", label: "Hostname", value: c => c.hostname ?? "" },
    { key: "fqdn", label: "FQDN", value: c => c.fqdn ?? "" },
    { key: "ip", label: "IP Address", value: c => c.ipAddress ?? "" },
    { key: "os", label: "Operating System", value: c => c.operatingSystem ?? "" },
    { key: "cpu", label: "CPU Cores", value: c => c.cpuCores ?? "" },
    { key: "ram", label: "RAM (GB)", value: c => c.ramGb ?? "" },
    { key: "storage", label: "Storage (GB)", value: c => c.storageGb ?? "" },
    { key: "virtualization", label: "Virtualization", value: c => c.virtualization ?? "" },
    { key: "client", label: "Client", value: c => companies.find(x => x.id === c.kumoAsset?.companyId)?.name ?? "" },
  ];

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-kumo-configurations-${fileStamp()}.csv`, toCsv(filtered, csvColumns));
    toast.success(`Exported ${filtered.length} server${filtered.length === 1 ? "" : "s"}`);
  };

  const clientName = (c: Record<string, any>) => companies.find(x => x.id === c.kumoAsset?.companyId)?.name ?? "";

  const serverMenuHeader = (c: Record<string, any>) => ({
    title: String(c.kumoAsset?.name || c.hostname || "Server"),
    subtitle: [c.operatingSystem, c.ipAddress, clientName(c)].filter(Boolean).join(" · "),
  });

  const serverMenuEntries = (c: Record<string, any>): MenuEntry[] => [
    { label: "Show details", icon: ExternalLink, hint: "⏎", onSelect: () => setSelected(c) },
    ...(c.kumoAsset?.id
      ? [
          { label: "Open asset record", icon: Monitor, onSelect: () => navigate(`/kumo/assets/${c.kumoAsset.id}`) },
          { label: "Open asset in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(`/kumo/assets/${c.kumoAsset.id}`) },
          { label: "Open asset in new window", icon: AppWindow, onSelect: () => openInNewWindow(`/kumo/assets/${c.kumoAsset.id}`) },
        ]
      : []),
    "separator",
    { label: "Copy hostname", icon: Copy, disabled: !c.hostname, onSelect: () => void copyText(String(c.hostname), "Hostname") },
    { label: "Copy IP address", icon: Copy, disabled: !c.ipAddress, onSelect: () => void copyText(String(c.ipAddress), "IP address") },
    { label: "Copy FQDN", icon: Copy, disabled: !c.fqdn, onSelect: () => void copyText(String(c.fqdn), "FQDN") },
    {
      label: "Copy specifications", icon: Copy,
      onSelect: () => void copyText([
        String(c.kumoAsset?.name || c.hostname || "Server"),
        c.operatingSystem ? `OS: ${c.operatingSystem}` : null,
        c.ipAddress ? `IP: ${c.ipAddress}` : null,
        c.fqdn ? `FQDN: ${c.fqdn}` : null,
        c.cpuCores ? `${c.cpuCores} cores` : null,
        c.ramGb ? `${c.ramGb} GB RAM` : null,
        c.storageGb ? `${c.storageGb} GB storage` : null,
        c.virtualization || null,
        clientName(c) || null,
      ].filter(Boolean).join("\n"), "Specifications"),
    },
    "separator",
    ...(c.kumoAsset?.companyId
      ? [{ label: "Filter to this client", icon: Building2, onSelect: () => setCompanyFilter(String(c.kumoAsset.companyId)) }]
      : []),
  ];

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Add server", icon: Plus, onSelect: () => setShowCreate(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => fetch() },
    { label: "Focus search", icon: Search, onSelect: () => searchRef.current?.focus() },
    "separator",
    {
      label: "Clear filters", icon: Eraser, disabled: !companyFilter && !search,
      onSelect: () => { setCompanyFilter(""); setSearch(""); },
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${filtered.length} row${filtered.length === 1 ? "" : "s"}`, disabled: filtered.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    api.post("/kumo/configs/servers", {
      name: form.name, hostname: form.hostname, templateId: form.templateId,
      companyId: form.companyId || undefined,
      operatingSystem: form.os, cpuCores: Number(form.cpu)||0, ramGb: Number(form.ram)||0,
      storageGb: Number(form.storage)||0, ipAddress: form.ip, virtualization: form.virt
    }).then(() => { toast.success("Created"); setShowCreate(false); fetch(); }).catch(() => toast.error("Failed"));
  };

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader variant="section" title="Configurations" subtitle={<>{filtered.length} servers</>} />
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Server</button>
      </div>

      {/* Figures — what the estate's configurations hold, counted from the rows already loaded. */}
      {redesign && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Servers" value={configs.length} icon={<Server size={13} />} />
          <StatCard label="Virtualised" value={virtualised} icon={<Monitor size={13} />} tone={virtualised > 0 ? "green" : "neutral"} />
          <StatCard label="With an IP" value={withIp} icon={<Network size={13} />} tone="neutral" />
          <StatCard label="Clients" value={serverClients} icon={<Building2 size={13} />} tone="neutral" />
        </div>
      )}

      {/* Views — how the server fleet is hosted, as chips you press. */}
      {redesign && (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews views={serverViews} value={serverView} onChange={setServerView} label="Configuration views" />
          <span className="text-xs text-gray-500 tabular-nums">{filtered.length} of {configs.length} server{configs.length === 1 ? "" : "s"}</span>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input ref={searchRef} className="input-field pl-9" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
          <option value="">All Clients</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-1">
          {loading ? <TableSkeleton /> :
           filtered.length === 0 ? <div className="card py-8 text-center text-gray-500 text-sm">No configurations</div> :
           <>
           {filtered.map(c => (
            <button key={c.id} onClick={() => { setSelected(c); api.post("/kumo/recently-viewed", { entityType: "config", entityId: c.id, entityName: c.kumoAsset?.name || c.hostname, entityIcon: "server" }).catch(() => {}); }}
              onContextMenu={(e) => menu.open(e, serverMenuEntries(c), serverMenuHeader(c))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, serverMenuEntries(c), serverMenuHeader(c))}
              className={"w-full text-left card px-4 py-3 hover:border-cyber-500/30 " + (selected?.id === c.id ? "border-cyber-500/50 bg-cyber-600/5" : "")}>
              <div className="flex items-center gap-2">
                <Server size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{c.kumoAsset?.name || c.hostname}</p>
                  <p className="text-xs text-gray-500">{c.operatingSystem || "-"}</p>
                </div>
                {redesign && c.virtualization ? <span className="chip shrink-0">{c.virtualization}</span> : null}
              </div>
            </button>
          ))}
           {redesign && (
             <ListFooter from={1} to={filtered.length} total={filtered.length} page={1} pages={1} onPage={() => {}}
               note={`${virtualised} virtual · ${configs.length - virtualised} on bare metal`} />
           )}
           </>
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
            <select className="input-field" value={form.companyId} onChange={e => setForm({...form, companyId: e.target.value})}>
              <option value="">No client</option>
              {companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
function KV({ label, value }: { label: string; value?: string | number | null }) {
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><p className="text-sm text-white">{value || "-"}</p></div>;
}
