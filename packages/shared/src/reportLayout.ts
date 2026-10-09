/**
 * The banded layout and pagination engine (PLAN-020).
 *
 * This is the single place that decides where an element lands on a page. The screen, the print
 * window and the PDF all draw **these** coordinates — the layout result is the contract between the
 * engine and every renderer, which is the only way "what you see" and "what prints" cannot drift
 * apart. Excel and CSV read the same result's rows rather than its geometry.
 *
 * The flow, in order:
 *
 *   1. **Validate.** A stored document is not trusted because it was stored once; errors stop here.
 *   2. **Resolve parameters**, and refuse to run a required parameter that has no value.
 *   3. **Sort and group the rows** by the declared groups, so a group is always contiguous.
 *   4. **Flow the bands onto pages.** Only two measurements are needed — a band's declared height and
 *      the width of a line of text — so everything else is arithmetic, and a page break is decided
 *      before anything is drawn rather than by an engine discovering it afterwards.
 *   5. **Patch the deferred values.** Page totals and `Page.totalPages` cannot be known until the last
 *      page exists, so the elements that use them are resolved again at the end. Band heights are
 *      fixed, so re-resolving a value cannot move anything.
 *
 * Text is measured through an injected function because the engine has no DOM and no fonts of its own:
 * the browser measures with a canvas, and the probe measures with a deterministic table.
 */
import {
  BAND_BY_KIND, DEFAULT_STYLE, contentBox, createBand, createElement, normaliseDocument, pageDimensions,
  validateTemplate, errorsOf,
  type BandKind, type CatalogSource, type ChartElement, type ElementStyle, type ImageElement, type PageMargins,
  type PageSetup, type ShapeElement, type SubreportElement, type TemplateBand, type TemplateElement,
  type TemplateGroup, type ReportTemplateDocument, type TemplateIssue,
} from "./reportTemplate";
import { BRAND_COLOR_DEFAULTS, DOCUMENT_PALETTE, type DocumentPresentation } from "./brand";
import {
  collectCalls, collectPaths, evaluateExpression, interpolateText, parseExpression, parseTextSegments,
  runningScopeKey, RUNNING_FUNCTIONS,
  type AggregateFunction, type AggregateScope, type ExpressionContext, type RunningFunction,
} from "./reportExpression";
import { formatValue, type ValueFormat } from "./reportFormat";
import { layoutChart, type LaidOutChart } from "./reportChart";

/** Font sizes are points, like a word processor; page geometry is millimetres. */
export const PT_TO_MM = 25.4 / 72;
export const LINE_HEIGHT_FACTOR = 1.2;

export interface TextStyle {
  fontFamily: ElementStyle["fontFamily"];
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

/** A single line of text at an absolute page position, in millimetres. */
export interface LaidOutLine {
  text: string;
  x: number;
  /** Top of the line box. */
  y: number;
  /** Where a PDF baseline sits, so the PDF and the screen agree. */
  baselineY: number;
  width: number;
}

export type ElementPayload =
  | { kind: "text"; lines: LaidOutLine[]; style: ElementStyle; format?: ValueFormat }
  | { kind: "line"; style: ElementStyle }
  | { kind: "box"; style: ElementStyle }
  | { kind: "image"; src: string; style: ElementStyle }
  | { kind: "chart"; chart: LaidOutChart; style: ElementStyle };

export interface LaidOutElement {
  id: string;
  type: TemplateElement["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  payload: ElementPayload;
  /** Set when the element's value could not be known until pagination finished. */
  deferred: boolean;
  rowIndex?: number;
  groupLevel?: number;
}

export interface LaidOutBand {
  bandId: string;
  kind: BandKind;
  groupKey?: string;
  groupLevel?: number;
  /** The group value this band printed for, as text. */
  groupValue?: string;
  /** Absolute position of the band's top edge on the page, in millimetres. */
  y: number;
  height: number;
  elements: LaidOutElement[];
  rowIndex?: number;
  /** Set on a band that came from a sub-report, to the section it belongs to. */
  section?: string;
}

export interface LaidOutPage {
  number: number;
  bands: LaidOutBand[];
  /** The source rows whose data bands were printed on this page. */
  rowIndexes: number[];
}

export interface LaidOutReport {
  page: { width: number; height: number; margins: PageMargins };
  content: { width: number; height: number };
  pages: LaidOutPage[];
  rowCount: number;
  groupCount: number;
  /** True when the data source's row limit was reached. */
  truncated: boolean;
  parameters: Record<string, unknown>;
  issues: TemplateIssue[];
  /** True when the document was refused: `pages` is empty and `issues` holds the errors. */
  refused: boolean;
}

export type MeasureText = (text: string, style: TextStyle) => number;

/** A sub-report, resolved by the API and handed to the engine along with the run. */
export interface SubreportResolution {
  document: unknown;
  rows: Array<Record<string, unknown>>;
  /** The child's parameters, already resolved in the parent's parameter context. */
  parameters: Record<string, unknown>;
  name?: string;
}

export interface LayoutRequest {
  document: unknown;
  rows: Array<Record<string, unknown>>;
  parameters?: Record<string, unknown>;
  /** Additional declared sources, readable as `DataSources.key.field`. */
  dataSources?: Record<string, Array<Record<string, unknown>>>;
  measure: MeasureText;
  /** The data source's row ceiling, so a report that hit it says so. */
  limit?: number;
  now?: Date;
  /** The whitelisted sources and fields, so a field name can be checked before anything runs. */
  catalog?: { sources: CatalogSource[] };
  /** The saved reports a sub-report element may point at, so a stale reference is caught on render too. */
  templates?: Array<{ id: string; name: string; parameters?: Array<{ key: string; required?: boolean }> }>;
  /** The resolved sub-reports, keyed by the template id the elements point at. */
  subreports?: Record<string, SubreportResolution>;
  /**
   * The instance's document settings: the one accent a printed page may use, and the family's
   * presentation — which sheet, and what the foot carries. Absent leaves the template as its author drew
   * it, apart from the type floor, which is a rule of the document language rather than a setting.
   */
  ink?: DocumentInk | null;
}

const isBlank = (value: unknown): boolean => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (isBlank(value)) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const named = record.name ?? record.title ?? record.label;
    if (typeof named === "string") return named;
    const scalars = Object.values(record).filter(v => v !== null && v !== undefined && typeof v !== "object");
    if (scalars.length === 1) return String(scalars[0]);
    return JSON.stringify(value);
  }
  return String(value);
}

