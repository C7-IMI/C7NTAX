import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Send, DollarSign, FileText } from "lucide-react";
import { InvoiceStatus } from "@c7-overwatch/shared";

interface Invoice { id: string; invoiceNumber: string; company: { name: string }; total: number; status: string; issueDate: string; dueDate: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600/20 text-gray-400", sent: "bg-blue-600/20 text-blue-400", partial: "bg-amber-600/20 text-amber-400",
  paid: "bg-green-600/20 text-green-400", overdue: "bg-red-600/20 text-red-400", void: "bg-gray-600/20 text-gray-500",
};

export function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({ companyId: "" });

  const fetchInvoices = async () => {
    try {
      const res = await api.get("/billing/invoices");
      setInvoices(res.data.data);
    } catch { toast.error("Failed to load invoices"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchInvoices(); }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/billing/invoices/generate", genForm);
      toast.success("Invoice generated");
      setShowGenerate(false);
      fetchInvoices();
    } catch { toast.error("Failed to generate invoice"); }
  };

  const handleSend = async (id: string) => {
    try {
      await api.post(`/billing/invoices/${id}/send`);
      toast.success("Invoice sent");
      fetchInvoices();
    } catch { toast.error("Failed to send invoice"); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading invoices...</div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-400">{invoices.length} invoices</p>
        </div>
        <button onClick={() => setShowGenerate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Generate Invoice</button>
      </div>

      {showGenerate && (
        <div className="card">
          <form onSubmit={handleGenerate} className="space-y-3">
            <input className="input-field" placeholder="Company ID" value={genForm.companyId} onChange={(e) => setGenForm({ companyId: e.target.value })} required />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">Generate</button>
              <button type="button" onClick={() => setShowGenerate(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="text-center py-12 card">
          <DollarSign size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No invoices yet</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="p-3">Invoice</th><th className="p-3">Client</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3">Due</th><th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 transition-colors">
                    <td className="p-3 font-medium text-white">{inv.invoiceNumber}</td>
                    <td className="p-3 text-gray-300">{inv.company?.name}</td>
                    <td className="p-3">${inv.total.toFixed(2)}</td>
                    <td className="p-3"><span className={`badge ${STATUS_COLORS[inv.status] || ""}`}>{inv.status}</span></td>
                    <td className="p-3 text-gray-400">{new Date(inv.dueDate).toLocaleDateString()}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-1.5 text-gray-500 hover:text-white transition-colors" title="View"><FileText size={15} /></button>
                        {inv.status === "draft" && (
                          <button onClick={() => handleSend(inv.id)} className="p-1.5 text-cyber-400 hover:text-cyber-300 transition-colors" title="Send"><Send size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
