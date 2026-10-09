/**
 * Administration → API access.
 *
 * The other side of C7NC. C7NC is where this instance reads *from* other systems;
 * this page is where another system is given a credential to talk *to* this one — an API key — and
 * where the two settings that decide what happens to what it sends are kept.
 *
 * The design decision worth knowing before reading the code: a key is not a permission grant, it is a
 * narrowing of the account it belongs to. The API intersects the key's scopes with the owner's
 * *current* permissions on every request (see `apps/api/src/services/apiKeys.ts` and
 * `middleware/auth.ts`), so revoking a permission from the account revokes it from every key that
 * account owns — without touching the keys. That is why this page shows the owner and the scopes
 * side by side rather than treating a key as a thing with powers of its own.
 *
 * The same principle decides the rest of the page: the secret is displayed exactly once (creation and
 * rotation), the list never returns it or its hash, and revocation keeps the row, because the
 * inventory is a credential history rather than a list of live keys.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, X,
} from "lucide-react";
import api from "../api";
import { EmptyState, ListFooter, ListViews, PageHeader, Section, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import { Chip } from "./Configuration";

/** What `GET /api/api-keys` returns. Never the secret, never the hash. */
interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  sourceKind: string;
  description: string | null;
  permissions: string[];
  owner: { id: string; email: string };
  createdByEmail: string | null;
  requestCount: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  state: "active" | "revoked" | "expired";
}

/** The one response that carries the secret. */
interface IssuedKey {
  id: string;
  name: string;
  prefix: string;
  sourceKind: string;
  permissions: string[];
  expiresAt: string | null;
  key: string;
  warning?: string;
}

interface Board {
  id: string;
  name: string;
}

/**
 * Scope sets for the three integrations the API was built for. Chosen from the catalogue the API
 * returns rather than hard-coded, so a preset can never name a permission this instance does not
 * have — the API refuses to issue a key whose scopes do not exist, and a preset that offered one
 * would be a button that fails.
 */
const PRESETS: { key: string; label: string; why: string; scopes: string[] }[] = [
  {
    key: "rmm",
    label: "RMM / monitoring",
    why: "Raise a ticket per alert and read tickets back. Nothing else.",
    scopes: ["ticket:create", "ticket:view", "servicealert:view"],
  },
  {
    key: "siem",
    label: "SIEM / detection",
    why: "Report detections and read what it reported. Nothing else.",
    scopes: ["ticket:create", "ticket:view"],
  },
  {
    key: "accounting",
    label: "Accounting (FlexPoint / QuickBooks)",
    why: "Read clients and receivables, and push invoices back.",
    scopes: ["client:view", "billing:view", "integration:view", "integration:manage"],
  },
];

const SOURCE_LABELS: Record<string, string> = {
  rmm: "RMM",
  siem: "SIEM",
  flexpoint: "FlexPoint Payment Solutions",
  quickbooks: "QuickBooks",
  monitoring: "Monitoring",
  scheduler: "Scheduler",
  other: "Other",
};

