import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  TrendingUp, BarChart3, ClipboardList, Download, Filter, CheckCircle, AlertTriangle,
  Ticket, DollarSign, Clock, Printer, Presentation, Calendar, FileText, X, RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { ReportsSkeleton, TableSkeleton } from "../components/ui/Skeleton";
import { apiErrorMessage } from "../lib/apiError";
import { downloadCsv } from "../lib/csv";
import { ReportBody, exportCsv, exportExcel, exportPdf, money, number, printReport, sectionsToTables, type Section } from "../components/reports/reportKit";
import { REPORT_BY_ID, REPORT_TYPE_OPTIONS, REVIEW_REPORTS, STANDARD_REPORTS, type StandardReport } from "../components/reports/standardReports";
import { ScheduleReportDialog } from "../components/reports/ScheduleReportDialog";

const TABS: Array<{ id: string; label: string; icon: LucideIcon; to: string }> = [
  { id: "dashboard", label: "Dashboards", icon: BarChart3, to: "/reports" },
  { id: "standard", label: "Standard Reports", icon: ClipboardList, to: "/reports/standard" },
  { id: "reviews", label: "Business Reviews", icon: Presentation, to: "/reports/reviews" },
  { id: "custom", label: "Custom Reports", icon: Filter, to: "/reports/custom" },
  { id: "analytics", label: "Analytics", icon: TrendingUp, to: "/reports/analytics" },
];

export interface ReportFilters { from: string; to: string; clientId: string; boardId: string }
export interface FilterOptions { clients: Array<{ id: string; name: string }>; boards: Array<{ id: string; name: string }>; tenants: Array<{ id: string; name: string }> }

const EMPTY_FILTERS: ReportFilters = { from: "", to: "", clientId: "", boardId: "" };

const filterQuery = (filters: ReportFilters): Record<string, string> =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string>;

/** A report's own options, as the query parameters its endpoint reads. */
type ReportOptionValues = Record<string, string | number | boolean>;

const optionQuery = (report: StandardReport, values: ReportOptionValues): Record<string, string> =>
  Object.fromEntries(
    (report.options ?? [])
      .map(option => [option.key, values[option.key] ?? option.default] as const)
      .map(([key, value]) => [key, typeof value === "boolean" ? String(value) : String(value)] as const),
  );

/** Everything the endpoint needs: the shared filters, then the report's own choices. */
const reportQuery = (report: StandardReport, filters: ReportFilters, values: ReportOptionValues) => ({
  ...filterQuery(filters),
  ...optionQuery(report, values),
});

const defaultOptionValues = (report: StandardReport): ReportOptionValues =>
  Object.fromEntries((report.options ?? []).map(option => [option.key, option.default]));

/** The period the server actually applied, so the screen can never imply a range it did not use. */
const periodLabel = (payload: unknown): string => (payload as { period?: { label?: string } } | null)?.period?.label ?? "";

