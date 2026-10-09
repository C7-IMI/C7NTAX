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
import { DOCUMENT_BRAND, documentMetaLine, shieldDataUrl } from "../../lib/documentBrand";
import {
  duration as durationValue, formatValue as formatValueIn, labelFor as labelForValue,
  money as moneyValue, number as numberValue, unwrapValue, type ValueFormat,
} from "@C7NTAX/shared";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
/** The formats a column can ask for. Defined once in `@C7NTAX/shared` so the banded engine and this kit agree. */
export type ColumnFormat = ValueFormat;

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

/**
 * The formatters live in `@C7NTAX/shared` and are re-exported here, because the banded template
 * engine needs the same answers: a number formatted as money must read the same in a table and in a
 * band, and a date must not be printed two ways in one product.
 */
export const money = moneyValue;
export const number = numberValue;
export const duration = durationValue;
export const labelFor = labelForValue;
export const formatValue = formatValueIn;
export { unwrapValue as unwrap };

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

/** The plain shape every writer below reads. A banded template produces the same shape from its bands. */
export interface FlatTable { title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> }

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

/** A workbook name safe for SpreadsheetML and for a filename. */
export const reportFileBase = fileBase;

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// ── The writers, over plain tables ──────────────────────────────────
//
// These take `FlatTable[]` rather than a `ReportDocument`, so a banded template — which produces its
// rows from bands rather than sections — exports through exactly the same writers. A second
// spreadsheet implementation is how a designed report ends up opening differently from a standard one.

/**
 * SpreadsheetML 2003, which Excel opens natively as a workbook with typed cells and a sheet per
 * table. An HTML table renamed `.xls` looks like it works right up to the moment a spreadsheet
 * application is asked to open it, so this writes an actual spreadsheet format.
 */
