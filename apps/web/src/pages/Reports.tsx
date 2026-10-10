import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  TrendingUp, BarChart3, ClipboardList, Download, Filter, CheckCircle,
  Ticket, DollarSign, Clock, Printer, Presentation, Calendar, FileText, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { ReportsSkeleton, TableSkeleton } from "../components/ui/Skeleton";
import { apiErrorMessage } from "../lib/apiError";
import { money, number, printReport } from "../components/reports/reportKit";
import { REPORT_BY_ID, REVIEW_REPORTS, STANDARD_REPORTS, type StandardReport } from "../components/reports/standardReports";
import {
  ReportViewer, ExportDialog, useReportOptions, EMPTY_FILTERS, defaultOptionValues, periodLabel, reportQuery,
  type ReportFilters, type ReportOptionValues,
} from "../components/reports/ReportViewer";
import { ScheduleReportDialog } from "../components/reports/ScheduleReportDialog";

/** The filters are the viewer's to define; they stay exported here because this screen used to own them. */
export type { FilterOptions, ReportFilters } from "../components/reports/ReportViewer";
import { PageHeader, Tabs } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

const TABS: Array<{ id: string; label: string; icon: LucideIcon; to: string }> = [
  { id: "dashboard", label: "Dashboards", icon: BarChart3, to: "/reports" },
  { id: "standard", label: "Standard Reports", icon: ClipboardList, to: "/reports/standard" },
  { id: "reviews", label: "Business Reviews", icon: Presentation, to: "/reports/reviews" },
  { id: "custom", label: "Custom Reports", icon: Filter, to: "/reports/custom" },
  { id: "analytics", label: "Analytics", icon: TrendingUp, to: "/reports/analytics" },
];

/**
 * The reviews entry points. `/reports/reviews` reads its cadence from the query string (so a card
 * can link straight to its own cadence), and the older `/reports/qbr` and the two cadence-specific
 * paths keep working — a link somebody has already sent should not break because the report grew
 * two siblings.
 */
export function ReviewsPage({ period }: { period?: string }) {
  const [search] = useSearchParams();
  return <ReportsPage tab="reviews" period={period ?? search.get("period") ?? undefined} />;
}

