/**
 * Drawing a laid-out chart as SVG (PLAN-020 phase 6).
 *
 * One function produces the markup, and both the screen and the print window use it — the screen
 * through the designer's page renderer, the print window by writing the same string into the print
 * document. The chart's geometry was computed once, in millimetres, by `layoutChart`; this only turns
 * those millimetres into `<rect>`, `<line>`, `<path>` and `<text>` elements, which is why a chart
 * cannot look one way in the preview and another way on paper.
 *
 * The SVG's coordinate system is a millimetre box around the chart, so every shape is placed at
 * `value - box.x` and the browser (or the printer) scales the whole thing with the page.
 */
import { PT_TO_MM, type ChartLabel, type LaidOutChart } from "@C7NTAX/shared";
import { FONT_STACKS } from "./reportMeasure";

const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] as string));

const round = (value: number): string => (Math.round(value * 1000) / 1000).toString();

/** A point on a pie: radians clockwise from twelve o'clock, which is how the engine measured them. */
const polar = (cx: number, cy: number, r: number, angle: number): [number, number] =>
  [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];

function slicePath(chart: LaidOutChart, startAngle: number, endAngle: number): string {
  const { x: ox, y: oy } = chart.box;
  const cx = chart.centre.x - ox;
  const cy = chart.centre.y - oy;
  const { r, innerR } = chart.centre;
  // A whole circle cannot be drawn with one arc — the start and end points coincide — so it is drawn as
  // two half arcs, which is exactly what a single category of 100% needs.
  const full = endAngle - startAngle >= Math.PI * 2 - 1e-6;
  const end = full ? startAngle + Math.PI : endAngle;

  const drawArc = (from: number, to: number): string => {
    const [x1, y1] = polar(cx, cy, r, from);
    const [x2, y2] = polar(cx, cy, r, to);
    return `M ${round(x1)} ${round(y1)} A ${round(r)} ${round(r)} 0 ${to - from > Math.PI ? 1 : 0} 1 ${round(x2)} ${round(y2)}`;
  };

  if (!innerR) {
    const first = drawArc(startAngle, end);
    return full
      ? `${first} ${drawArc(startAngle + Math.PI, startAngle + Math.PI * 2)} Z`
      : `${first} L ${round(cx)} ${round(cy)} Z`;
  }

  const [ix2, iy2] = polar(cx, cy, innerR, end);
  const [ix1, iy1] = polar(cx, cy, innerR, startAngle);
  const inner = `L ${round(ix2)} ${round(iy2)} A ${round(innerR)} ${round(innerR)} 0 ${end - startAngle > Math.PI ? 1 : 0} 0 ${round(ix1)} ${round(iy1)}`;
  return `${drawArc(startAngle, end)} ${inner} Z`;
}

function labelXml(chart: LaidOutChart, label: ChartLabel): string {
  const family = FONT_STACKS[label.fontFamily].css.split(",")[0]?.replace(/"/g, "") ?? "sans-serif";
  return `<text x="${round(label.x - chart.box.x)}" y="${round(label.baselineY - chart.box.y)}" fill="${label.colour}"`
    + ` font-size="${round(label.fontSize * PT_TO_MM)}" font-family="${escapeXml(family)}"`
    + ` font-weight="${label.bold ? 700 : 400}" xml:space="preserve">${escapeXml(label.text)}</text>`;
}

/**
 * The chart as an absolutely positioned `<svg>`, in millimetres. `zoom` scales the outer box only: the
 * `viewBox` does the rest, so the drawing inside is resolution independent.
 *
 * `origin` says what the box is positioned against: `"page"` for the print document, where the markup
 * is written straight into a full-page container, and `"box"` when the caller has already placed a
 * wrapper at the element's own coordinates — as the screen does, so the chart is clipped and selected
 * with the element it belongs to.
 */
export function chartSvg(chart: LaidOutChart, options: { zoom?: number; origin?: "page" | "box" } = {}): string {
  const zoom = options.zoom ?? 1;
  const origin = options.origin ?? "page";
  const { x: ox, y: oy, w, h } = chart.box;
  const shiftX = (value: number) => value - ox;
  const shiftY = (value: number) => value - oy;

  const parts: string[] = [];
  for (const grid of chart.gridLines) {
    parts.push(`<line x1="${round(shiftX(grid.x1))}" y1="${round(shiftY(grid.y1))}" x2="${round(shiftX(grid.x2))}" y2="${round(shiftY(grid.y2))}" stroke="${grid.colour}" stroke-width="0.15"/>`);
  }
  for (const bar of chart.bars) {
    parts.push(`<rect x="${round(shiftX(bar.x))}" y="${round(shiftY(bar.y))}" width="${round(bar.w)}" height="${round(bar.h)}" fill="${bar.colour}"/>`);
  }
  for (const line of chart.axis) {
    parts.push(`<line x1="${round(shiftX(line.x1))}" y1="${round(shiftY(line.y1))}" x2="${round(shiftX(line.x2))}" y2="${round(shiftY(line.y2))}" stroke="#64748b" stroke-width="0.2"/>`);
  }
  for (const slice of chart.slices) {
    parts.push(`<path d="${slicePath(chart, slice.startAngle, slice.endAngle)}" fill="${slice.colour}" stroke="#ffffff" stroke-width="0.2"/>`);
  }
  if (chart.points.length === 1) {
    const point = chart.points[0]!;
    parts.push(`<circle cx="${round(shiftX(point.x))}" cy="${round(shiftY(point.y))}" r="0.7" fill="#0f766e"/>`);
  } else if (chart.points.length > 1) {
    const line = chart.points.map(point => `${round(shiftX(point.x))},${round(shiftY(point.y))}`).join(" ");
    parts.push(`<polyline points="${line}" fill="none" stroke="#0f766e" stroke-width="0.5" stroke-linejoin="round"/>`);
    for (const point of chart.points) parts.push(`<circle cx="${round(shiftX(point.x))}" cy="${round(shiftY(point.y))}" r="0.6" fill="#0f766e"/>`);
  }
  for (const swatch of chart.legendSwatches) {
    parts.push(`<rect x="${round(shiftX(swatch.x))}" y="${round(shiftY(swatch.y))}" width="${round(swatch.w)}" height="${round(swatch.h)}" fill="${swatch.colour}"/>`);
  }
  for (const label of chart.labels) parts.push(labelXml(chart, label));

  const origin_ = origin === "box" ? 0 : ox;
  const originY = origin === "box" ? 0 : oy;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" preserveAspectRatio="none" `
    + `style="position:absolute;left:${round(origin_ * zoom)}mm;top:${round(originY * zoom)}mm;width:${round(w * zoom)}mm;height:${round(h * zoom)}mm;overflow:hidden">`
    + `${parts.join("")}</svg>`;
}