export function tablesToExcel(tables: FlatTable[], title: string, subtitle?: string, period?: string): void {
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c] as string));
  const sheetName = (text: string, index: number) => escapeXml(text.replace(/[\\/?*[\]:]/g, "").slice(0, 28) || `Table ${index + 1}`);

  const sheets = tables.map((table, index) => {
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
<Row><Cell><Data ss:Type="String">${escapeXml(title)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">${escapeXml([subtitle, period, `Generated ${new Date().toLocaleString()}`].filter(Boolean).join(" · "))}</Data></Cell></Row>
</Table></Worksheet>${sheets}</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileBase(title)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Every table as CSV, one after another with a blank line between, which is what a reader expects. */
export function tablesToCsv(tables: FlatTable[]): string {
  const lines: string[] = [];
  for (const table of tables) {
    lines.push(csvCell(table.title));
    lines.push(table.columns.map(c => csvCell(c.label)).join(","));
    for (const row of table.rows) lines.push(table.columns.map(c => csvCell(row[c.key])).join(","));
    lines.push("");
  }
  return lines.join("\r\n");
}

/** The landscape PDF the standard reports use: a heading, then one autoTable per table. */
export function tablesToPdf(tables: FlatTable[], title: string, subtitle?: string, period?: string): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  doc.setFontSize(16);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text([subtitle, period, `Generated ${new Date().toLocaleString()} — C7NTAX Reporting`].filter(Boolean).join(" · "), 40, 56);
  doc.setTextColor(0);

  let cursor = 76;
  for (const table of tables) {
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
  doc.save(`${fileBase(title)}.pdf`);
}

/** The printable report as HTML tables — the same content as the PDF. */
export function tablesToPrintWindow(tables: FlatTable[], title: string, subtitle?: string, period?: string): Window | null {
  const body = tables.map(table => `
    <h2>${escapeHtml(table.title)}</h2>
    <table>
      <thead><tr>${table.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${table.rows.map(row => `<tr>${table.columns.map(c => `<td>${escapeHtml(String(row[c.key] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`).join("");

  const window_ = window.open("", "_blank", "width=980,height=760");
  if (!window_) return null;
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
  return window_;
}

// ── Generated documents ─────────────────────────────────────────────
//
// A *generated* document — a standard report, a dashboard, the queue's own print — is laid out here
// from its sections, so a KPI block prints as tiles, a bar list prints as bars and a table prints as
// a table. The table writers above stay for the banded designer's output, whose bands decide their
// own geometry and whose author placed the header themselves.
//
// The brand is in `lib/documentBrand.ts`; nothing below invents a colour.

/** Tone colours on paper, matched to the screen's tones so a figure reads the same both places. */
const TONE_INK: Record<Tone, { fill: string; ink: string }> = {
  neutral: { fill: DOCUMENT_BRAND.tint, ink: DOCUMENT_BRAND.ink },
  good: { fill: "#dcfce7", ink: "#166534" },
  warn: { fill: "#fef3c7", ink: "#92400e" },
  bad: { fill: "#fee2e2", ink: "#991b1b" },
  info: { fill: "#cffafe", ink: "#155e75" },
};

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
};

/**
 * The letterhead, drawn once per document: the shield, the product's wordmark with its crimson 7, the
 * company, then the title, the meta line and the accent rule the document hangs from.
 *
 * The wordmark is drawn as three runs rather than one because the 7 is crimson and the rest is ink —
 * the same treatment the interface gives it through two masks, done here with three `text` calls and
 * the measured width of what came before.
 */
function drawLetterhead(doc: jsPDF, title: string, subtitle?: string, period?: string, shield?: string | null): number {
  const margin = 40;
  const width = doc.internal.pageSize.getWidth();
  let textLeft = margin;

  if (shield) {
    try {
      doc.addImage(shield, "PNG", margin, 32, 24, 24);
      textLeft = margin + 32;
    } catch {
      textLeft = margin; // An unreadable image must not cost the document its identity or its layout.
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(DOCUMENT_BRAND.ink);
  doc.text("C", textLeft, 50);
  const afterC = textLeft + doc.getTextWidth("C");
  doc.setTextColor(DOCUMENT_BRAND.crimson);
  doc.text("7", afterC, 50);
  const afterSeven = afterC + doc.getTextWidth("7");
  doc.setTextColor(DOCUMENT_BRAND.ink);
  doc.text("NTAX", afterSeven + 3.4, 50); // the logotype's own tracking between the 7 and the N

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(DOCUMENT_BRAND.muted);
  doc.text(DOCUMENT_BRAND.company, width - margin, 44, { align: "right" });
  doc.text("Reporting", width - margin, 54, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(DOCUMENT_BRAND.ink);
  doc.text(title, margin, 80);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(DOCUMENT_BRAND.muted);
  doc.text(documentMetaLine(subtitle, period), margin, 93);

  doc.setDrawColor(...hexToRgb(DOCUMENT_BRAND.accent));
  doc.setLineWidth(2);
  doc.line(margin, 100, width - margin, 100);
  return 118;
}

/** A section heading: a small caps label over a hairline, so a page of figures still has chapters. */
function drawSectionHeading(doc: jsPDF, label: string, y: number): number {
  const margin = 40;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(DOCUMENT_BRAND.body);
  doc.text(label.toUpperCase(), margin, y, { charSpace: 0.6 });
  doc.setDrawColor(...hexToRgb(DOCUMENT_BRAND.hairline));
  doc.setLineWidth(0.6);
  doc.line(margin, y + 5, doc.internal.pageSize.getWidth() - margin, y + 5);
  return y + 18;
}

function drawKpis(doc: jsPDF, section: Extract<Section, { kind: "kpis" }>, y: number): number {
  const margin = 40;
  const gap = 10;
  const perRow = 4;
  const width = doc.internal.pageSize.getWidth();
  const tileWidth = (width - margin * 2 - gap * (perRow - 1)) / perRow;
  const tileHeight = 46;

  section.items.forEach((item, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = margin + column * (tileWidth + gap);
    const top = y + row * (tileHeight + gap);
    const tone = TONE_INK[item.tone ?? "neutral"];

    doc.setFillColor(...hexToRgb(tone.fill));
    doc.setDrawColor(...hexToRgb(DOCUMENT_BRAND.hairline));
    doc.setLineWidth(0.6);
    doc.roundedRect(x, top, tileWidth, tileHeight, 3, 3, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(DOCUMENT_BRAND.muted);
    doc.text(item.label.toUpperCase(), x + 8, top + 12, { charSpace: 0.4 });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...hexToRgb(tone.ink));
    doc.text(item.value, x + 8, top + 30);

    if (item.sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(DOCUMENT_BRAND.muted);
      doc.text(item.sub, x + 8, top + 40);
    }
  });

  const rows = Math.max(1, Math.ceil(section.items.length / perRow));
  return y + rows * (tileHeight + gap) + 6;
}

function drawBars(doc: jsPDF, section: Extract<Section, { kind: "bars" }>, y: number): number {
  const margin = 40;
  const width = doc.internal.pageSize.getWidth();
  const trackWidth = width - margin * 2 - 150;
  const max = Math.max(...section.rows.map(row => row.value), 1);

  for (const row of section.rows) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(DOCUMENT_BRAND.body);
    doc.text(row.label, margin, y + 5);

    doc.setFillColor(...hexToRgb(DOCUMENT_BRAND.tint));
    doc.roundedRect(margin + 110, y - 1, trackWidth, 7, 3.5, 3.5, "F");
    const filled = Math.max(4, (row.value / max) * trackWidth);
    const tone = TONE_INK[row.tone ?? "neutral"];
    doc.setFillColor(...hexToRgb(row.tone === "neutral" || !row.tone ? DOCUMENT_BRAND.accent : tone.ink));
    doc.roundedRect(margin + 110, y - 1, filled, 7, 3.5, 3.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setTextColor(DOCUMENT_BRAND.body);
    doc.text(row.display ?? number(row.value), width - margin, y + 5, { align: "right" });
    y += 15;
  }
  return y + (section.note ? 0 : 8);
}

function drawFacts(doc: jsPDF, section: Extract<Section, { kind: "facts" }>, y: number): number {
  const margin = 40;
  const width = doc.internal.pageSize.getWidth();
  const half = (width - margin * 2 - 20) / 2;

  section.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + column * (half + 20);
    const top = y + row * 15;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(DOCUMENT_BRAND.muted);
    doc.text(item.label, x, top);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(DOCUMENT_BRAND.ink);
    doc.text(item.value, x + half, top, { align: "right" });
  });

  return y + Math.ceil(section.items.length / 2) * 15 + 6;
}

function drawNotes(doc: jsPDF, section: Extract<Section, { kind: "notes" }>, y: number): number {
  const margin = 40;
  const width = doc.internal.pageSize.getWidth();
  const tone = TONE_INK[section.tone];
  doc.setFillColor(...hexToRgb(tone.fill));
  doc.roundedRect(margin, y - 10, width - margin * 2, section.items.length * 13 + 16, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...hexToRgb(tone.ink));
  section.items.forEach((item, index) => {
    doc.text(`•  ${item}`, margin + 10, y + index * 13 + 4);
  });
  return y + section.items.length * 13 + 18;
}

/** The footer the whole document wears, written after the pages exist so it can count them. */
function drawFooters(doc: jsPDF, title: string): void {
  const margin = 40;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();

  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(...hexToRgb(DOCUMENT_BRAND.hairline));
    doc.setLineWidth(0.6);
    doc.line(margin, height - 34, width - margin, height - 34);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(DOCUMENT_BRAND.muted);
    doc.text(`${DOCUMENT_BRAND.product} Reporting · ${title}`, margin, height - 22);
    doc.text(`Page ${page} of ${total}`, width - margin, height - 22, { align: "right" });
  }
}

/**
 * The PDF of a generated document, laid out from its sections.
 *
 * Asynchronous only because the shield is an image: everything else is drawn synchronously once the
 * data URL is in hand. A missing badge costs the letterhead its glyph and nothing else.
 */
export async function documentToPdf(document_: ReportDocument): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const shield = await shieldDataUrl();
  let y = drawLetterhead(doc, document_.title, document_.subtitle, document_.period, shield);
  const bottom = doc.internal.pageSize.getHeight() - 52;

  const newPage = () => { doc.addPage(); y = 52; };

  for (const section of document_.sections) {
    // A section that cannot fit under the cursor starts a page rather than being broken across two,
    // because a table split under its own heading reads as a table without a heading.
    if (y > bottom - 60) newPage();

    if (section.kind === "kpis" || section.kind === "bars" || section.kind === "facts" || section.kind === "notes") {
      if (section.title) y = drawSectionHeading(doc, section.title, y);
      if (section.kind === "kpis") y = drawKpis(doc, section, y);
      else if (section.kind === "bars") y = drawBars(doc, section, y);
      else if (section.kind === "facts") y = drawFacts(doc, section, y);
      else y = drawNotes(doc, section, y);
      y += 10;
      continue;
    }

    y = drawSectionHeading(doc, section.title, y);
    const numeric = section.columns.map(column => column.format !== undefined && column.format !== "text");
    autoTable(doc, {
      head: [section.columns.map(column => column.label)],
      body: section.rows.map(row => section.columns.map(column => String(row[column.key] ?? "—"))),
      startY: y - 8,
      styles: { fontSize: 8, cellPadding: { top: 5, bottom: 5, left: 7, right: 7 }, lineColor: hexToRgb(DOCUMENT_BRAND.hairline), lineWidth: 0.4, textColor: hexToRgb(DOCUMENT_BRAND.body) },
      headStyles: { fillColor: hexToRgb(DOCUMENT_BRAND.ink), textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: hexToRgb(DOCUMENT_BRAND.zebra) },
      columnStyles: Object.fromEntries(numeric.map((isNumeric, index) => [index, { halign: isNumeric ? "right" : "left" }])),
      margin: { left: 40, right: 40, bottom: 52 },
      didParseCell: data => {
        if (data.section === "body" && data.column.index === 0) data.cell.styles.textColor = hexToRgb(DOCUMENT_BRAND.ink);
      },
    });
    const final = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
    y = (final?.finalY ?? y) + (section.note ? 24 : 30);
    if (section.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(DOCUMENT_BRAND.muted);
      doc.text(section.note, 40, y - 14);
    }
  }

  drawFooters(doc, document_.title);
  doc.save(`${fileBase(document_.title)}.pdf`);
}

/**
 * The printable version of a generated document — the same document as the PDF, in HTML.
 *
 * It is a real document rather than `window.print()` on the screen, because printing the screen
 * printed the sidebar and the header with it. The shield is an `<img>` here (a print window is HTML
 * and can fetch one), the page boxes are the browser's, and `thead` repeats on every page because a
 * table that loses its column labels on page two is a table nobody can read.
 */
export function documentToPrintWindow(document_: ReportDocument): Window | null {
  const window_ = window.open("", "_blank", "width=1000,height=780");
  if (!window_) return null;

  const tiles = (section: Extract<Section, { kind: "kpis" }>) => `
    ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
    <div class="tiles">${section.items.map(item => `
      <div class="tile tone-${item.tone ?? "neutral"}">
        <p class="tile__label">${escapeHtml(item.label)}</p>
        <p class="tile__value">${escapeHtml(item.value)}</p>
        ${item.sub ? `<p class="tile__sub">${escapeHtml(item.sub)}</p>` : ""}
      </div>`).join("")}</div>`;

  const bars = (section: Extract<Section, { kind: "bars" }>) => {
    const max = Math.max(...section.rows.map(row => row.value), 1);
    return `
    <h2>${escapeHtml(section.title)}</h2>
    ${section.rows.map(row => `
      <div class="bar">
        <span class="bar__label">${escapeHtml(row.label)}</span>
        <span class="bar__track"><span class="bar__fill tone-${row.tone ?? "neutral"}" style="width:${Math.max(2, Math.round((row.value / max) * 100))}%"></span></span>
        <span class="bar__value">${escapeHtml(row.display ?? number(row.value))}</span>
      </div>`).join("")}
    ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}`;
  };

  const facts = (section: Extract<Section, { kind: "facts" }>) => `
    <h2>${escapeHtml(section.title)}</h2>
    <dl class="facts">${section.items.map(item => `
      <div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}
    </dl>`;

  const notes = (section: Extract<Section, { kind: "notes" }>) => `
    <div class="callout tone-${section.tone}">
      <h3>${escapeHtml(section.title)}</h3>
      <ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>`;

  const table = (section: Extract<Section, { kind: "table" }>) => `
    <h2>${escapeHtml(section.title)}</h2>
    <table>
      <thead><tr>${section.columns.map(column => `<th class="${column.format && column.format !== "text" ? "num" : ""}">${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
      <tbody>${section.rows.map(row => `<tr>${section.columns.map(column => `<td class="${column.format && column.format !== "text" ? "num" : ""}">${escapeHtml(String(row[column.key] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
    ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}`;

  const body = document_.sections.map(section => {
    if (section.kind === "kpis") return tiles(section);
    if (section.kind === "bars") return bars(section);
    if (section.kind === "facts") return facts(section);
    if (section.kind === "notes") return notes(section);
    return table(section);
  }).join("");

  window_.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(document_.title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{margin:14mm}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff;color:${DOCUMENT_BRAND.body};padding:26px 30px 40px}
  .letterhead{display:flex;align-items:center;gap:12px;padding-bottom:10px}
  .letterhead img{width:30px;height:30px;border-radius:8px}
  .letterhead .mark{font-size:19px;font-weight:700;color:${DOCUMENT_BRAND.ink};letter-spacing:.01em}
  .letterhead .mark b{color:${DOCUMENT_BRAND.crimson}}
  .letterhead .who{margin-left:auto;text-align:right;font-size:10px;color:${DOCUMENT_BRAND.muted};line-height:1.5}
  h1{font-size:21px;color:${DOCUMENT_BRAND.ink};margin-top:8px}
  .meta{font-size:11px;color:${DOCUMENT_BRAND.muted};margin:5px 0 0}
  .rule{height:2px;background:${DOCUMENT_BRAND.accent};margin:12px 0 22px;border-radius:2px}
  h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:${DOCUMENT_BRAND.body};margin:24px 0 8px;padding-bottom:5px;border-bottom:1px solid ${DOCUMENT_BRAND.hairline};page-break-after:avoid}
  h2:first-of-type{margin-top:6px}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;page-break-inside:avoid}
  .tile{border:1px solid ${DOCUMENT_BRAND.hairline};border-radius:8px;padding:9px 11px;background:${DOCUMENT_BRAND.tint}}
  .tile__label{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:${DOCUMENT_BRAND.muted}}
  .tile__value{font-size:19px;font-weight:700;color:${DOCUMENT_BRAND.ink};margin-top:3px}
  .tile__sub{font-size:10px;color:${DOCUMENT_BRAND.muted};margin-top:2px}
  .tone-good{background:#dcfce7;border-color:#bbf7d0} .tone-good .tile__value{color:#166534}
  .tone-warn{background:#fef3c7;border-color:#fde68a} .tone-warn .tile__value{color:#92400e}
  .tone-bad{background:#fee2e2;border-color:#fecaca} .tone-bad .tile__value{color:#991b1b}
  .tone-info{background:#cffafe;border-color:#a5f3fc} .tone-info .tile__value{color:#155e75}
  .bar{display:grid;grid-template-columns:190px 1fr 80px;align-items:center;gap:10px;padding:3px 0;page-break-inside:avoid}
  .bar__label{font-size:11px}
  .bar__track{height:9px;background:${DOCUMENT_BRAND.tint};border-radius:99px;overflow:hidden}
  .bar__fill{display:block;height:100%;border-radius:99px;background:${DOCUMENT_BRAND.accent}}
  .tone-good.bar__fill{background:#16a34a} .tone-warn.bar__fill{background:#f59e0b} .tone-bad.bar__fill{background:#dc2626}
  .bar__value{font-size:11px;text-align:right;font-variant-numeric:tabular-nums}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
  .facts div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid ${DOCUMENT_BRAND.hairline};padding:5px 0}
  .facts dt{font-size:11px;color:${DOCUMENT_BRAND.muted}}
  .facts dd{font-size:11px;font-weight:600;color:${DOCUMENT_BRAND.ink}}
  .callout{border-radius:8px;padding:12px 14px;background:${DOCUMENT_BRAND.tint};border:1px solid ${DOCUMENT_BRAND.hairline}}
  .callout h3{font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .callout ul{margin-left:16px;font-size:11px} .callout li{margin:2px 0}
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead{display:table-header-group}
  th{text-align:left;padding:7px 9px;background:${DOCUMENT_BRAND.ink};color:#fff;font-weight:600;font-size:10px}
  td{padding:6px 9px;border-bottom:1px solid ${DOCUMENT_BRAND.hairline};vertical-align:top}
  tbody tr:nth-child(even) td{background:${DOCUMENT_BRAND.zebra}}
  td:first-child{color:${DOCUMENT_BRAND.ink}}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .note{font-size:10px;color:${DOCUMENT_BRAND.muted};margin-top:6px;font-style:italic}
  .foot{margin-top:28px;padding-top:8px;border-top:1px solid ${DOCUMENT_BRAND.hairline};font-size:9.5px;color:${DOCUMENT_BRAND.muted};display:flex;justify-content:space-between}
  @media print{body{padding:0} .tiles,.bar,.facts div{page-break-inside:avoid}}
</style></head><body>
<div class="letterhead">
  <img src="${DOCUMENT_BRAND.shield}" alt="">
  <span class="mark">C<b>7</b>NTAX</span>
  <span class="who">${escapeHtml(DOCUMENT_BRAND.company)}<br>Reporting</span>
</div>
<h1>${escapeHtml(document_.title)}</h1>
<p class="meta">${escapeHtml(documentMetaLine(document_.subtitle, document_.period))}</p>
<div class="rule"></div>
${body || "<p>No data available.</p>"}
<div class="foot"><span>${escapeHtml(DOCUMENT_BRAND.product)} Reporting · ${escapeHtml(document_.title)}</span><span>${escapeHtml(new Date().toLocaleString())}</span></div>
</body></html>`);
  window_.document.close();
  window_.focus();
  return window_;
}

// ── Print ───────────────────────────────────────────────────────────

/**
 * The printable report. It is a real document rather than `window.print()` on the console, because
 * printing the application printed the sidebar, the header and whatever else was on screen — which
 * is what the Print button used to do.
 */
export function printReport(document_: ReportDocument): void {
  const window_ = documentToPrintWindow(document_);
  if (!window_) return;
  setTimeout(() => window_.print(), 400);
}

// ── PDF ─────────────────────────────────────────────────────────────

export function exportPdf(document_: ReportDocument): void {
  // The shield is an image, so the document is drawn once it has one; the caller does not wait for a
  // download it did not ask to manage.
  void documentToPdf(document_);
}

// ── CSV ─────────────────────────────────────────────────────────────

export function exportCsv(document_: ReportDocument, download: (filename: string, csv: string) => void): void {
  download(`${fileBase(document_.title)}.csv`, tablesToCsv(sectionsToTables(document_.sections)));
}

// ── Excel ───────────────────────────────────────────────────────────

export function exportExcel(document_: ReportDocument): void {
  tablesToExcel(sectionsToTables(document_.sections), document_.title, document_.subtitle, document_.period);
}
