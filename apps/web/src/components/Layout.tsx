import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import { useActivityMonitor } from "../hooks/useActivityMonitor";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";
import { AppFooter } from "./AppFooter";
import { ConsoleDialog } from "./ConsoleDialog";
import { RecentActivityMenu } from "./RecentActivityMenu";
import { NavPaneModern } from "./NavPaneModern";
import { FAVORITES_NODE_ID } from "../lib/navModel";
import { useNavigationSettings } from "../hooks/useNavigationStyle";
import {
  LayoutDashboard, Ticket, Columns3, Building2, DollarSign, Users, Settings, Menu, X, LogOut, ChevronRight, ChevronDown, GripVertical, Plus,
  Target, FolderKanban, Monitor, BookOpen, Shield, FileText, Wrench, Cpu, Activity, TrendingUp, ClipboardList, BarChart3, Receipt, CreditCard, Timer,
  Database, Server, Sparkles, PanelLeftClose, PanelLeftOpen, Search, Calendar, Clock, HelpCircle, Home,
  AlertTriangle, XCircle, Settings2, ListOrdered, Globe, Package, Presentation, Filter, Radio, Bot,
  MonitorSmartphone, Mail, KeyRound, Plug,
  Star, StarOff, Link2, AppWindow, SquareArrowOutUpRight, ChevronsUpDown, ChevronsDownUp, ChevronUp,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumbs, buildBreadcrumbs, BreadcrumbTrailProvider } from "./Breadcrumbs";
