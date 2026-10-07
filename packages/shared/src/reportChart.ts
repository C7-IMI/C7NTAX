/**
 * Chart geometry for a designed report (PLAN-020 phase 6).
 *
 * A chart element is data — a category field, a value field and a function — and this module turns that
 * data into **placed shapes in millimetres**, exactly as the text layout engine does for text. The screen
 * draws them as SVG and the PDF draws them with jsPDF's primitives, from the same numbers, which is what
 * keeps a printed chart looking like the one that was designed.
 *
 * The alternative — letting each renderer decide how to draw a chart — is how a report ends up with a
 * preview that disagrees with its PDF, so the geometry is computed once, here, and never re-derived.
 */
import type { ChartKind, ElementStyle } from "./reportTemplate";
import { PT_TO_MM, LINE_HEIGHT_FACTOR } from "./reportLayout";
import type { MeasureText } from "./reportLayout";

/** A chart's colours, in order. Deliberately distinct in greyscale as well as in colour. */
export const CHART_COLOURS = [
  "#22d3ee", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#38bdf8", "#4ade80", "#f472b6",
  "#facc15", "#2dd4bf", "#c084fc", "#fb923c",
];

export interface ChartDatum {
  label: string;
  value: number;
  /** value ÷ total, or 0 when the total is 0. */
  share: number;
  colour: string;
}

export interface ChartShape {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
  /** Which datum it belongs to, so a renderer can attach a tooltip on screen. */
  datumIndex: number;
}

export interface ChartSlice {
  /** Radians, clockwise from twelve o'clock. */
  startAngle: number;
  endAngle: number;
  colour: string;
  datumIndex: number;
}

/** A chart's label, carrying its own font so a renderer never has to guess what it is drawing. */
export interface ChartLabel {
  text: string;
  x: number;
  y: number;
  baselineY: number;
  width: number;
  role: "title" | "category" | "value" | "legend" | "axis" | "note";
  colour: string;
  fontSize: number;
  fontFamily: ElementStyle["fontFamily"];
  bold: boolean;
}

export interface LaidOutChart {
  kind: ChartKind;
  title?: string;
  box: { x: number; y: number; w: number; h: number };
  /** The drawing area, once the axis labels and the legend have taken their space. */
  plot: { x: number; y: number; w: number; h: number };
  data: ChartDatum[];
  /** Every value was zero, so there is nothing to draw — the renderer says so instead of drawing axes. */
  empty: boolean;
  bars: ChartShape[];
  points: Array<{ x: number; y: number; datumIndex: number }>;
  gridLines: Array<{ x1: number; y1: number; x2: number; y2: number; colour: string }>;
  axis: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  slices: ChartSlice[];
  centre: { x: number; y: number; r: number; innerR: number };
  legendSwatches: Array<{ x: number; y: number; w: number; h: number; colour: string }>;
  labels: ChartLabel[];
}

export interface ChartRequest {
  kind: ChartKind;
  /** Absolute position of the element on the page, in millimetres. */
  box: { x: number; y: number; w: number; h: number };
  labels: string[];
  values: number[];
  title?: string;
  showLegend?: boolean;
  showValues?: boolean;
  /** How many categories to draw before the rest are folded into "Other". */
  maxCategories?: number;
  style: ElementStyle;
  measure: MeasureText;
}

const AXIS_LABEL_SIZE = 6.5;
const TITLE_SIZE = 8;
const VALUE_SIZE = 6.5;
const LEGEND_SIZE = 6.5;

const textStyle = (style: ElementStyle, fontSize: number) => ({
  fontFamily: style.fontFamily, fontSize, bold: false, italic: false,
});

/** The tallest a column can be, and the widest a bar, so a chart with one category is not a slab. */
const MAX_BAR_THICKNESS = 18;

