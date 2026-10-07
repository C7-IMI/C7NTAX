/**
 * The banded report template document (PLAN-020).
 *
 * This is the compatibility surface: a template is a JSON document that describes page setup, the
 * data it binds to, its parameters and groups, and a list of **bands** holding absolutely-positioned
 * **elements**. The band set is FastReport's, the shape is JasperReports', and the reasoning is in
 * `PlanDocs/PLAN-020-Custom-Report-Designer.md` §4 — this file is that section written down as code.
 *
 * Two rules matter more than the rest:
 *
 *  1. **A document is validated on write and re-validated on render.** A stored document is not
 *     trusted because it was stored once. `validateTemplate` is the only thing that decides whether a
 *     template may be saved or run, and it is run from both sides.
 *  2. **Coordinates are in the page's own unit** (millimetres), so the screen, the print window and
 *     the PDF all place an element from the same number. Nothing here measures pixels.
 *
 * Everything in this file is data and pure functions — no DOM, no database, no React — so the API, the
 * browser and the probe suite all read the same rules.
 */
import type { ValueFormat } from "./reportFormat";
import { AGGREGATE_FUNCTIONS, AGGREGATE_SCOPES, FUNCTIONS, NAMESPACES, parseExpression, parseTextSegments, collectCalls, collectPaths, type AggregateScope } from "./reportExpression";

export const DOCUMENT_VERSION = 1 as const;

// ── Page setup ──────────────────────────────────────────────────────

export type PageUnit = "mm";
export type PageOrientation = "portrait" | "landscape";
export type PageSizeKey = "a4" | "letter" | "legal" | "a3" | "a5" | "custom";

export interface PageSize { key: PageSizeKey; label: string; width: number; height: number }

/** Widths and heights in millimetres, portrait. */
export const PAGE_SIZES: PageSize[] = [
  { key: "a4", label: "A4", width: 210, height: 297 },
  { key: "letter", label: "Letter", width: 215.9, height: 279.4 },
  { key: "legal", label: "Legal", width: 215.9, height: 355.6 },
  { key: "a3", label: "A3", width: 297, height: 420 },
  { key: "a5", label: "A5", width: 148, height: 210 },
  { key: "custom", label: "Custom", width: 210, height: 297 },
];

export interface PageMargins { top: number; right: number; bottom: number; left: number }

export interface PageSetup {
  size: PageSizeKey;
  orientation: PageOrientation;
  /** Only read when `size` is `custom`. */
  width: number;
  height: number;
  margins: PageMargins;
}

/** The millimetres-per-pixel of a screen at 96 dpi — the one place the unit is converted. */
export const MM_PER_PX = 25.4 / 96;
export const pxToMm = (px: number): number => px * MM_PER_PX;
export const mmToPx = (mm: number): number => mm / MM_PER_PX;

export function pageDimensions(page: PageSetup): { width: number; height: number } {
  const preset = PAGE_SIZES.find(p => p.key === page.size) ?? PAGE_SIZES[0]!;
  const width = page.size === "custom" ? page.width : preset.width;
  const height = page.size === "custom" ? page.height : preset.height;
  return page.orientation === "landscape" ? { width: height, height: width } : { width, height };
}

export function contentBox(page: PageSetup): { width: number; height: number } {
  const { width, height } = pageDimensions(page);
  return {
    width: Math.max(10, width - page.margins.left - page.margins.right),
    height: Math.max(10, height - page.margins.top - page.margins.bottom),
  };
}

// ── Data binding ────────────────────────────────────────────────────

export type ReportSourceKey = "tickets" | "invoices" | "time_entries" | "expenses" | "assets" | "contacts" | "companies";

export interface TemplateFilter {
  field: string;
  op: string;
  value?: unknown;
  /** When set, the value comes from a report parameter rather than the document. */
  parameterKey?: string;
}