/** The filter options every report shares, loaded once per page. */
function useReportOptions(): FilterOptions {
  const [options, setOptions] = useState<FilterOptions>({ clients: [], boards: [], tenants: [] });
  useEffect(() => {
    api.get("/reports/data/options")
      .then(r => setOptions({ clients: r.data?.clients ?? [], boards: r.data?.boards ?? [], tenants: r.data?.tenants ?? [] }))
      .catch(() => setOptions({ clients: [], boards: [], tenants: [] }));
  }, []);
  return options;
}

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
  const activeTab = initialTab === "qbr" ? "reviews" : initialTab || "dashboard";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Reporting</h2>
          <p className="text-sm text-gray-400">Dashboards, reports and analytics — every figure computed from the same source</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/reports/custom" className="btn-secondary text-sm flex items-center gap-2"><Filter size={14} /> Custom Reports</Link>
          <Link to="/reports/reviews" className="btn-primary text-sm flex items-center gap-2"><Presentation size={14} /> Business Reviews</Link>
        </div>
      </div>

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

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "standard" && <StandardReportsTab />}
      {activeTab === "reviews" && <ReviewsTab initialPeriod={period} />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Filter bar
// ═══════════════════════════════════════════════════════════════════

function FilterBar({
  report, filters, onChange, options, onRefresh, busy, quarterPicker, values, onValue,
}: {
  report: StandardReport;
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  options: FilterOptions;
  onRefresh: () => void;
  busy: boolean;
  quarterPicker?: { value: string; options: Array<{ label: string }>; onSelect: (label: string) => void };
  values: ReportOptionValues;
  onValue: (key: string, value: string | number | boolean) => void;
}) {
  const showPeriod = report.filters.period && !quarterPicker;
  const active = Boolean(filters.from || filters.to || filters.clientId || filters.boardId);
  return (
    <div className="card flex flex-wrap items-end gap-3">
      {quarterPicker && (
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Quarter</label>
          <select className="input-field text-sm" value={quarterPicker.value} onChange={e => quarterPicker.onSelect(e.target.value)}>
            {quarterPicker.options.map(q => <option key={q.label} value={q.label}>{q.label}</option>)}
          </select>
        </div>
      )}
      {showPeriod && (
        <>
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">From</label>
            <input type="date" className="input-field text-sm" value={filters.from} onChange={e => onChange({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">To</label>
            <input type="date" className="input-field text-sm" value={filters.to} onChange={e => onChange({ ...filters, to: e.target.value })} />
          </div>
        </>
      )}
      {report.filters.client && (
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Client</label>
          <select className="input-field text-sm" value={filters.clientId} onChange={e => onChange({ ...filters, clientId: e.target.value })}>
            <option value="">All clients</option>
            {options.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {report.filters.board && (
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Board</label>
          <select className="input-field text-sm" value={filters.boardId} onChange={e => onChange({ ...filters, boardId: e.target.value })}>
            <option value="">All boards</option>
            {options.boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      {/* The report's own questions, asked in the same place as the shared ones. */}
      {(report.options ?? []).map(option => {
        const value = values[option.key] ?? option.default;
        if (option.kind === "boolean") {
          return (
            <label key={option.key} className="flex items-center gap-2 pb-2 cursor-pointer" title={option.hint}>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={e => onValue(option.key, e.target.checked)}
              />
              <span className="text-xs text-gray-300">{option.label}</span>
              {values[option.key] !== option.default && <span className="text-[10px] text-cyber-400">changed</span>}
            </label>
          );
        }
        if (option.kind === "tenant") {
          if (options.tenants.length === 0) return null;
          return (
            <div key={option.key} title={option.hint}>
              <label className="text-[11px] text-gray-500 block mb-1">{option.label}</label>
              <select className="input-field text-sm" value={String(value)} onChange={e => onValue(option.key, e.target.value)}>
                <option value="">All tenants</option>
                {options.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          );
        }
        return (
          <div key={option.key} title={option.hint}>
            <label className="text-[11px] text-gray-500 block mb-1">{option.label}</label>
            <input
              type="number"
              min={1}
              className="input-field text-sm w-28"
              value={Number(value)}
              onChange={e => onValue(option.key, Number(e.target.value) || option.default)}
            />
            {option.suffix && <span className="text-[10px] text-gray-500 ml-1">{option.suffix}</span>}
          </div>
        );
      })}
      {active && (
        <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          <X size={12} /> Clear filters
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-[11px] text-gray-500">{active ? "Filtered" : "All time"}</span>
        <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Report viewer — the detail view every entry point shares
// ═══════════════════════════════════════════════════════════════════

function ReportViewer({
  report, filters, onFilters, options, onClose, quarterPicker, values, onValue,
}: {
  report: StandardReport;
  filters: ReportFilters;
  onFilters: (next: ReportFilters) => void;
  options: FilterOptions;
  onClose?: () => void;
  quarterPicker?: { value: string; options: Array<{ label: string }>; onSelect: (label: string) => void };
  values: ReportOptionValues;
  onValue: (key: string, value: string | number | boolean) => void;
}) {
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get(report.endpoint, { params: reportQuery(report, filters, values) })
      .then(r => setPayload(r.data))
      .catch(e => { setError(apiErrorMessage(e, "Could not run the report")); setPayload(null); })
      .finally(() => setLoading(false));
  }, [report, filters, values]);

  useEffect(() => { load(); }, [load]);

  const sections: Section[] = useMemo(() => (payload ? report.build(payload as Record<string, unknown>) : []), [payload, report]);
  const document_ = useMemo(
    () => ({ title: report.title, subtitle: report.description, period: periodLabel(payload), sections }),
    [report, payload, sections],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <report.icon size={18} className="text-cyber-400" />
          <div>
            <h3 className="text-base font-semibold text-white">{report.title}</h3>
            <p className="text-xs text-gray-500">{report.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => printReport(document_)} disabled={!payload}><Printer size={13} /> Print</button>
          <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => setShowExport(true)} disabled={!payload}><Download size={13} /> Export</button>
          {onClose && <button className="btn-secondary text-xs" onClick={onClose}>Close</button>}
        </div>
      </div>

      <FilterBar report={report} filters={filters} onChange={onFilters} options={options} onRefresh={load} busy={loading} quarterPicker={quarterPicker} values={values} onValue={onValue} />

      {payload != null && (
        <p className="text-xs text-gray-500">
          {periodLabel(payload) ? `Period: ${periodLabel(payload)} · ` : ""}
          Generated {new Date().toLocaleString()} · {sections.length} section{sections.length === 1 ? "" : "s"}
        </p>
      )}

      {loading ? <ReportsSkeleton /> : error ? (
        <div className="card border-red-600/40">
          <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>
          <button className="btn-secondary text-xs mt-3" onClick={load}>Try again</button>
        </div>
      ) : (
        <ReportBody sections={sections} />
      )}

      {showExport && (
        <ExportDialog document_={document_} report={report} filters={filters} options={options} values={values} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Export — the filters offered here are applied, not decorative
// ═══════════════════════════════════════════════════════════════════

function ExportDialog({
  document_, report, filters, options, onClose, values,
}: {
  document_: { title: string; subtitle?: string; period?: string; sections: Section[] };
  report: StandardReport;
  filters: ReportFilters;
  options: FilterOptions;
  onClose: () => void;
  values: ReportOptionValues;
}) {
  const [format, setFormat] = useState<"pdf" | "excel" | "csv">("pdf");
  const [exportFilters, setExportFilters] = useState<ReportFilters>({ ...filters });
  // The report's own choices are editable here too — an export is often the moment somebody wants
  // "every client at 60 days" rather than whatever the screen was showing.
  const [exportValues, setExportValues] = useState<ReportOptionValues>({ ...values });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Section[] | null>(null);
  const [previewPeriod, setPreviewPeriod] = useState("");

  // The export runs against the filter set chosen *here*, so the file matches the options picked
  // rather than whichever ones the screen happened to be showing.
  const runPreview = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.get(report.endpoint, { params: reportQuery(report, exportFilters, exportValues) });
      setPreview(report.build(r.data as Record<string, unknown>));
      setPreviewPeriod(periodLabel(r.data));
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not prepare the export"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [report, exportFilters, values]);

  useEffect(() => { void runPreview(); }, [runPreview]);

  const tables = preview ? sectionsToTables(preview) : [];
  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0);
  const changed = JSON.stringify(exportFilters) !== JSON.stringify(filters);

  const doExport = () => {
    if (!preview) return;
    const doc = { ...document_, period: previewPeriod || document_.period, sections: preview };
    if (format === "pdf") exportPdf(doc);
    else if (format === "excel") exportExcel(doc);
    else exportCsv(doc, downloadCsv);
    toast.success(`${report.title} exported as ${format === "excel" ? "Excel" : format.toUpperCase()}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Export {report.title}</h3>
            <p className="text-xs text-gray-500">{tables.length} table{tables.length === 1 ? "" : "s"} · {number(rowCount)} rows{previewPeriod ? ` · ${previewPeriod}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-2">Format</label>
          <div className="flex gap-2 flex-wrap">
            {([{ id: "pdf", label: "PDF", hint: "Print-ready, one table per block" }, { id: "excel", label: "Excel (.xls)", hint: "A sheet per table, typed cells" }, { id: "csv", label: "CSV", hint: "Every table, stacked" }] as const).map(f => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${format === f.id ? "bg-cyber-600/20 border-cyber-500/40 text-cyber-400" : "border-surface-border text-gray-400 hover:text-white hover:bg-surface-lighter"}`}
              >
                <span className="block">{f.label}</span>
                <span className="block text-[10px] text-gray-500">{f.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {report.filters.period && (
            <>
              <div><label className="text-xs text-gray-500 block mb-1">From</label><input type="date" className="input-field" value={exportFilters.from} onChange={e => setExportFilters({ ...exportFilters, from: e.target.value })} /></div>
              <div><label className="text-xs text-gray-500 block mb-1">To</label><input type="date" className="input-field" value={exportFilters.to} onChange={e => setExportFilters({ ...exportFilters, to: e.target.value })} /></div>
            </>
          )}
          {report.filters.client && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Report by client</label>
              <select className="input-field" value={exportFilters.clientId} onChange={e => setExportFilters({ ...exportFilters, clientId: e.target.value })}>
                <option value="">All clients</option>
                {options.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {report.filters.board && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Board</label>
              <select className="input-field" value={exportFilters.boardId} onChange={e => setExportFilters({ ...exportFilters, boardId: e.target.value })}>
                <option value="">All boards</option>
                {options.boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          {(report.options ?? []).map(option => {
            const value = exportValues[option.key] ?? option.default;
            if (option.kind === "boolean") {
              return (
                <label key={option.key} className="flex items-center gap-2 cursor-pointer" title={option.hint}>
                  <input type="checkbox" checked={Boolean(value)} onChange={e => setExportValues({ ...exportValues, [option.key]: e.target.checked })} />
                  <span className="text-xs text-gray-300">{option.label}</span>
                </label>
              );
            }
            if (option.kind === "tenant") {
              if (options.tenants.length === 0) return null;
              return (
                <div key={option.key} title={option.hint}>
                  <label className="text-xs text-gray-500 block mb-1">{option.label}</label>
                  <select className="input-field" value={String(value)} onChange={e => setExportValues({ ...exportValues, [option.key]: e.target.value })}>
                    <option value="">All tenants</option>
                    {options.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              );
            }
            return (
              <div key={option.key} title={option.hint}>
                <label className="text-xs text-gray-500 block mb-1">{option.label}{option.suffix ? ` (${option.suffix})` : ""}</label>
                <input type="number" min={1} className="input-field" value={Number(value)} onChange={e => setExportValues({ ...exportValues, [option.key]: Number(e.target.value) || option.default })} />
              </div>
            );
          })}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500">Preview — exactly what the file will contain</label>
            {changed && (
              <button className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1" onClick={() => void runPreview()} disabled={busy}>
                <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> Apply these filters
              </button>
            )}
          </div>
          <div className="bg-surface-lighter rounded-lg p-3 max-h-72 overflow-auto">
            {busy ? <p className="text-sm text-gray-500">Preparing…</p>
              : preview && preview.length ? <ReportBody sections={preview} compact /> : <p className="text-sm text-gray-500">Nothing to preview.</p>}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={doExport} className="btn-primary text-sm flex items-center gap-1.5" disabled={!preview || busy}>
            <Download size={14} /> Export {format === "excel" ? "Excel" : format.toUpperCase()}
          </button>
        </div>
      </div>
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
   * A report can be opened from a link — the inactive-accounts report is reached from CloudConnect —
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
            <Link to="/reports/standard" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><ClipboardList size={14} />Standard reports</Link>
            <Link to="/reports/custom" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Filter size={14} />Custom reports</Link>
            <Link to="/reports/qbr" className="btn-secondary w-full text-sm flex items-center gap-2 justify-center"><Presentation size={14} />Quarterly business review</Link>
          </div>
        </div>
      </div>

      {showSchedule && <ScheduleReportDialog onClose={() => setShowSchedule(false)} />}
    </div>
  );
}

export default ReportsPage;
