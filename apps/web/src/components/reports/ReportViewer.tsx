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
import { AlertTriangle, Download, Printer, RefreshCw, X } from "lucide-react";
import { ReportsSkeleton } from "../ui/Skeleton";
import { apiErrorMessage } from "../../lib/apiError";
import { downloadCsv } from "../../lib/csv";
import { ReportBody, exportCsv, exportExcel, exportPdf, number, printReport, sectionsToTables, type Section } from "./reportKit";
import type { StandardReport } from "./standardReports";
import { useRedesign } from "../../hooks/useNavigationStyle";

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
  const redesign = useRedesign();
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

      {/* The redesigned viewer states what it is showing and offers the two things the mockup's
          reporting page offers: the period as a strip rather than two date fields, and the way into
          the designer for the pack this report is not. */}
      {redesign && (
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

      {payload != null && !redesign && (
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

export function ExportDialog({
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
