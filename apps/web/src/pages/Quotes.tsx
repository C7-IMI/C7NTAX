import { useEffect, useState } from "react";
import api from "../api";

type Quote = { id: string; quoteNumber: string; title: string; status: string; total: number; company: { id: string; name: string } | null };
type Client = { id: string; name: string };

export function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("150");
  const [message, setMessage] = useState("");

  const load = () => {
    setLoading(true);
    api.get("/quotes").then(r => setQuotes(r.data.data || [])).catch(() => setQuotes([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); api.get("/clients?limit=200").then(r => setClients(r.data.data || [])).catch(() => {}); }, []);

  const create = async () => {
    if (!title || !companyId || !description) { setMessage("Title, client, and description required"); return; }
    try {
      await api.post("/quotes", {
        companyId, title,
        lineItems: [{ description, quantity: Number(quantity) || 1, unitPrice: Number(unitPrice) || 0 }],
      });
      setTitle(""); setDescription(""); setMessage("Quote created");
      load();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Create failed"); }
  };

  const convert = async (id: string) => {
    try { await api.post(`/quotes/${id}/convert`); setMessage("Converted to draft invoice"); load(); }
    catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Convert failed"); }
  };

  return (
    <div style={{ padding: 24, color: "#cbd5e1" }}>
      <h1 style={{ color: "#e2e8f0", fontSize: 22 }}>Quotes</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }}>
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Line description" value={description} onChange={e => setDescription(e.target.value)} style={{ padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <input placeholder="Qty" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: 70, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <input placeholder="Rate" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} style={{ width: 90, padding: 8, background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6 }} />
        <button onClick={create} style={{ padding: "8px 16px", background: "#2563eb", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Create quote</button>
      </div>
      {message && <p style={{ color: "#93c5fd" }}>{message}</p>}
      {loading ? <p>Loading…</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ textAlign: "left", color: "#94a3b8" }}>
            <th>Number</th><th>Title</th><th>Client</th><th>Total</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {quotes.map(q => (
              <tr key={q.id} style={{ borderTop: "1px solid #1e293b" }}>
                <td>{q.quoteNumber}</td>
                <td>{q.title}</td>
                <td>{q.company?.name || "—"}</td>
                <td>${q.total.toFixed(2)}</td>
                <td>{q.status}</td>
                <td>{q.status !== "converted" && <button onClick={() => convert(q.id)} style={{ padding: "4px 10px", background: "#0ea5e9", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Convert to invoice</button>}</td>
              </tr>
            ))}
            {quotes.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: "#64748b" }}>No quotes yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