/** Reads a dotted path out of a row, matching the first segment case-insensitively. */
function readField(row: Record<string, unknown> | undefined, path: string): unknown {
  if (!row) return undefined;
  const parts = path.replace(/^Fields\./i, "").split(".").filter(Boolean);
  const [head, ...rest] = parts;
  if (!head) return undefined;
  let value: unknown = row[head];
  if (value === undefined) {
    const actual = Object.keys(row).find(k => k.toLowerCase() === head.toLowerCase());
    if (actual) value = row[actual];
  }
  for (const part of rest) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function compareForSort(a: unknown, b: unknown): number {
  if (isBlank(a) && isBlank(b)) return 0;
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb ? 0 : na < nb ? -1 : 1;
  const sa = toText(a);
  const sb = toText(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

// ── Deferred values ─────────────────────────────────────────────────

interface DeferredInfo { page: boolean; totalPages: boolean }

/**
 * Whether an expression can only be answered once pagination has finished. Read from the AST rather
 * than by watching evaluation, so the answer is the same on every pass and an element that does not
 * need a second pass does not get one.
 */
function deferredInfo(expression: string): DeferredInfo {
  const { ast } = parseExpression(expression);
  if (!ast) return { page: false, totalPages: false };
  const totalPages = collectPaths(ast).some(p =>
    (p.parts[0] ?? "").toLowerCase() === "page" && (p.parts[1] ?? "").toLowerCase() === "totalpages");
  const page = collectCalls(ast).some(call => {
    if (!["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNTD"].includes(call.name)) return false;
    const scopeArgument = call.name === "COUNT" && call.args.length === 1 ? call.args[0] : call.args[1];
    return scopeArgument?.kind === "string" && scopeArgument.value.toLowerCase() === "page";
  });
  return { page, totalPages };
}

/**
 * The same question for a text element, whose value is literal text with `{{ … }}` holes in it. Each
 * hole is an expression in its own right, and `Page.totalPages` in a page footer is the reason this
 * distinction matters at all: reading the whole string as one expression finds nothing and the footer
 * keeps whatever page count existed when it was drawn.
 */
function deferredInfoForText(text: string): DeferredInfo {
  let page = false;
  let totalPages = false;
  for (const segment of parseTextSegments(text)) {
    if (!segment.expression) continue;
    const info = deferredInfo(segment.expression);
    page = page || info.page;
    totalPages = totalPages || info.totalPages;
  }
  return { page, totalPages };
}

// ── Aggregates ──────────────────────────────────────────────────────

interface AggregateRequest { fn: AggregateFunction; path: string; scope: AggregateScope }

function computeAggregate(request: AggregateRequest, rows: Array<Record<string, unknown>>): unknown {
  const { fn, path } = request;
  if (fn === "COUNT") {
    if (!path) return rows.length;
    return rows.filter(row => !isBlank(readField(row, path))).length;
  }
  const values = rows.map(row => readField(row, path)).filter(value => !isBlank(value));
  if (fn === "COUNTD") return new Set(values.map(value => toText(value))).size;
  if (fn === "MIN") return values.length ? values.reduce((a, b) => (compareForSort(b, a) < 0 ? b : a)) : null;
  if (fn === "MAX") return values.length ? values.reduce((a, b) => (compareForSort(b, a) > 0 ? b : a)) : null;
  const numbers = values.map(toNumber).filter(n => !Number.isNaN(n));
  if (!numbers.length) return null;
  const total = numbers.reduce((a, b) => a + b, 0);
  return fn === "AVG" ? total / numbers.length : total;
}

// ── Text placement ──────────────────────────────────────────────────

export function lineHeightOf(style: TextStyle): number {
  return style.fontSize * LINE_HEIGHT_FACTOR * PT_TO_MM;
}

/** Greedy wrapping on spaces, breaking a word wider than the box rather than letting it run on. */
function wrapText(text: string, width: number, style: TextStyle, measure: MeasureText): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { lines.push(""); continue; }
    const words = paragraph.split(/(\s+)/).filter(word => word !== "");
    let current = "";
    for (const word of words) {
      const candidate = current + word;
      if (measure(candidate, style) <= width) { current = candidate; continue; }
      if (!current.trim() && measure(word, style) > width) {
        let piece = "";
        for (const character of word) {
          if (piece && measure(piece + character, style) > width) { lines.push(piece); piece = character; }
          else piece += character;
        }
        current = piece;
        continue;
      }
      lines.push(current.trimEnd());
      current = word.trimStart();
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

interface PlaceTextOptions {
  value: string;
  element: { x: number; y: number; w: number; h: number };
  style: ElementStyle;
  bandY: number;
  measure: MeasureText;
  format?: ValueFormat;
}

function placeText(options: PlaceTextOptions): ElementPayload {
  const { element, style, bandY, measure } = options;
  const padding = Math.max(0, style.padding);
  const innerWidth = Math.max(0.5, element.w - padding * 2);
  const innerHeight = Math.max(0.5, element.h - padding * 2);
  const textStyle: TextStyle = { fontFamily: style.fontFamily, fontSize: style.fontSize, bold: style.bold, italic: style.italic };
  const lineHeight = lineHeightOf(textStyle);
  const wrapped = wrapText(options.value, innerWidth, textStyle, measure);
  while (wrapped.length > 1 && wrapped[wrapped.length - 1] === "") wrapped.pop();
  const maxLines = Math.max(1, Math.floor(innerHeight / lineHeight));
  const lines = wrapped.slice(0, maxLines);

  const blockHeight = lines.length * lineHeight;
  const offsetY = style.valign === "top" ? 0 : style.valign === "bottom" ? innerHeight - blockHeight : (innerHeight - blockHeight) / 2;
  const left = element.x + padding;
  const top = bandY + element.y + padding + Math.max(0, offsetY);

  const placed: LaidOutLine[] = lines.map((text, index) => {
    const width = measure(text, textStyle);
    const x = style.align === "right" ? left + innerWidth - width : style.align === "center" ? left + (innerWidth - width) / 2 : left;
    const y = top + index * lineHeight;
    return { text, x, y, baselineY: y + textStyle.fontSize * 0.8 * PT_TO_MM, width };
  });
  return { kind: "text", lines: placed, style, format: options.format };
}

// ── Sections ────────────────────────────────────────────────────────

/**
 * A section is one document being flowed: the report itself, or a sub-report printed inside it. Pages,
 * the deferred patch list and the issue log are shared across every section, because a sub-report is
 * printed **on the parent's pages** — that is what stops it from throwing the parent's page numbering
 * out. Everything that belongs to one document (its rows, its grouping, its running totals) lives here
 * so two documents can be in flight at once without one borrowing the other's numbers.
 */
interface Section {
  key: string;
  isRoot: boolean;
  document: ReportTemplateDocument;
  parameters: Record<string, unknown>;
  reportMeta: Record<string, unknown>;
  groups: TemplateGroup[];
  groupKeys: string[];
  bandsByKind: Map<BandKind, TemplateBand[]>;
  firstOf: (kind: BandKind, groupKey?: string) => TemplateBand | undefined;
  heightOf: (kind: BandKind, groupKey?: string) => number;
  levels: number;
  sortedRows: Array<Record<string, unknown>>;
  sortedKeys: string[][];
  groupCount: number;
  groupRowsFor: (start: number, level: number) => Array<Record<string, unknown>>;
  /** Every running total the document asks for, collected up front so it accumulates whether read or not. */
  runningSpecs: RunningSpec[];
  running: Map<string, RunningState>;
  /** Horizontal shift applied to every element, which is how a sub-report sits inside its box. */
  offsetX: number;
}

interface FlowPage {
  number: number;
  bands: LaidOutBand[];
  y: number;
}

interface RunningSpec { fn: RunningFunction; path: string; scopeKey: string }

interface RunningState { rows: number; values: number; numbers: number; sum: number }

const emptyRunningState = (): RunningState => ({ rows: 0, values: 0, numbers: 0, sum: 0 });

/** A running total's identity: the function, the field and the group it restarts at ("" for never). */
const runningKey = (fn: RunningFunction, path: string, scopeKey: string): string =>
  `${fn}|${path.trim().toLowerCase()}|${scopeKey.toLowerCase()}`;

/**
 * Narrowing by a union of literals (`type === "line" || type === "box"`) does not remove the member
 * from the union, so shapes, images, charts and sub-reports are identified with guards instead.
 */
const isShape = (element: TemplateElement): element is ShapeElement => element.type === "line" || element.type === "box";
const isImage = (element: TemplateElement): element is ImageElement => element.type === "image";
const isChart = (element: TemplateElement): element is ChartElement => element.type === "chart";
const isSubreport = (element: TemplateElement): element is SubreportElement => element.type === "subreport";

interface EmitContext {
  row?: Record<string, unknown>;
  rowIndex?: number;
  groupLevel?: number;
  groupRows?: Array<Record<string, unknown>>;
  /** The group's key value as text, carried from the sort so an expression group still has a label. */
  groupValue?: string;
}

/** Everything an element needs to know about the band and the page it is being placed on. */
interface Placement {
  section: Section;
  band: TemplateBand;
  owner: Section;
  context: EmitContext;
  /** The top of the band, which is the page cursor at the moment the band started. */
  bandTop: number;
  bandPage: FlowPage;
  placed: LaidOutElement[];
  /** A copy of the running totals as they stood when this band was reached. */
  running: Map<string, RunningState>;
}

/** Resolves the declared parameters of one document, and says so when a required one has no value. */
function resolveParameters(
  document: ReportTemplateDocument,
  provided: Record<string, unknown> | undefined,
  issues: TemplateIssue[],
  where: string,
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const parameter of document.parameters) {
    const given = provided?.[parameter.key];
    let value: unknown = given !== undefined && given !== "" ? given : parameter.defaultValue ?? "";
    if (value !== "" && value !== undefined) {
      if (parameter.type === "number") value = Number(value);
      else if (parameter.type === "boolean") value = value === true || value === "true" || value === "1";
      else if (parameter.type === "date") value = String(value);
    }
    if (parameter.required && (value === undefined || value === "")) {
      issues.push({
        severity: "error", code: "parameter.required", path: `${where}parameters[${parameter.key}]`,
        message: `This report needs "${parameter.label || parameter.key}" before it can be generated.`,
      });
    }
    parameters[parameter.key] = value;
  }
  return parameters;
}

/**
 * Every running total a document asks for, read from its expressions rather than discovered as it
 * prints. Reading them up front is what lets a total accumulate from the first row even when the band
 * that shows it — a group footer, say — only appears at the end.
 */
function collectRunningSpecs(document: ReportTemplateDocument): RunningSpec[] {
  const groupKeys = document.groups.map(group => group.key);
  const specs = new Map<string, RunningSpec>();
  for (const source of collectDocumentExpressions(document)) {
    const { ast } = parseExpression(source);
    if (!ast) continue;
    for (const call of collectCalls(ast)) {
      if (!RUNNING_FUNCTIONS.includes(call.name as RunningFunction)) continue;
      const fn = call.name as RunningFunction;
      const isCount = fn === "RUNNINGCOUNT";
      const pathAst = call.args[0];
      const path = pathAst?.kind === "path" ? pathAst.parts.join(".") : "";
      const scopeAst = isCount && call.args.length === 1 && call.args[0]?.kind === "string" ? call.args[0] : call.args[1];
      const scopeKey = runningScopeKey(scopeAst?.kind === "string" ? scopeAst.value : "", groupKeys) ?? "";
      specs.set(runningKey(fn, path, scopeKey), { fn, path, scopeKey });
    }
  }
  return [...specs.values()];
}

/** Sorts a document's rows by its groups once, so a group is contiguous and its span can be found. */
function buildSection(args: {
  key: string;
  isRoot: boolean;
  document: ReportTemplateDocument;
  rows: Array<Record<string, unknown>>;
  parameters: Record<string, unknown>;
  now?: Date;
}): Section {
  const { key, isRoot, document, rows, parameters } = args;

  const bandsByKind = new Map<BandKind, TemplateBand[]>();
  for (const band of document.bands) bandsByKind.set(band.kind, [...(bandsByKind.get(band.kind) ?? []), band]);
  const firstOf = (kind: BandKind, groupKey?: string): TemplateBand | undefined =>
    (bandsByKind.get(kind) ?? []).find(band => groupKey === undefined || band.groupKey === groupKey);
  const heightOf = (kind: BandKind, groupKey?: string): number => firstOf(kind, groupKey)?.height ?? 0;

  const levels = document.groups.length;
  const keysByRow: string[][] = rows.map(row =>
    document.groups.map(group => {
      try {
        return toText(evaluateExpression(group.expression, { fields: row, parameters, report: {}, page: {}, group: null }));
      } catch {
        return "";
      }
    }),
  );
  const order = rows.map((_, index) => index);
  if (levels) {
    order.sort((a, b) => {
      for (let level = 0; level < levels; level++) {
        const direction = document.groups[level]?.sort ?? "asc";
        if (direction === "none") continue;
        const compared = compareForSort(keysByRow[a]?.[level], keysByRow[b]?.[level]);
        if (compared !== 0) return direction === "desc" ? -compared : compared;
      }
      return a - b;
    });
  }
  const sortedRows = order.map(index => rows[index]!);
  const sortedKeys = order.map(index => keysByRow[index]!);

  // Where each group ends, per level, in one pass from the back: a group is contiguous by construction.
  const endOf: number[][] = sortedRows.map(() => new Array<number>(levels).fill(0));
  for (let level = 0; level < levels; level++) {
    for (let index = sortedRows.length - 1; index >= 0; index--) {
      const sameAsNext = index + 1 < sortedRows.length && sortedKeys[index + 1]?.[level] === sortedKeys[index]?.[level];
      endOf[index]![level] = sameAsNext ? endOf[index + 1]?.[level] ?? index : index;
    }
  }
  const groupRowsFor = (start: number, level: number): Array<Record<string, unknown>> =>
    sortedRows.slice(start, (endOf[start]?.[level] ?? start) + 1);
  const groupCount = levels ? new Set(sortedKeys.map(keys => keys[0])).size : 0;

  const runningSpecs = collectRunningSpecs(document);
  const running = new Map<string, RunningState>();
  for (const spec of runningSpecs) running.set(runningKey(spec.fn, spec.path, spec.scopeKey), emptyRunningState());

  return {
    key, isRoot, document, parameters, groups: document.groups, groupKeys: document.groups.map(group => group.key),
    bandsByKind, firstOf, heightOf, levels, sortedRows, sortedKeys, groupCount, groupRowsFor,
    runningSpecs, running, offsetX: 0,
    reportMeta: {
      name: document.name,
      rowCount: sortedRows.length,
      groupCount,
      generatedAt: (args.now ?? new Date()).toISOString(),
      source: document.dataSources[0]?.source ?? "",
    },
  };
}

// ── The document's own rules ────────────────────────────────────────

/**
 * The floor under every size this engine draws, in points.
 *
 * A page is read at arm's length, photocopied, scanned into somebody's finance folder and filed, so the
 * mockup's document language puts one floor under the type on it — and the banded engine takes that
 * floor as well as the accent. Nothing is drawn smaller than this whatever a saved template says. It is
 * applied to the document **before anything is measured**, so the wrap points the preview shows are the
 * wrap points the PDF draws; a band's height is untouched, so no saved template moves a millimetre.
 */
export const DOCUMENT_TYPE_FLOOR_PT = 8.5;

/**
 * The weight the group rule is drawn at, in millimetres.
 *
 * The group boundary is the one line a reader navigates by, and a colour alone does not survive a
 * greyscale print, a photocopy or a colour-blind reader. Carrying it in the stroke's weight as well as
 * its colour is the rule the standard kit's masthead follows, applied to the one line that matters most
 * on a banded page.
 */
export const DOCUMENT_GROUP_RULE_MM = 0.6;

/**
 * The two colours the product's *interface* put on a designed page, and which must not be printed.
 *
 * An author's colour is theirs and is preserved exactly. These are not an author's colours: cyan is the
 * interface's accent — `BRAND_COLOR_DEFAULTS.accentColor`, which the brand contract says is deliberately
 * never used on paper because it measures 2.1:1 against white — and `#22d3ee` is the tint of it that the
 * report designer's own starter has always given its group rule. A saved template carrying one of them is
 * therefore carrying the product's default, and the document's one accent is drawn in its place.
 */
const INTERFACE_INK_COLOURS = [BRAND_COLOR_DEFAULTS.accentColor.toLowerCase(), "#22d3ee"];

const isInterfaceInk = (colour: string | null | undefined): boolean =>
  !!colour && INTERFACE_INK_COLOURS.includes(colour.trim().toLowerCase());

/**
 * What the instance's document settings ask of a laid-out report.
 *
 * Neither field is required: with no ink the engine draws the template as its author left it, apart from
 * the type floor, which is a rule of the document language rather than a setting.
 */
export interface DocumentInk {
  /** The instance's one accent for paper — `DocumentBrand.accent`. */
  accent?: string;
  /** The family's resolved presentation: which sheet it prints on, and what its foot carries. */
  presentation?: DocumentPresentation | null;
}

/**
 * One stored style as the document will draw it.
 *
 * This is the whole of the banded engine's styling: the type floor, the palette in place of the
 * interface's cyans, and the group rule's weight. Pure, and it returns the style it was given when
 * nothing changes, so a renderer can compare by identity and a preview can memoise on it.
 */
export function inkStyle(
  style: ElementStyle,
  options: { accent?: string; groupRule?: boolean } = {},
): ElementStyle {
  const accent = options.accent || BRAND_COLOR_DEFAULTS.primaryColor;
  const fontSize = Math.max(DOCUMENT_TYPE_FLOOR_PT, style.fontSize);
  const color = isInterfaceInk(style.color) ? accent : style.color;
  const background = isInterfaceInk(style.background) ? DOCUMENT_PALETTE.tint : style.background;
  const border = style.border && !isInterfaceInk(style.border.color)
    ? style.border
    : style.border
      ? {
          color: accent,
          width: options.groupRule && isInterfaceInk(style.border.color) ? DOCUMENT_GROUP_RULE_MM : style.border.width,
        }
      : style.border;
  if (fontSize === style.fontSize && color === style.color && background === style.background && border === style.border) {
    return style;
  }
  return { ...style, fontSize, color, background, border };
}

/**
 * The sheet a document prints on.
 *
 * The family's presentation decides it, in millimetres, rather than any renderer holding a paper size of
 * its own — that is what keeps the designer's canvas, its preview and the PDF the same page. The one
 * exception is a **custom** sheet: an author who typed exact millimetres in Page Setup has asked for a
 * sheet that is not a preset, and that is theirs.
 */
export function paperFor(
  document: ReportTemplateDocument,
  presentation?: DocumentPresentation | null,
): PageSetup {
  if (!presentation || document.page.size === "custom") return document.page;
  return { ...document.page, size: presentation.pageSize, orientation: presentation.orientation };
}

/** The text that says what a page belongs to, when the design does not say it itself. */
const footerWords = (presentation: DocumentPresentation): string =>
  [presentation.footerNote, "{{Report.name}} · generated {{FORMATDATE(NOW(), 'yyyy-MM-dd')}}"]
    .filter(Boolean).join(" · ");

/** True when a band already says something of its own, so the product does not talk over it. */
const bandHasWords = (band: TemplateBand): boolean =>
  band.elements.some(element =>
    (element.type === "text" && element.text.trim() !== "") || element.type === "field" || element.type === "aggregate");

/** True when a band already numbers its pages in its own words or fields. */
const bandNumbersPages = (band: TemplateBand): boolean =>
  band.elements.some(element =>
    (element.type === "text" && /Page\s*\.\s*(number|totalPages)/.test(element.text))
    || (element.type === "field" && /Page\s*\.\s*(number|totalPages)/.test(element.expression)));

/** The product's own foot: where the document came from, and which page of how many this is. */
function furnitureElements(presentation: DocumentPresentation, width: number): TemplateElement[] {
  const elements: TemplateElement[] = [];
  if (presentation.showFooter) {
    elements.push(createElement("text", {
      x: 0, y: 1.5, w: Math.max(20, width - 40), h: 5, text: footerWords(presentation),
      style: { ...DEFAULT_STYLE, fontSize: DOCUMENT_TYPE_FLOOR_PT, color: DOCUMENT_PALETTE.muted },
    }));
  }
  if (presentation.showPageNumbers) {
    elements.push(createElement("text", {
      x: Math.max(20, width - 40), y: 1.5, w: 40, h: 5, text: "Page {{Page.number}} of {{Page.totalPages}}",
      style: { ...DEFAULT_STYLE, fontSize: DOCUMENT_TYPE_FLOOR_PT, color: DOCUMENT_PALETTE.muted, align: "right" },
    }));
  }
  return elements;
}

/**
 * The page furniture a designed report does not have to place.
 *
 * `report.designer`'s presentation asks for a footer and for page numbers — both are true by default —
 * and an author places their own `pageFooter` band when they want one, which the starter does. So the
 * band is drawn exactly as it was placed, and only what is *absent* is added: the family's footer line
 * when the band carries no words of its own, and the page numbers when it does not already number
 * pages. A template with no footer band at all gets one, ruled off in the palette.
 *
 * Nothing is added above the author's bands. The letterhead of this family is `"none"` on purpose (see
 * `documentBrand.ts`): a designed page's author placed its header by hand, and the product putting its
 * own mark above it would be overruling them. The presentation is therefore honoured at the foot, and
 * nowhere the author has already written.
 */
function withPageFurniture(document: ReportTemplateDocument, ink: DocumentInk, page: PageSetup): ReportTemplateDocument {
  const presentation = ink.presentation;
  if (!presentation) return document;
  const width = contentBox(page).width;
  const footer = document.bands.find(band => band.kind === "pageFooter");

  if (!footer) {
    if (!presentation.showFooter && !presentation.showPageNumbers) return document;
    const band = createBand("pageFooter", {
      elements: [
        createElement("line", {
          x: 0, y: 0, w: width, h: 0.4,
          style: { ...DEFAULT_STYLE, border: { width: 0.3, color: DOCUMENT_PALETTE.rule } },
        }),
        ...furnitureElements(presentation, width),
      ],
    });
    return { ...document, bands: [...document.bands, band] };
  }

  const additions: TemplateElement[] = [];
  if (presentation.showFooter && !bandHasWords(footer)) additions.push(...furnitureElements({ ...presentation, showPageNumbers: false }, width));
  if (presentation.showPageNumbers && !bandNumbersPages(footer)) additions.push(...furnitureElements({ ...presentation, showFooter: false }, width));
  if (!additions.length) return document;
  return {
    ...document,
    bands: document.bands.map(band => (band === footer ? { ...band, elements: [...band.elements, ...additions] } : band)),
  };
}

/** Every element of a document drawn the way the document's ink says, before it is measured. */
function inkedDocument(document: ReportTemplateDocument, ink: DocumentInk): ReportTemplateDocument {
  const accent = ink.accent || BRAND_COLOR_DEFAULTS.primaryColor;
  let changed = false;
  const bands = document.bands.map(band => {
    let bandChanged = false;
    const elements = band.elements.map(element => {
      const style = inkStyle(element.style, { accent, groupRule: band.kind === "groupHeader" && element.type === "line" });
      if (style === element.style) return element;
      bandChanged = true;
      changed = true;
      return { ...element, style } as TemplateElement;
    });
    return bandChanged ? { ...band, elements } : band;
  });
  return changed ? { ...document, bands } : document;
}

export function layoutReport(request: LayoutRequest): LaidOutReport {
  const document = normaliseDocument(request.document);
  const issues: TemplateIssue[] = validateTemplate(document, { catalog: request.catalog, templates: request.templates });

  if (errorsOf(issues).length) {
    issues.push({ severity: "error", code: "render.refused", path: "bands", message: "The report was not generated because this template has errors to fix first." });
    return refusedReport(document, issues);
  }

  const parameters = resolveParameters(document, request.parameters, issues, "");
  if (errorsOf(issues).length) {
    issues.push({ severity: "error", code: "render.refused", path: "parameters", message: "The report was not generated because it is missing something it needs." });
    return { ...refusedReport(document, issues), parameters };
  }

  // The paper, the ink and the foot are the document's, decided in one place before anything is
  // measured: `paperFor` reads the family's presentation rather than a size of this engine's own, and
  // `inkedDocument` applies the type floor and the accent before a single line is wrapped.
  const ink: DocumentInk = request.ink ?? {};
  const paper = paperFor(document, ink.presentation);
  const printed = withPageFurniture(inkedDocument(document, ink), ink, paper);
  const page = pageDimensions(paper);
  const { width: contentWidth, height: contentHeight } = contentBox(paper);

  const pages: FlowPage[] = [];
  const sections = new Map<string, Section>();
  const deferred: Array<{ sectionKey: string; pageNumber: number; apply: (pageRows: Array<Record<string, unknown>>) => void }> = [];
  /** Which rows of which section printed on which page, so a page-scoped value is answerable. */
  const pageRowIndexes = new Map<string, number[]>();
  const rowsOnPage = (sectionKey: string, pageNumber: number): Array<Record<string, unknown>> => {
    const section = sections.get(sectionKey);
    if (!section) return [];
    return pageRowIndexes.get(`${sectionKey}#${pageNumber}`)?.map(index => section.sortedRows[index]!).filter(Boolean) ?? [];
  };
  const currentPage = (): FlowPage => pages[pages.length - 1]!;

  const rootSection = buildSection({ key: "root", isRoot: true, document: printed, rows: request.rows, parameters, now: request.now });
  sections.set(rootSection.key, rootSection);

  // The footers of the owning report are anchored to the bottom of the page, so the flow gets the page
  // height minus the space they reserve. A sub-report has no footers of its own — it lives on these pages.
  const footerReserve = rootSection.heightOf("columnFooter") + rootSection.heightOf("pageFooter");
  const flowHeight = Math.max(5, contentHeight - footerReserve);

  /** Adds a numeric value to a running total, if that total exists in this section. */
  function accumulate(section: Section, row: Record<string, unknown>): void {
    for (const spec of section.runningSpecs) {
      const state = section.running.get(runningKey(spec.fn, spec.path, spec.scopeKey));
      if (!state) continue;
      state.rows += 1;
      if (!spec.path) continue;
      const raw = readField(row, spec.path);
      if (isBlank(raw)) continue;
      state.values += 1;
      const number = toNumber(raw);
      if (!Number.isNaN(number)) {
        state.numbers += 1;
        state.sum += number;
      }
    }
  }

  /** A running total scoped to a group goes back to nothing the moment that group opens. */
  function resetRunning(section: Section, groupKey: string): void {
    for (const spec of section.runningSpecs) {
      if (!spec.scopeKey || spec.scopeKey.toLowerCase() !== groupKey.toLowerCase()) continue;
      section.running.set(runningKey(spec.fn, spec.path, spec.scopeKey), emptyRunningState());
    }
  }

  function startPage(owner: Section, inline: Section | null): FlowPage {
    if (pages.length) finishPage();
    const flow: FlowPage = { number: pages.length + 1, bands: [], y: 0 };
    pages.push(flow);
    const header = owner.firstOf("pageHeader");
    if (header) emitBand(owner, header, {}, owner);
    if (flow.number === 1) {
      const title = owner.firstOf("reportTitle");
      if (title) emitBand(owner, title, {}, owner);
    }
    const columnHeader = owner.firstOf("columnHeader");
    if (columnHeader) emitBand(owner, columnHeader, {}, owner);
    // A sub-report that runs onto a fresh page brings its own captions with it, behind the parent's.
    if (inline) {
      const carried = inline.firstOf("columnHeader");
      if (carried) emitBand(inline, carried, {}, owner);
    }
    return flow;
  }

  /** The footers of the page being left, taken from the report that owns the page. */
  function finishPage(): void {
    const flow = currentPage();
    const columnFooter = rootSection.firstOf("columnFooter");
    const pageFooter = rootSection.firstOf("pageFooter");
    if (columnFooter) {
      flow.y = Math.max(flow.y, contentHeight - footerReserve);
      emitBand(rootSection, columnFooter, {}, rootSection);
    }
    if (pageFooter) {
      flow.y = Math.max(flow.y, contentHeight - rootSection.heightOf("pageFooter"));
      emitBand(rootSection, pageFooter, {}, rootSection);
    }
  }

  const needsNewPage = (height: number): boolean => currentPage().y + height > flowHeight + 0.001;

  function emitBand(section: Section, band: TemplateBand, context: EmitContext, owner: Section): void {
    const bandPage = currentPage();
    const bandTop = bandPage.y;
    const group = context.groupLevel === undefined ? undefined : section.groups[context.groupLevel];
    const baseContext = {
      fields: context.row ?? {},
      parameters: section.parameters,
      report: section.reportMeta,
      group: group
        ? {
            key: group.key,
            label: group.label ?? group.key,
            level: context.groupLevel! + 1,
            value: context.groupValue ?? "",
            count: context.groupRows?.length ?? 0,
            first: context.groupRows?.[0] ?? null,
            last: context.groupRows?.[context.groupRows.length - 1] ?? null,
          }
        : null,
    };

    const placement: Placement = {
      section, band, owner, context, bandTop, bandPage, placed: [],
      // The totals as they stand now: a deferred re-resolve must not see the values from the end of the
      // report, or a page footer would print the grand total.
      running: new Map(section.running),
    };
    const placed = placement.placed;

    /** A running total, read from the snapshot taken when this band was reached. */
    const running = (call: { fn: RunningFunction; path: string; scope: string }): unknown => {
      const scopeKey = runningScopeKey(call.scope, section.groupKeys) ?? "";
      const state = placement.running.get(runningKey(call.fn, call.path, scopeKey));
      if (!state) return call.fn === "RUNNINGCOUNT" ? 0 : null;
      if (call.fn === "RUNNINGCOUNT") return call.path ? state.values : state.rows;
      if (call.fn === "RUNNINGAVG") return state.numbers ? state.sum / state.numbers : null;
      return state.sum;
    };

    for (const element of band.elements) {
      const x = section.offsetX + element.x;

      if (isShape(element)) {
        placed.push({
          id: element.id, type: element.type, x, y: bandTop + element.y, w: element.w, h: element.h,
          deferred: false, payload: { kind: element.type, style: element.style },
        });
        continue;
      }

      if (isImage(element)) {
        let src = element.src;
        try {
          if (src.includes("{{")) src = interpolateText(src, baseContext as ExpressionContext);
        } catch { src = ""; }
        placed.push({
          id: element.id, type: element.type, x, y: bandTop + element.y, w: element.w, h: element.h,
          deferred: false, payload: { kind: "image", src, style: element.style },
        });
        continue;
      }

      if (isSubreport(element)) {
        emitSubreport(placement, element);
        continue;
      }

      if (isChart(element)) {
        emitChart(placement, element);
        continue;
      }

      const expression = element.type === "aggregate"
        ? `${element.fn}(${[
            element.expression.trim(),
            element.scope !== "report" ? `'${element.scope}'` : "",
          ].filter(Boolean).join(", ")})`
        : element.type === "field"
          ? element.expression
          : element.text;
      const info = element.type === "text" ? deferredInfoForText(element.text) : deferredInfo(expression);
      const isDeferred = info.page || info.totalPages;
      const positioned = { ...element, x };

      const resolve = (pageNumber: number, pageRows: Array<Record<string, unknown>>): string => {
        const ctx: ExpressionContext = {
          ...baseContext,
          page: { number: pageNumber, totalPages: pages.length, rowCount: pageRows.length },
          aggregate: aggregateRequest =>
            aggregateRequest.scope === "page"
              ? computeAggregate(aggregateRequest, pageRows)
              : computeAggregate(aggregateRequest, aggregateRequest.scope === "group" ? context.groupRows ?? [] : section.sortedRows),
          running,
          dataSource: request.dataSources ? (key: string, path: string) => readField(request.dataSources?.[key]?.[0], path) : undefined,
        };
        if (element.type === "text") {
          try { return interpolateText(element.text, ctx); } catch { return ""; }
        }
        try {
          return formatValue(evaluateExpression(expression, ctx), element.format);
        } catch (e) {
          issues.push({
            severity: "warning", code: "expression.runtime", path: `bands.${band.kind}.elements`,
            message: `"${expression}" could not be worked out: ${e instanceof Error ? e.message : String(e)}`,
            bandId: band.id, elementId: element.id,
          });
          return "";
        }
      };

      const format = element.type === "text" ? undefined : element.format;
      const placedElement: LaidOutElement = {
        id: element.id, type: element.type, x, y: bandTop + element.y, w: element.w, h: element.h,
        payload: placeText({ value: resolve(bandPage.number, []), element: positioned, style: element.style, bandY: bandTop, measure: request.measure, format }),
        deferred: isDeferred, rowIndex: context.rowIndex, groupLevel: context.groupLevel,
      };

      if (isDeferred) {
        // The page is fixed at placement time, so the patch pass knows which page's rows to total.
        const pageNumber = bandPage.number;
        deferred.push({
          sectionKey: section.key,
          pageNumber,
          apply: pageRows => {
            placedElement.payload = placeText({
              value: resolve(pageNumber, pageRows), element: positioned, style: element.style, bandY: bandTop, measure: request.measure, format,
            });
            placedElement.deferred = false;
          },
        });
      }

      placed.push(placedElement);
    }

    // A band declares its own height, but a sub-report inside it can make it taller than that: the child
    // flows into the space below its box and the band grows to hold it.
    let height = band.height;
    if (currentPage() === bandPage) {
      bandPage.y = Math.max(bandPage.y, bandTop + band.height);
      height = bandPage.y - bandTop;
    }

    bandPage.bands.push({
      bandId: band.id, kind: band.kind, groupKey: band.groupKey, groupLevel: context.groupLevel,
      // The group this band printed for, which is what `bandsToTables` files each row and total under —
      // without it a spreadsheet of a grouped report has a "Group" column with nothing in it.
      groupValue: context.groupValue,
      y: bandTop, height, elements: placed, rowIndex: context.rowIndex,
      section: section.isRoot ? undefined : section.key,
    });

    if (context.rowIndex !== undefined) {
      const listKey = `${section.key}#${bandPage.number}`;
      const list = pageRowIndexes.get(listKey) ?? [];
      if (!list.includes(context.rowIndex)) list.push(context.rowIndex);
      pageRowIndexes.set(listKey, list);
    }
  }

  /** Folds the rows behind a chart into one value per category. */
  function foldChartRows(element: ChartElement, rows: Array<Record<string, unknown>>, section: Section): { labels: string[]; values: number[] } {
    interface Bucket { rows: number; withValue: number; numbers: number; sum: number; min?: unknown; max?: unknown; distinct: Set<string> }
    const labels: string[] = [];
    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      // A chart's categories are read row by row, so only the row and the report's parameters are in scope.
      const rowContext = { fields: row, parameters: section.parameters, report: section.reportMeta };
      let label: string;
      try { label = toText(evaluateExpression(element.categoryExpression, rowContext)) || "(blank)"; } catch { continue; }
      let bucket = buckets.get(label);
      if (!bucket) {
        bucket = { rows: 0, withValue: 0, numbers: 0, sum: 0, distinct: new Set() };
        buckets.set(label, bucket);
        labels.push(label);
      }
      bucket.rows += 1;
      if (!element.valueExpression.trim()) continue;
      let raw: unknown;
      try { raw = evaluateExpression(element.valueExpression, rowContext); } catch { raw = undefined; }
      if (isBlank(raw)) continue;
      bucket.withValue += 1;
      bucket.distinct.add(toText(raw));
      const number = toNumber(raw);
      if (!Number.isNaN(number)) {
        bucket.numbers += 1;
        bucket.sum += number;
      }
      if (bucket.min === undefined || compareForSort(raw, bucket.min) < 0) bucket.min = raw;
      if (bucket.max === undefined || compareForSort(raw, bucket.max) > 0) bucket.max = raw;
    }
    const values = labels.map(label => {
      const bucket = buckets.get(label)!;
      switch (element.fn) {
        case "COUNT": return element.valueExpression.trim() ? bucket.withValue : bucket.rows;
        case "COUNTD": return bucket.distinct.size;
        case "AVG": return bucket.numbers ? bucket.sum / bucket.numbers : 0;
        case "MIN": return toNumber(bucket.min);
        case "MAX": return toNumber(bucket.max);
        default: return bucket.numbers ? bucket.sum : 0;
      }
    });
    return { labels, values: values.map(value => (Number.isFinite(value) ? value : 0)) };
  }

  function emitChart(placement: Placement, element: ChartElement): void {
    const { section, context, bandTop } = placement;
    const scopeRows = (pageRows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      element.scope === "page" ? pageRows
        : element.scope === "group" ? context.groupRows ?? []
          : section.sortedRows;
    const build = (pageRows: Array<Record<string, unknown>>): LaidOutChart => {
      const series = foldChartRows(element, scopeRows(pageRows), section);
      return layoutChart({
        kind: element.kind,
        box: { x: section.offsetX + element.x, y: bandTop + element.y, w: element.w, h: element.h },
        labels: series.labels,
        values: series.values,
        title: element.title,
        showLegend: element.showLegend,
        showValues: element.showValues,
        maxCategories: element.maxCategories,
        style: element.style,
        measure: request.measure,
      });
    };
    const placedElement: LaidOutElement = {
      id: element.id, type: "chart", x: section.offsetX + element.x, y: bandTop + element.y, w: element.w, h: element.h,
      payload: { kind: "chart", chart: build([]), style: element.style },
      deferred: element.scope === "page", rowIndex: context.rowIndex, groupLevel: context.groupLevel,
    };
    if (element.scope === "page") {
      const pageNumber = placement.bandPage.number;
      deferred.push({
        sectionKey: section.key,
        pageNumber,
        apply: pageRows => {
          placedElement.payload = { kind: "chart", chart: build(pageRows), style: element.style };
          placedElement.deferred = false;
        },
      });
    }
    placement.placed.push(placedElement);
  }

  /**
   * Prints a saved report inside the parent band. The child flows into the parent's pages — it does not
   * begin a report of its own — so the parent's furniture, page numbering and row count are untouched.
   */
  function emitSubreport(placement: Placement, element: SubreportElement): void {
    const { section, owner } = placement;
    const label = element.templateName || element.templateId || "the sub-report";
    const note = (text: string): void => {
      placement.placed.push({
        id: element.id, type: "subreport", x: section.offsetX + element.x, y: placement.bandTop + element.y,
        w: element.w, h: element.h, deferred: false,
        payload: placeText({
          value: text,
          element: { ...element, x: section.offsetX + element.x },
          style: element.style, bandY: placement.bandTop, measure: request.measure,
        }),
      });
    };

    const resolution = request.subreports?.[element.templateId];
    if (!element.templateId || !resolution) {
      issues.push({
        severity: "warning", code: "render.subreport", path: "bands",
        message: `Sub-report "${label}" was not printed because it was not available when this report ran.`,
        bandId: placement.band.id, elementId: element.id,
      });
      note(`Sub-report "${label}" was not available when this report ran.`);
      return;
    }

    // A sub-report is drawn in the document's ink too, but it gets no page furniture of its own: it is
    // printed on the parent's pages, and the parent's foot is the one that numbers them.
    const childDocument = inkedDocument(normaliseDocument(resolution.document), ink);
    const childIssues = validateTemplate(childDocument, { catalog: request.catalog, templates: request.templates });
    if (errorsOf(childIssues).length) {
      issues.push({
        severity: "warning", code: "render.subreport", path: "bands",
        message: `Sub-report "${label}" was not printed because its own template has errors to fix first.`,
        bandId: placement.band.id, elementId: element.id,
      });
      note(`Sub-report "${label}" has errors to fix before it can be printed.`);
      return;
    }

    const offsetX = section.offsetX + element.x;
    // The child starts where its box sits. If that box will not fit on what is left of the page, the
    // break happens here, in the parent's flow, so the parent knows a page has been used.
    if (needsNewPage(element.y + element.h)) startPage(owner, section);
    currentPage().y += element.y;

    const childParameters = resolveParameters(childDocument, resolution.parameters, issues, `subreports[${element.templateId}].`);
    const child = buildSection({
      key: `${section.key}/${element.id}`,
      isRoot: false,
      document: childDocument,
      rows: resolution.rows,
      parameters: childParameters,
      now: request.now,
    });
    sections.set(child.key, child);
    flowSection(child, { owner, inline: true, offsetX });
  }

  /** Repeats the group headers that asked for it, after a break moved the rows onto a new page. */
  function repeatGroupHeaders(section: Section, owner: Section, rowIndex: number, keys: string[]): void {
    for (let level = 0; level < section.levels; level++) {
      const group = section.groups[level]!;
      const header = section.firstOf("groupHeader", group.key);
      if (!header?.repeatOnNewPage) continue;
      const groupRows = section.groupRowsFor(rowIndex, level);
      emitBand(section, header, {
        groupLevel: level, groupRows, row: groupRows[0], groupValue: keys[level] ?? "",
      }, owner);
    }
  }

  /** Flows one document: its group openings and closings, its rows and its summary. */
  function flowSection(section: Section, options: { owner: Section; inline: boolean; offsetX: number }): void {
    const { owner, inline } = options;
    section.offsetX = options.offsetX;

    // An embedded sub-report has no page of its own, so its title and column captions are printed inline
    // once, where the box sits — everything else about the page belongs to the parent.
    if (inline) {
      for (const kind of ["reportTitle", "columnHeader"] as BandKind[]) {
        const band = section.firstOf(kind);
        if (!band) continue;
        if (needsNewPage(band.height)) startPage(owner, section);
        emitBand(section, band, {}, owner);
      }
    }

    const openLevels = new Array<boolean>(Math.max(1, section.levels)).fill(false);
    const openGroupRows = new Array<Array<Record<string, unknown>>>(Math.max(1, section.levels)).fill([]);
    let previousKeys: string[] | null = null;
    const levels = section.levels;

    for (let index = 0; index < section.sortedRows.length; index++) {
      const keys = section.sortedKeys[index]!;
      const row = section.sortedRows[index]!;

      let firstChanged = levels;
      if (previousKeys === null) firstChanged = 0;
      else {
        for (let level = 0; level < levels; level++) {
          if (keys[level] !== previousKeys[level]) { firstChanged = level; break; }
        }
      }

      // Close the groups that have ended, deepest first.
      for (let level = levels - 1; level >= firstChanged; level--) {
        if (!openLevels[level]) continue;
        const group = section.groups[level]!;
        const footer = section.firstOf("groupFooter", group.key);
        if (footer) {
          if (needsNewPage(footer.height)) startPage(owner, inline ? section : null);
          emitBand(section, footer, {
            groupLevel: level,
            groupRows: openGroupRows[level] ?? [],
            // A group footer reads the last row of its group, which is also the row the key came from.
            row: openGroupRows[level]?.[(openGroupRows[level]?.length ?? 1) - 1],
            groupValue: section.sortedKeys[index - 1]?.[level] ?? "",
          }, owner);
        }
        openLevels[level] = false;
        openGroupRows[level] = [];
      }

      // Open the groups that have started, outermost first. A running total scoped to this group restarts
      // here, which is why the reset happens before the header is printed rather than after.
      for (let level = firstChanged; level < levels; level++) {
        const group = section.groups[level]!;
        const groupRows = section.groupRowsFor(index, level);
        openLevels[level] = true;
        openGroupRows[level] = groupRows;
        resetRunning(section, group.key);

        const header = section.firstOf("groupHeader", group.key);
        if (!header) continue;
        if (header.pageBreakBefore && currentPage().y > 0) startPage(owner, inline ? section : null);
        if (group.keepTogether) {
          const total = header.height + groupRows.length * section.heightOf("detail") + section.heightOf("groupFooter", group.key);
          // A group that would fit on a page of its own is not split across two just because it started late.
          if (total <= flowHeight && needsNewPage(total) && currentPage().y > header.height) startPage(owner, inline ? section : null);
        }
        if (needsNewPage(header.height)) startPage(owner, inline ? section : null);
        emitBand(section, header, {
          groupLevel: level,
          groupRows,
          // A group header reads the first row of its group, so Fields.status prints the group's key.
          row: groupRows[0],
          groupValue: keys[level] ?? "",
        }, owner);
      }

      // The row joins the running totals before its own detail band reads them, so a band can print
      // "total so far, including me" — and the totals carry on across a page break untouched.
      accumulate(section, row);

      for (const detail of section.bandsByKind.get("detail") ?? []) {
        if (needsNewPage(detail.height)) {
          startPage(owner, inline ? section : null);
          repeatGroupHeaders(section, owner, index, keys);
        }
        emitBand(section, detail, { row, rowIndex: index }, owner);
      }

      previousKeys = keys;
    }

    for (let level = levels - 1; level >= 0; level--) {
      if (!openLevels[level]) continue;
      const group = section.groups[level]!;
      const footer = section.firstOf("groupFooter", group.key);
      if (footer) {
        if (needsNewPage(footer.height)) startPage(owner, inline ? section : null);
        const groupRows = openGroupRows[level] ?? [];
        emitBand(section, footer, {
          groupLevel: level, groupRows, row: groupRows[groupRows.length - 1],
          groupValue: section.sortedKeys[section.sortedRows.length - 1]?.[level] ?? "",
        }, owner);
      }
      openLevels[level] = false;
    }

    const summary = section.firstOf("reportSummary");
    if (summary) {
      if (summary.pageBreakBefore && currentPage().y > 0) startPage(owner, inline ? section : null);
      if (needsNewPage(summary.height)) startPage(owner, inline ? section : null);
      emitBand(section, summary, {}, owner);
    }
  }

  startPage(rootSection, null);
  flowSection(rootSection, { owner: rootSection, inline: false, offsetX: 0 });
  finishPage();

  // Deferred values, now that every page exists.
  for (const work of deferred) {
    work.apply(rowsOnPage(work.sectionKey, work.pageNumber));
  }

  if (request.limit !== undefined && rootSection.sortedRows.length >= request.limit) {
    issues.push({ severity: "warning", code: "render.limit", path: "dataSources[0].limit", message: `This report stopped at its row limit of ${request.limit}; rows beyond it are not included.` });
  }

  return {
    page: { width: page.width, height: page.height, margins: document.page.margins },
    content: { width: contentWidth, height: contentHeight },
    pages: pages.map(flow => ({
      number: flow.number,
      bands: flow.bands,
      rowIndexes: [...(pageRowIndexes.get(`${rootSection.key}#${flow.number}`) ?? [])],
    })),
    rowCount: rootSection.sortedRows.length,
    groupCount: rootSection.groupCount,
    truncated: request.limit !== undefined && rootSection.sortedRows.length >= request.limit,
    parameters,
    issues,
    refused: false,
  };
}

function refusedReport(document: ReportTemplateDocument, issues: TemplateIssue[]): LaidOutReport {
  const page = pageDimensions(document.page);
  const { width, height } = contentBox(document.page);
  return {
    page: { width: page.width, height: page.height, margins: document.page.margins },
    content: { width, height },
    pages: [],
    rowCount: 0,
    groupCount: 0,
    truncated: false,
    parameters: {},
    issues,
    refused: true,
  };
}

/** Every expression a document uses, for the designer's audit of what a template reads. */
export function collectDocumentExpressions(document: ReportTemplateDocument): string[] {
  const found: string[] = [];
  const holes = (text: string) => {
    for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) if (match[1]) found.push(match[1].trim());
  };
  for (const group of document.groups) if (group.expression) found.push(group.expression);
  for (const band of document.bands) {
    for (const element of band.elements) {
      if (element.type === "text") holes(element.text);
      else if (element.type === "field" && element.expression) found.push(element.expression);
      else if (element.type === "aggregate" && element.expression) found.push(element.expression);
      else if (element.type === "chart") {
        if (element.categoryExpression) found.push(element.categoryExpression);
        if (element.valueExpression) found.push(element.valueExpression);
      } else if (element.type === "subreport") {
        for (const binding of Object.values(element.parameterBindings)) if (binding) found.push(binding);
      } else if (element.type === "image" && element.src.includes("{{")) holes(element.src);
    }
  }
  return found;
}

export { BAND_BY_KIND };
