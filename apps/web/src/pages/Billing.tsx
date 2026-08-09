import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Send, DollarSign, CreditCard, Eye, FileText, Clock, Calendar,
  TrendingUp, Download, Receipt, Building2, AlertTriangle, CheckCircle,
  XCircle, RotateCw, ClipboardList, BarChart3, Timer, Filter,
  type LucideIcon,
} from "lucide-react";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";

// Types
interface Invoice { id: string; invoiceNumber: string; company: { name?: string; id?: string } | null; total: number; subtotal?: number; status: string; issueDate: string; dueDate: string; sentAt?: string; paidAt?: string; lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; payments?: Array<{ amount: number; method: string; processedAt: string; reference?: string }>; }
interface Agreement { id: string; name: string; description?: string; company: { name?: string } | null; billingPeriod: string; billingAmount: number; startDate: string; endDate?: string; isActive: boolean; autoInvoiceEnabled: boolean; followUpEnabled: boolean; _count?: { invoices: number } }
interface Payment { id: string; amount: number; method: string; reference?: string; processedAt: string; invoice: { invoiceNumber: string; company: { name?: string } | null } }
interface TimeEntry { id: string; description?: string; minutes: number; billable: boolean; date: string; ticket: { ticketNumber: string; company?: { name?: string } | null } | null; invoiceId?: string; }
interface Company { id: string; name: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600/20 text-gray-400", sent: "bg-blue-600/20 text-blue-400",
  partial: "bg-amber-600/20 text-amber-400", paid: "bg-green-600/20 text-green-400",
  overdue: "bg-red-600/20 text-red-400", void: "bg-gray-600/20 text-gray-500",
};
const PERIOD_COLORS: Record<string, string> = {
  monthly: "bg-blue-600/20 text-blue-400", quarterly: "bg-purple-600/20 text-purple-400",
  annual: "bg-cyber-600/20 text-cyber-400", weekly: "bg-amber-600/20 text-amber-400",
};

const TABS = [
  { id: "invoices", label: "Invoices", icon: Receipt },
  { id: "agreements", label: "Agreements", icon: ClipboardList },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "time", label: "Time & Expenses", icon: Timer },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

