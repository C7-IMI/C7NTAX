/**
 * The report kit (PLAN-020).
 *
 * A report is described once as a list of sections — KPI blocks, bar lists, tables, note lists and
 * fact pairs — and every way of consuming it reads that same list: the screen draws it, **Print**
 * renders it to a print window, **PDF** lays each table out with autoTable and **Excel/CSV** write
 * the same tables out. There is no second code path that decides what a report "really" contains,
 * which is what used to let an exported file disagree with the screen it came from.
 */
import type { ReactNode } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
export type ColumnFormat = "text" | "number" | "money" | "percent" | "minutes" | "hours" | "date" | "yesno";

export interface TableColumn { key: string; label: string; format?: ColumnFormat; align?: "left" | "right"; }
export interface KpiItem { label: string; value: string; sub?: string; tone?: Tone; }
export interface BarRow { label: string; value: number; display?: string; tone?: Tone; }
export interface FactItem { label: string; value: string; }

export type Section =
  | { kind: "kpis"; title?: string; items: KpiItem[] }
  | { kind: "bars"; title: string; rows: BarRow[]; note?: string }
  | { kind: "table"; title: string; columns: TableColumn[]; rows: Array<Record<string, unknown>>; note?: string; emptyText?: string }
  | { kind: "notes"; title: string; items: string[]; tone: Tone }
  | { kind: "facts"; title: string; items: FactItem[] };

export interface ReportDocument { title: string; subtitle?: string; period?: string; sections: Section[] }

// ── Formatting ──────────────────────────────────────────────────────