export interface TemplateDataSource {
  key: string;
  label?: string;
  source: ReportSourceKey;
  filters: TemplateFilter[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit: number;
}

export type ParameterType = "text" | "number" | "date" | "boolean" | "select";

export interface TemplateParameter {
  key: string;
  label: string;
  type: ParameterType;
  required: boolean;
  defaultValue?: string;
  options?: string[];
}

export interface TemplateGroup {
  key: string;
  label?: string;
  expression: string;
  sort: "asc" | "desc" | "none";
  /** Move the whole group to the next page rather than splitting it across two. */
  keepTogether: boolean;
}

// ── Bands and elements ──────────────────────────────────────────────

export type BandKind =
  | "reportTitle"
  | "pageHeader"
  | "columnHeader"
  | "groupHeader"
  | "detail"
  | "groupFooter"
  | "columnFooter"
  | "pageFooter"
  | "reportSummary";

export interface BandKindSpec {
  kind: BandKind;
  label: string;
  help: string;
  /** At most one of these per report. */
  singleton: boolean;
  /** `groupHeader` and `groupFooter` need a group; every other kind must not have one. */
  needsGroup: boolean;
  /** Printed on every page when the report runs to more than one. */
  repeats: boolean;
}

export const BAND_KINDS: BandKindSpec[] = [
  { kind: "reportTitle", label: "Report Title", help: "Once, at the top of the first page.", singleton: true, needsGroup: false, repeats: false },
  { kind: "pageHeader", label: "Page Header", help: "At the top of every page.", singleton: true, needsGroup: false, repeats: true },
  { kind: "columnHeader", label: "Column Header", help: "Below the page header, on every page — the column captions.", singleton: true, needsGroup: false, repeats: true },
  { kind: "groupHeader", label: "Group Header", help: "Starts each group. One per group you define.", singleton: false, needsGroup: true, repeats: false },
  { kind: "detail", label: "Data", help: "Repeated once for every row.", singleton: true, needsGroup: false, repeats: false },
  { kind: "groupFooter", label: "Group Footer", help: "Ends each group — where a group's totals go.", singleton: false, needsGroup: true, repeats: false },
  { kind: "columnFooter", label: "Column Footer", help: "Below the rows, on every page.", singleton: true, needsGroup: false, repeats: true },
  { kind: "pageFooter", label: "Page Footer", help: "The bottom of every page — page numbers live here.", singleton: true, needsGroup: false, repeats: true },
  { kind: "reportSummary", label: "Report Summary", help: "Once, after the last row — grand totals.", singleton: true, needsGroup: false, repeats: false },
];

export const BAND_BY_KIND = new Map(BAND_KINDS.map(b => [b.kind, b]));

/** The order bands occupy a page. A page header is printed above the report title, as it is in
 *  Crystal Reports and FastReport, so the report title belongs to the report rather than the page. */
export const BAND_PRINT_ORDER: BandKind[] = [
  "pageHeader", "reportTitle", "columnHeader", "groupHeader", "detail", "groupFooter", "reportSummary", "columnFooter", "pageFooter",
];

export type ElementType = "text" | "field" | "aggregate" | "line" | "box" | "image";

export const ELEMENT_TYPES: Array<{ type: ElementType; label: string; help: string }> = [
  { type: "text", label: "Text", help: "A caption. Write {{Fields.x}} inside it to include a value." },
  { type: "field", label: "Field", help: "One value from the row, or an expression." },
  { type: "aggregate", label: "Total", help: "A sum, average, count, minimum or maximum over a scope." },
  { type: "line", label: "Line", help: "A rule, for separating bands." },
  { type: "box", label: "Box", help: "A rectangle or a filled panel." },
  { type: "image", label: "Image", help: "A built-in brand asset, or a URL an expression returns." },
];

export type FontFamily = "sans" | "serif" | "mono";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface ElementStyle {
  fontFamily: FontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: HAlign;
  valign: VAlign;
  /** null means transparent. */
  background: string | null;
  border: { width: number; color: string } | null;
  padding: number;
}

export interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextElement extends ElementBase { type: "text"; text: string; style: ElementStyle }
export interface FieldElement extends ElementBase { type: "field"; expression: string; format: ValueFormat; style: ElementStyle }
export interface AggregateElement extends ElementBase {
  type: "aggregate";
  fn: (typeof AGGREGATE_FUNCTIONS)[number];
  expression: string;
  scope: AggregateScope;
  format: ValueFormat;
  style: ElementStyle;
}
export interface ShapeElement extends ElementBase { type: "line" | "box"; style: ElementStyle }
export interface ImageElement extends ElementBase { type: "image"; src: string; style: ElementStyle }

export type TemplateElement = TextElement | FieldElement | AggregateElement | ShapeElement | ImageElement;

export interface TemplateBand {
  id: string;
  kind: BandKind;
  /** Which group this band belongs to. Only read for group headers and footers. */
  groupKey?: string;
  height: number;
  /** Print this band again at the top of each new page (page and column headers do this regardless). */
  repeatOnNewPage: boolean;
  /** Start a new page when this band is reached. */
  pageBreakBefore: boolean;
  elements: TemplateElement[];
}

export interface ReportTemplateDocument {
  version: typeof DOCUMENT_VERSION;
  name: string;
  description?: string;
  page: PageSetup;
  dataSources: TemplateDataSource[];
  parameters: TemplateParameter[];
  groups: TemplateGroup[];
  bands: TemplateBand[];
}

// ── Defaults and factories ──────────────────────────────────────────

export const DEFAULT_STYLE: ElementStyle = {
  fontFamily: "sans",
  fontSize: 9,
  bold: false,
  italic: false,
  underline: false,
  color: "#111827",
  align: "left",
  valign: "middle",
  background: null,
  border: null,
  padding: 1,
};

export const DEFAULT_PAGE: PageSetup = {
  size: "a4",
  orientation: "portrait",
  width: 210,
  height: 297,
  margins: { top: 12, right: 12, bottom: 12, left: 12 },
};

let idCounter = 0;
/** Ids only need to be unique inside one document, and be stable across an edit session. */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function createBand(kind: BandKind, overrides: Partial<TemplateBand> = {}): TemplateBand {
  const spec = BAND_BY_KIND.get(kind);
  const heights: Record<BandKind, number> = {
    reportTitle: 18, pageHeader: 12, columnHeader: 7, groupHeader: 8, detail: 6, groupFooter: 8, columnFooter: 6, pageFooter: 8, reportSummary: 14,
  };
  return {
    id: newId("band"),
    kind,
    height: heights[kind],
    repeatOnNewPage: spec?.repeats ?? false,
    pageBreakBefore: false,
    elements: [],
    ...overrides,
  };
}

export function createElement(type: ElementType, overrides: Partial<TemplateElement> = {}): TemplateElement {
  const base = { id: newId("el"), x: 0, y: 0, w: 40, h: 5 };
  const style = { ...DEFAULT_STYLE };
  switch (type) {
    case "text": return { ...base, type: "text", text: "Text", style, ...overrides } as TextElement;
    case "field": return { ...base, type: "field", expression: "Fields.client", format: "text", style, ...overrides } as FieldElement;
    case "aggregate": return { ...base, type: "aggregate", fn: "SUM", expression: "", scope: "report", format: "number", style: { ...style, align: "right" as HAlign, bold: true }, ...overrides } as AggregateElement;
    case "line": return { ...base, y: 0, h: 0.4, w: 186, type: "line", style: { ...style, border: { width: 0.3, color: "#94a3b8" } }, ...overrides } as ShapeElement;
    case "box": return { ...base, w: 60, h: 12, type: "box", style: { ...style, border: { width: 0.3, color: "#cbd5e1" }, background: "#f8fafc" }, ...overrides } as ShapeElement;
    case "image": return { ...base, w: 30, h: 12, type: "image", src: "brand-mark", style, ...overrides } as ImageElement;
  }
}

/** The data source a fresh template starts with, using the first field the catalog offered. */
export function createDataSource(source: ReportSourceKey = "tickets"): TemplateDataSource {
  return { key: "main", label: "Main", source, filters: [], sortDir: "asc", limit: 500 };
}

export function createBlankDocument(name = "Untitled report", source: ReportSourceKey = "tickets"): ReportTemplateDocument {
  return {
    version: DOCUMENT_VERSION,
    name,
    page: { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } },
    dataSources: [createDataSource(source)],
    parameters: [],
    groups: [],
    bands: [createBand("pageHeader"), createBand("detail"), createBand("pageFooter")],
  };
}

// ── Starter documents ───────────────────────────────────────────────

export interface CatalogField { key: string; label: string; type: string }
export interface CatalogSource { key: string; label: string; fields: CatalogField[] }

