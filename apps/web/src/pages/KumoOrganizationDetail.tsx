import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  ArrowLeft, Building2, Shield, FileText, Key, MapPin, Users, Clock, StickyNote, Pencil, Plus,
  History, CalendarClock, ChevronRight, Save, X, Globe, Mail, Phone, ExternalLink, Monitor,
  Server, BookOpen, Lock, Check, Activity, GitBranch,
} from "lucide-react";
import { initials, avatarColor, timeAgo, formatDate, formatDateShort, daysUntil } from "../lib/format";
import { UI_KUMO_TYPES } from "../lib/uiFlags";
import { OrganizationTypePanel } from "../components/OrganizationTypePanel";
import { OrganizationTypeRail, promotedTypeLink, type AssetType } from "../components/OrganizationTypeRail";
import { kumoClientTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

interface Organization {
  id: string;
  name: string;
  companyType: string | null;
  industry: string | null;
  territory: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  notes: string | null;
  isActive: boolean;
  serviceLevel: string | null;
  portalEnabled: boolean;
  parentId: string | null;
  updatedAt: string;
  _count: { contacts: number; tickets: number; serviceAgreements: number; invoices: number };
}

interface RecentItem {
  id: string; entityType: string; entityId: string; entityName: string; entityIcon: string; viewedAt: string;
}
interface OrgContact {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
  title: string | null; isPrimary: boolean;
}
interface UpdatedItem { type: string; id: string; name: string; updatedAt: string }
interface PopularPassword { id: string; label: string; username: string | null; url: string | null; accessCount: number }
interface Expiration { type: string; id: string; name: string; expiresAt: string }
interface ActivityEvent { type: string; id: string; name: string; action: string; at: string; by: string | null }
interface SubOrganization { id: string; name: string; companyType: string | null; city: string | null; state: string | null; isActive: boolean }

interface Detail {
  organization: Organization;
  counts: { assets: number; passwords: number; documents: number; domains: number; certificates: number; configs: number };
  passwordStrength: Record<string, number>;
  documentation: { stale: number; notViewed: number; expired: number; staleAfterDays: number };
  recentlyViewed: RecentItem[];
  importantContacts: OrgContact[];
  recentlyUpdated: UpdatedItem[];
  popularPasswords: PopularPassword[];
  upcomingExpirations: Expiration[];
  activity: ActivityEvent[];
  subOrganizations: SubOrganization[];
  assetTypes: AssetType[];
  changeBoard: { id: string; name: string } | null;
}

/** The vault's own ladder, plus the "never scored" bucket. */
const STRENGTH_LEVELS: { key: string; bar: string; dot: string }[] = [
  { key: "Very Weak", bar: "bg-red-500", dot: "text-red-500" },
  { key: "Weak", bar: "bg-red-400", dot: "text-red-400" },
  { key: "Fair", bar: "bg-amber-400", dot: "text-amber-400" },
  { key: "Good", bar: "bg-amber-300", dot: "text-amber-300" },
  { key: "Strong", bar: "bg-green-400", dot: "text-green-400" },
  { key: "Very Strong", bar: "bg-green-500", dot: "text-green-500" },
  { key: "Not evaluated", bar: "bg-gray-600", dot: "text-gray-600" },
];

/** ?type= value the rail uses for the address panel (it is not a template). */
const LOCATIONS_TYPE = "locations";

function typeIcon(type: string, size = 14) {
  const map: Record<string, JSX.Element> = {
    Asset: <Monitor size={size} />,
    Configuration: <Server size={size} />,
    Password: <Key size={size} />,
    Document: <BookOpen size={size} />,
    Domain: <Globe size={size} />,
    Certificate: <Lock size={size} />,
  };
  return map[type] ?? <FileText size={size} />;
}

/**
 * A screen that belongs to one client: the destination plus ?companyId=, so it
 * opens filtered to this organization and its trail can name the client instead
 * of falling back to the whole-app list.
 */
function scopedTo(path: string, orgId: string, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  query.set("companyId", orgId);
  return `${path}?${query.toString()}`;
}

/** Where an item opens: its own screen, selected by query param. */
function itemLink(type: string, id: string, orgId: string): string {
  switch (type.toLowerCase()) {
    case "asset": return `/kumo/assets/${id}`;
    case "config":
    case "configuration": return scopedTo("/kumo/configs", orgId, { select: id });
    case "password": return scopedTo("/kumo/passwords", orgId, { select: id });
    case "document": return scopedTo("/kumo/documents", orgId, { doc: id });
    case "domain":
    case "certificate": return scopedTo("/kumo/domains", orgId, { select: id });
    case "organization": return `/kumo/organizations/${id}`;
    default: return "/kumo";
  }
}

function itemTitle(type: string): string {
  return type.toLowerCase() === "config" ? "Open the configuration" : `Open this ${type.toLowerCase()}`;
}

export function KumoOrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redesign = useRedesign();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const [subForm, setSubForm] = useState({ name: "", companyType: "Client", city: "", state: "" });
  const [savingSub, setSavingSub] = useState(false);
  // The Checklists entry in Core Assets owns a section of its own, so the rail
  // shows a real count rather than the generic asset-type number.
  const [checklists, setChecklists] = useState<Array<{ id: string }>>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/kumo/organizations/${id}`);
      setDetail(r.data);
      setNotes(r.data?.organization?.notes ?? "");
      setError("");
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? "That organization could not be found." : "Could not load this organization.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.get("/checklists", { params: { companyId: id } })
      .then((r) => setChecklists(r.data?.data || []))
      .catch(() => setChecklists([]));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveNotes = async () => {
    if (!detail) return;
    setSavingNotes(true);
    try {
      await api.patch(`/clients/${detail.organization.id}`, { notes });
      setDetail({ ...detail, organization: { ...detail.organization, notes } });
      setEditingNotes(false);
      toast.success("Notes saved");
    } catch {
      toast.error("Could not save notes");
    } finally {
      setSavingNotes(false);
    }
  };

  const createSubOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSavingSub(true);
    try {
      await api.post("/clients", { ...subForm, parentId: detail.organization.id });
      toast.success("Sub-organization created");
      setShowAddSub(false);
      setSubForm({ name: "", companyType: "Client", city: "", state: "" });
      load();
    } catch {
      toast.error("Could not create sub-organization");
    } finally {
      setSavingSub(false);
    }
  };

  // The rail drives this screen through ?type=: a template id shows that
  // client's records of that type, "locations" the address panel, and no value
  // the dashboard below. Unknown values fall back to the dashboard, and the
  // whole thing is inert when the rail is switched off.
  const requestedType = searchParams.get("type") ?? "";
  const activeType = UI_KUMO_TYPES ? requestedType : "";
  const activeTemplate = activeType && activeType !== LOCATIONS_TYPE
    ? detail?.assetTypes?.find((t) => t.id === activeType) ?? null
    : null;

  // The trail names what the navigation tree cannot: this client, and the type
  // (or address panel) the rail has open. Kept above the loading guards so the
  // hook runs on every render.
  useBreadcrumbTrail(
    detail?.organization
      ? kumoClientTrail(
          detail.organization.id,
          detail.organization.name,
          ...(activeTemplate
            ? [{ label: activeTemplate.name }]
            : activeType === LOCATIONS_TYPE
              ? [{ label: "Locations" }]
              : [])
        )
      : null
  );

  if (loading) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (error || !detail) {
    return (
      <div className="card p-8 text-center space-y-3">
        <p className="text-sm text-gray-400">{error || "Could not load this organization."}</p>
        <div className="flex justify-center gap-2">
          <button onClick={load} className="btn-secondary text-sm">Retry</button>
          <Link to="/kumo/organizations" className="btn-secondary text-sm">Back to Organizations</Link>
        </div>
      </div>
    );
  }

  const { organization: org, counts, passwordStrength, documentation } = detail;
  const totalPasswords = counts.passwords;
  const documentationTotal = counts.documents + counts.domains + counts.certificates;
  const location = [org.city, org.state].filter(Boolean).join(", ");

  const panel = activeTemplate && promotedTypeLink(activeTemplate, org.id) ? (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold text-white">{activeTemplate.name}</h3>
      <p className="text-sm text-gray-500">
        {activeTemplate.name} moved into Core Assets and has a section of its own, so this type no longer holds records.
      </p>
      <Link to={promotedTypeLink(activeTemplate, org.id)!.to!(org.id)} className="btn-primary text-sm inline-flex items-center gap-2">
        Open {activeTemplate.name}
      </Link>
    </div>
  ) : activeTemplate ? (
    <OrganizationTypePanel
      orgId={org.id}
      orgName={org.name}
      templateId={activeTemplate.id}
      templateName={activeTemplate.name}
      templateDescription={activeTemplate.description}
      templateIconName={activeTemplate.icon}
      templateColor={activeTemplate.color}
      fieldCount={activeTemplate.fieldCount}
    />
  ) : activeType === LOCATIONS_TYPE ? (
    <LocationsPanel org={org} />
  ) : null;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ──
          A record header keeps its own shape — the pills are states a title cannot carry — but in the
          redesigned interface the name and those pills share one line rather than stacking. */}
      <div className={redesign ? "flex flex-wrap items-center justify-between gap-2" : "flex flex-wrap items-start justify-between gap-3"}>
        <div className={redesign ? "min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1" : "min-w-0"}>
          <h2 className={redesign ? "text-base font-semibold text-white truncate" : "text-2xl font-semibold text-white mt-1 truncate"}>{org.name}</h2>
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${redesign ? "text-xs text-gray-500" : "mt-1 text-sm text-gray-400"}`}>
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${org.isActive ? "bg-green-400" : "bg-gray-600"}`} />
              {org.isActive ? "Active" : "Inactive"} {org.companyType || "Client"}
            </span>
            {location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{location}</span>}
            {org.industry && <span>{org.industry}</span>}
            {org.serviceLevel && (redesign
              ? <span className="chip chip--good">{org.serviceLevel}</span>
              : <span className="badge text-xs bg-cyber-600/20 text-cyber-400">{org.serviceLevel}</span>)}
            <span>{org._count.contacts} contacts</span>
            <span>{org._count.tickets} tickets</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link to={scopedTo("/kumo/documents", org.id)} className="btn-secondary text-sm flex items-center gap-2">
            <BookOpen size={14} /> New Document
          </Link>
          <Link to={`/clients/${org.id}`} className="btn-secondary text-sm flex items-center gap-2">
            <Pencil size={14} /> Edit
          </Link>
          <div className="relative">
            <button onClick={() => setShowQuickAdd(v => !v)} className="btn-primary text-sm flex items-center gap-2">
              <Plus size={14} /> Quick Add
            </button>
            {showQuickAdd && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowQuickAdd(false)} />
                <div className="absolute right-0 mt-1 w-52 z-50 card p-1 space-y-0.5">
                  {[
                    { to: scopedTo("/kumo/assets", org.id), label: "New Asset", icon: Monitor },
                    { to: scopedTo("/kumo/passwords", org.id), label: "New Password", icon: Key },
                    { to: scopedTo("/kumo/documents", org.id), label: "New Document", icon: BookOpen },
                    { to: scopedTo("/kumo/configs", org.id), label: "New Configuration", icon: Server },
                    { to: `/clients/${org.id}`, label: "New Contact", icon: Users },
                  ].map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={() => setShowQuickAdd(false)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-gray-300 hover:bg-surface-lighter hover:text-white"
                    >
                      <item.icon size={14} className="text-gray-500" /> {item.label}
                    </Link>
                  ))}
                  <button
                    onClick={() => { setShowQuickAdd(false); setShowAddSub(true); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-gray-300 hover:bg-surface-lighter hover:text-white"
                  >
                    <GitBranch size={14} className="text-gray-500" /> Add Sub-Organization
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Figures — everything this client holds in Kumo, taken from the counts the page already has. */}
      {redesign && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Assets" value={counts.assets} icon={<Monitor size={13} />} />
          <StatCard label="Configurations" value={counts.configs} icon={<Server size={13} />} tone="green" />
          <StatCard label="Credentials" value={counts.passwords} icon={<Key size={13} />} tone="amber" />
          <StatCard label="Documents" value={counts.documents} icon={<BookOpen size={13} />} tone="neutral" />
          <StatCard label="Domains" value={counts.domains} icon={<Globe size={13} />} tone="neutral" />
          <StatCard label="Certificates" value={counts.certificates} icon={<Lock size={13} />} tone="neutral" />
        </div>
      )}

      {/* ── Type rail + panel, or the dashboard on its own ─────── */}
      <div className={UI_KUMO_TYPES ? "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-4 lg:items-start" : ""}>
        {UI_KUMO_TYPES && (
          <OrganizationTypeRail
            orgId={org.id}
            counts={{
              assets: counts.assets,
              configs: counts.configs,
              contacts: org._count.contacts,
              documents: counts.documents,
              passwords: counts.passwords,
              domains: counts.domains,
              certificates: counts.certificates,
              tickets: org._count.tickets,
              checklists: checklists.length,
            }}
            assetTypes={detail.assetTypes ?? []}
            changeBoard={detail.changeBoard ?? null}
            activeType={activeType}
          />
        )}

        <div className="space-y-4 min-w-0">
          {panel}
          {/* Carries its own vertical rhythm: with `contents` Tailwind's
              space-y-* on the column cannot reach these cards, since that
              selector only matches direct DOM children. */}
          <div className={panel ? "hidden" : "space-y-5"}>

      {/* ── Quick notes ────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StickyNote size={15} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">Quick Notes</h3>
          </div>
          {!editingNotes ? (
            <button onClick={() => setEditingNotes(true)} className="text-xs text-cyber-400 hover:text-cyber-300">
              {org.notes ? "Edit Note" : "Add Note"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => { setNotes(org.notes ?? ""); setEditingNotes(false); }} className="btn-secondary text-xs py-1 flex items-center gap-1">
                <X size={12} /> Cancel
              </button>
              <button onClick={saveNotes} disabled={savingNotes} className="btn-primary text-xs py-1 flex items-center gap-1">
                <Save size={12} /> {savingNotes ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">Kept on the client record — visible to anyone who can see this organization.</p>
        {editingNotes ? (
          <textarea
            className="input-field mt-2"
            rows={3}
            placeholder="Add a quick note about this organization…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus
          />
        ) : (
          <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">
            {org.notes || <span className="text-gray-500">No notes yet. Use Add Note to jot something down.</span>}
          </p>
        )}
      </div>

      {/* ── Password strength + documentation health ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield size={15} className="text-cyber-400" />
              <h3 className="text-sm font-semibold text-white">Password Strength</h3>
            </div>
            <span className="text-xs text-gray-500" title="Scored from the stored credential: length, case, digits and symbols. Credentials that cannot be read (seed placeholders) count as not evaluated.">
              How is this evaluated?
            </span>
          </div>
          <p className="text-xs text-gray-500">{totalPasswords} total passwords</p>

          <div className="flex h-2 rounded-full overflow-hidden bg-surface-lighter">
            {totalPasswords === 0
              ? <div className="w-full bg-gray-600/60" />
              : STRENGTH_LEVELS.filter((l) => (passwordStrength[l.key] ?? 0) > 0).map((l) => (
                <div
                  key={l.key}
                  className={l.bar}
                  style={{ flexGrow: passwordStrength[l.key], minWidth: 4 }}
                  title={`${l.key}: ${passwordStrength[l.key]}`}
                />
              ))}
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-7 gap-y-1 gap-x-1">
            {STRENGTH_LEVELS.map((l) => (
              <Link
                key={l.key}
                to={scopedTo("/kumo/passwords", org.id, { strength: l.key })}
                title={`Show the ${l.key.toLowerCase()} credentials`}
                className="text-center rounded-lg py-1 hover:bg-surface-lighter transition-colors"
              >
                <p className="text-[10px] text-gray-500 leading-tight">{l.key}</p>
                <p className={`text-xs mt-0.5 inline-flex items-center gap-1 ${l.dot}`}>
                  <Shield size={11} /> <span className="text-gray-300">{passwordStrength[l.key] ?? 0}</span>
                </p>
              </Link>
            ))}
          </div>

          <Link to={scopedTo("/kumo/passwords", org.id)} className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1">
            View More <ChevronRight size={12} />
          </Link>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">Documentation Health Summary</h3>
          </div>
          <p className="text-xs text-gray-500">
            {documentationTotal} tracked items across {counts.documents} documents, {counts.domains} domains and {counts.certificates} certificates
          </p>
          <div className="flex items-start justify-around gap-2 pt-1">
            <HealthRing value={documentation.stale} total={documentationTotal} label="Stale" tone="stroke-amber-400" to={scopedTo("/kumo/documents", org.id, { filter: "stale" })} />
            <HealthRing value={documentation.notViewed} total={documentationTotal} label="Not Viewed" tone="stroke-cyber-400" to={scopedTo("/kumo/documents", org.id, { filter: "unviewed" })} />
            <HealthRing value={documentation.expired} total={documentationTotal} label="Expired" tone="stroke-red-400" to={scopedTo("/kumo/domains", org.id, { filter: "expired" })} />
          </div>
          <p className="text-[10px] text-gray-600">
            Stale = a document untouched for {documentation.staleAfterDays} days. Expired = a domain or certificate past its expiry date.
          </p>
          <Link to={scopedTo("/kumo/documents", org.id)} className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1">
            View More <ChevronRight size={12} />
          </Link>
        </div>
      </div>

      {/* ── Recents / contacts / recently updated ──────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SectionCard icon={History} title="Recently Viewed By You">
          {detail.recentlyViewed.length === 0 ? (
            <p className="text-sm text-gray-500">You haven't viewed anything recently.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.recentlyViewed.map((item) => (
                <Link
                  key={item.id}
                  to={itemLink(item.entityType, item.entityId, org.id)}
                  title={itemTitle(item.entityType)}
                  className="flex items-center gap-2 text-sm rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-lighter group"
                >
                  <span className="text-gray-500 shrink-0">{typeIcon(item.entityIcon, 13)}</span>
                  <span className="text-gray-300 truncate flex-1 group-hover:text-cyber-300">{item.entityName}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(item.viewedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Users}
          title="Important Contacts"
          action={<Link to={`/clients/${org.id}`} className="text-xs text-cyber-400 hover:text-cyber-300">Add Contact</Link>}
        >
          {detail.importantContacts.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing to show.</p>
          ) : (
            <div className="space-y-2">
              {detail.importantContacts.map((c) => (
                <Link
                  key={c.id}
                  to={scopedTo("/clients/contacts", org.id, { select: c.id })}
                  title="Open this contact"
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-lighter group"
                >
                  <span className={`w-7 h-7 rounded-lg grid place-items-center text-[10px] font-semibold shrink-0 ${avatarColor(c.firstName + c.lastName)}`}>
                    {initials(`${c.firstName} ${c.lastName}`)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate group-hover:text-cyber-300">
                      {c.firstName} {c.lastName}
                      {c.isPrimary && <span className="badge text-[10px] ml-1.5 bg-cyber-600/20 text-cyber-400">Primary</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{c.title || c.email}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={Clock} title="Recently Updated">
          {detail.recentlyUpdated.length === 0 ? (
            <p className="text-sm text-gray-500">You haven't updated anything recently.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.recentlyUpdated.map((item) => (
                <Link
                  key={`${item.type}-${item.id}`}
                  to={itemLink(item.type, item.id, org.id)}
                  title={itemTitle(item.type)}
                  className="flex items-center gap-2 text-sm rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-lighter group"
                >
                  <span className="text-gray-500 shrink-0">{typeIcon(item.type, 13)}</span>
                  <span className="text-gray-300 truncate flex-1 group-hover:text-cyber-300">{item.name}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(item.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Passwords / expirations / locations ────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SectionCard
          icon={Key}
          title="Popular Passwords"
          action={<Link to={scopedTo("/kumo/passwords", org.id)} className="text-xs text-cyber-400 hover:text-cyber-300">Add Password</Link>}
        >
          {detail.popularPasswords.length === 0 ? (
            <p className="text-sm text-gray-500">No passwords yet.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.popularPasswords.map((p) => (
                <Link
                  key={p.id}
                  to={scopedTo("/kumo/passwords", org.id, { select: p.id })}
                  title="Open this credential"
                  className="flex items-center gap-2 text-sm group rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-lighter"
                >
                  <Key size={13} className="text-gray-500 shrink-0" />
                  <span className="text-gray-300 truncate flex-1 group-hover:text-cyber-300">{p.label}</span>
                  {p.username && <span className="text-[10px] text-gray-600 shrink-0 truncate max-w-[45%]">{p.username}</span>}
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={CalendarClock}
          title="Upcoming Expirations"
          action={<Link to={`/kumo/domains?filter=upcoming&companyId=${org.id}`} className="text-xs text-cyber-400 hover:text-cyber-300">View All</Link>}
        >
          {detail.upcomingExpirations.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing to show.</p>
          ) : (
            <div className="space-y-1.5">
              {detail.upcomingExpirations.map((item) => {
                const when = daysUntil(item.expiresAt);
                return (
                  <Link
                    key={`${item.type}-${item.id}`}
                    to={itemLink(item.type, item.id, org.id)}
                    title={itemTitle(item.type)}
                    className="flex items-center gap-2 text-sm group rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-lighter"
                  >
                    <span className="text-gray-500 shrink-0">{typeIcon(item.type, 13)}</span>
                    <span className="text-gray-300 truncate flex-1 group-hover:text-cyber-300">{item.name}</span>
                    <span className="text-right shrink-0">
                      <span className={`block text-[10px] ${when.days <= 30 ? "text-amber-400" : "text-gray-600"}`}>
                        {when.label}
                      </span>
                      <span className="block text-[10px] text-gray-600 mt-0.5" title={formatDate(item.expiresAt)}>
                        {formatDateShort(item.expiresAt)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={MapPin}
          title="Locations"
          action={<Link to={`/clients/${org.id}`} className="text-xs text-cyber-400 hover:text-cyber-300">Edit Client</Link>}
        >
          <div className="flex items-start gap-2">
            <MapPin size={13} className="text-gray-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="text-gray-300">Main</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {[org.addressLine1, org.addressLine2, [org.city, org.state].filter(Boolean).join(", "), org.postalCode]
                  .filter(Boolean).join(" · ") || "No address on the client record."}
              </p>
              <div className="flex flex-wrap gap-x-3 mt-1.5 text-xs text-gray-500">
                {org.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{org.phone}</span>}
                {org.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{org.email}</span>}
                {org.website && (
                  <a href={org.website.startsWith("http") ? org.website : `https://${org.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-cyber-300">
                    <ExternalLink size={11} />{org.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── Activity feed ──────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">Activity Feed</h3>
          </div>
          <Link to="/admin/logs" className="text-xs text-cyber-400 hover:text-cyber-300">View All Activity Logs</Link>
        </div>
        {detail.activity.length === 0 ? (
          <p className="text-sm text-gray-500 mt-3">Start documenting to see your activity feed.</p>
        ) : (
          <div className="mt-3 divide-y divide-surface-border/50">
            {detail.activity.map((e) => (
              <Link
                key={`${e.type}-${e.id}-${e.at}`}
                to={itemLink(e.type, e.id, org.id)}
                title={itemTitle(e.type)}
                className="flex items-center gap-3 py-2 group hover:bg-surface-lighter rounded-lg px-1.5 -mx-1.5"
              >
                <span className="text-gray-500 shrink-0">{typeIcon(e.type, 14)}</span>
                <p className="text-sm text-gray-300 flex-1 truncate">
                  <span className="text-white group-hover:text-cyber-300">{e.name}</span>
                  <span className="text-gray-500"> — {e.type.toLowerCase()} {e.action}</span>
                  {e.by && <span className="text-gray-500"> by {e.by}</span>}
                </p>
                <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(e.at)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── Sub-organizations ─────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitBranch size={15} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">Sub-Organizations</h3>
            {detail.subOrganizations.length > 0 && <span className="text-xs text-gray-500">{detail.subOrganizations.length}</span>}
          </div>
          <button onClick={() => setShowAddSub(true)} className="text-xs text-cyber-400 hover:text-cyber-300">
            Add Sub-Organization
          </button>
        </div>
        {detail.subOrganizations.length === 0 ? (
          <p className="text-sm text-gray-500 mt-3">
            No sub-organizations. Use Add Sub-Organization for a branch or department that reports into {org.name}.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {detail.subOrganizations.map((child) => (
              <button
                key={child.id}
                onClick={() => navigate(`/kumo/organizations/${child.id}`)}
                className="flex items-center gap-2.5 p-2 rounded-lg border border-surface-border hover:bg-surface-lighter text-left"
              >
                <span className={`w-8 h-8 rounded-lg grid place-items-center text-xs font-semibold shrink-0 ${avatarColor(child.name)}`}>
                  {initials(child.name)}
                </span>
                <span className="min-w-0">
                  <span className="text-sm text-white truncate block">{child.name}</span>
                  <span className="text-[10px] text-gray-500 truncate block">
                    {[child.companyType, [child.city, child.state].filter(Boolean).join(", ")].filter(Boolean).join(" • ") || "—"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

          </div>
        </div>
      </div>

      {/* ── Add sub-organization ───────────────────────────────── */}
      {showAddSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddSub(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={createSubOrganization}>
            <h3 className="text-lg font-semibold text-white">Add Sub-Organization</h3>
            <p className="text-xs text-gray-500">Created as a client company that belongs to {org.name}.</p>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Name *</label>
              <input className="input-field" value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} required autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Type</label>
                <select className="input-field" value={subForm.companyType} onChange={(e) => setSubForm({ ...subForm, companyType: e.target.value })}>
                  <option>Client</option><option>Prospect</option><option>Vendor</option><option>Partner</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">City</label>
                <input className="input-field" value={subForm.city} onChange={(e) => setSubForm({ ...subForm, city: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button type="button" onClick={() => setShowAddSub(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" disabled={savingSub} className="btn-primary text-sm flex items-center gap-1">
                <Check size={13} /> {savingSub ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/** The client's single address, shown when the rail asks for Locations. */
function LocationsPanel({ org }: { org: Organization }) {
  const lines = [
    org.addressLine1,
    org.addressLine2,
    [org.city, org.state].filter(Boolean).join(", "),
    org.postalCode,
  ].filter(Boolean);

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin size={15} className="text-cyber-400" />
          <h3 className="text-sm font-semibold text-white">Locations</h3>
        </div>
        <Link to={`/clients/${org.id}`} className="text-xs text-cyber-400 hover:text-cyber-300">Edit Client</Link>
      </div>

      <div className="rounded-lg border border-surface-border p-3">
        <p className="text-sm text-white">Primary location</p>
        <p className="text-xs text-gray-500 mt-1">
          {lines.length > 0 ? lines.join(" · ") : "No address on the client record."}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
          {org.phone && <span className="inline-flex items-center gap-1.5"><Phone size={12} className="text-gray-500" />{org.phone}</span>}
          {org.email && <span className="inline-flex items-center gap-1.5"><Mail size={12} className="text-gray-500" />{org.email}</span>}
          {org.website && (
            <a
              href={org.website.startsWith("http") ? org.website : `https://${org.website}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-cyber-300"
            >
              <ExternalLink size={12} className="text-gray-500" />{org.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        This is the address held on the client record. Sites beyond it — separate networks, contacts and
        equipment per site — need a location model, which is not built yet.
      </p>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof History;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-cyber-400" />
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Proportional ring: the count sits in the middle, the arc shows its share. */
function HealthRing({ value, total, label, tone, to }: { value: number; total: number; label: string; tone: string; to: string }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  return (
    <Link
      to={to}
      title={`Show the ${label.toLowerCase()} items`}
      className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-surface-lighter transition-colors"
    >
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 44 44" className="w-14 h-14 -rotate-90">
          <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="4" className="stroke-surface-lighter" />
          <circle
            cx="22" cy="22" r={radius} fill="none" strokeWidth="4" strokeLinecap="round"
            className={tone}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-white">{value}</span>
      </div>
      <span className="text-[11px] text-gray-400 text-center leading-tight">{label}</span>
    </Link>
  );
}
