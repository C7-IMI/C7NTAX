import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { orgTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { copyText, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { Search, Mail, Phone, Building2, Star, Edit3, Save, X, MapPin, Briefcase, Globe, MessageSquare, UserPlus, Clock, Plus, Ticket, Users, ExternalLink, UserCheck, UserX, Copy, Download, RotateCw, Eraser } from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader, ListViews } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

interface Contact {
  id: string; firstName: string; lastName: string; email: string;
  phone?: string; mobile?: string; title?: string; isPrimary: boolean;
  isActive: boolean; company: { id: string; name: string } | null;
  address?: string; city?: string; state?: string; zip?: string; country?: string;
  notes?: string; department?: string; website?: string; createdAt?: string; updatedAt?: string;
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const redesign = useRedesign();
  const [companyFilter, setCompanyFilter] = useState("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newContact, setNewContact] = useState({ firstName: "", lastName: "", email: "", phone: "", companyId: "", title: "" });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const menu = useContextMenu();
  const searchRef = useRef<HTMLInputElement>(null);

  // Set by the organization screen, e.g. /clients/contacts?select=<id>
  const selectId = searchParams.get("select");
  const companyParam = searchParams.get("companyId") ?? "";

  // The organization rail opens contacts pre-filtered to one client.
  useEffect(() => { if (companyParam) setCompanyFilter(companyParam); }, [companyParam]);

  // Reached from an organization, the trail names that client so it is clear the
  // list is theirs rather than the whole address book.
  useBreadcrumbTrail(
    companyParam
      ? orgTrail(companyParam, companies.find((c) => c.id === companyParam)?.name, { label: "Contacts" })
      : null
  );

  const fetch = () => {
    Promise.all([api.get("/clients?limit=100"), api.get("/clients/contacts?limit=500")])
      .then(([cRes, conRes]) => { setCompanies(cRes.data.data || []); setContacts(conRes.data.data || conRes.data || []); })
      .catch(() => toast.error("Failed to load")).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const filtered = contacts.filter(c => {
    if (search && !`${c.firstName} ${c.lastName} ${c.email} ${c.title || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (companyFilter && c.company?.id !== companyFilter) return false;
    if (redesign) {
      if (view === "primary" && !c.isPrimary) return false;
      if (view === "inactive" && c.isActive !== false) return false;
      if (view === "no email" && c.email) return false;
    }
    return true;
  });

  // The same facts the rows carry, counted rather than searched for.
  const contactViews = [
    { id: "all", label: "All", count: contacts.length },
    { id: "primary", label: "Primary", count: contacts.filter(c => c.isPrimary).length },
    { id: "inactive", label: "Inactive", count: contacts.filter(c => c.isActive === false).length },
    { id: "no email", label: "No email", count: contacts.filter(c => !c.email).length },
  ];

  const selectContact = (c: Contact) => { setSelected(c); setEditing(false); };

  // Open the contact a deep link points at.
  useEffect(() => {
    if (!selectId) return;
    const match = contacts.find(c => c.id === selectId);
    if (match && selected?.id !== match.id) selectContact(match);
  }, [selectId, contacts]);
  /** Every editable field of a contact, so a menu and the Edit button agree. */
  const contactEditForm = (c: Contact) => ({
    firstName: c.firstName || "", lastName: c.lastName || "", email: c.email || "",
    phone: c.phone || "", mobile: c.mobile || "", title: c.title || "",
    department: c.department || "", isPrimary: c.isPrimary, isActive: c.isActive,
    address: c.address || "", city: c.city || "", state: c.state || "",
    zip: c.zip || "", country: c.country || "US", notes: c.notes || "",
    website: c.website || "",
  });

  const startEdit = () => {
    if (!selected) return;
    setEditForm(contactEditForm(selected));
    setEditing(true);
  };

  /** Selects and opens the same contact for editing, in one step. */
  const editContact = (c: Contact) => {
    setSelected(c);
    setEditForm(contactEditForm(c));
    setEditing(true);
  };

  const setContactField = async (c: Contact, patch: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/clients/contacts/${c.id}`, patch);
      toast.success(message);
      if (selected?.id === c.id) setSelected({ ...c, ...patch } as Contact);
      fetch();
    } catch { toast.error("Failed to update contact"); }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/clients/contacts/${selected.id}`, editForm);
      toast.success("Contact updated");
      setSaving(false); setEditing(false);
      fetch(); const updated = contacts.find(c => c.id === selected.id);
      if (updated) setSelected(updated);
    } catch { toast.error("Failed to save"); setSaving(false); }
  };

  const handleCreateContact = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/clients/contacts", { companyId: newContact.companyId, firstName: newContact.firstName, lastName: newContact.lastName, email: newContact.email, phone: newContact.phone, title: newContact.title }); toast.success("Contact created"); setShowCreate(false); setNewContact({ firstName: "", lastName: "", email: "", phone: "", companyId: "", title: "" }); fetch(); }
    catch { toast.error("Failed to create"); }
  };

  const createTicket = (c: Contact) => {
    const params = new URLSearchParams();
    if (c.company?.id) params.set("companyId", c.company.id);
    params.set("contactName", `${c.firstName} ${c.lastName}`);
    params.set("contactEmail", c.email);
    navigate(`/tickets?new=1&${params.toString()}`);
  };

  // ── Right-click menu: Contacts ──
  const csvColumns: CsvColumn<Contact>[] = [
    { key: "name", label: "Name", value: c => `${c.firstName} ${c.lastName}`.trim() },
    { key: "title", label: "Title", value: c => c.title ?? "" },
    { key: "company", label: "Company", value: c => c.company?.name ?? "" },
    { key: "email", label: "Email", value: c => c.email ?? "" },
    { key: "phone", label: "Phone", value: c => c.phone ?? "" },
    { key: "mobile", label: "Mobile", value: c => c.mobile ?? "" },
    { key: "primary", label: "Primary", value: c => (c.isPrimary ? "Yes" : "No") },
    { key: "status", label: "Status", value: c => (c.isActive ? "Active" : "Inactive") },
  ];

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-contacts-${fileStamp()}.csv`, toCsv(filtered, csvColumns));
    toast.success(`Exported ${filtered.length} contact${filtered.length === 1 ? "" : "s"}`);
  };

  const contactMenuHeader = (c: Contact) => ({
    title: `${c.firstName} ${c.lastName}`.trim() || "Contact",
    subtitle: [c.title, c.company?.name, c.isPrimary ? "Primary" : null, c.isActive ? "Active" : "Inactive"].filter(Boolean).join(" · "),
  });

  const contactMenuEntries = (c: Contact): MenuEntry[] => {
    const companyId = c.company?.id;
    return [
      { label: "Show details", icon: ExternalLink, hint: "⏎", onSelect: () => selectContact(c) },
      { label: "Edit contact", icon: Edit3, onSelect: () => editContact(c) },
      "separator",
      { label: "Create ticket", icon: Ticket, onSelect: () => createTicket(c) },
      { label: "Open client", icon: Building2, disabled: !companyId, onSelect: () => navigate(`/clients/${companyId}`) },
      { label: "View client's tickets", icon: Ticket, disabled: !companyId, onSelect: () => navigate(`/tickets?companyId=${companyId}`) },
      {
        label: "Filter by this company", icon: Users, disabled: !companyId,
        onSelect: () => setCompanyFilter(String(companyId)),
      },
      "separator",
      {
        label: "Make primary contact", icon: Star, disabled: c.isPrimary,
        onSelect: () => void setContactField(c, { isPrimary: true }, "Primary contact updated"),
      },
      c.isActive
        ? { label: "Deactivate contact", icon: UserX, onSelect: () => void setContactField(c, { isActive: false }, "Contact deactivated") }
        : { label: "Reactivate contact", icon: UserCheck, onSelect: () => void setContactField(c, { isActive: true }, "Contact reactivated") },
      "separator",
      { label: "Copy name", icon: Copy, onSelect: () => void copyText(`${c.firstName} ${c.lastName}`.trim(), "Name") },
      { label: "Copy email", icon: Copy, disabled: !c.email, onSelect: () => void copyText(c.email, "Email") },
      {
        label: "Copy phone", icon: Copy, disabled: !(c.phone || c.mobile),
        onSelect: () => void copyText(String(c.phone || c.mobile || ""), "Phone"),
      },
    ];
  };

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "New contact", icon: Plus, onSelect: () => setShowCreate(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => fetch() },
    { label: "Focus search", icon: Search, onSelect: () => searchRef.current?.focus() },
    "separator",
    {
      label: "Clear filters", icon: Eraser, disabled: !search && !companyFilter,
      onSelect: () => { setSearch(""); setCompanyFilter(""); },
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${filtered.length} row${filtered.length === 1 ? "" : "s"}`, disabled: filtered.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex items-center justify-between"><PageHeader variant="section" title="Contacts" subtitle={<>{filtered.length} contacts</>} /><button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Contact</button></div>

      <div className="flex gap-2 flex-wrap">
        {redesign && <ListViews views={contactViews} value={view} onChange={setView} label="Contact views" />}
        <div className="relative flex-1 min-w-[200px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input ref={searchRef} className="input-field pl-9" placeholder="Search contacts..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}><option value="">{redesign ? "Client: any" : "All Companies"}</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {redesign && <span className="text-xs text-gray-500">{filtered.length} contact{filtered.length === 1 ? "" : "s"} · {filtered.filter(c => c.isPrimary).length} primary</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {loading ? <TableSkeleton /> : filtered.length === 0 ? <div className="text-center py-12 card"><Mail size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No contacts</p></div> : filtered.map(c => (
            <div key={c.id} tabIndex={0} className={`card hover:border-cyber-500/30 transition-colors cursor-pointer focus:outline-none focus:border-cyber-500/50 ${selected?.id === c.id ? "border-cyber-500/30" : ""}`}
              onClick={() => selectContact(c)}
              onContextMenu={(e) => menu.open(e, contactMenuEntries(c), contactMenuHeader(c))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, contactMenuEntries(c), contactMenuHeader(c))}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-sm font-bold shrink-0">{c.firstName[0]}{c.lastName[0]}</div>
                  <div><h3 className="font-semibold text-white text-sm">{c.firstName} {c.lastName}{c.title && <span className="text-gray-500 text-xs ml-2">{c.title}</span>}{c.isPrimary && <Star size={12} className="inline text-amber-400 ml-1" />}</h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">{c.email && <span className="flex items-center gap-1"><Mail size={11} />{c.email}</span>}{c.phone && <span className="flex items-center gap-1"><Phone size={11} />{c.phone}</span>}{c.company && <span className="flex items-center gap-1"><Building2 size={11} />{c.company.name}</span>}</div>
                  </div>
                </div>
                <span className={`w-2 h-2 rounded-full ${c.isActive ? "bg-green-400" : "bg-gray-600"}`} />
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="card space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-lg font-bold">{selected.firstName[0]}{selected.lastName[0]}</div>
                <div><h3 className="font-semibold text-white">{selected.firstName} {selected.lastName}</h3>{selected.title && <p className="text-sm text-gray-400">{selected.title}</p>}</div>
              </div>
              <div className="flex items-center gap-1">{!editing ? <><button onClick={startEdit} className="p-1.5 text-gray-400 hover:text-cyber-400" title="Edit"><Edit3 size={14} /></button><button onClick={() => createTicket(selected)} className="btn-primary text-xs flex items-center gap-1.5 px-2.5 py-1" title="Create Ticket"><Ticket size={13} />Create Ticket</button></> : <><button onClick={handleSave} disabled={saving} className="p-1.5 text-green-400 hover:text-green-300" title="Save"><Save size={14} /></button><button onClick={() => setEditing(false)} className="p-1.5 text-gray-400 hover:text-red-400" title="Cancel"><X size={14} /></button></>}</div>
            </div>

            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-gray-500 uppercase">First</label><input className="input-field text-sm" value={String(editForm.firstName || "")} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} /></div>
                  <div><label className="text-[10px] text-gray-500 uppercase">Last</label><input className="input-field text-sm" value={String(editForm.lastName || "")} onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} /></div>
                </div>
                <div><label className="text-[10px] text-gray-500 uppercase">Title / Department</label><div className="grid grid-cols-2 gap-2"><input className="input-field text-sm" placeholder="Title" value={String(editForm.title || "")} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /><input className="input-field text-sm" placeholder="Department" value={String(editForm.department || "")} onChange={e => setEditForm({ ...editForm, department: e.target.value })} /></div></div>
                <div><label className="text-[10px] text-gray-500 uppercase">Email</label><input className="input-field text-sm" type="email" value={String(editForm.email || "")} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-gray-500 uppercase">Phone</label><input className="input-field text-sm" value={String(editForm.phone || "")} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
                  <div><label className="text-[10px] text-gray-500 uppercase">Mobile</label><input className="input-field text-sm" value={String(editForm.mobile || "")} onChange={e => setEditForm({ ...editForm, mobile: e.target.value })} /></div>
                </div>
                <div><label className="text-[10px] text-gray-500 uppercase">Address</label><input className="input-field text-sm" placeholder="Street" value={String(editForm.address || "")} onChange={e => setEditForm({ ...editForm, address: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-2">
                  <input className="input-field text-sm" placeholder="City" value={String(editForm.city || "")} onChange={e => setEditForm({ ...editForm, city: e.target.value })} />
                  <input className="input-field text-sm" placeholder="State" value={String(editForm.state || "")} onChange={e => setEditForm({ ...editForm, state: e.target.value })} />
                  <input className="input-field text-sm" placeholder="ZIP" value={String(editForm.zip || "")} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input-field text-sm" placeholder="Country" value={String(editForm.country || "US")} onChange={e => setEditForm({ ...editForm, country: e.target.value })} />
                  <input className="input-field text-sm" placeholder="Website" value={String(editForm.website || "")} onChange={e => setEditForm({ ...editForm, website: e.target.value })} />
                </div>
                <div><label className="text-[10px] text-gray-500 uppercase">Notes</label><textarea className="input-field text-sm" rows={3} value={String(editForm.notes || "")} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.isPrimary)} onChange={e => setEditForm({ ...editForm, isPrimary: e.target.checked })} />Primary</label>
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.isActive)} onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })} />Active</label>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {selected.company && <div className="flex items-center gap-2 text-sm"><Building2 size={14} className="text-gray-500" /><span className="text-white">{selected.company.name}</span></div>}
                {selected.title && <div className="flex items-center gap-2 text-sm"><Briefcase size={14} className="text-gray-500" /><span className="text-gray-300">{selected.title}{selected.department ? ` · ${selected.department}` : ""}</span></div>}
                <div className="space-y-1.5">
                  {selected.email && <div className="flex items-center gap-2 text-sm"><Mail size={14} className="text-gray-500" /><a href={`mailto:${selected.email}`} className="text-cyber-400 hover:text-cyber-300">{selected.email}</a></div>}
                  {selected.phone && <div className="flex items-center gap-2 text-sm"><Phone size={14} className="text-gray-500" /><span className="text-gray-300">{selected.phone}</span></div>}
                  {selected.mobile && <div className="flex items-center gap-2 text-sm"><Phone size={14} className="text-gray-500" /><span className="text-gray-300">{selected.mobile} <span className="text-xs text-gray-600">(Mobile)</span></span></div>}
                  {(selected.address || selected.city) && <div className="flex items-center gap-2 text-sm"><MapPin size={14} className="text-gray-500" /><span className="text-gray-300">{[selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(", ")}</span></div>}
                  {selected.website && <div className="flex items-center gap-2 text-sm"><Globe size={14} className="text-gray-500" /><a href={selected.website} target="_blank" className="text-cyber-400 hover:text-cyber-300">{selected.website}</a></div>}
                </div>
                {selected.notes && <div className="bg-surface-lighter rounded-lg p-3 mt-2"><p className="text-xs text-gray-400 whitespace-pre-wrap">{selected.notes}</p></div>}
                <div className="flex items-center gap-3 pt-2 border-t border-surface-border text-xs text-gray-500">
                  <span className={`badge ${selected.isPrimary ? "bg-amber-600/20 text-amber-400" : "bg-gray-600/20 text-gray-400"}`}>{selected.isPrimary ? "Primary" : "Secondary"}</span>
                  <span className={`badge ${selected.isActive ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{selected.isActive ? "Active" : "Inactive"}</span>
                  {selected.createdAt && <span className="flex items-center gap-1"><Clock size={11} />{new Date(selected.createdAt).toLocaleDateString()}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Contact Modal */}
      {showCreate && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}><div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}><form onSubmit={handleCreateContact} className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Add Contact</h3><button type="button" onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={18} /></button></div>
        <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="First name*" value={newContact.firstName} onChange={e => setNewContact({ ...newContact, firstName: e.target.value })} required /><input className="input-field" placeholder="Last name*" value={newContact.lastName} onChange={e => setNewContact({ ...newContact, lastName: e.target.value })} required /></div>
        <input className="input-field" placeholder="Email" type="email" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
        <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="Phone" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} /><input className="input-field" placeholder="Title" value={newContact.title} onChange={e => setNewContact({ ...newContact, title: e.target.value })} /></div>
        <select className="input-field" value={newContact.companyId} onChange={e => setNewContact({ ...newContact, companyId: e.target.value })} required><option value="">Select company*</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Add</button><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button></div>
      </form></div></div>)}
    </div>
  );
}
