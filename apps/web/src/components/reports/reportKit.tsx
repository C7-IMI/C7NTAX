/**
 * The report kit (PLAN-020, and the document language of §8/`docs/mockups/documents-reports.html`).
 *
 * A report is described once as a list of sections — KPI blocks, bar lists, tables, note lists and
 * fact pairs — and every way of consuming it reads that same list: the screen draws it, **Print**
 * renders it to a print window, **PDF** lays it out with jsPDF and **Excel/CSV** write the same tables
 * out. There is no second code path that decides what a report "really" contains, which is what used
 * to let an exported file disagree with the screen it came from.
 *
 * **The paper is not this file's business.** The paper sizes, margins, type scale, rules and the basis
 * block live in one module (`documentLanguage.ts`) and the branding lives in one place (`@C7NTAX/shared`
 * plus the cache in `hooks/useBrandKit`). This file maps sections onto the language's blocks and hands
 * the resolved `DocumentBrand` through. That is why there is no company name, no hex literal for the
 * brand and no hardcoded page size below: the PDF used to be **always** landscape A4 whatever the
 * screen showed, and the print window had no `@page` rule at all, so the browser chose the paper. Both
 * of those were the same defect — a renderer deciding for itself — and both are gone.
 */
import type { ReactNode } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  duration as durationValue, formatValue as formatValueIn, labelFor as labelForValue,
  money as moneyValue, number as numberValue, unwrapValue,
  type DocumentBrand, type DocumentFamily, type DocumentPresentation, type ValueFormat,
} from "@C7NTAX/shared";
import { documentBrandOf } from "../../hooks/useBrandKit";
import { shieldDataUrl } from "../../lib/documentBrand";
import {
  DOC_MARGIN, TYPE_PT, basisBlocks, contentWidthMm, pageBox, ptToMm, renderPrintDocument,
  type BasisBlock, type PrintBlock,
} from "./documentLanguage";

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

/**
 * A report, as the document it is.
 *
 * `family` decides which letterhead, paper size and basis default the document wears; it is optional so
 * a caller that has only sections still gets the shipped standard-report sheet. `basis` is the
 * **endpoint's own** account of where its figures came from — the kit never composes one.
 */
export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** The period the server actually applied, as the endpoint named it. */
  period?: string;
  /** The client the report was run for, when the caller narrowed it. */
  client?: string;
  /**
   * The report's own id, so Report Branding applies to a report printed from the browser and not only
   * to one produced on the server. Absent means the family's settings, which is the right answer for a
   * document that is not one of the shipped reports.
   */
  reportKey?: string;
  /** Who produced the document. The fourth fact of the meta line, and the first question asked of a disputed figure. */
  generatedBy?: string;
  family?: DocumentFamily;
  basis?: BasisBlock;
  sections: Section[];
}

/** A per-export choice: paper, orientation, and whether the basis block travels with the file. */
export interface ExportOptions {
  presentation?: Partial<DocumentPresentation> | null;
}

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
//
// The screen is the application's surface, not paper: it keeps the cards, the tints and the theme
// tokens. Only the *sections* are shared with the document, which is the property that stops a file
// disagreeing with the screen it came from.

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

/**
 * Every table as CSV, one after another with a blank line between, which is what a reader expects.
 *
 * `preamble` is the basis block, and it goes **first** rather than last: a spreadsheet has no pages, so
 * "the last sheet" is not a place. As the opening paragraph it is the one thing a reader of the file
 * cannot miss, which is what a caveat needs to be.
 */
export function tablesToCsv(tables: FlatTable[], preamble: string[] = []): string {
  const lines: string[] = [];
  for (const line of preamble) lines.push(csvCell(line));
  if (preamble.length) lines.push("");
  for (const table of tables) {
    lines.push(csvCell(table.title));
    lines.push(table.columns.map(c => csvCell(c.label)).join(","));
    for (const row of table.rows) lines.push(table.columns.map(c => csvCell(row[c.key])).join(","));
    lines.push("");
  }
  return lines.join("\r\n");
}

/**
 * The printable version of plain tables — the banded designer's output.
 *
 * A designed report is **deliberately exempt** from the letterhead: its author placed header bands by
 * hand, and stamping the instance's mark above them would be overruling the person who designed the
 * page. It still gets the document's paper, its type floor and its rules, because a sheet is a sheet.
 */
