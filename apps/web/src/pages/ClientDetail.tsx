import { useState, useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { Save, X, ChevronLeft, Building2, Users, FileText, DollarSign, Ticket, ClipboardList, Clock, Mail, Phone, Globe, MapPin, Badge, Briefcase, Plus, Copy, Layers, Pencil, ChevronRight } from "lucide-react";
import { PageSkeleton, CardSkeleton } from "../components/ui/Skeleton";
import { FlexpointClientCard } from "../components/FlexpointClientCard";
import { Permission } from "@C7NTAX/shared";
import { useAuth } from "../hooks/useAuth";
import { PageHeader, Tabs } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import { monthlyLabel, monthlyValue } from "../lib/agreements";
import { copyText } from "../lib/menuActions";

const TYPE_OPTIONS = ["Client", "Prospect", "Vendor", "Partner"];
const INDUSTRY_OPTIONS = ["", "Technology", "Healthcare", "Finance", "Manufacturing", "Legal", "Education", "Government", "Non-Profit", "Retail", "Construction"];
const LEVEL_OPTIONS = ["", "Standard", "Premium", "Enterprise"];

/** Asset state, as the chip that reads it — the same three words the Assets page uses. */
function assetStateChip(status: string | undefined): string {
  if (status === "active" || status === "healthy") return "chip--good";
  if (status === "warning" || status === "maintenance") return "chip--warn";
  if (status === "retired" || status === "offline") return "";
  return "chip--bad";
}

export function ClientDetailPage() {
  const { id } = useParams();
  const [client, setClient] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("summary");
  const redesign = useRedesign();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const navigate = useNavigate();
  const { permissions } = useAuth();
  /*
   * Whether the console is available to this client's people is a deployment-level decision, so the API
   * only accepts the field from somebody who holds `system:config`. The interface asks the same question
   * rather than offering a switch that would be silently dropped on save.
   */
  const canSetConsole = permissions.includes(Permission.SystemConfig);

  const load = async () => {
    try { const r = await api.get(`/clients/${id}`); setClient(r.data); setForm(r.data); }
    catch { toast.error("Client not found"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  /*
   * The client's assets are fetched the first time the Configurations tab is opened rather than with
   * the record, because most visits to a client never look at them.
   */
  const [configs, setConfigs] = useState<Record<string, any>[] | null>(null);
  const [configsFailed, setConfigsFailed] = useState(false);
  useEffect(() => {
    if (tab !== "configurations" || configs !== null) return;
    api.get(`/inventory/assets?companyId=${id}&limit=100`)
      .then(r => setConfigs(r.data?.data || []))
      .catch(() => { setConfigsFailed(true); setConfigs([]); });
  }, [tab, id, configs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!canSetConsole) delete payload.consoleEnabled;
      await api.patch(`/clients/${id}`, payload);
      toast.success("Saved"); setEditing(false); load();
    }
    catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  if (loading) return <PageSkeleton />;
  if (!client) return <div className="text-center py-12 text-gray-500">Client not found</div>;

  const tabs = [
    { id: "summary", label: redesign ? "Overview" : "Summary", icon: Building2 },
    { id: "contacts", label: `Contacts (${client._count?.contacts || 0})`, icon: Users },
    { id: "configurations", label: "Configurations", icon: Layers },
    { id: "agreements", label: `Agreements (${client._count?.serviceAgreements || 0})`, icon: ClipboardList },
    { id: "tickets", label: `Tickets (${client._count?.tickets || 0})`, icon: Ticket },
    { id: "invoices", label: `Invoices (${client._count?.invoices || 0})`, icon: DollarSign },
  ];
  const clientTabs = redesign ? tabs : tabs.filter(t => t.id !== "configurations");
  const { amount: mrr, currency } = monthlyValue((client.serviceAgreements || []).filter((a: any) => a.isActive !== false));
  const agreement = (client.serviceAgreements || []).find((a: any) => a.isActive !== false);
  const primaryContact = (client.contacts || []).find((c: any) => c.isPrimary);

  return (
    <div className={redesign ? "space-y-4 animate-fade-in" : "space-y-6 animate-fade-in max-w-5xl"}>
      {redesign ? (
        <div className="card overflow-hidden p-0" data-hl="client-details">
          <div className="flex flex-wrap items-center gap-3 border-b border-surface-border p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Link to="/clients" className="hover:text-white">Clients</Link>
                <span className="text-gray-600">›</span>
                <span className="font-mono">CLIENT-{String(client.id).slice(0, 8).toUpperCase()}</span>
                <span className="text-gray-600">·</span>
                <span className="truncate">{[client.city, client.state].filter(Boolean).join(", ") || "No address"} · {client.companyType || "Client"}</span>
              </div>
              <h1 className="mt-0.5 truncate text-base font-semibold text-white">{client.name}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button onClick={() => setEditing(false)} className="btn-secondary flex items-center gap-1.5"><X size={14} /> Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1.5"><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
                </>
              ) : (
                <>
                  <button onClick={() => navigate(`/tickets?new=1&companyId=${client.id}`)} className="btn-secondary flex items-center gap-1.5"><Plus size={14} /> New ticket</button>
                  <button onClick={() => void copyText(client.notes || "", "Client brief")} disabled={!client.notes} className="btn-secondary flex items-center gap-1.5 disabled:opacity-40"><Copy size={14} /> Copy brief</button>
                  <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-1.5"><Pencil size={14} /> Edit</button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2">
            <span className="chip">{client._count?.tickets ?? 0} tickets</span>
            <span className={`chip ${mrr > 0 ? "chip--good" : ""}`}>{monthlyLabel(mrr, currency)} MRR</span>
            <span className="chip">{client.serviceLevel || "No service level"}</span>
            <span className={`chip ${client.isActive ? "chip--good" : ""}`}>{client.isActive ? "Active" : "Inactive"}</span>
            <span className="chip">{client.industry || "No industry"}</span>
            <span className="chip">{client.consoleEnabled === false ? "Console off" : "Console on"}</span>
            {!client.portalEnabled && <span className="chip">Portal off</span>}
          </div>
          <Tabs
            label="Client sections"
            items={clientTabs.map(t => ({ id: t.id, label: t.label }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      ) : (
      <>
      <div className="flex items-center gap-2 text-sm"><Link to="/clients" className="text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft size={14} /> Clients</Link></div>
      <div className="flex items-center justify-between" data-hl="client-details">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyber-600/10"><Building2 size={20} className="text-cyber-400" /></div>
          <PageHeader variant="section" title={client.name} subtitle={<>{client.companyType} {client.industry ? `· ${client.industry}` : ""}</>} />
        </div>
        {tab === "summary" && (
          editing ? (
            <div className="flex gap-2"><button onClick={() => setEditing(false)} className="btn-secondary"><X size={14} /> Cancel</button><button onClick={handleSave} disabled={saving} className="btn-primary"><Save size={14} /> {saving ? "Saving..." : "Save"}</button></div>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-primary">Edit</button>
          )
        )}
      </div>

      <div className="flex gap-1 border-b border-surface-border overflow-x-auto">
        {clientTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? "border-cyber-400 text-cyber-400" : "border-transparent text-gray-500 hover:text-white"}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      </>
      )}

      {/* Configurations Tab — the client's assets, which the record is the natural place to read. */}
      {tab === "configurations" && (
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white"><Layers size={14} /> Configurations</h3>
            <span className="text-xs text-gray-500">{configs === null ? "Loading…" : `${configs.length} shown`}</span>
          </div>
          {configs === null ? <div className="p-6"><CardSkeleton rows={4} /></div> : configsFailed ? (
            <p className="p-6 text-sm text-amber-400">The inventory could not be read, so this list is incomplete rather than empty.</p>
          ) : configs.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">Nothing recorded against this client yet. Assets are added from <Link to="/assets" className="text-cyber-400 hover:underline">Assets</Link>.</p>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400">
                <th className="px-4 py-2">Tag</th><th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 hidden md:table-cell">Type</th><th className="px-4 py-2">State</th>
                <th className="px-4 py-2 hidden lg:table-cell">Detail</th><th className="px-4 py-2 hidden lg:table-cell">Warranty</th>
              </tr></thead>
              <tbody>
                {configs.map((a: Record<string, any>) => (
                  <tr key={a.id} className="border-b border-surface-border/60">
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{a.assetTag || "—"}</td>
                    <td className="px-4 py-2 text-white">{a.name}</td>
                    <td className="px-4 py-2 hidden md:table-cell text-gray-400">{a.type || "—"}</td>
                    <td className="px-4 py-2"><span className={`chip text-[10px] ${assetStateChip(a.status)}`}>{a.status || "unknown"}</span></td>
                    <td className="px-4 py-2 hidden lg:table-cell text-gray-500">{a.detail || [a.manufacturer, a.model].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-4 py-2 hidden lg:table-cell text-gray-500">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === "summary" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card title={redesign ? "The account" : "General Information"}>
              {redesign && !editing ? (
                <Kv rows={[
                  ["Client number", <span className="font-mono">{String(client.id).slice(0, 8).toUpperCase()}</span>],
                  ["Location", [client.city, client.state].filter(Boolean).join(", ") || null],
                  ["Type", client.companyType],
                  ["Service level", client.serviceLevel],
                  ["Agreement", agreement?.name],
                  ["Recurring", mrr > 0 ? `${monthlyLabel(mrr, currency)} / month` : null],
                  ["Contact", primaryContact ? `${primaryContact.firstName || ""} ${primaryContact.lastName || ""}`.trim() || primaryContact.email : null],
                  ["Industry", client.industry],
                  ["Territory", client.territory],
                  ["Region", client.region],
                  ["Currency", client.currency],
                  ["Since", client.createdAt ? new Date(client.createdAt).toLocaleDateString() : null],
                ]} />
              ) : (
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
              )}
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
            <Card title="Customer Portal (PLAN-013 #3)">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">Portal access</p>
                    <p className="text-xs text-gray-500">Lets this client's contacts sign in, see their own tickets and raise new ones.</p>
                  </div>
                  {editing ? (
                    <button
                      type="button"
                      onClick={() => setForm((p: Record<string, unknown>) => ({ ...p, portalEnabled: !p.portalEnabled }))}
                      className={`badge ${form.portalEnabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}
                    >{form.portalEnabled ? "Enabled" : "Disabled"}</button>
                  ) : (
                    <span className={`badge ${client.portalEnabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{client.portalEnabled ? "Enabled" : "Disabled"}</span>
                  )}
                </div>
                <Grid cols={2}>
                  <Field label="Accent Colour" value={client.portalAccentColor} editing={editing} form={form} setForm={setForm} field="portalAccentColor" placeholder="#0ea5e9" />
                  <Field label="Logo URL" value={client.portalLogoUrl} editing={editing} form={form} setForm={setForm} field="portalLogoUrl" placeholder="https://…" />
                </Grid>
                {editing && form.portalAccentColor && !/^#[0-9a-fA-F]{6}$/.test(String(form.portalAccentColor)) && (
                  <p className="text-xs text-amber-400">The accent colour must look like #0ea5e9.</p>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>Portal address</span>
                  <a className="text-cyber-400 hover:underline" href="/portal" target="_blank" rel="noreferrer">/portal</a>
                  <span className="text-gray-600">— share this with the client's contacts; they sign in with their email address.</span>
                </div>
                <p className="text-xs text-gray-600">
                  The API must also be running with <code>PORTAL_ENABLED=true</code>; until then the portal answers 404 to everybody.
                </p>
              </div>
            </Card>
            {/*
              * Per client, alongside the per person switch in Users & Roles. A client whose own systems
              * must never see the console is not the same decision as one technician being denied it, and
              * this is the one the operator made in words: *"disable the console on a per user or per
              * client basis"*. Disabled here means the permission is withheld from members of *this* client
              * only; anyone outside it is unaffected.
              */}
            <Card title="Console">
              <div className="space-y-3" data-hl="client-console">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-white">Command console</p>
                    <p className="text-xs text-gray-500">
                      The pop-up terminal in the header, and the <code>/console</code> page behind it. What each
                      person may run comes from their own permissions — <code>console:use</code> in Users &amp; Roles.
                    </p>
                  </div>
                  <span className={`badge ${client.consoleEnabled === false ? "bg-gray-600/20 text-gray-400" : "bg-green-600/20 text-green-400"}`}>
                    {client.consoleEnabled === false ? "Disabled" : "Allowed"}
                  </span>
                </div>
                {editing && canSetConsole && (
                  <label className="flex items-start gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.consoleEnabled === false}
                      onChange={(e) => setForm((p: Record<string, unknown>) => ({ ...p, consoleEnabled: e.target.checked ? false : null }))}
                    />
                    <span>
                      Disable the console for every member of this client
                      <span className="block text-xs text-gray-500">Leave unchecked to let the workspace setting and each person's permission decide.</span>
                    </span>
                  </label>
                )}
                {editing && !canSetConsole && (
                  <p className="text-xs text-gray-500">Changing this needs the <code>system:config</code> permission.</p>
                )}
                <p className="text-xs text-gray-600">
                  The workspace-wide switch lives in Administration → Configuration → Workspace; while it is off
                  the console answers 404 to everybody, whatever this says.
                </p>
              </div>
            </Card>
            {editing && (
              <Card title="Notes (Edit)"><textarea className="input-field text-sm" rows={4} value={form.notes || ""} onChange={e => setForm((p:any) => ({...p, notes: e.target.value}))} /></Card>
            )}
          </div>

          <div className="space-y-4">
            {/* The brief first: one paragraph the next technician reads before touching anything. */}
            {redesign && (
              <Card title="Brief">
                {client.notes ? <p className="whitespace-pre-wrap text-sm text-gray-300">{client.notes}</p> : <p className="text-sm text-gray-600">Nothing written yet — this is the highest-value field on the record.</p>}
                <button onClick={() => setEditing(true)} className="btn-secondary mt-1 flex w-full items-center justify-center gap-1.5 text-xs"><Pencil size={12} /> Edit the brief</button>
              </Card>
            )}
            {redesign && (
              <Card title="Recent work">
                {(client.tickets || []).length === 0 ? <p className="text-sm text-gray-600">No tickets yet</p> : (
                  <div className="space-y-1.5">
                    {(client.tickets || []).slice(0, 6).map((t: Record<string, any>) => (
                      <Link key={t.id} to={`/tickets/${t.id}`} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-surface-lighter">
                        <span className="font-mono text-[11px] text-gray-500">{t.ticketNumber ? `#${t.ticketNumber}` : "—"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gray-200">{t.title}</span>
                          <span className="block text-[11px] text-gray-500">{(t.status || "").replace(/_/g, " ")}{t.assignedTo ? ` · ${t.assignedTo.firstName || ""} ${t.assignedTo.lastName || ""}`.trimEnd() : " · Unassigned"}</span>
                        </span>
                        <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-600" />
                      </Link>
                    ))}
                    <Link to={`/tickets?companyId=${client.id}`} className="block pt-1 text-xs text-cyber-400 hover:underline">All of this client's tickets →</Link>
                  </div>
                )}
              </Card>
            )}
            {!redesign && (
            <Card title="Status">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Active</span><span className={`badge ${client.isActive ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{client.isActive ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-white">{client.companyType || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Industry</span><span className="text-white">{client.industry || "—"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Since</span><span className="text-white">{client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}</span></div>
              </div>
            </Card>
            )}
            <Card title="Primary Contact">
              {primaryContact ? (
                <div className="space-y-1 text-sm">
                  <p className="text-white">{primaryContact.firstName} {primaryContact.lastName}</p>
                  {primaryContact.email && <p className="text-gray-400 flex items-center gap-1"><Mail size={12} /> {primaryContact.email}</p>}
                  {primaryContact.phone && <p className="text-gray-400 flex items-center gap-1"><Phone size={12} /> {primaryContact.phone}</p>}
                  {redesign && <Link to={`/contacts?companyId=${client.id}`} className="block pt-1 text-xs text-cyber-400 hover:underline">All contacts →</Link>}
                </div>
              ) : <p className="text-sm text-gray-600">No primary contact</p>}
            </Card>
            <Card title={redesign ? "At a glance" : "Quick Stats"}>
              <div className="space-y-2 text-sm">
                {[{l:"Contacts",v:client._count?.contacts},{l:"Agreements",v:client._count?.serviceAgreements},{l:"Tickets",v:client._count?.tickets},{l:"Invoices",v:client._count?.invoices}].map(s => (
                  <div key={s.l} className="flex justify-between"><span className="text-gray-500">{s.l}</span><span className="text-white font-medium">{s.v || 0}</span></div>
                ))}
                {redesign && configs !== null && <div className="flex justify-between"><span className="text-gray-500">Configurations</span><span className="text-white font-medium">{configs.length}</span></div>}
                {redesign && <div className="flex justify-between"><span className="text-gray-500">Recurring</span><span className="text-white font-medium">{monthlyLabel(mrr, currency)}</span></div>}
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
        <div className="space-y-4">
          {/* What FlexPoint says this client owes — hidden entirely when there is nothing to say. */}
          <FlexpointClientCard companyId={id!} />
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
/** Label/value rows — how the redesigned screens read a record, as opposed to editing it. */
function Kv({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="divide-y divide-surface-border/60">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-xs text-gray-500">{k}</dt>
          <dd className="min-w-0 truncate text-right text-sm text-gray-200">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
function Field({ label, value, editing, form, setForm, field, type, options, placeholder }: {
  label: string; value: any; editing: boolean; form: Record<string,any>;
  setForm: (v:any) => void; field: string; type?: string; options?: string[]; placeholder?: string;
}) {
  if (!editing && !value) return null;
  if (!editing) return <div><p className="text-xs text-gray-500">{label}</p><p className="text-sm text-white">{String(value || "—")}</p></div>;
  if (type === "select" && options) {
    return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><select className="input-field text-sm py-1.5" value={String(form[field] ?? "")} onChange={e => setForm((p:any) => ({...p, [field]: e.target.value}))}>{options.map(o => <option key={o} value={o}>{o || "—"}</option>)}</select></div>;
  }
  return <div><label className="text-xs text-gray-500 block mb-1">{label}</label><input className="input-field text-sm py-1.5" placeholder={placeholder} value={String(form[field] ?? "")} onChange={e => setForm((p:any) => ({...p, [field]: e.target.value}))} /></div>;
}
