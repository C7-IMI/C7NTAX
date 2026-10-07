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
  BAND_BY_KIND, contentBox, normaliseDocument, pageDimensions, validateTemplate, errorsOf,
  type BandKind, type CatalogSource, type ElementStyle, type ImageElement, type PageMargins,
  type ShapeElement, type TemplateBand, type TemplateElement, type ReportTemplateDocument, type TemplateIssue,
} from "./reportTemplate";
import {
  collectCalls, collectPaths, evaluateExpression, interpolateText, parseExpression, parseTextSegments,
  type AggregateFunction, type AggregateScope, type ExpressionContext,
} from "./reportExpression";
import { formatValue, type ValueFormat } from "./reportFormat";

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
  | { kind: "image"; src: string; style: ElementStyle };

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

// ── The engine ──────────────────────────────────────────────────────

interface FlowPage {
  number: number;
  bands: LaidOutBand[];
  y: number;
  rowIndexes: number[];
}

/**
 * Narrowing by a union of literals (`type === "line" || type === "box"`) does not remove the member
 * from the union, so shapes and images are identified with guards instead.
 */
const isShape = (element: TemplateElement): element is ShapeElement => element.type === "line" || element.type === "box";
const isImage = (element: TemplateElement): element is ImageElement => element.type === "image";

interface EmitContext {
  row?: Record<string, unknown>;
  rowIndex?: number;
  groupLevel?: number;
  groupRows?: Array<Record<string, unknown>>;
  /** The group's key value as text, carried from the sort so an expression group still has a label. */
  groupValue?: string;
  pageNumber: number;
}

