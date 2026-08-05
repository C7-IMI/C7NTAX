import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { Ticket, Clock, DollarSign, AlertTriangle, TrendingUp, Users, Columns3 } from "lucide-react";

interface DashboardStats { totalTickets: number; openTickets: number; waitingOnClient: number; resolvedToday: number; overdueInvoices: number; revenueThisMonth: number; activeClients: number; }

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.get("/tickets?limit=1").then((r) => {
      setStats({
        totalTickets: r.data.total || 0,
        openTickets: 42, waitingOnClient: 7, resolvedToday: 15,
        overdueInvoices: 3, revenueThisMonth: 28450, activeClients: 24,
      });
    }).catch(() => {});
  }, []);

  const cards = [
    { label: "Open Tickets", value: stats?.openTickets ?? "-", icon: Ticket, color: "text-cyber-400", bg: "bg-cyber-600/10" },
    { label: "Waiting on Client", value: stats?.waitingOnClient ?? "-", icon: Clock, color: "text-amber-400", bg: "bg-amber-600/10" },
    { label: "Resolved Today", value: stats?.resolvedToday ?? "-", icon: TrendingUp, color: "text-green-400", bg: "bg-green-600/10" },
    { label: "Overdue Invoices", value: stats?.overdueInvoices ?? "-", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-600/10" },
    { label: "Revenue (MTD)", value: stats?.revenueThisMonth ? `$${stats.revenueThisMonth.toLocaleString()}` : "-", icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-600/10" },
    { label: "Active Clients", value: stats?.activeClients ?? "-", icon: Users, color: "text-purple-400", bg: "bg-purple-600/10" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-white">Dashboard</h2>
        <p className="text-sm text-gray-400 mt-0.5">Overview of your service operations</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="card flex items-start gap-3 p-4">
            <div className={`p-2 rounded-lg ${card.bg}`}><card.icon size={18} className={card.color} /></div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-white">{card.value}</p>
              <p className="text-xs text-gray-500 truncate">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/tickets" className="card hover:border-cyber-500/30 transition-colors group">
          <Ticket size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Ticket Manager</h3>
          <p className="text-sm text-gray-500 mt-1">View, create, and manage service tickets</p>
        </Link>
        <Link to="/boards" className="card hover:border-cyber-500/30 transition-colors group">
          <Columns3 size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Service Boards</h3>
          <p className="text-sm text-gray-500 mt-1">Configure boards and email connectors</p>
        </Link>
        <Link to="/billing" className="card hover:border-cyber-500/30 transition-colors group">
          <DollarSign size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Billing Center</h3>
          <p className="text-sm text-gray-500 mt-1">Invoices, agreements, and payments</p>
        </Link>
      </div>
    </div>
  );
}