export function tablesToPrintWindow(
  tables: FlatTable[], title: string, subtitle?: string, period?: string, options?: ExportOptions,
): Window | null {
  const brand = documentBrandOf("report.designer", options?.presentation ? { presentation: options.presentation } : null);
  const generatedAt = new Date();
  const blocks: PrintBlock[] = tables.map(table => ({
    kind: "table" as const,
    title: table.title,
    columns: table.columns.map(c => ({ label: c.label })),
    rows: table.rows.map(row => table.columns.map(c => String(row[c.key] ?? "—"))),
  }));
  return openPrintWindow({
    brand, blocks, title,
    metaLine: metaLineOf({ subtitle, period }, brand, generatedAt),
    runningHead: [title, subtitle].filter(Boolean).join(" · "),
    footerLeft: footerLeftOf(brand, generatedAt),
  });
}

// ── The document language adapter ───────────────────────────────────
//
// Everything below turns a `ReportDocument` into the language's blocks and hands them to one of two
// renderers. Neither renderer knows what a "section" is, and neither holds a brand: they are given a
// resolved `DocumentBrand` and a list of blocks.

const brandOf = (document_: ReportDocument, options?: ExportOptions): DocumentBrand =>
  documentBrandOf(
    document_.family ?? "report.standard",
    options?.presentation ? { presentation: options.presentation } : null,
    document_.reportKey,
  );

/** `S. Simmons` — the footer's version of a name, where there is no room for the whole of it. */
function shortName(who?: string): string {
  if (!who) return "";
  const match = who.match(/^\s*([^\s@]+)(?:\s+([^\s@]+))?/);
  if (!match) return who;
  const first = match[1] ?? "";
  const last = match[2] ?? "";
  return last ? `${first.charAt(0).toUpperCase()}. ${last}` : first;
}

/** Client · period · as-of · generated at · who generated it. */
function metaLineOf(document_: Pick<ReportDocument, "client" | "subtitle" | "period" | "generatedBy">, brand: DocumentBrand, at: Date, asOf?: string): string {
  const who = document_.generatedBy;
  return [
    document_.client ?? document_.subtitle,
    document_.period,
    asOf ? `As of ${asOf}` : null,
    `Generated ${at.toLocaleString()}${who ? ` by ${who}` : ""}`,
  ].filter(Boolean).join(" · ") || `Generated ${at.toLocaleString()}`;
}

/** instance · generated at by whom · the confidential line. The page count is counted by the renderer. */
function footerLeftOf(brand: DocumentBrand, at: Date, generatedBy?: string): string {
  const host = typeof window === "undefined" ? "" : window.location.host;
  return [
    host,
    at.toLocaleString(),
    shortName(generatedBy),
    brand.legalText ?? `Confidential — ${brand.company}`,
  ].filter(Boolean).join(" · ");
}

/** The masthead: 3–5 key figures, the ones needing attention carrying the accent in the *weight* of the rule. */
function mastheadFigures(items: KpiItem[]): PrintBlock {
  const figures = items.slice(0, 5).map(item => ({
    label: item.label,
    value: item.value,
    sub: item.sub,
    attention: item.tone === "warn" || item.tone === "bad",
  }));
  return { kind: "masthead", figures };
}

/**
 * The sections, as the document's blocks.
 *
 * The first KPI block becomes the masthead and every later one becomes a masthead of its own; a table's
 * rows are pre-formatted here so the language's renderer never has to know what a `money` format is;
 * and any row carrying `__total: true` is lifted out of the body and drawn with a rule above it.
 */