import { KumoTrail } from "./KumoTrail";
import { STANDALONE_PAGE_TITLES } from "../lib/pageTitles";
import { useTheme } from "../hooks/useTheme";
import api from "../api";
import { useVisibilityPolling } from "../hooks/useVisibilityPolling";
import { useConsoleEnabled } from "../hooks/useConsoleEnabled";
import { useDwellActivity } from "../hooks/useRecentActivity";
import { useArrivalHighlight } from "../hooks/useArrivalHighlight";
import { Permission } from "@C7NTAX/shared";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { MyAccountMenu } from "./MyAccountMenu";
import { UI_P1, UI_P2, UI_KUMO_ORGS, setUiP1, setUiP2 } from "../lib/uiFlags";
import { getDensity, setDensity, type Density } from "../lib/density";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "./ContextMenu";
import { absoluteUrl, copyText, openInNewTab, openInNewWindow } from "../lib/menuActions";

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
      { id: "admin-sso", to: "/admin/sso", icon: KeyRound, label: "Single Sign-On", permission: Permission.SecurityManage },
      { id: "admin-portal", to: "/admin/portal", icon: Globe, label: "Customer Portal", permission: Permission.ClientView },
      { id: "admin-boards", to: "/admin/boards", icon: Columns3, label: "Service Boards", permission: Permission.BoardManage },
      { id: "admin-service-alerts", to: "/admin/service-alerts", icon: AlertTriangle, label: "Service Alerts", permission: Permission.ServiceAlertManage },
      { id: "admin-monitors", to: "/service-alerts/monitors", icon: Activity, label: "Uptime Monitors", permission: Permission.ServiceAlertManage },
      { id: "admin-webhooks", to: "/admin/webhooks", icon: Radio, label: "Alert Webhooks", permission: Permission.ServiceAlertManage },
      { id: "admin-products", to: "/admin/products", icon: Package, label: "Product Catalog", permission: Permission.ProductView },
      { id: "admin-system", to: "/admin/system", icon: Wrench, label: "System Settings", permission: Permission.SystemConfig },
      { id: "admin-logs", to: "/admin/logs", icon: FileText, label: "Audit Logs", permission: Permission.SystemConfig },
      { id: "admin-api", to: "/admin/api", icon: KeyRound, label: "API Access", permission: Permission.UserManage },
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
  { id: "assistant", to: "/assistant", icon: Bot, label: "Assistant", permission: Permission.InferenceView },
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
    // C7NC — everything that connects C7NTAX to something else: the services, the model that
    // answers, the mailboxes that file tickets, and the apps a person installs. A parent section
    // rather than a page under Administration, because a connector is a relationship rather than a
    // setting, and because the companion apps were always here. The children mirror the section's
    // own tabs, so the nav and the tab strip never disagree about where you are.
    id: "c7nc", icon: MonitorSmartphone, label: "C7NC", children: [
      { id: "c7nc-overview", to: "/c7nc", icon: LayoutDashboard, label: "Overview", permission: Permission.IntegrationView },
      // Reading a connection needs IntegrationView — the permission every read endpoint already
      // requires — and changing one needs IntegrationManage. The nav used to ask for the stronger
      // of the two for the whole page, which kept the connection health out of reach of the people
      // who watch it.
      { id: "c7nc-services", to: "/c7nc/services", icon: Plug, label: "Services", permission: Permission.IntegrationView },
      { id: "c7nc-models", to: "/c7nc/models", icon: Bot, label: "AI models", permission: Permission.InferenceView },
      { id: "c7nc-email", to: "/c7nc/email", icon: Mail, label: "Email", permission: Permission.IntegrationView },
      // FlexPoint lives here because it is a service the business already runs, listed beside the
      // others that connect to this one. Unlike the connectors it carries a permission, because
      // everything on its page besides the reading is a write to a financial system.
      { id: "c7nc-flexpoint", to: "/c7nc/flexpoint", icon: CreditCard, label: "FlexPoint Payment Solutions", permission: Permission.IntegrationManage },
      { id: "c7nc-apps", to: "/c7nc/apps", icon: MonitorSmartphone, label: "Companion apps" },
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
  // Nothing saved yet: the sections that are open by default. Favorites is always open, so an
  // empty one says what to do with it rather than hiding the feature behind a collapsed header.
  return new Set(["administration", "clients", "billing", FAVORITES_NODE_ID]);
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

/**
 * The Favorites section's own id. It is not part of NAV_TREE — nothing navigates to it — but it
 * shares the nav's expanded-state set, so one key covers both the tree and this section.
 */
/**
 * Named here rather than defined: the modern pane's rail opens the same list, so the id lives in the
 * model both panes read. Re-exported because this is where the rest of the pane's code — and anybody
 * extending it — expects to find it.
 */
export { FAVORITES_NODE_ID };

function loadFavorites(): string[] {
  try {
    const saved = localStorage.getItem("c7_nav_favorites");
    if (saved) {
      const parsed = JSON.parse(saved) as string[];
      // A pinned id that no longer exists in the tree is dropped, so a renamed or removed section
      // cannot leave a dead entry behind — the same reconciliation the saved nav order gets.
      const known = new Set(walkNav(NAV_TREE).map(({ node }) => node.id));
      return parsed.filter(id => known.has(id));
    }
  } catch {}
  return [];
}

/**
 * The pins are the account's, so they follow the person from machine to machine. localStorage is
 * kept as a first-paint cache: the navigation draws the pins it already knows before the API has
 * answered, and the account's list replaces it a moment later. A machine that has never seen this
 * account starts empty and fills in.
 */
function saveFavorites(ids: string[]): void {
  try { localStorage.setItem("c7_nav_favorites", JSON.stringify(ids)); } catch {}
}

/** Every node in a tree, paired with the section it sits under. */
function walkNav(nodes: NavNode[], parent: NavNode | null = null, depth = 0): { node: NavNode; parent: NavNode | null; depth: number }[] {
  return nodes.flatMap(node => [{ node, parent, depth }, ...(node.children ? walkNav(node.children, node, depth + 1) : [])]);
}

/** The ids of every section that can be opened and closed — what "expand all" acts on. */
export function collapsibleNavIds(nodes: NavNode[]): string[] {
  return walkNav(nodes).filter(({ node }) => !!node.children?.length).map(({ node }) => node.id);
}

/**
 * Open and closed state is per row rather than per section: a pinned copy starts closed and opens
 * on its own, so pinning a large section does not pour its children into Favorites, and closing it
 * there does not close the section you were reading in the tree.
 */
const expandKeyFor = (node: NavNode, options: { favorite?: boolean } = {}) =>
  options.favorite ? `${FAVORITES_NODE_ID}:${node.id}` : node.id;

/** To the menu code Favorites is a section like any other; nothing navigates to it. */
const FAVORITES_SECTION: NavNode = { id: FAVORITES_NODE_ID, icon: Star, label: "Favorites" };

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
  if (matches.length === 0) return STANDALONE_PAGE_TITLES[pathname] ?? "Dashboard";
  return matches.reduce((a, b) => (b.to.length > a.to.length ? b : a)).label;
}