const when = (iso: string | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return `today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
};

export function ApiAccessPage() {
  const redesign = useRedesign();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [keyView, setKeyView] = useState("all");
  const [loading, setLoading] = useState(true);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [denied, setDenied] = useState(false);

  const [catalogue, setCatalogue] = useState<{ permissions: string[]; sources: string[] }>({ permissions: [], sources: [] });
  const [boards, setBoards] = useState<Board[]>([]);
  const [intakeBoard, setIntakeBoard] = useState("");
  const [savingBoard, setSavingBoard] = useState(false);
  const [boardDenied, setBoardDenied] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ name: "", sourceKind: "rmm", description: "", expiresAt: "" });
  const [scopes, setScopes] = useState<string[]>([]);
  const [scopeFilter, setScopeFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<IssuedKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [rotating, setRotating] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const loadKeys = useCallback(async (withRevoked: boolean) => {
    try {
      const { data } = await api.get(`/api-keys${withRevoked ? "?includeRevoked=true" : ""}`);
      setKeys(data?.data ?? []);
      setDenied(false);
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status === 403) setDenied(true);
      else toast.error("Could not load the API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadKeys(includeRevoked); }, [loadKeys, includeRevoked]);

  useEffect(() => {
    // The catalogue decides what a key may be given, so it is read rather than assumed.
    api.get("/api-keys/permissions")
      .then((r) => setCatalogue({ permissions: r.data?.permissions ?? [], sources: r.data?.sources ?? [] }))
      .catch(() => { /* the form says so when the list is empty */ });

    api.get("/boards")
      .then((r) => setBoards(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => { /* board:view is not held; the intake card is hidden */ });

    api.get("/system/config/eventIntakeBoardId")
      .then((r) => {
        const value = r.data?.value;
        setIntakeBoard(typeof value === "string" ? value : (value?.boardId ?? ""));
      })
      .catch(() => setBoardDenied(true));
  }, []);

  const grouped = useMemo(() => {
    const wanted = scopeFilter.trim().toLowerCase();
    const byResource = new Map<string, string[]>();
    for (const permission of catalogue.permissions) {
      if (wanted && !permission.toLowerCase().includes(wanted)) continue;
      const resource = permission.split(":")[0]!;
      byResource.set(resource, [...(byResource.get(resource) ?? []), permission]);
    }
    return [...byResource.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalogue.permissions, scopeFilter]);

  const baseUrl = `${window.location.origin}/api`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy failed — select the text and copy it by hand");
    }
  };

  /** The preset, narrowed to scopes this instance actually has. */
  const presetScopes = (wanted: string[]) => wanted.filter((permission) => catalogue.permissions.includes(permission));

  const toggleScope = (permission: string) =>
    setScopes((current) => (current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission]));

  const create = async () => {
    if (!draft.name.trim()) { toast.error("Give the key a name — it is how you find it later"); return; }
    if (scopes.length === 0) { toast.error("Choose at least one scope"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/api-keys", {
        name: draft.name.trim(),
        sourceKind: draft.sourceKind,
        description: draft.description.trim() || undefined,
        permissions: scopes,
        expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      });
      setMinted(data as IssuedKey);
      setRevealed(true);
      setShowForm(false);
      setDraft({ name: "", sourceKind: "rmm", description: "", expiresAt: "" });
      setScopes([]);
      setScopeFilter("");
      await loadKeys(includeRevoked);
      toast.success("Key issued — copy it now, it is not shown again");
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: { message?: string } | string } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : message?.message ?? "Could not issue the key");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (key: ApiKeySummary) => {
    setRotating(key.id);
    try {
      const { data } = await api.post(`/api-keys/${key.id}/rotate`);
      setMinted(data as IssuedKey);
      setRevealed(true);
      await loadKeys(includeRevoked);
      toast.success("Rotated — the previous secret stopped working");
    } catch {
      toast.error("Could not rotate that key");
    } finally {
      setRotating(null);
    }
  };

  const revoke = async (key: ApiKeySummary) => {
    setBusy(true);
    try {
      await api.delete(`/api-keys/${key.id}`, { data: { reason: revokeReason.trim() || undefined } });
      setRevoking(null);
      setRevokeReason("");
      await loadKeys(includeRevoked);
      toast.success(`${key.name} revoked`);
    } catch {
      toast.error("Could not revoke that key");
    } finally {
      setBusy(false);
    }
  };

  const saveIntakeBoard = async () => {
    setSavingBoard(true);
    try {
      await api.patch("/system/config/eventIntakeBoardId", { value: intakeBoard || null });
      toast.success(intakeBoard ? "Events will be filed on that board" : "Events will use the oldest board");
    } catch {
      toast.error("Could not save the intake board");
    } finally {
      setSavingBoard(false);
    }
  };

  const activeKeyCount = keys.filter((key) => key.state === "active").length;
  const revokedKeyCount = keys.filter((key) => key.state === "revoked").length;
  const unusedKeyCount = keys.filter((key) => !key.lastUsedAt && key.state !== "revoked").length;
  const requestTotal = keys.reduce((total, key) => total + key.requestCount, 0);
  const shownKeys = keys.filter((key) => {
    if (keyView === "active") return key.state === "active";
    if (keyView === "revoked") return key.state === "revoked";
    if (keyView === "never") return !key.lastUsedAt && key.state !== "revoked";
    return true;
  });
  /**
   * Revoked rows only come back when the API is asked for them, so the strip drives the same switch
   * the checkbox drives rather than inventing a second request.
   */
  const selectKeyView = (id: string) => {
    setKeyView(id);
    setIncludeRevoked(id === "all" || id === "revoked");
  };

  const eventExample = (token: string) => `curl -s -X POST ${baseUrl}/events \\
  -H "authorization: Bearer ${token}" \\
  -H "content-type: application/json" \\
  -d '{
        "source": "rmm",
        "externalId": "alert-88213",
        "severity": "high",
        "title": "Disk space below 5% on DC01",
        "client": { "companyId": "<client id>" },
        "data": { "device": "DC01", "check": "disk.c", "freeGb": 3.1 }
      }'`;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title="API access"
        subtitle="Credentials and settings for the systems that talk to this instance: an RMM, a SIEM, a monitoring platform, an accounting integration or a script of your own."
        actions={
          <button className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => setShowForm((open) => !open)}>
            <Plus size={14} /> New API key
          </button>
        }
      />

      {/* ── The figures the page already holds ── */}
      {redesign ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Keys in the inventory" value={keys.length} icon={<KeyRound size={14} />} tone="cyber" />
          <StatCard label="Active" value={activeKeyCount} icon={<ShieldCheck size={14} />} tone="green" />
          <StatCard label="Revoked" value={revokedKeyCount} icon={<Trash2 size={14} />} tone="red" />
          <StatCard label="Requests recorded" value={requestTotal.toLocaleString()} icon={<RefreshCw size={14} />} tone="neutral" />
        </div>
      ) : null}

      {/* ── What the API is, and how to reach it ── */}
      <div className="card">
        <p className="text-sm text-gray-300 leading-relaxed">
          Every screen in C7NTAX is backed by the same REST API this page issues credentials for, so
          anything the application can do, a connected system can do with a key that is limited to it.
          For incidents the shortest path is the <span className="text-white">event gateway</span>: one
          endpoint that any RMM, SIEM or uptime monitor can POST an alert to, opening one ticket per
          condition and closing it when the recovery arrives.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 mt-4">
          <Fact label="Base URL" value={baseUrl} onCopy={() => void copy(baseUrl, "Base URL")} />
          <Fact label="Authentication" value="Authorization: Bearer <key>" onCopy={() => void copy("Authorization: Bearer ", "Header")} />
          <Fact label="Report an incident" value={`POST ${baseUrl}/events`} onCopy={() => void copy(`POST ${baseUrl}/events`, "Endpoint")} />
        </div>
        <p className="text-xs text-gray-500 mt-4 leading-relaxed">
          The full reference is <span className="text-gray-300 font-mono">docs/API.md</span> in the
          repository, with the generated specification beside it at{" "}
          <span className="text-gray-300 font-mono">docs/openapi.yaml</span>. The in-app walkthrough is
          under Help → Walkthroughs → API access.
        </p>
      </div>

      {/* ── The one setting the gateway needs ── */}
      {!boardDenied ? (
        <Section title="Event intake">
          <div className="card space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <Label htmlFor="intake-board">Board for events that name no board</Label>
                <select
                  id="intake-board"
                  className="input-field"
                  value={intakeBoard}
                  onChange={(e) => setIntakeBoard(e.target.value)}
                >
                  <option value="">Oldest board in the instance</option>
                  {boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                </select>
                <Hint>
                  Where an alert from a monitoring system lands when the sender does not name a board
                  itself. Events that carry a <span className="text-gray-300 font-mono">boardId</span>{" "}
                  always win over this.
                </Hint>
              </div>
              <button className="btn-secondary text-sm" onClick={() => void saveIntakeBoard()} disabled={savingBoard}>
                {savingBoard ? "Saving…" : "Save"}
              </button>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Repeat events are not new tickets. The gateway keys on the sender's own id for a
              condition, so an alert polled every minute keeps adding to one ticket and a{" "}
              <span className="text-gray-300 font-mono">kind: "recovery"</span> closes it.
            </p>
          </div>
        </Section>
      ) : null}

      {/* ── The secret, shown exactly once ── */}
      {minted ? (
        <div className="card border-cyber-600/40">
          <div className="flex items-start gap-3">
            <KeyRound size={16} className="text-cyber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-white">Key for {minted.name}</h3>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                {minted.warning ?? "This is the only time the key is shown."} Only a hash is stored, so
                it cannot be recovered afterwards — if it is lost, rotate it.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <code className="flex-1 min-w-0 truncate rounded-md border border-surface-border bg-surface-light px-3 py-2 text-xs text-gray-200 font-mono">
                  {revealed ? minted.key : `${minted.prefix}.${"•".repeat(24)}`}
                </code>
                <button
                  className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5"
                  onClick={() => setRevealed((shown) => !shown)}
                >
                  {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                  {revealed ? "Hide" : "Show"}
                </button>
                <button
                  className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5"
                  onClick={() => void copy(minted.key, "Key")}
                >
                  <Copy size={13} /> Copy
                </button>
              </div>
              <pre className="mt-3 rounded-md border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300 overflow-x-auto">
                {eventExample(minted.key)}
              </pre>
              <button
                className="btn-secondary text-xs mt-2 inline-flex items-center gap-1.5"
                onClick={() => void copy(eventExample(minted.key), "Example request")}
              >
                <Copy size={13} /> Copy the example
              </button>
            </div>
            <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={() => setMinted(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Issue ── */}
      {showForm && !denied ? (
        <Section title="New API key">
          <div className="card space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="key-name">Name</Label>
                <input
                  id="key-name"
                  className="input-field"
                  placeholder="RMM — Acme tenant"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                <Hint>How the key is listed here. Name it after the system *and* the tenant it serves.</Hint>
              </div>
              <div>
                <Label htmlFor="key-source">Source kind</Label>
                <select
                  id="key-source"
                  className="input-field"
                  value={draft.sourceKind}
                  onChange={(e) => setDraft({ ...draft, sourceKind: e.target.value })}
                >
                  {(catalogue.sources.length ? catalogue.sources : ["other"]).map((source) => (
                    <option key={source} value={source}>{SOURCE_LABELS[source] ?? source}</option>
                  ))}
                </select>
                <Hint>A label for the inventory and the audit trail. It does not restrict the key.</Hint>
              </div>
            </div>

            <div>
              <Label htmlFor="key-scopes">Scopes</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESETS.map((preset) => {
                  const available = presetScopes(preset.scopes);
                  return (
                    <button
                      key={preset.key}
                      className="btn-secondary text-xs"
                      title={preset.why}
                      disabled={available.length === 0}
                      onClick={() => setScopes(available)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <button className="btn-secondary text-xs" onClick={() => setScopes([])} disabled={scopes.length === 0}>
                  Clear
                </button>
              </div>
              <input
                className="input-field mb-2"
                placeholder="Filter permissions…"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value)}
              />
              <div className="rounded-md border border-surface-border max-h-64 overflow-y-auto divide-y divide-surface-border">
                {grouped.length === 0 ? (
                  <p className="text-xs text-gray-500 p-3">
                    {catalogue.permissions.length === 0
                      ? "The permission catalogue could not be read — reload the page and try again."
                      : "No permission matches that filter."}
                  </p>
                ) : grouped.map(([resource, permissions]) => (
                  <div key={resource} className="p-2">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 px-1 pb-1">{resource}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {permissions.map((permission) => (
                        <button
                          key={permission}
                          className={scopes.includes(permission)
                            ? "text-[11px] font-mono rounded border border-cyber-500 bg-cyber-500 px-2 py-1 text-white"
                            : "text-[11px] font-mono rounded border border-surface-border px-2 py-1 text-gray-400 hover:text-gray-200"}
                          onClick={() => toggleScope(permission)}
                        >
                          {permission}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Hint>
                {scopes.length === 0
                  ? "A key with no scopes can do nothing, so at least one is required."
                  : `${scopes.length} scope${scopes.length === 1 ? "" : "s"} selected — the key can never do more than its owner, and the owner's permissions are re-read on every request.`}
              </Hint>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="key-expiry">Expires</Label>
                <input
                  id="key-expiry"
                  type="date"
                  className="input-field"
                  value={draft.expiresAt}
                  onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })}
                />
                <Hint>Optional. An unattended integration is the one that should have an expiry date.</Hint>
              </div>
              <div>
                <Label htmlFor="key-description">Description</Label>
                <input
                  id="key-description"
                  className="input-field"
                  placeholder="Raises alerts from the RMM poller"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
                <Hint>What will use it, for whoever reads the inventory in six months.</Hint>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button className="btn-primary text-sm" onClick={() => void create()} disabled={busy}>
                {busy ? "Issuing…" : "Issue key"}
              </button>
              <button className="btn-secondary text-sm" onClick={() => setShowForm(false)}>Cancel</button>
              <span className="text-xs text-gray-500">The secret is shown once, right after this.</span>
            </div>
          </div>
        </Section>
      ) : null}

      {/* ── The inventory ── */}
      {redesign && !loading && !denied && keys.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews
            views={[
              { id: "all", label: "All", count: keys.length },
              { id: "active", label: "Active", count: activeKeyCount },
              { id: "revoked", label: "Revoked", count: revokedKeyCount },
              { id: "never", label: "Never used", count: unusedKeyCount },
            ]}
            value={keyView}
            onChange={selectKeyView}
            label="Key views"
          />
          <span className="text-xs text-gray-500">
            {shownKeys.length} key{shownKeys.length === 1 ? "" : "s"} shown · {activeKeyCount} active ·{" "}
            {revokedKeyCount} revoked · {unusedKeyCount} never used
          </span>
        </div>
      ) : null}

      <Section
        title={`Keys${keys.length ? ` (${keys.length})` : ""}`}
        actions={
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={includeRevoked} onChange={(e) => setIncludeRevoked(e.target.checked)} />
            Include revoked
          </label>
        }
      >
        {loading ? (
          <div className="card"><p className="text-sm text-gray-500">Loading…</p></div>
        ) : denied ? (
          <div className="card">
            <EmptyState
              icon={<ShieldCheck size={28} />}
              title="API keys are managed with user:manage"
              description="Issuing a key can hand an outsider the ability to create tickets or read billing, so it is gated on the same permission as creating a user. Ask an administrator to issue one for you."
            />
          </div>
        ) : keys.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<KeyRound size={28} />}
              title="No API keys"
              description="Nothing connects to this instance with a key yet. Issue one above to let an RMM, a SIEM or a script in."
              action={
                <button className="btn-primary text-sm" onClick={() => setShowForm(true)}>
                  <Plus size={14} className="inline mr-1.5" />New API key
                </button>
              }
            />
          </div>
        ) : (
          <div className="card !p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 font-medium">Key</th>
                    <th className="px-4 py-3 font-medium">Scopes</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Last used</th>
                    <th className="px-4 py-3 font-medium">State</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(redesign ? shownKeys : keys).map((key) => (
                    <tr key={key.id} className="border-b border-surface-border last:border-0 align-top">
                      <td className="px-4 py-3">
                        <p className="text-gray-200">{key.name}</p>
                        <p className="text-[11px] text-gray-500 font-mono mt-0.5">{key.prefix}…</p>
                        {key.description ? <p className="text-[11px] text-gray-500 mt-1">{key.description}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className={`text-xs text-gray-400${redesign ? " tabular-nums" : ""}`}>{key.permissions.length} scope{key.permissions.length === 1 ? "" : "s"}</p>
                        <p className="text-[11px] text-gray-500 font-mono mt-0.5 break-words max-w-[240px]">
                          {key.permissions.join(", ")}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        <p>{key.owner.email}</p>
                        {key.createdByEmail && key.createdByEmail !== key.owner.email
                          ? <p className="text-[11px] text-gray-500 mt-0.5">issued by {key.createdByEmail}</p>
                          : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        <p className={redesign ? "tabular-nums" : undefined}>{when(key.lastUsedAt)}</p>
                        <p className={`text-[11px] text-gray-500 mt-0.5${redesign ? " tabular-nums" : ""}`}>
                          {key.requestCount.toLocaleString()} request{key.requestCount === 1 ? "" : "s"}
                          {key.lastUsedIp ? ` · ${key.lastUsedIp}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {redesign ? (
                          <span className={`chip ${key.state === "active" ? "chip--good" : key.state === "expired" ? "chip--warn" : "chip--bad"}`}>
                            {key.state}
                          </span>
                        ) : (
                          <Chip tone={key.state === "active" ? "good" : key.state === "expired" ? "warn" : "muted"}>
                            {key.state}
                          </Chip>
                        )}
                        <p className="text-[11px] text-gray-500 mt-1">
                          {key.state === "revoked"
                            ? `revoked ${when(key.revokedAt)}`
                            : key.expiresAt ? `expires ${new Date(key.expiresAt).toLocaleDateString()}` : "no expiry"}
                        </p>
                        <p className="text-[11px] text-gray-600 mt-0.5">added {when(key.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {key.state === "revoked" ? (
                          <span className="text-[11px] text-gray-600">—</span>
                        ) : revoking === key.id ? (
                          <div className="inline-flex flex-col items-end gap-2">
                            <input
                              className="input-field text-xs w-56"
                              placeholder="Reason (optional, goes to the audit log)"
                              value={revokeReason}
                              onChange={(e) => setRevokeReason(e.target.value)}
                            />
                            <div className="flex items-center gap-2">
                              <button
                                className="text-xs rounded border border-rose-500 px-2 py-1 text-rose-300 inline-flex items-center gap-1"
                                onClick={() => void revoke(key)}
                                disabled={busy}
                              >
                                <AlertTriangle size={12} /> Revoke now
                              </button>
                              <button className="btn-secondary text-xs" onClick={() => { setRevoking(null); setRevokeReason(""); }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              className="btn-secondary text-xs inline-flex items-center gap-1.5"
                              onClick={() => void rotate(key)}
                              disabled={rotating === key.id}
                              title="Issue a new secret and invalidate the old one"
                            >
                              {rotating === key.id ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Rotate
                            </button>
                            <button
                              className="btn-secondary text-xs inline-flex items-center gap-1.5"
                              onClick={() => setRevoking(key.id)}
                              title="Stop this key working. The record is kept."
                            >
                              <Trash2 size={12} /> Revoke
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {redesign && shownKeys.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                        Nothing in this view.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {redesign && shownKeys.length > 0 ? (
              <ListFooter
                from={1}
                to={shownKeys.length}
                total={shownKeys.length}
                page={1}
                pages={1}
                onPage={() => {}}
                note={`${keys.length} key${keys.length === 1 ? "" : "s"} in the inventory`}
              />
            ) : null}
          </div>
        )}
      </Section>

      <div className="card">
        <p className="text-xs text-gray-500 leading-relaxed">
          Revoking a key stops it immediately; the row is kept so the inventory stays a record of what
          was ever issued. Rotating issues a new secret and invalidates the old one, which is the answer
          to a leaked key. Every issuance, rotation and revocation is written to{" "}
          <span className="text-gray-300">Administration → Audit Logs</span>.
        </p>
      </div>
    </div>
  );
}

/** A labelled, copyable fact about the API — the three things a connection needs. */
function Fact({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="rounded-md border border-surface-border bg-surface-light p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        <code className="flex-1 min-w-0 truncate text-xs text-gray-200 font-mono">{value}</code>
        <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={onCopy} aria-label={`Copy ${label}`}>
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{children}</p>;
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 mb-1.5">{children}</label>;
}