function blocksFromSections(sections: Section[]): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  let index = 0;
  for (const section of sections) {
    if (section.kind === "kpis") {
      if (section.items.length) blocks.push(mastheadFigures(section.items));
      continue;
    }
    index += 1;
    if (section.kind === "bars") {
      const max = Math.max(...section.rows.map(row => Math.abs(row.value)), 0);
      const accentAt = section.rows.reduce((best, row, index) =>
        Math.abs(row.value) > Math.abs(section.rows[best]?.value ?? 0) ? index : best, 0);
      blocks.push({
        kind: "bars",
        number: index,
        title: section.title,
        rows: section.rows.map((row, index) => ({
          label: row.label,
          value: row.display ?? number(row.value),
          fraction: max > 0 ? Math.abs(row.value) / max : 0,
          // One bar carries the accent — the largest, which is the one the next action is about. The
          // rest are ink, so the chart needs no legend and survives a greyscale photocopy.
          accent: max > 0 && index === accentAt && row.value !== 0,
        })),
        axis: ["0%", "50%", "100%"],
        note: section.note,
      });
      continue;
    }
    if (section.kind === "table") {
      const rows = section.rows.filter(row => row.__total !== true);
      const totalRow = section.rows.find(row => row.__total === true);
      blocks.push({
        kind: "table",
        number: index,
        title: section.title,
        columns: section.columns.map(column => ({
          label: column.label,
          numeric: column.align === "right" || (column.format !== undefined && column.format !== "text"),
        })),
        rows: rows.map(row => section.columns.map(column => formatValue(row[column.key], column.format))),
        total: totalRow ? section.columns.map(column => formatValue(totalRow[column.key], column.format)) : undefined,
        note: section.rows.length === 0 ? (section.emptyText ?? "No rows matched.") : section.note,
      });
      continue;
    }
    if (section.kind === "facts") {
      blocks.push({ kind: "facts", number: index, title: section.title, items: section.items.map(item => ({ label: item.label, value: item.value })) });
      continue;
    }
    blocks.push({ kind: "callout", number: index, title: section.title, items: section.items });
  }
  return blocks;
}

/** The basis, in the shape the language's block builder expects. Null when there is nothing to print. */
function basisOf(document_: ReportDocument, brand: DocumentBrand): BasisBlock | null {
  if (!brand.presentation.showBasis || !document_.basis) return null;
  const { asOf, measures, notes } = document_.basis;
  /*
   * A note the document already prints has already been said.
   *
   * Several builders render the endpoint's `notes` as a `notes` section of their own — the ageing
   * report's "Read this before dunning" is one — and printing the same two sentences again under
   * "What this cannot say" would be the document repeating itself. The basis block keeps only what the
   * report has not already said, so nothing is said twice and nothing is dropped.
   */
  const alreadySaid = new Set(
    document_.sections.flatMap(section => (section.kind === "notes" ? section.items.map(item => item.trim()) : [])),
  );
  const remaining = notes.filter(note => !alreadySaid.has(note.trim()));
  if (!measures.length && !remaining.length) return null;
  return { asOf: readableAsOf(asOf), measures, notes: remaining };
}

/** A payload's `asOf` is an ISO date; a reader gets the same shape as every other date on the page. */
function readableAsOf(asOf?: string): string | undefined {
  if (!asOf) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(asOf)) return asOf;
  const parsed = new Date(asOf);
  return Number.isNaN(parsed.getTime()) ? asOf : parsed.toLocaleDateString();
}

/**
 * A report's payload, as the basis block.
 *
 * The endpoint already carries `basis`, `notes` and, on the ageing report, an `asOf`; the report
 * *builders* consume them for the screen in prose a file's reader never sees. This reads them off the
 * raw payload so what is printed cannot drift from what was measured, and it names an unknown key the
 * way the payload did rather than dropping it — a basis block that quietly omits a rule is worse than
 * one that prints a rule in an unfamiliar word.
 */
export function basisFromPayload(payload: unknown): BasisBlock | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = payload as Record<string, unknown>;
  const raw = source.basis;
  const measures: Array<{ label: string; value: string }> = [];
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined || value === "") continue;
      const text = Array.isArray(value) ? value.map(String).join(", ") : String(value);
      if (!text) continue;
      measures.push({ label: key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim(), value: text });
    }
  }
  const notes = Array.isArray(source.notes) ? source.notes.map(String).filter(Boolean) : [];
  const asOf = typeof source.asOf === "string" ? source.asOf : undefined;
  if (!measures.length && !notes.length) return undefined;
  return { asOf, measures, notes };
}

/** The basis as rows a spreadsheet can hold. */
function basisRows(basis: BasisBlock | null): FlatTable["rows"] {
  if (!basis) return [];
  return [
    ...basis.measures.map(measure => ({ metric: measure.label, value: measure.value })),
    ...basis.notes.map(note => ({ metric: "What this cannot say", value: note })),
  ];
}

