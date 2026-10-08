import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";

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
    <div style={{ padding: 24, color: "#cbd5e1" }}>
      <h1 style={{ color: "#e2e8f0", fontSize: 22 }}>Uptime Monitors (website / SSL / DNS)</h1>

      {/*
        What the page is for, before the controls. Each kind is described by the failure it catches
        rather than by what it fetches, because that is the part nobody can guess from the dropdown.
      */}
      <div style={{ maxWidth: 820, margin: "10px 0 4px", lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 10px" }}>
          A monitor watches one target on the same poll as Service Alerts — every five minutes by default — and
          reports what it finds as one of that service's sources. It therefore behaves like any other source: the
          service appears on the Service Alerts board, a failure opens an active alert, two consecutive clean polls
          retire it, and it notifies through whatever the Alerting Mechanism is already set to.
        </p>
        <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}>
            <strong style={{ color: "#e2e8f0" }}>Website</strong> — fetches the address and compares the status code
            with the one you expect, 200 unless you say otherwise. Anything else is an outage: a 500, a redirect you
            did not allow for, or a target that never answers.
          </li>
          <li style={{ marginBottom: 5 }}>
            <strong style={{ color: "#e2e8f0" }}>SSL expiry</strong> — reads the certificate the host presents. It
            raises a notice the chosen number of days before the expiry date, 30 unless you say otherwise, so the
            renewal can be booked, and an outage once the certificate has actually expired.
          </li>
          <li>
            <strong style={{ color: "#e2e8f0" }}>DNS</strong> — resolves the hostname. If the name stops resolving
            that is an outage, and it is usually the reason a site is down for everyone except the person testing it.
          </li>
        </ul>
        <p style={{ margin: "0 0 8px" }}>
          <strong style={{ color: "#e2e8f0" }}>Example.</strong> A client portal at{" "}
          <code style={{ color: "#93c5fd" }}>portal.client.com</code> goes dark in three ways, so it takes three
          monitors:
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th style={{ padding: "4px 12px 4px 0" }}>Name</th>
              <th style={{ padding: "4px 12px 4px 0" }}>Kind</th>
              <th style={{ padding: "4px 12px 4px 0" }}>Target</th>
              <th style={{ padding: "4px 0" }}>What it catches</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Client portal", "Website", "https://portal.client.com", "the portal answering with an error page"],
              ["Portal certificate", "SSL expiry", "https://portal.client.com", "a certificate that expires over a weekend"],
              ["Portal mail", "DNS", "https://mail.client.com", "mail stopping because the name no longer resolves"],
            ].map(([exampleName, exampleKind, exampleTarget, catches]) => (
              <tr key={exampleName} style={{ borderTop: "1px solid #1e293b" }}>
                <td style={{ padding: "6px 12px 6px 0", color: "#cbd5e1" }}>{exampleName}</td>
                <td style={{ padding: "6px 12px 6px 0", color: "#94a3b8" }}>{exampleKind}</td>
                <td style={{ padding: "6px 12px 6px 0", color: "#e2e8f0" }}>{exampleTarget}</td>
                <td style={{ padding: "6px 0", color: "#94a3b8" }}>{catches}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
          Nothing is checked until <strong style={{ color: "#cbd5e1" }}>Uptime monitors</strong> is switched on under
          Administration → Configuration → Service Alerts &amp; Monitoring. Targets have to be reachable from the
          internet — a private or link-local address is refused, with the reason written on the alert. The certificate
          and DNS checks use the host in the address, so a path on the end is ignored. Full walkthrough in{" "}
          <Link to="/help/walkthroughs/uptime-monitors" style={{ color: "#93c5fd" }}>Help → Uptime Monitors</Link>.
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <select value={kind} onChange={e => setKind(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }}>
          <option value="website">Website</option>
          <option value="ssl">SSL expiry</option>
          <option value="dns">DNS</option>
        </select>
        <input placeholder="https://target" value={url} onChange={e => setUrl(e.target.value)} style={{ minWidth: 240, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        {kind === "website" && <input placeholder="Expect status" value={expectStatus} onChange={e => setExpectStatus(e.target.value)} style={{ width: 110, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />}
        {kind === "ssl" && <input placeholder="Warn days" value={sslWarnDays} onChange={e => setSslWarnDays(e.target.value)} style={{ width: 100, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />}
        <button onClick={create} style={{ padding: "8px 16px", background: "#2563eb", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Add monitor</button>
      </div>
      {message && <p style={{ color: "#93c5fd" }}>{message}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", color: "#94a3b8" }}><th>Name</th><th>Kind</th><th>Target</th><th>Enabled</th></tr></thead>
        <tbody>
          {services.map(s => (
            <tr key={s.id} style={{ borderTop: "1px solid #1e293b" }}>
              <td>{s.name}</td><td>{s.monitorKind}</td><td>{s.monitorUrl}</td><td>{s.enabled ? "yes" : "no"}</td>
            </tr>
          ))}
          {services.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: "#64748b" }}>No uptime monitors yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
