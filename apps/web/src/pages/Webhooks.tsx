import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, KeyRound, Pencil, Send, ShieldCheck, Trash2, X } from "lucide-react";
import api from "../api";
import { EmptyState, ListFooter, ListViews, PageHeader, Section, StatCard } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { Chip } from "./Configuration";

interface Hook {
  id: string;
  name: string;
  url: string;
  events: string[];
  retryCount: number;
  isActive: boolean;
  createdAt: string;
}

interface EventOption {
  event: string;
  label: string;
  description: string;
}

interface Delivery {
  id: string;
  webhookId: string;
  event: string;
  payload: string;
  status: string;
  attempts: number;
  createdAt: string;
}

interface TestOutcome {
  status: "delivered" | "failed";
  attempts: number;
  detail: string;
}

/** Header names are part of the wire contract, so the page shows them rather than describing them. */
const EVENT_HEADER = "X-C7-Event";
const DELIVERY_HEADER = "X-C7-Delivery";
const SIGNATURE_HEADER = "X-C7-Signature";

const SAMPLE_BODY = `{
  "event": "service_alert.raised",
  "sentAt": "2026-10-07T21:12:44.108Z",
  "data": {
    "service": { "id": "…", "name": "Microsoft 365", "category": "cloud" },
    "alert": {
      "id": "…",
      "title": "Possible outage reported for Microsoft 365",
      "severity": "outage",
      "status": "active",
      "source": "statuspage",
      "sourceUrl": "https://status.cloud.microsoft",
      "detectedAt": "2026-10-07T21:12:44.000Z",
      "resolvedAt": null
    }
  }
}`;

const SAMPLE_VERIFY = `// Express — recompute the signature over the raw body before trusting it.
app.post("/c7ntax/alerts", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.C7NTAX_WEBHOOK_SECRET)
    .update(req.body)                      // the bytes as sent, not a re-serialised object
    .digest("hex");
  if (req.header("X-C7-Signature") !== expected) return res.sendStatus(401);
  const { event, data } = JSON.parse(req.body.toString());
  res.sendStatus(204);                     // 2xx is what marks the delivery as delivered
});`;

const STATUS_TONE: Record<string, "good" | "warn" | "info" | "muted"> = {
  delivered: "good",
  failed: "warn",
  pending: "info",
};

function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

