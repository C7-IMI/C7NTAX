/**
 * The report viewer — the detail view every entry point shares.
 *
 * A report is one thing: the filters it answers, the payload its endpoint returns, and the sections
 * the kit draws from that payload. Print and Export are built from those same sections, so the
 * screen, the print-out and the spreadsheet cannot disagree. `Billing → Reports` is the second entry
 * point the standard reports screen promised, and this module is what they share rather than a
 * second renderer that would eventually draw something different.
 *
 * `filters` belong to the caller. The filter bar writes them through `onFilters` and the screen holds
 * the state, so a caller can seed them from a link (a saved report that arrives with a client on it)
 * without the viewer having to know why.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { AlertTriangle, Download, FileSpreadsheet, FileText, Printer, RefreshCw, X } from "lucide-react";
import { ReportsSkeleton } from "../ui/Skeleton";
import { apiErrorMessage } from "../../lib/apiError";
import { downloadCsv } from "../../lib/csv";
import { documentBrandOf } from "../../hooks/useBrandKit";
import { useAuth } from "../../hooks/useAuth";
import { ORIENTATION_LABELS, PAPER_SIZES } from "./documentLanguage";
import {
  basisFromPayload, exportCsv, exportExcel, exportPdf, number, printReport, sectionsToTables,
  ReportBody, type ReportDocument, type Section,
} from "./reportKit";
import type { StandardReport } from "./standardReports";
import { useModernInterface } from "../../hooks/useNavigationStyle";

// ═══════════════════════════════════════════════════════════════════
//  Shared filter state — what a report is asked, before it is drawn
// ═══════════════════════════════════════════════════════════════════
export interface ReportFilters { from: string; to: string; clientId: string; boardId: string }
export interface FilterOptions { clients: Array<{ id: string; name: string }>; boards: Array<{ id: string; name: string }>; tenants: Array<{ id: string; name: string }> }

export const EMPTY_FILTERS: ReportFilters = { from: "", to: "", clientId: "", boardId: "" };

/*
 * The periods a report is usually read over, as a strip rather than two date fields. They write the
 * same `from`/`to` the fields do, so a period is a shortcut and never a second kind of filter.
 */
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthStart = (offset: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d; };
const monthEnd = (offset: number) => { const d = monthStart(offset + 1); d.setDate(0); return d; };
const quarterStart = (offset: number) => { const d = new Date(); d.setMonth(Math.floor(d.getMonth() / 3) * 3 + offset * 3, 1); return d; };
const REPORT_PERIODS = [
  { id: "this-month", label: "This month", from: () => isoDate(monthStart(0)), to: () => isoDate(monthEnd(0)) },
  { id: "last-month", label: "Last month", from: () => isoDate(monthStart(-1)), to: () => isoDate(monthEnd(-1)) },
  { id: "this-quarter", label: "This quarter", from: () => isoDate(quarterStart(0)), to: () => isoDate(new Date()) },
  { id: "last-quarter", label: "Last quarter", from: () => isoDate(quarterStart(-1)), to: () => isoDate(new Date(quarterStart(0).getTime() - 86400000)) },
];

const filterQuery = (filters: ReportFilters): Record<string, string> => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string>;

/** A report's own options, as the query parameters its endpoint reads. */
export type ReportOptionValues = Record<string, string | number | boolean>;

const optionQuery = (report: StandardReport, values: ReportOptionValues): Record<string, string> =>
  Object.fromEntries(
    (report.options ?? [])
      .map(option => [option.key, values[option.key] ?? option.default] as const)
      .map(([key, value]) => [key, typeof value === "boolean" ? String(value) : String(value)] as const),
  );

/** Everything the endpoint needs: the shared filters, then the report's own choices. */
export const reportQuery = (report: StandardReport, filters: ReportFilters, values: ReportOptionValues) => ({
  ...filterQuery(filters),
  ...optionQuery(report, values),
});

export const defaultOptionValues = (report: StandardReport): ReportOptionValues =>
  Object.fromEntries((report.options ?? []).map(option => [option.key, option.default]));

/** The period the server actually applied, so the screen can never imply a range it did not use. */
export const periodLabel = (payload: unknown): string => (payload as { period?: { label?: string } } | null)?.period?.label ?? "";