export type StarterKind = "blank" | "list" | "groupedTotals" | "clientSummary";

export const STARTERS: Array<{ kind: StarterKind; label: string; help: string }> = [
  { kind: "blank", label: "Blank page", help: "Page header, one row per record, page footer. Nothing else assumed." },
  { kind: "list", label: "Simple list", help: "A column header band and one row per record, with a page count." },
  { kind: "groupedTotals", label: "Grouped list with totals", help: "Groups on one field, a group header and footer, and a count plus a total per group." },
  { kind: "clientSummary", label: "Summary with grand totals", help: "Grouped rows, a group total, and a report summary with a grand total." },
];

interface SourceShape {
  source: CatalogSource;
  groupField: CatalogField | null;
  amountField: CatalogField | null;
  dateField: CatalogField | null;
  textFields: CatalogField[];
  idField: CatalogField | null;
}

/** Picks the fields a starter needs out of whatever the catalog offered for the chosen source. */
function shapeOf(source: CatalogSource): SourceShape {
  const usable = source.fields.filter(f => f.key !== "id");
  const groupField =
    usable.find(f => ["status", "client", "type", "category", "workType", "industry"].includes(f.key) && f.type !== "number" && f.type !== "money") ??
    usable.find(f => f.type === "text") ?? null;
  const amountField = usable.find(f => f.type === "money") ?? usable.find(f => f.type === "minutes") ?? usable.find(f => f.type === "number") ?? null;
  const dateField = usable.find(f => f.type === "date") ?? null;
  const textFields = usable.filter(f => f !== groupField && f !== amountField && f !== dateField).slice(0, 4);
  return { source, groupField, amountField, dateField, textFields, idField: usable[0] ?? null };
}

function element(type: ElementType, value: string, x: number, y: number, w: number, h: number, style?: Partial<ElementStyle>, format?: ValueFormat): TemplateElement {
  const sharedStyle = { ...DEFAULT_STYLE, ...style };
  if (type === "text") return { id: newId("el"), type: "text", text: value, x, y, w, h, style: sharedStyle };
  if (type === "field") {
    return {
      id: newId("el"), type: "field", expression: value, format: format ?? "text", x, y, w, h,
      style: { ...sharedStyle, align: format === "money" || format === "number" || format === "minutes" ? "right" : sharedStyle.align },
    };
  }
  return createElement(type, { x, y, w, h, style: sharedStyle });
}

/** The format a catalogue field wants, so a starter's columns are laid out as the data reads. */
export function formatForField(field: { type: string }): ValueFormat {
  switch (field.type) {
    case "money": return "money";
    case "number": return "number";
    case "minutes": return "minutes";
    case "date": return "date";
    case "boolean": return "yesno";
    default: return "text";
  }
}

/** A starter document for one source. Fields are chosen from the catalog, never hardcoded, so a
 *  starter is always valid against the data it names. */