/** The field-help line every input on this page has, so no field has to be guessed at. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500 mt-1 leading-relaxed">{children}</p>;
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-300 mb-1">
      {children}
    </label>
  );
}

/** The event picker used by both the register form and the inline editor. */
function EventPicker({ options, selected, onToggle }: {
  options: EventOption[];
  selected: string[];
  onToggle: (event: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label
          key={option.event}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
            selected.includes(option.event)
              ? "border-cyber-600/60 bg-cyber-600/5"
              : "border-surface-border bg-surface-light hover:border-surface-border"
          }`}
        >
          <input
            type="checkbox"
            checked={selected.includes(option.event)}
            onChange={() => onToggle(option.event)}
            className="mt-0.5 accent-cyber-500"
          />
          <span className="min-w-0">
            <span className="text-sm text-white">{option.label}</span>
            <code className="ml-2 text-[11px] text-gray-500">{option.event}</code>
            <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function WebhooksPage() {
  const modern = useModernInterface();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [hookView, setHookView] = useState("all");
  const [deliveryView, setDeliveryView] = useState("all");
  const [options, setOptions] = useState<EventOption[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [retries, setRetries] = useState("3");
  const [selected, setSelected] = useState<string[]>([]);
  const [preselected, setPreselected] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [minted, setMinted] = useState<{ id: string; name: string; secret: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, TestOutcome>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; url: string; retries: string; events: string[] }>({ name: "", url: "", retries: "3", events: [] });
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [list, log] = await Promise.all([
        api.get("/alert-webhooks"),
        api.get("/alert-webhooks/deliveries"),
      ]);
      setHooks(list.data?.data || []);
      setOptions(list.data?.events || []);
      setDeliveries(log.data?.data || []);
    } catch {
      if (!quiet) toast.error("Could not load the webhook endpoints");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Everything is subscribed to start with: an endpoint that receives nothing looks broken.
  useEffect(() => {
    if (!preselected && options.length) {
      setSelected(options.map((o) => o.event));
      setPreselected(true);
    }
  }, [options, preselected]);

  const toggle = (list: string[], event: string) =>
    list.includes(event) ? list.filter((e) => e !== event) : [...list, event];

  const create = async () => {
    setFormError(null);
    if (!url.trim()) { setFormError("An endpoint URL is required."); return; }
    if (selected.length === 0) { setFormError("Choose at least one event — otherwise the endpoint never hears anything."); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/alert-webhooks", {
        name: name.trim() || undefined,
        url: url.trim(),
        events: selected,
        retryCount: Number(retries) || 3,
      });
      setMinted({ id: data.id, name: data.name, secret: data.secret });
      setName(""); setUrl(""); setRetries("3");
      setSelected(options.map((o) => o.event));
      toast.success("Endpoint registered");
      void load(true);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: string | { message?: string } } } })?.response?.data?.error;
      setFormError(typeof message === "string" ? message : message?.message || "The endpoint could not be registered.");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (id: string) => {
    if (!draft.url.trim()) { toast.error("The endpoint URL cannot be empty"); return; }
    if (draft.events.length === 0) { toast.error("Choose at least one event"); return; }
    setBusy(true);
    try {
      await api.patch(`/alert-webhooks/${id}`, {
        name: draft.name.trim(),
        url: draft.url.trim(),
        events: draft.events,
        retryCount: Number(draft.retries) || 3,
      });
      setEditing(null);
      toast.success("Endpoint updated");
      void load(true);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: string | { message?: string } } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : message?.message || "The endpoint could not be updated");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (hook: Hook, isActive: boolean) => {
    try {
      await api.patch(`/alert-webhooks/${hook.id}`, { isActive });
      toast.success(isActive ? "Endpoint resumed" : "Endpoint parked");
      void load(true);
    } catch {
      toast.error("That change did not save");
    }
  };

  const test = async (hook: Hook) => {
    setTesting(hook.id);
    try {
      const { data } = await api.post<TestOutcome>(`/alert-webhooks/${hook.id}/test`);
      setOutcomes((prev) => ({ ...prev, [hook.id]: data }));
      if (data.status === "delivered") toast.success(`${hook.name}: ${data.detail}`);
      else toast.error(`${hook.name} answered nothing useful: ${data.detail}`);
      void load(true);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(typeof message === "string" ? message : "The test could not be sent");
    } finally {
      setTesting(null);
    }
  };

  const remove = async (hook: Hook) => {
    try {
      await api.delete(`/alert-webhooks/${hook.id}`);
      setConfirming(null);
      if (minted?.id === hook.id) setMinted(null);
      toast.success("Endpoint removed, with its delivery history");
      void load(true);
    } catch {
      toast.error("The endpoint could not be removed");
    }
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Signing secret copied");
    } catch {
      toast.error("Copy failed — select the text and copy it by hand");
    }
  };

  const eventLabel = (event: string) =>
    options.find((o) => o.event === event)?.label ?? (event === "webhook.test" ? "Test delivery" : event);

  const hookName = (webhookId: string) => hooks.find((h) => h.id === webhookId)?.name ?? "removed endpoint";

  const activeHooks = hooks.filter((hook) => hook.isActive).length;
  /** A parked endpoint that keeps failing is the combination worth finding, so failing is per hook. */
  const failingHookIds = new Set(deliveries.filter((d) => d.status === "failed").map((d) => d.webhookId));
  const shownHooks = hooks.filter((hook) =>
    hookView === "enabled" ? hook.isActive : hookView === "failing" ? failingHookIds.has(hook.id) : true);
  const shownDeliveries = deliveries.filter((d) => deliveryView === "all" || d.status === deliveryView);
  const deliveredCount = deliveries.filter((d) => d.status === "delivered").length;
  const failedCount = deliveries.filter((d) => d.status === "failed").length;
  const pendingCount = deliveries.filter((d) => d.status === "pending").length;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title="Alert Webhooks"
        subtitle="Endpoints that receive an alert the moment it opens or closes, so another system can act on it."
      />

      {/* ── The figures the page already holds ── */}
      {modern ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Endpoints registered" value={hooks.length} icon={<Send size={14} />} tone="cyber" />
          <StatCard label="Active endpoints" value={activeHooks} icon={<ShieldCheck size={14} />} tone="green" />
          <StatCard label="Deliveries logged" value={deliveries.length} icon={<KeyRound size={14} />} tone="neutral" />
          <StatCard label="Failed deliveries" value={failedCount} icon={<Trash2 size={14} />} tone="amber" />
        </div>
      ) : null}

      {/* ── What this is for ── */}
      <div className="card">
        <p className="text-sm text-gray-300 leading-relaxed">
          A webhook is how C7NTAX tells something else that a monitored service has broken. When an
          alert opens or closes, every active endpoint subscribed to that event receives one
          <span className="text-white"> signed HTTPS POST</span> — no polling, no shared credentials,
          no integration to build. Point it at a Teams or Slack workflow, a ticketing bridge, a
          monitoring tool or your own script.
        </p>
        <p className="text-sm text-gray-400 leading-relaxed mt-3">
          Delivery is fire-and-forget: an endpoint that is slow or unreachable is retried on the
          schedule below and then logged as failed, and it never holds up the alert itself. Every
          attempt is recorded, so &ldquo;did it arrive?&rdquo; is a question you can answer from this page
          rather than guess at from the other end.
        </p>
      </div>

      {/* ── Register ── */}
      <Section title="Register an endpoint">
        <div className="card space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="hook-name">Name</Label>
              <input
                id="hook-name"
                className="input-field"
                placeholder="Service alert bridge"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Hint>
                How this endpoint is listed here and named in the delivery log. Optional — leave it
                blank and the host name is used instead.
              </Hint>
            </div>
            <div>
              <Label htmlFor="hook-url">Endpoint URL</Label>
              <input
                id="hook-url"
                className="input-field"
                placeholder="https://example.com/c7ntax/alerts"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Hint>
                The address the POST goes to. It has to be reachable from this server and must not
                resolve to a private or link-local address — those are refused both when you save it
                and again before every delivery.
              </Hint>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_180px] sm:items-start">
            <div>
              <Label>Events to send</Label>
              <EventPicker options={options} selected={selected} onToggle={(e) => setSelected(toggle(selected, e))} />
              <Hint>
                Each event is one delivery. An endpoint subscribed to nothing is refused, because a
                registration that never fires reads as a broken integration.
              </Hint>
            </div>
            <div>
              <Label htmlFor="hook-retries">Retries per event</Label>
              <input
                id="hook-retries"
                type="number"
                min={1}
                max={5}
                className="input-field"
                value={retries}
                onChange={(e) => setRetries(e.target.value)}
              />
              <Hint>
                How many attempts we make before the delivery is logged as failed. The wait doubles
                each time — 1s, 5s, 15s, 30s — and three attempts is the default.
              </Hint>
            </div>
          </div>

          {formError ? (
            <p className="text-xs text-amber-300 flex items-start gap-2">
              <X size={13} className="mt-0.5 shrink-0" />
              {formError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button className="btn-primary text-sm" onClick={create} disabled={busy}>
              {busy ? "Registering…" : "Register endpoint"}
            </button>
            <span className="text-xs text-gray-500">The signing secret is shown once, right after this.</span>
          </div>
        </div>
      </Section>

      {/* ── The secret, shown exactly once ── */}
      {minted ? (
        <div className="card border-cyber-600/40">
          <div className="flex items-start gap-3">
            <KeyRound size={16} className="text-cyber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-white">Signing secret for {minted.name}</h3>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                Check this on every delivery before acting on it — it is the only thing that proves a
                request came from this instance. It is not shown again after you leave this page or
                register another endpoint, so store it with the endpoint now.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <code className="flex-1 min-w-0 truncate rounded-md border border-surface-border bg-surface-light px-3 py-2 text-xs text-gray-200 font-mono">
                  {minted.secret}
                </code>
                <button className="btn-secondary text-xs shrink-0 inline-flex items-center gap-1.5" onClick={() => void copySecret(minted.secret)}>
                  <Copy size={13} /> Copy
                </button>
              </div>
            </div>
            <button className="text-gray-500 hover:text-gray-300 shrink-0" onClick={() => setMinted(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Registered endpoints ── */}
      {modern && !loading && hooks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews
            views={[
              { id: "all", label: "All", count: hooks.length },
              { id: "enabled", label: "Enabled", count: activeHooks },
              { id: "failing", label: "Failing", count: hooks.filter((hook) => failingHookIds.has(hook.id)).length },
            ]}
            value={hookView}
            onChange={setHookView}
            label="Endpoint views"
          />
          <span className="text-xs text-gray-500">
            {shownHooks.length} endpoint{shownHooks.length === 1 ? "" : "s"} shown · {activeHooks} enabled ·{" "}
            {hooks.length - activeHooks} parked
          </span>
        </div>
      ) : null}

      <Section title={`Registered endpoints${hooks.length ? ` (${hooks.length})` : ""}`}>
        {loading ? (
          <div className="card"><p className="text-sm text-gray-500">Loading…</p></div>
        ) : hooks.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No endpoints registered"
              description="Nothing is being told about alerts yet. Register one above to bridge C7NTAX into whatever acts on an outage."
            />
          </div>
        ) : (
          <div className="space-y-3">
            {(modern ? shownHooks : hooks).map((hook) => {
              const outcome = outcomes[hook.id];
              return (
              <div key={hook.id} className="card">
                {editing === hook.id ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`edit-name-${hook.id}`}>Name</Label>
                        <input
                          id={`edit-name-${hook.id}`}
                          className="input-field"
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`edit-url-${hook.id}`}>Endpoint URL</Label>
                        <input
                          id={`edit-url-${hook.id}`}
                          className="input-field"
                          value={draft.url}
                          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[1fr_180px] sm:items-start">
                      <div>
                        <Label>Events to send</Label>
                        <EventPicker
                          options={options}
                          selected={draft.events}
                          onToggle={(e) => setDraft({ ...draft, events: toggle(draft.events, e) })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`edit-retries-${hook.id}`}>Retries per event</Label>
                        <input
                          id={`edit-retries-${hook.id}`}
                          type="number"
                          min={1}
                          max={5}
                          className="input-field"
                          value={draft.retries}
                          onChange={(e) => setDraft({ ...draft, retries: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="btn-primary text-sm" onClick={() => void saveDraft(hook.id)} disabled={busy}>
                        Save changes
                      </button>
                      <button className="btn-secondary text-sm" onClick={() => setEditing(null)}>Cancel</button>
                      <span className="text-xs text-gray-500">The signing secret does not change.</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white">{hook.name}</span>
                          {hook.isActive ? <Chip tone="good">Active</Chip> : <Chip tone="muted">Parked</Chip>}
                          <Chip tone="info">{hook.retryCount === 1 ? "1 attempt" : `up to ${hook.retryCount} attempts`}</Chip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 break-all font-mono">{hook.url}</p>
                        <p className={`text-xs text-gray-500 mt-1${modern ? " tabular-nums" : ""}`}>
                          registered {formatWhen(hook.createdAt)} · {hook.events.length} event{hook.events.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {hook.events.map((event) => (
                        <Chip key={event} tone="muted">{eventLabel(event)}</Chip>
                      ))}
                    </div>

                    {outcome ? (
                      <p className={`text-xs flex items-start gap-2 ${outcome.status === "delivered" ? "text-emerald-300" : "text-amber-300"}`}>
                        <Send size={12} className="mt-0.5 shrink-0" />
                        Last test: {outcome.status} after {outcome.attempts} attempt
                        {outcome.attempts === 1 ? "" : "s"} — {outcome.detail}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-border">
                      <button
                        className="btn-secondary text-xs inline-flex items-center gap-1.5"
                        onClick={() => void test(hook)}
                        disabled={testing === hook.id}
                        title="Sends one webhook.test delivery now, with one attempt, so you can see the round trip in the log below"
                      >
                        <Send size={13} /> {testing === hook.id ? "Sending…" : "Send test"}
                      </button>
                      <button
                        className="btn-secondary text-xs inline-flex items-center gap-1.5"
                        onClick={() => {
                          setEditing(hook.id);
                          setDraft({ name: hook.name, url: hook.url, retries: String(hook.retryCount), events: [...hook.events] });
                        }}
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      <button className="btn-secondary text-xs" onClick={() => void setActive(hook, !hook.isActive)}>
                        {hook.isActive ? "Park" : "Resume"}
                      </button>
                      {confirming === hook.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button className="btn-danger text-xs inline-flex items-center gap-1.5" onClick={() => void remove(hook)}>
                            <Trash2 size={13} /> Remove it and its history
                          </button>
                          <button className="btn-secondary text-xs" onClick={() => setConfirming(null)}>Keep it</button>
                        </span>
                      ) : (
                        <button className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={() => setConfirming(hook.id)}>
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                      {!hook.isActive ? (
                        <span className="text-xs text-gray-500">Parked endpoints keep their history but receive nothing.</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
            {modern && shownHooks.length === 0 ? (
              <div className="card"><p className="text-sm text-gray-500">Nothing in this view.</p></div>
            ) : null}
            {modern && shownHooks.length > 0 ? (
              <ListFooter
                from={1}
                to={shownHooks.length}
                total={shownHooks.length}
                page={1}
                pages={1}
                onPage={() => {}}
                note={`${hooks.length} endpoint${hooks.length === 1 ? "" : "s"} registered`}
              />
            ) : null}
          </div>
        )}
      </Section>

      {/* ── Delivery log ── */}
      {modern && deliveries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews
            views={[
              { id: "all", label: "All", count: deliveries.length },
              { id: "delivered", label: "Delivered", count: deliveredCount },
              { id: "failed", label: "Failed", count: failedCount },
              { id: "pending", label: "Pending", count: pendingCount },
            ]}
            value={deliveryView}
            onChange={setDeliveryView}
            label="Delivery views"
          />
          <span className="text-xs text-gray-500">
            {shownDeliveries.length} deliver{shownDeliveries.length === 1 ? "y" : "ies"} shown ·{" "}
            {failedCount} failed
          </span>
        </div>
      ) : null}

      <Section title="Delivery log">
        <div className="card !p-0 overflow-hidden">
          <div className="divide-y divide-surface-border">
            {deliveries.length === 0 ? (
              <EmptyState
                title="Nothing delivered yet"
                description="The last 100 deliveries appear here. Press Send test on an endpoint to put the first one in the list without waiting for an incident."
              />
            ) : (
              (modern ? shownDeliveries : deliveries).map((delivery) => (
                <div key={delivery.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-white">{eventLabel(delivery.event)}</span>
                    {modern ? (
                      <span className={`chip ${delivery.status === "delivered" ? "chip--good" : delivery.status === "failed" ? "chip--bad" : "chip--warn"}`}>
                        {delivery.status}
                      </span>
                    ) : (
                      <Chip tone={STATUS_TONE[delivery.status] ?? "muted"}>{delivery.status}</Chip>
                    )}
                    <span className={`text-xs text-gray-500${modern ? " tabular-nums" : ""}`}>
                      {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
                    </span>
                    <span className={`text-xs text-gray-500${modern ? " tabular-nums" : ""}`}>{formatWhen(delivery.createdAt)}</span>
                    <span className="text-xs text-gray-400 ml-auto">{hookName(delivery.webhookId)}</span>
                  </div>
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer">
                      What was sent
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300">
                      {prettyPayload(delivery.payload)}
                    </pre>
                  </details>
                </div>
              ))
            )}
            {modern && deliveries.length > 0 && shownDeliveries.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">Nothing in this view.</p>
            ) : null}
          </div>
          {modern && shownDeliveries.length > 0 ? (
            <ListFooter
              from={1}
              to={shownDeliveries.length}
              total={shownDeliveries.length}
              page={1}
              pages={1}
              onPage={() => {}}
              note={`the last ${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"} recorded`}
            />
          ) : null}
        </div>
        <div className="card">
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">Reading the log</h4>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 text-xs">
            <div className="flex gap-2">
              <dt className="text-gray-400 shrink-0 w-20">Status</dt>
              <dd className="text-gray-500">
                <span className="text-emerald-300">delivered</span> — the endpoint answered 2xx.
                <span className="text-amber-300"> failed</span> — every attempt was refused, timed out or
                errorred. <span className="text-cyber-300">pending</span> — in flight, or left behind by
                a restart.
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 shrink-0 w-20">Attempts</dt>
              <dd className="text-gray-500">
                How many tries it took, out of the endpoint&rsquo;s own retry limit. One attempt that
                succeeded is the healthy case; a failed row showing the full count means the endpoint
                never answered at all.
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 shrink-0 w-20">Event</dt>
              <dd className="text-gray-500">
                Which event the delivery carried. A test delivery is labelled as such and is never
                subscribed to — it only ever comes from the Send test button.
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 shrink-0 w-20">Retries</dt>
              <dd className="text-gray-500">
                Failures are retried with a widening gap — 1s, 5s, 15s, then 30s — so a five-minute
                blip on the other side is usually invisible. A test sends exactly one attempt.
              </dd>
            </div>
          </dl>
        </div>
      </Section>

      {/* ── The wire reference ── */}
      <Section title="What arrives at your endpoint">
        <div className="card space-y-4">
          <p className="text-sm text-gray-400 leading-relaxed">
            One <code className="text-gray-300">POST</code> per event, JSON body, no redirects followed
            to a different host. The three headers below are the whole contract.
          </p>
          <dl className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-gray-300 font-mono shrink-0">{EVENT_HEADER}</dt>
              <dd className="text-gray-500">The event name, repeated from the body for routers that cannot parse it first.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-300 font-mono shrink-0">{DELIVERY_HEADER}</dt>
              <dd className="text-gray-500">This delivery&rsquo;s id — quote it to match a row in the log above.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-300 font-mono shrink-0">{SIGNATURE_HEADER}</dt>
              <dd className="text-gray-500">
                <span className="font-mono">sha256=&lt;hmac&gt;</span> — HMAC-SHA256 of the exact request
                body using that endpoint&rsquo;s signing secret. Compare it before trusting the payload.
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-300 font-mono shrink-0">content-type</dt>
              <dd className="text-gray-500">Always <span className="font-mono">application/json</span>. Answer any 2xx and the delivery is done.</dd>
            </div>
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">The body</h4>
              <pre className="max-h-72 overflow-auto rounded-md border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300">
                {SAMPLE_BODY}
              </pre>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide mb-2">Verifying it</h4>
              <pre className="max-h-72 overflow-auto rounded-md border border-surface-border bg-surface-light p-3 text-[11px] leading-relaxed text-gray-300">
                {SAMPLE_VERIFY}
              </pre>
            </div>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Alerts open and close on the same poll as Service Alerts, so a delivery arrives within
            minutes of an incident rather than instantly. A resolved alert carries the same shape with{" "}
            <span className="font-mono text-gray-400">status: &quot;resolved&quot;</span> and a{" "}
            <span className="font-mono text-gray-400">resolvedAt</span>, so one handler can do both.
          </p>
        </div>
      </Section>
    </div>
  );
}