/** The filter options every report shares, loaded once per page. */
export function useReportOptions(): FilterOptions {
  const [options, setOptions] = useState<FilterOptions>({ clients: [], boards: [], tenants: [] });
  useEffect(() => {
    api.get("/reports/data/options")
      .then(r => setOptions({ clients: r.data?.clients ?? [], boards: r.data?.boards ?? [], tenants: r.data?.tenants ?? [] }))
      .catch(() => setOptions({ clients: [], boards: [], tenants: [] }));
  }, []);
  return options;
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

export function ReportViewer({
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
  const modern = useModernInterface();
  const { user } = useAuth();
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
  const rowCount = useMemo(
    () => sections.reduce((n, s) => n + (s.kind === "table" || s.kind === "bars" ? s.rows.length : 0), 0),
    [sections],
  );
  /*
   * The document, as the paper it becomes. It carries the four facts the meta line needs — the client
   * the report was narrowed to (or "All clients"), the period the server applied, the endpoint's own
   * basis, and who is producing it — because a document that has to guess one of those prints "undefined"
   * in front of a client. `family` decides the letterhead, the paper default and the basis default.
   */
  const clientLabel = filters.clientId ? (options.clients.find(c => c.id === filters.clientId)?.name ?? report.title) : "All clients";
  const generatedBy = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() + (user.email ? ` (${user.email})` : "") : undefined;
  const document_: ReportDocument = useMemo(
    () => ({
      title: report.title,
      subtitle: report.description,
      client: clientLabel,
      period: periodLabel(payload),
      family: "report.standard",
      reportKey: report.id,
      generatedBy,
      basis: basisFromPayload(payload),
      sections,
    }),
    [report, payload, sections, clientLabel, generatedBy],
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
          {/* The modern screen offers one control — Produce — because Print, PDF, Excel and CSV are one
              decision. The classic screen keeps the two buttons it has always had, and its Print goes
              straight to paper; the chooser is the dialog behind Export. */}
          {modern ? (
            <button className="chip chip--on" onClick={() => setShowExport(true)} disabled={!payload}>
              Produce<span className="chip__n">{sections.length}</span>
            </button>
          ) : (
            <>
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => printReport(document_)} disabled={!payload}><Printer size={13} /> Print</button>
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => setShowExport(true)} disabled={!payload}><Download size={13} /> Export</button>
            </>
          )}
          {onClose && <button className="btn-secondary text-xs" onClick={onClose}>Close</button>}
        </div>
      </div>

      <FilterBar report={report} filters={filters} onChange={onFilters} options={options} onRefresh={load} busy={loading} quarterPicker={quarterPicker} values={values} onValue={onValue} />

      {/* The Modern viewer states what it is showing and offers the two things the mockup's
          reporting page offers: the period as a strip rather than two date fields, and the way into
          the designer for the pack this report is not. */}
      {modern && (
        <div className="flex flex-wrap items-center gap-2">
          {report.filters.period && !quarterPicker && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Report period">
              {REPORT_PERIODS.map(period => (
                <button
                  key={period.id}
                  type="button"
                  aria-pressed={filters.from === period.from() && filters.to === period.to()}
                  onClick={() => onFilters({ ...filters, from: period.from(), to: period.to() })}
                  className={`chip ${filters.from === period.from() && filters.to === period.to() ? "chip--on" : ""}`}
                >{period.label}</button>
              ))}
              <button type="button" onClick={() => onFilters({ ...EMPTY_FILTERS })} aria-pressed={!filters.from && !filters.to} className={`chip ${!filters.from && !filters.to ? "chip--on" : ""}`}>All time</button>
            </div>
          )}
          <a href="/reports/custom/design" className="chip">Open the designer</a>
          <span className="text-xs text-gray-500">
            Live · refreshes with the queue{periodLabel(payload) ? ` · ${periodLabel(payload)}` : ""} · {rowCount} row{rowCount === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {payload != null && !modern && (
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
//  The output chooser — one decision, four answers
// ═══════════════════════════════════════════════════════════════════

type OutputFormat = "print" | "pdf" | "excel" | "csv";

/**
 * The four ways out, with the sentence each one owes the reader.
 *
 * The `sentence` takes the counts because Excel's promise is a count of what is being written, read
 * from the loader that prepares the file rather than described from the screen it was opened on.
 */
const OUTPUT_FORMATS: Array<{ id: OutputFormat; label: string; chip: string; sentence: (counts: string) => string }> = [
  { id: "print", label: "Print on paper now", chip: "1:1", sentence: () => "The sheets print at the size this document is designed in. Nothing is scaled to fit the browser's default paper." },
  { id: "pdf", label: "PDF — the same pages, as a file", chip: "chosen", sentence: () => "Vector text, the pages you saw, at the paper chosen below. This used to be always landscape A4 whatever the screen showed." },
  { id: "excel", label: "Excel — one sheet per table, typed cells", chip: ".xls", sentence: counts => `The figures without the document: ${counts}. Figures arrive as numbers, not as the strings a PDF draws.` },
  { id: "csv", label: "CSV — every table stacked in one file", chip: ".csv", sentence: () => "For whatever reads it next. Rules, pages and column widths do not exist here, and the basis block is the topmost paragraph rather than a last sheet." },
];


/**
 * Choosing what to produce, once.
 *
 * Print, PDF, Excel and CSV are one decision, not three buttons with a fourth on the toolbar, and the
 * two questions a person actually needs answered here are **paper** — size and orientation, because a
 * matrix that fits landscape does not fit portrait — and whether the **basis block** travels with the
 * file, because a spreadsheet and a PDF disagree about what "where these figures came from" even means.
 *
 * Two designs, deliberately. The modern arrangement is the Modern interface's own furniture: a sheet with a
 * sentence beside each of the four ways out, the paper as a choice you press, and a countable footer.
 * The classic arrangement is a form — a heading, labelled fields in a grid, a select per question and
 * Cancel/Confirm — and it lists "Print now, on paper" as the fourth entry in the format select, because
 * a classic dialog is a form with one act at the bottom. The state, the API call and the words are
 * shared; the arrangement is not.
 *
 * What the panel is allowed to promise, and what it must not. It states the paper in millimetres and
 * what changes on the page because of it, what the basis block contains and what leaving it out costs
 * the reader, and the counts — read from the loader that prepares the file. It does not state a page
 * count nobody measured, and it says nothing about the reader's printer: the sheets print at their own
 * size and the printer's "fit to page" is the printer's business.
 */
export function ExportDialog({
  document_, report, filters, options, onClose, values,
}: {
  document_: ReportDocument;
  report: StandardReport;
  filters: ReportFilters;
  options: FilterOptions;
  onClose: () => void;
  values: ReportOptionValues;
}) {
  const modern = useModernInterface();
  // The paper and the basis block start where the document's own family says they should, so the
  // answer a person does not change is the one the instance designed.
  const defaults = documentBrandOf(document_.family ?? "report.standard").presentation;
  const [format, setFormat] = useState<OutputFormat>("pdf");
  const [paper, setPaper] = useState<"a4" | "letter">(defaults.pageSize);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(defaults.orientation);
  const [basis, setBasis] = useState(defaults.showBasis);
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
  const counts = `${tables.length} table${tables.length === 1 ? "" : "s"} · ${number(rowCount)} row${rowCount === 1 ? "" : "s"}`;
  const paperLabel = PAPER_SIZES[paper].label;
  const orientationLabel = ORIENTATION_LABELS[orientation];
  const basisSentence = document_.basis
    ? "The last sheet says where the figures came from, what was excluded and what cannot be known."
    : "This report supplies no basis block, so there is nothing to add or remove.";

  /** One handler, both arrangements. The choice is applied to *this* export as a presentation override. */
  const produce = () => {
    if (!preview) return;
    const doc: ReportDocument = { ...document_, period: previewPeriod || document_.period, sections: preview };
    const output = { presentation: { pageSize: paper, orientation, showBasis: basis } };
    if (format === "print") printReport(doc, output);
    else if (format === "pdf") exportPdf(doc, output);
    else if (format === "excel") exportExcel(doc, output);
    else exportCsv(doc, downloadCsv, output);
    toast.success(format === "print"
      ? `${report.title} sent to print`
      : `${report.title} exported as ${format === "excel" ? "Excel" : format.toUpperCase()}`);
    onClose();
  };

  const confirmLabel = format === "print"
    ? "Print now"
    : `Export ${format === "excel" ? "Excel" : format.toUpperCase()}`;

  /* The report's own filters and options, shared by both arrangements — a select in the classic grid,
     and left where they were set above the report in the modern sheet (which asks only the four
     questions that change the artefact). */
  const filterFields = (
    <>
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
    </>
  );

  const previewPanel = (compact: boolean) => (
    <div className={compact ? "bg-surface-lighter rounded-lg p-3 max-h-40 overflow-auto" : "bg-surface-lighter rounded-lg p-3 max-h-72 overflow-auto"}>
      {busy ? <p className="text-sm text-gray-500">Preparing…</p>
        : preview && preview.length ? <ReportBody sections={preview} compact /> : <p className="text-sm text-gray-500">Nothing to preview.</p>}
    </div>
  );

  if (modern) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
        <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-surface-border bg-surface animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-surface-border px-5 py-4">
            <div>
              <h3 className="text-base font-semibold text-white">Produce the {report.title}</h3>
              <p className="mt-1 text-xs text-gray-500">
                {document_.client ?? "All clients"}{document_.period ? ` · ${document_.period}` : ""} · {counts}
                {document_.basis?.asOf ? ` · as of ${document_.basis.asOf}` : ""}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><X size={18} /></button>
          </div>

          <div className="px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-500">The four ways out</p>
            <div className="mt-2 space-y-2">
              {OUTPUT_FORMATS.map(way => (
                <button
                  key={way.id}
                  type="button"
                  aria-pressed={format === way.id}
                  onClick={() => setFormat(way.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${format === way.id ? "border-cyber-500/50 bg-cyber-600/15" : "border-surface-border hover:bg-surface-lighter"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${format === way.id ? "text-cyber-400" : "text-gray-200"}`}>{way.label}</span>
                    <span className="ml-auto chip">{way.chip}</span>
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">{way.sentence(counts)}</span>
                </button>
              ))}
            </div>

            <p className="mt-5 text-[11px] uppercase tracking-wider text-gray-500">The two answers</p>
            <div className="mt-2 space-y-4">
              <div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Paper size">
                  {(["a4", "letter"] as const).map(id => (
                    <button key={id} type="button" aria-pressed={paper === id} onClick={() => setPaper(id)} className={`chip ${paper === id ? "chip--on" : ""}`}>{PAPER_SIZES[id].label}</button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-gray-500">The margin is 18mm whatever the sheet, so a Letter page simply has 5.9mm more column.</p>
              </div>
              <div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Orientation">
                  {(["portrait", "landscape"] as const).map(id => (
                    <button key={id} type="button" aria-pressed={orientation === id} onClick={() => setOrientation(id)} className={`chip ${orientation === id ? "chip--on" : ""}`}>{ORIENTATION_LABELS[id]}</button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-gray-500">Portrait prints the columns that carry money; landscape fits the wider table at the same 9pt. Neither scales the type down to make a table fit.</p>
              </div>
              <div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Basis block">
                  <button type="button" aria-pressed={basis} onClick={() => setBasis(true)} className={`chip ${basis ? "chip--on" : ""}`}>Send the basis block</button>
                  <button type="button" aria-pressed={!basis} onClick={() => setBasis(false)} className={`chip ${!basis ? "chip--on" : ""}`}>Figures alone</button>
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  {basisSentence}{basis ? "" : " Switch it off and the file is the figures alone — a file whose reader will take the total as fact."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-surface-border px-5 py-4">
            <span className="text-xs text-gray-500 tabular-nums">
              {format === "print" ? "Print" : format === "excel" ? "Excel" : format.toUpperCase()} · {paperLabel} · {orientationLabel.split(" — ")[0]} · {basis ? "basis block included" : "basis block left out"} · {counts}
            </span>
            <span className="flex shrink-0 gap-2">
              <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
              <button onClick={produce} className="btn-primary text-sm" disabled={!preview || busy}>{confirmLabel}</button>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Export report</h3>
            <p className="text-xs text-gray-500">{report.title} · {document_.client ?? "All clients"}{document_.period ? ` · ${document_.period}` : ""} · {counts}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">File format</label>
            <select className="input-field" value={format} onChange={e => setFormat(e.target.value as OutputFormat)}>
              <option value="pdf">PDF — print-ready</option>
              <option value="excel">Microsoft Excel (.xls)</option>
              <option value="csv">CSV — comma separated</option>
              <option value="print">Print now, on paper</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Paper size</label>
            <select className="input-field" value={paper} onChange={e => setPaper(e.target.value as "a4" | "letter")}>
              <option value="a4">{PAPER_SIZES.a4.label}</option>
              <option value="letter">{PAPER_SIZES.letter.label}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Orientation</label>
            <select className="input-field" value={orientation} onChange={e => setOrientation(e.target.value as "portrait" | "landscape")}>
              <option value="portrait">{ORIENTATION_LABELS.portrait}</option>
              <option value="landscape">{ORIENTATION_LABELS.landscape}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Basis block</label>
            <select className="input-field" value={basis ? "include" : "leave-out"} onChange={e => setBasis(e.target.value === "include")}>
              <option value="include">Include — the last sheet</option>
              <option value="leave-out">Leave out</option>
            </select>
          </div>
          {filterFields}
        </div>

        {!basis && document_.basis && (
          <div className="rounded-lg border border-amber-600/40 bg-amber-600/10 p-3">
            <p className="text-xs text-amber-300 flex items-center gap-2"><AlertTriangle size={13} /> Leaving the basis block out removes the last sheet.</p>
            <p className="text-xs text-gray-400 mt-1">What remains still prints the figures, but nothing on it says where they came from or what they cannot answer.</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-gray-500">Preview — exactly what the file will contain</label>
            {changed && (
              <button className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1" onClick={() => void runPreview()} disabled={busy}>
                <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> Apply these filters
              </button>
            )}
          </div>
          {previewPanel(false)}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-500">{paperLabel} · {orientationLabel} · {basis ? "basis block included" : "basis block left out"}</span>
          <span className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button onClick={produce} className="btn-primary text-sm flex items-center gap-1.5" disabled={!preview || busy}>
              {format === "print" ? <Printer size={14} /> : format === "excel" ? <FileSpreadsheet size={14} /> : format === "csv" ? <FileText size={14} /> : <Download size={14} />}
              {confirmLabel}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
