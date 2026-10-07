/**
 * Text measurement for the banded layout engine (PLAN-020).
 *
 * The engine works in millimetres and has no fonts of its own, so it is handed a function that answers
 * "how wide is this line in millimetres". The browser answers with a canvas, whose `measureText` uses
 * the same font stack the report is drawn with — which is what keeps the wrap points in the preview
 * and in the PDF in the same places.
 */
import { MM_PER_PX, type MeasureText, type TextStyle } from "@C7NTAX/shared";

/**
 * The font stacks the PDF can also honour: jsPDF ships Helvetica, Times and Courier, and these are the
 * CSS equivalents of them, so a line measured here is a line the PDF draws.
 */
export const FONT_STACKS: Record<TextStyle["fontFamily"], { css: string; pdf: string }> = {
  sans: { css: '"Helvetica Neue", Helvetica, Arial, sans-serif', pdf: "helvetica" },
  serif: { css: '"Times New Roman", Times, serif', pdf: "times" },
  mono: { css: '"Courier New", Courier, monospace', pdf: "courier" },
};

let context: CanvasRenderingContext2D | null = null;
function measuringContext(): CanvasRenderingContext2D | null {
  if (context) return context;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  context = canvas.getContext("2d");
  return context;
}

const cache = new Map<string, number>();

/** Font sizes are points; CSS wants pixels, and there are 96 of those to the inch. */
export const pointToPx = (points: number): number => (points * 96) / 72;

export function fontCss(style: TextStyle): string {
  return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${pointToPx(style.fontSize)}px ${FONT_STACKS[style.fontFamily].css}`;
}

/**
 * A line's width in millimetres. Falls back to a character estimate when there is no canvas (the
 * server, or a test), so a layout can always be produced — the estimate is only ever a little wrong,
 * never absent.
 */
export const measureTextMm: MeasureText = (text, style) => {
  if (!text) return 0;
  const key = `${fontCss(style)}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const ctx = measuringContext();
  let width: number;
  if (ctx) {
    ctx.font = fontCss(style);
    width = ctx.measureText(text).width * MM_PER_PX;
  } else {
    width = text.length * style.fontSize * 0.5 * (25.4 / 72);
  }
  // Bounded, because a designer typing into a long field would otherwise grow this without limit.
  if (cache.size > 4000) cache.clear();
  cache.set(key, width);
  return width;
};

/** Converts a laid-out text line's font back to what jsPDF wants. */
export function pdfFont(style: TextStyle): { font: string; style: string } {
  const font = FONT_STACKS[style.fontFamily].pdf;
  const weight = style.bold && style.italic ? "bolditalic" : style.bold ? "bold" : style.italic ? "italic" : "normal";
  return { font, style: weight };
}
