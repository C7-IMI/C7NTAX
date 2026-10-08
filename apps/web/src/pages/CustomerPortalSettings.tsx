/**
 * Administration → Customer Portal.
 *
 * The portal section of the configuration registry, plus the two things about a customer portal
 * that are not a single value:
 *
 *   · **who may use it** — per client, because access is a fact about a client and not about the
 *     deployment, and because Autotask, ConnectWise and Scoro all put it on the client record;
 *   · **who has used it** — the recent sign-in sessions, so "is anyone actually using this?" is
 *     answerable without reading the database.
 *
 * The branding controls are shown against a preview, because the only way to judge a colour and
 * a logo together is to look at them together.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Copy, ExternalLink, Eye, Globe, Search, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import api from "../api";
import { DEFAULT_ACCENT_COLOUR, HEX_COLOUR_PATTERN, ON_ACCENT_COLOUR } from "../lib/colourTokens";
import { PageHeader } from "../components/ui";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PortalAccessDialog } from "../components/PortalAccessDialog";
import { PortalPreviewDialog } from "../components/PortalPreviewDialog";
import {
  Chip,
  FieldCard,
  RequirementBanner,
  useConfigurationSection,
  type RenderedField,
} from "./Configuration";

interface PortalClient {
  id: string;
  name: string;
  portalEnabled: boolean;
  accentColor: string | null;
  logoUrl: string | null;
  contacts: number;
  eligibleContacts: number;
  tickets: number;
  overrides: {
    visibility: "contact" | "company" | null;
    allowTicketCreation: boolean | null;
    allowReplies: boolean | null;
    boardId: string | null;
  };
  policy: {
    visibility: "contact" | "company";
    allowTicketCreation: boolean;
    allowReplies: boolean;
    boardId: string | null;
    boardName: string | null;
    sources: { visibility: PolicySource; allowTicketCreation: PolicySource; allowReplies: PolicySource; boardId: PolicySource };
  };
}

type PolicySource = "contact" | "client" | "instance" | "default";

interface PortalInstancePolicy {
  visibility: "contact" | "company";
  allowTicketCreation: boolean;
  allowReplies: boolean;
  boardId: string | null;
  boardName: string | null;
  sources: { visibility: PolicySource; allowTicketCreation: PolicySource; allowReplies: PolicySource; boardId: PolicySource };
}

interface PortalSessionRow {
  id: string;
  contactName: string;
  contactEmail: string;
  clientName: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
  ipAddress: string | null;
  active: boolean;
}

interface PortalOverview {
  enabled: boolean;
  /** Where a customer is told to go: the deployment's own web origin, not the admin's. */
  portalUrl: string;
  board: { id: string; name: string } | null;
  boards: Array<{ id: string; name: string }>;
  instancePolicy: PortalInstancePolicy;
  signIns: number;
  canEdit: boolean;
  clients: PortalClient[];
  sessions: PortalSessionRow[];
}

const visibilityLabel = (value: "contact" | "company") =>
  value === "company" ? "Every ticket at the client" : "Only their own tickets";

