import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  Calendar, Copy, Download, Filter, LayoutTemplate, Pencil, Play, Plus, Printer, RefreshCw, Search, Trash2, X, AlertTriangle,
} from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { apiErrorMessage } from "../lib/apiError";
import { downloadCsv } from "../lib/csv";
import { ReportBody, exportCsv, exportExcel, exportPdf, labelFor, number, printReport, type Section } from "../components/reports/reportKit";
import { REPORT_BY_ID, REPORT_TYPE_OPTIONS, STANDARD_REPORTS } from "../components/reports/standardReports";
import { ScheduleReportDialog } from "../components/reports/ScheduleReportDialog";
import { layoutReport, type ReportTemplateDocument } from "@C7NTAX/shared";
import { documentBrandOf, useBrandKit } from "../hooks/useBrandKit";
import { measureTextMm } from "../lib/reportMeasure";
import { exportTemplateCsv, exportTemplateExcel, exportTemplatePdf, printTemplateReport } from "../lib/reportOutput";
import { LaidOutPageView } from "../components/reports/designer/PageRenderer";
import { PageHeader, ListViews, ListFooter } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

interface Schedule { id: string; frequency: string; timeOfDay: string; recipients: string[]; format: string; isActive: boolean; lastSentAt: string | null }
interface SavedReport {
  id: string; name: string; description: string | null; type: string; isSystem: boolean;
  config: Record<string, unknown> | null; createdById: string;
  createdBy?: { firstName: string; lastName: string } | null;
  createdAt: string; updatedAt: string; schedules?: Schedule[];
}

const CONFIG_SOURCES = ["tickets", "invoices", "time_entries", "expenses", "assets", "contacts", "companies"];
const CONFIG_OPERATORS = ["equals", "notEquals", "contains", "startsWith", "in", "gte", "lte", "between", "isNull", "isNotNull"];

/** A saved report's type as the standard report it runs, so the two can never disagree. */
function standardForType(type: string) {
  const alias: Record<string, string> = {
    ticket_summary: "ticket-volume",
    ticket_volume: "ticket-volume",
    time: "time-tracking",
    time_tracking: "time-tracking",
    contract: "contract-profitability",
    contract_profitability: "contract-profitability",
    client_value: "client-value",
    qbr: "qbr",
    quarterly_business_review: "qbr",
  };
  return REPORT_BY_ID.get(alias[type] ?? type);
}

/**
 * The sections a saved report's run produces. A config-driven report is its rows; a saved report of
 * a standard type is rendered by that standard report's own builder from the `summary` the server
 * returns, so a saved copy can never show a different number from the screen it came from.
 */
function sectionsForRun(payload: Record<string, unknown>, report: SavedReport): Section[] {
  const standard = standardForType(report.type);
  const summary = payload.summary as Record<string, unknown> | undefined;
  if (standard && summary) {
    const rows = (payload.data ?? []) as Array<Record<string, unknown>>;
    const columns = (payload.columns ?? []) as string[];
    return [
      ...standard.build({ ...summary, period: payload.period }),
      ...(rows.length && columns.length
        ? [{ kind: "table" as const, title: "Rows", columns: columns.map(c => ({ key: c, label: labelFor(c) })), rows }]
        : []),
    ];
  }

  const rows = (payload.data ?? []) as Array<Record<string, unknown>>;
  const columns = (payload.columns as string[] | undefined) ?? Object.keys(rows[0] ?? {});
  const notes = [
    ...((payload.notes as string[] | undefined) ?? []),
    ...(payload.truncated
      ? [`This run stopped at its configured row limit of ${number(payload.limit ?? 0)} — raise the limit or add a filter to see the rest.`]
      : []),
    ...(payload.note ? [String(payload.note)] : []),
  ];
  return [
    ...(notes.length ? [{ kind: "notes" as const, title: "About this run", items: notes, tone: "warn" as const }] : []),
    {
      kind: "table",
      title: `${number(rows.length)} row${rows.length === 1 ? "" : "s"}`,
      columns: columns.map(c => ({ key: c, label: labelFor(c) })),
      rows,
      emptyText: "This configuration returned no rows.",
    },
  ];
}

/**
 * A designed report, run and laid out. The rows come from the API's run of the template's own data
 * source and the pages from the same layout engine the designer previews with, so a saved report
 * cannot look different from the design it came from.
 */
