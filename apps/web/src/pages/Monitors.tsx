import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { ListViews, PageHeader } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

type MonitorVerdict = "problem" | "restored" | "clear" | "unknown";

type MonitorService = {
  id: string; name: string; monitorKind: string; monitorUrl: string | null;
  monitorConfig: { expectStatus?: number; sslWarnDays?: number } | null;
  enabled: boolean;
  /** What the poller last recorded for each of this service's sources, from this same read. */
  sourceStatus: { checkedAt: string; sources: Array<{ source: string; verdict: MonitorVerdict; detail: string }> } | null;
  /** The service's active alerts, as the same read returns them: how the poller graded a problem. */
  alerts?: Array<{ id: string; status: string; severity: string }>;
};

type MonitorState = "up" | "warning" | "down";

const SEVERITY_RANK: Record<string, number> = { informational: 0, degraded: 1, outage: 2 };

/** The worst severity among a service's active alerts — how the poller graded the problem itself. */
function worstActiveSeverity(alerts: Array<{ status: string; severity: string }>): string | null {
  let worst: string | null = null;
  for (const a of alerts) {
    if (a.status !== "active") continue;
    if (worst === null || (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) worst = a.severity;
  }
  return worst;
}

/**
 * A monitor's state, from the verdict the same poll recorded for its own check. A check that cannot
 * be read is a warning — never an all-clear — and one reporting a problem is graded by the alert it
 * raised, so a failed fetch is down while a certificate merely approaching expiry is a warning.
 */
function monitorState(service: MonitorService): MonitorState | null {
  const reading = service.sourceStatus?.sources.find(s => s.source === service.monitorKind);
  if (!reading) return null;
  if (reading.verdict === "unknown") return "warning";
  if (reading.verdict !== "problem") return "up";
  const severity = worstActiveSeverity(service.alerts ?? []);
  return severity === "informational" || severity === "degraded" ? "warning" : "down";
}

const MONITOR_STATE_CHIP: Record<MonitorState, string> = {
  up: "chip--good",
  warning: "chip--warn",
  down: "chip--bad",
};

/** The state as a chip, with the reading that decided it in the tooltip. */
function MonitorStateChip({ service }: { service: MonitorService }) {
  const state = monitorState(service);
  const detail = service.sourceStatus?.sources.find(s => s.source === service.monitorKind)?.detail;
  if (!state) {
    return <span className="chip" title="The last poll recorded no result for this monitor — switching it on is what gives it a state">No reading</span>;
  }
  return (
    <span className={`chip ${MONITOR_STATE_CHIP[state]}`} title={detail}>
      {state === "up" ? "Up" : state === "warning" ? "Warning" : "Down"}
    </span>
  );
}

export function MonitorsPage() {
  const [services, setServices] = useState<MonitorService[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("website");
  const [url, setUrl] = useState("");
  const [sslWarnDays, setSslWarnDays] = useState("30");
  const [expectStatus, setExpectStatus] = useState("200");
  const [message, setMessage] = useState("");
  const redesign = useRedesign();
  const [view, setView] = useState("all");

  const load = () => api.get("/service-alerts/services").then(r => setServices((r.data.data || r.data || []).filter((s: MonitorService) => s.monitorKind !== "vendor"))).catch(() => setServices([]));

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!name || !url) { setMessage("Name and target URL required"); return; }
    try {
      await api.post("/service-alerts/services", {
        name, category: "uptime", monitorKind: kind, monitorUrl: url, monitorEnabled: true, enabled: true,
        monitorConfig: kind === "ssl" ? { sslWarnDays: Number(sslWarnDays) || 30 } : kind === "website" ? { expectStatus: Number(expectStatus) || 200 } : {},
      });
      setName(""); setUrl(""); setMessage("Monitor created");
      void load();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Create failed"); }
  };

  // The state strip and the count line are built from the verdicts the poller already returned
  // alongside these services, so no number here needs a second request.
  const counts = {
    up: services.filter(s => monitorState(s) === "up").length,
    warning: services.filter(s => monitorState(s) === "warning").length,
    down: services.filter(s => monitorState(s) === "down").length,
  };
  const withReading = counts.up + counts.warning + counts.down;
  const lastRead = services.reduce<string | null>((latest, s) => {
    const at = s.sourceStatus?.checkedAt;
    return at && (!latest || at > latest) ? at : latest;
  }, null);
  // Only the redesigned table narrows by the views strip; the classic screen lists every monitor.
  const shownMonitors = redesign && view !== "all" ? services.filter(s => monitorState(s) === view) : services;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader variant="section" title="Uptime Monitors (website / SSL / DNS)" />

      {/*
        What the page is for, before the controls. Each kind is described by the failure it catches
        rather than by what it fetches, because that is the part nobody can guess from the dropdown.
      */}
      <div className="max-w-3xl space-y-2.5 text-sm text-gray-400 leading-relaxed">
        <p>
          A monitor watches one target on the same poll as Service Alerts — every five minutes by default — and
          reports what it finds as one of that service's sources. It therefore behaves like any other source: the
          service appears on the Service Alerts board, a failure opens an active alert, two consecutive clean polls
          retire it, and it notifies through whatever the Alerting Mechanism is already set to.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-gray-200">Website</strong> — fetches the address and compares the status code
            with the one you expect, 200 unless you say otherwise. Anything else is an outage: a 500, a redirect you
            did not allow for, or a target that never answers.
          </li>
          <li>
            <strong className="text-gray-200">SSL expiry</strong> — reads the certificate the host presents. It
            raises a notice the chosen number of days before the expiry date, 30 unless you say otherwise, so the
            renewal can be booked, and an outage once the certificate has actually expired.
          </li>
          <li>
            <strong className="text-gray-200">DNS</strong> — resolves the hostname. If the name stops resolving
            that is an outage, and it is usually the reason a site is down for everyone except the person testing it.
          </li>
        </ul>
        <p>
          <strong className="text-gray-200">Example.</strong> A client portal at{" "}
          <code className="text-cyber-300">portal.client.com</code> goes dark in three ways, so it takes three
          monitors:
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Kind</th>
              <th className="py-1.5 pr-3 font-medium">Target</th>
              <th className="py-1.5 font-medium">What it catches</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {[
              ["Client portal", "Website", "https://portal.client.com", "the portal answering with an error page"],
              ["Portal certificate", "SSL expiry", "https://portal.client.com", "a certificate that expires over a weekend"],
              ["Portal mail", "DNS", "https://mail.client.com", "mail stopping because the name no longer resolves"],
            ].map(([exampleName, exampleKind, exampleTarget, catches]) => (
              <tr key={exampleName}>
                <td className="py-1.5 pr-3 text-gray-300">{exampleName}</td>
                <td className="py-1.5 pr-3 text-gray-500">{exampleKind}</td>
                <td className="py-1.5 pr-3 text-gray-200">{exampleTarget}</td>
                <td className="py-1.5 text-gray-500">{catches}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500">
          Nothing is checked until <strong className="text-gray-300">Uptime monitors</strong> is switched on under
          Administration → Configuration → Service Alerts &amp; Monitoring. Targets have to be reachable from the
          internet — a private or link-local address is refused, with the reason written on the alert. The certificate
          and DNS checks use the host in the address, so a path on the end is ignored. Full walkthrough in{" "}
          <Link to="/help/walkthroughs/uptime-monitors" className="text-cyber-300 hover:text-cyber-200">Help → Uptime Monitors</Link>.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="input-field w-auto" />
        <select value={kind} onChange={e => setKind(e.target.value)} className="input-field w-auto">
          <option value="website">Website</option>
          <option value="ssl">SSL expiry</option>
          <option value="dns">DNS</option>
        </select>
        <input placeholder="https://target" value={url} onChange={e => setUrl(e.target.value)} className="input-field w-auto min-w-[240px]" />
        {kind === "website" && <input placeholder="Expect status" value={expectStatus} onChange={e => setExpectStatus(e.target.value)} className="input-field w-28" />}
        {kind === "ssl" && <input placeholder="Warn days" value={sslWarnDays} onChange={e => setSslWarnDays(e.target.value)} className="input-field w-28" />}
        <button onClick={create} className="btn-primary text-sm">Add monitor</button>
      </div>
      {message && <p className="text-sm text-cyber-300">{message}</p>}
      {redesign && services.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews
            views={[
              { id: "all", label: "All", count: services.length },
              { id: "up", label: "Up", count: counts.up },
              { id: "warning", label: "Warning", count: counts.warning },
              { id: "down", label: "Down", count: counts.down },
            ]}
            value={view}
            onChange={setView}
            label="Monitor state"
          />
          <span className="ml-auto text-xs text-gray-500 tabular-nums">
            {services.length} monitor{services.length === 1 ? "" : "s"} · {counts.up} up · {counts.warning} warning · {counts.down} down
            {services.length > withReading ? ` · ${services.length - withReading} without a reading` : ""}
            {lastRead ? <> · last checked {new Date(lastRead).toLocaleTimeString()}</> : null}
          </span>
        </div>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium">Target</th>{redesign && <th className="px-3 py-2 font-medium">State</th>}<th className="px-3 py-2 font-medium">Enabled</th></tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {shownMonitors.map(s => (
              <tr key={s.id}>
                <td className="px-3 py-2 text-gray-200">{s.name}</td>
                <td className="px-3 py-2 text-gray-400">{s.monitorKind}</td>
                <td className="px-3 py-2 text-gray-400">{s.monitorUrl}</td>
                {redesign && <td className="px-3 py-2"><MonitorStateChip service={s} /></td>}
                <td className="px-3 py-2 text-gray-400">{s.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
            {shownMonitors.length === 0 && <tr><td colSpan={redesign ? 5 : 4} className="px-3 py-8 text-center text-gray-500">{redesign && services.length > 0 ? "Nothing in this view." : "No uptime monitors yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
