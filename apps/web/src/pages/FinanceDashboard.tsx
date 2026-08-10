import { useState, useEffect } from "react";
import api from "../api";
import { DollarSign, TrendingUp, Clock, AlertTriangle, Receipt, CreditCard } from "lucide-react";

export function FinanceDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/billing/dashboard").then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!data) return <div className="text-center py-12 text-gray-500">No billing data available</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><TrendingUp size={20} className="text-cyber-400" /> Finance Dashboard</h2>
        <p className="text-sm text-gray-400 mt-0.5">Billing overview and financial health</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Receipt} label="Total Invoiced" value={`$${data.totalInvoiced.toLocaleString()}`} color="cyber" />
        <StatCard icon={CreditCard} label="Total Paid" value={`$${data.totalPaid.toLocaleString()}`} color="green" />
        <StatCard icon={Clock} label="Outstanding" value={`$${data.totalOutstanding.toLocaleString()}`} color="amber" />
        <StatCard icon={AlertTriangle} label="Overdue" value={`$${data.totalOverdue.toLocaleString()}`} color="red" />
      </div>

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
  return <div className="flex items-center justify-between text-sm"><span className="text-gray-400">{label}</span><span className="text-white font-medium">{value}</span></div>;
}

function StatusBadge({ label, status }: { label: string; status: string }) {
  const colors: Record<string, string> = { good: "bg-green-600/20 text-green-400", warning: "bg-amber-600/20 text-amber-400", critical: "bg-red-600/20 text-red-400" };
  return <div className="flex items-center justify-between text-sm"><span className="text-gray-400">{label}</span><span className={`badge text-xs ${colors[status]}`}>{status}</span></div>;
}