function TemplateReportView({ report, payload, onClose }: { report: SavedReport; payload: Record<string, unknown>; onClose: () => void }) {
  const navigate = useNavigate();
  const document = asTemplate(payload.document);
  // Subscribed so the page is laid out again when `/api/brand` answers, rather than once with the
  // shipped defaults and never again.
  const brandKit = useBrandKit();
  const laid = useMemo(() => {
    if (!document) return null;
    // The accent, the type floor, the sheet and the page furniture are the document's, resolved from the
    // instance's brand exactly as the designer resolves them — so the saved report a person opens is the
    // design they approved, and not a second interpretation of it.
    const ink = documentBrandOf("report.designer");
    return layoutReport({
      document,
      rows: (payload.rows ?? []) as Array<Record<string, unknown>>,
      parameters: (payload.parameters ?? {}) as Record<string, unknown>,
      measure: measureTextMm,
      limit: payload.limit as number | undefined,
      // The run resolves the sub-reports, so a saved report prints the same embedded reports the
      // designer previewed — from the same child rows, on the same pages.
      subreports: payload.subreports as Record<string, { document: unknown; rows: Array<Record<string, unknown>>; parameters: Record<string, unknown>; name?: string }> | undefined,
      ink,
    });
  }, [document, payload, brandKit]);

  if (!document || !laid) {
    return <div className="card text-sm text-red-400">This template&apos;s document could not be read.</div>;
  }

  const meta = { title: report.name, subtitle: report.description ?? undefined, period: (payload.period as { label?: string } | undefined)?.label };
  const warnings = laid.issues.filter(issue => issue.severity === "warning");

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PageHeader variant="section" title={report.name} subtitle={<>{report.description ?? "Designed report"} · {laid.pages.length} page{laid.pages.length === 1 ? "" : "s"} · {laid.rowCount} row{laid.rowCount === 1 ? "" : "s"}</>} />
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => navigate(`/reports/custom/${report.id}/design`)}>
            <LayoutTemplate size={14} /> Design
          </button>
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => printTemplateReport(laid, meta)}><Printer size={14} /> Print</button>
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportTemplatePdf(laid, meta)}><Download size={14} /> PDF</button>
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportTemplateExcel(laid, document, meta)}><Download size={14} /> Excel</button>
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportTemplateCsv(laid, document, meta, downloadCsv)}><Download size={14} /> CSV</button>
          <button className="btn-secondary text-sm" onClick={onClose}>Close</button>
        </div>
      </div>

      {laid.refused ? (
        <div className="card border-red-600/40 text-sm text-red-300">
          This template has problems that stop it rendering: {laid.issues.filter(issue => issue.severity === "error").map(issue => issue.message).join(" ")}
        </div>
      ) : null}

      {warnings.length ? (
        <div className="card border-amber-600/40 text-xs text-amber-200 space-y-0.5">
          {warnings.map((issue, index) => <p key={index}>{issue.message}</p>)}
        </div>
      ) : null}

      <div className="space-y-4 overflow-auto">
        {laid.pages.map(page => <LaidOutPageView key={page.number} page={page} laid={laid} zoom={0.85} />)}
      </div>
    </div>
  );
}

/** A saved report's config carries its document; anything else is not a template we can draw. */
function asTemplate(value: unknown): ReportTemplateDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReportTemplateDocument>;
  return Array.isArray(candidate.bands) ? (value as ReportTemplateDocument) : null;
}

/**
 * Custom Reports.
 *
 * The landing page lists every saved report with what it is, who wrote it, when it runs and the
 * actions that work today — run, print, export, duplicate, schedule, design, edit, delete. A designed
 * report opens in the banded designer (`PlanDocs/PLAN-020-Custom-Report-Designer.md`); a config-driven
 * one keeps the form it was written with.
 */
