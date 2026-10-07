/**
 * Print, PDF, Excel and CSV for a designed report (PLAN-020).
 *
 * Everything here reads a **laid-out report** — the engine's pages, bands and placed lines — rather
 * than the document, so the print window and the PDF draw the same numbers the preview does. Excel and
 * CSV read the bands' *rows* instead, because a spreadsheet of absolutely positioned text boxes would
 * be useless: one row per data band, with the group each row belongs to.
 *
 * The PDF is drawn by jsPDF in millimetres from the layout's own coordinates, with no HTML rendering
 * and no headless browser. That is also why the PDF's page breaks are the preview's page breaks: they
 * were decided once, by the engine.
 */
import jsPDF from "jspdf";
import {
  labelFor,
  type LaidOutBand, type LaidOutChart, type LaidOutElement, type LaidOutReport,
  type ReportTemplateDocument, type TemplateElement,
} from "@C7NTAX/shared";
import {
  reportFileBase, tablesToCsv, tablesToExcel, tablesToPrintWindow, type FlatTable,
} from "../components/reports/reportKit";
import { FONT_STACKS, pdfFont } from "./reportMeasure";
import { chartSvg } from "./reportChartSvg";

export interface BandedOutputMeta {
  title: string;
  subtitle?: string;
  period?: string;
}

/** A band's colour when it is drawn as a document rather than as a table. */
export const BAND_BACKGROUNDS: Record<string, string> = {
  pageHeader: "#f8fafc",
  reportTitle: "#eef2f7",
  columnHeader: "#f1f5f9",
  groupHeader: "#ecfeff",
  detail: "#ffffff",
  groupFooter: "#f0fdfa",
  columnFooter: "#f8fafc",
  pageFooter: "#f8fafc",
  reportSummary: "#fefce8",
};

const isTransparent = (colour: string | null | undefined): boolean =>
  !colour || colour === "transparent" || colour === "none";

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "").trim();
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) return [17, 24, 39];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** A field's or total's name as a column heading. */
export function elementLabel(element: TemplateElement): string {
  if (element.type === "field") return labelFor(element.expression.replace(/^Fields\./i, "").split(".").pop() ?? element.expression);
  if (element.type === "aggregate") {
    const target = element.expression.replace(/^Fields\./i, "").split(".").pop() ?? element.expression;
    const verb: Record<string, string> = { SUM: "Total", AVG: "Average", MIN: "Lowest", MAX: "Highest", COUNT: "Count", COUNTD: "Distinct count" };
    return `${verb[element.fn] ?? element.fn} of ${labelFor(target)}`;
  }
  if (element.type === "text") return element.text.replace(/\{\{[\s\S]*?\}\}/g, "").replace(/\s+/g, " ").trim();
  return "";
}

// ── Print ───────────────────────────────────────────────────────────

/**
 * The report as a print document, page by page, at its real size in millimetres — so the browser's own
 * pagination has nothing left to decide and the printed pages match the designed ones.
 */
export function printTemplateReport(laid: LaidOutReport, meta: BandedOutputMeta): void {
  const window_ = window.open("", "_blank", "width=1100,height=800");
  if (!window_) return;

  const pages = laid.pages.map(page => `
    <section class="page">
      ${page.bands.map(band => bandHtml(band)).join("")}
    </section>`).join("");

  window_.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .page{position:relative;background:#fff;margin:16px auto;box-shadow:0 2px 8px rgba(15,23,42,.18);overflow:hidden;
        width:${laid.page.width}mm;height:${laid.page.height}mm}
  .el{position:absolute;overflow:hidden}
  .ln{position:absolute}
  @page{size:${laid.page.width}mm ${laid.page.height}mm;margin:0}
  @media print{body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}}
