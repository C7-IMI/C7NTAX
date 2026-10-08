import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useActivityMonitor } from "../hooks/useActivityMonitor";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";
import {
  LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Cloud, Users, Settings, Menu, X, LogOut, ChevronRight, ChevronDown, GripVertical,
  Target, FolderKanban, Monitor, BookOpen, Shield, FileText, Wrench, Cpu, Activity, TrendingUp, ClipboardList, BarChart3, Receipt, CreditCard, Timer,
  Database, Server, Sparkles, PanelLeftClose, PanelLeftOpen, Search, Calendar, Clock, HelpCircle, Home,
  AlertTriangle, XCircle, Settings2, ListOrdered, Globe, Package, Presentation, Filter, Radio,
  MonitorSmartphone, Mail,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumbs, buildBreadcrumbs, BreadcrumbTrailProvider } from "./Breadcrumbs";
import { KumoTrail } from "./KumoTrail";
import { useTheme } from "../hooks/useTheme";
import api from "../api";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import { Permission } from "@C7NTAX/shared";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { MyAccountMenu } from "./MyAccountMenu";
import { UI_P1, UI_P2, UI_KUMO_ORGS, setUiP1, setUiP2 } from "../lib/uiFlags";
import { getDensity, setDensity, type Density } from "../lib/density";

export type NavNode = {
  id: string;
  to?: string;
  icon: LucideIcon;
  label: string;
  /** Hidden from anyone without this permission, mirroring the API gate on the same module. */
  permission?: Permission;
  children?: NavNode[];
};