export function createStarter(kind: StarterKind, source: CatalogSource, name = "Untitled report"): ReportTemplateDocument {
  const shape = shapeOf(source);
  const document = createBlankDocument(name, source.key as ReportSourceKey);
  const width = contentBox(document.page).width;
  const group = shape.groupField;
  const amount = shape.amountField;
  const amountFormat: ValueFormat = amount?.type === "money" ? "money" : amount?.type === "minutes" ? "minutes" : "number";

  const title = element("text", `{{Report.name}}`, 0, 2, width - 60, 7, { fontSize: 14, bold: true });
  const generated = element("text", "{{FORMATDATE(NOW(), 'dd MMM yyyy HH:mm')}}", width - 60, 3, 60, 5, { fontSize: 8, color: "#64748b", align: "right" });
  const pageFooter = createBand("pageFooter");
  pageFooter.elements = [
    element("text", `${source.label} · generated {{FORMATDATE(NOW(), 'yyyy-MM-dd')}}`, 0, 1.5, width - 40, 5, { fontSize: 7.5, color: "#64748b" }),
    element("text", "Page {{Page.number}} of {{Page.totalPages}}", width - 40, 1.5, 40, 5, { fontSize: 7.5, color: "#64748b", align: "right" }),
    element("line", "", 0, 0, width, 0.4, { border: { width: 0.3, color: "#cbd5e1" } }),
  ];

  if (kind === "blank") {
    const header = createBand("pageHeader");
    header.elements = [title, generated];
    const detail = createBand("detail", { height: 6 });
    detail.elements = [
      element("field", `Fields.${shape.idField?.key ?? "id"}`, 0, 0, width * 0.5, 6, { fontSize: 9 }),
      element("field", `Fields.${shape.dateField?.key ?? shape.idField?.key ?? "id"}`, width * 0.5, 0, width * 0.5, 6, { fontSize: 9, align: "left" }, shape.dateField ? "date" : "text"),
    ];    document.bands = [header, detail, pageFooter];
    return document;
  }

  if (kind === "list") {
    const columns = shape.textFields.slice(0, 4);
    const header = createBand("pageHeader");
    header.elements = [title, generated];
    const columnHeader = createBand("columnHeader", { height: 7 });
    const detail = createBand("detail", { height: 6 });
    const share = width / Math.max(1, columns.length + 1);
    columns.forEach((field, index) => {
      columnHeader.elements.push(element("text", field.label, index * share, 0, share, 7, { bold: true, fontSize: 8, color: "#334155" }));
      // Each column is formatted for its own kind of value: a date field is a date, not an ISO string.
      detail.elements.push(element("field", `Fields.${field.key}`, index * share, 0, share, 6, { fontSize: 8.5 }, formatForField(field)));
    });
    if (amount) {
      columnHeader.elements.push(element("text", amount.label, columns.length * share, 0, share, 7, { bold: true, fontSize: 8, color: "#334155", align: "right" }));
      detail.elements.push(element("field", `Fields.${amount.key}`, columns.length * share, 0, share, 6, { fontSize: 8.5, align: "right" }, amountFormat));
    }
    columnHeader.elements.push(element("line", "", 0, 6.6, width, 0.4, { border: { width: 0.3, color: "#94a3b8" } }));
    document.bands = [header, columnHeader, detail, pageFooter];
    return document;
  }

  // Both remaining starters group the rows; the summary one adds a report-level total as well.
  const groupExpression = group ? `Fields.${group.key}` : `Fields.${shape.idField?.key ?? "id"}`;
  document.groups = [{ key: "group1", label: group?.label ?? "Group", expression: groupExpression, sort: "asc", keepTogether: true }];

  const groupHeader = createBand("groupHeader", { groupKey: "group1", height: 9 });
  groupHeader.elements = [
    element("text", `{{${groupExpression} }}`, 0, 1, width * 0.6, 6, { bold: true, fontSize: 10 }),
    element("text", "{{COUNT(Fields." + (shape.idField?.key ?? "id") + ", 'group')}} row(s)", width * 0.6, 1, width * 0.4, 6, { fontSize: 8, color: "#64748b", align: "right" }),
    element("line", "", 0, 8.4, width, 0.4, { border: { width: 0.4, color: "#22d3ee" } }),
  ];

  const columns = shape.textFields.slice(0, 3);
  const columnHeader = createBand("columnHeader", { height: 7 });
  const detail = createBand("detail", { height: 6 });
  const share = width / Math.max(1, columns.length + 1);
  columns.forEach((field, index) => {
    columnHeader.elements.push(element("text", field.label, index * share, 0, share, 7, { bold: true, fontSize: 8, color: "#334155" }));
    detail.elements.push(element("field", `Fields.${field.key}`, index * share, 0, share, 6, { fontSize: 8.5 }, formatForField(field)));
  });

  const footer = createBand("groupFooter", { groupKey: "group1", height: 8 });
  footer.elements = [element("line", "", 0, 0, width, 0.4, { border: { width: 0.3, color: "#cbd5e1" } })];
  if (amount) {
    columnHeader.elements.push(element("text", amount.label, columns.length * share, 0, share, 7, { bold: true, fontSize: 8, color: "#334155", align: "right" }));
    detail.elements.push(element("field", `Fields.${amount.key}`, columns.length * share, 0, share, 6, { fontSize: 8.5, align: "right" }, amountFormat));
    const total: AggregateElement = {
      id: newId("el"), type: "aggregate", fn: "SUM", expression: `Fields.${amount.key}`, scope: "group", format: amountFormat,
      x: columns.length * share, y: 1.5, w: share, h: 6,
      style: { ...DEFAULT_STYLE, bold: true, align: "right", fontSize: 9 },
    };
    footer.elements.push(total);
    footer.elements.push(element("text", `Group total`, columns.length * share - share, 1.5, share, 6, { fontSize: 8, color: "#64748b", align: "right" }));
  } else {
    footer.elements.push(element("text", "{{COUNT(Fields." + (shape.idField?.key ?? "id") + ", 'group')}} row(s)", 0, 1.5, width, 6, { fontSize: 8, color: "#64748b" }));
  }

  const header = createBand("pageHeader");
  header.elements = [title, generated];
  document.bands = [header, columnHeader, groupHeader, detail, footer];

  if (kind === "clientSummary") {
    const summary = createBand("reportSummary", { height: 12 });
    summary.elements = [element("line", "", 0, 0, width, 0.4, { border: { width: 0.5, color: "#0f172a" } })];
    if (amount) {
      summary.elements.push(element("text", "Grand total", width * 0.5, 2, width * 0.25, 6, { bold: true, fontSize: 10, align: "right" }));
      const grand: AggregateElement = {
        id: newId("el"), type: "aggregate", fn: "SUM", expression: `Fields.${amount.key}`, scope: "report", format: amountFormat,
        x: width * 0.75, y: 2, w: width * 0.25, h: 6,
        style: { ...DEFAULT_STYLE, bold: true, fontSize: 11, align: "right" },
      };
      summary.elements.push(grand);
    }
    summary.elements.push(element("text", "{{COUNT(Fields." + (shape.idField?.key ?? "id") + ")}} records in this report", 0, 2, width * 0.5, 6, { fontSize: 9, color: "#334155" }));
    document.bands.push(summary);
  }

  document.bands.push(pageFooter);
  return document;
}

// ── Normalisation ───────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const bool = (value: unknown, fallback = false): boolean => (typeof value === "boolean" ? value : fallback);

/**
 * Anything read out of the database or typed into the JSON editor goes through here first. The point
 * is that the rest of the system — validator, layout engine, designer — can assume every field
 * exists and is the right type, instead of every consumer guarding each read.
 */
export function normaliseDocument(input: unknown, fallbackName = "Untitled report"): ReportTemplateDocument {
  const raw = isRecord(input) ? input : {};
  const page = isRecord(raw.page) ? raw.page : {};
  const margins = isRecord(page.margins) ? page.margins : {};
  const size = PAGE_SIZES.some(p => p.key === page.size) ? (page.size as PageSizeKey) : "a4";
  const orientation: PageOrientation = page.orientation === "landscape" ? "landscape" : "portrait";

  const dataSources = Array.isArray(raw.dataSources)
    ? raw.dataSources.filter(isRecord).map((source): TemplateDataSource => ({
        key: str(source.key, "main") || "main",
        label: typeof source.label === "string" ? source.label : undefined,
        source: (str(source.source, "tickets") || "tickets") as ReportSourceKey,
        filters: (Array.isArray(source.filters) ? source.filters.filter(isRecord) : []).map((filter): TemplateFilter => ({
          field: str(filter.field),
          op: str(filter.op, "equals") || "equals",
          value: filter.value,
          parameterKey: typeof filter.parameterKey === "string" && filter.parameterKey ? filter.parameterKey : undefined,
        })),
        sortBy: typeof source.sortBy === "string" && source.sortBy ? source.sortBy : undefined,
        sortDir: source.sortDir === "desc" ? "desc" : "asc",
        limit: num(source.limit, 500),
      }))
    : [];

  const parameters = Array.isArray(raw.parameters)
    ? raw.parameters.filter(isRecord).map((parameter): TemplateParameter => ({
        key: str(parameter.key),
        label: str(parameter.label, str(parameter.key)),
        type: (["text", "number", "date", "boolean", "select"] as ParameterType[]).includes(parameter.type as ParameterType) ? (parameter.type as ParameterType) : "text",
        required: bool(parameter.required),
        defaultValue: typeof parameter.defaultValue === "string" ? parameter.defaultValue : undefined,
        options: Array.isArray(parameter.options) ? parameter.options.filter((o): o is string => typeof o === "string") : undefined,
      }))
    : [];

  const groups = Array.isArray(raw.groups)
    ? raw.groups.filter(isRecord).map((group): TemplateGroup => ({
        key: str(group.key),
        label: typeof group.label === "string" ? group.label : undefined,
        expression: str(group.expression),
        sort: group.sort === "desc" || group.sort === "none" ? group.sort : "asc",
        keepTogether: bool(group.keepTogether, true),
      }))
    : [];

  const bands = Array.isArray(raw.bands)
    ? raw.bands.filter(isRecord).map((band): TemplateBand => {
        const kind = (BAND_KINDS.some(b => b.kind === band.kind) ? band.kind : "detail") as BandKind;
        return {
          id: str(band.id) || newId("band"),
          kind,
          groupKey: typeof band.groupKey === "string" && band.groupKey ? band.groupKey : undefined,
          height: num(band.height, 8),
          repeatOnNewPage: bool(band.repeatOnNewPage, BAND_BY_KIND.get(kind)?.repeats ?? false),
          pageBreakBefore: bool(band.pageBreakBefore),
          elements: Array.isArray(band.elements) ? band.elements.filter(isRecord).map(normaliseElement) : [],
        };
      })
    : [];

  return {
    version: DOCUMENT_VERSION,
    name: str(raw.name, fallbackName) || fallbackName,
    description: typeof raw.description === "string" ? raw.description : undefined,
    page: {
      size, orientation,
      width: num(page.width, 210),
      height: num(page.height, 297),
      margins: { top: num(margins.top, 12), right: num(margins.right, 12), bottom: num(margins.bottom, 12), left: num(margins.left, 12) },
    },
    dataSources,
    parameters,
    groups,
    bands,
  };
}

