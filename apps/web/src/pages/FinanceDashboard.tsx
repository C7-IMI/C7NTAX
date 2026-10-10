import { useState, useEffect } from "react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { DollarSign, TrendingUp, Clock, AlertTriangle, Receipt, CreditCard } from "lucide-react";
import toast from "react-hot-toast";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader, StatCard as KpiCard } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

export function FinanceDashboardPage() {
  const modern = useModernInterface();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [genCompanyId, setGenCompanyId] = useState("");
  const [genLoading, setGenLoading] = useState(false);

  useEffect(() => {
    api.get("/billing/dashboard").then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <TableSkeleton />;
  if (!data) return <div className="text-center py-12 text-gray-500">No billing data available</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        variant="section"
        icon={<TrendingUp size={20} className="text-cyber-400" />}
        title="Finance Dashboard"
        subtitle="Billing overview and financial health"
      />

      {modern ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Invoiced" value={`$${data.totalInvoiced.toLocaleString()}`} icon={<Receipt size={13} />} tone="cyber" />
          <KpiCard label="Total Paid" value={`$${data.totalPaid.toLocaleString()}`} icon={<CreditCard size={13} />} tone="green" />
          <KpiCard label="Outstanding" value={`$${data.totalOutstanding.toLocaleString()}`} icon={<Clock size={13} />} tone="amber" />
          <KpiCard label="Overdue" value={`$${data.totalOverdue.toLocaleString()}`} icon={<AlertTriangle size={13} />} tone="red" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Receipt} label="Total Invoiced" value={`$${data.totalInvoiced.toLocaleString()}`} color="cyber" />
          <StatCard icon={CreditCard} label="Total Paid" value={`$${data.totalPaid.toLocaleString()}`} color="green" />
          <StatCard icon={Clock} label="Outstanding" value={`$${data.totalOutstanding.toLocaleString()}`} color="amber" />
          <StatCard icon={AlertTriangle} label="Overdue" value={`$${data.totalOverdue.toLocaleString()}`} color="red" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Quick Stats</h3>
          <div className="space-y-3">
            <Bar label="Invoice Count" value={data.invoiceCount} />
            <Bar label="Payment Count" value={data.paymentCount} />
            <Bar label="Collection Rate" value={`${data.totalInvoiced > 0 ? Math.round((data.totalPaid / data.totalInvoiced) * 100) : 0}%`} />
            <Bar label="Overdue Rate" value={`${data.totalInvoiced > 0 ? Math.round((data.totalOverdue / data.totalInvoiced) * 100) : 0}%`} />
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Health Indicators</h3>
          <div className="space-y-3">
            <StatusBadge label="Collection Status" status={data.totalPaid >= data.totalOutstanding ? "good" : "warning"} />
            <StatusBadge label="Overdue Status" status={data.totalOverdue === 0 ? "good" : data.totalOverdue < 10000 ? "warning" : "critical"} />
            <StatusBadge label="Invoice Pipeline" status={data.invoiceCount > 0 ? "good" : "warning"} />
          </div>
        </div>
      </div>

      {/* Backlog item 2 — generate invoice from unbilled ticket time (draft, non-breaking) */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Generate from tickets</h3>
        <div className="flex items-center gap-3">
          <input className="input-field flex-1" type="text" value={genCompanyId} onChange={(e) => setGenCompanyId(e.target.value)} placeholder="Company ID" />
          <button
            className="btn-primary"
            disabled={genLoading || !genCompanyId}
            onClick={async () => {
              setGenLoading(true);
              try {
                const r = await api.post("/billing/invoices/generate-from-tickets", { companyId: genCompanyId });
                toast.success(`Draft invoice ${r.data.invoice.invoiceNumber} generated (${r.data.entriesIncluded} time entries)`);
              } catch (err: unknown) {
                toast.error(apiErrorMessage(err, "Generate failed"));
              } finally { setGenLoading(false); }
            }}
          >
            {genLoading ? "Generating..." : "Generate draft invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colors: Record<string, string> = { cyber: "border-cyber-500/20 bg-cyber-600/10 text-cyber-400", green: "border-green-500/20 bg-green-600/10 text-green-400", amber: "border-amber-500/20 bg-amber-600/10 text-amber-400", red: "border-red-500/20 bg-red-600/10 text-red-400" };
  return (
    <div className={`card border ${colors[color]}`}>
      <div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${colors[color]}`}><Icon size={18} /></div><div><p className="text-xs text-gray-400">{label}</p><p className="text-lg font-bold text-white">{value}</p></div></div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: any }) {
  const modern = useModernInterface();
  return <div className="flex items-center justify-between text-sm"><span className="text-gray-400">{label}</span><span className={modern ? "text-white font-medium tabular-nums" : "text-white font-medium"}>{value}</span></div>;
}

function StatusBadge({ label, status }: { label: string; status: string }) {
  const colors: Record<string, string> = { good: "bg-green-600/20 text-green-400", warning: "bg-amber-600/20 text-amber-400", critical: "bg-red-600/20 text-red-400" };
  return <div className="flex items-center justify-between text-sm"><span className="text-gray-400">{label}</span><span className={`badge text-xs ${colors[status]}`}>{status}</span></div>;
}
