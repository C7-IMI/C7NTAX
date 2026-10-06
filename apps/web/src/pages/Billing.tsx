import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, Send, DollarSign, CreditCard, Eye, FileText, Clock, Calendar,
  TrendingUp, Download, Receipt, Building2, AlertTriangle, CheckCircle,
  XCircle, RotateCw, ClipboardList, BarChart3, Timer, Filter,
  ExternalLink, Copy, Eraser, Repeat, SquareArrowOutUpRight, AppWindow, Trash2,
  type LucideIcon,
} from "lucide-react";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";

// Types
interface Invoice { id: string; invoiceNumber: string; company: { name?: string; id?: string } | null; total: number; subtotal?: number; status: string; issueDate: string; dueDate: string; sentAt?: string; paidAt?: string; lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; payments?: Array<{ amount: number; method: string; processedAt: string; reference?: string }>; }
interface Agreement { id: string; name: string; description?: string; companyId?: string; company: { name?: string; id?: string } | null; billingPeriod: string; billingAmount: number; startDate: string; endDate?: string; isActive: boolean; autoInvoiceEnabled: boolean; followUpEnabled: boolean; _count?: { invoices: number } }
interface Payment { id: string; amount: number; method: string; reference?: string; processedAt: string; invoice: { invoiceNumber: string; company: { name?: string } | null } }
interface TimeEntry { id: string; description?: string; internalNotes?: string; minutes: number; billable: boolean; noCharge?: boolean; rate?: number | null; workType?: string | null; workRole?: string | null; date: string; ticket: { id?: string; ticketNumber: string; company?: { name?: string } | null } | null; invoiceId?: string; }
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

  // The route owns the tab, including /billing itself (no tab prop).
  useEffect(() => { setActiveTab(initialTab || "invoices"); }, [initialTab]);
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

  /** Bills an invoice again on its own schedule (POST /invoices/:id/recurring). */
  const makeRecurring = async (inv: Invoice) => {
    try { await api.post(`/billing/invoices/${inv.id}/recurring`, {}); toast.success(`${inv.invoiceNumber} set to repeat`); fetchInvoices(); }
    catch { toast.error("Failed to set up recurrence"); }
  };

  // ── Right-click menu: Invoices ──
  const menu = useContextMenu();
  const navigate = useNavigate();

  const csvColumns: CsvColumn<Invoice>[] = [
    { key: "number", label: "Invoice", value: inv => inv.invoiceNumber },
    { key: "client", label: "Client", value: inv => inv.company?.name ?? "" },
    { key: "total", label: "Amount", value: inv => inv.total },
    { key: "status", label: "Status", value: inv => inv.status },
    { key: "issued", label: "Issued", value: inv => inv.issueDate },
    { key: "due", label: "Due", value: inv => inv.dueDate },
  ];

  const exportCsv = () => {
    const rows = sortData(invoices, sort?.field || "dueDate", sort?.direction || "desc");
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-invoices-${fileStamp()}.csv`, toCsv(rows, csvColumns));
    toast.success(`Exported ${rows.length} invoice${rows.length === 1 ? "" : "s"}`);
  };

  const invoiceMenuHeader = (inv: Invoice) => ({
    title: inv.invoiceNumber,
    subtitle: [inv.company?.name, `$${inv.total.toFixed(2)}`, inv.status, `due ${new Date(inv.dueDate).toLocaleDateString()}`].filter(Boolean).join(" · "),
  });

  const invoiceMenuEntries = (inv: Invoice): MenuEntry[] => [
    { label: "Open invoice", icon: ExternalLink, hint: "⏎", onSelect: () => setViewInvoice(inv) },
    { label: "Download PDF", icon: FileText, onSelect: () => handleInvoicePdf(inv) },
    "separator",
    inv.status === "draft" && { label: "Send to client", icon: Send, onSelect: () => void handleSend(inv.id) },
    ["sent", "partial", "overdue"].includes(inv.status) && { label: "Record payment…", icon: CreditCard, onSelect: () => openPay(inv) },
    { label: "Set to repeat…", icon: Repeat, onSelect: () => void makeRecurring(inv) },
    inv.company?.id && { label: "Open client", icon: Building2, onSelect: () => navigate(`/clients/${inv.company!.id}`) },
    "separator",
    { label: "Copy invoice number", icon: Copy, onSelect: () => void copyText(inv.invoiceNumber, "Invoice number") },
    { label: "Copy amount", icon: Copy, onSelect: () => void copyText(`$${inv.total.toFixed(2)}`, "Amount") },
    {
      label: "Copy invoice summary", icon: Copy,
      onSelect: () => void copyText([
        inv.invoiceNumber,
        inv.company?.name ? `Client: ${inv.company.name}` : null,
        `Amount: $${inv.total.toFixed(2)}`,
        `Status: ${inv.status}`,
        `Issued: ${new Date(inv.issueDate).toLocaleDateString()}`,
        `Due: ${new Date(inv.dueDate).toLocaleDateString()}`,
      ].filter(Boolean).join("\n"), "Invoice summary"),
    },
  ].filter(Boolean) as MenuEntry[];

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Generate invoice…", icon: Plus, onSelect: () => setShowGenerate(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => fetchInvoices() },
    "separator",
    { label: "Clear status filter", icon: Eraser, disabled: !statusFilter, onSelect: () => setStatusFilter("") },
    {
      label: "Sort by", icon: Filter,
      items: [
        { label: "Invoice number", checked: sort?.field === "invoiceNumber", onSelect: () => setSort({ field: "invoiceNumber", direction: "asc" }) },
        { label: "Client", checked: sort?.field === "company.name", onSelect: () => setSort({ field: "company.name", direction: "asc" }) },
        { label: "Amount", checked: sort?.field === "total", onSelect: () => setSort({ field: "total", direction: "desc" }) },
        { label: "Issued", checked: sort?.field === "issueDate", onSelect: () => setSort({ field: "issueDate", direction: "desc" }) },
        { label: "Due", checked: sort?.field === "dueDate", onSelect: () => setSort({ field: "dueDate", direction: "asc" }) },
        { label: "Status", checked: sort?.field === "status", onSelect: () => setSort({ field: "status", direction: "asc" }) },
      ],
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${invoices.length} row${invoices.length === 1 ? "" : "s"}`, disabled: invoices.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
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
            <tr key={inv.id} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 cursor-pointer focus:outline-none focus:bg-surface-lighter/30" onDoubleClick={() => handleInvoicePdf(inv)} onClick={() => setViewInvoice(inv)}
              onContextMenu={(e) => menu.open(e, invoiceMenuEntries(inv), invoiceMenuHeader(inv))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, invoiceMenuEntries(inv), invoiceMenuHeader(inv))}
            >
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

  // ── Right-click menu: Agreements ──
  const menu = useContextMenu();
  const navigate = useNavigate();

  const csvColumns: CsvColumn<Agreement>[] = [
    { key: "name", label: "Agreement", value: a => a.name },
    { key: "client", label: "Client", value: a => a.company?.name ?? "" },
    { key: "period", label: "Billing Period", value: a => a.billingPeriod },
    { key: "amount", label: "Amount", value: a => a.billingAmount },
    { key: "start", label: "Start", value: a => a.startDate },
    { key: "end", label: "End", value: a => a.endDate ?? "ongoing" },
    { key: "status", label: "Status", value: a => (a.isActive ? "Active" : "Inactive") },
    { key: "autoInvoice", label: "Auto Invoice", value: a => (a.autoInvoiceEnabled ? "Yes" : "No") },
  ];

  const exportCsv = () => {
    const rows = sortData(agreements, sortAg?.field || "name", sortAg?.direction || "asc");
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-agreements-${fileStamp()}.csv`, toCsv(rows, csvColumns));
    toast.success(`Exported ${rows.length} agreement${rows.length === 1 ? "" : "s"}`);
  };

  const agreementMenuHeader = (a: Agreement) => ({
    title: a.name,
    subtitle: [a.company?.name, `${a.billingPeriod} · $${a.billingAmount.toLocaleString()}`, a.isActive ? "Active" : "Inactive", a.autoInvoiceEnabled ? "auto-invoiced" : null].filter(Boolean).join(" · "),
  });

  const agreementMenuEntries = (a: Agreement): MenuEntry[] => {
    const companyId = a.company?.id ?? a.companyId;
    return [
      {
        label: "New agreement for this client…", icon: Plus, disabled: !companyId,
        onSelect: () => { setForm(prev => ({ ...prev, companyId: String(companyId) })); setShowCreate(true); },
      },
      companyId && { label: "Open client", icon: Building2, onSelect: () => navigate(`/clients/${companyId}`) },
      companyId && { label: "Client's tickets", icon: FileText, onSelect: () => navigate(`/tickets?companyId=${companyId}`) },
      companyId && { label: "Client's invoices", icon: Receipt, onSelect: () => navigate("/billing") },
      "separator",
      { label: "Copy agreement name", icon: Copy, onSelect: () => void copyText(a.name, "Agreement name") },
      {
        label: "Copy billing terms", icon: Copy,
        onSelect: () => void copyText([
          a.name,
          a.company?.name ? `Client: ${a.company.name}` : null,
          `Billing: $${a.billingAmount.toLocaleString()} ${a.billingPeriod}`,
          `Starts: ${new Date(a.startDate).toLocaleDateString()}`,
          a.endDate ? `Ends: ${new Date(a.endDate).toLocaleDateString()}` : "Ongoing",
          `Auto invoice: ${a.autoInvoiceEnabled ? "yes" : "no"}`,
        ].filter(Boolean).join("\n"), "Billing terms"),
      },
    ].filter(Boolean) as MenuEntry[];
  };

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "New agreement…", icon: Plus, onSelect: () => setShowCreate(true) },
    { label: "Refresh list", icon: RotateCw, onSelect: () => fetch() },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${agreements.length} row${agreements.length === 1 ? "" : "s"}`, disabled: agreements.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
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
            <tr key={a.id} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 focus:outline-none focus:bg-surface-lighter/30"
              onContextMenu={(e) => menu.open(e, agreementMenuEntries(a), agreementMenuHeader(a))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, agreementMenuEntries(a), agreementMenuHeader(a))}
            >
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
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    setLoading(true);
    // /billing/payments is the payments list; the invoice list does not carry
    // payments at all, so deriving them from it left this tab permanently empty.
    api.get("/billing/payments").then(r => {
      setPayments(Array.isArray(r.data) ? r.data : (r.data?.data || []));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const filtered = methodFilter ? payments.filter(p => p.method === methodFilter) : payments;
  const total = filtered.reduce((s, p) => s + p.amount, 0);

  // ── Right-click menu: Payments ──
  const menu = useContextMenu();

  const csvColumns: CsvColumn<Payment>[] = [
    { key: "invoice", label: "Invoice", value: p => p.invoice.invoiceNumber },
    { key: "client", label: "Client", value: p => p.invoice.company?.name ?? "" },
    { key: "amount", label: "Amount", value: p => p.amount },
    { key: "method", label: "Method", value: p => p.method.replace(/_/g, " ") },
    { key: "date", label: "Processed", value: p => p.processedAt },
    { key: "reference", label: "Reference", value: p => p.reference ?? "" },
  ];

  const exportCsv = () => {
    const rows = sortData(filtered, sortPay?.field || "processedAt", sortPay?.direction || "desc");
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-payments-${fileStamp()}.csv`, toCsv(rows, csvColumns));
    toast.success(`Exported ${rows.length} payment${rows.length === 1 ? "" : "s"}`);
  };

  const paymentMenuHeader = (p: Payment) => ({
    title: `$${p.amount.toFixed(2)} · ${p.method.replace(/_/g, " ")}`,
    subtitle: [p.invoice.invoiceNumber, p.invoice.company?.name, new Date(p.processedAt).toLocaleDateString()].filter(Boolean).join(" · "),
  });

  const paymentMenuEntries = (p: Payment): MenuEntry[] => [
    { label: "Open invoices", icon: Receipt, hint: "⏎", onSelect: () => navigate("/billing") },
    "separator",
    { label: "Copy reference", icon: Copy, disabled: !p.reference, onSelect: () => void copyText(String(p.reference), "Reference") },
    { label: "Copy amount", icon: Copy, onSelect: () => void copyText(`$${p.amount.toFixed(2)}`, "Amount") },
    { label: "Copy invoice number", icon: Copy, onSelect: () => void copyText(p.invoice.invoiceNumber, "Invoice number") },
    {
      label: "Copy payment details", icon: Copy,
      onSelect: () => void copyText([
        `$${p.amount.toFixed(2)} ${p.method.replace(/_/g, " ")}`,
        `Invoice: ${p.invoice.invoiceNumber}`,
        p.invoice.company?.name ? `Client: ${p.invoice.company.name}` : null,
        `Processed: ${new Date(p.processedAt).toLocaleDateString()}`,
        p.reference ? `Reference: ${p.reference}` : null,
      ].filter(Boolean).join("\n"), "Payment details"),
    },
  ];

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Refresh list", icon: RotateCw, onSelect: () => load() },    "separator",
    { label: "Clear method filter", icon: Eraser, disabled: !methodFilter, onSelect: () => setMethodFilter("") },
    {
      label: "Sort by", icon: Filter,
      items: [
        { label: "Invoice", checked: sortPay?.field === "invoice.invoiceNumber", onSelect: () => setSortPay({ field: "invoice.invoiceNumber", direction: "asc" }) },
        { label: "Amount", checked: sortPay?.field === "amount", onSelect: () => setSortPay({ field: "amount", direction: "desc" }) },
        { label: "Method", checked: sortPay?.field === "method", onSelect: () => setSortPay({ field: "method", direction: "asc" }) },
        { label: "Date", checked: sortPay?.field === "processedAt", onSelect: () => setSortPay({ field: "processedAt", direction: "desc" }) },
        { label: "Reference", checked: sortPay?.field === "reference", onSelect: () => setSortPay({ field: "reference", direction: "asc" }) },
      ],
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${filtered.length} row${filtered.length === 1 ? "" : "s"}`, disabled: filtered.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
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
            <tr key={i} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 focus:outline-none focus:bg-surface-lighter/30"
              onContextMenu={(e) => menu.open(e, paymentMenuEntries(p), paymentMenuHeader(p))}
              onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, paymentMenuEntries(p), paymentMenuHeader(p))}
            >
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
  const [expenses, setExpenses] = useState<any[]>([]);
  const [ticketMap, setTicketMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [billableFilter, setBillableFilter] = useState<"" | "true" | "false">("");
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    setLoading(true);
    // Billing's own time-entry source: the tickets list does not include them,
    // which is why this table used to be permanently empty.
    api.get("/billing/time-entries").then(r => {
      const rows = Array.isArray(r.data) ? r.data : (r.data?.data || []);
      setEntries(rows);
      const map: Record<string, any> = {};
      for (const te of rows) {
        if (te.ticket?.id) map[te.ticket.id] = te.ticket;
      }
      setTicketMap(map);
      setLoading(false);
    }).catch(() => setLoading(false));
    // Expenses linked to tickets (created via the ticket Expenses tab dialog)
    api.get("/billing/expenses").then(r => setExpenses(r.data?.data || r.data || [])).catch(() => {});
  };

  const filtered = billableFilter ? entries.filter(e => e.billable === (billableFilter === "true")) : entries;
  const totalHours = filtered.reduce((s, e) => s + e.minutes, 0) / 60;
  const totalBillable = filtered.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0) / 60;
  const totalUnbilled = filtered.filter(e => e.billable && !e.invoiceId).reduce((s, e) => s + e.minutes, 0) / 60;
  const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  // ── Right-click menu: Time & Expenses ──
  const menu = useContextMenu();
  const [expenseConfirm, setExpenseConfirm] = useState<any | null>(null);
  const [expenseBusy, setExpenseBusy] = useState(false);

  const deleteExpense = async () => {
    if (!expenseConfirm) return;
    setExpenseBusy(true);
    try {
      await api.delete(`/billing/expenses/${expenseConfirm.id}`);
      toast.success("Expense deleted");
      setExpenses(prev => prev.filter(x => x.id !== expenseConfirm.id));
      setExpenseConfirm(null);
    } catch { toast.error("Failed to delete expense"); }
    finally { setExpenseBusy(false); }
  };

  const csvColumns: CsvColumn<TimeEntry>[] = [
    { key: "ticket", label: "Ticket", value: e => e.ticket?.ticketNumber ?? "" },
    { key: "client", label: "Client", value: e => e.ticket?.company?.name ?? "" },
    { key: "minutes", label: "Minutes", value: e => e.minutes },
    { key: "hours", label: "Hours", value: e => (e.minutes / 60).toFixed(2) },
    { key: "billable", label: "Billable", value: e => (e.noCharge ? "no charge" : e.billable ? "billable" : "non-billable") },
    { key: "invoiced", label: "Invoiced", value: e => (e.invoiceId ? "yes" : "unbilled") },
    { key: "workType", label: "Work Type", value: e => e.workType ?? "" },
    { key: "workRole", label: "Work Role", value: e => e.workRole ?? "" },
    { key: "rate", label: "Rate", value: e => e.rate ?? "" },
    { key: "date", label: "Date", value: e => e.date },
    { key: "description", label: "Description", value: e => e.description ?? "" },
  ];

  const exportTimeCsv = () => {
    if (filtered.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-time-entries-${fileStamp()}.csv`, toCsv(filtered, csvColumns));
    toast.success(`Exported ${filtered.length} time entr${filtered.length === 1 ? "y" : "ies"}`);
  };

  const exportExpenseCsv = () => {
    if (expenses.length === 0) { toast.error("Nothing to export"); return; }
    const columns: CsvColumn<Record<string, any>>[] = [
      { key: "ticket", label: "Ticket", value: e => ticketMap[e.ticketId]?.ticketNumber ?? "" },
      { key: "description", label: "Description", value: e => e.description ?? "" },
      { key: "category", label: "Category", value: e => e.category ?? "" },
      { key: "date", label: "Date", value: e => e.expenseDate ?? "" },
      { key: "amount", label: "Amount", value: e => e.amount ?? 0 },
    ];
    downloadCsv(`c7ntax-expenses-${fileStamp()}.csv`, toCsv(expenses, columns));
    toast.success(`Exported ${expenses.length} expense${expenses.length === 1 ? "" : "s"}`);
  };

  const timeMenuHeader = (e: TimeEntry) => ({
    title: `${e.ticket?.ticketNumber ?? "Time entry"} · ${(e.minutes / 60).toFixed(2)}h`,
    subtitle: [e.ticket?.company?.name, e.noCharge ? "no charge" : e.billable ? "billable" : "non-billable", e.invoiceId ? "invoiced" : "unbilled", new Date(e.date).toLocaleDateString()].filter(Boolean).join(" · "),
  });

  const timeMenuEntries = (e: TimeEntry): MenuEntry[] => [
    e.ticket?.id && { label: "Open ticket", icon: FileText, hint: e.ticket.ticketNumber, onSelect: () => navigate(`/tickets/${e.ticket!.id}`) },
    { label: "Show only billable", icon: Filter, onSelect: () => setBillableFilter("true") },
    { label: "Show only non-billable", icon: Filter, onSelect: () => setBillableFilter("false") },
    "separator",
    {
      label: "Copy time details", icon: Copy,
      onSelect: () => void copyText([
        `${e.ticket?.ticketNumber ?? "Time entry"} — ${(e.minutes / 60).toFixed(2)}h (${e.minutes}m)`,
        e.ticket?.company?.name ? `Client: ${e.ticket.company.name}` : null,
        `Date: ${new Date(e.date).toLocaleDateString()}`,
        e.noCharge ? "No charge" : e.billable ? "Billable" : "Non-billable",
        e.invoiceId ? "Invoiced" : "Unbilled",
        [e.workType, e.workRole].filter(Boolean).join(" · ") || null,
        e.description || null,
      ].filter(Boolean).join("\n"), "Time details"),
    },
    { label: "Copy description", icon: Copy, disabled: !e.description, onSelect: () => void copyText(String(e.description), "Description") },
  ].filter(Boolean) as MenuEntry[];

  const expenseMenuHeader = (e: Record<string, any>) => ({
    title: `$${(e.amount || 0).toFixed(2)} · ${e.category ?? "expense"}`,
    subtitle: [ticketMap[e.ticketId]?.ticketNumber, e.description, e.expenseDate ? new Date(e.expenseDate).toLocaleDateString() : null].filter(Boolean).join(" · "),
  });

  const expenseMenuEntries = (e: Record<string, any>): MenuEntry[] => [
    ticketMap[e.ticketId] && { label: "Open ticket", icon: FileText, hint: ticketMap[e.ticketId]?.ticketNumber, onSelect: () => navigate(`/tickets/${e.ticketId}`) },
    "separator",
    {
      label: "Copy expense details", icon: Copy,
      onSelect: () => void copyText([
        `${e.description ?? "Expense"} — $${(e.amount || 0).toFixed(2)}`,
        e.category ? `Category: ${e.category}` : null,
        ticketMap[e.ticketId]?.ticketNumber ? `Ticket: ${ticketMap[e.ticketId].ticketNumber}` : null,
        e.expenseDate ? `Date: ${new Date(e.expenseDate).toLocaleDateString()}` : null,
      ].filter(Boolean).join("\n"), "Expense details"),
    },
    { label: "Copy amount", icon: Copy, onSelect: () => void copyText(`$${(e.amount || 0).toFixed(2)}`, "Amount") },
    "separator",
    { label: "Delete expense…", icon: Trash2, danger: true, onSelect: () => setExpenseConfirm(e) },
  ].filter(Boolean) as MenuEntry[];

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Refresh", icon: RotateCw, onSelect: () => load() },
    "separator",
    {
      label: "Show", icon: Filter,
      items: [
        { label: "All time entries", checked: !billableFilter, onSelect: () => setBillableFilter("") },
        { label: "Billable only", checked: billableFilter === "true", onSelect: () => setBillableFilter("true") },
        { label: "Non-billable only", checked: billableFilter === "false", onSelect: () => setBillableFilter("false") },
      ],
    },
    "separator",
    { label: "Export time entries as CSV", icon: Download, hint: `${filtered.length} row${filtered.length === 1 ? "" : "s"}`, disabled: filtered.length === 0, onSelect: exportTimeCsv },
    { label: "Export expenses as CSV", icon: Download, hint: `${expenses.length} row${expenses.length === 1 ? "" : "s"}`, disabled: expenses.length === 0, onSelect: exportExpenseCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      {expenseConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setExpenseConfirm(null)}>
          <div role="dialog" aria-modal="true" aria-label="Delete expense" className="card w-full max-w-sm mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={24} className="text-red-400 shrink-0" />
              <div>
                <h3 className="text-white font-semibold">Delete expense?</h3>
                <p className="text-sm text-gray-400 mt-1">
                  {expenseConfirm.description || "This expense"} — ${(expenseConfirm.amount || 0).toFixed(2)} is removed from billing. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExpenseConfirm(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={deleteExpense} disabled={expenseBusy} className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">{expenseBusy ? "Deleting…" : "Delete expense"}</button>
            </div>
          </div>
        </div>
      )}
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
            <tr key={e.id} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 focus:outline-none focus:bg-surface-lighter/30"
              onContextMenu={(ev) => menu.open(ev, timeMenuEntries(e), timeMenuHeader(e))}
              onKeyDown={(ev) => menu.onKeyDown(ev, ev.currentTarget, timeMenuEntries(e), timeMenuHeader(e))}
            >
              <td className="p-3"><span className="font-medium text-white">{e.ticket?.ticketNumber}</span>{e.description && <p className="text-xs text-gray-500 mt-0.5">{e.description.slice(0, 60)}</p>}{[e.workType, e.workRole, e.rate ? `$${Number(e.rate).toFixed(2)}/hr` : null].filter(Boolean).length > 0 && <p className="text-[10px] text-gray-600 mt-0.5">{[e.workType, e.workRole, e.rate ? `$${Number(e.rate).toFixed(2)}/hr` : null].filter(Boolean).join(" · ")}</p>}</td>
              <td className="p-3 text-gray-300 hidden sm:table-cell">{e.ticket?.company?.name || "—"}</td>
              <td className="p-3 text-cyber-400 font-mono font-medium">{e.minutes}m <span className="text-gray-500 text-xs">({(e.minutes / 60).toFixed(2)}h)</span></td>
              <td className="p-3">{e.noCharge ? <span className="badge bg-amber-600/20 text-amber-400">no charge</span> : e.billable ? <span className="badge bg-green-600/20 text-green-400">billable</span> : <span className="badge bg-gray-600/20 text-gray-400">non-bill</span>}</td>
              <td className="p-3 hidden md:table-cell">{e.invoiceId ? <span className="badge bg-blue-600/20 text-blue-400">invoiced</span> : <span className="text-amber-400 text-xs">unbilled</span>}</td>
              <td className="p-3 text-gray-500 text-xs hidden lg:table-cell">{new Date(e.date).toLocaleDateString()}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {/* Expenses — linked from the ticket Expenses tab */}
      <div className="flex justify-between items-center pt-2 border-t border-surface-border">
        <p className="text-sm text-gray-400">{expenses.length} expenses · <span className="text-cyber-400 font-medium">${expenseTotal.toFixed(2)}</span></p>
      </div>
      {expenses.length === 0 ? (
        <div className="text-center py-8 card"><Receipt size={36} className="text-gray-600 mx-auto mb-2" /><p className="text-gray-500 text-sm">No expenses</p></div>
      ) : (
        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Ticket</th><th className="p-3">Description</th><th className="p-3">Category</th><th className="p-3 hidden md:table-cell">Date</th><th className="p-3 text-right">Amount</th></tr></thead>
          <tbody>{expenses.map(e => (
            <tr key={e.id} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 focus:outline-none focus:bg-surface-lighter/30"
              onContextMenu={(ev) => menu.open(ev, expenseMenuEntries(e), expenseMenuHeader(e))}
              onKeyDown={(ev) => menu.onKeyDown(ev, ev.currentTarget, expenseMenuEntries(e), expenseMenuHeader(e))}
            >
              <td className="p-3"><span className="font-medium text-white">{ticketMap[e.ticketId]?.ticketNumber || "—"}</span></td>
              <td className="p-3 text-gray-300 text-xs">{e.description}</td>
              <td className="p-3"><span className="badge bg-purple-600/20 text-purple-400 text-xs capitalize">{e.category}</span></td>
              <td className="p-3 text-gray-500 text-xs hidden md:table-cell">{new Date(e.expenseDate).toLocaleDateString()}</td>
              <td className="p-3 text-right text-cyber-400 font-medium">${(e.amount || 0).toFixed(2)}</td>
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
  const menu = useContextMenu();
  const navigate = useNavigate();

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Custom report builder", icon: FileText, onSelect: () => navigate("/reports/custom") },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
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