</style></head><body>${pages || "<p>This report produced no pages.</p>"}
<script>setTimeout(function(){window.print();},450);</script>
</body></html>`);
  window_.document.close();
  window_.focus();
}

function bandHtml(band: LaidOutBand): string {
  return band.elements.map(element => {
    const style = element.payload.style;
    const border = style.border && !isTransparent(style.border.color) ? `${style.border.width}mm solid ${style.border.color}` : "none";
    const background = isTransparent(style.background) ? "transparent" : style.background;
    const box = `left:${element.x}mm;top:${element.y}mm;width:${element.w}mm;height:${element.h}mm;border:${border};background:${background}`;

    if (element.payload.kind === "line") {
      const colour = style.border?.color ?? "#94a3b8";
      const width = style.border?.width ?? 0.3;
      return `<div class="ln" style="left:${element.x}mm;top:${element.y}mm;width:${element.w}mm;height:${width}mm;background:${colour}"></div>`;
    }
    if (element.payload.kind === "box") return `<div class="el" style="${box}"></div>`;
    // The chart's SVG is placed in a wrapper at the element's own millimetres, exactly as on screen.
    if (element.payload.kind === "chart") {
      return `<div class="el" style="left:${element.x}mm;top:${element.y}mm;width:${element.w}mm;height:${element.h}mm;border:none;background:transparent">${chartSvg(element.payload.chart, { origin: "box" })}</div>`;
    }
    if (element.payload.kind === "image") {
      return element.payload.src
        ? `<div class="el" style="${box}"><img src="${escapeHtml(element.payload.src)}" style="width:100%;height:100%;object-fit:contain" alt=""/></div>`
        : "";
    }
    const text = element.payload.lines.map(line =>
      `<span style="position:absolute;white-space:pre;left:${line.x - element.x}mm;top:${line.y - element.y}mm">${escapeHtml(line.text)}</span>`).join("");
    return `<div class="el" style="${box};font-family:${FONT_STACKS[style.fontFamily].css};font-size:${style.fontSize}pt;
      font-weight:${style.bold ? 700 : 400};font-style:${style.italic ? "italic" : "normal"};
      text-decoration:${style.underline ? "underline" : "none"};color:${style.color};line-height:1.2">${text}</div>`;
  }).join("");
}

// ── PDF ─────────────────────────────────────────────────────────────

/** A point on a pie: radians clockwise from twelve o'clock, matching the engine's own measurement. */
const chartPolar = (cx: number, cy: number, r: number, angle: number): [number, number] =>
  [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];

/**
 * Draws a chart with jsPDF's own primitives, reading the layout's millimetres. A pie's curved edge is
 * built from triangles between the centre and successive points on the arc, which is how a vector pie
 * is drawn without a path API — at forty-eight steps a slice is indistinguishable from a curve.
 */
function drawChart(doc: jsPDF, chart: LaidOutChart): void {
  const fill = (colour: string) => { const [r, g, b] = hexToRgb(colour); doc.setFillColor(r, g, b); };
  const stroke = (colour: string) => { const [r, g, b] = hexToRgb(colour); doc.setDrawColor(r, g, b); };

  for (const grid of chart.gridLines) {
    stroke(grid.colour);
    doc.setLineWidth(0.15);
    doc.line(grid.x1, grid.y1, grid.x2, grid.y2);
  }
  for (const bar of chart.bars) {
    fill(bar.colour);
    doc.rect(bar.x, bar.y, bar.w, bar.h, "F");
  }
  for (const axis of chart.axis) {
    stroke("#64748b");
    doc.setLineWidth(0.2);
    doc.line(axis.x1, axis.y1, axis.x2, axis.y2);
  }

  if (chart.slices.length) {
    const { x: cx, y: cy, r, innerR } = chart.centre;
    for (const slice of chart.slices) {
      fill(slice.colour);
      const sweep = Math.max(0, slice.endAngle - slice.startAngle);
      const steps = Math.max(1, Math.ceil((sweep / (Math.PI * 2)) * 48));
      for (let step = 0; step < steps; step++) {
        const from = slice.startAngle + (sweep * step) / steps;
        const to = slice.startAngle + (sweep * (step + 1)) / steps;
        const [x1, y1] = chartPolar(cx, cy, r, from);
        const [x2, y2] = chartPolar(cx, cy, r, to);
        if (innerR > 0) {
          const [ix1, iy1] = chartPolar(cx, cy, innerR, from);
          const [ix2, iy2] = chartPolar(cx, cy, innerR, to);
          doc.triangle(x1, y1, x2, y2, ix1, iy1, "F");
          doc.triangle(x2, y2, ix2, iy2, ix1, iy1, "F");
        } else {
          doc.triangle(x1, y1, x2, y2, cx, cy, "F");
        }
      }
    }
  }

  if (chart.points.length > 1) {
    stroke("#0f766e");
    doc.setLineWidth(0.5);
    for (let index = 1; index < chart.points.length; index++) {
      const previous = chart.points[index - 1]!;
      const point = chart.points[index]!;
      doc.line(previous.x, previous.y, point.x, point.y);
    }
  }
  for (const point of chart.points) {
    fill("#0f766e");
    doc.circle(point.x, point.y, 0.6, "F");
  }
  for (const swatch of chart.legendSwatches) {
    fill(swatch.colour);
    doc.rect(swatch.x, swatch.y, swatch.w, swatch.h, "F");
  }

  for (const label of chart.labels) {
    const { font, style: fontStyle } = pdfFont({ fontFamily: label.fontFamily, fontSize: label.fontSize, bold: label.bold, italic: false });
    doc.setFont(font, fontStyle);
    doc.setFontSize(label.fontSize);
    const [r, g, b] = hexToRgb(label.colour);
    doc.setTextColor(r, g, b);
    if (label.text) doc.text(label.text, label.x, label.baselineY, { baseline: "alphabetic" });
  }
}

