import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Cloud, Users, Settings, Menu, X, LogOut, ChevronRight, ChevronDown, GripVertical,
  Target, FolderKanban, Monitor, BookOpen, Shield, FileText, Wrench, Cpu, Activity, TrendingUp, ClipboardList, BarChart3, Receipt, CreditCard, Timer,
  Database, Server, Sparkles, PanelLeftClose, PanelLeftOpen, Search, Calendar, Clock, HelpCircle, UserCircle, Home,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumbs, buildBreadcrumbs } from "./Breadcrumbs";
import { useTheme } from "../hooks/useTheme";
import { Sun, Moon } from "lucide-react";

export type NavNode = {
  id: string;
  to?: string;
  icon: LucideIcon;
  label: string;
  children?: NavNode[];
};

export const NAV_TREE: NavNode[] = [
  { id: "home", to: "/home", icon: Home, label: "Home" },
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
      { id: "admin-cloudconnect", to: "/cloudconnect", icon: Cloud, label: "CloudConnect" },
      { id: "admin-changelog", to: "/admin/changelog", icon: Sparkles, label: "What's New" },
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
      { id: "users-roles", to: "/roles", icon: Shield, label: "Manage Roles" },
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
  return new Set(["administration", "clients", "billing"]);
}

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem("c7_sidebar_collapsed") === "true";
  } catch { return false; }
}