function normaliseElement(input: Record<string, unknown>): TemplateElement {
  const type = (ELEMENT_TYPES.some(t => t.type === input.type) ? input.type : "text") as ElementType;
  const style = isRecord(input.style) ? input.style : {};
  const border = isRecord(style.border)
    ? { width: num(style.border.width, 0.3), color: str(style.border.color, "#94a3b8") }
    : null;
  const normalisedStyle: ElementStyle = {
    fontFamily: (["sans", "serif", "mono"] as FontFamily[]).includes(style.fontFamily as FontFamily) ? (style.fontFamily as FontFamily) : "sans",
    fontSize: num(style.fontSize, DEFAULT_STYLE.fontSize),
    bold: bool(style.bold),
    italic: bool(style.italic),
    underline: bool(style.underline),
    color: str(style.color, DEFAULT_STYLE.color),
    align: (["left", "center", "right"] as HAlign[]).includes(style.align as HAlign) ? (style.align as HAlign) : "left",
    valign: (["top", "middle", "bottom"] as VAlign[]).includes(style.valign as VAlign) ? (style.valign as VAlign) : "middle",
    background: typeof style.background === "string" && style.background ? style.background : null,
    border,
    padding: num(style.padding, DEFAULT_STYLE.padding),
  };
  const base = { id: str(input.id) || newId("el"), x: num(input.x, 0), y: num(input.y, 0), w: num(input.w, 30), h: num(input.h, 5) };
  const format = (["text", "number", "money", "percent", "minutes", "hours", "date", "yesno"] as ValueFormat[]).includes(input.format as ValueFormat)
    ? (input.format as ValueFormat) : "text";

  switch (type) {
    case "field": return { ...base, type, expression: str(input.expression), format, style: normalisedStyle };
    case "aggregate": return {
      ...base, type,
      fn: (AGGREGATE_FUNCTIONS.includes(input.fn as never) ? input.fn : "SUM") as AggregateElement["fn"],
      expression: str(input.expression),
      scope: (AGGREGATE_SCOPES.includes(input.scope as AggregateScope) ? input.scope : "report") as AggregateScope,
      format, style: normalisedStyle,
    };
    case "line": case "box": return { ...base, type, style: normalisedStyle };
    case "image": return { ...base, type, src: str(input.src, "brand-mark"), style: normalisedStyle };
    default: return { ...base, type: "text", text: str(input.text), style: normalisedStyle };
  }
}

// ── Validation ──────────────────────────────────────────────────────

export type IssueSeverity = "error" | "warning";

export interface TemplateIssue {
  severity: IssueSeverity;
  code: string;
  /** Where the problem is, in the document: `bands[2].elements[0].expression`. */
  path: string;
  message: string;
  bandId?: string;
  elementId?: string;
  groupKey?: string;
}

export interface ValidationOptions {
  /** The whitelisted sources and their fields. Without it, field names cannot be checked. */
  catalog?: { sources: CatalogSource[] };
}

const KEY_LIKE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The single gate a template passes through, on write and again on render. Errors block; warnings are
 * things a designer should look at but that will still print.
 */
