import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Plug, Users, Settings, Menu, X, LogOut, ChevronRight, ChevronDown, GripVertical,
  Target, FolderKanban, Monitor, BookOpen, Shield, FileText, Wrench, Cpu, Activity, TrendingUp, ClipboardList, BarChart3, Receipt, CreditCard, Timer,
  Database, Server, Sparkles,
  type LucideIcon,
} from "lucide-react";

type NavNode = {
  id: string;
  to?: string;
  icon: LucideIcon;
  label: string;
  children?: NavNode[];
};

const NAV_TREE: NavNode[] = [
  { id: "dashboard", to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { id: "tickets", to: "/tickets", icon: Ticket, label: "Tickets" },
  { id: "boards", to: "/boards", icon: Columns3, label: "Service Boards" },
  { id: "pipeline", to: "/opportunities", icon: Target, label: "Pipeline" },
  {
    id: "administration", icon: Shield, label: "Administration", children: [
      { id: "admin-general", to: "/admin", icon: Settings, label: "General Settings" },
      { id: "admin-boards", to: "/admin/boards", icon: Columns3, label: "Service Boards" },
      { id: "admin-system", to: "/admin/system", icon: Settings, label: "System Settings" },
      { id: "admin-logs", to: "/admin/logs", icon: FileText, label: "Audit Logs" },
      { id: "admin-changelog", to: "/admin/changelog", icon: Sparkles, label: "What's New" },
      { id: "admin-integrations", to: "/integrations", icon: Plug, label: "Integrations" },
    ],
  },
  {
    id: "clients", icon: Building2, label: "Clients", children: [
      { id: "clients-list", to: "/clients", icon: Building2, label: "Client List" },
      { id: "clients-contacts", to: "/clients/contacts", icon: Users, label: "Contacts" },
    ],
  },
  {
    id: "assets", icon: Monitor, label: "Assets", children: [
      { id: "assets-inventory", to: "/assets", icon: Monitor, label: "Asset Inventory" },
      { id: "assets-procurement", to: "/procurement", icon: DollarSign, label: "Procurement" },
    ],
  },
  {
    id: "users-roles", icon: Users, label: "Users & Roles", children: [
      { id: "users-list", to: "/users", icon: Users, label: "Manage Users" },
      { id: "users-roles", to: "/roles", icon: Shield, label: "Roles & Permissions" },
    ],
  },
  {
    id: "projects", icon: FolderKanban, label: "Projects", children: [
      { id: "projects-list", to: "/projects", icon: FolderKanban, label: "Project List" },
  { id: "calendar", to: "/calendar", icon: Calendar, label: "Calendar" },
  { id: "pto", to: "/pto", icon: Clock, label: "Time Off" },
    ],
  },
  { id: "kb", to: "/kb", icon: BookOpen, label: "Knowledge Base" },
  {
    id: "kumo", icon: Database, label: "Kumo", children: [
      { id: "kumo-dashboard", to: "/kumo", icon: LayoutDashboard, label: "Dashboard" },
      { id: "kumo-assets", to: "/kumo/assets", icon: Monitor, label: "Assets" },
      { id: "kumo-passwords", to: "/kumo/passwords", icon: Shield, label: "Passwords" },
      { id: "kumo-configs", to: "/kumo/configs", icon: Server, label: "Configurations" },
      { id: "kumo-documents", to: "/kumo/documents", icon: BookOpen, label: "Documents" },
    ],
  },
  {
    id: "billing", icon: DollarSign, label: "Billing", children: [
      { id: "billing-dashboard", to: "/billing/dashboard", icon: TrendingUp, label: "Finance Dashboard" },
      { id: "billing-invoices", to: "/billing", icon: Receipt, label: "Invoices" },
      { id: "billing-agreements", to: "/billing/agreements", icon: ClipboardList, label: "Agreements" },
      { id: "billing-payments", to: "/billing/payments", icon: CreditCard, label: "Payments" },
      { id: "billing-time", to: "/billing/time", icon: Timer, label: "Time & Expenses" },
      { id: "billing-reports", to: "/billing/reports", icon: BarChart3, label: "Reports" },
    ],
  },
  {
    id: "reports", icon: TrendingUp, label: "Reporting", children: [
      { id: "reports-dashboard", to: "/reports", icon: TrendingUp, label: "Dashboards" },
      { id: "reports-standard", to: "/reports/standard", icon: ClipboardList, label: "Standard Reports" },
      { id: "reports-analytics", to: "/reports/analytics", icon: BarChart3, label: "Analytics" },
    ],
  },
];

function loadExpanded(): Set<string> {
  try {
    const saved = localStorage.getItem("c7_nav_expanded");
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {}
  return new Set(["administration", "clients", "billing"]); // defaults
}

function isNodeActive(node: NavNode, pathname: string): boolean {
  if (node.to && (pathname === node.to || (node.to !== "/" && pathname.startsWith(node.to)))) return true;
  if (node.children) return node.children.some(c => isNodeActive(c, pathname));
  return false;
}

function getPageTitle(nodes: NavNode[], pathname: string): string {
  for (const n of nodes) {
    if (n.to && pathname === n.to) return n.label;
    if (n.children) {
      const found = getPageTitle(n.children, pathname);
      if (found) return found;
    }
  }
  return "Dashboard";
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);

  // ── Drag-and-drop nav order ────────────────────────────────────
  const [navOrder, setNavOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("c7_nav_order");
      if (saved) return JSON.parse(saved) as string[];
    } catch {}
    return NAV_TREE.map(n => n.id);
  });
  const [dragId, setDragId] = useState<string | null>(null);

  const orderedTree = navOrder
    .map(id => NAV_TREE.find(n => n.id === id))
    .filter(Boolean) as NavNode[];

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const newOrder = [...navOrder];
    const fromIdx = newOrder.indexOf(dragId);
    const toIdx = newOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragId);
    setNavOrder(newOrder);
    localStorage.setItem("c7_nav_order", JSON.stringify(newOrder));
    setDragId(null);
  };

  const handleDragEnd = () => setDragId(null);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("c7_nav_expanded", JSON.stringify([...next]));
      return next;
    });
  };

  const renderNode = (node: NavNode, depth: number = 0) => {
    const active = isNodeActive(node, location.pathname);
    const isExpanded = expanded.has(node.id);
    const hasChildren = !!node.children?.length;
    const linkTo = node.to || "#";
    const isDragging = dragId === node.id;
    const isTopLevel = depth === 0;

    return (
      <div
        key={node.id}
        draggable={isTopLevel}
        onDragStart={(e) => isTopLevel && handleDragStart(e, node.id)}
        onDragOver={handleDragOver}
        onDrop={(e) => isTopLevel && handleDrop(e, node.id)}
        onDragEnd={handleDragEnd}
        className={`rounded-lg transition-colors ${isDragging ? "opacity-50" : ""} ${dragId && dragId !== node.id && isTopLevel ? "border border-dashed border-cyber-500/30" : ""}`}
      >
        {hasChildren ? (
          <div className="flex items-center group/drag">
            {isTopLevel && (
              <button
                className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/drag:opacity-100 transition-opacity"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} />
              </button>
            )}
            <button
              onClick={() => toggle(node.id)}
              className={`flex-1 flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-cyber-600/10 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <node.icon size={18} />
              <span className="flex-1 text-left">{node.label}</span>
              <ChevronDown size={14} className={`transition-transform shrink-0 ${isExpanded ? "" : "-rotate-90"}`} />
            </button>
          </div>
        ) : (
          <div className="flex items-center group/drag">
            {isTopLevel && (
              <button
                className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/drag:opacity-100 transition-opacity"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} />
              </button>
            )}
            <Link
              to={linkTo}
              onClick={() => setSidebarOpen(false)}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
              className={`flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={18} />
              {node.label}
              {active && <ChevronRight size={14} className="ml-auto" />}
            </Link>
          </div>
        )}
        {hasChildren && isExpanded && (
          <div className="border-l border-surface-border ml-7">
            {node.children!.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-surface-border flex flex-col transition-transform duration-300 lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-5 h-16 border-b border-surface-border shrink-0">
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setSidebarOpen(false)}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#C42D4B" }}>
              <span className="text-white font-bold text-sm">C7</span>
            </div>
            <span className="font-semibold text-base text-white tracking-tight">NTAX</span>
          </Link>
          <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {orderedTree.map(n => renderNode(n))}
        </nav>
        <div className="border-t border-surface-border p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-sm font-bold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-surface-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-surface/50">
          <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <h1 className="text-base font-semibold text-white truncate ml-2 lg:ml-0">
            {getPageTitle(NAV_TREE, location.pathname)}
          </h1>
          <div className="w-8 lg:hidden" />
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