function loadSidebarWidth(): number {
  try {
    const w = localStorage.getItem("c7_sidebar_width");
    if (w) return Math.max(200, Math.min(480, Number(w)));
  } catch {}
  return 256;
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

// ── Section descriptions for header display ───────────────────────
const SECTION_DESCRIPTIONS: Record<string, string> = {
  "/home": "Welcome to C7NTAX — get started with commonly used PSA features.",
  "/": "Real-time, high-level overview of key business metrics, open ticket volumes, and technician workloads.",
  "/tickets": "Track client issues, manage troubleshooting workflows, and log billable time.",
  "/boards": "Monitor service boards with live ticket metrics, stale tracking, and SLA status.",
  "/opportunities": "Manage your sales pipeline, track deal stages, and forecast revenue.",
  "/admin": "Configure company profile, service boards, system settings, and audit logs.",
  "/admin/boards": "Manage service boards, SLA policies, email connectors, and automations.",
  "/admin/system": "System-level configuration for database, backups, and integration settings.",
  "/admin/logs": "View cumulative audit trail and track all changes across the system.",
  "/admin/changelog": "Release history and feature changelog for C7NTAX.",
  "/cloudconnect": "Connect third-party services with 16 available connector types.",
  "/clients": "Browse, search, and manage all client companies and accounts.",
  "/clients/contacts": "Manage contacts across all client organizations.",
  "/assets": "Track hardware, software, and all IT assets across your organization.",
  "/procurement": "Manage purchase orders, vendors, and procurement workflow.",
  "/users": "Create, edit, and manage user accounts with role assignments.",
  "/roles": "Configure granular permissions and role-based access control.",
  "/projects": "View and manage all projects with phases, milestones, and time tracking.",
  "/calendar": "Calendar view of scheduled tasks, deadlines, and events.",
  "/pto": "Manage time-off requests and team availability.",
  "/kb": "Search and browse internal and external knowledge base articles.",
  "/kumo": "IT documentation overview — assets, passwords, configurations, and SOPs.",
  "/kumo/assets": "Flexible assets with custom templates and dynamic fields.",
  "/kumo/passwords": "AES-256 encrypted password vault with TOTP and access logs.",
  "/kumo/configs": "Server, workstation, and network device configurations.",
  "/kumo/documents": "SOPs and documentation with folder organization and revision history.",
  "/billing/dashboard": "Financial overview with invoiced, paid, outstanding, and overdue metrics.",
  "/billing": "Create, send, and track invoices with line items and payment processing.",
  "/billing/agreements": "Manage recurring service agreements and billing schedules.",
  "/billing/payments": "Record and reconcile payments against invoices.",
  "/billing/time": "Track billable and non-billable time entries per ticket and project.",
  "/billing/reports": "Revenue summaries, aging reports, and billing analytics.",
  "/reports": "KPI dashboards with real-time ticket, SLA, and technician metrics.",
  "/reports/standard": "Pre-built reports: ticket volume, SLA, revenue, utilization.",
  "/reports/analytics": "Advanced analytics with visual charts and trend data.",
  "/settings": "Configure your landing page, personal preferences, and account settings.",
  "/settings/ai": "Manage AI inference providers and model configurations.",
  "/mfa-setup": "Set up multi-factor authentication for your account.",
};

function getSectionDescription(pathname: string): string {
  // Exact match first
  if (SECTION_DESCRIPTIONS[pathname]) return SECTION_DESCRIPTIONS[pathname];
  // Try parent path for nested routes (e.g., /tickets/abc123 → /tickets)
  const parts = pathname.split("/");
  while (parts.length > 1) {
    parts.pop();
    const parent = parts.join("/") || "/";
    if (SECTION_DESCRIPTIONS[parent]) return SECTION_DESCRIPTIONS[parent];
  }
  return "";
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

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

  // ── Collapse persistence ───────────────────────────────────────
  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("c7_sidebar_collapsed", String(next));
      return next;
    });
  }, []);

  // ── Resize handling ────────────────────────────────────────────
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(480, e.clientX));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setResizing(false);
      localStorage.setItem("c7_sidebar_width", String(sidebarWidth));
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, sidebarWidth]);

  // Save sidebar width on change
  useEffect(() => {
    if (!resizing) {
      localStorage.setItem("c7_sidebar_width", String(sidebarWidth));
    }
  }, [sidebarWidth, resizing]);

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
    if (collapsed) {
      // In collapsed mode, expand the sidebar to show children
      setCollapsed(false);
      localStorage.setItem("c7_sidebar_collapsed", "false");
    }
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

    // In collapsed mode, top-level items are just icon buttons
    if (collapsed && isTopLevel) {
      return (
        <div key={node.id} className="relative flex justify-center" title={node.label}>
          {hasChildren ? (
            <button
              onClick={() => navigate(`/section/${node.id}`)}
              className={`p-2.5 rounded-lg transition-colors ${
                active ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} />
            </button>
          ) : (
            <Link
              to={linkTo}
              onClick={() => setMobileOpen(false)}
              className={`p-2.5 rounded-lg transition-colors ${
                active ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} />
            </Link>
          )}
          {active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-cyber-500 rounded-full" />}
        </div>
      );
    }

    return (
      <div
        key={node.id}
        draggable={isTopLevel && !collapsed && node.id !== "home"}
        onDragStart={(e) => isTopLevel && !collapsed && node.id !== "home" && handleDragStart(e, node.id)}
        onDragOver={handleDragOver}
        onDrop={(e) => isTopLevel && !collapsed && node.id !== "home" && handleDrop(e, node.id)}
        onDragEnd={handleDragEnd}
        className={`rounded-lg transition-colors ${isDragging ? "opacity-50" : ""} ${dragId && dragId !== node.id && isTopLevel ? "border border-dashed border-cyber-500/30" : ""}`}
      >
        {hasChildren ? (
          <div className="flex items-center group/drag">
            {isTopLevel && !collapsed && node.id !== "home" && (
              <button
                className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/drag:opacity-100 transition-opacity"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} />
              </button>
            )}
            <button
              onClick={() => { toggle(node.id); navigate(`/section/${node.id}`); }}
              className={`flex-1 flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-cyber-600/10 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <node.icon size={18} />
              {!collapsed && <span className="flex-1 text-left truncate">{node.label}</span>}
              {!collapsed && <ChevronDown size={14} className={`transition-transform shrink-0 ${isExpanded ? "" : "-rotate-90"}`} />}
            </button>
          </div>
        ) : (
          <div className="flex items-center group/drag">
            {isTopLevel && !collapsed && node.id !== "home" && (
              <button
                className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/drag:opacity-100 transition-opacity"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={12} />
              </button>
            )}
            <Link
              to={linkTo}
              onClick={() => setMobileOpen(false)}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
              className={`flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={18} />
              {!collapsed && node.label}
              {active && !collapsed && <ChevronRight size={14} className="ml-auto" />}
            </Link>
          </div>
        )}
        {hasChildren && isExpanded && !collapsed && (
          <div className="border-l border-surface-border ml-7">
            {node.children!.map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const sidebarStyle = collapsed
    ? { width: "64px" }
    : { width: `${sidebarWidth}px` };

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 bg-surface border-r border-surface-border flex flex-col shrink-0 transition-all duration-200 lg:relative lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={sidebarStyle}
      >
        {/* Logo + Collapse Toggle */}
        <div className={`flex items-center h-16 border-b border-surface-border shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#C42D4B" }}>
              <span className="text-white font-bold text-sm">C7</span>
            </div>
            {!collapsed && <span className="font-semibold text-base text-white tracking-tight">NTAX</span>}
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleCollapsed}
              className="hidden lg:flex text-gray-500 hover:text-white p-1 rounded transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setMobileOpen(false)}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 py-3 overflow-y-auto ${collapsed ? "px-1.5" : "px-2"}`}>
          <div className={collapsed ? "flex flex-col items-center gap-1" : ""}>
            {orderedTree.map(n => renderNode(n))}
          </div>
        </nav>

        {/* User footer */}
        <div className={`border-t border-surface-border ${collapsed ? "p-2" : "p-3"}`}>
          <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3 px-2 py-2"}`}>
            <div className="w-8 h-8 rounded-full bg-cyber-600/30 text-cyber-400 flex items-center justify-center text-sm font-bold shrink-0">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                </div>
                <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Sign out">
                  <LogOut size={16} />
                </button>
              </>
            )}
            {collapsed && (
              <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors p-1 absolute bottom-3" title="Sign out">
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Resize handle */}
        {!collapsed && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-cyber-500/30 transition-colors group"
            onMouseDown={handleResizeMouseDown}
          >
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-surface-border group-hover:bg-cyber-500/50 transition-colors" />
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-surface-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-surface/50 py-3">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-6">
            <div className="flex items-center gap-3">
              <button className="lg:hidden text-gray-400 hover:text-white p-1 shrink-0" onClick={() => setMobileOpen(true)}>
                <Menu size={20} />
              </button>
              <h1 className="text-base font-semibold text-white truncate">
                {getPageTitle(NAV_TREE, location.pathname)}
                {(() => { const desc = getSectionDescription(location.pathname); return desc ? <span className="text-gray-500 font-normal text-sm ml-2">— {desc}</span> : null; })()}
              </h1>
            </div>
            <Breadcrumbs segments={buildBreadcrumbs(NAV_TREE, location.pathname)} />
          </div>
          {/* Header toolbar — placeholders only */}
          <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
            <button
              onClick={toggleTheme}
              className="px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? (
                <>
                  <Sun size={14} />
                  <span className="hidden lg:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon size={14} />
                  <span className="hidden lg:inline">Dark</span>
                </>
              )}
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Search">
              <Search size={14} />
              <span>Search</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Recent Items">
              <Clock size={14} />
              <span>Recent</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="AI Assistant">
              <Sparkles size={14} />
              <span>AI</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Help">
              <HelpCircle size={14} />
              <span>Help</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Settings">
              <Settings size={14} />
              <span>Settings</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-cyber-400 hover:text-cyber-300 hover:bg-cyber-600/10 rounded-md transition-colors flex items-center gap-1.5" title="My Account">
              <UserCircle size={14} />
              <span>My Account</span>
            </button>
          </div>
          <div className="sm:hidden w-8" />
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
