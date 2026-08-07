import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Send, DollarSign, CreditCard, Eye } from "lucide-react";

interface Invoice { id: string; invoiceNumber: string; company: { name: string }|null; total: number; status: string; issueDate: string; dueDate: string; lineItems?: Array<{description:string;quantity:number;unitPrice:number;total:number}>; }
interface Company { id: string; name: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600/20 text-gray-400", sent: "bg-blue-600/20 text-blue-400", partial: "bg-amber-600/20 text-amber-400",
  paid: "bg-green-600/20 text-green-400", overdue: "bg-red-600/20 text-red-400", void: "bg-gray-600/20 text-gray-500",
};

export function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({ companyId: "", agreementId: "" });
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ invoiceId: "", amount: 0, method: "other", reference: "" });
  const [showPay, setShowPay] = useState(false);

  const fetchInvoices = () => {
    api.get("/billing/invoices").then(r => setInvoices(r.data.data || []))
      .catch(() => toast.error("Failed to load invoices"))
      .finally(() => setLoading(false));
  };
  const fetchCompanies = () => {
    api.get("/clients?limit=50").then(r => setCompanies(r.data.data || [])).catch(() => {});
  };
  useEffect(() => { fetchInvoices(); fetchCompanies(); }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/billing/invoices/generate", genForm);
      toast.success("Invoice generated");
      setShowGenerate(false); setGenForm({ companyId: "", agreementId: "" });
      fetchInvoices();
    } catch { toast.error("Failed to generate invoice"); }
  };

  const handleSend = async (id: string) => {
    try { await api.post(`/billing/invoices/${id}/send`); toast.success("Invoice sent"); fetchInvoices(); }
    catch { toast.error("Failed"); }
  };

  const handleView = (inv: Invoice) => setViewInvoice(inv);
  const openPay = (inv: Invoice) => {
    setPayForm({ invoiceId: inv.id, amount: inv.total, method: "other", reference: "" });
    setShowPay(true);
  };
  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/billing/invoices/${payForm.invoiceId}/record-payment`, payForm);
      toast.success("Payment recorded");
      setShowPay(false); setViewInvoice(null);
      fetchInvoices();
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Billing</h2><p className="text-sm text-gray-400">{invoices.length} invoices</p></div>
        <button onClick={() => setShowGenerate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Generate Invoice</button>
      </div>

      {/* Generate Form */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowGenerate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleGenerate}>
            <h3 className="text-lg font-semibold text-white">Generate Invoice</h3>
            <p className="text-xs text-gray-400">Creates an invoice from unbilled time entries for the selected client.</p>
            <select className="input-field" value={genForm.companyId} onChange={e => setGenForm({...genForm, companyId: e.target.value})} required>
              <option value="">Select a client...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Generate</button><button type="button" onClick={() => setShowGenerate(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </div>
      )}

      {/* Invoice Table */}
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : invoices.length === 0 ? (
        <div className="text-center py-12 card"><DollarSign size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No invoices yet</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Invoice</th><th className="p-3">Client</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Due</th><th className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{invoices.map(inv => (
            <tr key={inv.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
              <td className="p-3 font-medium text-white">{inv.invoiceNumber}</td><td className="p-3 text-gray-300">{inv.company?.name || "—"}</td>
              <td className="p-3">${inv.total.toFixed(2)}</td>
              <td className="p-3"><span className={`badge ${STATUS_COLORS[inv.status]||""}`}>{inv.status}</span></td>
              <td className="p-3 text-gray-400">{new Date(inv.dueDate).toLocaleDateString()}</td>
              <td className="p-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => handleView(inv)} className="p-1.5 text-gray-400 hover:text-white transition-colors" title="View"><Eye size={15} /></button>
                  {inv.status === "draft" && <button onClick={() => handleSend(inv.id)} className="p-1.5 text-cyber-400 hover:text-cyber-300 transition-colors" title="Send"><Send size={15} /></button>}
                  {(inv.status === "sent" || inv.status === "partial" || inv.status === "overdue") && <button onClick={() => openPay(inv)} className="p-1.5 text-green-400 hover:text-green-300 transition-colors" title="Record Payment"><CreditCard size={15} /></button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {/* View Invoice Modal */}
      {viewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setViewInvoice(null)}>
          <div className="card w-full max-w-lg mx-4 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">{viewInvoice.invoiceNumber}</h3><button onClick={() => setViewInvoice(null)} className="text-gray-500 hover:text-white">✕</button></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Client</p><p className="text-white">{viewInvoice.company?.name || "—"}</p></div>
              <div><p className="text-gray-500">Status</p><span className={`badge ${STATUS_COLORS[viewInvoice.status]||""}`}>{viewInvoice.status}</span></div>
              <div><p className="text-gray-500">Issued</p><p className="text-white">{new Date(viewInvoice.issueDate).toLocaleDateString()}</p></div>
              <div><p className="text-gray-500">Due</p><p className="text-white">{new Date(viewInvoice.dueDate).toLocaleDateString()}</p></div>
              <div><p className="text-gray-500">Total</p><p className="text-white font-bold text-lg">${viewInvoice.total.toFixed(2)}</p></div>
            </div>
            {viewInvoice.lineItems && viewInvoice.lineItems.length > 0 && (
              <div><h4 className="text-sm font-semibold text-gray-400 mb-2">Line Items</h4>
                <div className="space-y-1">{(viewInvoice.lineItems||[]).map((li,i) => (
                  <div key={i} className="flex justify-between text-sm bg-surface-lighter rounded px-3 py-2"><span className="text-gray-300">{li.description}</span><span className="text-white">${li.total.toFixed(2)}</span></div>
                ))}</div>
              </div>
            )}
            {(viewInvoice.status === "sent"||viewInvoice.status==="partial"||viewInvoice.status==="overdue") && (
              <button onClick={() => openPay(viewInvoice)} className="btn-primary w-full flex items-center justify-center gap-2"><CreditCard size={15} />Record Payment</button>
            )}
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowPay(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handlePay}>
            <h3 className="text-lg font-semibold text-white">Record Payment</h3>
            <div><label className="text-xs text-gray-500">Amount</label><input className="input-field" type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: Number(e.target.value)})} required /></div>
            <div><label className="text-xs text-gray-500">Method</label><select className="input-field" value={payForm.method} onChange={e => setPayForm({...payForm, method: e.target.value})}><option value="credit_card">Credit Card</option><option value="ach">ACH</option><option value="check">Check</option><option value="wire">Wire</option><option value="other">Other</option></select></div>
            <div><label className="text-xs text-gray-500">Reference #</label><input className="input-field" value={payForm.reference} onChange={e => setPayForm({...payForm, reference: e.target.value})} placeholder="Transaction ID" /></div>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Record</button><button type="button" onClick={() => setShowPay(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
