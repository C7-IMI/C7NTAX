import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Search, Mail, Phone, Building2, Star, Edit3, Save, X, MapPin, Briefcase, Globe, MessageSquare, UserPlus, Clock, Plus, Ticket } from "lucide-react";

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
  const [companyFilter, setCompanyFilter] = useState("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newContact, setNewContact] = useState({ firstName: "", lastName: "", email: "", phone: "", companyId: "", title: "" });
  const navigate = useNavigate();

  const fetch = () => {
    Promise.all([api.get("/clients?limit=100"), api.get("/clients/contacts?limit=500")])
      .then(([cRes, conRes]) => { setCompanies(cRes.data.data || []); setContacts(conRes.data.data || conRes.data || []); })
      .catch(() => toast.error("Failed to load")).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const filtered = contacts.filter(c => {
    if (search && !`${c.firstName} ${c.lastName} ${c.email} ${c.title || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (companyFilter && c.company?.id !== companyFilter) return false;
    return true;
  });

  const selectContact = (c: Contact) => { setSelected(c); setEditing(false); };
  const startEdit = () => {
    if (!selected) return;
    setEditForm({
      firstName: selected.firstName || "", lastName: selected.lastName || "", email: selected.email || "",
      phone: selected.phone || "", mobile: selected.mobile || "", title: selected.title || "",
      department: selected.department || "", isPrimary: selected.isPrimary, isActive: selected.isActive,
      address: selected.address || "", city: selected.city || "", state: selected.state || "",
      zip: selected.zip || "", country: selected.country || "US", notes: selected.notes || "",
      website: selected.website || "",
    });
    setEditing(true);
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
    try { await api.post("/clients", { name: `${newContact.firstName} ${newContact.lastName}`, email: newContact.email, phone: newContact.phone }); toast.success("Contact created"); setShowCreate(false); setNewContact({ firstName: "", lastName: "", email: "", phone: "", companyId: "", title: "" }); fetch(); }
    catch { toast.error("Failed to create"); }
  };

  const createTicket = (c: Contact) => {
    const params = new URLSearchParams();
    if (c.company?.id) params.set("companyId", c.company.id);
    params.set("contactName", `${c.firstName} ${c.lastName}`);
    params.set("contactEmail", c.email);
    navigate(`/tickets?new=1&${params.toString()}`);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Contacts</h2><p className="text-sm text-gray-400">{filtered.length} contacts</p></div><button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Contact</button></div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><input className="input-field pl-9" placeholder="Search contacts..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className="input-field text-sm py-1.5 w-auto" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}><option value="">All Companies</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : filtered.length === 0 ? <div className="text-center py-12 card"><Mail size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No contacts</p></div> : filtered.map(c => (
            <div key={c.id} className={`card hover:border-cyber-500/30 transition-colors cursor-pointer ${selected?.id === c.id ? "border-cyber-500/30" : ""}`} onClick={() => selectContact(c)}>
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
              <div className="flex items-center gap-1">{!editing ? <><button onClick={startEdit} className="p-1.5 text-gray-400 hover:text-cyber-400" title="Edit"><Edit3 size={14} /></button><button onClick={() => createTicket(selected)} className="p-1.5 text-cyber-400 hover:text-cyber-300" title="Create Ticket"><Ticket size={14} /></button></> : <><button onClick={handleSave} disabled={saving} className="p-1.5 text-green-400 hover:text-green-300" title="Save"><Save size={14} /></button><button onClick={() => setEditing(false)} className="p-1.5 text-gray-400 hover:text-red-400" title="Cancel"><X size={14} /></button></>}</div>
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