export function validateTemplate(input: unknown, options: ValidationOptions = {}): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const rawVersion = isRecord(input) ? input.version : undefined;
  if (rawVersion !== undefined && rawVersion !== DOCUMENT_VERSION && Number(rawVersion) > DOCUMENT_VERSION) {
    issues.push({ severity: "error", code: "version", path: "version", message: `This template was written by a newer version of the designer (v${String(rawVersion)}); it cannot be read safely here.` });
  }

  const document = normaliseDocument(input);
  const { width: contentWidth, height: contentHeight } = contentBox(document.page);
  const page = pageDimensions(document.page);

  const add = (issue: TemplateIssue) => issues.push(issue);

  // Page setup
  const margins = document.page.margins;
  for (const side of ["top", "right", "bottom", "left"] as const) {
    if (margins[side] < 0) add({ severity: "error", code: "page.margin", path: `page.margins.${side}`, message: `The ${side} margin cannot be negative.` });
  }
  if (margins.left + margins.right >= page.width) add({ severity: "error", code: "page.margins", path: "page.margins", message: "The left and right margins leave no width to print in." });
  if (margins.top + margins.bottom >= page.height) add({ severity: "error", code: "page.margins", path: "page.margins", message: "The top and bottom margins leave no height to print in." });

  // Data sources
  if (!document.dataSources.length) {
    add({ severity: "error", code: "dataSource.missing", path: "dataSources", message: "A report needs a data source — without one there is nothing to list." });
  }
  if (document.dataSources.length > 1) {
    add({ severity: "warning", code: "dataSource.extra", path: "dataSources", message: "Only the first data source is bound to the bands; further sources are reserved for sub-reports." });
  }
  const primarySource = document.dataSources[0];
  const catalogSource = options.catalog?.sources.find(s => s.key === primarySource?.source);
  const fieldKeys = new Set((catalogSource?.fields ?? []).map(f => f.key));
  const fieldType = (key: string) => catalogSource?.fields.find(f => f.key === key)?.type;

  const sourceKeys = new Set(document.dataSources.map(s => s.key));
  document.dataSources.forEach((dataSource, index) => {
    const path = `dataSources[${index}]`;
    if (!KEY_LIKE.test(dataSource.key)) add({ severity: "error", code: "dataSource.key", path: `${path}.key`, message: `"${dataSource.key}" cannot be a data source name — use letters, digits and underscores.` });
    if (options.catalog && !options.catalog.sources.some(s => s.key === dataSource.source)) {
      add({ severity: "error", code: "dataSource.source", path: `${path}.source`, message: `"${dataSource.source}" is not a data source this product can report on.` });
    }
    if (!Number.isFinite(dataSource.limit) || dataSource.limit < 1 || dataSource.limit > 2000) {
      add({ severity: "error", code: "dataSource.limit", path: `${path}.limit`, message: "The row limit must be between 1 and 2,000." });
    }
    if (dataSource.sortBy && options.catalog && !fieldKeys.has(dataSource.sortBy)) {
      add({ severity: "error", code: "dataSource.sort", path: `${path}.sortBy`, message: `"${dataSource.sortBy}" is not a field of ${catalogSource?.label ?? dataSource.source}.` });
    }
    dataSource.filters.forEach((filter, filterIndex) => {
      const filterPath = `${path}.filters[${filterIndex}]`;
      if (options.catalog && !fieldKeys.has(filter.field)) {
        add({ severity: "error", code: "filter.field", path: `${filterPath}.field`, message: `"${filter.field}" is not a field of ${catalogSource?.label ?? dataSource.source} — it cannot be filtered on.` });
      }
      if (filter.parameterKey && !document.parameters.some(p => p.key === filter.parameterKey)) {
        add({ severity: "error", code: "filter.parameter", path: `${filterPath}.parameterKey`, message: `The filter uses the parameter "${filter.parameterKey}", which is not declared.` });
      }
      const nullOnly = filter.op === "isNull" || filter.op === "isNotNull";
      if (!nullOnly && !filter.parameterKey && (filter.value === undefined || filter.value === null || filter.value === "")) {
        add({ severity: "warning", code: "filter.value", path: `${filterPath}.value`, message: `The filter on "${filter.field}" has no value, so it will be ignored.` });
      }
      if (filter.op === "between" && !filter.parameterKey && !Array.isArray(filter.value)) {
        add({ severity: "error", code: "filter.between", path: `${filterPath}.value`, message: `"between" needs two values — give a list of two.` });
      }
    });
  });

  // Parameters
  const seenParameters = new Set<string>();
  document.parameters.forEach((parameter, index) => {
    const path = `parameters[${index}]`;
    if (!KEY_LIKE.test(parameter.key)) {
      add({ severity: "error", code: "parameter.key", path: `${path}.key`, message: `"${parameter.key}" cannot be a parameter name — use letters, digits and underscores.` });
    } else if (seenParameters.has(parameter.key)) {
      add({ severity: "error", code: "parameter.duplicate", path: `${path}.key`, message: `There are two parameters called "${parameter.key}".` });
    }
    seenParameters.add(parameter.key);
    if (parameter.type === "select" && !(parameter.options?.length)) {
      add({ severity: "warning", code: "parameter.options", path: `${path}.options`, message: `"${parameter.key}" is a list parameter with no options, so it can never be filled in.` });
    }
    if (parameter.required && parameter.defaultValue) {
      add({ severity: "warning", code: "parameter.required", path: `${path}.required`, message: `"${parameter.key}" is marked required and also has a default; the default will always be used.` });
    }
  });

  // Groups
  const seenGroups = new Set<string>();
  document.groups.forEach((group, index) => {
    const path = `groups[${index}]`;
    if (!KEY_LIKE.test(group.key)) {
      add({ severity: "error", code: "group.key", path: `${path}.key`, message: `"${group.key}" cannot be a group name — use letters, digits and underscores.` });
    } else if (seenGroups.has(group.key)) {
      add({ severity: "error", code: "group.duplicate", path: `${path}.key`, message: `There are two groups called "${group.key}".` });
    }
    seenGroups.add(group.key);
    if (!group.expression.trim()) {
      add({ severity: "error", code: "group.expression", path: `${path}.expression`, message: "A group needs an expression to group by." });
    } else {
      const { ast, error } = parseExpression(group.expression);
      if (!ast) {
        add({ severity: "error", code: "group.expression", path: `${path}.expression`, message: `The group expression could not be read: ${error}`, groupKey: group.key });
      } else {
        const paths = collectPaths(ast);
        const fields = paths.filter(p => (p.parts[0] ?? "").toLowerCase() === "fields");
        if (!fields.length) {
          add({ severity: "warning", code: "group.constant", path: `${path}.expression`, message: "This group expression does not read a field, so it will group every row together.", groupKey: group.key });
        } else {
          for (const reference of fields) {
            const fieldKey = reference.parts[1];
            if (fieldKey && options.catalog && !fieldKeys.has(fieldKey)) {
              add({ severity: "error", code: "group.field", path: `${path}.expression`, message: `"${fieldKey}" is not a field of ${catalogSource?.label ?? "this source"}, so it cannot be grouped on.`, groupKey: group.key });
            }
          }
        }
      }
    }
  });

  // Bands
  const bandIds = new Set<string>();
  const seenSingletons = new Map<BandKind, number>();
  const bandsByGroup = new Map<string, BandKind[]>();
  if (!document.bands.length) {
    add({ severity: "error", code: "bands.empty", path: "bands", message: "The report has no bands — add at least a Data band so there is something to print." });
  }

  document.bands.forEach((band, index) => {
    const path = `bands[${index}]`;
    const spec = BAND_BY_KIND.get(band.kind);
    if (!spec) {
      add({ severity: "error", code: "band.kind", path: `${path}.kind`, message: `"${band.kind}" is not a band this designer knows.`, bandId: band.id });
      return;
    }
    if (bandIds.has(band.id)) {
      add({ severity: "error", code: "band.id", path: `${path}.id`, message: "Two bands share an id, which makes one of them unselectable.", bandId: band.id });
    }
    bandIds.add(band.id);

    if (spec.needsGroup) {
      if (!band.groupKey) {
        add({ severity: "error", code: "band.groupKey", path: `${path}.groupKey`, message: `A ${spec.label.toLowerCase()} must say which group it belongs to.`, bandId: band.id });
      } else {
        if (!document.groups.some(g => g.key === band.groupKey)) {
          add({ severity: "error", code: "band.groupKey", path: `${path}.groupKey`, message: `This band belongs to the group "${band.groupKey}", which is not defined.`, bandId: band.id, groupKey: band.groupKey });
        }
        bandsByGroup.set(band.groupKey, [...(bandsByGroup.get(band.groupKey) ?? []), band.kind]);
      }
    } else if (band.groupKey) {
      add({ severity: "warning", code: "band.groupKey", path: `${path}.groupKey`, message: `A ${spec.label.toLowerCase()} is not part of a group, so its group is ignored.`, bandId: band.id });
    }

    if (spec.singleton) {
      const seen = (seenSingletons.get(band.kind) ?? 0) + 1;
      seenSingletons.set(band.kind, seen);
      if (seen > 1) {
        add({ severity: "error", code: "band.duplicate", path: `${path}.kind`, message: `A report can hold only one ${spec.label.toLowerCase()} band; this is the second.`, bandId: band.id });
      }
    }

    if (!Number.isFinite(band.height) || band.height <= 0) {
      add({ severity: "error", code: "band.height", path: `${path}.height`, message: "A band's height must be greater than zero.", bandId: band.id });
    } else if (band.height > contentHeight) {
      add({ severity: "error", code: "band.height", path: `${path}.height`, message: `This band is ${band.height.toFixed(1)}mm tall, which is taller than the ${contentHeight.toFixed(1)}mm a page has room for.`, bandId: band.id });
    }

    const elementIds = new Set<string>();
    band.elements.forEach((element, elementIndex) => {
      const elementPath = `${path}.elements[${elementIndex}]`;
      const context = { bandId: band.id, elementId: element.id };
      if (elementIds.has(element.id)) {
        add({ severity: "error", code: "element.id", path: `${elementPath}.id`, message: "Two elements in this band share an id.", ...context });
      }
      elementIds.add(element.id);

      for (const [key, value] of Object.entries({ x: element.x, y: element.y, w: element.w, h: element.h })) {
        if (!Number.isFinite(value)) {
          add({ severity: "error", code: "element.geometry", path: `${elementPath}.${key}`, message: `The element's ${key} is not a number.`, ...context });
        }
      }
      if (element.w <= 0 || element.h <= 0) {
        add({ severity: "error", code: "element.size", path: elementPath, message: "An element needs a width and a height greater than zero.", ...context });
      }
      if (element.x < 0) {
        add({ severity: "error", code: "element.offpage", path: `${elementPath}.x`, message: "An element cannot start to the left of the page.", ...context });
      }
      if (element.type !== "line" && element.y + element.h > band.height + 0.01) {
        add({ severity: "error", code: "element.overflow", path: elementPath, message: `This element is ${(element.y + element.h).toFixed(1)}mm down a ${band.height.toFixed(1)}mm band, so its bottom would be cut off.`, ...context });
      }
      if (element.x + element.w > contentWidth + 0.5) {
        add({ severity: "warning", code: "element.wide", path: elementPath, message: `This element runs ${(element.x + element.w - contentWidth).toFixed(1)}mm past the printable width.`, ...context });
      }

      if (element.type === "text") {
        const segments = parseTextSegments(element.text).filter(s => s.expression !== null);
        if (!element.text.trim() && !segments.length) {
          add({ severity: "warning", code: "element.empty", path: elementPath, message: "This text element is empty and will print nothing.", ...context });
        }
        for (const segment of segments) {
          checkExpression(segment.expression ?? "", `${elementPath}.text`, { band, document, context, catalogSource, fieldKeys, sourceKeys, add });
        }
        return;
      }

      if (element.type === "field") {
        if (!element.expression.trim()) {
          add({ severity: "error", code: "element.expression", path: `${elementPath}.expression`, message: "A field element needs an expression — the value to print.", ...context });
          return;
        }
        checkExpression(element.expression, `${elementPath}.expression`, { band, document, context, catalogSource, fieldKeys, sourceKeys, add });
        const first = parseExpression(element.expression).ast;
        if (first?.kind === "path" && first.parts.length === 1 && options.catalog && !fieldKeys.has(first.parts[0]!) && !document.parameters.some(p => p.key === first.parts[0])) {
          add({ severity: "error", code: "element.field", path: `${elementPath}.expression`, message: `"${first.parts[0]}" is not a field of ${catalogSource?.label ?? "this source"}.`, ...context });
        }
        const fieldKey = first?.kind === "path" ? first.parts[1] : undefined;
        const type = fieldKey ? fieldType(fieldKey) : undefined;
        if (type && element.format === "text" && (type === "money" || type === "date" || type === "minutes")) {
          add({ severity: "warning", code: "element.format", path: `${elementPath}.format`, message: `${fieldKey} is a ${type} field and will print unformatted as Text.`, ...context });
        }
        return;
      }

      if (element.type === "aggregate") {
        if (!element.expression.trim()) {
          // Counting the rows is the one total that needs no field: "how many tickets were raised".
          if (element.fn === "COUNT") return;
          add({ severity: "error", code: "element.expression", path: `${elementPath}.expression`, message: "A total needs the field to total.", ...context });
          return;
        }
        const { ast, error } = parseExpression(element.expression);
        if (!ast) {
          add({ severity: "error", code: "element.expression", path: `${elementPath}.expression`, message: `This expression could not be read: ${error}`, ...context });
        } else if (ast.kind !== "path") {
          add({ severity: "error", code: "element.aggregatePath", path: `${elementPath}.expression`, message: `${element.fn} totals a field, so give a single field name such as Fields.total — not a calculation.`, ...context });
        } else {
          const fieldKey = ast.parts[1];
          if (fieldKey && options.catalog && !fieldKeys.has(fieldKey)) {
            add({ severity: "error", code: "element.field", path: `${elementPath}.expression`, message: `"${fieldKey}" is not a field of ${catalogSource?.label ?? "this source"}.`, ...context });
          }
          const target = fieldKey ? fieldType(fieldKey) : undefined;
          if (element.fn !== "COUNT" && element.fn !== "COUNTD" && target && !["number", "money", "minutes"].includes(target)) {
            add({ severity: "error", code: "element.aggregateType", path: `${elementPath}.expression`, message: `${element.fn} needs a number to work on, and ${fieldKey} is ${target}.`, ...context });
          }
        }
        if (element.scope === "group" && !band.groupKey) {
          add({ severity: "error", code: "element.scope", path: `${elementPath}.scope`, message: `${element.fn} is scoped to a group, but this band is not inside one.`, ...context });
        }
        if (element.scope === "group" && band.groupKey && band.kind === "groupHeader") {
          add({ severity: "warning", code: "element.scope", path: `${elementPath}.scope`, message: "A group total in the group header totals nothing on the first page of a group that breaks across pages; a group footer is the usual place.", ...context });
        }
        return;
      }

      if (element.type === "image" && !element.src.trim()) {
        add({ severity: "error", code: "element.image", path: `${elementPath}.src`, message: "An image needs a source.", ...context });
      }
    });
  });

  // A group with no bands does nothing but sort, which is usually an oversight rather than intent.
  document.groups.forEach((group, index) => {
    if (!bandsByGroup.has(group.key)) {
      add({ severity: "warning", code: "group.unused", path: `groups[${index}]`, message: `The group "${group.label ?? group.key}" has no header or footer band, so it only changes the row order.`, groupKey: group.key });
    }
  });

  return issues;
}

