import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { PageHeader } from "../components/ui";

type MonitorService = { id: string; name: string; monitorKind: string; monitorUrl: string | null; monitorConfig: { expectStatus?: number; sslWarnDays?: number } | null; enabled: boolean };

export function MonitorsPage() {
  const [services, setServices] = useState<MonitorService[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("website");
  const [url, setUrl] = useState("");
  const [sslWarnDays, setSslWarnDays] = useState("30");
  const [expectStatus, setExpectStatus] = useState("200");
  const [message, setMessage] = useState("");

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
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium">Target</th><th className="px-3 py-2 font-medium">Enabled</th></tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {services.map(s => (
              <tr key={s.id}>
                <td className="px-3 py-2 text-gray-200">{s.name}</td>
                <td className="px-3 py-2 text-gray-400">{s.monitorKind}</td>
                <td className="px-3 py-2 text-gray-400">{s.monitorUrl}</td>
                <td className="px-3 py-2 text-gray-400">{s.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
            {services.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500">No uptime monitors yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
