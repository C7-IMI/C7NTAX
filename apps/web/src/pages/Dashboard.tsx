import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { Ticket, Clock, DollarSign, AlertTriangle, TrendingUp, Users, Columns3, Building2, FolderKanban, Monitor, BookOpen, Target, Plug } from "lucide-react";

interface DashboardStats { totalTickets: number; openTickets: number; waitingOnClient: number; resolvedToday: number; overdueInvoices: number; revenueThisMonth: number; activeClients: number; }

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ totalTickets: 0, openTickets: 0, waitingOnClient: 0, resolvedToday: 0, overdueInvoices: 0, revenueThisMonth: 0, activeClients: 0 });

  useEffect(() => {
    Promise.all([
      api.get("/tickets?limit=1").then(r => ({ total: r.data.total || 0, data: r.data.data || [] })),
      api.get("/tickets?status=in_progress&limit=1").then(r => r.data.total || 0),
      api.get("/tickets?status=waiting_on_client&limit=1").then(r => r.data.total || 0),
      api.get("/clients?limit=1").then(r => r.data.total || 0),
      api.get("/billing/invoices?status=overdue&limit=1").then(r => r.data.total || 0),
      api.get("/tickets?status=resolved&limit=1").then(r => r.data.total || 0),
    ]).then(([tickets, open, waiting, clients, overdue, resolved]) => {
      setStats({
        totalTickets: tickets.total,
        openTickets: open,
        waitingOnClient: waiting,
        resolvedToday: resolved,
        overdueInvoices: overdue,
        revenueThisMonth: 28450,
        activeClients: clients,
      });
    }).catch(() => {});
  }, []);

  const statCards = [
    { label: "Open Tickets", value: stats.openTickets, icon: Ticket, color: "text-cyber-400", bg: "bg-cyber-600/10", to: "/tickets?status=in_progress" },
    { label: "Waiting on Client", value: stats.waitingOnClient, icon: Clock, color: "text-amber-400", bg: "bg-amber-600/10", to: "/tickets?status=waiting_on_client" },
    { label: "All Tickets", value: stats.totalTickets, icon: TrendingUp, color: "text-green-400", bg: "bg-green-600/10", to: "/tickets" },
    { label: "Overdue Invoices", value: stats.overdueInvoices, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-600/10", to: "/billing" },
    { label: "Revenue (MTD)", value: `$${stats.revenueThisMonth.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-600/10", to: "/billing" },
    { label: "Active Clients", value: stats.activeClients, icon: Users, color: "text-purple-400", bg: "bg-purple-600/10", to: "/clients" },
  ];

  const quickLinks = [
    { to: "/tickets", icon: Ticket, label: "Tickets", desc: "View and manage support tickets" },
    { to: "/boards", icon: Columns3, label: "Service Boards", desc: "Configure boards and email connectors" },
    { to: "/opportunities", icon: Target, label: "Sales Pipeline", desc: "Track opportunities and deals" },
    { to: "/projects", icon: FolderKanban, label: "Projects", desc: "Manage projects and phases" },
    { to: "/assets", icon: Monitor, label: "Asset Inventory", desc: "Track hardware and licenses" },
    { to: "/kb", icon: BookOpen, label: "Knowledge Base", desc: "Articles and documentation" },
    { to: "/clients", icon: Building2, label: "Clients", desc: "Company accounts and contacts" },
    { to: "/billing", icon: DollarSign, label: "Billing", desc: "Invoices and agreements" },
    { to: "/integrations", icon: Plug, label: "Integrations", desc: "Third-party service connections" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div><h2 className="text-lg font-semibold text-white">Dashboard</h2><p className="text-sm text-gray-400 mt-0.5">Overview of your service operations</p></div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(card => (
          <Link key={card.label} to={card.to} className="card flex items-start gap-3 p-4 hover:border-cyber-500/30 transition-colors cursor-pointer">
            <div className={`p-2 rounded-lg ${card.bg}`}><card.icon size={18} className={card.color} /></div>
            <div className="min-w-0"><p className="text-2xl font-bold text-white">{card.value}</p><p className="text-xs text-gray-500 truncate">{card.label}</p></div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {quickLinks.map(link => (
          <Link key={link.to} to={link.to} className="card hover:border-cyber-500/30 transition-colors group">
            <link.icon size={20} className="text-cyber-400 mb-2" />
            <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors text-sm">{link.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{link.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