export function BillingPage({ tab: initialTab }: { tab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab || "invoices");

  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    api.get("/clients?limit=100").then(r => setCompanies(r.data.data || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Billing</h2>
          <p className="text-sm text-gray-400">Invoicing, agreements, payments, and time tracking</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 border-b border-surface-border pb-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-surface border border-b-0 border-surface-border text-cyber-400"
                  : "text-gray-400 hover:text-white hover:bg-surface-lighter/50"
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "invoices" && <InvoicesTab companies={companies} />}
      {activeTab === "agreements" && <AgreementsTab companies={companies} />}
      {activeTab === "payments" && <PaymentsTab />}
      {activeTab === "time" && <TimeExpensesTab />}
      {activeTab === "reports" && <ReportsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  INVOICES TAB
// ═══════════════════════════════════════════════════════════════════

function InvoicesTab({ companies }: { companies: Company[] }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({ companyId: "", agreementId: "" });
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ invoiceId: "", amount: 0, method: "other", reference: "" });
  const [showPay, setShowPay] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  const fetchInvoices = () => {
    let url = "/billing/invoices?limit=100";
    if (statusFilter) url += `&status=${statusFilter}`;
    api.get(url).then(r => setInvoices(r.data.data || [])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => { setLoading(true); fetchInvoices(); }, [statusFilter]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/billing/invoices/generate", genForm); toast.success("Generated"); setShowGenerate(false); setGenForm({ companyId: "", agreementId: "" }); fetchInvoices(); }
    catch { toast.error("Failed"); }
  };
  const handleSend = async (id: string) => {
    try { await api.post(`/billing/invoices/${id}/send`); toast.success("Sent"); fetchInvoices(); } catch { toast.error("Failed"); }
  };
  const handleInvoicePdf = (inv: Invoice) => {
    const token = localStorage.getItem("c7_token");
    window.open(`/api/billing/invoices/${inv.id}/pdf?token=${token}`, "_blank");
  };
  const openPay = (inv: Invoice) => {
    setPayForm({ invoiceId: inv.id, amount: inv.total, method: "other", reference: "" });
    setShowPay(true);
  };
  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post(`/billing/invoices/${payForm.invoiceId}/record-payment`, payForm); toast.success("Paid"); setShowPay(false); setViewInvoice(null); fetchInvoices(); }
    catch { toast.error("Failed"); }
  };

  const totals = invoices.reduce((s, i) => {
    s.count++; s.total += i.total;
    if (i.status === "paid") s.paid += i.total;
    else if (i.status === "overdue") s.overdue += i.total;
    else if (i.status === "sent" || i.status === "partial") s.outstanding += i.total;
    return s;
  }, { count: 0, total: 0, paid: 0, overdue: 0, outstanding: 0 });

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Receipt} label="Total Invoiced" value={`$${totals.total.toLocaleString()}`} color="text-cyber-400" />
        <SummaryCard icon={CheckCircle} label="Paid" value={`$${totals.paid.toLocaleString()}`} color="text-green-400" />
        <SummaryCard icon={Clock} label="Outstanding" value={`$${totals.outstanding.toLocaleString()}`} color="text-amber-400" />
        <SummaryCard icon={AlertTriangle} label="Overdue" value={`$${totals.overdue.toLocaleString()}`} color="text-red-400" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input-field text-sm py-1.5 w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option><option value="sent">Sent</option><option value="partial">Partial</option>
          <option value="paid">Paid</option><option value="overdue">Overdue</option><option value="void">Void</option>
        </select>
        <button onClick={() => setShowGenerate(true)} className="btn-primary flex items-center gap-2 text-sm ml-auto"><Plus size={16} />Generate Invoice</button>
      </div>

      {/* Invoice Table */}
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : invoices.length === 0 ? (
        <div className="text-center py-12 card"><Receipt size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No invoices</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="group"><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase tracking-wider"><SortableHeader field="invoiceNumber" label="Invoice" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3" /><SortableHeader field="company.name" label="Client" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3 hidden sm:table-cell" /><SortableHeader field="total" label="Amount" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3" /><SortableHeader field="issueDate" label="Issued" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3 hidden md:table-cell" /><SortableHeader field="dueDate" label="Due" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3 hidden md:table-cell" /><SortableHeader field="status" label="Status" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="p-3" /><th className="p-3 text-right">Actions</th></tr></thead>
          <tbody>{sortData(invoices, sort?.field || "dueDate", sort?.direction || "desc").map(inv => (
            <tr key={inv.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 cursor-pointer" onDoubleClick={() => handleInvoicePdf(inv)} onClick={() => setViewInvoice(inv)}>
              <td className="p-3 font-medium text-white">{inv.invoiceNumber}</td>
              <td className="p-3 text-gray-300 hidden sm:table-cell">{inv.company?.name || "—"}</td>
              <td className="p-3">${inv.total.toFixed(2)}</td>
              <td className="p-3 text-gray-400 hidden md:table-cell">{new Date(inv.issueDate).toLocaleDateString()}</td>
              <td className="p-3 text-gray-400 hidden md:table-cell">{new Date(inv.dueDate).toLocaleDateString()}</td>
              <td className="p-3"><span className={`badge ${STATUS_COLORS[inv.status] || ""}`}>{inv.status}</span></td>
              <td className="p-3 text-right">
                <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleInvoicePdf(inv)} className="p-1.5 text-gray-400 hover:text-cyber-400" title="PDF"><FileText size={15} /></button>
                  {inv.status === "draft" && <button onClick={() => handleSend(inv.id)} className="p-1.5 text-blue-400 hover:text-blue-300" title="Send"><Send size={15} /></button>}
                  {["sent","partial","overdue"].includes(inv.status) && <button onClick={() => openPay(inv)} className="p-1.5 text-green-400 hover:text-green-300" title="Pay"><CreditCard size={15} /></button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {/* Generate Modal */}
      {showGenerate && (
        <Modal onClose={() => setShowGenerate(false)}>
          <form onSubmit={handleGenerate} className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Generate Invoice</h3>
            <p className="text-xs text-gray-400">Creates an invoice from unbilled time entries for the selected client.</p>
            <select className="input-field" value={genForm.companyId} onChange={e => setGenForm({...genForm, companyId: e.target.value})} required>
              <option value="">Select client...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Generate</button><button type="button" onClick={() => setShowGenerate(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </Modal>
      )}

      {/* View Invoice Modal */}
      {viewInvoice && (
        <Modal onClose={() => setViewInvoice(null)}>
          <div className="space-y-4">
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">{viewInvoice.invoiceNumber}</h3>
              <div className="flex items-center gap-2"><button onClick={() => handleInvoicePdf(viewInvoice)} className="btn-secondary text-xs flex items-center gap-1.5"><FileText size={14}/>PDF</button><button onClick={() => setViewInvoice(null)} className="text-gray-500 hover:text-white">✕</button></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-gray-500">Client</p><p className="text-white">{viewInvoice.company?.name || "—"}</p></div>
              <div><p className="text-gray-500">Status</p><span className={`badge ${STATUS_COLORS[viewInvoice.status] || ""}`}>{viewInvoice.status}</span></div>
              <div><p className="text-gray-500">Issued</p><p className="text-white">{new Date(viewInvoice.issueDate).toLocaleDateString()}</p></div>
              <div><p className="text-gray-500">Due</p><p className="text-white">{new Date(viewInvoice.dueDate).toLocaleDateString()}</p></div>
              <div><p className="text-gray-500">Total</p><p className="text-white font-bold text-lg">${viewInvoice.total.toFixed(2)}</p></div>
              {viewInvoice.subtotal !== undefined && <div><p className="text-gray-500">Subtotal</p><p className="text-white">${viewInvoice.subtotal.toFixed(2)}</p></div>}
            </div>
            {viewInvoice.lineItems && viewInvoice.lineItems.length > 0 && (
              <div><h4 className="text-sm font-semibold text-gray-400 mb-2">Line Items</h4>
                <div className="space-y-1">{(viewInvoice.lineItems || []).map((li, i) => (
                  <div key={i} className="flex justify-between text-sm bg-surface-lighter rounded px-3 py-2"><span className="text-gray-300">{li.description}</span><span className="text-white">${li.total.toFixed(2)}</span></div>
                ))}</div>
              </div>
            )}
            {["sent","partial","overdue"].includes(viewInvoice.status) && (
              <button onClick={() => openPay(viewInvoice)} className="btn-primary w-full flex items-center justify-center gap-2"><CreditCard size={15} />Record Payment</button>
            )}
          </div>
        </Modal>
      )}

      {/* Pay Modal */}
      {showPay && (
        <Modal onClose={() => setShowPay(false)}>
          <form onSubmit={handlePay} className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Record Payment</h3>
            <div><label className="text-xs text-gray-500">Amount</label><input className="input-field" type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: Number(e.target.value)})} required /></div>
            <div><label className="text-xs text-gray-500">Method</label><select className="input-field" value={payForm.method} onChange={e => setPayForm({...payForm, method: e.target.value})}><option value="credit_card">Credit Card</option><option value="ach">ACH</option><option value="check">Check</option><option value="wire">Wire</option><option value="other">Other</option></select></div>
            <div><label className="text-xs text-gray-500">Reference</label><input className="input-field" value={payForm.reference} onChange={e => setPayForm({...payForm, reference: e.target.value})} placeholder="Transaction ID" /></div>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Record</button><button type="button" onClick={() => setShowPay(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  AGREEMENTS TAB
// ═══════════════════════════════════════════════════════════════════

function AgreementsTab({ companies }: { companies: Company[] }) {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", companyId: "", description: "", billingPeriod: "monthly", price: 0, startDate: "", endDate: "", autoRenew: true });
  const [sortAg, setSortAg] = useState<SortState | null>(null);

  const fetch = () => {
    api.get("/billing/agreements").then(r => setAgreements(r.data || [])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/billing/agreements", form); toast.success("Created"); setShowCreate(false); fetch(); }
    catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{agreements.length} agreements</p>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />New Agreement</button>
      </div>

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : agreements.length === 0 ? (
        <div className="text-center py-12 card"><ClipboardList size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No service agreements</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="group"><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><SortableHeader field="name" label="Name" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3" /><SortableHeader field="company.name" label="Client" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3 hidden sm:table-cell" /><SortableHeader field="billingPeriod" label="Billing" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3" /><SortableHeader field="billingAmount" label="Amount" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3" /><SortableHeader field="startDate" label="Period" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3 hidden md:table-cell" /><SortableHeader field="isActive" label="Status" sort={sortAg} onSort={(f) => setSortAg(nextSort(sortAg, f))} className="p-3" /></tr></thead>
          <tbody>{sortData(agreements, sortAg?.field || "name", sortAg?.direction || "asc").map(a => (
            <tr key={a.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
              <td className="p-3 font-medium text-white">{a.name}</td>
              <td className="p-3 text-gray-300 hidden sm:table-cell">{a.company?.name || "—"}</td>
              <td className="p-3"><span className={`badge ${PERIOD_COLORS[a.billingPeriod] || ""}`}>{a.billingPeriod}</span></td>
              <td className="p-3">${a.billingAmount.toLocaleString()}</td>
              <td className="p-3 text-gray-400 hidden md:table-cell text-xs">{new Date(a.startDate).toLocaleDateString()}{a.endDate ? ` → ${new Date(a.endDate).toLocaleDateString()}` : " (ongoing)"}</td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${a.isActive ? "bg-green-400" : "bg-gray-600"}`} />
                  <span className="text-xs text-gray-400">{a.isActive ? "Active" : "Inactive"}</span>
                  {a.autoInvoiceEnabled && <span className="badge bg-cyber-600/20 text-cyber-400 text-[10px]">Auto</span>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            <h3 className="text-lg font-semibold text-white">New Service Agreement</h3>
            <input className="input-field" placeholder="Agreement name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            <select className="input-field" value={form.companyId} onChange={e => setForm({...form, companyId: e.target.value})} required><option value="">Select client...</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="grid grid-cols-2 gap-3">
              <select className="input-field" value={form.billingPeriod} onChange={e => setForm({...form, billingPeriod: e.target.value})}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="weekly">Weekly</option></select>
              <input className="input-field" type="number" placeholder="Amount $" value={form.price} onChange={e => setForm({...form, price: Number(e.target.value)})} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Start Date</label><input className="input-field" type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} required /></div>
              <div><label className="text-xs text-gray-500">End Date</label><input className="input-field" type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={form.autoRenew} onChange={e => setForm({...form, autoRenew: e.target.checked})} />Auto-renew</label>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS TAB
// ═══════════════════════════════════════════════════════════════════

function PaymentsTab() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [methodFilter, setMethodFilter] = useState("");
  const [sortPay, setSortPay] = useState<SortState | null>(null);

  useEffect(() => {
    api.get("/billing/invoices?limit=200").then(r => {
      const invs = r.data.data || [];
      const allPayments: Payment[] = [];
      for (const inv of invs) {
        if (inv.payments) {
          for (const p of inv.payments) {
            allPayments.push({ ...p, invoice: { invoiceNumber: inv.invoiceNumber, company: inv.company } });
          }
        }
      }
      setPayments(allPayments);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = methodFilter ? payments.filter(p => p.method === methodFilter) : payments;
  const total = filtered.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{filtered.length} payments · ${total.toLocaleString()} total</p>
        <select className="input-field text-sm py-1.5 w-auto" value={methodFilter} onChange={e => setMethodFilter(e.target.value)}>
          <option value="">All Methods</option>
          <option value="credit_card">Credit Card</option><option value="ach">ACH</option><option value="check">Check</option><option value="wire">Wire</option><option value="other">Other</option>
        </select>
      </div>

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : filtered.length === 0 ? (
        <div className="text-center py-12 card"><CreditCard size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No payments recorded</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="group"><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><SortableHeader field="invoice.invoiceNumber" label="Invoice" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3" /><SortableHeader field="invoice.company.name" label="Client" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3" /><SortableHeader field="amount" label="Amount" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3" /><SortableHeader field="method" label="Method" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3 hidden sm:table-cell" /><SortableHeader field="processedAt" label="Date" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3 hidden md:table-cell" /><SortableHeader field="reference" label="Reference" sort={sortPay} onSort={(f) => setSortPay(nextSort(sortPay, f))} className="p-3 hidden md:table-cell" /></tr></thead>
          <tbody>{sortData(filtered, sortPay?.field || "processedAt", sortPay?.direction || "desc").map((p, i) => (
            <tr key={i} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
              <td className="p-3 font-medium text-white">{p.invoice.invoiceNumber}</td>
              <td className="p-3 text-gray-300">{p.invoice.company?.name || "—"}</td>
              <td className="p-3 text-green-400">${p.amount.toFixed(2)}</td>
              <td className="p-3 hidden sm:table-cell"><span className="badge bg-surface-lighter text-gray-400 capitalize">{p.method.replace(/_/g, " ")}</span></td>
              <td className="p-3 text-gray-400 hidden md:table-cell">{new Date(p.processedAt).toLocaleDateString()}</td>
              <td className="p-3 text-gray-500 text-xs hidden md:table-cell font-mono">{p.reference || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  TIME & EXPENSES TAB
// ═══════════════════════════════════════════════════════════════════

function TimeExpensesTab() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [billableFilter, setBillableFilter] = useState<"" | "true" | "false">("");

  useEffect(() => {
    api.get("/tickets?limit=200").then(r => {
      const tickets = r.data.data || [];
      const timeEntries: TimeEntry[] = [];
      for (const t of tickets) {
        if (t.timeEntries) {
          for (const te of t.timeEntries) {
            timeEntries.push({ ...te, ticket: { ticketNumber: t.ticketNumber, company: t.company } } as TimeEntry);
          }
        }
      }
      timeEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setEntries(timeEntries);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = billableFilter ? entries.filter(e => e.billable === (billableFilter === "true")) : entries;
  const totalHours = filtered.reduce((s, e) => s + e.minutes, 0) / 60;
  const totalBillable = filtered.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0) / 60;
  const totalUnbilled = filtered.filter(e => e.billable && !e.invoiceId).reduce((s, e) => s + e.minutes, 0) / 60;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Clock} label="Total Hours" value={`${totalHours.toFixed(1)}h`} color="text-cyber-400" />
        <SummaryCard icon={DollarSign} label="Billable" value={`${totalBillable.toFixed(1)}h`} color="text-green-400" />
        <SummaryCard icon={AlertTriangle} label="Unbilled" value={`${totalUnbilled.toFixed(1)}h`} color="text-amber-400" />
        <SummaryCard icon={RotateCw} label="Entries" value={String(filtered.length)} color="text-gray-400" />
      </div>
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-400">{filtered.length} time entries</p>
        <select className="input-field text-sm py-1.5 w-auto" value={billableFilter} onChange={e => setBillableFilter(e.target.value as "" | "true" | "false")}>
          <option value="">All</option><option value="true">Billable</option><option value="false">Non-Billable</option>
        </select>
      </div>

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : filtered.length === 0 ? (
        <div className="text-center py-12 card"><Timer size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No time entries</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Ticket</th><th className="p-3 hidden sm:table-cell">Client</th><th className="p-3">Time</th><th className="p-3">Billable</th><th className="p-3 hidden md:table-cell">Invoiced</th><th className="p-3 hidden lg:table-cell">Date</th></tr></thead>
          <tbody>{filtered.map(e => (
            <tr key={e.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
              <td className="p-3"><span className="font-medium text-white">{e.ticket?.ticketNumber}</span>{e.description && <p className="text-xs text-gray-500 mt-0.5">{e.description.slice(0, 60)}</p>}</td>
              <td className="p-3 text-gray-300 hidden sm:table-cell">{e.ticket?.company?.name || "—"}</td>
              <td className="p-3 text-cyber-400 font-mono font-medium">{e.minutes}m <span className="text-gray-500 text-xs">({(e.minutes / 60).toFixed(2)}h)</span></td>
              <td className="p-3">{e.billable ? <span className="badge bg-green-600/20 text-green-400">billable</span> : <span className="badge bg-gray-600/20 text-gray-400">non-bill</span>}</td>
              <td className="p-3 hidden md:table-cell">{e.invoiceId ? <span className="badge bg-blue-600/20 text-blue-400">invoiced</span> : <span className="text-amber-400 text-xs">unbilled</span>}</td>
              <td className="p-3 text-gray-500 text-xs hidden lg:table-cell">{new Date(e.date).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  REPORTS TAB
// ═══════════════════════════════════════════════════════════════════

function ReportsTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportCard icon={Receipt} title="Revenue Summary" desc="Monthly revenue breakdown by client and service, payment trends, and year-over-year comparisons" />
        <ReportCard icon={Clock} title="Aging Report" desc="Accounts receivable aging: current, 30, 60, 90+ days with client-level detail" />
        <ReportCard icon={DollarSign} title="Tax Summary" desc="Taxable revenue by jurisdiction, tax collected report for compliance reporting" />
        <ReportCard icon={TrendingUp} title="Billing Forecast" desc="Projected revenue from active agreements and recurring invoices" />
        <ReportCard icon={ClipboardList} title="Agreement Profitability" desc="Revenue vs cost per agreement, margin analysis, and contract performance" />
        <ReportCard icon={Timer} title="Utilization Report" desc="Billable vs non-billable time, technician utilization rates" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function SummaryCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: string; color: string }) {
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-surface-lighter`}><Icon size={18} className={color} /></div>
      <div><p className="text-xs text-gray-500">{label}</p><p className={`text-sm font-bold ${color}`}>{value}</p></div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function ReportCard({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="card hover:border-cyber-500/30 transition-colors group cursor-pointer">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-cyber-600/10"><Icon size={18} className="text-cyber-400" /></div>
        <div>
          <h3 className="font-semibold text-white text-sm group-hover:text-cyber-400 transition-colors">{title}</h3>
          <p className="text-xs text-gray-500 mt-1">{desc}</p>
        </div>
      </div>
      <div className="mt-3 text-right">
        <span className="text-xs text-cyber-400 opacity-0 group-hover:opacity-100 transition-opacity">Generate →</span>
      </div>
    </div>
  );
}