export function layoutChart(request: ChartRequest): LaidOutChart {
  const { box, style, measure } = request;
  const labels: ChartLabel[] = [];
  const lineHeight = (size: number) => size * LINE_HEIGHT_FACTOR * PT_TO_MM;

  /** Places one line of text, honouring an anchor, and records the font it was measured with. */
  const put = (
    role: ChartLabel["role"],
    text: string,
    x: number,
    y: number,
    size: number,
    anchor: "start" | "middle" | "end" = "start",
    colour?: string,
  ) => {
    if (!text) return;
    const font = textStyle(style, size);
    const width = measure(text, font);
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    labels.push({
      role, text, x: left, y, baselineY: y + size * 0.8 * PT_TO_MM, width,
      colour: colour ?? style.color, fontSize: size, fontFamily: style.fontFamily, bold: false,
    });
  };

  // Fold the tail of a long list into "Other" so the axis stays readable.
  const limit = Math.max(1, Math.min(50, request.maxCategories ?? 12));
  let categoryLabels = request.labels.map(label => label || "(none)");
  let values = [...request.values];
  if (categoryLabels.length > limit) {
    const head = categoryLabels.slice(0, limit - 1);
    const headValues = values.slice(0, limit - 1);
    const restValues = values.slice(limit - 1);
    head.push(`Other (${categoryLabels.length - head.length})`);
    headValues.push(restValues.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0));
    categoryLabels = head;
    values = headValues;
  }

  const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  const data: ChartDatum[] = categoryLabels.map((label, index) => ({
    label,
    value: Number.isFinite(values[index]) ? values[index]! : 0,
    share: total === 0 ? 0 : (values[index] ?? 0) / total,
    colour: CHART_COLOURS[index % CHART_COLOURS.length]!,
  }));

  const pie = request.kind === "pie" || request.kind === "donut";
  const horizontal = request.kind === "bar";
  const showLegend = request.showLegend ?? (pie || data.length > 1);
  const showValues = request.showValues ?? false;
  const empty = !data.length || (pie ? total <= 0 : data.every(datum => datum.value === 0));

  const chart: LaidOutChart = {
    kind: request.kind,
    title: request.title,
    box,
    plot: { x: box.x, y: box.y, w: box.w, h: box.h },
    data,
    empty,
    bars: [],
    points: [],
    gridLines: [],
    axis: [],
    slices: [],
    centre: { x: box.x + box.w / 2, y: box.y + box.h / 2, r: 0, innerR: 0 },
    legendSwatches: [],
    labels,
  };

  // Title, then the area the chart itself may use.
  let top = box.y;
  if (request.title) {
    put("title", request.title, box.x, top, TITLE_SIZE);
    top += lineHeight(TITLE_SIZE) + 1;
  }

  if (empty) {
    put("note", "No data", box.x, top + Math.max(0, (box.y + box.h - top) / 2 - 2), style.fontSize);
    return chart;
  }

  // The legend: a column down the right for pie/donut, a row along the bottom otherwise.
  const legendOnRight = pie;
  const legendWidth = legendOnRight ? Math.min(box.w * 0.42, 45) : 0;
  const legendHeight = showLegend && !legendOnRight ? lineHeight(LEGEND_SIZE) + 1 : 0;
  const area = {
    x: box.x,
    y: top,
    w: Math.max(10, box.w - legendWidth),
    h: Math.max(10, box.y + box.h - top - legendHeight),
  };

  if (showLegend) {
    if (legendOnRight) {
      const swatch = 2.4;
      let y = area.y + 1;
      for (const datum of data) {
        if (y + lineHeight(LEGEND_SIZE) > box.y + box.h) break;
        chart.legendSwatches.push({ x: area.x + area.w + 1.5, y, w: swatch, h: swatch, colour: datum.colour });
        const text = measure(datum.label, textStyle(style, LEGEND_SIZE)) > legendWidth - swatch - 3
          ? `${datum.label.slice(0, Math.max(3, Math.floor((legendWidth - swatch - 3) / 1.4)))}…`
          : datum.label;
        put("legend", text, area.x + area.w + 1.5 + swatch + 1, y, LEGEND_SIZE, "start", style.color);
        y += Math.max(lineHeight(LEGEND_SIZE), swatch) + 0.8;
      }
    } else {
      let x = box.x;
      const y = box.y + box.h - lineHeight(LEGEND_SIZE);
      for (const datum of data) {
        const width = measure(datum.label, textStyle(style, LEGEND_SIZE));
        if (x + 2.4 + 1 + width > box.x + box.w) break;
        chart.legendSwatches.push({ x, y: y + 0.6, w: 2.4, h: 2.4, colour: datum.colour });
        put("legend", datum.label, x + 3.4, y, LEGEND_SIZE);
        x += 3.4 + width + 4;
      }
    }
  }

  if (pie) {
    const radius = Math.max(3, Math.min(area.w, area.h) / 2 - 1);
    chart.centre = { x: area.x + area.w / 2, y: area.y + area.h / 2, r: radius, innerR: request.kind === "donut" ? radius * 0.55 : 0 };
    let angle = 0;
    data.forEach((datum, index) => {
      const sweep = datum.share * Math.PI * 2;
      chart.slices.push({ startAngle: angle, endAngle: angle + sweep, colour: datum.colour, datumIndex: index });
      angle += sweep;
    });
    return chart;
  }

  // Axis charts: reserve room on the left for the value labels and at the bottom for the categories.
  const valueLabels = data.map(datum => formatTick(datum.value));
  const maxLabelWidth = Math.max(...valueLabels.map(text => measure(text, textStyle(style, AXIS_LABEL_SIZE))), 6);
  const categorySize = horizontal
    ? Math.max(...data.map(datum => measure(datum.label, textStyle(style, AXIS_LABEL_SIZE))), 6)
    : 0;
  const gutter = horizontal ? Math.min(categorySize + 1.5, area.w * 0.4) : maxLabelWidth + 1.5;
  const categoryGutter = horizontal ? 0 : lineHeight(AXIS_LABEL_SIZE) + 1;

  const plot = {
    x: area.x + gutter,
    y: area.y,
    w: Math.max(5, area.w - gutter),
    h: Math.max(5, area.h - categoryGutter),
  };
  chart.plot = plot;

  // The scale: nought is always on it (a bar chart without its baseline misleads), the top is rounded to
  // a number a reader can divide, and a negative value gets room below the baseline rather than being
  // drawn as a positive bar.
  const lowest = Math.min(...data.map(datum => datum.value), 0);
  const highest = Math.max(...data.map(datum => datum.value), 0);
  const ceiling = highest <= 0 ? 1 : niceCeiling(highest);
  const span = Math.max(ceiling - lowest, 0.0001);  const offsetOf = (value: number) => (value - lowest) / span;
  const yOf = (value: number) => plot.y + plot.h * (1 - offsetOf(value));
  const zeroAt = yOf(0);

  // Four grid lines, labelled, which is enough to read a value off without becoming graph paper.
  for (let step = 0; step <= 4; step++) {
    const value = lowest + (span * step) / 4;
    if (horizontal) {
      const x = plot.x + plot.w * ((value - lowest) / span);
      chart.gridLines.push({ x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, colour: "#e2e8f0" });
      put("axis", formatTick(value), x, plot.y + plot.h + 0.5, AXIS_LABEL_SIZE, "middle");
    } else {
      const y = yOf(value);
      chart.gridLines.push({ x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, colour: "#e2e8f0" });
      put("axis", formatTick(value), plot.x - 1, y - lineHeight(AXIS_LABEL_SIZE) / 2, AXIS_LABEL_SIZE, "end");
    }
  }

  // The two axes, drawn last so they sit over the grid.
  chart.axis.push(
    { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h },
    { x1: plot.x, y1: zeroAt, x2: plot.x + plot.w, y2: zeroAt },
  );

  const band = (horizontal ? plot.h : plot.w) / data.length;
  const thickness = Math.min(MAX_BAR_THICKNESS, Math.max(1, band * 0.6));

  if (request.kind === "line") {
    data.forEach((datum, index) => {
      const x = plot.x + band * (index + 0.5);
      const y = yOf(datum.value);
      chart.points.push({ x, y, datumIndex: index });
      put("category", datum.label, x, plot.y + plot.h + 0.5, AXIS_LABEL_SIZE, "middle");
      if (showValues) put("value", formatTick(datum.value), x, y - lineHeight(VALUE_SIZE) - 0.5, VALUE_SIZE, "middle");
    });
  } else if (horizontal) {
    const origin = plot.x + plot.w * ((0 - lowest) / span);
    data.forEach((datum, index) => {
      const y = plot.y + band * (index + 0.5) - thickness / 2;
      const end = plot.x + plot.w * ((datum.value - lowest) / span);
      chart.bars.push({ x: Math.min(origin, end), y, w: Math.max(0.2, Math.abs(end - origin)), h: thickness, colour: datum.colour, datumIndex: index });
      put("category", datum.label, plot.x - 1, y + thickness / 2 - lineHeight(AXIS_LABEL_SIZE) / 2, AXIS_LABEL_SIZE, "end");
      if (showValues) put("value", formatTick(datum.value), end + 0.8, y + thickness / 2 - lineHeight(VALUE_SIZE) / 2, VALUE_SIZE);
    });
  } else {
    data.forEach((datum, index) => {
      const x = plot.x + band * (index + 0.5) - thickness / 2;
      const y = yOf(datum.value);
      chart.bars.push({ x, y: Math.min(zeroAt, y), w: thickness, h: Math.max(0.2, Math.abs(zeroAt - y)), colour: datum.colour, datumIndex: index });
      put("category", datum.label, x + thickness / 2, plot.y + plot.h + 0.5, AXIS_LABEL_SIZE, "middle");
      if (showValues) put("value", formatTick(datum.value), x + thickness / 2, Math.min(zeroAt, y) - lineHeight(VALUE_SIZE) - 0.5, VALUE_SIZE, "middle");
    });
  }

  return chart;
}

/** A round ceiling so the top grid line is a number a person reads easily. */
function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  for (const step of steps) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** An axis tick: a whole number, or one decimal when the values are small. */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return rounded.toLocaleString();
}

export { PT_TO_MM };
