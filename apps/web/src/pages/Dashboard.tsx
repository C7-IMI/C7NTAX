import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import {
  Ticket, Clock, DollarSign, AlertTriangle, TrendingUp, Users, Columns3, Building2, FolderKanban,
  Monitor, BookOpen, Target, Cloud, GripVertical, Eye, EyeOff, RotateCcw, Save, SlidersHorizontal, ArrowUp, ArrowDown, ArrowRight, Bell,
} from "lucide-react";
import { timeAgo } from "../lib/format";
import { ticketStatusBadge, ticketStatusLabel } from "../lib/ticketStatus";
import { PageHeader, EmptyState, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";
import { useRecentActivity } from "../hooks/useRecentActivity";

/**
 * The dashboard is assembled from widgets the signed-in user arranged (PLAN-015 Phase B #4).
 * A widget id means nothing here until it is matched against the server's catalogue, and an id
 * this page does not know how to draw renders nothing rather than an empty card — so a layout
 * saved before a widget was added or retired degrades quietly instead of breaking the page.
 */

interface DashboardStats {
  totalTickets: number; openTickets: number; waitingOnClient: number; resolved: number;
  overdueInvoices: number; revenueThisMonth: number; activeClients: number; alerts: number; myMinutes: number;
}

interface WidgetState { id: string; size: 1 | 2 | 3; visible: boolean; }
interface CatalogueEntry { id: string; label: string; description: string; defaultSize: 1 | 2 | 3; }

const QUICK_LINKS = [
  { to: "/tickets", icon: Ticket, label: "Tickets", desc: "View and manage support tickets" },
  { to: "/boards", icon: Columns3, label: "Service Boards", desc: "Configure boards and email connectors" },
  { to: "/opportunities", icon: Target, label: "Sales Pipeline", desc: "Track opportunities and deals" },
  { to: "/projects", icon: FolderKanban, label: "Projects", desc: "Manage projects and phases" },
  { to: "/assets", icon: Monitor, label: "Asset Inventory", desc: "Track hardware and licenses" },
  { to: "/kb", icon: BookOpen, label: "Knowledge Base", desc: "Articles and documentation" },
  { to: "/clients", icon: Building2, label: "Clients", desc: "Company accounts and contacts" },
  { to: "/billing", icon: DollarSign, label: "Billing", desc: "Invoices and agreements" },
  { to: "/c7nc", icon: Cloud, label: "C7NC", desc: "Services, models, mailboxes and companion apps" },
];

/** S = one sixth of the row, M = half, L = the whole row. */
const sizeClass = (size: 1 | 2 | 3) =>
  size === 3 ? "md:col-span-2 lg:col-span-6" : size === 2 ? "md:col-span-2 lg:col-span-3" : "md:col-span-1 lg:col-span-1";

/** Four hours: the window in which a ticket still counts as somebody's problem rather than the clock's. */
const AT_RISK_MS = 4 * 60 * 60 * 1000;

/** When a ticket's clock runs out, from whichever target it carries. */
function ticketDueAt(t: Record<string, any>): number | null {
  const raw = t.slaResolutionDue || t.dueDate;
  return raw ? new Date(raw).getTime() : null;
}

/**
 * What changed — this person's own trail.
 *
 * It is its own component because it is the one band that reads something the page does not: the
 * activity hook fires a request, and a band that is not drawn should not cost one.
 */
function WhatChanged() {
  const { activities } = useRecentActivity(8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">What changed</h2>
          <p className="text-xs text-gray-500">Your own trail — the same list the header's Recent menu folds to five</p>
        </div>
        <Link to="/activity" className="btn-secondary text-xs">Show all</Link>
      </div>
      <div className="card divide-y divide-surface-border/60 p-0">
        {activities.length === 0 ? <p className="p-4 text-sm text-gray-500">Nothing yet — changes you make and pages you work on collect here.</p> : activities.map((a) => (
          <Link key={a.id} to={a.to} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3.5 py-2 text-sm hover:bg-surface-lighter">
            <span className="text-gray-500">{a.where}</span>
            <span className="text-gray-300">{a.action}{a.subject ? ` ${a.subject}` : ""}</span>
            <span className="ml-auto text-[11px] text-gray-600">{timeAgo(a.at)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {  const { user } = useAuth();
  const redesign = useRedesign();
  const [stats, setStats] = useState<DashboardStats>({ totalTickets: 0, openTickets: 0, waitingOnClient: 0, resolved: 0, overdueInvoices: 0, revenueThisMonth: 0, activeClients: 0, alerts: 0, myMinutes: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  // The bands the redesigned dashboard opens with: what is about to break, where the load sits, what
  // is already broken, and what this person has been doing.
  const [atRisk, setAtRisk] = useState<any[]>([]);
  const [boardLoad, setBoardLoad] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [layout, setLayout] = useState<WidgetState[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WidgetState[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);

    Promise.all([
      api.get("/tickets?limit=1").then(r => ({ total: r.data.total || 0, data: r.data.data || [] })),
      api.get("/tickets?status=in_progress&limit=1").then(r => r.data.total || 0),
      api.get("/tickets?status=waiting_on_client&limit=1").then(r => r.data.total || 0),
      api.get("/clients?limit=1").then(r => r.data.total || 0),
      api.get("/billing/invoices?status=overdue&limit=1").then(r => r.data.total || 0),
      api.get("/tickets?status=resolved&limit=1").then(r => r.data.total || 0),
      api.get("/service-alerts/status").then(r => Number(r.data?.activeCount) || 0).catch(() => 0),
      api.get("/billing/time-entries").then(r => (Array.isArray(r.data) ? r.data : []).filter((e: any) => new Date(e.date) >= weekStart)).catch(() => []),
      // The count above asks for a single row on purpose; the list widget needs its own request.
      api.get("/tickets?limit=8").then(r => r.data.data || []).catch(() => []),
      // The redesigned bands. Each is a list the page shows in full rather than a count.
      redesign ? api.get("/tickets?limit=100").then(r => r.data.data || []).catch(() => []) : Promise.resolve([]),
      redesign ? api.get("/boards/metrics").then(r => (Array.isArray(r.data) ? r.data : [])).catch(() => []) : Promise.resolve([]),
      redesign ? api.get("/service-alerts").then(r => (r.data?.data || r.data || [])).catch(() => []) : Promise.resolve([]),
    ]).then(([tickets, open, waiting, clients, overdue, resolved, alertCount, entries, recentTickets, risky, boards, activeAlerts]) => {
      setStats({
        totalTickets: tickets.total,
        openTickets: open,
        waitingOnClient: waiting,
        resolved,
        overdueInvoices: overdue,
        revenueThisMonth: 28450,
        activeClients: clients,
        alerts: alertCount,
        myMinutes: (entries as any[]).filter(e => e.user?.id === user?.id).reduce((sum, e) => sum + (Number(e.minutes) || 0), 0),
      });
      setRecent((recentTickets as any[]).slice(0, 8));
      const now = Date.now();
      setAtRisk((risky as any[])
        .filter(t => !["resolved", "closed", "cancelled"].includes(t.status))
        .map(t => ({ ...t, dueAt: ticketDueAt(t) }))
        .filter(t => t.dueAt !== null && t.dueAt - now <= AT_RISK_MS)
        .sort((a, b) => (a.dueAt as number) - (b.dueAt as number))
        .slice(0, 6));
      setBoardLoad((boards as any[]).filter(b => (b.metrics?.open || 0) > 0).sort((a, b) => (b.metrics?.open || 0) - (a.metrics?.open || 0)));
      setAlerts((activeAlerts as any[]).slice(0, 5));
    }).catch(() => {});
  }, [user?.id, redesign]);

  const loadLayout = useCallback(async () => {
    try {
      const r = await api.get("/dashboard/layout");
      const widgets: WidgetState[] = r.data.widgets || [];
      setLayout(widgets);
      setCatalogue(r.data.catalogue || []);
      setLoaded(true);
      return widgets;
    } catch {
      // The catalogue lives on the server; without it there is nothing to draw, and an empty
      // dashboard that says so beats a page that pretends to be broken.
      setLayout([]);
      setLoaded(true);
      return [];
    }
  }, []);

  useEffect(() => { void loadLayout(); }, [loadLayout]);

  const openEditor = async () => {
    const current = layout.length ? layout : await loadLayout();
    setDraft(current.map(w => ({ ...w })));
    setEditing(true);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    setDraft(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  const setEntry = (id: string, patch: Partial<WidgetState>) => setDraft(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/dashboard/layout", { widgets: draft });
      setLayout(r.data.widgets || []);
      setCatalogue(r.data.catalogue || catalogue);
      toast.success("Dashboard saved");
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Could not save the layout");
    } finally { setSaving(false); }
  };

  const reset = async () => {
    try {
      const r = await api.delete("/dashboard/layout");
      const widgets: WidgetState[] = r.data.widgets || [];
      setLayout(widgets);
      setDraft(widgets.map(w => ({ ...w })));
      toast.success("Layout reset");
      setEditing(false);
    } catch { toast.error("Could not reset the layout"); }
  };

  const label = (id: string) => catalogue.find(c => c.id === id)?.label ?? id.replace(/_/g, " ");
  const description = (id: string) => catalogue.find(c => c.id === id)?.description ?? "";

  const cardFor = (id: string) => {
    switch (id) {
      case "open_tickets": return { value: stats.openTickets, label: "Open Tickets", icon: Ticket, color: "text-cyber-400", bg: "bg-cyber-600/10", to: "/tickets?status=in_progress" };
      case "waiting_on_client": return { value: stats.waitingOnClient, label: "Waiting on Client", icon: Clock, color: "text-amber-400", bg: "bg-amber-600/10", to: "/tickets?status=waiting_on_client" };
      case "all_tickets": return { value: stats.totalTickets, label: "All Tickets", icon: TrendingUp, color: "text-green-400", bg: "bg-green-600/10", to: "/tickets" };
      case "resolved": return { value: stats.resolved, label: "Resolved", icon: Ticket, color: "text-emerald-400", bg: "bg-emerald-600/10", to: "/tickets?status=resolved" };
      case "overdue_invoices": return { value: stats.overdueInvoices, label: "Overdue Invoices", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-600/10", to: "/billing" };
      case "active_clients": return { value: stats.activeClients, label: "Active Clients", icon: Users, color: "text-purple-400", bg: "bg-purple-600/10", to: "/clients" };
      case "my_time": return { value: `${Math.round((stats.myMinutes / 60) * 10) / 10}h`, label: "My Time (this week)", icon: Clock, color: "text-sky-400", bg: "bg-sky-600/10", to: "/billing/time" };
      default: return null;
    }
  };

  const renderWidget = (id: string) => {
    if (id === "quick_links") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_LINKS.map(link => (
            <Link key={link.to} to={link.to} className="card hover:border-cyber-500/30 transition-colors group">
              <link.icon size={20} className="text-cyber-400 mb-2" />
              <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors text-sm">{link.label}</h3>
              <p className="text-xs text-gray-500 mt-1">{link.desc}</p>
            </Link>
          ))}
        </div>
      );
    }
    if (id === "recent_tickets") {
      return (
        // `h-full` so the card fills its grid cell rather than leaving the row's other cells with a
        // void under them, and the list scrolls inside whatever height the row gives it — a widget
        // whose height is its content would drag the whole row's height with it.
        <div className="card flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold text-white">Recent tickets</h3>
            <Link to="/tickets" className="text-[11px] text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1">
              All tickets <ArrowRight size={11} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              icon={<Ticket size={22} />}
              title="Nothing updated recently"
              description="Tickets appear here as soon as a client raises one, or somebody works on one."
            />
          ) : (
            <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="w-[9rem] px-2 py-1.5 font-medium">Ticket</th>
                    <th className="px-2 py-1.5 font-medium">Subject</th>
                    <th className="hidden w-[13rem] px-2 py-1.5 font-medium md:table-cell">Client</th>
                    <th className="hidden w-[7.5rem] px-2 py-1.5 font-medium sm:table-cell">Updated</th>
                    <th className="w-[9.5rem] px-2 py-1.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {recent.map((t: any) => (
                    <tr key={t.id} className="relative group transition-colors hover:bg-surface-lighter">
                      <td className="px-2 py-2 align-middle">
                        <span className="font-mono text-[11px] text-gray-500 group-hover:text-gray-400">{t.ticketNumber}</span>
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <Link
                          to={`/tickets/${t.id}`}
                          title={t.title}
                          className="block truncate text-gray-200 group-hover:text-cyber-300 transition-colors after:absolute after:inset-0 after:content-['']"
                        >
                          {t.title}
                        </Link>
                      </td>
                      <td className="hidden px-2 py-2 align-middle md:table-cell">
                        <span className="block truncate text-xs text-gray-500" title={t.company?.name ?? ""}>
                          {t.company?.name ?? "—"}
                        </span>
                      </td>
                      <td className="hidden px-2 py-2 align-middle sm:table-cell">
                        <span className="text-xs text-gray-500" title={t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ""}>
                          {timeAgo(t.updatedAt)}
                        </span>
                      </td>
                      <td className="px-2 py-2 align-middle text-right">
                        <span className={`badge text-[11px] ${ticketStatusBadge(t.status)}`}>{ticketStatusLabel(t.status)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }
    if (id === "service_alerts") {
      return (
        <Link to="/service-alerts" className={`card flex h-full items-center gap-3 p-4 transition-colors ${stats.alerts > 0 ? "border-alert-red/40 hover:border-alert-red/60" : "hover:border-cyber-500/30"}`}>
          <div className="p-2 rounded-lg bg-red-600/10"><Bell size={18} className="text-alert-red" /></div>
          <div className="min-w-0"><p className="text-2xl font-bold text-white">{stats.alerts}</p><p className="text-xs text-gray-500 truncate">Active alerts</p></div>
        </Link>
      );
    }
    const card = cardFor(id);
    if (!card) return null;
    return (
      // A tile in a row with a taller widget fills that row's height, so a row of cards is one
      // band rather than one card and some empty space.
      <Link to={card.to} className="card flex h-full items-center gap-3 p-4 hover:border-cyber-500/30 transition-colors cursor-pointer">
        <div className={`p-2 rounded-lg ${card.bg}`}><card.icon size={18} className={card.color} /></div>
        <div className="min-w-0"><p className="text-2xl font-bold text-white">{card.value}</p><p className="text-xs text-gray-500 truncate">{card.label}</p></div>
      </Link>
    );
  };

  const visible = layout.filter(w => w.visible);
  const hiddenCount = layout.length - visible.length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader variant="section" title="Dashboard" subtitle={<>Overview of your service operations
            {hiddenCount > 0 && <span className="text-gray-600"> · {hiddenCount} widget{hiddenCount === 1 ? "" : "s"} hidden</span>}</>} />
        <div className="flex items-center gap-2">
          {!editing && loaded && catalogue.length > 0 && (
            <button onClick={openEditor} className="btn-secondary text-xs flex items-center gap-1.5"><SlidersHorizontal size={13} /> Customise</button>
          )}
          {editing && <button onClick={reset} className="btn-secondary text-xs flex items-center gap-1.5"><RotateCcw size={13} /> Reset</button>}
          {editing && <button onClick={() => setEditing(false)} className="btn-secondary text-xs">Cancel</button>}
          {editing && <button onClick={save} disabled={saving} className="btn-primary text-xs flex items-center gap-1.5"><Save size={13} /> {saving ? "Saving…" : "Save layout"}</button>}
        </div>
      </div>

      {/* ── The redesigned dashboard opens with what a service desk looks at first: the figures, the
          tickets about to breach, where the load is sitting, what is already broken, and what this
          person has been doing. The widget grid below is still the arrangement they chose. ── */}
      {redesign && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Open tickets" value={stats.openTickets} icon={<Ticket size={13} />} />
            <StatCard label="Waiting on client" value={stats.waitingOnClient} icon={<Clock size={13} />} tone="amber" />
            <StatCard label="Service alerts" value={stats.alerts} icon={<Bell size={13} />} tone={stats.alerts > 0 ? "red" : "neutral"} />
            <StatCard label="Overdue invoices" value={stats.overdueInvoices} icon={<AlertTriangle size={13} />} tone={stats.overdueInvoices > 0 ? "red" : "neutral"} />
            <StatCard label="Active clients" value={stats.activeClients} icon={<Users size={13} />} tone="neutral" />
            <StatCard label="My time this week" value={`${Math.round((stats.myMinutes / 60) * 10) / 10}h`} icon={<Clock size={13} />} tone="neutral" />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-white">Needs a person</h2>
                <p className="text-xs text-gray-500">
                  {atRisk.length === 0
                    ? "Nothing is inside four hours of its target."
                    : `${atRisk.length} ticket${atRisk.length === 1 ? "" : "s"} inside four hours of its target, or past it`}
                </p>
              </div>
              <Link to="/tickets" className="btn-secondary text-xs">Open the queue</Link>
            </div>
            <div className="card overflow-hidden p-0">
              {atRisk.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">Every ticket with a target still has time on it.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-surface-border text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-2 font-medium">Ticket</th><th className="px-3 py-2 font-medium">Summary</th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">Client</th>
                      <th className="hidden px-3 py-2 font-medium lg:table-cell">Technician</th>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell">Age</th>
                      <th className="px-3 py-2 font-medium text-right">SLA</th>
                    </tr></thead>
                    <tbody className="divide-y divide-surface-border">
                      {atRisk.map((t: any) => {
                        const left = (t.dueAt as number) - Date.now();
                        return (
                          <tr key={t.id} className="relative transition-colors hover:bg-surface-lighter">
                            <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{t.ticketNumber || "—"}</td>
                            <td className="px-3 py-2">
                              <Link to={`/tickets/${t.id}`} title={t.title} className="block max-w-[22rem] truncate text-gray-200 after:absolute after:inset-0 after:content-['']">{t.title}</Link>
                            </td>
                            <td className="hidden px-3 py-2 md:table-cell"><span className="block max-w-[12rem] truncate text-xs text-gray-500">{t.company?.name || "—"}</span></td>
                            <td className="hidden px-3 py-2 text-xs text-gray-500 lg:table-cell">{t.assignedTo ? `${t.assignedTo.firstName || ""} ${t.assignedTo.lastName || ""}`.trim() : "Unassigned"}</td>
                            <td className="hidden px-3 py-2 text-xs text-gray-500 sm:table-cell">{timeAgo(t.createdAt)}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={`chip text-[10px] ${left < 0 ? "chip--bad" : "chip--warn"}`}>
                                {left < 0 ? `${Math.round(-left / 3600000)}h over` : `${Math.max(1, Math.round(left / 3600000))}h left`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="card p-0">
              <h3 className="border-b border-surface-border px-3.5 py-2 text-[11px] uppercase tracking-wide text-gray-500">Board load</h3>
              <div className="space-y-2 p-3.5">
                {boardLoad.length === 0 ? <p className="text-sm text-gray-500">No board has open work.</p> : boardLoad.map((b: any) => {
                  const open = b.metrics?.open || 0;
                  const stale = b.metrics?.stale7Days || 0;
                  const pct = Math.min(100, Math.round((open / Math.max(...boardLoad.map((x: any) => x.metrics?.open || 1))) * 100));
                  return (
                    <div key={b.boardId} className="flex items-center gap-2.5 text-xs">
                      <Link to={`/tickets?boardId=${b.boardId}`} className="w-40 shrink-0 truncate text-gray-400 hover:text-white" title={b.boardName}>{b.boardName}</Link>
                      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-lighter">
                        <i className={`absolute inset-y-0 left-0 rounded-full ${stale > 8 ? "bg-alert-red" : stale > 4 ? "bg-amber-500" : "bg-cyber-500"}`} style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-gray-400">{open}</span>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] text-gray-600">Stale work is the amber and red part: {boardLoad.reduce((n: number, b: any) => n + (b.metrics?.stale7Days || 0), 0)} tickets open longer than a week.</p>
              </div>
            </div>
            <div className="card p-0">
              <div className="flex items-baseline justify-between border-b border-surface-border px-3.5 py-2">
                <h3 className="text-[11px] uppercase tracking-wide text-gray-500">Service alerts</h3>
                <Link to="/service-alerts" className="text-[11px] text-cyber-400 hover:underline">All alerts</Link>
              </div>
              <div className="divide-y divide-surface-border/60">
                {alerts.length === 0 ? <p className="p-3.5 text-sm text-gray-500">Nothing is reporting a problem.</p> : alerts.map((a: any) => (
                  <Link key={a.id} to="/service-alerts" className="flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface-lighter">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.severity === "critical" ? "bg-alert-red" : a.severity === "warning" ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <span className="min-w-0 flex-1 truncate text-gray-300">{[a.service?.name, a.title].filter(Boolean).join(" — ")}</span>
                    <span className="shrink-0 text-[11px] text-gray-600">{timeAgo(a.startedAt || a.createdAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <WhatChanged />
        </div>
      )}

      {editing ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Drag a widget by its handle to reorder it, or use the arrows. Pick S, M or L for its width, hide the ones you do not use — this layout follows your account, not the browser.
          </p>
          <div className="space-y-2">
            {draft.map((w, index) => (
              <div
                key={w.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragIndex !== null) move(dragIndex, index); setDragIndex(null); }}
                onDragEnd={() => setDragIndex(null)}
                className={`card flex items-center gap-3 py-2.5 ${dragIndex === index ? "border-cyber-500/60 opacity-60" : ""} ${w.visible ? "" : "opacity-50"}`}
              >
                <GripVertical size={16} className="text-gray-600 cursor-grab shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{label(w.id)}</p>
                  <p className="text-xs text-gray-500 truncate">{description(w.id)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {([1, 2, 3] as const).map(size => (
                    <button
                      key={size}
                      onClick={() => setEntry(w.id, { size })}
                      className={`px-2 py-0.5 rounded text-xs border transition-colors ${w.size === size ? "border-cyber-500/60 text-cyber-400 bg-cyber-600/10" : "border-surface-border text-gray-500 hover:text-gray-300"}`}
                      title={size === 1 ? "Narrow" : size === 2 ? "Half width" : "Full width"}
                    >{size === 1 ? "S" : size === 2 ? "M" : "L"}</button>
                  ))}
                </div>
                <button onClick={() => move(index, index - 1)} disabled={index === 0} className="text-gray-500 hover:text-white disabled:opacity-30 shrink-0" title="Move up"><ArrowUp size={14} /></button>
                <button onClick={() => move(index, index + 1)} disabled={index === draft.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30 shrink-0" title="Move down"><ArrowDown size={14} /></button>
                <button onClick={() => setEntry(w.id, { visible: !w.visible })} className="text-gray-500 hover:text-white shrink-0" title={w.visible ? "Hide" : "Show"}>
                  {w.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            ))}
            {draft.length === 0 && <p className="text-sm text-gray-500">The widget catalogue could not be read.</p>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          {visible.map(w => (
            <div key={w.id} className={sizeClass(w.size)}>{renderWidget(w.id)}</div>
          ))}
          {loaded && visible.length === 0 && (
            <div className="card col-span-1 md:col-span-2 lg:col-span-6 text-center py-10">
              <p className="text-sm text-gray-400">
                {catalogue.length === 0 ? "The widget catalogue could not be read." : "Every widget is hidden."}
              </p>
              {catalogue.length > 0 && <button onClick={openEditor} className="btn-secondary text-xs mt-3">Customise the dashboard</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
