import { useEffect, useState } from "react";
import api from "../api";

type Webhook = { id: string; name: string; url: string; events: string[]; isActive: boolean };
type Delivery = { id: string; event: string; status: string; attempts: number; createdAt: string };

export function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const load = () => {
    api.get("/alert-webhooks").then(r => setWebhooks(r.data.data || [])).catch(() => {});
    api.get("/alert-webhooks/deliveries").then(r => setDeliveries(r.data.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!url) { setMessage("URL required"); return; }
    try {
      await api.post("/alert-webhooks", { url, name: name || undefined, events: ["alert.opened", "alert.resolved"] });
      setUrl(""); setName(""); setMessage("Webhook registered");
      load();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Create failed"); }
  };

  const remove = async (id: string) => {
    try { await api.delete(`/alert-webhooks/${id}`); load(); } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div style={{ padding: 24, color: "#cbd5e1" }}>
      <h1 style={{ color: "#e2e8f0", fontSize: 22 }}>Alert Webhooks</h1>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <input placeholder="https://endpoint" value={url} onChange={e => setUrl(e.target.value)} style={{ minWidth: 280, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <button onClick={create} style={{ padding: "8px 16px", background: "#2563eb", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Register</button>
      </div>
      {message && <p style={{ color: "#93c5fd" }}>{message}</p>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", color: "#94a3b8" }}><th>Name</th><th>URL</th><th>Events</th><th></th></tr></thead>
        <tbody>
          {webhooks.map(w => (
            <tr key={w.id} style={{ borderTop: "1px solid #1e293b" }}>
              <td>{w.name}</td><td>{w.url}</td><td>{(w.events || []).join(", ")}</td>
              <td><button onClick={() => remove(w.id)} style={{ padding: "4px 10px", background: "#b91c1c", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Remove</button></td>
            </tr>
          ))}
          {webhooks.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: "#64748b" }}>No webhooks registered.</td></tr>}
        </tbody>
      </table>
      <h2 style={{ color: "#e2e8f0", fontSize: 16, marginTop: 24 }}>Recent deliveries</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ textAlign: "left", color: "#94a3b8" }}><th>Event</th><th>Status</th><th>Attempts</th><th>At</th></tr></thead>
        <tbody>
          {deliveries.map(d => (
            <tr key={d.id} style={{ borderTop: "1px solid #1e293b" }}>
              <td>{d.event}</td><td>{d.status}</td><td>{d.attempts}</td><td>{new Date(d.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {deliveries.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: "#64748b" }}>No deliveries yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