interface ExpressionCheck {
  band: TemplateBand;
  document: ReportTemplateDocument;
  context: { bandId: string; elementId: string };
  catalogSource: CatalogSource | undefined;
  fieldKeys: Set<string>;
  sourceKeys: Set<string>;
  add: (issue: TemplateIssue) => void;
}

/** Shared between text holes, field expressions and aggregate references. */
function checkExpression(source: string, path: string, check: ExpressionCheck): void {
  const { ast, error } = parseExpression(source);
  if (!ast) {
    check.add({ severity: "error", code: "expression.syntax", path, message: `This expression could not be read: ${error}`, ...check.context });
    return;
  }

  for (const call of collectCalls(ast)) {
    const spec = FUNCTIONS.find(f => f.name === call.name);
    if (!spec) {
      check.add({ severity: "error", code: "expression.function", path, message: `There is no function called ${call.name}.`, ...check.context });
      continue;
    }
    if (call.args.length < spec.minArgs || (spec.maxArgs >= 0 && call.args.length > spec.maxArgs)) {
      check.add({ severity: "error", code: "expression.arity", path, message: `${call.name} is used as ${spec.signature}.`, ...check.context });
    }
    if (spec.scopeArg) {
      const scopeArgument = call.name === "COUNT" && call.args.length === 1 ? call.args[0] : call.args[1];
      if (scopeArgument?.kind === "string" && !AGGREGATE_SCOPES.includes(scopeArgument.value.toLowerCase() as AggregateScope)) {
        check.add({ severity: "error", code: "expression.scope", path, message: `The scope of ${call.name} must be "report", "group" or "page".`, ...check.context });
      }
    }
  }

  for (const reference of collectPaths(ast)) {
    const namespace = reference.parts[0] ?? "";
    const known = NAMESPACES.find(n => n.toLowerCase() === namespace.toLowerCase());
    if (known === "Fields") {
      const fieldKey = reference.parts[1];
      if (!fieldKey) {
        check.add({ severity: "error", code: "expression.field", path, message: "Fields needs a field name after it.", ...check.context });
        continue;
      }
      if (check.catalogSource && !check.fieldKeys.has(fieldKey)) {
        check.add({ severity: "error", code: "expression.field", path, message: `"${fieldKey}" is not a field of ${check.catalogSource.label}.`, ...check.context });
      }
      continue;
    }
    if (known === "Parameters") {
      const parameterKey = reference.parts[1];
      if (parameterKey && !check.document.parameters.some(p => p.key === parameterKey)) {
        check.add({ severity: "warning", code: "expression.parameter", path, message: `"${parameterKey}" is not a declared parameter, so this will print nothing.`, ...check.context });
      }
      continue;
    }
    if (known === "DataSources") {
      const sourceKey = reference.parts[1];
      if (sourceKey && !check.sourceKeys.has(sourceKey)) {
        check.add({ severity: "error", code: "expression.source", path, message: `There is no data source called "${sourceKey}".`, ...check.context });
      }
      continue;
    }
    if (known === "Group") {
      const groupKey = reference.parts[1];
      if (!check.band.groupKey && groupKey && !check.document.groups.some(g => g.key === groupKey)) {
        check.add({ severity: "warning", code: "expression.group", path, message: `"${groupKey}" is not a group in this report, so Group.${groupKey} will be empty.`, ...check.context });
      }
      continue;
    }
    if (known === "Report" || known === "Page") continue;

    // A bare name: the first segment must still be a field or a parameter.
    const name = reference.parts[0]!;
    if (check.catalogSource && !check.fieldKeys.has(name) && !check.document.parameters.some(p => p.key === name)) {
      check.add({ severity: "warning", code: "expression.name", path, message: `"${name}" is neither a field of ${check.catalogSource.label} nor a parameter — use Fields.${name} to be explicit.`, ...check.context });
    }
  }
}

export function errorsOf(issues: TemplateIssue[]): TemplateIssue[] {
  return issues.filter(i => i.severity === "error");
}

/** A one-line summary for a toast or a log. */
export function describeIssues(issues: TemplateIssue[]): string {
  const errors = issues.filter(i => i.severity === "error").length;
  const warnings = issues.length - errors;
  if (!errors && !warnings) return "No problems found";
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}