function openPrintWindow(input: {
  brand: DocumentBrand; blocks: PrintBlock[]; title: string; metaLine: string; runningHead: string; footerLeft: string; autoPrint?: boolean;
}): Window | null {
  const window_ = window.open("", "_blank", "width=1000,height=780");
  if (!window_) return null;
  window_.document.write(renderPrintDocument({
    brand: input.brand,
    title: input.title,
    metaLine: input.metaLine,
    runningHead: input.runningHead,
    blocks: input.blocks,
    footerLeft: input.footerLeft,
    autoPrint: input.autoPrint,
  }));
  window_.document.close();
  window_.focus();
  return window_;
}

// ── jsPDF ───────────────────────────────────────────────────────────
//
// Drawn in **millimetres** at the paper the document chose. jsPDF's core fonts are the ones it can
// embed without a font file, so the PDF sets Helvetica where the screen sets Inter — the one place the
// two surfaces cannot be identical, and the reason the type *scale* is shared rather than the face.

const rgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};

interface PdfContext {
  doc: jsPDF; brand: DocumentBrand;
  pageW: number; pageH: number;
  left: number; right: number; top: number; bottom: number; contentW: number;
  y: number; title: string; runningHead: string; footerLeft: string;
}

function pdfLine(ctx: PdfContext, x1: number, y1: number, x2: number, y2: number, colour: string, widthPt: number): void {
  ctx.doc.setDrawColor(...rgb(colour));
  ctx.doc.setLineWidth(ptToMm(widthPt));
  ctx.doc.line(x1, y1, x2, y2);
}

/** The running head a continuation sheet wears: the document, the client, and no letterhead. */
function pdfRunningHead(ctx: PdfContext): void {
  const { doc } = ctx;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE_PT.small);
  doc.setTextColor(...rgb(ctx.brand.palette.ink));
  doc.text(ctx.runningHead, ctx.left, ctx.top + 2);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...rgb(ctx.brand.palette.muted));
  doc.text("continued", ctx.right, ctx.top + 2, { align: "right" });
  pdfLine(ctx, ctx.left, ctx.top + 4.6, ctx.right, ctx.top + 4.6, ctx.brand.palette.hairline, 0.6);
  ctx.y = ctx.top + 10;
}

function pdfNewPage(ctx: PdfContext): void {
  ctx.doc.addPage();
  pdfRunningHead(ctx);
}

/** Start a sheet when `needed` millimetres will not fit above the bottom margin. */
function pdfRoom(ctx: PdfContext, needed: number): void {
  if (ctx.y + needed > ctx.pageH - ctx.bottom) pdfNewPage(ctx);
}

function pdfWrapped(ctx: PdfContext, text: string, x: number, sizePt: number, colour: string, style: "normal" | "bold" | "italic" = "normal"): number {
  const { doc } = ctx;
  doc.setFont("helvetica", style);
  doc.setFontSize(sizePt);
  doc.setTextColor(...rgb(colour));
  const lines = doc.splitTextToSize(text, ctx.contentW) as string[];
  const step = sizePt * 1.45 * ptToMm(1);
  doc.text(lines, x, ctx.y);
  return lines.length * step;
}

function pdfSectionHead(ctx: PdfContext, number: number | undefined, title: string | undefined): void {
  if (!title) return;
  const { doc } = ctx;
  pdfRoom(ctx, 14);
  let x = ctx.left;
  if (number !== undefined) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE_PT.section);
    doc.setTextColor(...rgb(ctx.brand.accent));
    doc.text(String(number), x, ctx.y);
    x += 6;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE_PT.section);
  doc.setTextColor(...rgb(ctx.brand.palette.body));
  doc.text(title.toUpperCase(), x, ctx.y, { charSpace: 0.5 });
  pdfLine(ctx, ctx.left, ctx.y + 1.8, ctx.right, ctx.y + 1.8, ctx.brand.palette.hairline, 0.6);
  ctx.y += 5.5;
}