export function layoutReport(request: LayoutRequest): LaidOutReport {
  const document = normaliseDocument(request.document);
  const issues: TemplateIssue[] = validateTemplate(document, { catalog: request.catalog });

  if (errorsOf(issues).length) {
    issues.push({ severity: "error", code: "render.refused", path: "bands", message: "The report was not generated because this template has errors to fix first." });
    return refusedReport(document, issues);
  }

  const parameters: Record<string, unknown> = {};
  for (const parameter of document.parameters) {
    const provided = request.parameters?.[parameter.key];
    let value: unknown = provided !== undefined && provided !== "" ? provided : parameter.defaultValue ?? "";
    if (value !== "" && value !== undefined) {
      if (parameter.type === "number") value = Number(value);
      else if (parameter.type === "boolean") value = value === true || value === "true" || value === "1";
      else if (parameter.type === "date") value = String(value);
    }
    if (parameter.required && (value === undefined || value === "")) {
      issues.push({ severity: "error", code: "parameter.required", path: `parameters[${parameter.key}]`, message: `This report needs "${parameter.label || parameter.key}" before it can be generated.` });
    }
    parameters[parameter.key] = value;
  }
  if (errorsOf(issues).length) {
    issues.push({ severity: "error", code: "render.refused", path: "parameters", message: "The report was not generated because it is missing something it needs." });
    return { ...refusedReport(document, issues), parameters };
  }

  const page = pageDimensions(document.page);
  const { width: contentWidth, height: contentHeight } = contentBox(document.page);

  const bandsByKind = new Map<BandKind, TemplateBand[]>();
  for (const band of document.bands) bandsByKind.set(band.kind, [...(bandsByKind.get(band.kind) ?? []), band]);
  const firstOf = (kind: BandKind, groupKey?: string): TemplateBand | undefined =>
    (bandsByKind.get(kind) ?? []).find(band => groupKey === undefined || band.groupKey === groupKey);
  const heightOf = (kind: BandKind, groupKey?: string): number => firstOf(kind, groupKey)?.height ?? 0;

  // The footers are anchored to the bottom of the page rather than flowed after the last row, so the
  // flow gets the page height minus the space they reserve.
  const footerReserve = heightOf("columnFooter") + heightOf("pageFooter");
  const flowHeight = Math.max(5, contentHeight - footerReserve);

  const rows = request.rows;
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

  const reportMeta = {
    name: document.name,
    rowCount: sortedRows.length,
    groupCount,
    generatedAt: (request.now ?? new Date()).toISOString(),
    source: document.dataSources[0]?.source ?? "",
  };

  const pages: FlowPage[] = [];
  const deferred: Array<{ pageNumber: number; apply: (pageRows: Array<Record<string, unknown>>) => void }> = [];
  const currentPage = (): FlowPage => pages[pages.length - 1]!;

  const emitBand = (band: TemplateBand, context: EmitContext): void => {
    const flow = currentPage();
    const group = context.groupLevel === undefined ? undefined : document.groups[context.groupLevel];
    const baseContext = {
      fields: context.row ?? {},
      parameters,
      report: reportMeta,
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

    const placed: LaidOutElement[] = [];

    for (const element of band.elements) {
      if (isShape(element)) {
        placed.push({
          id: element.id, type: element.type, x: element.x, y: flow.y + element.y, w: element.w, h: element.h,
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
          id: element.id, type: element.type, x: element.x, y: flow.y + element.y, w: element.w, h: element.h,
          deferred: false, payload: { kind: "image", src, style: element.style },
        });
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

      const resolve = (pageNumber: number, pageRows: Array<Record<string, unknown>>): string => {
        const ctx: ExpressionContext = {
          ...baseContext,
          page: { number: pageNumber, totalPages: pages.length, rowCount: pageRows.length },
          aggregate: aggregateRequest =>
            aggregateRequest.scope === "page"
              ? computeAggregate(aggregateRequest, pageRows)
              : computeAggregate(aggregateRequest, aggregateRequest.scope === "group" ? context.groupRows ?? [] : sortedRows),
          dataSource: request.dataSources
            ? (key: string, path: string) => readField(request.dataSources?.[key]?.[0], path)
            : undefined,
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
        id: element.id, type: element.type, x: element.x, y: flow.y + element.y, w: element.w, h: element.h,
        payload: placeText({ value: resolve(flow.number, []), element, style: element.style, bandY: flow.y, measure: request.measure, format }),
        deferred: isDeferred, rowIndex: context.rowIndex, groupLevel: context.groupLevel,
      };

      if (isDeferred) {
        // The page is fixed at placement time, so the patch pass knows which page's rows to total.
        const pageNumber = flow.number;
        deferred.push({
          pageNumber,
          apply: pageRows => {
            placedElement.payload = placeText({
              value: resolve(pageNumber, pageRows), element, style: element.style, bandY: flow.y, measure: request.measure, format,
            });
            placedElement.deferred = false;
          },
        });
      }

      placed.push(placedElement);
    }

    flow.bands.push({
      bandId: band.id, kind: band.kind, groupKey: band.groupKey, groupLevel: context.groupLevel,
      y: flow.y, height: band.height, elements: placed, rowIndex: context.rowIndex,
    });
    flow.y += band.height;
  };

  /** The footers of the page being left, anchored to the bottom of its content area. */
  const finishPage = (): void => {
    const flow = currentPage();
    const columnFooter = firstOf("columnFooter");
    const pageFooter = firstOf("pageFooter");
    if (columnFooter) {
      flow.y = Math.max(flow.y, contentHeight - footerReserve);
      emitBand(columnFooter, { pageNumber: flow.number });
    }
    if (pageFooter) {
      flow.y = Math.max(flow.y, contentHeight - heightOf("pageFooter"));
      emitBand(pageFooter, { pageNumber: flow.number });
    }
  };

  const startPage = (): FlowPage => {
    if (pages.length) finishPage();
    const flow: FlowPage = { number: pages.length + 1, bands: [], y: 0, rowIndexes: [] };
    pages.push(flow);
    const header = firstOf("pageHeader");
    if (header) emitBand(header, { pageNumber: flow.number });
    if (flow.number === 1) {
      const title = firstOf("reportTitle");
      if (title) emitBand(title, { pageNumber: flow.number });
    }
    const columnHeader = firstOf("columnHeader");
    if (columnHeader) emitBand(columnHeader, { pageNumber: flow.number });
    return flow;
  };

  const needsNewPage = (height: number): boolean => currentPage().y + height > flowHeight + 0.001;

  /** Repeats the group headers that asked for it, after a break moved the rows onto a new page. */
  const repeatGroupHeaders = (rowIndex: number, keys: string[]): void => {
    for (let level = 0; level < levels; level++) {
      const group = document.groups[level]!;
      const header = firstOf("groupHeader", group.key);
      if (!header?.repeatOnNewPage) continue;
      const groupRows = groupRowsFor(rowIndex, level);
      emitBand(header, {
        groupLevel: level, groupRows, row: groupRows[0], groupValue: keys[level] ?? "",
        pageNumber: currentPage().number,
      });
    }
  };

  startPage();
  const openLevels = new Array<boolean>(Math.max(1, levels)).fill(false);
  const openGroupRows = new Array<Array<Record<string, unknown>>>(Math.max(1, levels)).fill([]);
  let previousKeys: string[] | null = null;

  for (let index = 0; index < sortedRows.length; index++) {
    const keys = sortedKeys[index]!;
    const row = sortedRows[index]!;

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
      const group = document.groups[level]!;
      const footer = firstOf("groupFooter", group.key);
      if (footer) {
        if (needsNewPage(footer.height)) startPage();
        emitBand(footer, {
          groupLevel: level,
          groupRows: openGroupRows[level] ?? [],
          // A group footer reads the last row of its group, which is also the row the key came from.
          row: openGroupRows[level]?.[(openGroupRows[level]?.length ?? 1) - 1],
          groupValue: sortedKeys[index - 1]?.[level] ?? "",
          pageNumber: currentPage().number,
        });
      }
      openLevels[level] = false;
      openGroupRows[level] = [];
    }

    // Open the groups that have started, outermost first.
    for (let level = firstChanged; level < levels; level++) {
      const group = document.groups[level]!;
      const groupRows = groupRowsFor(index, level);
      openLevels[level] = true;
      openGroupRows[level] = groupRows;

      const header = firstOf("groupHeader", group.key);
      if (!header) continue;
      if (header.pageBreakBefore && currentPage().y > 0) startPage();
      if (group.keepTogether) {
        const total = header.height + groupRows.length * heightOf("detail") + heightOf("groupFooter", group.key);
        // A group that would fit on a page of its own is not split across two just because it started late.
        if (total <= flowHeight && needsNewPage(total) && currentPage().y > header.height) startPage();
      }
      if (needsNewPage(header.height)) startPage();
      emitBand(header, {
        groupLevel: level,
        groupRows,
        // A group header reads the first row of its group, so Fields.status prints the group's key.
        row: groupRows[0],
        groupValue: keys[level] ?? "",
        pageNumber: currentPage().number,
      });
    }

    for (const detail of bandsByKind.get("detail") ?? []) {
      if (needsNewPage(detail.height)) {
        startPage();
        repeatGroupHeaders(index, keys);
      }
      emitBand(detail, { row, rowIndex: index, pageNumber: currentPage().number });
      const flow = currentPage();
      if (!flow.rowIndexes.includes(index)) flow.rowIndexes.push(index);
    }

    previousKeys = keys;
  }

  for (let level = levels - 1; level >= 0; level--) {
    if (!openLevels[level]) continue;
    const group = document.groups[level]!;
    const footer = firstOf("groupFooter", group.key);
    if (footer) {
      if (needsNewPage(footer.height)) startPage();
      const groupRows = openGroupRows[level] ?? [];
      emitBand(footer, {
        groupLevel: level, groupRows, row: groupRows[groupRows.length - 1],
        groupValue: sortedKeys[sortedRows.length - 1]?.[level] ?? "",
        pageNumber: currentPage().number,
      });
    }
    openLevels[level] = false;
  }

  const summary = firstOf("reportSummary");
  if (summary) {
    if (summary.pageBreakBefore && currentPage().y > 0) startPage();
    if (needsNewPage(summary.height)) startPage();
    emitBand(summary, { pageNumber: currentPage().number });
  }

  finishPage();

  // Deferred values, now that every page exists.
  for (const work of deferred) {
    const flow = pages.find(candidate => candidate.number === work.pageNumber);
    work.apply((flow?.rowIndexes ?? []).map(rowIndex => sortedRows[rowIndex]!));
  }

  if (request.limit !== undefined && sortedRows.length >= request.limit) {
    issues.push({ severity: "warning", code: "render.limit", path: "dataSources[0].limit", message: `This report stopped at its row limit of ${request.limit}; rows beyond it are not included.` });
  }

  return {
    page: { width: page.width, height: page.height, margins: document.page.margins },
    content: { width: contentWidth, height: contentHeight },
    pages: pages.map(flow => ({ number: flow.number, bands: flow.bands, rowIndexes: flow.rowIndexes })),
    rowCount: sortedRows.length,
    groupCount,
    truncated: request.limit !== undefined && sortedRows.length >= request.limit,
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
      else if (element.type === "image" && element.src.includes("{{")) holes(element.src);
    }
  }
  return found;
}

export { BAND_BY_KIND };