export const money = (value: unknown): string =>
  `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const number = (value: unknown): string => Number(value ?? 0).toLocaleString();

/** "6h 15m" — a duration a person reads at a glance rather than a decimal. */
export function duration(minutes: unknown): string {
  const total = Math.round(Number(minutes ?? 0));
  if (!total) return "0m";
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (!hours) return `${sign}${rest}m`;
  return rest ? `${sign}${hours}h ${rest}m` : `${sign}${hours}h`;
}

const humanise = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/**
 * A column key as a heading: camelCase and snake_case both become words, and each word is
 * capitalised, so a row key of `ticketNumber` reads as "Ticket Number" on screen and in a file.
 */
export function labelFor(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * A cell's value as text. Custom report rows carry relation values as objects (a ticket's client is
 * `{ name: "Acme" }`), which used to print as "[object Object]" — a single-value object is unwrapped
 * to that value instead, and anything genuinely structured is written out as JSON.
 */
function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.length === 1 ? unwrap(value[0]) : value.map(v => unwrap(v)).join(", ");
  const scalars = Object.values(value as Record<string, unknown>).filter(v => v !== null && v !== undefined && typeof v !== "object");
  if (scalars.length === 1) return scalars[0];
  const named = (value as { name?: unknown }).name ?? (value as { title?: unknown }).title ?? (value as { label?: unknown }).label;
  return named ?? JSON.stringify(value);
}

export function formatValue(value: unknown, format: ColumnFormat = "text"): string {
  const unwrapped = unwrap(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") return "—";
  switch (format) {
    case "money": return money(unwrapped);
    case "number": return number(unwrapped);
    case "percent": return `${Number(unwrapped).toLocaleString()}%`;
    case "minutes": return duration(unwrapped);
    case "hours": return `${Number(unwrapped).toLocaleString()}h`;
    case "date": return String(unwrapped);
    case "yesno": return unwrapped ? "Yes" : "No";
    default: {
      const text = String(unwrapped);
      // A status or priority code reads as a label; anything already written stays as it is.
      return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(text) && text.length < 40 ? humanise(text) : text;
    }
  }
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-white",
  good: "text-green-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  info: "text-cyber-400",
};

const TONE_BG: Record<Tone, string> = {
  neutral: "bg-surface-lighter",
  good: "bg-green-600/15 border-green-600/30",
  warn: "bg-amber-600/15 border-amber-600/30",
  bad: "bg-red-600/15 border-red-600/30",
  info: "bg-cyber-600/15 border-cyber-600/30",
};

const BAR_TONE: Record<Tone, string> = {
  neutral: "bg-cyber-500",
  good: "bg-green-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  info: "bg-cyber-400",
};

// ── On-screen rendering ─────────────────────────────────────────────

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{children}</h4>;
}

export function SectionBlock({ section }: { section: Section }) {
  if (section.kind === "kpis") {
    return (
      <div>
        {section.title && <SectionHeading>{section.title}</SectionHeading>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {section.items.map(item => (
            <div key={item.label} className={`rounded-xl border border-surface-border p-3 ${item.tone ? TONE_BG[item.tone] : "bg-surface-lighter/40"}`}>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">{item.label}</p>
              <p className={`text-lg font-bold ${TONE_TEXT[item.tone ?? "neutral"]}`}>{item.value}</p>
              {item.sub && <p className="text-[11px] text-gray-500 mt-0.5">{item.sub}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.kind === "bars") {
    const max = Math.max(...section.rows.map(r => r.value), 1);
    return (
      <div className="card">
        <SectionHeading>{section.title}</SectionHeading>
        {section.rows.length === 0 ? (
          <p className="text-sm text-gray-600">Nothing to chart.</p>
        ) : (
          <div className="space-y-2">
            {section.rows.map(row => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-3">
                  <span className="text-gray-300 truncate">{row.label}</span>
                  <span className="text-gray-400 tabular-nums shrink-0">{row.display ?? number(row.value)}</span>
                </div>
                <div className="h-2 bg-surface-lighter rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${BAR_TONE[row.tone ?? "neutral"]}`} style={{ width: `${Math.max(2, Math.round((row.value / max) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {section.note && <p className="text-[11px] text-gray-500 mt-3">{section.note}</p>}
      </div>
    );
  }

  if (section.kind === "notes") {
    return (
      <div className={`rounded-xl border p-4 ${TONE_BG[section.tone]}`}>
        <SectionHeading>{section.title}</SectionHeading>
        {section.items.length === 0
          ? <p className="text-sm text-gray-500">Nothing to report.</p>
          : <ul className="space-y-1.5 text-sm text-gray-200 list-disc list-inside">{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
      </div>
    );
  }

  if (section.kind === "facts") {
    return (
      <div className="card">
        <SectionHeading>{section.title}</SectionHeading>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {section.items.map(item => (
            <div key={item.label} className="flex items-baseline justify-between gap-4 border-b border-surface-border/40 pb-1">
              <dt className="text-gray-400">{item.label}</dt>
              <dd className="text-white text-right">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <SectionHeading>{section.title}</SectionHeading>
        {section.rows.length > 0 && <span className="text-[11px] text-gray-500 mb-3">{section.rows.length} row{section.rows.length === 1 ? "" : "s"}</span>}
      </div>
      {section.rows.length === 0 ? (
        <p className="text-sm text-gray-600">{section.emptyText ?? "No rows matched."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-surface-border text-left">
                {section.columns.map(col => (
                  <th key={col.key} className={`py-2 px-2 text-[11px] uppercase tracking-wider text-gray-500 font-semibold ${col.align === "right" ? "text-right" : ""}`}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i} className="border-b border-surface-border/40 hover:bg-surface-lighter/30">
                  {section.columns.map(col => (
                    <td key={col.key} className={`py-2 px-2 text-gray-300 ${col.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {formatValue(row[col.key], col.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.note && <p className="text-[11px] text-gray-500 mt-3">{section.note}</p>}
    </div>
  );
}

export function ReportBody({ sections, compact }: { sections: Section[]; compact?: boolean }) {
  return <div className={compact ? "space-y-3" : "space-y-5"}>{sections.map((section, i) => <SectionBlock key={i} section={section} />)}</div>;
}

// ── Turning sections into tables (the one shape every export uses) ──

interface FlatTable { title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> }

/** Flattens every section to plain tables, so print, PDF, CSV and Excel cannot disagree. */
export function sectionsToTables(sections: Section[]): FlatTable[] {
  const tables: FlatTable[] = [];
  for (const section of sections) {
    if (section.kind === "table") {
      tables.push({
        title: section.title,
        columns: section.columns.map(c => ({ key: c.key, label: c.label })),
        rows: section.rows.map(row => Object.fromEntries(section.columns.map(c => [c.key, formatValue(row[c.key], c.format)]))),
      });
    } else if (section.kind === "kpis") {
      tables.push({
        title: section.title ?? "Summary",
        columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }],
        rows: section.items.map(i => ({ metric: i.label, value: i.sub ? `${i.value} — ${i.sub}` : i.value })),
      });
    } else if (section.kind === "facts") {
      tables.push({ title: section.title, columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], rows: section.items.map(i => ({ metric: i.label, value: i.value })) });
    } else if (section.kind === "bars") {
      tables.push({ title: section.title, columns: [{ key: "label", label: "Item" }, { key: "value", label: "Value" }], rows: section.rows.map(r => ({ label: r.label, value: r.display ?? number(r.value) })) });
    } else if (section.kind === "notes") {
      tables.push({ title: section.title, columns: [{ key: "note", label: "Note" }], rows: section.items.map(item => ({ note: item })) });
    }
  }
  return tables;
}

const fileBase = (title: string) => title.replace(/[^\w]+/g, "-");

// ── Print ───────────────────────────────────────────────────────────

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/**
 * The printable report. It is a real document rather than `window.print()` on the console, because
 * printing the application printed the sidebar, the header and whatever else was on screen — which
 * is what the Print button used to do.
 */
