/**
 * Administration → System Settings.
 *
 * This screen used to be a form of about thirty controls that nothing read: company name, time
 * zone, date format, SMTP credentials, password policy, an API key block and a database
 * connection string, all written into one `app_settings` row that only `general.contextMenus`
 * was ever read from. The single control on it that did something was indistinguishable from the
 * twenty-nine that did not, which is worse than having no screen at all.
 *
 * So it now holds only what it can prove:
 *   · a signpost to every setting that takes effect, and how many there are in each area;
 *   · the operational state of this instance — whether the poller is alive, what it has had to
 *     heal — which is read from the running process rather than from a stored value;
 *   · the deployment facts it can read without exposing a credential: whether a mail relay
 *     answers, which database this instance is on, and where the Outlook add-in is served from.
 *
 * Infrastructure values that only a deployment can change are shown as facts with the variable
 * that owns them named. Inventing an edit control for a connection string is precisely how the
 * previous version misled people.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { ListFooter, PageHeader, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle, Clock, Database, Mail,
  Monitor, RotateCw, Search, Server, XCircle, type LucideIcon,
} from "lucide-react";

/**
 * The settings people come here looking for, named up front rather than buried in whichever area
 * happens to own them. Shared by both interfaces so the two list the same destinations.
 */
const AREA_SHORTCUTS = [
  { label: "Outlook add-in", to: "/admin/configuration/apps" },
  { label: "Customer portal", to: "/admin/portal" },
  { label: "Service alerts & monitors", to: "/admin/configuration/monitoring" },
  { label: "Email connectors", to: "/admin/configuration/integrations" },
  { label: "Sessions & security", to: "/admin/configuration/sessions" },
  { label: "Billing & invoicing", to: "/admin/configuration/billing" },
];

interface PollerStatus {
  paused: boolean;
  retryCount: number;
  maxRetries: number;
  recoveryLog: Array<{ at?: string; time?: string; event?: string; message?: string; result?: string }>;
}

interface Deployment {
  mail: { configured: boolean; host: string | null; port: number; secure: boolean; hasCredentials: boolean; from: string | null };
  database: { configured: boolean; host: string | null; name: string | null };
  runtime: { nodeEnv: string; port: number; webOrigin: string | null; servesWeb: boolean };
  addin: {
    enabled: boolean;
    environmentEnabled: boolean;
    environmentSupplied: boolean;
    directory: string;
    assetsPresent: boolean;
  };
}

interface AreaSummary {
  id: string;
  label: string;
  summary: string;
  fields: Array<{ source: string }>;
}

const TONE = {
  good: "bg-emerald-600/10 text-emerald-400",
  bad: "bg-red-600/10 text-red-400",
  warn: "bg-amber-600/10 text-amber-400",
  info: "bg-cyber-600/10 text-cyber-400",
} as const;