function pdfMasthead(ctx: PdfContext, block: Extract<PrintBlock, { kind: "masthead" }>): void {
  const { doc } = ctx;
  const gap = 5;
  const count = Math.max(1, block.figures.length);
  const width = (ctx.contentW - gap * (count - 1)) / count;
  pdfRoom(ctx, 26);
  const top = ctx.y;
  block.figures.forEach((figure, index) => {
    const x = ctx.left + index * (width + gap);
    pdfLine(ctx, x, top, x + width, top, figure.attention ? ctx.brand.accent : ctx.brand.palette.hairline, figure.attention ? 1.4 : 0.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(TYPE_PT.masthead);
    doc.setTextColor(...rgb(ctx.brand.palette.ink));
    doc.text(figure.value, x, top + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE_PT.small);
    doc.setTextColor(...rgb(ctx.brand.palette.muted));
    doc.text(figure.label.toUpperCase(), x, top + 12.5, { charSpace: 0.3 });
    if (figure.sub) doc.text(doc.splitTextToSize(figure.sub, width) as string[], x, top + 16);
  });
  const tallest = block.figures.some(figure => figure.sub) ? 20 : 15;
  ctx.y = top + tallest;
}

function pdfTable(ctx: PdfContext, block: Extract<PrintBlock, { kind: "table" }>): void {
  const { doc, brand } = ctx;
  pdfSectionHead(ctx, block.number, block.title);
  if (!block.rows.length && !block.total) {
    ctx.y += pdfWrapped(ctx, block.note ?? "No rows matched.", ctx.left, TYPE_PT.body, brand.palette.muted, "italic");
    return;
  }
  const body = block.rows.slice();
  const totalIndex = block.total ? body.length : -1;
  if (block.total) body.push(block.total);
  autoTable(doc, {
    // The label is drawn in caps here for the same reason the HTML sets `text-transform: uppercase`:
    // the two surfaces are the same document, and a column written one way on screen and another on
    // paper is the drift this whole module exists to remove.
    head: [block.columns.map(column => column.label.toUpperCase())],
    body,
    startY: ctx.y,
    margin: { left: ctx.left, right: ctx.pageW - ctx.right, bottom: ctx.bottom },
    theme: "plain",
    // No zebra: alternateRowStyles on paper is dithering. Structure is carried by hairlines and space.
    styles: {
      font: "helvetica",
      fontSize: TYPE_PT.table,
      cellPadding: { top: 1.3, bottom: 1.3, left: 2, right: 2 },
      textColor: rgb(brand.palette.body),
      lineColor: rgb(brand.palette.hairline),
    },
    // A rule **under the labels**, never an ink-filled header: 0.6 pt carries the same structure for a
    // fraction of the toner and cannot photocopy into a black bar.
    headStyles: {
      fontStyle: "bold", fontSize: TYPE_PT.small, textColor: rgb(brand.palette.muted),
      fillColor: false, lineColor: rgb(brand.palette.ink), lineWidth: { bottom: ptToMm(0.6) },
    },
    bodyStyles: { lineWidth: { bottom: ptToMm(0.4) } },
    columnStyles: Object.fromEntries(
      block.columns.map((column, index) => [index, { halign: column.numeric ? "right" : "left" }]),
    ),
    didParseCell: data => {
      if (data.section === "body" && data.row.index === totalIndex) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = rgb(brand.palette.ink);
        data.cell.styles.lineColor = rgb(brand.palette.ink);
        data.cell.styles.lineWidth = { top: ptToMm(0.5), bottom: 0 };
      }
    },
  });
  const final = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  ctx.y = (final?.finalY ?? ctx.y) + 4;
  if (block.note) ctx.y += pdfWrapped(ctx, block.note, ctx.left, TYPE_PT.small, brand.palette.muted, "italic");
}

function pdfBars(ctx: PdfContext, block: Extract<PrintBlock, { kind: "bars" }>): void {
  const { doc, brand } = ctx;
  pdfSectionHead(ctx, block.number, block.title);
  const trackX = ctx.left + 62;
  const trackW = Math.max(20, ctx.contentW - 62 - 33);
  for (const row of block.rows) {
    pdfRoom(ctx, 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE_PT.body);
    doc.setTextColor(...rgb(brand.palette.body));
    doc.text(doc.splitTextToSize(row.label, 58) as string[], ctx.left, ctx.y + 1);
    doc.setFillColor(...rgb(brand.palette.tint));
    doc.rect(trackX, ctx.y - 1.2, trackW, 2.4, "F");
    // A zero-length bar is drawn as an empty cell rather than omitted, so five bands always print as
    // five bands and the reader can see that three of them are empty.
    doc.setFillColor(...rgb(row.accent ? brand.accent : brand.palette.body));
    doc.rect(trackX, ctx.y - 1.2, trackW * Math.max(0, Math.min(1, row.fraction)), 2.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...rgb(brand.palette.body));
    doc.text(row.value, ctx.right, ctx.y + 1, { align: "right" });
    ctx.y += 5;
  }
  // The values are written beside every bar, so the chart needs no legend.
  ctx.y += 1;
  if (block.caption) ctx.y += pdfWrapped(ctx, block.caption, ctx.left, TYPE_PT.small, brand.palette.muted, "italic");
  if (block.note) ctx.y += pdfWrapped(ctx, block.note, ctx.left, TYPE_PT.small, brand.palette.muted, "italic");
  ctx.y += 2;
}

