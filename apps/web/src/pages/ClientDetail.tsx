import { useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { Save, X, ChevronLeft, Building2, Users, FileText, DollarSign, Ticket, ClipboardList, Clock, Mail, Phone, Globe, MapPin, Badge, Briefcase } from "lucide-react";

const TYPE_OPTIONS = ["Client", "Prospect", "Vendor", "Partner"];
const INDUSTRY_OPTIONS = ["", "Technology", "Healthcare", "Finance", "Manufacturing", "Legal", "Education", "Government", "Non-Profit", "Retail", "Construction"];
const LEVEL_OPTIONS = ["", "Standard", "Premium", "Enterprise"];

export function ClientDetailPage() {
  const { id } = useParams();
  const [client, setClient] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("summary");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    try { const r = await api.get(`/clients/${id}`); setClient(r.data); setForm(r.data); }
    catch { toast.error("Client not found"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try { await api.patch(`/clients/${id}`, form); toast.success("Saved"); setEditing(false); load(); }
    catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!client) return <div className="text-center py-12 text-gray-500">Client not found</div>;

  const tabs = [
    { id: "summary", label: "Summary", icon: Building2 },
    { id: "contacts", label: `Contacts (${client._count?.contacts || 0})`, icon: Users },
    { id: "agreements", label: `Agreements (${client._count?.serviceAgreements || 0})`, icon: ClipboardList },
    { id: "tickets", label: `Tickets (${client._count?.tickets || 0})`, icon: Ticket },
    { id: "invoices", label: `Invoices (${client._count?.invoices || 0})`, icon: DollarSign },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center gap-2 text-sm"><Link to="/clients" className="text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft size={14} /> Clients</Link></div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyber-600/10"><Building2 size={20} className="text-cyber-400" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">{client.name}</h2>
            <p className="text-sm text-gray-400">{client.companyType} {client.industry ? `· ${client.industry}` : ""}</p>
          </div>
        </div>
        {tab === "summary" && (
          editing ? (
            <div className="flex gap-2"><button onClick={() => setEditing(false)} className="btn-secondary"><X size={14} /> Cancel</button><button onClick={handleSave} disabled={saving} className="btn-primary"><Save size={14} /> {saving ? "Saving..." : "Save"}</button></div>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-primary">Edit</button>
          )
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? "border-cyber-400 text-cyber-400" : "border-transparent text-gray-500 hover:text-white"}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Summary Tab */}
      {tab === "summary" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card title="General Information">
              <Grid cols={3}>
                <Field label="Client Name" value={client.name} editing={editing} form={form} setForm={setForm} field="name" />
                <Field label="Legal Name" value={client.legalName} editing={editing} form={form} setForm={setForm} field="legalName" />
                <Field label="Tax ID" value={client.taxId} editing={editing} form={form} setForm={setForm} field="taxId" />
                <Field label="Type" value={client.companyType} editing={editing} form={form} setForm={setForm} field="companyType" type="select" options={TYPE_OPTIONS} />
                <Field label="Industry" value={client.industry} editing={editing} form={form} setForm={setForm} field="industry" type="select" options={INDUSTRY_OPTIONS} />
                <Field label="Service Level" value={client.serviceLevel} editing={editing} form={form} setForm={setForm} field="serviceLevel" type="select" options={LEVEL_OPTIONS} />
                <Field label="Territory" value={client.territory} editing={editing} form={form} setForm={setForm} field="territory" />
                <Field label="Region" value={client.region} editing={editing} form={form} setForm={setForm} field="region" />
                <Field label="Currency" value={client.currency} editing={editing} form={form} setForm={setForm} field="currency" />
              </Grid>
            </Card>
            <Card title="Contact Information">
              <Grid cols={3}>
                <Field label="Phone" value={client.phone} editing={editing} form={form} setForm={setForm} field="phone" />
                <Field label="Fax" value={client.fax} editing={editing} form={form} setForm={setForm} field="fax" />
                <Field label="Email" value={client.email} editing={editing} form={form} setForm={setForm} field="email" />
                <Field label="Billing Email" value={client.billingEmail} editing={editing} form={form} setForm={setForm} field="billingEmail" />
                <Field label="Website" value={client.website} editing={editing} form={form} setForm={setForm} field="website" />
              </Grid>
            </Card>
            <Card title="Primary Address">
              <Grid cols={3}>
                <Field label="Line 1" value={client.addressLine1} editing={editing} form={form} setForm={setForm} field="addressLine1" />
                <Field label="Line 2" value={client.addressLine2} editing={editing} form={form} setForm={setForm} field="addressLine2" />
                <Field label="City" value={client.city} editing={editing} form={form} setForm={setForm} field="city" />
                <Field label="State" value={client.state} editing={editing} form={form} setForm={setForm} field="state" />
                <Field label="Postal" value={client.postalCode} editing={editing} form={form} setForm={setForm} field="postalCode" />
                <Field label="Country" value={client.country} editing={editing} form={form} setForm={setForm} field="country" />
              </Grid>
            </Card>
            <Card title="Billing Address">
              <Grid cols={3}>
                <Field label="Line 1" value={client.billingAddressLine1} editing={editing} form={form} setForm={setForm} field="billingAddressLine1" />
                <Field label="Line 2" value={client.billingAddressLine2} editing={editing} form={form} setForm={setForm} field="billingAddressLine2" />
                <Field label="City" value={client.billingCity} editing={editing} form={form} setForm={setForm} field="billingCity" />
                <Field label="State" value={client.billingState} editing={editing} form={form} setForm={setForm} field="billingState" />
                <Field label="Postal" value={client.billingPostalCode} editing={editing} form={form} setForm={setForm} field="billingPostalCode" />
                <Field label="Country" value={client.billingCountry} editing={editing} form={form} setForm={setForm} field="billingCountry" />
              </Grid>
            </Card>
            {client.notes && (
              <Card title="Notes"><p className="text-sm text-gray-400 whitespace-pre-wrap">{client.notes}</p></Card>
            )}
            {editing && (
              <Card title="Notes (Edit)"><textarea className="input-field text-sm" rows={4} value={form.notes || ""} onChange={e => setForm((p:any) => ({...p, notes: e.target.value}))} /></Card>
            )}
          </div>

          <div className="space-y-4">
            <Card title="Status">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Active</span><span className={`badge ${client.isActive ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{client.isActive ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-white">{client.companyType || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Industry</span><span className="text-white">{client.industry || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Since</span><span className="text-white">{client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}</span></div>
              </div>
            </Card>
            <Card title="Primary Contact">
              {client.contacts?.find((c:any)=>c.isPrimary) ? (
                (() => { const pc = client.contacts.find((c:any)=>c.isPrimary); return (
                  <div className="space-y-1 text-sm">
                    <p className="text-white">{pc.firstName} {pc.lastName}</p>
                    {pc.email && <p className="text-gray-400 flex items-center gap-1"><Mail size={12} /> {pc.email}</p>}
                    {pc.phone && <p className="text-gray-400 flex items-center gap-1"><Phone size={12} /> {pc.phone}</p>}
                  </div>
                ); })()
              ) : <p className="text-sm text-gray-600">No primary contact</p>}
            </Card>
            <Card title="Quick Stats">
              <div className="space-y-2 text-sm">
                {[{l:"Contacts",v:client._count?.contacts},{l:"Agreements",v:client._count?.serviceAgreements},{l:"Tickets",v:client._count?.tickets},{l:"Invoices",v:client._count?.invoices}].map(s => (
                  <div key={s.l} className="flex justify-between"><span className="text-gray-500">{s.l}</span><span className="text-white font-medium">{s.v || 0}</span></div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Contacts Tab */}
      {tab === "contacts" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400"><SortableHeader field="firstName" label="Name" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><th className="px-4 py-3 hidden md:table-cell">Email</th><th className="px-4 py-3 hidden sm:table-cell">Phone</th><th className="px-4 py-3">Title</th><th className="px-4 py-3 w-20">Primary</th></tr></thead>
            <tbody>
              {(client.contacts || []).map((c: any) => (
                <tr key={c.id} className="border-b border-surface-border/50 hover:bg-surface-light/50">
                  <td className="px-4 py-3 text-white">{c.firstName} {c.lastName}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-400">{c.email || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-400">{c.phone || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{c.title || "—"}</td>
                  <td className="px-4 py-3">{c.isPrimary ? <span className="badge bg-cyber-600/20 text-cyber-400">Primary</span> : <span className="text-gray-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Agreements Tab */}
      {tab === "agreements" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400"><SortableHeader field="firstName" label="Name" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><th className="px-4 py-3">Period</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3 hidden sm:table-cell">Status</th></tr></thead>
            <tbody>
              {(client.serviceAgreements || []).map((a: any) => (
                <tr key={a.id} className="border-b border-surface-border/50">
                  <td className="px-4 py-3 text-white">{a.name}</td>
                  <td className="px-4 py-3 text-gray-400">{a.billingPeriod}</td>
                  <td className="px-4 py-3 text-gray-400">${a.billingAmount?.toLocaleString() || "0"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">{a.isActive ? <span className="badge bg-green-600/20 text-green-400">Active</span> : <span className="badge bg-gray-600/20 text-gray-400">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tickets Tab */}
      {tab === "tickets" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400"><SortableHeader field="ticketNumber" label="#" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><SortableHeader field="title" label="Title" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><th className="px-4 py-3 hidden md:table-cell">Status</th><th className="px-4 py-3 hidden sm:table-cell">Assigned</th></tr></thead>
            <tbody>
              {(client.tickets || []).map((t: any) => (
                <tr key={t.id} className="border-b border-surface-border/50 hover:bg-surface-light/50 cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                  <td className="px-4 py-3 text-cyber-400 font-mono text-xs">{t.ticketNumber}</td>
                  <td className="px-4 py-3 text-white">{t.title}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="badge bg-cyber-600/20 text-cyber-400 text-xs">{t.status}</span></td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-400">{t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400"><SortableHeader field="invoiceNumber" label="#" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><SortableHeader field="issueDate" label="Date" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" /><th className="px-4 py-3">Due</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3 hidden sm:table-cell">Status</th></tr></thead>
            <tbody>
              {(client.invoices || []).map((inv: any) => (
                <tr key={inv.id} className="border-b border-surface-border/50">
                  <td className="px-4 py-3 text-white font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(inv.issueDate || inv.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(inv.dueDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-white">${inv.total?.toLocaleString() || "0"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell"><span className={`badge text-xs ${inv.status === "paid" ? "bg-green-600/20 text-green-400" : inv.status === "overdue" ? "bg-red-600/20 text-red-400" : "bg-cyber-600/20 text-cyber-400"}`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card space-y-3"><h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{title}</h3>{children}</div>;
}
function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div className={`grid grid-cols-2 md:grid-cols-${cols} gap-3`}>{children}</div>;
}
function Field({ label, value, editing, form, setForm, field, type, options }: {
  label: string; value: any; editing: boolean; form: Record<string,any>;
  setForm: (v:any) => void; field: string; type?: string; options?: string[];
}) {
  if (!editing && !value) return null;
  if (!editing) return <div><p className="text-xs text-gray-500">{label}</p><p className="text-sm text-white">{String(value || "—")}</p></div>;
  if (type === "select" && options) {
    return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><select className="input-field text-sm py-1.5" value={String(form[field] ?? "")} onChange={e => setForm((p:any) => ({...p, [field]: e.target.value}))}>{options.map(o => <option key={o} value={o}>{o || "—"}</option>)}</select></div>;
  }
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><input className="input-field text-sm py-1.5" value={String(form[field] ?? "")} onChange={e => setForm((p:any) => ({...p, [field]: e.target.value}))} /></div>;
}