export function CustomReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [scheduleOnly, setScheduleOnly] = useState(false);
  const [viewing, setViewing] = useState<SavedReport | null>(null);
  const [editing, setEditing] = useState<SavedReport | null>(null);
  const [creating, setCreating] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [scheduling, setScheduling] = useState<SavedReport | null>(null);
  const [deleting, setDeleting] = useState<SavedReport | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const modern = useModernInterface();

  const load = useCallback(() => {
    setLoading(true);
    api.get("/reports")
      .then(r => { setReports(r.data ?? []); setError(null); })
      .catch(e => setError(apiErrorMessage(e, "Could not load the saved reports")))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const types = useMemo(() => [...new Set(reports.map(r => r.type))].sort(), [reports]);
  const visible = useMemo(() => reports.filter(r => {
    if (typeFilter && r.type !== typeFilter) return false;
    if (scheduleOnly && !(r.schedules?.length)) return false;
    if (search) {
      const haystack = `${r.name} ${r.description ?? ""} ${String(r.config?.source ?? "")}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [reports, search, typeFilter, scheduleOnly]);

  const totals = useMemo(() => ({
    reports: reports.length,
    scheduled: reports.filter(r => (r.schedules?.length ?? 0) > 0).length,
    configDriven: reports.filter(r => r.type === "custom").length,
    types: types.length,
  }), [reports, types]);

  const run = async (report: SavedReport) => {
    setBusyId(report.id);
    try {
      const r = await api.get(`/reports/${report.id}/run`);
      setViewing({ ...report, config: { ...(report.config ?? {}), __payload: r.data } });
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not run the report"));
    } finally {
      setBusyId(null);
    }
  };

  const runAndThen = async (report: SavedReport, action: "print" | "pdf" | "excel" | "csv") => {
    setBusyId(report.id);
    try {
      const r = await api.get(`/reports/${report.id}/run`);
      const payload = r.data as Record<string, unknown>;
      const document = asTemplate(payload.document);
      if (document) {
        // A designed report exports from its layout, not from the section kit: its pages are its own.
        const laid = layoutReport({
          document,
          rows: (payload.rows ?? []) as Array<Record<string, unknown>>,
          parameters: (payload.parameters ?? {}) as Record<string, unknown>,
          measure: measureTextMm,
          limit: payload.limit as number | undefined,
          subreports: payload.subreports as Record<string, { document: unknown; rows: Array<Record<string, unknown>>; parameters: Record<string, unknown>; name?: string }> | undefined,
        });
        const meta = { title: report.name, subtitle: report.description ?? undefined, period: (payload.period as { label?: string } | undefined)?.label };
        if (action === "print") printTemplateReport(laid, meta);
        else {
          if (action === "pdf") exportTemplatePdf(laid, meta);
          else if (action === "excel") exportTemplateExcel(laid, document, meta);
          else exportTemplateCsv(laid, document, meta, downloadCsv);
          toast.success(`${report.name} exported`);
        }
        return;
      }

      const doc = {
        title: report.name,
        subtitle: report.description ?? undefined,
        period: (payload.period as { label?: string } | undefined)?.label ?? "",
        sections: sectionsForRun(payload, report),
      };
      if (action === "print") printReport(doc);
      else {
        if (action === "pdf") exportPdf(doc);
        else if (action === "excel") exportExcel(doc);
        else exportCsv(doc, downloadCsv);
        toast.success(`${report.name} exported`);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not run the report"));
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (report: SavedReport) => {
    setBusyId(report.id);
    try {
      await api.post(`/reports/${report.id}/duplicate`);
      toast.success(`${report.name} duplicated`);
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not duplicate the report"));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/reports/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Could not delete the report"));
    }
  };

  if (viewing) {
    const payload = (viewing.config?.__payload ?? {}) as Record<string, unknown>;
    // A designed report renders from its own document; the section kit is for the other two kinds.
    if (viewing.type === "template" && asTemplate(payload.document)) {
      return <TemplateReportView report={viewing} payload={payload} onClose={() => setViewing(null)} />;
    }
    const sections = sectionsForRun(payload, viewing);
    const doc = { title: viewing.name, subtitle: viewing.description ?? undefined, period: (payload.period as { label?: string } | undefined)?.label ?? "", sections };
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <PageHeader variant="section" title={viewing.name} subtitle={viewing.description ?? "Saved report"} />
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => printReport(doc)}><Printer size={14} /> Print</button>
            <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportPdf(doc)}><Download size={14} /> PDF</button>
            <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportExcel(doc)}><Download size={14} /> Excel</button>
            <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => exportCsv(doc, downloadCsv)}><Download size={14} /> CSV</button>
            <button className="btn-secondary text-sm" onClick={() => setViewing(null)}>Close</button>
          </div>
        </div>
        <ReportBody sections={sections} />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader variant="section" title="Custom Reports" subtitle="Saved reports built on the reporting engine" />
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => setDesigning(true)}><LayoutTemplate size={14} /> New designed report</button>
          <button className="btn-primary text-sm flex items-center gap-2" onClick={() => setCreating(true)}><Plus size={14} /> New report</button>
        </div>
      </div>

      <div className="card border-cyber-600/30 flex items-start gap-3">
        <LayoutTemplate size={18} className="text-cyber-400 mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold text-white">Design a report, band by band</h3>
          <p className="text-xs text-gray-400 mt-1">
            A designed report is built in the banded designer: page header, column captions, grouped rows,
            totals in a group footer, a report summary and a page footer — with expressions, formats and a
            page preview. It saves as a report of type <span className="font-mono">template</span>, so it runs,
            exports, schedules and appears in this list beside the others. The decision behind it, and what each
            phase added, is in <span className="font-mono">PlanDocs/PLAN-020-Custom-Report-Designer.md</span>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Saved reports" value={number(totals.reports)} />
        <SummaryCard label="Scheduled" value={number(totals.scheduled)} tone="text-cyber-400" />
        <SummaryCard label="Config-driven" value={number(totals.configDriven)} />
        <SummaryCard label="Distinct types" value={number(totals.types)} />
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search name, description or source" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {types.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={scheduleOnly} onChange={e => setScheduleOnly(e.target.checked)} /> Scheduled only
        </label>
        {(search || typeFilter || scheduleOnly) && (
          <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => { setSearch(""); setTypeFilter(""); setScheduleOnly(false); }}>
            <X size={12} /> Clear
          </button>
        )}
        {modern && <span className="ml-auto text-xs text-gray-500">{visible.length} shown · {totals.scheduled} scheduled</span>}
      </div>

      {/* The "Scheduled only" checkbox is one of these views, so the strip and the checkbox are the
          same state read two ways — the chips set it, the checkbox still works, neither drifts. */}
      {modern && (
        <ListViews
          views={[
            { id: "all", label: "All", count: totals.reports },
            { id: "scheduled", label: "Scheduled", count: totals.scheduled },
            { id: "designed", label: "Designed", count: reports.filter(r => r.type === "template").length },
            { id: "config", label: "Config-driven", count: totals.configDriven },
          ]}
          value={scheduleOnly ? "scheduled" : "all"}
          onChange={(id) => setScheduleOnly(id === "scheduled")}
          label="Saved report views"
        />
      )}

      {loading ? <TableSkeleton /> : error ? (
        <div className="card border-red-600/40 text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase">
                  <th className="p-3">Report</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Author</th>
                  <th className="p-3 hidden md:table-cell">Created</th>
                  <th className="p-3">Schedule</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(report => (
                  <tr key={report.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 align-top">
                    <td className="p-3">
                      <p className="text-white font-medium">{report.name}</p>
                      {report.description && <p className="text-[11px] text-gray-500">{report.description}</p>}
                      {report.isSystem && <span className="badge bg-cyber-600/15 text-cyber-300 text-[10px] mt-1 inline-block">Ships with the product</span>}
                    </td>
                    <td className="p-3 text-gray-400">{report.type.replace(/_/g, " ")}</td>
                    <td className="p-3 text-gray-400 font-mono text-[11px]">{String(report.config?.source ?? "—")}</td>
                    <td className="p-3 text-gray-400">{report.createdBy ? `${report.createdBy.firstName} ${report.createdBy.lastName}` : "—"}</td>
                    <td className="p-3 text-gray-400 hidden md:table-cell">{new Date(report.createdAt).toLocaleDateString()}</td>
                    <td className="p-3 text-gray-400">
                      {report.schedules?.length
                        ? `${report.schedules[0]!.frequency} at ${report.schedules[0]!.timeOfDay}${report.schedules[0]!.recipients.length ? ` → ${report.schedules[0]!.recipients.length} recipient${report.schedules[0]!.recipients.length === 1 ? "" : "s"}` : ""}`
                        : "Not scheduled"}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        <button onClick={() => void run(report)} disabled={busyId === report.id} className="btn-primary text-[11px] flex items-center gap-1 px-2 py-1">
                          <Play size={11} /> Run
                        </button>
                        {report.type === "template" ? (
                          <IconAction label="Open in the designer" icon={LayoutTemplate} onClick={() => navigate(`/reports/custom/${report.id}/design`)} />
                        ) : null}
                        <IconAction label="Print" icon={Printer} onClick={() => void runAndThen(report, "print")} disabled={busyId === report.id} />
                        <IconAction label="Export PDF" icon={Download} onClick={() => void runAndThen(report, "pdf")} disabled={busyId === report.id} />
                        {report.type === "template"
                          ? null
                          : <IconAction label="Edit" icon={Pencil} onClick={() => setEditing(report)} />}
                        <IconAction label="Duplicate" icon={Copy} onClick={() => void duplicate(report)} disabled={busyId === report.id} />
                        <IconAction label="Schedule" icon={Calendar} onClick={() => setScheduling(report)} />
                        <IconAction label="Delete" icon={Trash2} onClick={() => setDeleting(report)} danger />
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-gray-600">
                    {reports.length === 0 ? "No saved reports yet. Create one and it will appear here." : "No report matches these filters."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {modern && visible.length > 0 && (
            <ListFooter from={1} to={visible.length} total={visible.length} page={1} pages={1} onPage={() => {}} note={`${totals.types} distinct types · ${totals.configDriven} config-driven`} />
          )}
        </div>
      )}

      {(creating || editing) && (
        <ReportFormDialog
          report={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}

      {designing && <NewDesignedReportDialog onClose={() => setDesigning(false)} />}

      {scheduling && <ScheduleReportDialog reportId={scheduling.id} onClose={() => { setScheduling(null); load(); }} />}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDeleting(null)}>
          <div className="card w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Delete {deleting.name}?</h3>
            <p className="text-sm text-gray-400">
              The report and its {deleting.schedules?.length ?? 0} schedule{(deleting.schedules?.length ?? 0) === 1 ? "" : "s"} are removed.
              Reports that ship with the product cannot be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-sm" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn-primary text-sm !bg-red-600 hover:!bg-red-500" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconAction({ label, icon: Icon, onClick, disabled, danger }: { label: string; icon: typeof Printer; onClick: () => void; disabled?: boolean; danger?: boolean }) {  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} className={`btn-secondary text-[11px] px-2 py-1 ${danger ? "text-red-400 hover:text-red-300" : ""}`}>
      <Icon size={11} />
    </button>
  );
}

/**
 * Starting a designed report. A blank page is a bad first impression, so the starters are real
 * documents — built by the API from the source's own catalog, which is why they are valid for whatever
 * source is chosen rather than for the one they were written against.
 */
function NewDesignedReportDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [source, setSource] = useState("tickets");
  const [starter, setStarter] = useState("list");
  const [sources, setSources] = useState<Array<{ key: string; label: string }>>([]);
  const [starters, setStarters] = useState<Array<{ kind: string; label: string; help: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/reports/designer/catalog")
      .then(response => {
        setSources((response.data?.sources ?? []).map((entry: { key: string; label: string }) => ({ key: entry.key, label: entry.label })));
        setStarters((response.data?.starters ?? []).map((entry: { kind: string; label: string; help: string }) => ({ kind: entry.kind, label: entry.label, help: entry.help })));
      })
      .catch(e => toast.error(apiErrorMessage(e, "Could not load the designer catalog")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">New designed report</h3>
            <p className="text-xs text-gray-400">Pick the data to report on and a layout to start from.</p>
          </div>
          <button className="text-gray-500 hover:text-gray-300" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {loading ? <TableSkeleton rows={3} /> : (
          <>
            <label className="block">
              <span className="block text-xs text-gray-400 mb-1">Report on</span>
              <select className="input-field" value={source} onChange={event => setSource(event.target.value)}>
                {sources.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
              </select>
            </label>

            <div className="space-y-2">
              <span className="block text-xs text-gray-400">Start from</span>
              {starters.map(entry => (
                <button
                  key={entry.kind}
                  type="button"
                  onClick={() => setStarter(entry.kind)}
                  className={`w-full text-left rounded border p-2 transition-colors ${
                    starter === entry.kind ? "border-cyber-500 bg-cyber-600/10" : "border-surface-lighter hover:border-cyber-500/50"
                  }`}
                >
                  <span className="text-sm text-white">{entry.label}</span>
                  <span className="block text-[11px] text-gray-400">{entry.help}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-primary text-sm flex items-center gap-2"
            disabled={loading}
            onClick={() => navigate(`/reports/custom/new/design?source=${encodeURIComponent(source)}&starter=${encodeURIComponent(starter)}`)}
          >
            <LayoutTemplate size={14} /> Open the designer
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold ${tone ?? "text-white"}`}>{value}</p>
    </div>
  );
}

/**
 * Create or edit a report. The guided form builds the config the engine already understands, and
 * the JSON box is there for the shapes the form does not cover yet — the visual designer will
 * produce exactly this config, so anything defined here keeps working once it exists.
 */
function ReportFormDialog({ report, onClose, onSaved }: { report?: SavedReport; onClose: () => void; onSaved: () => void }) {
  const firstFilter = ((report?.config?.filters as Array<{ field?: string; op?: string; value?: unknown }> | undefined) ?? [])[0];
  const [name, setName] = useState(report?.name ?? "");
  const [description, setDescription] = useState(report?.description ?? "");
  const [type, setType] = useState(report?.type ?? "custom");
  const [source, setSource] = useState(String(report?.config?.source ?? "tickets"));
  const [columns, setColumns] = useState(((report?.config?.columns as string[] | undefined) ?? ["ticketNumber", "title", "status", "client"]).join(", "));
  const [filterField, setFilterField] = useState(String(firstFilter?.field ?? ""));
  const [filterOp, setFilterOp] = useState(String(firstFilter?.op ?? "in"));
  const [filterValue, setFilterValue] = useState(Array.isArray(firstFilter?.value) ? firstFilter.value.join(", ") : String(firstFilter?.value ?? ""));
  const [groupBy, setGroupBy] = useState(String(report?.config?.groupBy ?? ""));
  const [sortBy, setSortBy] = useState(String(report?.config?.sortBy ?? ""));
  const [limit, setLimit] = useState(String(report?.config?.limit ?? 200));
  const [advanced, setAdvanced] = useState(false);
  const [config, setConfig] = useState(JSON.stringify(report?.config ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const builtConfig = () => ({
    source,
    columns: columns.split(",").map(c => c.trim()).filter(Boolean),
    ...(filterField ? { filters: [{ field: filterField, op: filterOp, value: filterOp === "in" ? filterValue.split(",").map(v => v.trim()).filter(Boolean) : filterValue }] } : {}),
    ...(groupBy ? { groupBy } : {}),
    ...(sortBy ? { sortBy } : {}),
    limit: Number(limit) || 200,
  });

  const save = async () => {
    if (!name.trim()) { setError("Give the report a name."); return; }
    let parsed: unknown;
    try {
      parsed = advanced ? JSON.parse(config || "{}") : builtConfig();
    } catch {
      setError("The configuration is not valid JSON.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (report) await api.patch(`/reports/${report.id}`, { name, description: description || null, type, config: parsed });
      else await api.post("/reports", { name, description: description || null, type, config: parsed });
      toast.success(report ? `${name} updated` : `${name} created`);
      onSaved();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save the report"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{report ? `Edit ${report.name}` : "New report"}</h3>
            <p className="text-xs text-gray-500">Name it, choose what it reports on, and the engine does the rest.</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className="text-xs text-gray-500 block mb-1">Name</label><input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="Monthly ticket volume" /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Description</label><input className="input-field" value={description} onChange={e => setDescription(e.target.value)} placeholder="What this report answers" /></div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Type</label>
            <select className="input-field" value={type} onChange={e => setType(e.target.value)}>
              {REPORT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} /> Edit the configuration directly
            </label>
          </div>
        </div>

        {advanced ? (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Configuration (JSON)</label>
            <textarea className="input-field font-mono text-xs" rows={12} value={config} onChange={e => setConfig(e.target.value)} />
            <p className="text-[11px] text-gray-500 mt-1">
              Sources: {CONFIG_SOURCES.join(" · ")}. Operators: {CONFIG_OPERATORS.join(", ")}. Anything outside the
              whitelist is ignored rather than run. {STANDARD_REPORTS.length} standard report types can also be referenced by name.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Report on</label>
                <select className="input-field" value={source} onChange={e => setSource(e.target.value)}>
                  {CONFIG_SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Group by (optional rollup)</label><input className="input-field" value={groupBy} onChange={e => setGroupBy(e.target.value)} placeholder="status" /></div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Columns</label><input className="input-field" value={columns} onChange={e => setColumns(e.target.value)} placeholder="ticketNumber, title, status, client" /></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Filter field</label><input className="input-field" value={filterField} onChange={e => setFilterField(e.target.value)} placeholder="status" /></div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Operator</label>
                <select className="input-field" value={filterOp} onChange={e => setFilterOp(e.target.value)}>
                  {CONFIG_OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Value</label><input className="input-field" value={filterValue} onChange={e => setFilterValue(e.target.value)} placeholder="new, in_progress" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Sort by</label><input className="input-field" value={sortBy} onChange={e => setSortBy(e.target.value)} placeholder="createdAt" /></div>
              <div><label className="text-xs text-gray-500 block mb-1">Row limit</label><input className="input-field" type="number" value={limit} onChange={e => setLimit(e.target.value)} /></div>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={12} /> {error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : report ? "Save changes" : "Create report"}</button>
        </div>
      </div>
    </div>
  );
}

export default CustomReportsPage;