/**
 * The PDF, drawn from the layout's own coordinates. jsPDF is given the document's page size in
 * millimetres, so one drawing unit is one millimetre and a placed line needs no conversion at all.
 */
export function exportTemplatePdf(laid: LaidOutReport, meta: BandedOutputMeta): void {
  if (!laid.pages.length) return;
  const landscape = laid.page.width > laid.page.height;
  const orientation = landscape ? "landscape" : "portrait";
  const doc = new jsPDF({ unit: "mm", format: [laid.page.width, laid.page.height], orientation });

  laid.pages.forEach((page, index) => {
    if (index) doc.addPage([laid.page.width, laid.page.height], orientation);
    for (const band of page.bands) {
      for (const element of band.elements) {
        const style = element.payload.style;

        if (element.payload.kind === "line") {
          const width = style.border?.width ?? 0.3;
          const [r, g, b] = hexToRgb(style.border?.color ?? "#94a3b8");
          doc.setDrawColor(r, g, b);
          doc.setLineWidth(width);
          doc.line(element.x, element.y + width / 2, element.x + element.w, element.y + width / 2);
          continue;
        }

        // A chart is drawn from the same millimetres the screen draws, with jsPDF's own primitives —
        // rectangles, lines, triangles and text — so no SVG rasterising step is needed and the printed
        // chart stays vector-crisp at any zoom.
        if (element.payload.kind === "chart") {
          drawChart(doc, element.payload.chart);
          continue;
        }

        if (!isTransparent(style.background)) {
          const [r, g, b] = hexToRgb(style.background!);
          doc.setFillColor(r, g, b);
          doc.rect(element.x, element.y, element.w, element.h, "F");
        }
        if (style.border && !isTransparent(style.border.color)) {
          const [r, g, b] = hexToRgb(style.border.color);
          doc.setDrawColor(r, g, b);
          doc.setLineWidth(style.border.width);
          doc.rect(element.x, element.y, element.w, element.h, "S");
        }

        if (element.payload.kind !== "text") continue;
        const { font, style: fontStyle } = pdfFont({
          fontFamily: style.fontFamily, fontSize: style.fontSize, bold: style.bold, italic: style.italic,
        });
        doc.setFont(font, fontStyle);
        doc.setFontSize(style.fontSize);
        const [r, g, b] = hexToRgb(style.color);
        doc.setTextColor(r, g, b);
        for (const line of element.payload.lines) {
          if (!line.text) continue;
          doc.text(line.text, line.x, line.baselineY, { baseline: "alphabetic" });
        }
      }
    }
  });

  doc.save(`${reportFileBase(meta.title)}.pdf`);
}

// ── Excel and CSV ───────────────────────────────────────────────────

