import { useEffect, useState } from "react";
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