export function ReportsPage({ tab: initialTab, period }: { tab?: string; period?: string }) {
  const navigate = useNavigate();
  const modern = useModernInterface();
  const activeTab = initialTab === "qbr" ? "reviews" : initialTab || "dashboard";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader variant="section" title="Reporting" subtitle="Dashboards, reports and analytics — every figure computed from the same source" />
        <div className="flex items-center gap-2">
          <Link to="/reports/custom" className="btn-secondary text-sm flex items-center gap-2"><Filter size={14} /> Custom Reports</Link>
          <Link to="/reports/reviews" className="btn-primary text-sm flex items-center gap-2"><Presentation size={14} /> Business Reviews</Link>
        </div>
      </div>

      {modern ? (
        <Tabs
          label="Reporting sections"
          items={TABS.map(t => ({ id: t.id, label: t.label }))}
          value={activeTab}
          onChange={(id) => { const next = TABS.find(x => x.id === id); if (next) navigate(next.to); }}
        />
      ) : (
      <div className="flex items-center gap-1 border-b border-surface-border pb-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.to)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${activeTab === tab.id ? "bg-surface border border-b-0 border-surface-border text-cyber-400" : "text-gray-400 hover:text-white hover:bg-surface-lighter/50"}`}
            >
              <Icon size={15} />{tab.label}
            </button>
          );
        })}
      </div>
      )}

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "standard" && <StandardReportsTab />}
      {activeTab === "reviews" && <ReviewsTab initialPeriod={period} />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Standard reports
// ═══════════════════════════════════════════════════════════════════

/** A review's card opens the review tab on that card's own cadence. */
const reviewCadence = (id: string): string => (id === "weekly-review" ? "week" : id === "monthly-review" ? "month" : "quarter");

function StandardReportsTab() {
  const options = useReportOptions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState<StandardReport | null>(null);
  const [filters, setFilters] = useState<ReportFilters>({ ...EMPTY_FILTERS });
  const [exporting, setExporting] = useState<StandardReport | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [values, setValues] = useState<ReportOptionValues>({});
  const navigate = useNavigate();

  /**
   * A report can be opened from a link — the inactive-accounts report is reached from C7NC —
   * and the client and options come with it, so a saved link opens the exact report somebody meant
   * rather than the list it lives in.
   */
  useEffect(() => {
    const requested = searchParams.get("report");
    if (!requested) return;
    const report = REPORT_BY_ID.get(requested);
    if (!report) return;
    setOpen(report);
    setValues(current => ({ ...defaultOptionValues(report), ...current }));
    const clientId = searchParams.get("clientId");
    if (clientId) setFilters(current => ({ ...current, clientId }));
  }, [searchParams]);

  const closeReport = () => {
    setOpen(null);
    if (searchParams.get("report")) {
      const next = new URLSearchParams(searchParams);
      next.delete("report");
      next.delete("clientId");
      setSearchParams(next, { replace: true });
    }
  };

  /** The options in force for a report: its defaults, overridden by whatever has been chosen. */
  const valuesFor = (report: StandardReport): ReportOptionValues => ({ ...defaultOptionValues(report), ...values });

  /** Print from a card runs the report first and prints *that*, rather than the application. */
  const print = async (report: StandardReport) => {
    setPrinting(report.id);
    try {
      const r = await api.get(report.endpoint, { params: reportQuery(report, filters, valuesFor(report)) });
      printReport({
        title: report.title,
        subtitle: report.description,
        period: periodLabel(r.data),
        sections: report.build(r.data as Record<string, unknown>),
      });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not prepare the report for printing"));
    } finally {
      setPrinting(null);
    }
  };

  if (open) {
    return (
      <ReportViewer
        report={open}
        filters={filters}
        onFilters={setFilters}
        options={options}
        values={valuesFor(open)}
        onValue={(key, value) => setValues(current => ({ ...current, [key]: value }))}
        onClose={closeReport}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-start gap-2">
        <Filter size={16} className="text-cyber-400 mt-0.5" />
        <p className="text-xs text-gray-400">
          {STANDARD_REPORTS.length} standard reports. Each answers the same set of filters, and what you see on screen is
          what prints and what exports — the file is built from the same sections as the page.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {STANDARD_REPORTS.map(report => (
          <div key={report.id} className="card hover:border-cyber-500/30 transition-colors group flex flex-col">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-cyber-600/10"><report.icon size={18} className="text-cyber-400" /></div>
              <div className="flex-1">
                <h3 className="font-semibold text-white text-sm group-hover:text-cyber-400">{report.title}</h3>
                <p className="text-xs text-gray-500 mt-1">{report.description}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button onClick={() => (report.quarters ? navigate(`/reports/reviews?period=${reviewCadence(report.id)}`) : setOpen(report))} className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5">
                <FileText size={12} /> Run Report
              </button>
              <button onClick={() => void print(report)} disabled={printing === report.id} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5">
                <Printer size={12} /> {printing === report.id ? "Preparing…" : "Print"}
              </button>
              <button onClick={() => setExporting(report)} className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"><Download size={12} /> Export</button>
              {report.options?.length ? (
                <span className="text-[10px] text-gray-500 ml-1">{report.options.length} option{report.options.length === 1 ? "" : "s"} — threshold, scope and what to include</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {exporting && (
        <ExportDialog
          document_={{ title: exporting.title, subtitle: exporting.description, sections: [] }}
          report={exporting}
          filters={filters}
          options={options}
          values={valuesFor(exporting)}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Business reviews — one pack, three cadences
// ═══════════════════════════════════════════════════════════════════

const CADENCES = [
  { id: "week", label: "Weekly", reportId: "weekly-review", path: "/reports/weekly-review", hint: "Last completed week against the week before" },
  { id: "month", label: "Monthly", reportId: "monthly-review", path: "/reports/monthly-review", hint: "Last completed month against the month before" },
  { id: "quarter", label: "Quarterly", reportId: "qbr", path: "/reports/qbr", hint: "Last completed quarter against the quarter before" },
] as const;

function ReviewsTab({ initialPeriod }: { initialPeriod?: string }) {
  const options = useReportOptions();
  const navigate = useNavigate();
  const [cadenceId, setCadenceId] = useState<string>(CADENCES.some(c => c.id === initialPeriod) ? initialPeriod! : "quarter");
  const [filters, setFilters] = useState<ReportFilters>({ ...EMPTY_FILTERS });
  const [periods, setPeriods] = useState<Array<{ label: string; from: string; to: string }>>([]);
  const [period, setPeriod] = useState("");

  const cadence = CADENCES.find(c => c.id === cadenceId) ?? CADENCES[2];
  const report = REVIEW_REPORTS.find(r => r.id === cadence.reportId)!;

  // Switching cadence resets the window: a week's dates mean nothing to a quarter.
  useEffect(() => {
    setFilters({ ...EMPTY_FILTERS });
    setPeriod("");
    setPeriods([]);
  }, [cadenceId]);

  // The period list comes from the report itself, so the picker and the pack agree on which
  // periods exist. Loaded once per cadence: choosing a period must not re-derive the list.
  useEffect(() => {
    let live = true;
    api.get(report.endpoint)
      .then(r => {
        if (!live) return;
        const list = (r.data?.periodOptions ?? r.data?.quarters ?? []) as Array<{ label: string; from: string; to: string }>;
        setPeriods(list);
        setPeriod(r.data?.reviewedPeriod ?? r.data?.reviewedQuarter ?? list[0]?.label ?? "");
      })
      .catch(() => { if (live) setPeriods([]); });
    return () => { live = false; };
  }, [report.endpoint]);

  const pickPeriod = (label: string) => {
    const found = periods.find(p => p.label === label);
    setPeriod(label);
    if (found) setFilters(current => ({ ...current, from: found.from.slice(0, 10), to: found.to.slice(0, 10) }));
  };

  return (
    <div className="space-y-4">
      <div className="card border-cyber-600/30">
        <div className="flex items-start gap-3">
          <Presentation size={18} className="text-cyber-400 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-white">Business Reviews</h3>
            <p className="text-xs text-gray-400 mt-1">
              One pack at three cadences: service delivery, targets, commercials, estate and risk, against the period
              before. It opens on the last <em>finished</em> period, and a comparison is like for like — a period still in
              progress is measured against the same number of days of its predecessor.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {CADENCES.map(option => (
          <button
            key={option.id}
            onClick={() => setCadenceId(option.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${cadenceId === option.id ? "bg-cyber-600/20 border-cyber-500/40 text-cyber-400" : "border-surface-border text-gray-400 hover:text-white hover:bg-surface-lighter"}`}
            title={option.hint}
          >
            {option.label}
          </button>
        ))}
        <button className="btn-secondary text-xs ml-auto" onClick={() => navigate(cadence.path)}>Open in its own view</button>
      </div>

      <ReportViewer
        key={cadenceId}
        report={report}
        filters={filters}
        onFilters={setFilters}
        options={options}
        quarterPicker={periods.length ? { value: period, options: periods, onSelect: pickPeriod } : undefined}
        values={defaultOptionValues(report)}
        onValue={() => {}}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════════════

function DashboardTab() {
  const [volume, setVolume] = useState<Record<string, unknown> | null>(null);
  const [sla, setSla] = useState<Record<string, unknown> | null>(null);
  const [utilization, setUtilization] = useState<Array<Record<string, unknown>>>([]);
  const [revenue, setRevenue] = useState<Record<string, unknown> | null>(null);
  const [aging, setAging] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get("/reports/data/ticket-volume").then(r => setVolume(r.data)).catch(() => setVolume(null)),
      api.get("/reports/data/sla-compliance").then(r => setSla(r.data)).catch(() => setSla(null)),
      api.get("/reports/data/technician-utilization").then(r => setUtilization(r.data?.technicians ?? [])).catch(() => setUtilization([])),
      api.get("/reports/data/revenue-summary").then(r => setRevenue(r.data)).catch(() => setRevenue(null)),
      api.get("/reports/data/ticket-aging").then(r => setAging(r.data)).catch(() => setAging(null)),
    ]).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <ReportsSkeleton />;

  const base = { title: "C7NTAX — Reporting Dashboard", subtitle: "Volume, compliance, revenue and receivables", period: "All time" };
  const responsePct = Number(sla?.responseCompliancePct ?? 0);
  const resolutionPct = Number(sla?.resolutionCompliancePct ?? 0);
  const statuses = (volume?.byStatus ?? []) as Array<{ label: string; count: number }>;
  const priorities = (volume?.byPriority ?? []) as Array<{ label: string; count: number }>;
  const boards = (volume?.byBoard ?? []) as Array<{ label: string; count: number }>;
  const monthly = (revenue?.monthlyRevenue ?? []) as Array<{ month: string; invoiced: number; collected: number }>;
  const buckets = (aging?.buckets ?? []) as Array<{ label: string; count: number; pct: number }>;
  const total = Number(volume?.total ?? 0);
  const maxBoard = Math.max(...boards.map(b => b.count), 1);
  const maxMonth = Math.max(...monthly.map(m => Math.max(m.invoiced, m.collected)), 1);

  const printDashboard = () => printReport({
    ...base,
    sections: [
      {
        kind: "kpis",
        items: [
          { label: "Tickets", value: number(total) },
          { label: "Open", value: number(volume?.open ?? 0) },
          { label: "Response compliance", value: `${responsePct}%` },
          { label: "Resolution compliance", value: `${resolutionPct}%` },
        ],
      },
      {
        kind: "kpis",
        items: [
          { label: "Collected (all time)", value: money(revenue?.totalPaidAllTime ?? 0) },
          { label: "Outstanding", value: money(revenue?.totalOutstanding ?? 0) },
          { label: "Overdue", value: money(revenue?.totalOverdue ?? 0) },
          { label: "Collection rate", value: `${number(revenue?.collectionRate ?? 0)}%` },
        ],
      },
      { kind: "table", title: "Tickets by status", columns: [{ key: "label", label: "Status" }, { key: "count", label: "Tickets", align: "right" }, { key: "share", label: "Share", align: "right", format: "percent" }], rows: statuses.map(s => ({ ...s, share: total ? Math.round((s.count / total) * 1000) / 10 : 0 })) },
      { kind: "table", title: "Tickets by priority", columns: [{ key: "label", label: "Priority" }, { key: "count", label: "Tickets", align: "right" }], rows: priorities },
      { kind: "table", title: "Tickets by board", columns: [{ key: "label", label: "Board" }, { key: "count", label: "Tickets", align: "right" }], rows: boards },
      { kind: "table", title: "Monthly revenue", columns: [{ key: "month", label: "Month" }, { key: "invoiced", label: "Invoiced", align: "right", format: "money" }, { key: "collected", label: "Collected", align: "right", format: "money" }], rows: monthly },
      { kind: "table", title: "Receivables ageing", columns: [{ key: "label", label: "Bucket" }, { key: "invoices", label: "Invoices", align: "right" }, { key: "amount", label: "Amount", align: "right", format: "money" }], rows: (revenue?.aging ?? []) as Array<Record<string, unknown>> },
      { kind: "table", title: "Open tickets by age", columns: [{ key: "label", label: "Age" }, { key: "count", label: "Tickets", align: "right" }, { key: "pct", label: "Share", align: "right", format: "percent" }], rows: buckets },
      {
        kind: "table",
        title: "Technician activity",
        columns: [
          { key: "name", label: "Technician" },
          { key: "billable", label: "Billable hours", align: "right" },
          { key: "nonBillable", label: "Non-billable", align: "right" },
          { key: "closed", label: "Resolved", align: "right" },
          { key: "utilization", label: "Utilization", align: "right" },
        ],
        rows: utilization.map(u => ({
          name: String(u.name ?? "—"),
          billable: Math.round(Number(u.billableMinutes ?? 0) / 6) / 10,
          nonBillable: Math.round(Number(u.nonBillableMinutes ?? 0) / 6) / 10,
          closed: number(u.ticketsClosed),
          utilization: u.utilizationPct === null || u.utilizationPct === undefined ? "—" : `${number(u.utilizationPct)}%`,
        })),
      },
    ],
  });

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2">
        <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5"><RefreshCw size={12} /> Refresh</button>
        <button onClick={printDashboard} className="btn-secondary text-xs flex items-center gap-1.5"><Printer size={12} /> Print dashboard</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Ticket} label="Open tickets" value={number(volume?.open ?? 0)} sub={`${number(total)} in total`} tone="info" />
        <KpiCard icon={CheckCircle} label="Response compliance" value={`${responsePct}%`} sub={`Resolution ${resolutionPct}%`} tone={responsePct >= 90 ? "good" : responsePct >= 70 ? "warn" : "bad"} />
        <KpiCard icon={DollarSign} label="Collected (all time)" value={money(revenue?.totalPaidAllTime ?? 0)} sub={`${money(revenue?.totalOutstanding ?? 0)} outstanding`} tone="good" />
        <KpiCard icon={Clock} label="Overdue" value={money(revenue?.totalOverdue ?? 0)} sub={`${number(revenue?.openCount ?? 0)} open invoices`} tone="bad" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Tickets by status</h3>
          <div className="space-y-2">
            {statuses.map(s => (
              <div key={s.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 capitalize">{s.label}</span>
                  <span className="text-gray-500">{number(s.count)} ({total ? Math.round((s.count / total) * 100) : 0}%)</span>
                </div>
                <div className="h-2 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-cyber-500 rounded-full" style={{ width: `${total ? Math.max(2, Math.round((s.count / total) * 100)) : 2}%` }} /></div>
              </div>
            ))}
            {statuses.length === 0 && <p className="text-sm text-gray-600">No tickets.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Tickets by priority</h3>
          <div className="space-y-2">
            {priorities.map(p => (
              <div key={p.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 capitalize">{p.label}</span>
                  <span className="text-gray-500">{number(p.count)}</span>
                </div>
                <div className="h-2 bg-surface-lighter rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${p.label === "critical" ? "bg-red-500" : p.label === "high" ? "bg-orange-500" : p.label === "medium" ? "bg-amber-500" : "bg-gray-500"}`} style={{ width: `${Math.max(2, Math.round((p.count / Math.max(...priorities.map(x => x.count), 1)) * 100))}%` }} />
                </div>
              </div>
            ))}
            {priorities.length === 0 && <p className="text-sm text-gray-600">No tickets.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Tickets by board</h3>
          <div className="space-y-2">
            {boards.map(b => (
              <div key={b.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs"><span className="text-gray-300">{b.label}</span><span className="text-gray-500">{number(b.count)}</span></div>
                <div className="h-1.5 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-cyber-500 rounded-full" style={{ width: `${Math.max(2, Math.round((b.count / maxBoard) * 100))}%` }} /></div>
              </div>
            ))}
            {boards.length === 0 && <p className="text-sm text-gray-600">No tickets.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Invoiced against collected</h3>
          {monthly.length === 0 ? <p className="text-sm text-gray-600">No invoices yet.</p> : (
            <div className="space-y-3">
              {monthly.slice(-8).map(m => (
                <div key={m.month} className="space-y-1">
                  <div className="flex items-center justify-between text-xs"><span className="text-gray-300">{m.month}</span><span className="text-gray-500">{money(m.invoiced)} invoiced · {money(m.collected)} collected</span></div>
                  <div className="h-2 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-cyber-500" style={{ width: `${Math.max(2, Math.round((m.invoiced / maxMonth) * 100))}%` }} /></div>
                  <div className="h-2 bg-surface-lighter rounded-full overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${Math.max(2, Math.round((m.collected / maxMonth) * 100))}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Technician activity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase">
              <th className="p-3">Technician</th><th className="p-3">Billable</th><th className="p-3">Non-billable</th><th className="p-3">Total</th><th className="p-3">Billable %</th><th className="p-3">Resolved</th>
            </tr></thead>
            <tbody>
              {utilization.map(u => (
                <tr key={String(u.userId)} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
                  <td className="p-3 text-white font-medium">{String(u.name ?? "—")}</td>
                  <td className="p-3 text-green-400">{Math.round(Number(u.billableMinutes ?? 0) / 6) / 10}h</td>
                  <td className="p-3 text-gray-400">{Math.round(Number(u.nonBillableMinutes ?? 0) / 6) / 10}h</td>
                  <td className="p-3 text-white">{Math.round(Number(u.totalMinutes ?? 0) / 6) / 10}h</td>
                  <td className="p-3 text-gray-300">{number(u.billablePct)}%</td>
                  <td className="p-3 text-gray-300">{number(u.ticketsClosed)}</td>
                </tr>
              ))}
              {utilization.length === 0 && <tr><td colSpan={6} className="p-3 text-gray-600">No time recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: string | number; sub?: string; tone: "good" | "warn" | "bad" | "info" }) {
  const colour = tone === "good" ? "text-green-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-cyber-400";
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-surface-lighter"><Icon size={18} className={colour} /></div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-lg font-bold ${colour}`}>{value}</p>
        {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Analytics
// ═══════════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const [revenue, setRevenue] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    api.get("/reports/data/revenue-summary").then(r => setRevenue(r.data)).catch(() => setRevenue(null)).finally(() => setLoading(false));
  }, []);

  const monthly = (revenue?.monthlyRevenue ?? []) as Array<{ month: string; invoiced: number; collected: number }>;
  const maxMonth = Math.max(...monthly.map(m => Math.max(m.invoiced, m.collected)), 1);
  const BAR_MAX_PX = 140;

  if (loading) return <TableSkeleton />;

  return (
    <div className="space-y-5">
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-cyber-400" />Monthly revenue</h3>
        {monthly.length > 0 ? (
          <div className="flex items-end gap-2 h-48">
            {monthly.map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group" title={`${m.month}: ${money(m.invoiced)} invoiced, ${money(m.collected)} collected`}>
                <span className="text-[10px] text-gray-500 opacity-0 group-hover:opacity-100">{money(m.invoiced)}</span>
                <div className="w-full bg-cyber-500 rounded-t hover:bg-cyber-400 transition-colors" style={{ height: `${Math.max(4, Math.round((m.invoiced / maxMonth) * BAR_MAX_PX))}px` }} />
                <div className="w-full bg-green-500 rounded-b hover:bg-green-400 transition-colors" style={{ height: `${Math.max(2, Math.round((m.collected / maxMonth) * BAR_MAX_PX * 0.6))}px` }} />
                <span className="text-[10px] text-gray-600">{m.month}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-gray-500 text-sm">No revenue data available</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Financial overview</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-400">Invoiced (period)</span><span className="text-white">{money(revenue?.invoicedInPeriod ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Collected (period)</span><span className="text-green-400">{money(revenue?.collectedInPeriod ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Outstanding</span><span className="text-amber-400">{money(revenue?.totalOutstanding ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Overdue</span><span className="text-red-400">{money(revenue?.totalOverdue ?? 0)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Collection rate</span><span className="text-cyber-400">{number(revenue?.collectionRate ?? 0)}%</span></div>
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Quick actions</h3>
          <div className="space-y-2">
            <button onClick={() => setShowSchedule(true)} className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Calendar size={14} />Schedule a saved report</button>
            <Link to="/reports/standard" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><ClipboardList size={14} />Standard Reports</Link>
            <Link to="/reports/custom" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Filter size={14} />Custom Reports</Link>
            <Link to="/reports/qbr" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Presentation size={14} />Quarterly business review</Link>
          </div>
        </div>
      </div>

      {showSchedule && <ScheduleReportDialog onClose={() => setShowSchedule(false)} />}
    </div>
  );
}

export default ReportsPage;