// ── Section descriptions for header display ───────────────────────
const SECTION_DESCRIPTIONS: Record<string, string> = {
  "/home": "Welcome to C7NTAX — get started with commonly used PSA features.",
  "/": "Key metrics, ticket volumes, and technician workload.",
  "/tickets": "Client issues, troubleshooting, and billable time.",
  "/boards": "Live ticket metrics, stale tracking, and SLA status.",
  "/service-alerts": "Outage monitoring for the services you watch.",
  "/admin/service-alerts": "Monitored services, RSS feeds, and monitoring settings.",
  "/opportunities": "Manage your sales pipeline, track deal stages, and forecast revenue.",
  "/admin": "Every setting the app reads and where its value comes from.",
  "/admin/configuration": "Every setting the app reads and where its value comes from.",
  "/admin/portal": "Whether customers have a portal, and which clients may use it.",
  "/admin/webhooks": "Endpoints that receive alert events, and their delivery log.",
  "/admin/sso": "Sign in through your identity provider, and who is allowed to do so.",
  "/service-alerts/monitors": "Website, SSL and DNS checks — a failure raises an alert.",
  "/quotes": "Quote a piece of work from the product catalog and track it to acceptance.",
  "/ai-actions": "AI proposals awaiting review, and what was approved.",
  "/assistant": "Ask the model a question; see which functions it used.",
  "/admin/boards": "Service boards, SLA policies, email connectors, automations.",
  "/admin/system": "This instance's state, deployment facts, and every setting.",
  "/admin/logs": "View cumulative audit trail and track all changes across the system.",
  "/admin/changelog": "Release history and feature changelog for C7NTAX.",
  "/c7nc": "Everything that connects C7NTAX to something else.",
  "/c7nc/services": "What each connector brought in, and whether it is healthy.",
  "/c7nc/models": "Which model answers, and what it is allowed to do.",
  "/c7nc/email": "Mailboxes that turn email into tickets, and where it is filed.",
  "/c7nc/flexpoint": "Accounts receivable from FlexPoint's merchant API.",
  "/c7nc/apps": "Companion apps that put C7NTAX inside your own tools.",
  "/c7nc/outlook-addin": "Install the add-in that turns an email into a ticket.",
  "/section/c7nc": "C7NC — everything that connects C7NTAX to something else.",
  "/admin/api": "Issue the API keys other systems use, and file their alerts.",
  "/clients": "Browse, search, and manage all client companies and accounts.",
  "/clients/contacts": "Manage contacts across all client organizations.",
  "/assets": "Hardware, software, and every other IT asset.",
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
  "/kumo/domains": "Domains and certificates, with expiry and renewal.",
  "/billing/dashboard": "Invoiced, paid, outstanding, and overdue figures.",
  "/billing": "Create, send, and track invoices with line items and payment processing.",
  "/billing/agreements": "Manage recurring service agreements and billing schedules.",
  "/billing/payments": "Record and reconcile payments against invoices.",
  "/billing/time": "Billable and non-billable time, by ticket and project.",
  "/billing/reports": "Revenue summaries, aging reports, and billing analytics.",
  "/reports": "KPI dashboards with real-time ticket, SLA, and technician metrics.",
  "/reports/standard": "Pre-built reports: ticket volume, SLA, revenue, utilization.",
  "/reports/qbr": "Quarterly pack: delivery, commercials, estate and risk.",
  "/reports/reviews": "Reviews at weekly, monthly or quarterly cadence.",
  "/reports/custom": "Saved reports built on the reporting engine, with their schedules.",
  "/reports/custom/:id/design": "The banded report designer: bands, fields, expressions, totals and a page preview.",
  "/reports/analytics": "Advanced analytics with visual charts and trend data.",
  "/help": "Guided setup, FAQ, and the configuration reference.",
  "/help/getting-started": "First login, the core ticket workflow, and team & boards setup.",
  "/help/faq": "Answers to common questions about tickets, billing, integrations, and Kumo.",
  "/help/configuration": "Service boards, monitors, connectors, and identity.",
  "/help/index": "Index of every help topic mapped to its product area.",
  "/settings": "Configure your landing page, personal preferences, and account settings.",
  "/settings/ai": "Manage AI inference providers and model configurations.",
  "/mfa-setup": "Set up multi-factor authentication for your account.",
  "/activity": "Your own changes, and the pages you stayed on.",
  "/console": "Run commands against this instance, or via the c7ntax CLI.",
};

