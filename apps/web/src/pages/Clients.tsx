import { useState, useEffect, useRef } from "react";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { Plus, Building2, Search, Mail, Phone, MapPin, Users, FileText, ArrowUpDown, ExternalLink, AppWindow, SquareArrowOutUpRight, Copy, Download, RotateCw, Eraser, Ticket, Cloud, KeyRound, Server } from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader } from "../components/ui";

const TYPE_COLORS: Record<string, string> = {
  Client: "bg-cyber-600/20 text-cyber-400", Prospect: "bg-amber-600/20 text-amber-400",
  Vendor: "bg-purple-600/20 text-purple-400", Partner: "bg-green-600/20 text-green-400",
};
const SORT_OPTIONS = [
  { value: "name", label: "Name" }, { value: "createdAt", label: "Date Added" },
  { value: "city", label: "City" }, { value: "state", label: "State" },
  { value: "industry", label: "Industry" },
];

export function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [showNew, setShowNew] = useState(false);
  const navigate = useNavigate();
  const menu = useContextMenu();
  const searchRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Record<string, string>>({ name: "", email: "", phone: "", city: "", state: "", companyType: "Client", industry: "" });

  const fetch = () => {
    let url = `/clients?limit=200&sort=${sort?.field || "name"}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (typeFilter) url += `&type=${typeFilter}`;
    api.get(url).then(r => setClients(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); }, [search, typeFilter, sort]);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/clients", form); toast.success("Client created"); setShowNew(false); setForm({ name: "", email: "", phone: "", city: "", state: "", companyType: "Client", industry: "" }); fetch(); }
    catch { toast.error("Failed"); }
  };

  // ── Right-click menu: the Client List ──
  const csvColumns: CsvColumn<Record<string, any>>[] = [
    { key: "name", label: "Company", value: c => c.name ?? "" },
    { key: "type", label: "Type", value: c => c.companyType ?? "" },
    { key: "contact", label: "Contact", value: c => c.contacts?.[0] ? `${c.contacts[0].firstName} ${c.contacts[0].lastName}`.trim() : "" },
    { key: "phone", label: "Phone", value: c => c.phone || c.contacts?.[0]?.phone || "" },
    { key: "location", label: "Location", value: c => [c.city, c.state].filter(Boolean).join(", ") },
    { key: "industry", label: "Industry", value: c => c.industry ?? "" },
    { key: "status", label: "Status", value: c => (c.isActive ? "Active" : "Inactive") },
  ];

  const exportCsv = () => {
    if (clients.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-clients-${fileStamp()}.csv`, toCsv(clients, csvColumns));
    toast.success(`Exported ${clients.length} client${clients.length === 1 ? "" : "s"}`);
  };

  const clientMenuHeader = (c: Record<string, any>) => ({
    title: String(c.name ?? "Client"),
    subtitle: [c.companyType, [c.city, c.state].filter(Boolean).join(", "), c.isActive ? "Active" : "Inactive"].filter(Boolean).join(" · "),
  });

  const clientMenuEntries = (c: Record<string, any>): MenuEntry[] => {
    const id = String(c.id);
    const contact = (c.contacts as Array<Record<string, any>> | undefined)?.[0];
    return [
      { label: "Open client", icon: ExternalLink, hint: "⏎", onSelect: () => navigate(`/clients/${id}`) },
      { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(`/clients/${id}`) },
      { label: "Open in new window", icon: AppWindow, onSelect: () => openInNewWindow(`/clients/${id}`) },
      "separator",
      { label: "New ticket", icon: Ticket, onSelect: () => navigate(`/tickets?new=1&companyId=${id}`) },
      { label: "View tickets", icon: FileText, onSelect: () => navigate(`/tickets?companyId=${id}`) },
      { label: "View contacts", icon: Users, onSelect: () => navigate(`/clients/contacts?companyId=${id}`) },
      contact && {
        label: `Open contact ${String(contact.firstName ?? "")} ${String(contact.lastName ?? "")}`.trim(),
        icon: Users,
        onSelect: () => navigate(`/clients/contacts?select=${contact.id}&companyId=${id}`),
      },
      {
        label: "Kumo", icon: Cloud,
        items: [
          { label: "Organization", icon: Cloud, onSelect: () => navigate(`/kumo/organizations/${id}`) },
          { label: "Passwords", icon: KeyRound, onSelect: () => navigate(`/kumo/passwords?companyId=${id}`) },
          { label: "Configurations", icon: Server, onSelect: () => navigate(`/kumo/configs?companyId=${id}`) },
          { label: "Documents", icon: FileText, onSelect: () => navigate(`/kumo/documents?companyId=${id}`) },
        ],
      },
      "separator",
      c.companyType && {
        label: `Show only ${String(c.companyType)} records`, icon: Building2,
        onSelect: () => setTypeFilter(String(c.companyType)),
      },
      "separator",
      { label: "Copy client name", icon: Copy, onSelect: () => void copyText(String(c.name ?? ""), "Client name") },
      { label: "Copy email", icon: Copy, disabled: !c.email, onSelect: () => void copyText(String(c.email ?? ""), "Email") },
      {
        label: "Copy phone", icon: Copy, disabled: !(c.phone || contact?.phone),
        onSelect: () => void copyText(String(c.phone || contact?.phone || ""), "Phone"),
      },
    ].filter(Boolean) as MenuEntry[];
  };

  const sectionMenuEntries = (): MenuEntry[] => {
    const sortField = sort?.field ?? "name";
    return [
      { label: "New client", icon: Plus, onSelect: () => setShowNew(true) },
      { label: "Refresh list", icon: RotateCw, onSelect: () => fetch() },
      { label: "Focus search", icon: Search, onSelect: () => searchRef.current?.focus() },
      "separator",
      {
        label: "Clear filters", icon: Eraser, disabled: !search && !typeFilter && !sort,
        onSelect: () => { setSearch(""); setTypeFilter(""); setSort(null); },
      },
      {
        label: "Sort by", icon: ArrowUpDown,
        items: SORT_OPTIONS.map(o => ({ label: o.label, checked: sortField === o.value, onSelect: () => setSort({ field: o.value, direction: "asc" }) })),
      },
      "separator",
      { label: "Export as CSV", icon: Download, hint: `${clients.length} row${clients.length === 1 ? "" : "s"}`, disabled: clients.length === 0, onSelect: exportCsv },
      "separator",
      ...viewMenuEntries(),
    ];
  };

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader variant="section" title="Clients" subtitle={<>{clients.length} clients</>} />
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Client</button>
      </div>

      {/* Filters + Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input ref={searchRef} className="input-field pl-9" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="Client">Client</option><option value="Prospect">Prospect</option>
          <option value="Vendor">Vendor</option><option value="Partner">Partner</option>
        </select>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={14} className="text-gray-500" />
          <select className="input-field text-sm py-1.5 w-auto" value={sort?.field || "name"} onChange={e => setSort({ field: e.target.value, direction: "asc" })}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Create modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowNew(false)}>
          <form className="card w-full max-w-lg mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Client</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Company Name *</label><input className="input-field" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Type</label><select className="input-field" value={form.companyType} onChange={e => setForm(p => ({ ...p, companyType: e.target.value }))}><option>Client</option><option>Prospect</option><option>Vendor</option><option>Partner</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Industry</label><input className="input-field" value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Email</label><input className="input-field" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Phone</label><input className="input-field" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">City</label><input className="input-field" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">State</label><input className="input-field" value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button type="button" className="btn-secondary" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Client List */}
      <div className="card overflow-hidden p-0">
        {loading ? <TableSkeleton /> :
         clients.length === 0 ? <div className="p-8 text-center text-gray-500">No clients found</div> :
         <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400">
              <SortableHeader field="name" label="Company" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><th className="px-4 py-3 hidden sm:table-cell">Type</th><th className="px-4 py-3 hidden md:table-cell">Contact</th><th className="px-4 py-3 hidden lg:table-cell">Location</th><th className="px-4 py-3 hidden lg:table-cell">Industry</th><th className="px-4 py-3 hidden sm:table-cell">Status</th>
            </tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} tabIndex={0}
                  className="border-b border-surface-border/50 hover:bg-surface-light/50 cursor-pointer focus:outline-none focus:bg-surface-light/50"
                  onClick={() => navigate(`/clients/${c.id}`)}
                  onContextMenu={(e) => menu.open(e, clientMenuEntries(c), clientMenuHeader(c))}
                  onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, clientMenuEntries(c), clientMenuHeader(c))}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded bg-cyber-600/10"><Building2 size={16} className="text-cyber-400" /></div>
                      <div>
                        <p className="text-white font-medium hover:text-cyber-400">{c.name}</p>
                        {c.email && <p className="text-xs text-gray-500 flex items-center gap-1"><Mail size={10} />{c.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {c.companyType && <span className={`badge text-xs ${TYPE_COLORS[c.companyType] || "bg-gray-600/20 text-gray-400"}`}>{c.companyType}</span>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {c.contacts?.[0] ? (
                      <div>
                        <p className="text-gray-300">{c.contacts[0].firstName} {c.contacts[0].lastName}</p>
                        <p className="text-xs text-gray-500">{c.phone || c.contacts[0].phone || "—"}</p>
                      </div>
                    ) : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{c.industry || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${c.isActive ? "bg-green-400" : "bg-gray-600"}`} />
                    <span className="text-xs text-gray-400">{c.isActive ? "Active" : "Inactive"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