export function printReport(document_: ReportDocument): void {
  const { title, subtitle, period, sections } = document_;
  const body = sectionsToTables(sections).map(table => `
    <h2>${escapeHtml(table.title)}</h2>
    <table>
      <thead><tr>${table.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${table.rows.map(row => `<tr>${table.columns.map(c => `<td>${escapeHtml(String(row[c.key] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`).join("");

  const window_ = window.open("", "_blank", "width=980,height=760");
  if (!window_) return;
  window_.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#1e293b;padding:28px}
  h1{font-size:21px;color:#0b1120;border-bottom:3px solid #22d3ee;padding-bottom:6px}
  .meta{font-size:12px;color:#64748b;margin:6px 0 18px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#334155;margin:18px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{text-align:left;padding:6px 8px;background:#f1f5f9;border-bottom:2px solid #cbd5e1;font-weight:600;color:#334155}
  td{padding:6px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}
  tr:nth-child(even) td{background:#f8fafc}
  @media print{body{padding:12px}h2{page-break-after:avoid}table{page-break-inside:auto}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml([subtitle, period].filter(Boolean).join(" · "))} · Generated ${new Date().toLocaleString()} — C7NTAX Reporting</p>
${body || "<p>No data available.</p>"}
</body></html>`);
  window_.document.close();
  window_.focus();
  setTimeout(() => window_.print(), 400);
}

// ── PDF ─────────────────────────────────────────────────────────────

export function exportPdf(document_: ReportDocument): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  doc.setFontSize(16);
  doc.text(document_.title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text([document_.subtitle, document_.period, `Generated ${new Date().toLocaleString()} — C7NTAX Reporting`].filter(Boolean).join(" · "), 40, 56);
  doc.setTextColor(0);

  let cursor = 76;
  for (const table of sectionsToTables(document_.sections)) {
    if (cursor > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); cursor = 60; }
    doc.setFontSize(11);
    doc.text(table.title, 40, cursor);
    cursor += 6;
    autoTable(doc, {
      head: [table.columns.map(c => c.label)],
      body: table.rows.map(row => table.columns.map(c => String(row[c.key] ?? "—"))),
      startY: cursor,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [34, 211, 238], textColor: 15 },
      alternateRowStyles: { fillColor: [247, 250, 252] },
      margin: { left: 40, right: 40 },
      tableWidth: width - 80,
    });
    const final = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    cursor = (final?.finalY ?? cursor) + 26;
  }
  doc.save(`${fileBase(document_.title)}.pdf`);
}

// ── CSV ─────────────────────────────────────────────────────────────

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function exportCsv(document_: ReportDocument, download: (filename: string, csv: string) => void): void {
  const lines: string[] = [];
  for (const table of sectionsToTables(document_.sections)) {
    lines.push(csvCell(table.title));
    lines.push(table.columns.map(c => csvCell(c.label)).join(","));
    for (const row of table.rows) lines.push(table.columns.map(c => csvCell(row[c.key])).join(","));
    lines.push("");
  }
  download(`${fileBase(document_.title)}.csv`, lines.join("\r\n"));
}

// ── Excel ───────────────────────────────────────────────────────────

/**
 * SpreadsheetML 2003, which Excel opens natively as a workbook with typed cells and a sheet per
 * table. An HTML table renamed `.xls` looks like it works right up to the moment a spreadsheet
 * application is asked to open it, so this writes an actual spreadsheet format.
 */
export function exportExcel(document_: ReportDocument): void {
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string));
  const sheetName = (title: string, index: number) => escapeXml(title.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || `Table ${index + 1}`);

  const sheets = sectionsToTables(document_.sections).map((table, index) => {
    const header = `<Row>${table.columns.map(c => `<Cell ss:StyleID="head"><Data ss:Type="String">${escapeXml(c.label)}</Data></Cell>`).join("")}</Row>`;
    const body = table.rows.map(row => `<Row>${table.columns.map(c => {
      const raw = row[c.key];
      const asText = raw === null || raw === undefined ? "" : String(raw);
      const compact = asText.replace(/[,$]/g, "");
      const asNumber = typeof raw === "number" ? raw : (compact !== "" && /^-?\d+(\.\d+)?$/.test(compact) ? Number(compact) : null);
      return asNumber !== null
        ? `<Cell><Data ss:Type="Number">${asNumber}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${escapeXml(asText)}</Data></Cell>`;
    }).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${sheetName(table.title, index)}"><Table>${header}${body}</Table></Worksheet>`;
  }).join("");

  const workbook = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="head"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="Report"><Table>
<Row><Cell><Data ss:Type="String">${escapeXml(document_.title)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">${escapeXml([document_.subtitle, document_.period, `Generated ${new Date().toLocaleString()}`].filter(Boolean).join(" · "))}</Data></Cell></Row>
</Table></Worksheet>${sheets}</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBase(document_.title)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