export const NAV_TREE: NavNode[] = [
  { id: "home", to: "/home", icon: Home, label: "Home" },
  { id: "dashboard", to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { id: "service-alerts", to: "/service-alerts", icon: AlertTriangle, label: "Service Alerts", permission: Permission.ServiceAlertView },
  { id: "tickets", to: "/tickets", icon: Ticket, label: "Tickets", permission: Permission.TicketView },
  { id: "boards", to: "/boards", icon: Columns3, label: "Service Boards", permission: Permission.BoardView },
  { id: "pipeline", to: "/opportunities", icon: Target, label: "Pipeline", permission: Permission.OpportunityView },
  {
    id: "administration", icon: Shield, label: "Administration", children: [
      { id: "admin-configuration", to: "/admin/configuration", icon: Settings, label: "Configuration", permission: Permission.SystemConfig },
      { id: "admin-portal", to: "/admin/portal", icon: Globe, label: "Customer Portal", permission: Permission.ClientView },
      { id: "admin-boards", to: "/admin/boards", icon: Columns3, label: "Service Boards", permission: Permission.BoardManage },
      { id: "admin-service-alerts", to: "/admin/service-alerts", icon: AlertTriangle, label: "Service Alerts", permission: Permission.ServiceAlertManage },
      { id: "admin-monitors", to: "/service-alerts/monitors", icon: Activity, label: "Uptime Monitors", permission: Permission.ServiceAlertManage },
      { id: "admin-webhooks", to: "/admin/webhooks", icon: Radio, label: "Alert Webhooks", permission: Permission.ServiceAlertManage },
      { id: "admin-products", to: "/admin/products", icon: Package, label: "Product Catalog", permission: Permission.ProductView },
      { id: "admin-system", to: "/admin/system", icon: Wrench, label: "System Settings", permission: Permission.SystemConfig },
      { id: "admin-logs", to: "/admin/logs", icon: FileText, label: "Audit Logs", permission: Permission.SystemConfig },
      { id: "admin-cloudconnect", to: "/cloudconnect", icon: Cloud, label: "CloudConnect", permission: Permission.IntegrationManage },
      { id: "admin-ai-actions", to: "/ai-actions", icon: Sparkles, label: "AI Actions", permission: Permission.SystemConfig },
      { id: "admin-changelog", to: "/admin/changelog", icon: Sparkles, label: "What's New" },
    ],
  },
  {
    id: "clients", icon: Building2, label: "Clients", children: [
      { id: "clients-list", to: "/clients", icon: Building2, label: "Client List", permission: Permission.ClientView },
      { id: "clients-contacts", to: "/clients/contacts", icon: Users, label: "Contacts", permission: Permission.ContactView },
    ],
  },
  {
    id: "assets", icon: Monitor, label: "Assets", children: [
      { id: "assets-inventory", to: "/assets", icon: Monitor, label: "Asset Inventory", permission: Permission.AssetView },
      { id: "assets-procurement", to: "/procurement", icon: DollarSign, label: "Procurement", permission: Permission.ProcurementView },
    ],
  },
  {
    id: "users-roles", icon: Users, label: "Users & Roles", children: [
      { id: "users-list", to: "/users", icon: Users, label: "Manage Users", permission: Permission.UserManage },
      { id: "users-roles", to: "/roles", icon: Shield, label: "Manage Roles", permission: Permission.RoleManage },
    ],
  },
  {
    id: "projects", icon: FolderKanban, label: "Projects", children: [
      { id: "projects-list", to: "/projects", icon: FolderKanban, label: "Project List", permission: Permission.ProjectView },
      { id: "calendar", to: "/calendar", icon: Calendar, label: "Calendar", permission: Permission.ScheduleView },
      { id: "pto", to: "/pto", icon: Clock, label: "Time Off", permission: Permission.PTOView },
    ],
  },
  { id: "kb", to: "/kb", icon: BookOpen, label: "Knowledge Base", permission: Permission.KBView },
  {
    id: "kumo", icon: Database, label: "Kumo", permission: Permission.KumoView, children: [
      { id: "kumo-dashboard", to: "/kumo", icon: LayoutDashboard, label: "Dashboard" },
      ...(UI_KUMO_ORGS ? [{ id: "kumo-organizations", to: "/kumo/organizations", icon: Building2, label: "Organizations" }] : []),
      { id: "kumo-assets", to: "/kumo/assets", icon: Monitor, label: "Assets" },
      { id: "kumo-passwords", to: "/kumo/passwords", icon: Shield, label: "Passwords" },
      { id: "kumo-configs", to: "/kumo/configs", icon: Server, label: "Configurations" },
      { id: "kumo-documents", to: "/kumo/documents", icon: BookOpen, label: "Documents" },
      { id: "kumo-checklists", to: "/kumo/checklists", icon: ClipboardList, label: "Checklists" },
      ...(UI_KUMO_ORGS ? [{ id: "kumo-domains", to: "/kumo/domains", icon: Globe, label: "Domains & Certs" }] : []),
    ],
  },
  {
    id: "billing", icon: DollarSign, label: "Billing", permission: Permission.BillingView, children: [
      { id: "billing-dashboard", to: "/billing/dashboard", icon: TrendingUp, label: "Finance Dashboard" },
      { id: "billing-invoices", to: "/billing", icon: Receipt, label: "Invoices" },
      { id: "billing-agreements", to: "/billing/agreements", icon: ClipboardList, label: "Agreements", permission: Permission.ServiceAgreementView },
      { id: "billing-payments", to: "/billing/payments", icon: CreditCard, label: "Payments", permission: Permission.PaymentView },
      { id: "billing-time", to: "/billing/time", icon: Timer, label: "Time & Expenses" },
      { id: "billing-reports", to: "/billing/reports", icon: BarChart3, label: "Reports" },
      { id: "billing-quotes", to: "/quotes", icon: ClipboardList, label: "Quotes", permission: Permission.BillingView },
    ],
  },
  {
    id: "reports", icon: TrendingUp, label: "Reporting", permission: Permission.ReportView, children: [
      { id: "reports-dashboard", to: "/reports", icon: TrendingUp, label: "Dashboards" },
      { id: "reports-standard", to: "/reports/standard", icon: ClipboardList, label: "Standard Reports" },
      { id: "reports-reviews", to: "/reports/reviews", icon: Presentation, label: "Business Reviews" },
      { id: "reports-custom", to: "/reports/custom", icon: Filter, label: "Custom Reports" },
      { id: "reports-analytics", to: "/reports/analytics", icon: BarChart3, label: "Analytics" },
    ],
  },
  {
    // C7NC — the C7NTAX companion clients. A parent section rather than a page under
    // Administration because these are things a *user* installs on their own machine, not
    // settings an administrator changes, and a technician should not have to find them behind
    // a settings screen. Deliberately carries no permission: the download is offered to anyone
    // who can sign in, and the deployment facts behind it are gated by the API.
    id: "c7nc", icon: MonitorSmartphone, label: "C7NC", children: [
      { id: "c7nc-outlook", to: "/c7nc/outlook-addin", icon: Mail, label: "Outlook Add-in" },
    ],
  },
  {
    id: "help", icon: HelpCircle, label: "Help", children: [
      { id: "help-home", to: "/help", icon: HelpCircle, label: "Help Home" },
      { id: "help-getting-started", to: "/help/getting-started", icon: BookOpen, label: "Getting Started" },
      { id: "help-faq", to: "/help/faq", icon: HelpCircle, label: "FAQ" },
      { id: "help-configuration", to: "/help/configuration", icon: Settings2, label: "Configuration" },
      { id: "help-index", to: "/help/index", icon: ListOrdered, label: "Index" },
    ],
  },
];

/**
 * Drop what the signed-in role cannot reach, so the navigation never advertises a page
 * whose API calls would come back 403. A group disappears once all of its children do.
 */
export function filterNavByPermission(nodes: NavNode[], permissions: string[]): NavNode[] {
  const out: NavNode[] = [];
  for (const node of nodes) {
    const allowed = !node.permission || permissions.includes(node.permission);
    if (node.children) {
      const children = filterNavByPermission(node.children, permissions);
      if (allowed && children.length) out.push({ ...node, children });
      continue;
    }
    if (allowed) out.push(node);
  }
  return out;
}

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
  // The most specific match wins, so nested routes (/kumo/organizations/:id)
  // report their own section instead of falling through to Dashboard.
  const matches: { to: string; label: string }[] = [];
  const walk = (list: NavNode[]): void => {
    for (const n of list) {
      if (n.to && (pathname === n.to || pathname.startsWith(n.to + "/"))) matches.push({ to: n.to, label: n.label });
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  if (matches.length === 0) return "Dashboard";
  return matches.reduce((a, b) => (b.to.length > a.to.length ? b : a)).label;
}

// ── Section descriptions for header display ───────────────────────
const SECTION_DESCRIPTIONS: Record<string, string> = {
  "/home": "Welcome to C7NTAX — get started with commonly used PSA features.",
  "/": "Real-time, high-level overview of key business metrics, open ticket volumes, and technician workloads.",
  "/tickets": "Track client issues, manage troubleshooting workflows, and log billable time.",
  "/boards": "Monitor service boards with live ticket metrics, stale tracking, and SLA status.",
  "/service-alerts": "Aggregate outage monitoring for Microsoft 365, Azure, AWS, GitHub, ISPs, and other configured services.",
  "/admin/service-alerts": "Configure monitored services, RSS feeds, and alert monitoring settings.",
  "/opportunities": "Manage your sales pipeline, track deal stages, and forecast revenue.",
  "/admin": "Every setting the application reads, where its value comes from, and what changing it affects.",
  "/admin/configuration": "Every setting the application reads, where its value comes from, and what changing it affects.",
  "/admin/portal": "Whether customers have a portal, what it lets them see and do, and which clients may use it.",
  "/admin/webhooks": "Outbound endpoints that receive alert events, with their delivery log.",
  "/service-alerts/monitors": "Website, SSL-expiry and DNS checks on targets you name: a failure raises a Service Alert.",
  "/quotes": "Quote a piece of work from the product catalog and track it to acceptance.",
  "/ai-actions": "Risk-classified AI proposals awaiting review, and the record of what was approved.",
  "/admin/boards": "Manage service boards, SLA policies, email connectors, and automations.",
  "/admin/system": "This instance's operational state, its deployment facts, and a signpost to every setting.",
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
  "/kumo/organizations": "Client list with per-client Kumo documentation coverage.",
  "/kumo/assets": "Flexible assets with custom templates and dynamic fields.",
  "/kumo/passwords": "AES-256 encrypted password vault with TOTP and access logs.",
  "/kumo/configs": "Server, workstation, and network device configurations.",
  "/kumo/documents": "SOPs and documentation with folder organization and revision history.",
  "/kumo/domains": "Domains and certificates with their expiry dates and renewal status.",
  "/billing/dashboard": "Financial overview with invoiced, paid, outstanding, and overdue metrics.",
  "/billing": "Create, send, and track invoices with line items and payment processing.",
  "/billing/agreements": "Manage recurring service agreements and billing schedules.",
  "/billing/payments": "Record and reconcile payments against invoices.",
  "/billing/time": "Track billable and non-billable time entries per ticket and project.",
  "/billing/reports": "Revenue summaries, aging reports, and billing analytics.",
  "/reports": "KPI dashboards with real-time ticket, SLA, and technician metrics.",
  "/reports/standard": "Pre-built reports: ticket volume, SLA, revenue, utilization.",
  "/reports/qbr": "A quarterly business review pack: service delivery, commercials, estate and risk against the quarter before.",
  "/reports/reviews": "Business reviews at weekly, monthly or quarterly cadence, each against the period before.",
  "/reports/custom": "Saved reports built on the reporting engine, with their schedules.",
  "/reports/custom/:id/design": "The banded report designer: bands, fields, expressions, totals and a page preview.",
  "/reports/analytics": "Advanced analytics with visual charts and trend data.",
  "/c7nc": "C7NTAX companion clients — the add-ins and apps that put C7NTAX inside the tools you already work in.",
  "/c7nc/outlook-addin": "Install the Outlook add-in, which turns the email you are reading into a C7NTAX ticket.",
  "/section/c7nc": "C7NTAX companion clients — the add-ins and apps that put C7NTAX inside the tools you already work in.",
  "/help": "Documentation home — guided setup, FAQ, configuration reference, and a cross-linked index.",
  "/help/getting-started": "First login, the core ticket workflow, and team & boards setup.",
  "/help/faq": "Answers to common questions about tickets, billing, integrations, and Kumo.",
  "/help/configuration": "Reference for service boards, uptime monitors, CloudConnect connectors, and identity settings.",
  "/help/index": "Index of every help topic mapped to its product area.",
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
  const { user, logout, permissions, session, extendSession } = useAuth();

  // A cookie session can idle out; a bearer-token client cannot, so the warning is only
  // shown where it means something (PLAN-001 §3.2).
  const { showWarning, secondsRemaining, dismissWarning } = useActivityMonitor({
    timeoutMs: session.timeoutMinutes * 60 * 1000,
    enabled: session.cookieMode,
    onTimeout: () => logout(),
  });

  // Staying signed in clears the warning itself. Waiting for the next activity event would
  // work for a mouse click but not for a keyboard or assistive-technology activation, and a
  // failed extension is left to the API's 401 handling so the sign-in page keeps the reason.
  const staySignedIn = useCallback(async () => {
    const extended = await extendSession();
    if (extended !== false) dismissWarning();
    return extended;
  }, [extendSession, dismissWarning]);

  // The navigation only offers what the API will actually serve for this role.
  const visibleTree = useMemo(() => filterNavByPermission(NAV_TREE, permissions), [permissions]);
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [density, setDensityState] = useState<Density>(getDensity);
  const sidebarRef = useRef<HTMLElement>(null);

  // ── P1: command palette items (pages from the nav tree + quick actions) ──
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const pages: PaletteItem[] = [];
    const walk = (nodes: NavNode[], group?: string) => {
      for (const n of nodes) {
        if (n.to) pages.push({ id: n.id, label: n.label, group: group ?? "Pages", keywords: n.id, run: () => navigate(n.to as string) });
        if (n.children) walk(n.children, n.label);
      }
    };
    walk(visibleTree);
    const actions: PaletteItem[] = [
      { id: "act-new-ticket", label: "New Ticket", group: "Actions", keywords: "create ticket new", run: () => navigate("/tickets") },
      { id: "act-theme", label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", group: "Actions", run: toggleTheme },
      {
        id: "act-density",
        label: density === "compact" ? "Use comfortable spacing" : "Use compact spacing",
        group: "Actions",
        run: () => {
          const next: Density = density === "compact" ? "comfortable" : "compact";
          setDensityState(next);
          setDensity(next);
        },
      },
      {
        id: "act-ui-p1",
        label: "Turn off modern UI (P1)",
        group: "Actions",
        keywords: "rollback revert disable",
        run: () => {
          setUiP1(false);
          window.location.reload();
        },
      },
      {
        id: "act-ui-p2",
        label: "Turn off look-and-feel polish (P2)",
        group: "Actions",
        keywords: "rollback revert disable shadows typography",
        run: () => {
          setUiP2(false);
          window.location.reload();
        },
      },
    ];
    return [...pages, ...actions];
  }, [navigate, theme, toggleTheme, density]);

  // ── P1: ⌘K / Ctrl-K toggles the command palette ──
  useEffect(() => {
    if (!UI_P1) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Drag-and-drop nav order ────────────────────────────────────
  // Saved order is reconciled with NAV_TREE on load: unknown ids are dropped
  // and any new top-level ids are inserted at their default position, so
  // newly added nav sections (e.g. Service Alerts) never disappear for users
  // with a previously persisted order.
  const [navOrder, setNavOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("c7_nav_order");
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const known = new Set(NAV_TREE.map(n => n.id));
        const merged = parsed.filter(id => known.has(id));
        let changed = merged.length !== parsed.length;
        NAV_TREE.forEach((node, idx) => {
          if (merged.includes(node.id)) return;
          changed = true;
          let insertAt = merged.length;
          for (let i = idx - 1; i >= 0; i--) {
            const prev = NAV_TREE[i];
            if (!prev) continue;
            const pos = merged.indexOf(prev.id);
            if (pos !== -1) { insertAt = pos + 1; break; }
          }
          merged.splice(insertAt, 0, node.id);
        });
        if (changed) localStorage.setItem("c7_nav_order", JSON.stringify(merged));
        return merged;
      }
    } catch {}
    return NAV_TREE.map(n => n.id);
  });
  const [dragId, setDragId] = useState<string | null>(null);

  // ── FI-060: Service Alerts banner + nav badge ──────────────────
  interface BannerAlert {
    id: string;
    serviceName: string;
    title: string;
    severity: string;
    detectedAt: string;
    sourceUrl: string | null;
  }
  const [alertCount, setAlertCount] = useState(0);
  const [bannerAlert, setBannerAlert] = useState<BannerAlert | null>(null);

  // Dismissed alert ids are read FRESH from localStorage on every poll and
  // dismissal, so no stale closure can resurrect a dismissed banner.
  const loadDismissed = (): Set<string> => {
    try {
      const saved = localStorage.getItem("c7_sa_dismissed");
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch { /* ignore */ }
    return new Set<string>();
  };

  const refreshAlertStatus = useCallback(() => {
    api.get("/service-alerts/status")
      .then(r => {
        const { activeCount, top } = r.data || {};
        setAlertCount(Number(activeCount) || 0);
        const dismissed = loadDismissed();
        if (top && !dismissed.has(top.id)) setBannerAlert(top);
        else setBannerAlert(null);
      })
      .catch(() => {});
  }, []);

  // TOKEN-SAVE-06: initial fetch + visibility-gated polling
  useEffect(() => { refreshAlertStatus(); }, [refreshAlertStatus]);
  useVisibilityPolling(refreshAlertStatus, 60_000);

  const dismissBanner = () => {
    if (!bannerAlert) return;
    // Persist the dismissal synchronously FIRST, then hide.
    const next = loadDismissed();
    next.add(bannerAlert.id);
    const arr = [...next];
    while (arr.length > 50) arr.shift();
    localStorage.setItem("c7_sa_dismissed", JSON.stringify(arr));
    setBannerAlert(null);
  };

  const orderedTree = navOrder
    .map(id => visibleTree.find(n => n.id === id))
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
    // Service Alerts reads as a live alert channel rather than a page, so its label and icon
    // carry the alert colour (matching its count badge) instead of the neutral nav grey.
    const isAlerts = node.id === "service-alerts";

    // In collapsed mode, top-level items are just icon buttons
    if (collapsed && isTopLevel) {
      return (
        <div key={node.id} className="relative flex justify-center" title={node.label}>
          {hasChildren ? (
            <button
              onClick={() => navigate(`/section/${node.id}`)}
              className={`relative p-2.5 rounded-lg transition-colors ${
                active ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} />
              {node.id === "service-alerts" && alertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{alertCount}</span>
              )}
            </button>
          ) : (
            <Link
              to={linkTo}
              onClick={() => setMobileOpen(false)}
              className={`relative p-2.5 rounded-lg transition-colors ${
                active ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} className={isAlerts ? "text-alert-red" : undefined} />
              {node.id === "service-alerts" && alertCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{alertCount}</span>
              )}
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
              className={`nav-item flex-1 flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "nav-item--active bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <node.icon size={18} />
              {!collapsed && <span className="flex-1 text-left truncate">{node.label}</span>}
              {!collapsed && node.id === "service-alerts" && alertCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center" title={`${alertCount} active service alert${alertCount === 1 ? "" : "s"}`}>{alertCount}</span>
              )}
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
              className={`nav-item flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "nav-item--active bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={18} className={isAlerts ? "text-alert-red" : undefined} />
              {!collapsed && (isAlerts ? <span className="text-alert-red">{node.label}</span> : node.label)}
              {!collapsed && node.id === "service-alerts" && alertCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center" title={`${alertCount} active service alert${alertCount === 1 ? "" : "s"}`}>{alertCount}</span>
              )}
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
    <BreadcrumbTrailProvider>
    <div
      className="flex h-screen overflow-hidden bg-navy-950"
      data-ui-p1={UI_P1 ? "true" : "false"}
      data-ui-p2={UI_P2 ? "true" : "false"}
    >
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
          <Link to="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)} aria-label="C7NTAX">
            <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
            {!collapsed && (
              <span className="font-semibold text-base text-white tracking-tight">
                C<span className="text-cyber-400">7</span>NTAX
              </span>
            )}
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
          <div className={`flex items-center ${collapsed ? "flex-col gap-1.5" : "gap-3 px-2 py-2"}`}>
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
              <button onClick={logout} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Sign out">
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
          {/* Header toolbar */}
          <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
            <button
              onClick={() => { if (UI_P1) setPaletteOpen(true); }}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
              title={UI_P1 ? "Search (Ctrl/⌘ K)" : "Search"}
            >
              <Search size={14} />
              <span>Search</span>
              {UI_P1 && <kbd className="hidden lg:inline text-[10px] text-gray-500 border border-surface-border rounded px-1">⌘K</kbd>}
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Recent Items">
              <Clock size={14} />
              <span>Recent</span>
            </button>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="AI Assistant">
              <Sparkles size={14} />
              <span>AI</span>
            </button>
            <Link to="/help" className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Help">
              <HelpCircle size={14} />
              <span>Help</span>
            </Link>
            <button className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5" title="Settings">
              <Settings size={14} />
              <span>Settings</span>
            </button>
            <MyAccountMenu />
          </div>
          <div className="sm:hidden w-8" />
        </header>
        {/* ── FI-060: Global service outage banner (below header, above content) ── */}
        {bannerAlert && (
          <div
            role="alert"
            onClick={() => navigate("/service-alerts")}
            className="service-alert-banner border-b px-4 lg:px-6 py-2.5 flex items-center gap-3 cursor-pointer select-none shrink-0"
            title="Click for more details"
          >
            <AlertTriangle size={16} className="service-alert-banner__icon shrink-0" />
            <span className="service-alert-banner__message text-sm flex-1 min-w-0 truncate">
              {/possible service interruption|reported for/i.test(bannerAlert.title)
                ? bannerAlert.title
                : `Possible Service Interruption has been reported for ${bannerAlert.serviceName}`}
              {bannerAlert.title.includes(".") ? " " : ". "}
              <span className="service-alert-banner__details underline underline-offset-2 font-medium">Click here for more details.</span>
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); dismissBanner(); }}
              className="service-alert-banner__dismiss shrink-0 p-1 rounded transition-colors"
              title="Dismiss alert"
              aria-label="Dismiss alert"
            >
              <XCircle size={16} />
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <KumoTrail segments={buildBreadcrumbs(NAV_TREE, location.pathname)} />
          {children}
        </main>
      </div>
      {UI_P1 && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />}
      <SessionTimeoutWarning
        visible={showWarning}
        secondsRemaining={secondsRemaining}
        onExtend={staySignedIn}
        onLogout={logout}
      />
    </div>
    </BreadcrumbTrailProvider>
  );
}
