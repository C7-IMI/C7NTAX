import { useState, useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { orgTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { copyText, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { formatDate } from "../lib/format";
import { ticketStatusBadge, ticketStatusLabel } from "../lib/ticketStatus";
import { Permission } from "@C7NTAX/shared";
import { useAuth } from "../hooks/useAuth";
import { Search, Mail, Phone, Building2, Star, Edit3, Save, X, MapPin, Briefcase, Globe, MessageSquare, UserPlus, Clock, Plus, Ticket, Users, ExternalLink, UserCheck, UserX, Copy, Download, RotateCw, Eraser, ArrowRight, ShieldOff } from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader, ListViews } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

interface Contact {
  id: string; firstName: string; lastName: string; email: string;
  phone?: string; mobile?: string; title?: string; isPrimary: boolean;
  isActive: boolean; company: { id: string; name: string } | null;
  address?: string; city?: string; state?: string; zip?: string; country?: string;
  notes?: string; department?: string; website?: string; createdAt?: string; updatedAt?: string;
  /** Null follows the client. False refuses the portal to this person. */
  portalAccess?: boolean | null;
  /** Null follows the client's own setting. */
  portalVisibility?: string | null;
}

/** A client as `GET /api/clients` returns it: its own weight, and whether its portal is on. */
interface ClientRow {
  id: string; name: string; portalEnabled?: boolean; primaryContactId?: string | null;
  _count?: { contacts?: number; tickets?: number };
}

/** The handful of fields the contacts screen needs from `GET /api/tickets`. */
interface TicketRow {
  id: string; ticketNumber: string; title: string; status: string;
  boardId: string | null; contactId: string | null; createdAt: string;
  board?: { id: string; name: string } | null;
}

/**
 * Whether a ticket is finished with.
 *
 * The mockup's own words: "Open is not closed and not resolved". Cancelled is not open either, so it
 * counts as finished here — the board figures elsewhere in the product count everything but closed,
 * which is the API's definition and a different number on purpose.
 */
const isFinishedTicket = (status: string) => status === "resolved" || status === "closed" || status === "cancelled";

/** What the sheet's second figure counts: the product's settled pair, resolved or closed. */
const isResolvedTicket = (status: string) => status === "resolved" || status === "closed";

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const redesign = useRedesign();
  const [companyFilter, setCompanyFilter] = useState("");
  const [companies, setCompanies] = useState<ClientRow[]>([]);
  /**
   * The tickets, read so the per-person figures are counted rather than guessed.
   *
   * A contact's "raised" and "still open" are not on the contact record: `GET /clients/contacts`
   * returns the person and their client, nothing else. The whole instance arrives in one page
   * (`limit=500`) and every ticket names its contact, so one read answers all 21 rows and the sheet's
   * ticket lines without a request per person. `ticketsLoaded` is what keeps the page honest when the
   * caller may read contacts but not tickets: the figures are then absent rather than zero.
   */
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const { permissions } = useAuth();
  // The portal overrides are written through `system:config`, so the sheet offers the switch only to
  // somebody the API would accept it from.
  const canManagePortal = permissions.includes(Permission.SystemConfig);
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
    // Its own request and its own failure: a role that may read the address book but not the queue
    // keeps the screen and loses only the counts that come from tickets.
    api.get("/tickets?limit=500")
      .then((r) => { setTickets(r.data.data || []); setTicketsLoaded(true); })
      .catch(() => { setTickets([]); setTicketsLoaded(false); });
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

  /** What one person has raised, still has open, and has finished with — counted from the tickets. */
  const contactStats = (id: string) => {
    const mine = [...tickets.filter(t => t.contactId === id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      raised: mine.length,
      open: mine.filter(t => !isFinishedTicket(t.status)).length,
      resolved: mine.filter(t => isResolvedTicket(t.status)).length,
      boards: new Set(mine.map(t => t.boardId)).size,
      mine,
      newest: mine[0],
    };
  };

  /**
   * One person's portal overrides, written where the product keeps them.
   *
   * `access` is false (refuse this person), true, or null to follow the client again; `visibility`
   * is `contact`, `company` or null. The API refuses both from anybody without `system:config`, which
   * is why the sheet draws the controls only for a caller who holds it.
   */
  const setPortalOverride = async (patch: { access?: boolean | null; visibility?: string | null }, message: string) => {
    if (!selected) return;
    try {
      await api.patch(`/configuration/portal/contacts/${selected.id}`, patch);
      toast.success(message);
      setSelected({ ...selected, ...patch } as Contact);
    } catch { toast.error("Failed to update the portal setting"); }
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

  /**
   * One dialog, both interfaces.
   *
   * The classic screen has always opened this form, and the modern list header's "New contact" opens
   * the same one: the fields, the state and the POST are the screen's, and a second copy of them
   * would be a second place for the two to disagree.
   */
  const createDialog = showCreate ? (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}><div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}><form onSubmit={handleCreateContact} className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">Add Contact</h3><button type="button" onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={18} /></button></div>
        <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="First name*" value={newContact.firstName} onChange={e => setNewContact({ ...newContact, firstName: e.target.value })} required /><input className="input-field" placeholder="Last name*" value={newContact.lastName} onChange={e => setNewContact({ ...newContact, lastName: e.target.value })} required /></div>
        <input className="input-field" placeholder="Email" type="email" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} />
        <div className="grid grid-cols-2 gap-2"><input className="input-field" placeholder="Phone" value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} /><input className="input-field" placeholder="Title" value={newContact.title} onChange={e => setNewContact({ ...newContact, title: e.target.value })} /></div>
        <select className="input-field" value={newContact.companyId} onChange={e => setNewContact({ ...newContact, companyId: e.target.value })} required><option value="">Select company*</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Add</button><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button></div>
      </form></div></div>) : null;

  // ── The modern arrangement ─────────────────────────────────────────────────
  /*
   * A rail of the two choices the page is made of — which slice, and whose client, because they are
   * the same kind of choice and a client's own weight belongs beside its name — rows that carry the
   * person *and* their client, and a sheet that does the work rather than repeating the row.
   *
   * Everything below the early return is the classic screen, untouched: the same state, the same
   * handlers, the same words, in the arrangement the classic interface has always drawn them in.
   */
  if (redesign) {
    const clientIdsInView = [...new Set(filtered.map(c => c.company?.id).filter((id): id is string => Boolean(id)))];
    const ticketsBetweenThem = companies.reduce((n, c) => (clientIdsInView.includes(c.id) ? n + (c._count?.tickets ?? 0) : n), 0);
    const primaryCount = filtered.filter(c => c.isPrimary).length;
    const viewLabel = contactViews.find(v => v.id === view)?.label ?? "All";
    const primaryNames = companies.filter(c => contacts.some(x => x.company?.id === c.id && x.isPrimary)).map(c => c.name);
    const inactiveCount = contacts.filter(c => c.isActive === false).length;
    const noEmailCount = contacts.filter(c => !c.email).length;

    /** What a view holds, in the rail's own words — where "what does primary mean" is answered. */
    const viewNotes: Record<string, string> = {
      all: `${contacts.length} people across ${companies.length} client${companies.length === 1 ? "" : "s"}`,
      primary: primaryNames.length
        ? `${primaryNames.length === companies.length ? "One per client" : `${primaryNames.length} of ${companies.length} clients`}: ${primaryNames.join(", ")}`
        : "No client has a primary contact yet",
      inactive: inactiveCount === 0 ? "Nobody has been deactivated yet" : `${inactiveCount} of ${contacts.length} are no longer in use`,
      "no email": noEmailCount === 0 ? `All ${contacts.length} have an address — the view holds nothing` : `${noEmailCount} without an address`,
    };

    const sheetCompany = companies.find(c => c.id === selected?.company?.id) ?? null;
    const sheetPeople = sheetCompany?._count?.contacts ?? null;
    const clientId = selected?.company?.id ?? null;
    const stats = selected ? contactStats(selected.id) : null;
    const newest = stats?.newest ?? null;
    const clientPeople = sheetCompany ? contacts.filter(c => c.company?.id === sheetCompany.id) : [];
    const clientNoTitle = clientPeople.filter(c => !c.title).length;
    // Only counted when the tickets are known: a fetch that did not answer leaves the sentence out
    // rather than claiming nobody has raised anything.
    const clientNeverRaised = ticketsLoaded ? clientPeople.filter(c => contactStats(c.id).raised === 0).length : 0;
    const clientSentence = clientPeople.length <= 1
      ? "They are the only person at this client."
      : `The client has ${clientPeople.length} people; ${clientNoTitle} of them ${clientNoTitle === 1 ? "has" : "have"} no title on record${clientNeverRaised > 0 ? `, and ${clientNeverRaised} ${clientNeverRaised === 1 ? "has" : "have"} never raised a ticket` : ""}.`;
    const companyPrimary = sheetCompany ? contacts.find(c => c.company?.id === sheetCompany.id && c.isPrimary) : undefined;
    const refusesPortal = selected?.portalAccess === false;

    /** Why this person can or cannot sign in, out of the two answers the product actually holds. */
    const portalSentence = !sheetCompany || stats === null ? "" : !sheetCompany.portalEnabled
      ? `${sheetCompany.name} has its own portal switched off, so nobody at this client has one. ${refusesPortal
        ? "This person is also refused individually, and that refusal outlives the client's switch."
        : "This person has no override, so their answer is the client's answer."}`
      : refusesPortal
        ? `${sheetCompany.name}'s portal is on, but this person is refused individually.`
        : `${sheetCompany.name}'s portal is on, and this person follows it${selected?.portalAccess === true ? " — their own record allows them" : ""}.`;

    return (
      <div
        className="space-y-3.5 animate-fade-in"
        onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
      >
        <ContextMenu state={menu.menuState} onClose={menu.close} />
        <PageHeader variant="section" title="Contacts" subtitle="The address book, by client" />

        <div className="grid gap-3.5 items-start lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_21.75rem]">

          {/* The rail: the two questions the page is asked, as things you press. */}
          <aside className="card p-3" aria-label="Views and clients">
            <p className="ml-0.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">Views</p>
            {contactViews.map(v => {
              const on = view === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setView(v.id)}
                  className={`mb-0.5 block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors ${on ? "border-cyber-500/40 bg-cyber-600/15 text-white" : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">{v.label}</span>
                    <span className={`text-[11px] font-semibold tabular-nums ${on ? "text-cyber-300" : "text-gray-500"}`}>{v.count}</span>
                  </span>
                  <span className="block text-[10.5px] leading-snug text-gray-600">{viewNotes[v.id]}</span>
                </button>
              );
            })}

            <div className="mt-3.5 border-t border-surface-border pt-3">
              <p className="ml-0.5 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">Clients</p>
              {/* The group needs its own "no filter" answer, the way Views has "All": the client the
                  rail was opened on is reachable by deep link, and this is the way back off it. */}
              <button
                type="button"
                aria-pressed={companyFilter === ""}
                onClick={() => setCompanyFilter("")}
                className={`mb-0.5 block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors ${companyFilter === "" ? "border-cyber-500/40 bg-cyber-600/15 text-white" : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium">Any client</span>
                  <span className={`text-[11px] font-semibold tabular-nums ${companyFilter === "" ? "text-cyber-300" : "text-gray-500"}`}>{contacts.length}</span>
                </span>
              </button>
              {companies.map(c => {
                const on = companyFilter === c.id;
                const people = c._count?.contacts ?? 0;
                const raised = c._count?.tickets ?? 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCompanyFilter(on ? "" : c.id)}
                    className={`mb-0.5 block w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors ${on ? "border-cyber-500/40 bg-cyber-600/15 text-white" : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"}`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{c.name}</span>
                      <span className={`text-[11px] font-semibold tabular-nums ${on ? "text-cyber-300" : "text-gray-500"}`}>{people}</span>
                    </span>
                    <span className="block text-[10.5px] leading-snug text-gray-600">
                      {raised} ticket{raised === 1 ? "" : "s"}
                      {typeof c.portalEnabled === "boolean" ? ` · portal ${c.portalEnabled ? "on" : "off"}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-3 border-t border-surface-border pt-2.5 text-[10.5px] leading-snug text-gray-600">
              A client's own weight sits beside its name, which is the question a list of five names
              cannot answer.
            </p>
          </aside>

          {/* The list */}
          <div className="card p-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-3">
              <span className="text-[13px] font-semibold text-white">{viewLabel} contacts</span>
              <span className="text-xs text-gray-500 tabular-nums">
                {filtered.length} {filtered.length === 1 ? "person" : "people"} · {clientIdsInView.length} client{clientIdsInView.length === 1 ? "" : "s"} · {primaryCount} primary
              </span>
              <span className="relative ml-auto w-56 max-w-full">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input ref={searchRef} className="input-field pl-9" placeholder="Search name, email, title…" aria-label="Search contacts" value={search} onChange={e => setSearch(e.target.value)} />
              </span>
              <button type="button" onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-1.5 text-xs"><UserPlus size={13} />New contact</button>
            </div>

            {loading ? <TableSkeleton /> : contacts.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Users size={26} className="mx-auto mb-2 text-gray-600" />
                <p className="text-sm font-medium text-gray-300">Nobody here yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
                  Contacts are who the portal signs in and who a ticket's client email goes to, so a
                  client with nobody on it is a client nothing can be sent to.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-1.5 text-xs"><UserPlus size={13} />Add the first contact</button>
                  {companyFilter && <button type="button" onClick={() => setCompanyFilter("")} className="btn-secondary text-xs">Show every client</button>}
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Mail size={26} className="mx-auto mb-2 text-gray-600" />
                <p className="text-sm font-medium text-gray-300">
                  {search ? "Nothing matches that search" : `${viewLabel} holds nothing${companyFilter ? ` at ${companies.find(c => c.id === companyFilter)?.name ?? "this client"}` : ""}`}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
                  {search
                    ? <>Search is narrowed to “{search}”.</>
                    : view === "no email"
                      ? `All ${contacts.length} contacts have an address, so this view holds 0 of ${contacts.length} — the way out is the view you came from, not a search box that keeps returning nothing.`
                      : `${filtered.length} of ${contacts.length} contacts are in this view.`}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => { setView("all"); setSearch(""); }} className="chip chip--on">Show all <span className="chip__n tabular-nums">{contacts.length}</span></button>
                  {companyFilter && <button type="button" onClick={() => setCompanyFilter("")} className="btn-secondary text-xs">Clear the client filter</button>}
                </div>
              </div>
            ) : (
              <>
                <div>
                  {filtered.map((c, index) => {
                    const person = contactStats(c.id);
                    const on = selected?.id === c.id;
                    return (
                      <div
                        key={c.id}
                        data-contact-row
                        role="button"
                        tabIndex={0}
                        aria-pressed={on}
                        className={`flex cursor-pointer items-start gap-2.5 border-b border-surface-border/60 px-3.5 py-2.5 last:border-0 focus:outline-none focus-visible:bg-surface-light ${on ? "bg-cyber-600/15 shadow-[inset_2px_0_0_var(--cyber-500)]" : "hover:bg-surface-light"}`}
                        onClick={() => selectContact(c)}
                        onContextMenu={(e) => menu.open(e, contactMenuEntries(c), contactMenuHeader(c))}
                        onKeyDown={(e) => {
                          menu.onKeyDown(e, e.currentTarget, contactMenuEntries(c), contactMenuHeader(c));
                          // ↑ ↓ walk the list with the sheet following; ⏎ opens the row under the cursor.
                          const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                          if (step !== 0) {
                            const target = filtered[index + step];
                            if (target) { e.preventDefault(); e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-contact-row]")[index + step]?.focus(); selectContact(target); }
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            selectContact(c);
                          }
                        }}
                      >
                        <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-cyber-600/25 text-[10.5px] font-bold text-cyber-400">{c.firstName[0]}{c.lastName[0]}</span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-white">
                            {c.firstName} {c.lastName}
                            {c.title && <span className="text-[11.5px] font-normal text-gray-500">{c.title}{c.department ? ` · ${c.department}` : ""}</span>}
                            {c.isPrimary && <Star size={11} className="text-amber-400" aria-label="Primary contact" />}
                            {!c.title && <span className="text-[10px] text-gray-600">no title on record</span>}
                          </p>
                          <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                            {c.company && <span className="text-cyber-300">{c.company.name}</span>}
                            {c.email && <><span aria-hidden>·</span><span className="truncate">{c.email}</span></>}
                            {c.phone && <><span aria-hidden>·</span><span>{c.phone}</span></>}
                            {!c.isActive && <span className="text-amber-400">Inactive</span>}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                          {ticketsLoaded && (person.raised === 0
                            ? <span className="text-[11px] text-gray-600">never raised</span>
                            : <>
                                <span className="text-[11px] text-gray-500 tabular-nums">{person.raised} raised</span>
                                <span className="chip tabular-nums">{person.open} open</span>
                              </>)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-surface-border px-3.5 py-2 text-[11px] text-gray-600">
                  <span><kbd className="rounded border border-surface-border px-1 font-mono text-[10px]">↑</kbd> <kbd className="rounded border border-surface-border px-1 font-mono text-[10px]">↓</kbd> moves the selection and the sheet follows</span>
                  <span><kbd className="rounded border border-surface-border px-1 font-mono text-[10px]">⏎</kbd> opens the sheet for the row under the cursor</span>
                  <span><kbd className="rounded border border-surface-border px-1 font-mono text-[10px]">☰</kbd> the row menu keeps Show details · Edit contact · Create ticket · Open client · View client's tickets · Filter by this company · Make primary · Deactivate · Copy name/email/phone</span>
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center gap-2.5 border-t border-surface-border px-3.5 py-2 text-[11px] text-gray-500">
              <span className="tabular-nums">{filtered.length === 0 ? "No rows" : `1–${filtered.length} of ${filtered.length}`}</span>
              <span className="tabular-nums">{primaryCount} primary · {clientIdsInView.length} client{clientIdsInView.length === 1 ? "" : "s"} · {ticketsBetweenThem} tickets between them</span>
              <button type="button" onClick={exportCsv} disabled={filtered.length === 0} className="chip">Export as CSV <span className="chip__n tabular-nums">{filtered.length} rows</span></button>
              <span className="ml-auto text-[10.5px] text-gray-600">
                The address book arrives in one page (<code>limit=500</code>), so this footer counts rather than pages.
              </span>
            </div>
          </div>

          {/* The sheet: what the row cannot say, and what you do next */}
          <aside className="card p-0 overflow-hidden" aria-label="Person detail">
            {!selected || stats === null ? (
              <p className="p-4 text-xs leading-relaxed text-gray-500">
                Select a person to see their client and its weight, what they have raised, whether they
                can sign in, and what you do from here.
              </p>
            ) : (
              <>
                <div className="flex items-start gap-2.5 border-b border-surface-border px-4 py-3.5">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-cyber-600/25 text-sm font-bold text-cyber-400">{selected.firstName[0]}{selected.lastName[0]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-white">
                      {selected.firstName} {selected.lastName}
                      {selected.isPrimary && <Star size={12} className="text-amber-400" aria-label="Primary contact" />}
                    </p>
                    <p className="text-[11.5px] text-gray-500">{selected.title || "no title on record"}{selected.department ? ` · ${selected.department}` : ""}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {clientId && (
                        <button type="button" onClick={() => setCompanyFilter(clientId)} className="chip chip--on" title="Filter the list to this client">
                          <Building2 size={11} />{selected.company?.name}
                        </button>
                      )}
                      {sheetPeople !== null && <span className="chip"><span className="tabular-nums">{sheetPeople} people</span></span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {editing ? (
                      <>
                        <button type="button" onClick={() => void handleSave()} disabled={saving} className="btn-primary inline-flex items-center gap-1.5 text-xs"><Save size={12} />{saving ? "Saving…" : "Save"}</button>
                        <button type="button" onClick={() => setEditing(false)} className="p-1.5 text-gray-400 hover:text-white" title="Cancel"><X size={14} /></button>
                      </>
                    ) : (
                      <button type="button" onClick={startEdit} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><Edit3 size={12} />Edit</button>
                    )}
                  </div>
                </div>

                <div className="px-4 pb-4">
                  {editing ? (
                    /* The modern arrangement of the edit form: a single column in the sheet, because
                       the sheet is 348 pixels wide where the classic card had the width of a grid. */
                    <div className="space-y-2.5 pt-3.5">
                      <div className="grid grid-cols-2 gap-2">
                        <SheetField label="First"><input className="input-field" value={String(editForm.firstName || "")} onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} /></SheetField>
                        <SheetField label="Last"><input className="input-field" value={String(editForm.lastName || "")} onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} /></SheetField>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <SheetField label="Title"><input className="input-field" value={String(editForm.title || "")} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></SheetField>
                        <SheetField label="Department"><input className="input-field" value={String(editForm.department || "")} onChange={e => setEditForm({ ...editForm, department: e.target.value })} /></SheetField>
                      </div>
                      <SheetField label="Email"><input className="input-field" type="email" value={String(editForm.email || "")} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></SheetField>
                      <div className="grid grid-cols-2 gap-2">
                        <SheetField label="Phone"><input className="input-field" value={String(editForm.phone || "")} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></SheetField>
                        <SheetField label="Mobile"><input className="input-field" value={String(editForm.mobile || "")} onChange={e => setEditForm({ ...editForm, mobile: e.target.value })} /></SheetField>
                      </div>
                      <SheetField label="Address"><input className="input-field" value={String(editForm.address || "")} onChange={e => setEditForm({ ...editForm, address: e.target.value })} /></SheetField>
                      <div className="grid grid-cols-2 gap-2">
                        <SheetField label="City"><input className="input-field" value={String(editForm.city || "")} onChange={e => setEditForm({ ...editForm, city: e.target.value })} /></SheetField>
                        <SheetField label="State"><input className="input-field" value={String(editForm.state || "")} onChange={e => setEditForm({ ...editForm, state: e.target.value })} /></SheetField>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <SheetField label="ZIP"><input className="input-field" value={String(editForm.zip || "")} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} /></SheetField>
                        <SheetField label="Country"><input className="input-field" value={String(editForm.country || "US")} onChange={e => setEditForm({ ...editForm, country: e.target.value })} /></SheetField>
                      </div>
                      <SheetField label="Website"><input className="input-field" value={String(editForm.website || "")} onChange={e => setEditForm({ ...editForm, website: e.target.value })} /></SheetField>
                      <SheetField label="Notes"><textarea className="input-field" rows={3} value={String(editForm.notes || "")} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></SheetField>
                      <div className="flex items-center gap-4 pt-1">
                        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.isPrimary)} onChange={e => setEditForm({ ...editForm, isPrimary: e.target.checked })} />Primary</label>
                        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.isActive)} onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })} />Active</label>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Her client: the weight the old select could not carry */}
                      <div className="border-b border-surface-border/60 py-3.5">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">Their client</p>
                        {sheetCompany ? (
                          <>
                            <div className="mt-2 space-y-1.5">
                              <SheetKv k="Client" v={sheetCompany.name} />
                              <SheetKv k="People" v={<span className="tabular-nums">{clientPeople.length} contacts</span>} />
                              <SheetKv k="Tickets" v={<span className="tabular-nums">{sheetCompany._count?.tickets ?? 0} raised</span>} />
                              {typeof sheetCompany.portalEnabled === "boolean" && (
                                <SheetKv k="Portal" v={sheetCompany.portalEnabled ? "On" : "Off — nobody at this client can sign in"} />
                              )}
                              <SheetKv k="Primary" v={companyPrimary ? `${companyPrimary.firstName} ${companyPrimary.lastName}` : "Nobody marked"} />
                            </div>
                            <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                              {clientSentence}
                            </p>
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <button type="button" onClick={() => navigate(`/clients/${sheetCompany.id}`)} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><ExternalLink size={12} />Open the client</button>
                            </div>
                          </>
                        ) : <p className="mt-2 text-[11.5px] text-gray-500">This person has no client on their record.</p>}
                      </div>

                      {/* What she has raised */}
                      <div className="border-b border-surface-border/60 py-3.5">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">What they have raised</p>
                        <div className="mt-2 flex flex-wrap gap-3.5">
                          {([[stats.raised, "raised"], [stats.open, "still open"], [stats.resolved, "resolved"], [stats.boards, "boards"]] as Array<[number, string]>).map(([n, label]) => (
                            <div key={label}>
                              <p className="text-lg font-semibold tabular-nums text-white">{n}</p>
                              <p className="text-[11.5px] text-gray-500">{label}</p>
                            </div>
                          ))}
                        </div>
                        {stats.raised > 0 && (
                          <div className="mt-1.5">
                            {stats.mine.slice(0, 3).map(t => (
                              <div key={t.id} className="border-b border-dashed border-surface-border/60 py-1.5 last:border-0">
                                <div className="flex flex-wrap items-baseline gap-2">
                                  <span className={`badge text-[11px] ${ticketStatusBadge(t.status)}`}>{ticketStatusLabel(t.status)}</span>
                                  <button type="button" onClick={() => navigate(`/tickets/${t.id}`)} className="text-[11.5px] text-cyber-300 hover:text-cyber-200">{t.ticketNumber}</button>
                                  <span className="text-[11px] text-gray-500">{t.board?.name ?? "No board"} · {formatDate(t.createdAt)}</span>
                                </div>
                                <p className="mt-0.5 text-[11.5px] text-gray-300">{t.title}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
                          {stats.raised === 0
                            ? "Nothing has ever been raised for them."
                            : `${Math.min(3, stats.raised)} of the ${stats.raised}, newest first; the sheet is a way in, not a second ticket list. "Open" is not closed and not resolved, and "resolved" counts resolved and closed — the product's own finished pair.`}
                        </p>
                        {sheetCompany && (
                          <div className="mt-2.5">
                            <button type="button" onClick={() => navigate(`/tickets?companyId=${sheetCompany.id}`)} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
                              <Ticket size={12} />{sheetCompany.name}'s {sheetCompany._count?.tickets ?? 0} tickets<ArrowRight size={12} />
                            </button>
                            <p className="mt-1.5 text-[11.5px] text-gray-500">
                              The queue filters by client, not by person, so this opens the tickets at
                              {" "}{sheetCompany.name}.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Whether she can sign in */}
                      {typeof sheetCompany?.portalEnabled === "boolean" && (
                        <div className="border-b border-surface-border/60 py-3.5">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">Signing in to the portal</p>
                          <p className="mt-2 text-[13px] font-medium text-white">{sheetCompany.portalEnabled && !refusesPortal ? "Can sign in to the portal" : "Cannot sign in to the portal"}</p>
                          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">{portalSentence}</p>
                          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                            {selected.portalVisibility
                              ? `What they would see is set on this person: ${selected.portalVisibility === "company" ? "every ticket at the client" : "only the tickets they raised, are the contact on, or were added to"}.`
                              : "What they would see follows the client's own setting."}
                          </p>
                          {canManagePortal && (
                            <>
                              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                                <div className="min-w-[9rem] flex-1">
                                  <p className="text-xs text-white">Refuse the portal to this person</p>
                                  <p className="text-[11.5px] leading-snug text-gray-500">
                                    {refusesPortal
                                      ? "On: refused on their own record, whether or not the client's portal is on."
                                      : "Off: they follow the client. On refuses them alone, and would still refuse them if the client's portal were switched on tomorrow."}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={refusesPortal}
                                  aria-label="Refuse the portal to this person"
                                  onClick={() => void setPortalOverride({ access: refusesPortal ? null : false }, refusesPortal ? "Portal access follows the client again" : "Portal refused to this person")}
                                  className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${refusesPortal ? "border-cyber-500/50 bg-cyber-600/40" : "border-surface-border bg-surface-lighter"}`}
                                >
                                  <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all ${refusesPortal ? "left-[1.15rem]" : "left-[3px]"}`} />
                                </button>
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                                <div className="min-w-[9rem] flex-1">
                                  <p className="text-xs text-white">What they would see</p>
                                  <p className="text-[11.5px] leading-snug text-gray-500">Following the client means whatever the client's own setting says, and the instance default beyond that.</p>
                                </div>
                                <select
                                  className="input-field w-[10.75rem] shrink-0"
                                  aria-label="What they would see"
                                  value={selected.portalVisibility ?? "inherit"}
                                  onChange={e => void setPortalOverride({ visibility: e.target.value === "inherit" ? null : e.target.value }, "Portal visibility updated")}
                                >
                                  <option value="inherit">Follows the client</option>
                                  <option value="contact">Only their own tickets</option>
                                  <option value="company">Every ticket at the client</option>
                                </select>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* The last contact */}
                      <div className="border-b border-surface-border/60 py-3.5">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">The last contact</p>
                        <p className="mt-2 text-[12.5px] text-white">
                          {newest ? (
                            <>
                              {formatDate(newest.createdAt)} — the newest ticket they raised:{" "}
                              <button type="button" onClick={() => navigate(`/tickets/${newest.id}`)} className="text-cyber-300 hover:text-cyber-200">{newest.ticketNumber}</button>
                              <span className="text-gray-500"> · {newest.title}, {ticketStatusLabel(newest.status).toLowerCase()}.</span>
                            </>
                          ) : "No ticket has ever been raised by them."}
                        </p>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
                          Their record was last changed on {formatDate(selected.updatedAt)}. There is no
                          per-person activity log in the product, so the honest answer is the newest thing
                          recorded against them — here a ticket, and the line names it rather than implying
                          a call nobody logged.
                        </p>
                      </div>

                      {/* What you do from here */}
                      <div className="py-3.5">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">What you do from here</p>
                        <div className="mt-2 space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="min-w-[9rem] flex-1">
                              <p className="text-xs text-white">Raise a ticket for {selected.firstName} {selected.lastName}</p>
                              <p className="text-[11.5px] leading-snug text-gray-500">
                                Opens the new-ticket form with {sheetCompany?.name ?? "their client"} and their
                                name and address already filled in — the contact, not just the client.
                              </p>
                            </div>
                            <button type="button" onClick={() => createTicket(selected)} className="btn-primary inline-flex items-center gap-1.5 text-xs"><Ticket size={13} />Raise a ticket</button>
                          </div>

                          {(selected.email || selected.phone) && (
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-[9rem] flex-1">
                                <p className="text-xs text-white">Write to them</p>
                                <p className="text-[11.5px] leading-snug text-gray-500">
                                  {selected.email ? `${selected.email} — the address a closing mail would go to.` : `${selected.phone} is the number on their record; there is no address to mail.`}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {selected.email && <a href={`mailto:${selected.email}`} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><Mail size={12} />Send a mail</a>}
                                {selected.phone && <a href={`tel:${selected.phone}`} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><Phone size={12} />Call {selected.phone}</a>}
                              </div>
                            </div>
                          )}

                          {sheetCompany && (
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-[9rem] flex-1">
                                <p className="text-xs text-white">Primary contact for {sheetCompany.name}</p>
                                <p className="text-[11.5px] leading-snug text-gray-500">
                                  {selected.isPrimary
                                    ? `Already set. Unsetting it leaves the client without one${sheetCompany.primaryContactId ? "" : ", because the client's own primaryContactId is unset"} — the flag on the person is the only answer the product has.`
                                    : `${companyPrimary ? `${companyPrimary.firstName} ${companyPrimary.lastName} holds it today` : "Nobody holds it today"}; setting it moves the flag to this person.`}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void setContactField(selected, { isPrimary: !selected.isPrimary }, selected.isPrimary ? "Primary contact cleared" : "Primary contact updated")}
                                className={selected.isPrimary ? "chip chip--on" : "btn-secondary"}
                              >
                                <Star size={12} />{selected.isPrimary ? "Primary" : "Make primary"}
                              </button>
                            </div>
                          )}

                          {selected.isActive === false && (
                            <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-[9rem] flex-1">
                                <p className="text-xs text-white">They are deactivated</p>
                                <p className="text-[11.5px] leading-snug text-gray-500">Reactivating puts them back in every list that names them, including this one.</p>
                              </div>
                              <button type="button" onClick={() => void setContactField(selected, { isActive: true }, "Contact reactivated")} className="btn-secondary inline-flex items-center gap-1.5 text-xs"><UserCheck size={12} />Reactivate</button>
                            </div>
                          )}
                        </div>
                      </div>

                      {selected.portalAccess === false && !canManagePortal && (
                        <p className="flex items-start gap-1.5 pt-3 text-[11.5px] text-gray-500">
                          <ShieldOff size={12} className="mt-0.5 shrink-0" />
                          Their portal access is refused on their own record. Changing that needs{" "}
                          <code>system:config</code>.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>

        {createDialog}
      </div>
    );
  }

  // ── The classic arrangement ───────────────────────────────────────────────
  /*
   * Unchanged. `redesign` is false by the time this renders, so the two guards below still describe
   * what this screen had before the redesign and the markup they wrap is exactly what it was.
   */
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
      {createDialog}
    </div>
  );
}

/** One labelled field in the modern sheet's edit form, where the sheet is too narrow for a grid. */
function SheetField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

/** A key-and-value line: the label is the question, the value is the answer the product holds. */
function SheetKv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-[6.5rem] shrink-0 text-[11.5px] text-gray-500">{k}</span>
      <span className="min-w-0 text-white">{v}</span>
    </div>
  );
}