/** The portal as a customer sees it, at the size a provider can judge it at. */
function PortalPreview({ name, accent, logo, welcome, support }: {
  name: string; accent: string; logo: string; welcome: string; support: string;
}) {
  const colour = HEX_COLOUR_PATTERN.test(accent) ? accent : DEFAULT_ACCENT_COLOUR;
  return (
    <div className="rounded-xl border border-surface-border overflow-hidden bg-navy-950">      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-border">
        {logo
          ? <img src={logo} alt="" className="h-8 w-8 rounded object-contain bg-navy-900" />
          : (
            <div className="h-8 w-8 rounded flex items-center justify-center" style={{ backgroundColor: `${colour}22` }}>
              <Globe size={16} style={{ color: colour }} />
            </div>
          )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{name || "Customer portal"}</p>
          <p className="text-[11px] text-gray-500 truncate">{welcome || "Sign in to raise and follow your tickets"}</p>
        </div>
      </div>
      <div className="px-4 py-4 space-y-2.5">
        <div className="h-2.5 w-24 rounded" style={{ backgroundColor: `${colour}66` }} />
        <div className="rounded-lg border border-surface-border bg-surface px-3 py-2.5">
          <p className="text-xs text-white">Printer in the front office will not print</p>
          <p className="text-[11px] text-gray-500 mt-0.5">SR-1042 · In Progress</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded font-medium" style={{ backgroundColor: colour, color: ON_ACCENT_COLOUR }}>
            Raise a ticket
          </span>
          <span className="text-[11px] text-gray-500">{support || "support@example.com"}</span>
        </div>
      </div>
    </div>
  );
}

export function CustomerPortalSettingsPage() {
  const { section, sections, loaded, loading, error, save, clear } = useConfigurationSection("portal");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [savingClient, setSavingClient] = useState<string | null>(null);
  const [accessClient, setAccessClient] = useState<PortalClient | null>(null);
  const [previewClient, setPreviewClient] = useState<string | null>(null);

  const loadOverview = useCallback(async (): Promise<PortalOverview | null> => {
    try {
      const res = await api.get("/configuration/portal/overview");
      setOverview(res.data);
      return res.data as PortalOverview;
    } catch {
      setOverview(null);
      return null;
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  /**
   * The dialog holds the client it was opened with, so after a change it has to be handed the fresh
   * row — otherwise the screen keeps reporting where the *old* answer came from while the policy
   * behind it has already moved.
   */
  const reloadAccessClient = useCallback(async () => {
    const fresh = await loadOverview();
    if (!fresh) return;
    setAccessClient(prev => (prev ? fresh.clients.find(c => c.id === prev.id) ?? prev : prev));
  }, [loadOverview]);

  /** The address a customer is given, so it can be dropped into a welcome mail or a document. */
  const copyPortalUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Portal address copied");
    } catch {
      toast.error("Copy failed — select the address and copy it by hand");
    }
  }, []);

  const saveField = useCallback(async (field: RenderedField, value: boolean | number | string) => {
    setBusy(true);
    try {
      const ok = await save(field, value);
      // The portal switch changes what the overview reports, so keep the two in step.
      if (ok) await loadOverview();
      return ok;
    } finally { setBusy(false); }
  }, [save, loadOverview]);

  const clearField = useCallback(async (field: RenderedField) => {
    setBusy(true);
    try {
      const ok = await clear(field);
      if (ok) await loadOverview();
      return ok;
    } finally { setBusy(false); }
  }, [clear, loadOverview]);

  const patchClient = useCallback(async (client: PortalClient, body: Record<string, unknown>) => {
    setSavingClient(client.id);
    try {
      await api.patch(`/configuration/portal/clients/${client.id}`, body);
      await loadOverview();
      toast.success(`${client.name} updated`);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : (message?.message || "That change was refused"));
    } finally { setSavingClient(null); }
  }, [loadOverview]);

  const field = (id: string) => section?.fields.find(f => f.id === id)?.value;

  const clients = (overview?.clients ?? []).filter(c =>
    !filter.trim() || c.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const withAccess = (overview?.clients ?? []).filter(c => c.portalEnabled).length;
  const eligibleTotal = (overview?.clients ?? []).reduce((n, c) => n + c.eligibleContacts, 0);

  if (loading) return <div className="space-y-6 animate-fade-in max-w-6xl"><TableSkeleton /></div>;
  if (!section) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader title="Customer Portal" subtitle={error || "Your role cannot read this area."} />
        <Link to="/admin/configuration" className="btn-secondary text-sm">Back to Configuration</Link>
      </div>
    );
  }

  const changeable = section.fields.filter(f => f.editable && !f.locked);
  const deployment = section.fields.filter(f => !f.editable || f.locked);
  // The portal's title is the workspace's trading name: a customer should see who is asking,
  // and a client name is shown inside the portal rather than above it.
  const workspaceName = sections
    .find(s => s.id === "workspace")
    ?.fields.find(f => f.id === "companyName")?.value;
  const preview = {
    name: String(workspaceName ?? "Customer portal"),
    accent: String(field("accentColor") ?? ""),
    logo: String(field("logoUrl") ?? ""),
    welcome: String(field("welcomeText") ?? ""),
    support: String(field("supportEmail") ?? ""),
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <PageHeader
        title="Customer Portal"
        subtitle="Whether customers have a portal, what it lets them do, and how it looks."
        actions={<Link to="/admin/configuration" className="btn-secondary text-sm">All areas</Link>}
      />

      {!loaded && (
        <div className="card border-amber-500/30 text-sm text-amber-200">
          The saved settings have not been read yet, so these are the deployment's own values.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card flex items-start gap-3">
          <div className={`p-2 rounded-lg ${overview?.enabled ? "bg-emerald-500/10" : "bg-surface-lighter"}`}>
            <Globe size={17} className={overview?.enabled ? "text-emerald-400" : "text-gray-500"} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Portal</p>
            <p className="text-sm font-medium text-white">{overview?.enabled ? "Live" : "Off"}</p>
            {/* The address customers are given: the deployment's own web origin, so it is the same
                link on any machine, and the button beside it copies it for a mail or a document. */}
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              {overview?.enabled ? (
                <a
                  href={overview.portalUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the customer portal"
                  className="text-xs text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1 min-w-0"
                >
                  <span className="truncate">{overview.portalUrl}</span>
                  <ExternalLink size={11} className="shrink-0" />
                </a>
              ) : (
                <span className="text-xs text-gray-500 truncate" title={overview?.portalUrl ?? ""}>
                  {overview?.portalUrl ?? "/portal"}
                </span>
              )}
              {overview?.portalUrl && (
                <button
                  type="button"
                  onClick={() => void copyPortalUrl(overview.portalUrl)}
                  aria-label="Copy the portal address"
                  title="Copy the portal address"
                  className="text-gray-500 hover:text-gray-300 shrink-0"
                >
                  <Copy size={11} />
                </button>
              )}
            </div>
            {!overview?.enabled && (
              <p className="text-[11px] text-gray-600 mt-0.5">Every portal route answers 404 until it is switched on.</p>
            )}
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyber-600/10"><Users size={17} className="text-cyber-400" /></div>
          <div>
            <p className="text-xs text-gray-500">Clients with access</p>
            <p className="text-sm font-medium text-white">{withAccess} of {overview?.clients.length ?? 0}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyber-600/10"><ShieldCheck size={17} className="text-cyber-400" /></div>
          <div>
            <p className="text-xs text-gray-500">Contacts who could sign in</p>
            <p className="text-sm font-medium text-white">{eligibleTotal}</p>
          </div>
        </div>
      </div>

      {section.requirements.map(requirement => (
        <RequirementBanner key={requirement.label} requirement={requirement} />
      ))}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6 min-w-0">
          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-4">Portal settings</h3>
            {changeable.map(f => (
              <FieldCard key={f.id} field={f} onSave={saveField} onClear={clearField} busy={busy} />
            ))}
          </div>

          {deployment.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-white mb-4">Set by the deployment</h3>
              {deployment.map(f => (
                <FieldCard key={f.id} field={f} onSave={saveField} onClear={clearField} busy={busy} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-semibold text-white mb-3">Preview</h3>
            <PortalPreview {...preview} />
            <p className="text-[11px] text-gray-500 mt-3">
              A client with its own colour or logo overrides these. Set those per client below.
            </p>
          </div>
          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-white">Where tickets land</h3>
            <p className="text-sm text-white">{overview?.board?.name ?? "No active board"}</p>
            <p className="text-[11px] text-gray-500">
              Tickets raised in the portal are created by the portal's own system user, so they never
              appear to come from a member of staff.
            </p>
          </div>
          <div className="card space-y-1.5">
            <h3 className="text-sm font-semibold text-white">Sign-ins completed</h3>
            <p className="text-lg font-semibold text-white">{overview?.signIns ?? 0}</p>
            <p className="text-[11px] text-gray-500">
              Codes that were verified. A requested code that was never used is not counted.
            </p>
          </div>
        </div>
      </div>

      {/* ── Per-client access ── */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Client access</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Only an active contact of a client switched on here can request a sign-in code.
            </p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-8 max-w-[16rem]"
              placeholder="Filter clients"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
        </div>

        {overviewLoading ? <TableSkeleton /> : clients.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No clients match that filter.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[62rem]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-surface-border">
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 font-medium">Portal access</th>
                  <th className="py-2 font-medium">What they see</th>
                  <th className="py-2 font-medium">Contacts</th>
                  <th className="py-2 font-medium">Accent</th>
                  <th className="py-2 font-medium">Logo</th>
                  <th className="py-2 font-medium">Tickets</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {clients.map(client => (
                  <tr key={client.id} className="border-b border-surface-border/60 last:border-b-0">
                    <td className="py-2.5 pr-3">
                      <Link to={`/clients/${client.id}`} className="text-white hover:text-cyber-300">{client.name}</Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={client.portalEnabled}
                          disabled={!overview?.canEdit || savingClient === client.id}
                          onChange={e => void patchClient(client, { portalEnabled: e.target.checked })}
                        />
                        <span className={client.portalEnabled ? "text-emerald-300 text-xs" : "text-gray-500 text-xs"}>
                          {client.portalEnabled ? "Enabled" : "Off"}
                        </span>
                      </label>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="space-y-1">
                        <p className="text-xs text-gray-300">{visibilityLabel(client.policy.visibility)}</p>
                        <div className="flex flex-wrap items-center gap-1">
                          {!client.policy.allowTicketCreation && <Chip tone="warn">no new tickets</Chip>}
                          {!client.policy.allowReplies && <Chip tone="warn">no replies</Chip>}
                          {client.policy.sources.visibility === "client" && <Chip tone="info">set for this client</Chip>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-400 text-xs">
                      {client.eligibleContacts} of {client.contacts} usable
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="color"
                        aria-label={`${client.name} accent`}
                        className="h-7 w-10 rounded border border-surface-border bg-surface disabled:opacity-40"
                        value={client.accentColor ?? DEFAULT_ACCENT_COLOUR}
                        disabled={!overview?.canEdit || savingClient === client.id}
                        onChange={e => void patchClient(client, { accentColor: e.target.value })}
                      />
                      {client.accentColor && (
                        <button
                          type="button"
                          className="block text-[11px] text-gray-500 hover:text-gray-300 mt-0.5"
                          disabled={!overview?.canEdit}
                          onClick={() => void patchClient(client, { accentColor: "" })}
                        >
                          use default
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        className="input-field text-xs max-w-[14rem]"
                        aria-label={`${client.name} logo`}
                        placeholder="uses the default"
                        defaultValue={client.logoUrl ?? ""}
                        disabled={!overview?.canEdit || savingClient === client.id}
                        onBlur={e => {
                          const next = e.target.value.trim();
                          if (next !== (client.logoUrl ?? "")) void patchClient(client, { logoUrl: next });
                        }}
                      />
                    </td>
                    <td className="py-2.5 text-gray-400 text-xs">{client.tickets}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
                          onClick={() => setPreviewClient(client.id)}
                        >
                          <Eye size={12} /> Preview
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
                          onClick={() => setAccessClient(client)}
                        >
                          <SlidersHorizontal size={12} /> Portal access
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent activity ── */}
      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-1">Recent portal sessions</h3>
        <p className="text-xs text-gray-400 mb-4">The last 25 customer sessions, newest first.</p>
        {overviewLoading ? <TableSkeleton /> : (overview?.sessions.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">Nobody has signed in to the portal yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[46rem]">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-surface-border">
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 font-medium">Started</th>
                  <th className="py-2 font-medium">Last active</th>
                  <th className="py-2 font-medium">Address</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.sessions ?? []).map(row => (
                  <tr key={row.id} className="border-b border-surface-border/60 last:border-b-0">
                    <td className="py-2.5 pr-3">
                      <p className="text-white text-xs">{row.contactName || row.contactEmail}</p>
                      <p className="text-[11px] text-gray-500">{row.contactEmail}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-400 text-xs">{row.clientName ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-gray-400 text-xs">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-2.5 pr-3 text-gray-400 text-xs">{new Date(row.lastActivityAt).toLocaleString()}</td>
                    <td className="py-2.5 pr-3 text-gray-500 text-xs font-mono">{row.ipAddress ?? "—"}</td>
                    <td className="py-2.5">
                      {row.active
                        ? <Chip tone="good">signed in</Chip>
                        : row.invalidatedAt
                          ? <Chip>signed out</Chip>
                          : <Chip tone="warn">expired</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Changes are saved as soon as a control is released. Branding takes effect on the portal's next
        page load; sign-in limits apply from the next code that is issued.
      </p>

      {accessClient && overview && (
        <PortalAccessDialog
          client={accessClient}
          boards={overview.boards}
          instancePolicy={overview.instancePolicy}
          canEdit={overview.canEdit}
          onPreview={() => setPreviewClient(accessClient.id)}
          onClose={() => setAccessClient(null)}
          onSaved={reloadAccessClient}
        />
      )}

      {previewClient && (
        <PortalPreviewDialog clientId={previewClient} onClose={() => setPreviewClient(null)} />
      )}
    </div>
  );
}