function pdfFacts(ctx: PdfContext, block: Extract<PrintBlock, { kind: "facts" }>): void {
  const { doc, brand } = ctx;
  pdfSectionHead(ctx, block.number, block.title);
  if (block.lead) ctx.y += pdfWrapped(ctx, block.lead, ctx.left, TYPE_PT.body, brand.palette.body) + 1.5;
  const half = (ctx.contentW - 8) / 2;
  const rows = Math.ceil(block.items.length / 2);
  pdfRoom(ctx, rows * 5.5 + 2);
  block.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = ctx.left + column * (half + 8);
    const top = ctx.y + row * 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE_PT.body);
    doc.setTextColor(...rgb(brand.palette.muted));
    doc.text(doc.splitTextToSize(item.label, half - 6) as string[], x, top);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...rgb(brand.palette.ink));
    doc.text(doc.splitTextToSize(item.value, half - 6) as string[], x + half, top, { align: "right" });
    pdfLine(ctx, x, top + 1.6, x + half, top + 1.6, brand.palette.hairline, 0.4);
  });
  ctx.y += rows * 5.5 + 2;
}

function pdfCallout(ctx: PdfContext, block: Extract<PrintBlock, { kind: "callout" }>): void {
  const { doc, brand } = ctx;
  if (block.title) {
    pdfSectionHead(ctx, block.number, block.title);
  } else {
    pdfRoom(ctx, 10);
  }
  const indent = ctx.left + 4;
  const textW = ctx.contentW - 6;
  const startY = ctx.y;
  let offset = 0;
  for (const item of block.items) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE_PT.body);
    doc.setTextColor(...rgb(brand.palette.body));
    const lines = doc.splitTextToSize(item, textW) as string[];
    lines.forEach((line, index) => {
      doc.text(line, indent, startY + offset + index * 4.2);
    });
    offset += lines.length * 4.2 + 1;
  }
  // One accent, carried by the weight of the stroke: 1.4 pt against the 0.5 pt hairlines around it.
  doc.setFillColor(...rgb(brand.accent));
  doc.rect(ctx.left, startY - 3.4, ptToMm(1.4), offset + 1, "F");
  ctx.y = startY + offset + 3;
}

function pdfBlock(ctx: PdfContext, block: PrintBlock): void {
  const { doc, brand } = ctx;
  switch (block.kind) {
    case "masthead": pdfMasthead(ctx, block); return;
    case "section": pdfSectionHead(ctx, block.number, block.title); return;
    case "lead": ctx.y += pdfWrapped(ctx, block.text, ctx.left, TYPE_PT.body, brand.palette.body) + 2; return;
    case "note": ctx.y += pdfWrapped(ctx, block.text, ctx.left, TYPE_PT.small, brand.palette.muted, "italic"); return;
    case "table": pdfTable(ctx, block); return;
    case "bars": pdfBars(ctx, block); return;
    case "facts": pdfFacts(ctx, block); return;
    case "callout": pdfCallout(ctx, block); return;
  }
}