function StatusCard({ icon: Icon, label, value, tone }: {
  icon: LucideIcon; label: string; value: string; tone: keyof typeof TONE;
}) {
  return (
    <div className={`rounded-xl p-3 flex items-center gap-3 ${TONE[tone].split(" ")[0]}`}>
      <Icon size={18} className={`shrink-0 ${TONE[tone].split(" ")[1]}`} />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-sm font-semibold truncate ${TONE[tone].split(" ")[1]}`}>{value}</p>
      </div>
    </div>
  );
}

function DeploymentRow({ icon: Icon, label, env, note, state, action }: {
  icon: LucideIcon; label: string; env: string; note: ReactNode; state: "good" | "warn" | "info"; action?: ReactNode;
}) {
  const redesign = useRedesign();

  if (redesign) {
    /* A row, the way the mockup draws a setting: what it is on the left, where its value comes from
       underneath, the state in the middle and the action — when there is one — on the right. */
    return (
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-surface-border last:border-b-0 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon size={14} className="shrink-0 text-gray-500" />
            <p className="text-sm text-white">{label}</p>
          </div>
          <p className="text-xs text-gray-400 mt-1">{note}</p>
          <p className="text-[11px] text-gray-500 mt-1 font-mono">{env}</p>
        </div>
        <div className="shrink-0">
          {state === "good" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
              <CheckCircle size={11} /> configured
            </span>
          )}
          {state === "warn" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-500/10 text-amber-300 border-amber-500/30">
              <AlertTriangle size={11} /> not set
            </span>
          )}
          {state === "info" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-surface-lighter text-gray-400 border-surface-border">
              off
            </span>
          )}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-surface-border px-3.5 py-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-white">{label}</p>
          {state === "good" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
              <CheckCircle size={11} /> configured
            </span>
          )}
          {state === "warn" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-500/10 text-amber-300 border-amber-500/30">
              <AlertTriangle size={11} /> not set
            </span>
          )}
          {state === "info" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-surface-lighter text-gray-400 border-surface-border">
              off
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1">{note}</p>
        <p className="text-[11px] text-gray-500 mt-1 font-mono">{env}</p>
        {action}
      </div>
    </div>
  );
}

export function SystemSettingsPage() {
  const [poller, setPoller] = useState<PollerStatus | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [areas, setAreas] = useState<AreaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const redesign = useRedesign();
  const [query, setQuery] = useState("");
  const [areaId, setAreaId] = useState("all");

  const load = useCallback(async () => {
    const [pollerRes, deploymentRes, configRes] = await Promise.allSettled([
      api.get("/system/poller/status"),
      api.get("/system/deployment"),
      api.get("/configuration"),
    ]);
    if (pollerRes.status === "fulfilled") setPoller(pollerRes.value.data);
    if (deploymentRes.status === "fulfilled") setDeployment(deploymentRes.value.data);
    if (configRes.status === "fulfilled") setAreas(configRes.value.data?.sections ?? []);
    if (pollerRes.status === "rejected" && deploymentRes.status === "rejected") {
      setError("The API is not answering, so this instance's state cannot be read.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resetRetries = async () => {
    try { await api.post("/system/failover/reset"); } catch { /* the refresh reports the truth */ }
    await load();
  };

  // Search and the area rail are the redesign's hub. Both read what the page has already loaded —
  // the registry of areas — so nothing here asks the API a second question.
  const q = query.trim().toLowerCase();
  const shownShortcuts = q ? AREA_SHORTCUTS.filter(shortcut => shortcut.label.toLowerCase().includes(q)) : AREA_SHORTCUTS;
  const shownAreas = areas.filter(candidate =>
    (areaId === "all" || candidate.id === areaId) &&
    (!q || candidate.label.toLowerCase().includes(q) || candidate.summary.toLowerCase().includes(q)));

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title="System Settings"
        subtitle="This instance's operational state, and a signpost to every setting that takes effect."
        actions={<button onClick={() => void load()} className="btn-secondary text-sm flex items-center gap-2"><RotateCw size={14} /> Refresh</button>}
      />

      {error && <div className="card border-red-500/30 text-sm text-red-300">{error}</div>}

      {redesign && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-9"
              placeholder="Search every setting…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search every configuration area"
            />
          </div>
          <span className="chip">
            {areas.length} areas · each one names the variable that owns its settings
          </span>
          {q ? <span className="text-xs text-gray-500 tabular-nums">{shownAreas.length} shown</span> : null}
        </div>
      )}

      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-1">Configuration</h3>
        <p className="text-xs text-gray-400 mb-4">
          Application settings live on one screen, where every field names the environment variable
          it stands in for, the behaviour it changes, and whether a restart is needed. These are the
          areas your role can read:
        </p>
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : areas.length === 0 ? (
          <p className="text-xs text-gray-500">Your role cannot read any configuration area.</p>
        ) : (
          <>
            {redesign ? (
              <div className="grid gap-4 lg:grid-cols-[236px_minmax(0,1fr)]">
                <nav
                  aria-label="Configuration areas"
                  className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 lg:pr-3 lg:border-r lg:border-surface-border"
                >
                  <button
                    type="button"
                    onClick={() => setAreaId("all")}
                    aria-current={areaId === "all" ? "true" : undefined}
                    className={`shrink-0 text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                      areaId === "all"
                        ? "bg-cyber-600/15 text-cyber-300 border-cyber-600/30"
                        : "text-gray-400 hover:text-white hover:bg-surface-lighter border-transparent"
                    }`}
                  >
                    All areas <span className="text-gray-600 tabular-nums">{areas.length}</span>
                  </button>
                  {areas.map(candidate => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setAreaId(candidate.id)}
                      aria-current={areaId === candidate.id ? "true" : undefined}
                      className={`shrink-0 flex items-center gap-1.5 text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        areaId === candidate.id
                          ? "bg-cyber-600/15 text-cyber-300 border-cyber-600/30"
                          : "text-gray-400 hover:text-white hover:bg-surface-lighter border-transparent"
                      }`}
                    >
                      {candidate.label} <span className="text-gray-600 tabular-nums">{candidate.fields.length}</span>
                    </button>
                  ))}
                </nav>
                <div className="space-y-3 min-w-0">
                  {shownShortcuts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {shownShortcuts.map(shortcut => (
                        <Link
                          key={shortcut.to + shortcut.label}
                          to={shortcut.to}
                          className="rounded-full border border-surface-border px-3 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"
                        >
                          {shortcut.label}
                        </Link>
                      ))}
                    </div>
                  )}
                  {shownAreas.length === 0 ? (
                    <p className="text-xs text-gray-500">No area matches “{query.trim()}”.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {shownAreas.map(area => (
                        <Link
                          key={area.id}
                          to={`/admin/configuration/${area.id}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3.5 py-2.5 hover:bg-surface-lighter transition-colors group"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-white">{area.label}</p>
                            <p className="text-[11px] text-gray-500 truncate">{area.summary}</p>
                          </div>
                          <ArrowRight size={14} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Devices and mail clients are the settings people come here looking for, so they are
                    named up front rather than buried in whichever area happens to own them. */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {AREA_SHORTCUTS.map(shortcut => (
                    <Link
                      key={shortcut.to + shortcut.label}
                      to={shortcut.to}
                      className="rounded-full border border-surface-border px-3 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"
                    >
                      {shortcut.label}
                    </Link>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {areas.map(area => (
                    <Link
                      key={area.id}
                      to={`/admin/configuration/${area.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3.5 py-2.5 hover:bg-surface-lighter transition-colors group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-white">{area.label}</p>
                        <p className="text-[11px] text-gray-500 truncate">{area.summary}</p>
                      </div>
                      <ArrowRight size={14} className="text-gray-600 group-hover:text-gray-400 shrink-0" />
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Activity size={15} className="text-cyber-400" /> Instance health
        </h3>
        {redesign ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icon={poller && !poller.paused ? <CheckCircle size={13} /> : <XCircle size={13} />}
              label="Self-healing poller"
              value={loading ? "…" : poller ? (poller.paused ? "Paused" : "Running") : "Unknown"}
              tone={!poller ? "amber" : poller.paused ? "red" : "green"}
            />
            <StatCard
              icon={<RotateCw size={13} />}
              label="Recovery retries used"
              value={poller ? `${poller.retryCount} / ${poller.maxRetries}` : "…"}
              tone={poller && poller.retryCount >= poller.maxRetries ? "amber" : "cyber"}
            />
            <StatCard
              icon={deployment ? <Server size={13} /> : <AlertTriangle size={13} />}
              label="Serving"
              value={deployment ? `API on ${deployment.runtime.port}${deployment.runtime.servesWeb ? " + web" : ""}` : "…"}
              tone={deployment ? "cyber" : "amber"}
            />
          </div>
        ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusCard
            icon={poller && !poller.paused ? CheckCircle : XCircle}
            label="Self-healing poller"
            value={loading ? "…" : poller ? (poller.paused ? "Paused" : "Running") : "Unknown"}
            tone={!poller ? "warn" : poller.paused ? "bad" : "good"}
          />
          <StatusCard
            icon={RotateCw}
            label="Recovery retries used"
            value={poller ? `${poller.retryCount} / ${poller.maxRetries}` : "…"}
            tone={poller && poller.retryCount >= poller.maxRetries ? "warn" : "info"}
          />
          <StatusCard
            icon={deployment ? Server : AlertTriangle}
            label="Serving"
            value={deployment ? `API on ${deployment.runtime.port}${deployment.runtime.servesWeb ? " + web" : ""}` : "…"}
            tone={deployment ? "info" : "warn"}
          />
        </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => void resetRetries()} className="btn-secondary text-sm flex items-center gap-2">
            <RotateCw size={14} /> Reset retry counter
          </button>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-semibold text-gray-400 mb-2 flex items-center gap-2">
            <Clock size={14} /> Recovery history
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {(poller?.recoveryLog?.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-600">No recovery events — nothing has needed self-healing.</p>
            ) : (
              poller?.recoveryLog.map((entry, index) => (
                <div key={index} className="flex items-center gap-3 text-xs py-1.5 px-3 bg-surface-lighter rounded">
                  <span className="text-gray-500 whitespace-nowrap">
                    {entry.at || entry.time ? new Date(entry.at || entry.time || "").toLocaleString() : ""}
                  </span>
                  <span className="text-white min-w-0 truncate">{entry.event || entry.message}</span>
                  {entry.result && (
                    <span className={entry.result === "success" ? "text-emerald-400" : "text-red-400"}>{entry.result}</span>
                  )}
                </div>
              ))
            )}
          </div>
          {redesign && (poller?.recoveryLog?.length ?? 0) > 0 && (
            <ListFooter
              from={1}
              to={poller?.recoveryLog?.length ?? 0}
              total={poller?.recoveryLog?.length ?? 0}
              page={1}
              pages={1}
              onPage={() => { /* the whole log is on this page */ }}
              note="Read from the running process, not stored"
            />
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-1">Provided by the deployment</h3>
        <p className="text-xs text-gray-400 mb-4">
          Read from the environment the API started with. These are not editable from a browser
          session on purpose: a mail password and a database connection string do not belong in a
          settings row that a support session can read. The variable that owns each one is named so
          it can be found in the deployment's own configuration.
        </p>

        <div className="space-y-2">
          {deployment ? (
            <>
              <DeploymentRow
                icon={Mail}
                label="Outbound mail relay"
                env="SMTP_HOST · SMTP_PORT · SMTP_USER · SMTP_PASS · SMTP_FROM"
                note={
                  deployment.mail.configured
                    ? `Ticket notifications, portal sign-in codes and connector error mail are sent through ${deployment.mail.host}:${deployment.mail.port}${deployment.mail.secure ? " (TLS)" : ""}${deployment.mail.hasCredentials ? " with credentials" : " without credentials"}${deployment.mail.from ? `, from ${deployment.mail.from}` : ""}.`
                    : "No relay is configured, so notification mail, portal sign-in codes and connector error reports cannot be sent."
                }
                state={deployment.mail.configured ? "good" : "warn"}
              />
              <DeploymentRow
                icon={Database}
                label="Database"
                env="DATABASE_URL"
                note={
                  deployment.database.configured
                    ? `This instance is running on ${deployment.database.name ?? "an unnamed database"} at ${deployment.database.host ?? "an unreadable address"}. Migrations are applied on start.`
                    : "No database URL is set, so nothing that touches stored data will work."
                }
                state={deployment.database.configured ? "good" : "warn"}
              />
              <DeploymentRow
                icon={Monitor}
                label="Outlook add-in"
                env="OUTLOOK_ADDIN_ENABLED · OUTLOOK_ADDIN_DIR"
                state={
                  !deployment.addin.assetsPresent ? "warn"
                    : deployment.addin.enabled ? "good"
                      : "info"
                }
                note={
                  !deployment.addin.assetsPresent
                    ? `The taskpane's files are not at ${deployment.addin.directory}, so the add-in cannot be served whatever the switch says.`
                    : deployment.addin.enabled
                      ? `Serving. The taskpane is loaded from ${deployment.addin.directory} and the endpoint accepts a filed message.`
                      : `Switched off. The taskpane and the endpoint both answer 404, so a mailbox that already has the add-in sideloaded is told the server does not support it.`
                }
                action={
                  <Link
                    to="/admin/configuration/apps"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-cyber-300 hover:text-cyber-200"
                  >
                    {deployment.addin.enabled ? "Switch the add-in off" : "Switch the add-in on"}
                    <ArrowRight size={12} />
                  </Link>
                }
              />
            </>
          ) : (
            <p className="text-xs text-gray-500">The deployment's own configuration could not be read.</p>
          )}
        </div>

        <p className="text-[11px] text-gray-600 mt-4">
          Secrets are never returned to the browser, so this screen can confirm that a variable is
          set but never show its value. Which integrations are live is under{" "}
          <Link to="/admin/configuration/integrations" className="text-cyber-300 hover:text-cyber-200">
            C7NC &amp; Email
          </Link>.
        </p>
      </div>

      <p className="text-xs text-gray-500">
        There is nothing to save on this screen. Everything that changes behaviour lives under{" "}
        <Link to="/admin/configuration" className="text-cyber-300 hover:text-cyber-200">Configuration</Link>,
        where each setting is validated and applied as soon as it is changed.
      </p>
    </div>
  );
}