function getSectionDescription(pathname: string): string {
  // Exact match first
  if (SECTION_DESCRIPTIONS[pathname]) return SECTION_DESCRIPTIONS[pathname];
  // Try parent path for nested routes (e.g., /tickets/abc123 → /tickets)
  const parts = pathname.split("/");
  while (parts.length > 1) {
    parts.pop();
    const parent = parts.join("/");
    // An empty parent is the root of a one-segment path, not a section worth inheriting from: falling
    // back to "/" here gave every top-level page the Dashboard's blurb (`/console` explained itself as
    // "key metrics, ticket volumes, and technician workload").
    if (parent && SECTION_DESCRIPTIONS[parent]) return SECTION_DESCRIPTIONS[parent];
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

  /**
   * Which navigation pane to draw. The instance's setting decides, this browser can disagree with it,
   * and a build can turn the modern pane off outright — see `useNavigationStyle`.
   */
  const navigation = useNavigationSettings();
  const modernNav = navigation.style === "modern";
  // The redesigned screens compact the chrome that every page shares, which is the header here.
  const redesign = navigation.interfaceStyle === "redesign";
  /*
   * The modern *theme* hangs off this attribute, the way density and P2 do, so one stylesheet can
   * restyle every page in the application and the classic interface keeps every rule it has always
   * had. The palette is deliberately not part of it: colour schemes are the user's choice, and this
   * is about structure, density and type rather than about replacing them.
   */
  useEffect(() => {
    document.documentElement.setAttribute("data-ui-redesign", redesign ? "true" : "false");
  }, [redesign]);
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const consoleEnabled = useConsoleEnabled();
  // A page that holds someone's attention for two minutes is an activity; a page passed through is not.
  useDwellActivity();
  // And arriving from the Recent menu lands on the region the link meant, rather than the page top.
  useArrivalHighlight();
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

  // ── ⌘. / Ctrl-. toggles the console (PLAN-028 §10) ──
  useEffect(() => {
    if (!consoleEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setConsoleOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [consoleEnabled]);

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

  // ── Favorites: any section, pinned and shown again at the top ──
  // A pin is a view, not a move: the section keeps its place in the tree and a second copy of it
  // is drawn under Favorites. The order is its own, rearranged by dragging just like the tree's,
  // and kept in localStorage beside `c7_nav_order` so the two layouts behave the same way.
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [favoriteDragId, setFavoriteDragId] = useState<string | null>(null);
  const navMenu = useContextMenu();
  const favoritesOpen = expanded.has(FAVORITES_NODE_ID);
  /** Set once the person has changed their pins, so a slow first read cannot undo them. */
  const favoritesTouched = useRef(false);
  const nodeById = useMemo(() => new Map(walkNav(visibleTree).map(({ node }) => [node.id, node])), [visibleTree]);
  // A section the signed-in role cannot reach is not drawn, whatever is pinned — the pin survives,
  // so it comes back if the permission does.
  const pinnedNodes = useMemo(
    () => favorites.map(id => nodeById.get(id)).filter((node): node is NavNode => !!node),
    [favorites, nodeById],
  );

  const updateFavorites = useCallback((next: string[]) => {
    favoritesTouched.current = true;
    saveFavorites(next);
    setFavorites(next);
    // The account is the record; the cache above only spares the navigation a flicker next time.
    api.put("/nav/favorites", { favorites: next }).catch(() => {
      toast.error("Those pins could not be saved to your account", { id: "nav-favorites-save" });
    });
  }, []);

  // ── Favorites come from the account ────────────────────────────
  // The list is per user, so it is the same on any machine. Anything pinned in this browser before
  // the account kept them is offered up once, rather than being lost to an account with nothing
  // saved — after that the account decides, and the browser is only a cache.
  useEffect(() => {
    let active = true;
    const beforeAnythingWasSaved = loadFavorites();
    api.get("/nav/favorites")
      .then(async (res) => {
        if (!active || favoritesTouched.current) return;
        const stored: string[] = Array.isArray(res.data?.favorites) ? res.data.favorites : [];
        if (!res.data?.personalised && beforeAnythingWasSaved.length > 0) {
          const { data } = await api.put("/nav/favorites", { favorites: beforeAnythingWasSaved });
          if (!active) return;
          const adopted: string[] = Array.isArray(data?.favorites) ? data.favorites : beforeAnythingWasSaved;
          saveFavorites(adopted);
          setFavorites(adopted);
          return;
        }
        saveFavorites(stored);
        setFavorites(stored);
      })
      .catch(() => {
        // No answer: the cache stands in, and the next pin writes again.
      });
    return () => { active = false; };
  }, []);

  const expandSection = useCallback((id: string) => {
    setExpanded(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      localStorage.setItem("c7_nav_expanded", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const pinNode = useCallback((id: string, label: string) => {
    if (favorites.includes(id)) return;
    updateFavorites([...favorites, id]);
    // A pin nobody can see is not a pin: Favorites opens around it.
    expandSection(FAVORITES_NODE_ID);
    toast.success(`${label} pinned to Favorites`);
  }, [favorites, updateFavorites, expandSection]);

  const unpinNode = useCallback((id: string) => {
    updateFavorites(favorites.filter(pinned => pinned !== id));
  }, [favorites, updateFavorites]);

  const clearFavorites = useCallback(() => {
    updateFavorites([]);
    toast.success("Favorites cleared");
  }, [updateFavorites]);

  /** Keyboard route for the order, for anyone who would rather not drag. */
  const moveFavorite = useCallback((id: string, delta: number) => {
    const next = [...favorites];
    const from = next.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= next.length) return;
    next.splice(from, 1);
    next.splice(to, 0, id);
    updateFavorites(next);
  }, [favorites, updateFavorites]);

  const handleFavoriteDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const dragged = favoriteDragId;
    setFavoriteDragId(null);
    if (!dragged || dragged === targetId) return;
    const next = [...favorites];
    const from = next.indexOf(dragged);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    updateFavorites(next);
  };

  const expandAllSections = useCallback(() => {
    const next = new Set<string>([
      FAVORITES_NODE_ID,
      ...collapsibleNavIds(visibleTree),
      // Pinned copies keep their own open state, so they are opened by their own keys.
      ...pinnedNodes.filter(node => node.children?.length).map(node => expandKeyFor(node, { favorite: true })),
    ]);
    setExpanded(next);
    localStorage.setItem("c7_nav_expanded", JSON.stringify([...next]));
  }, [visibleTree, pinnedNodes]);

  const collapseAllSections = useCallback(() => {
    setExpanded(new Set());
    localStorage.setItem("c7_nav_expanded", JSON.stringify([]));
  }, []);

  /** What the menu says it is about, so a right-click never leaves you guessing. */
  const nodeMenuHeader = (node: NavNode) => ({
    title: node.label,
    subtitle: node.id === FAVORITES_NODE_ID
      ? (pinnedNodes.length ? `${pinnedNodes.length} pinned section${pinnedNodes.length === 1 ? "" : "s"}` : "Nothing pinned yet")
      : node.to,
  });

  /**
   * What a right-click can be about. `favorite` adds the order controls, because a pinned copy is the
   * one place its position is the reader's to choose. `rail` drops the three entries that only
   * describe a tree: the modern pane's rail has nothing to expand, so offering it would be offering
   * an action that changes nothing you can see.
   */
  type NodeMenuOptions = { favorite?: boolean; rail?: boolean };

  /**
   * The menu a section offers. Everything in it is about the section that was right-clicked: one
   * with no page of its own gets no open or copy entries, and a pinned copy gets the order
   * controls that a section in the tree does not need.
   */
  const nodeMenuEntries = (node: NavNode, options: NodeMenuOptions = {}): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    // A section with no page of its own still has somewhere to go — its landing page, which is
    // where clicking its header lands — so the open and copy entries are never missing.
    const openTo = node.to ?? (node.children?.length ? `/section/${node.id}` : "");
    if (openTo) {
      entries.push(
        { label: "Open", icon: node.icon, onSelect: () => navigate(openTo) },
        { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(openTo) },
        { label: "Open in new window", icon: AppWindow, onSelect: () => openInNewWindow(openTo) },
        { label: "Copy link", icon: Link2, onSelect: () => void copyText(absoluteUrl(openTo), "Link") },
        "separator",
      );
    }
    if (node.id === FAVORITES_NODE_ID) {
      entries.push({ label: "Remove all favorites", icon: StarOff, disabled: favorites.length === 0, onSelect: clearFavorites });
    } else {
      entries.push(favorites.includes(node.id)
        ? { label: "Remove from Favorites", icon: StarOff, onSelect: () => unpinNode(node.id) }
        : { label: "Pin to Favorites", icon: Star, onSelect: () => pinNode(node.id, node.label) });
    }
    if (options.favorite) {
      const index = favorites.indexOf(node.id);
      entries.push(
        "separator",
        { label: "Move up", icon: ChevronUp, disabled: index <= 0, onSelect: () => moveFavorite(node.id, -1) },
        { label: "Move down", icon: ChevronDown, disabled: index === -1 || index === favorites.length - 1, onSelect: () => moveFavorite(node.id, 1) },
      );
    }
    if (node.children?.length && !options.rail) {
      const key = expandKeyFor(node, options);
      const open = expanded.has(key);
      entries.push("separator", {
        label: open ? "Collapse this section" : "Expand this section",
        icon: open ? ChevronsDownUp : ChevronsUpDown,
        onSelect: () => toggle(key),
      });
    }
    if (!options.rail) {
      entries.push(
        "separator",
        { label: "Expand all", icon: ChevronsUpDown, onSelect: expandAllSections },
        { label: "Collapse all", icon: ChevronsDownUp, onSelect: collapseAllSections },
      );
    }
    return entries;
  };

  /** Right-clicking the pane itself: the whole-navigation actions, nothing section-specific. */
  const paneMenuEntries = (): MenuEntry[] => [
    { label: "Expand all", icon: ChevronsUpDown, onSelect: expandAllSections },
    { label: "Collapse all", icon: ChevronsDownUp, onSelect: collapseAllSections },
    "separator",
    { label: "Remove all favorites", icon: StarOff, disabled: favorites.length === 0, onSelect: clearFavorites },
    "separator",
    { label: collapsed ? "Expand the sidebar" : "Collapse the sidebar", icon: collapsed ? PanelLeftOpen : PanelLeftClose, onSelect: toggleCollapsed },
  ];

  const openNodeMenu = (event: React.MouseEvent, node: NavNode, options: NodeMenuOptions = {}) => {
    navMenu.open(event, nodeMenuEntries(node, options), nodeMenuHeader(node));
  };

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

  const renderNode = (node: NavNode, depth: number = 0, options: { favorite?: boolean } = {}) => {
    const active = isNodeActive(node, location.pathname);
    const isExpanded = expanded.has(expandKeyFor(node, options));
    const hasChildren = !!node.children?.length;
    const linkTo = node.to || "#";
    const isTopLevel = depth === 0;
    // A pinned copy is draggable wherever it is drawn, because its order belongs to Favorites
    // rather than to the tree — the tree only reorders its own top level.
    const canDrag = options.favorite ? !collapsed : isTopLevel && !collapsed && node.id !== "home";
    const isDragging = options.favorite ? favoriteDragId === node.id : dragId === node.id;
    const dropTarget = (options.favorite ? favoriteDragId : dragId) && !isDragging && (options.favorite || isTopLevel);
    // Service Alerts reads as a live alert channel rather than a page, so its label and icon
    // carry the alert colour (matching its count badge) instead of the neutral nav grey.
    const isAlerts = node.id === "service-alerts";
    const dragProps = canDrag
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            if (options.favorite) setFavoriteDragId(node.id);
            else handleDragStart(e, node.id);
            e.dataTransfer.effectAllowed = "move";
          },
          onDragOver: handleDragOver,
          onDrop: (e: React.DragEvent) => (options.favorite ? handleFavoriteDrop(e, node.id) : handleDrop(e, node.id)),
          onDragEnd: () => (options.favorite ? setFavoriteDragId(null) : handleDragEnd()),
        }
      : {};
    const grip = canDrag && (
      <button
        className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/drag:opacity-100 transition-opacity"
        onMouseDown={(e) => e.stopPropagation()}
        title="Drag to reorder"
        aria-label={`Reorder ${node.label}`}
      >
        <GripVertical size={12} />
      </button>
    );

    // In collapsed mode, top-level items are just icon buttons — the tooltip is what says which one,
    // so the label has to be on the control itself rather than on the wrapper it sits in.
    if (collapsed && isTopLevel) {
      return (
        <div key={node.id} className="relative flex justify-center" title={node.label}>
          {hasChildren ? (
            <button
              onClick={() => navigate(`/section/${node.id}`)}
              onContextMenu={(e) => openNodeMenu(e, node, options)}
              aria-label={node.label}
              className={`relative p-2.5 rounded-lg transition-colors ${
                active ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} />
              {node.id === "service-alerts" && alertCount > 0 && (
                <span className="badge-count absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 text-[9px]">{alertCount}</span>
              )}
            </button>
          ) : (
            <Link
              to={linkTo}
              onClick={() => setMobileOpen(false)}
              onContextMenu={(e) => openNodeMenu(e, node, options)}
              aria-label={node.label}
              className={`relative p-2.5 rounded-lg transition-colors ${
                active ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={20} className={isAlerts ? "text-alert-red" : undefined} />
              {node.id === "service-alerts" && alertCount > 0 && (
                <span className="badge-count absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 text-[9px]">{alertCount}</span>
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
        {...dragProps}
        className={`rounded-lg transition-colors ${isDragging ? "opacity-50" : ""} ${dropTarget ? "border border-dashed border-cyber-500/30" : ""}`}
      >
        {hasChildren ? (
          <div className="flex items-center group/drag">
            {grip}
            <button
              onClick={() => { toggle(expandKeyFor(node, options)); navigate(`/section/${node.id}`); }}
              onContextMenu={(e) => openNodeMenu(e, node, options)}
              onKeyDown={(e) => navMenu.onKeyDown(e, e.currentTarget, nodeMenuEntries(node, options), nodeMenuHeader(node))}
              className={`nav-item flex-1 flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "nav-item--active bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <node.icon size={18} />
              {!collapsed && <span className="flex-1 text-left truncate">{node.label}</span>}
              {!collapsed && favorites.includes(node.id) && !options.favorite && (
                <Star size={12} className="shrink-0 text-amber-400" aria-label="Pinned to Favorites" />
              )}
              {!collapsed && node.id === "service-alerts" && alertCount > 0 && (
                <span className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]" title={`${alertCount} active service alert${alertCount === 1 ? "" : "s"}`}>{alertCount}</span>
              )}
              {!collapsed && <ChevronDown size={14} className={`transition-transform shrink-0 ${isExpanded ? "" : "-rotate-90"}`} />}
            </button>
          </div>
        ) : (
          <div className="flex items-center group/drag">
            {grip}
            <Link
              to={linkTo}
              onClick={() => setMobileOpen(false)}
              onContextMenu={(e) => openNodeMenu(e, node, options)}
              onKeyDown={(e) => navMenu.onKeyDown(e, e.currentTarget, nodeMenuEntries(node, options), nodeMenuHeader(node))}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
              className={`nav-item flex-1 flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "nav-item--active bg-surface-lighter text-white" : "text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              <node.icon size={18} className={isAlerts ? "text-alert-red" : undefined} />
              {!collapsed && (isAlerts ? <span className="text-alert-red">{node.label}</span> : node.label)}
              {!collapsed && favorites.includes(node.id) && !options.favorite && (
                <Star size={12} className="shrink-0 text-amber-400" aria-label="Pinned to Favorites" />
              )}
              {!collapsed && node.id === "service-alerts" && alertCount > 0 && (
                <span className="badge-count shrink-0 min-w-[18px] h-[18px] px-1 text-[10px]" title={`${alertCount} active service alert${alertCount === 1 ? "" : "s"}`}>{alertCount}</span>
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
    : modernNav
      // Rail only. The destinations fly out over the content, so this is the whole cost of the modern
      // pane — 200px, narrower than the 256px the tree occupied — and no page has to lay out around it.
      ? { width: "200px" }
      : { width: `${sidebarWidth}px` };

  /*
   * The report designer can be popped out into a window of its own — that window is the tool and
   * nothing else. The rail, the bar and the working set belong to the window you are working in, and
   * repeating them here would spend the height the sheet needs. Read from the URL rather than a hook,
   * because a popped-out window never navigates, and placed after every hook so the hook order is the
   * same in both windows.
   */
  const poppedOut = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("popout") === "1";
  if (poppedOut) {
    return <div className="min-h-screen bg-surface text-gray-100">{children}</div>;
  }

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
            <button className="lg:hidden text-gray-400 hover:text-white p-1" onClick={() => setMobileOpen(false)} aria-label="Close the navigation">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Navigation — one of two panes, from the same tree. See lib/navModel.ts and
            NavPaneModern.tsx for the modern one; the classic branch below is deliberately
            unchanged so that switching back is a setting rather than a code change. */}
        <nav
          className={
            modernNav
              ? // No `overflow-hidden` here: the destination list is positioned beyond this box on
                // purpose, and clipping it would hide the panel. The rail and the flyout each scroll
                // themselves.
                "flex-1 flex flex-col min-h-0"
              : `flex-1 py-3 overflow-y-auto ${collapsed ? "px-1.5" : "px-2"}`
          }
          onContextMenu={modernNav ? undefined : (e) => {
            // The pane's own menu: what applies to the navigation as a whole rather than to the
            // section under the pointer (a section stops the event and opens its own).
            if (isTextEntryTarget(e.target)) return;
            navMenu.open(e, paneMenuEntries(), { title: "Navigation", subtitle: "Right-click a section for its own menu" });
          }}
        >
          {modernNav ? (
            <NavPaneModern
              tree={visibleTree}
              favorites={favorites}
              alertCount={alertCount}
              collapsed={collapsed}
              assistantInRail={navigation.assistantInRail}
              onNodeContextMenu={(event, node, options) => openNodeMenu(event, node, { ...options, rail: true })}
            />
          ) : (
          <>
          {/* ── Favorites ───────────────────────────────────────────────────────────
              Pinned sections, drawn as copies: the section keeps its place in the tree below and
              a second copy appears here, in its own order, at the top of the navigation. */}
          <div className="mb-1" data-nav-section="favorites">
            {collapsed ? (
              <div className="flex flex-col items-center gap-1 pb-1" title="Favorites">
                <Star size={16} className={pinnedNodes.length ? "text-amber-400" : "text-gray-600"} />
                {pinnedNodes.map(n => renderNode(n, 0, { favorite: true }))}
              </div>
            ) : (
              <>
                <div className="flex items-center group/drag">
                  <button
                    onClick={() => toggle(FAVORITES_NODE_ID)}
                    onContextMenu={(e) => openNodeMenu(e, FAVORITES_SECTION)}
                    onKeyDown={(e) => navMenu.onKeyDown(e, e.currentTarget, nodeMenuEntries(FAVORITES_SECTION), nodeMenuHeader(FAVORITES_SECTION))}
                    aria-expanded={favoritesOpen}
                    title={pinnedNodes.length ? "Favorites — right-click a section to pin or unpin it" : "Favorites — right-click a section to pin it here"}
                    className={`nav-item w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-surface-lighter`}
                  >
                    <Star size={18} className={pinnedNodes.length ? "text-amber-400" : undefined} />
                    <span className="flex-1 text-left truncate">Favorites</span>
                    {pinnedNodes.length > 0 && <span className="text-[10px] text-gray-500">{pinnedNodes.length}</span>}
                    <ChevronDown size={14} className={`transition-transform shrink-0 ${favoritesOpen ? "" : "-rotate-90"}`} />
                  </button>
                </div>
                {favoritesOpen && (
                  <div className="border-l border-surface-border ml-7">
                    {pinnedNodes.length === 0 ? (
                      <p className="px-3 py-1.5 text-xs text-gray-600">
                        Right-click a section and choose “Pin to Favorites”.
                      </p>
                    ) : (
                      pinnedNodes.map(n => renderNode(n, 1, { favorite: true }))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className={collapsed ? "flex flex-col items-center gap-1" : ""}>
            {orderedTree.map(n => renderNode(n))}
          </div>
          </>
          )}
        </nav>

        <ContextMenu state={navMenu.menuState} onClose={navMenu.close} />

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

        {/* Resize handle — classic only: the modern pane is a rail plus a column, and a width the
            user drags would fight the column it has to fit. */}
        {!collapsed && !modernNav && (
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
        <header className={`border-b border-surface-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-surface/50 ${redesign ? "py-2" : "py-3"}`}>
          {/* Redesigned, the header is one row — where you are, what the section is for, and the
              trail back — rather than a title row with the breadcrumb on a line of its own beneath
              it. That is about 24px of chrome above every page in the application. */}
          {/* Redesigned, the header is one row: the section's name and what it is for. The trail is
              not repeated here — the rail is already showing where you are, and the pages that have
              a place to go back to carry their own breadcrumb — because the width a crumb needs is
              the width the description needs, and at 1280px the toolbar leaves room for one of them. */}
          {redesign ? (
            <div className="flex items-center gap-x-2.5 min-w-0 flex-1 mr-6">
              <button className="lg:hidden text-gray-400 hover:text-white p-1 shrink-0" onClick={() => setMobileOpen(true)} aria-label="Open the navigation">
                <Menu size={20} />
              </button>
              <h1 className="text-sm font-semibold text-white shrink-0">{getPageTitle(NAV_TREE, location.pathname)}</h1>
              {(() => { const desc = getSectionDescription(location.pathname); return desc ? <span className="text-xs text-gray-500 truncate min-w-0">— {desc}</span> : null; })()}
            </div>
          ) : (
          <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-6">
            <div className="flex items-center gap-3">
              <button className="lg:hidden text-gray-400 hover:text-white p-1 shrink-0" onClick={() => setMobileOpen(true)} aria-label="Open the navigation">
                <Menu size={20} />
              </button>
              <h1 className="text-base font-semibold text-white truncate">
                {getPageTitle(NAV_TREE, location.pathname)}
                {(() => { const desc = getSectionDescription(location.pathname); return desc ? <span className="text-gray-500 font-normal text-sm ml-2">— {desc}</span> : null; })()}
              </h1>
            </div>
            <Breadcrumbs segments={buildBreadcrumbs(NAV_TREE, location.pathname)} />
          </div>
          )}
          {/* Header toolbar */}
          <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
            {/* Console — the command surface for C7NTAX (PLAN-028). A labelled `SquareTerminal`: the bare
                prompt glyph it used to carry read as an unlabelled decoration beside five labelled
                neighbours, and a window-shaped terminal with the word under it says what it is. The icon
                is not rendered at all without `console:use` — a control somebody may not use is not a
                control to show them greyed out. */}
            {consoleEnabled && (
              <button
                type="button"
                onClick={() => setConsoleOpen(true)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
                title="Console (Ctrl/⌘ .)"
                aria-label="Console"
                data-testid="console-button"
              >
                <SquareTerminal size={15} />
                <span>Console</span>
              </button>
            )}
            <button
              onClick={() => { if (UI_P1) setPaletteOpen(true); }}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-surface-lighter rounded-md transition-colors flex items-center gap-1.5"
              title={UI_P1 ? "Search (Ctrl/⌘ K)" : "Search"}
            >
              <Search size={14} />
              <span>Search</span>
              {UI_P1 && <kbd className="hidden lg:inline text-[10px] text-gray-500 border border-surface-border rounded px-1">⌘K</kbd>}
            </button>
            <RecentActivityMenu />
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
        {/* ── The working set ────────────────────────────────────────────────────────────────
            What you have open: the section you are in, the record you are in, and the way to open
            something else. It sits above the page and below the header because it is neither — the
            header is the application's, the page is the record's, and this is the hand you are
            holding. Only the redesigned interface shows it. */}
        {redesign && (
          <div className="flex items-stretch gap-0.5 border-b border-surface-border bg-surface/60 px-2 shrink-0 overflow-x-auto whitespace-nowrap">
            <Link
              to={`/${location.pathname.split("/")[1] || ""}`}
              className={`flex items-center gap-2 border-b-2 px-3 py-1.5 text-xs transition-colors ${
                segments.length < 3 ? "border-cyber-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {getPageTitle(NAV_TREE, `/${location.pathname.split("/")[1] || ""}`)}
            </Link>
            {segments.length >= 3 && (
              <Link
                to={location.pathname}
                className="flex items-center gap-2 border-b-2 border-cyber-500 px-3 py-1.5 text-xs text-white"
                title={getPageTitle(NAV_TREE, location.pathname)}
              >
                <span className="max-w-[16rem] truncate">{getPageTitle(NAV_TREE, location.pathname)}</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => { if (UI_P1) setPaletteOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:text-gray-300"
              title={UI_P1 ? "Open something (Ctrl/⌘ K)" : "Open something"}
            >
              <Plus size={12} /> <kbd className="text-[10px]">⌘K</kbd> to open something
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <KumoTrail segments={buildBreadcrumbs(NAV_TREE, location.pathname)} />
          {children}
        </main>
        {/* Pinned rather than trailing the content: a notice that is only reachable by scrolling to
            the end of a long page is absent from the page as the reader experiences it. */}
        <footer className="shrink-0 border-t border-surface-border px-4 lg:px-6 py-2">
          <AppFooter />
        </footer>
      </div>
      {UI_P1 && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />}
      {consoleEnabled && <ConsoleDialog open={consoleOpen} onClose={() => setConsoleOpen(false)} />}
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