/** The letterhead: the brand's mark, its name, the title, the meta line and the one accent rule. */
async function pdfLetterhead(ctx: PdfContext, title: string, metaLine: string): Promise<void> {
  const { doc, brand } = ctx;
  const mark = await shieldDataUrl(brand.mark);
  let textLeft = ctx.left;
  if (mark) {
    try {
      doc.addImage(mark, "PNG", ctx.left, ctx.top - 1, 9, 9);
      textLeft = ctx.left + 11;
    } catch {
      textLeft = ctx.left; // An unreadable image must not cost the document its identity or its layout.
    }
  }
  if (brand.mark.kind === "wordmark" || mark) {
    // The numeral of the wordmark takes the accent, and that accent is then the document's only one.
    const word = brand.wordmark;
    const digit = word.match(/\d/);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    let x = textLeft;
    if (digit && digit.index !== undefined) {
      const before = word.slice(0, digit.index);
      const numeral = word.slice(digit.index, digit.index + 1);
      const after = word.slice(digit.index + 1);
      doc.setTextColor(...rgb(brand.palette.ink));
      if (before) { doc.text(before, x, ctx.top + 6); x += doc.getTextWidth(before); }
      doc.setTextColor(...rgb(brand.accent));
      doc.text(numeral, x, ctx.top + 6); x += doc.getTextWidth(numeral) + 0.6;
      doc.setTextColor(...rgb(brand.palette.ink));
      doc.text(after, x, ctx.top + 6);
    } else {
      doc.setTextColor(...rgb(brand.palette.ink));
      doc.text(word, x, ctx.top + 6);
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE_PT.small);
  doc.setTextColor(...rgb(brand.accent));
  doc.text(brand.company, ctx.right, ctx.top + 3, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...rgb(brand.palette.muted));
  doc.text(brand.tagline ?? brand.product, ctx.right, ctx.top + 7, { align: "right" });
  // A hairline, not a coloured band: 0.6 pt of ink where the letterhead ends.
  pdfLine(ctx, ctx.left, ctx.top + 11, ctx.right, ctx.top + 11, brand.palette.ink, 0.6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(TYPE_PT.title);
  doc.setTextColor(...rgb(brand.palette.ink));
  doc.text(title, ctx.left, ctx.top + 19.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(TYPE_PT.small);
  doc.setTextColor(...rgb(brand.palette.muted));
  doc.text(metaLine, ctx.left, ctx.top + 24);
  pdfLine(ctx, ctx.left, ctx.top + 27, ctx.right, ctx.top + 27, brand.accent, 1.4);
  ctx.y = ctx.top + 33;
}

/** The footer on every sheet: the instance, the time, the confidential line, and page n of m. */
function pdfFooters(ctx: PdfContext): void {
  const { doc, brand } = ctx;
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    pdfLine(ctx, ctx.left, ctx.pageH - ctx.bottom + 1.5, ctx.right, ctx.pageH - ctx.bottom + 1.5, brand.palette.hairline, 0.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(TYPE_PT.small);
    doc.setTextColor(...rgb(brand.palette.muted));
    doc.text(ctx.footerLeft, ctx.left, ctx.pageH - ctx.bottom + 6);
    doc.text(`Page ${page} of ${total}`, ctx.right, ctx.pageH - ctx.bottom + 6, { align: "right" });
  }
}

/**
 * The PDF of a generated document, laid out from its blocks at the paper the document chose.
 *
 * Asynchronous only because the mark is an image: everything else is drawn synchronously once the data
 * URL is in hand. A missing badge costs the letterhead its glyph and nothing else.
 */
export async function documentToPdf(document_: ReportDocument, options?: ExportOptions): Promise<void> {
  const brand = brandOf(document_, options);
  const { widthMm, heightMm } = pageBox(brand.presentation);
  const doc = new jsPDF({
    orientation: brand.presentation.orientation === "landscape" ? "landscape" : "portrait",
    unit: "mm",
    format: [widthMm, heightMm],
    compress: true,
  });
  const at = new Date();
  const basis = basisOf(document_, brand);
  const blocks = [
    ...blocksFromSections(document_.sections),
    ...(basis ? basisBlocks(basis) : []),
  ];
  const ctx: PdfContext = {
    doc,
    brand,
    pageW: doc.internal.pageSize.getWidth(),
    pageH: doc.internal.pageSize.getHeight(),
    left: DOC_MARGIN.left,
    right: doc.internal.pageSize.getWidth() - DOC_MARGIN.right,
    top: DOC_MARGIN.top,
    bottom: DOC_MARGIN.bottom,
    contentW: contentWidthMm(brand.presentation),
    y: DOC_MARGIN.top,
    title: document_.title,
    runningHead: [document_.title, document_.client].filter(Boolean).join(" · "),
    footerLeft: footerLeftOf(brand, at, document_.generatedBy),
  };
  await pdfLetterhead(ctx, document_.title, metaLineOf(document_, brand, at, basis?.asOf));
  for (const block of blocks) pdfBlock(ctx, block);
  pdfFooters(ctx);
  doc.save(`${fileBase(document_.title)}.pdf`);
}

/**
 * The printable version of a generated document — the same document as the PDF, in HTML and paginated.
 *
 * It is a real document rather than `window.print()` on the screen, because printing the screen printed
 * the sidebar and the header with it. Paper and orientation are the document's own (`@page` says so, and
 * every sheet is that size to the millimetre), the tables repeat their header through `thead`, and the
 * page numbers are counted by the paginator in `documentLanguage.ts` rather than left to the browser.
 */
export function documentToPrintWindow(document_: ReportDocument, options?: ExportOptions): Window | null {
  const brand = brandOf(document_, options);
  const at = new Date();
  const basis = basisOf(document_, brand);
  const blocks = [
    ...blocksFromSections(document_.sections),
    ...(basis ? basisBlocks(basis) : []),
  ];
  return openPrintWindow({
    brand,
    blocks,
    title: document_.title,
    metaLine: metaLineOf(document_, brand, at, basis?.asOf),
    runningHead: [document_.title, document_.client].filter(Boolean).join(" · "),
    footerLeft: footerLeftOf(brand, at, document_.generatedBy),
    autoPrint: false,
  });
}

// ── Print ───────────────────────────────────────────────────────────

/**
 * The printable report. It is a real document rather than `window.print()` on the console, because
 * printing the application printed the sidebar, the header and whatever else was on screen — which
 * is what the Print button used to do.
 *
 * The window prints itself once its sheets exist, so nothing is printed before the pages have been
 * counted and the mark has loaded.
 */
export function printReport(document_: ReportDocument, options?: ExportOptions): void {
  const brand = brandOf(document_, options);
  const at = new Date();
  const basis = basisOf(document_, brand);
  const blocks = [
    ...blocksFromSections(document_.sections),
    ...(basis ? basisBlocks(basis) : []),
  ];
  openPrintWindow({
    brand,
    blocks,
    title: document_.title,
    metaLine: metaLineOf(document_, brand, at, basis?.asOf),
    runningHead: [document_.title, document_.client].filter(Boolean).join(" · "),
    footerLeft: footerLeftOf(brand, at, document_.generatedBy),
    autoPrint: true,
  });
}

// ── PDF ─────────────────────────────────────────────────────────────

export function exportPdf(document_: ReportDocument, options?: ExportOptions): void {
  // The mark is an image, so the document is drawn once it has one; the caller does not wait for a
  // download it did not ask to manage.
  void documentToPdf(document_, options);
}

// ── CSV ─────────────────────────────────────────────────────────────

/**
 * Every table, stacked in one file, with the basis block as the **topmost paragraph** — a spreadsheet
 * has no pages, so "the last sheet" is not a place it can be.
 */
export function exportCsv(
  document_: ReportDocument,
  download: (filename: string, csv: string) => void,
  options?: ExportOptions,
): void {
  const brand = brandOf(document_, options);
  const basis = basisOf(document_, brand);
  const preamble: string[] = [];
  if (basis) {
    preamble.push("How this is measured, and what it cannot say");
    if (basis.asOf) preamble.push(`Every figure in this file is as at ${basis.asOf}.`);
    for (const measure of basis.measures) preamble.push(`${measure.label}: ${measure.value}`);
    if (basis.notes.length) {
      preamble.push("What this cannot say:");
      for (const note of basis.notes) preamble.push(`  ${note}`);
    }
  }
  download(`${fileBase(document_.title)}.csv`, tablesToCsv(sectionsToTables(document_.sections), preamble));
}

// ── Excel ───────────────────────────────────────────────────────────

/** One sheet per table, typed cells, and a Basis sheet when the basis block travels with the file. */
export function exportExcel(document_: ReportDocument, options?: ExportOptions): void {
  const brand = brandOf(document_, options);
  const basis = basisOf(document_, brand);
  const tables = sectionsToTables(document_.sections);
  if (basis) {
    tables.push({
      title: "Basis",
      columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }],
      rows: basisRows(basis),
    });
  }
  tablesToExcel(tables, document_.title, document_.subtitle, document_.period);
}