const textOf = (element: LaidOutElement | undefined): string => {
  if (!element || element.payload.kind !== "text") return "";
  return element.payload.lines.map(line => line.text).join(" ").trim();
};

/**
 * A designed report as plain tables. One row per **data band** — the rows the design actually prints —
 * carrying the group each row belongs to, which the design's own detail band does not repeat.
 */
export function bandsToTables(laid: LaidOutReport, document: ReportTemplateDocument): FlatTable[] {
  const typeOf = new Map<string, TemplateElement["type"]>();
  const labelOf = new Map<string, string>();
  for (const band of document.bands) {
    for (const element of band.elements) {
      typeOf.set(element.id, element.type);
      labelOf.set(element.id, elementLabel(element));
    }
  }

  const detailSource = document.bands.find(band => band.kind === "detail");
  const detailColumns = (detailSource?.elements ?? [])
    .filter(element => element.type === "field")
    .map(element => ({ key: element.id, label: labelOf.get(element.id) || element.id }));
  const hasGroups = document.groups.length > 0;

  const rows: Array<Record<string, unknown>> = [];
  const totals: Array<Record<string, unknown>> = [];
  let groupValue = "";
  for (const page of laid.pages) {
    for (const band of page.bands) {
      // A sub-report's bands are its own design printed inside this one; its rows belong to it, not to
      // this table, and mapping them onto the parent's columns would only produce blanks.
      if (band.section) continue;
      if (band.kind === "groupHeader") { groupValue = band.groupValue ?? ""; continue; }
      if (band.kind === "detail") {
        const row: Record<string, unknown> = {};
        if (hasGroups) row.group = groupValue;
        for (const element of band.elements) if (typeOf.get(element.id) === "field") row[element.id] = textOf(element);
        rows.push(row);
      }
      if (band.kind === "groupFooter" || band.kind === "reportSummary") {
        for (const element of band.elements) {
          if (typeOf.get(element.id) !== "aggregate") continue;
          totals.push({
            scope: band.kind === "groupFooter" ? `Group: ${groupValue || "—"}` : "Whole report",
            label: labelOf.get(element.id) || "Total",
            value: textOf(element),
          });
        }
      }
    }
  }

  const tables: FlatTable[] = [];
  if (rows.length) {
    tables.push({
      title: "Rows",
      columns: [...(hasGroups ? [{ key: "group", label: "Group" }] : []), ...detailColumns],
      rows,
    });
  }
  if (totals.length) {
    tables.push({
      title: "Totals",
      columns: [{ key: "scope", label: "Scope" }, { key: "label", label: "Total" }, { key: "value", label: "Value" }],
      rows: totals,
    });
  }
  tables.push({
    title: "Report",
    columns: [{ key: "fact", label: "Fact" }, { key: "value", label: "Value" }],
    rows: [
      { fact: "Report", value: document.name },
      { fact: "Pages", value: laid.pages.length },
      { fact: "Rows on the report", value: laid.rowCount },
      { fact: "Groups", value: laid.groupCount },
      ...document.parameters.map(parameter => ({ fact: `Parameter: ${parameter.label || parameter.key}`, value: String(laid.parameters[parameter.key] ?? "") })),
      { fact: "Generated", value: new Date().toLocaleString() },
    ],
  });
  return tables;
}

export function exportTemplateExcel(laid: LaidOutReport, document: ReportTemplateDocument, meta: BandedOutputMeta): void {
  tablesToExcel(bandsToTables(laid, document), meta.title, meta.subtitle, meta.period);
}

export function exportTemplateCsv(
  laid: LaidOutReport, document: ReportTemplateDocument, meta: BandedOutputMeta,
  download: (filename: string, csv: string) => void,
): void {
  download(`${reportFileBase(meta.title)}.csv`, tablesToCsv(bandsToTables(laid, document)));
}

export function printTemplateTables(laid: LaidOutReport, document: ReportTemplateDocument, meta: BandedOutputMeta): void {
  const window_ = tablesToPrintWindow(bandsToTables(laid, document), meta.title, meta.subtitle, meta.period);
  if (window_) setTimeout(() => window_.print(), 400);
}
