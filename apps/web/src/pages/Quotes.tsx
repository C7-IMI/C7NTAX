import { useEffect, useState } from "react";
import api from "../api";
import { ProductPicker } from "../components/ProductPicker";
import { PageHeader } from "../components/ui";

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
  const [productId, setProductId] = useState<string | null>(null);
  const [productSku, setProductSku] = useState<string | null>(null);
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
        lineItems: [{ description, quantity: Number(quantity) || 1, unitPrice: Number(unitPrice) || 0, ...(productId ? { productId } : {}) }],
      });
      setTitle(""); setDescription(""); setProductId(null); setProductSku(null); setMessage("Quote created");
      load();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Create failed"); }
  };

  const convert = async (id: string) => {
    try { await api.post(`/quotes/${id}/convert`); setMessage("Converted to draft invoice"); load(); }
    catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Convert failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader variant="section" title="Quotes" />
      <div className="flex flex-wrap items-center gap-2">
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className="input-field w-auto" />
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input-field w-auto">
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="w-[280px]">
          <ProductPicker
            value={description}
            onValueChange={text => { setDescription(text); setProductId(null); setProductSku(null); }}
            onPick={p => { setDescription(p.name); setProductId(p.id); setProductSku(p.sku); setUnitPrice(String(p.sellPrice)); }}
            pickedSku={productSku}
            priceBasis="sell"
            placeholder="Line description or catalog item"
          />
        </div>
        <input placeholder="Qty" value={quantity} onChange={e => setQuantity(e.target.value)} className="input-field w-20" />
        <input placeholder="Rate" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} className="input-field w-24" />
        <button onClick={create} className="btn-primary text-sm">Create quote</button>
      </div>
      {message && <p className="text-sm text-cyber-300">{message}</p>}
      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Number</th><th className="px-3 py-2 font-medium">Title</th><th className="px-3 py-2 font-medium">Client</th><th className="px-3 py-2 font-medium">Total</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {quotes.map(q => (
                <tr key={q.id}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{q.quoteNumber}</td>
                  <td className="px-3 py-2 text-gray-200">{q.title}</td>
                  <td className="px-3 py-2 text-gray-400">{q.company?.name || "—"}</td>
                  <td className="px-3 py-2 text-gray-200">${q.total.toFixed(2)}</td>
                  <td className="px-3 py-2 text-gray-400">{q.status}</td>
                  <td className="px-3 py-2">{q.status !== "converted" && <button onClick={() => convert(q.id)} className="btn-secondary text-xs">Convert to invoice</button>}</td>
                </tr>
              ))}
              {quotes.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No quotes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
