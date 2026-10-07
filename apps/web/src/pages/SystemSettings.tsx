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
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { PageHeader } from "../components/ui";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle, Clock, Database, Mail,
  Monitor, RotateCw, Server, XCircle, type LucideIcon,
} from "lucide-react";

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
  addin: { enabled: boolean; directory: string };
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

function DeploymentRow({ icon: Icon, label, env, note, state }: {
  icon: LucideIcon; label: string; env: string; note: string; state: "good" | "warn" | "info";
}) {
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
        </div>
        <p className="text-xs text-gray-400 mt-1">{note}</p>
        <p className="text-[11px] text-gray-500 mt-1 font-mono">{env}</p>
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

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader
        title="System Settings"
        subtitle="This instance's operational state, and a signpost to every setting that takes effect."
        actions={<button onClick={() => void load()} className="btn-secondary text-sm flex items-center gap-2"><RotateCw size={14} /> Refresh</button>}
      />

      {error && <div className="card border-red-500/30 text-sm text-red-300">{error}</div>}

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
        )}
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Activity size={15} className="text-cyber-400" /> Instance health
        </h3>
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
                env="OUTLOOK_ADDIN_DIR · OUTLOOK_ADDIN_ENABLED"
                note={`The taskpane is ${deployment.addin.enabled ? "served" : "switched off"} from ${deployment.addin.directory}. Whether mail can be filed depends on the same switch under CloudConnect, Email & Microsoft 365.`}
                state="good"
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
            CloudConnect, Email &amp; Microsoft 365
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
