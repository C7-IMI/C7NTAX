/**
 * Drawing a laid-out page (PLAN-020).
 *
 * One component renders the engine's output, and the designer, the preview, the saved report's viewer
 * and the print window all use it. Nothing here reads the *document*: an element is drawn where the
 * engine put it, so a change in the engine cannot leave one of those surfaces behind.
 *
 * Coordinates are millimetres and are converted to pixels with `zoom`, which is what makes the page on
 * screen a scaled copy of the page in the PDF rather than a re-interpretation of it. **The layout's
 * millimetres are the content box's, not the paper's**, so the page's own margins are added here —
 * once, for the tint overlay, the elements and the print window alike — and a designed report sits
 * inside its margins on screen exactly as it does in the file.
 *
 * Colours are the layout's, which the engine has already resolved to the document's palette and accent
 * (`inkStyle` in `reportLayout.ts`), so a page drawn from the dark theme is still dark ink on white
 * paper. Only the two palette values this file needs of its own are the ones the engine cannot put on
 * an element.
 */
import type { CSSProperties } from "react";
import {
  DOCUMENT_PALETTE, mmToPx,
  type LaidOutElement, type LaidOutPage, type LaidOutReport, type PageMargins,
} from "@C7NTAX/shared";
import { BAND_BACKGROUNDS, TABULAR_FORMATS } from "../../../lib/reportOutput";
import { chartSvg } from "../../../lib/reportChartSvg";
import { FONT_STACKS } from "../../../lib/reportMeasure";

const isTransparent = (colour: string | null | undefined): boolean =>
  !colour || colour === "transparent" || colour === "none";

/** A placed element's box in pixels at the current zoom, measured from the paper's top-left corner. */
export function placedStyle(element: LaidOutElement, zoom: number, margins: PageMargins): CSSProperties {
  return {
    position: "absolute",
    left: mmToPx(margins.left + element.x) * zoom,
    top: mmToPx(margins.top + element.y) * zoom,
    width: mmToPx(element.w) * zoom,
    height: mmToPx(element.h) * zoom,
  };
}

function textStyle(element: LaidOutElement): CSSProperties {
  const style = element.payload.style;
  const format = element.payload.kind === "text" ? element.payload.format : undefined;
  const figures = !!format && TABULAR_FORMATS.includes(format);
  return {
    fontFamily: FONT_STACKS[style.fontFamily].css,
    fontSize: `${style.fontSize * (96 / 72)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    fontVariantNumeric: figures ? "tabular-nums" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    color: style.color,
    lineHeight: 1.2,
  };
}

/** One placed element. */
export function PlacedElement({ element, zoom, margins }: { element: LaidOutElement; zoom: number; margins: PageMargins }) {
  const style = element.payload.style;
  const border = style.border && !isTransparent(style.border.color)
    ? `${Math.max(0.6, mmToPx(style.border.width) * zoom)}px solid ${style.border.color}`
    : undefined;
  const background = isTransparent(style.background) ? undefined : style.background ?? undefined;

  if (element.payload.kind === "line") {
    const thickness = Math.max(0.5, mmToPx(style.border?.width ?? 0.3) * zoom);
    return (
      <div style={{ ...placedStyle(element, zoom, margins), height: thickness }}>
        <div style={{ height: thickness, background: style.border?.color ?? DOCUMENT_PALETTE.rule }} />
      </div>
    );
  }

  if (element.payload.kind === "box") {
    return <div style={{ ...placedStyle(element, zoom, margins), border, background }} />;
  }

  // A chart is drawn by the same function the print window uses, so the two cannot disagree — the
  // markup is a millimetre box that the `zoom` scales, not a second implementation of the geometry.
  if (element.payload.kind === "chart") {
    return <div style={{ ...placedStyle(element, zoom, margins) }} dangerouslySetInnerHTML={{ __html: chartSvg(element.payload.chart, { zoom, origin: "box" }) }} />;
  }

  return (
    <div style={{ ...placedStyle(element, zoom, margins), border, background, overflow: "hidden" }}>
      {element.payload.kind === "image" && element.payload.src ? (
        <img src={element.payload.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : null}
      {element.payload.kind === "text"
        ? element.payload.lines.map((line, index) => (
            <span
              key={index}
              style={{
                position: "absolute",
                whiteSpace: "pre",
                left: (mmToPx(line.x) - mmToPx(element.x)) * zoom,
                top: (mmToPx(line.y) - mmToPx(element.y)) * zoom,
                ...textStyle(element),
              }}
            >
              {line.text}
            </span>
          ))
        : null}
    </div>
  );
}

/**
 * One page of the report, at its designed size, with the band tints the designer overlays.
 *
 * The page number sits *below* the sheet rather than on it: the sheet is the document, and the number
 * a reader gets on paper comes from the layout's own page footer. This is the screen's own furniture,
 * which is why it is outside the paper and in the interface's grey rather than the document's.
 */
export function LaidOutPageView({ page, laid, zoom, showBandTint }: {
  page: LaidOutPage;
  laid: LaidOutReport;
  zoom: number;
  showBandTint?: boolean;
}) {
  const margins = laid.page.margins;
  return (
    <div className="mx-auto" style={{ width: mmToPx(laid.page.width) * zoom }} data-page={page.number}>
      <div
        className="relative shadow-lg"
        // The paper is the document's own white, not the theme's `bg-white`: a screen surface token in a
        // dark theme is a soft grey, and a report whose paper is grey on screen is not the page it prints.
        style={{ background: DOCUMENT_PALETTE.paper, width: mmToPx(laid.page.width) * zoom, height: mmToPx(laid.page.height) * zoom }}
      >
        {showBandTint
          ? page.bands.map((band, index) => (
              <div
                key={`${band.bandId}-${index}`}
                className="absolute"
                style={{
                  left: mmToPx(margins.left) * zoom,
                  width: mmToPx(laid.content.width) * zoom,
                  top: mmToPx(margins.top + band.y) * zoom,
                  height: mmToPx(band.height) * zoom,
                  background: BAND_BACKGROUNDS[band.kind] ?? DOCUMENT_PALETTE.paper,
                  opacity: 0.55,
                }}
              />
            ))
          : null}
        {page.bands.flatMap((band, bandIndex) =>
          band.elements.map(element => (
            <PlacedElement key={`${bandIndex}-${element.id}`} element={element} zoom={zoom} margins={margins} />
          )),
        )}
      </div>
      <div className="pt-1 text-[9px] text-gray-400">Page {page.number} of {laid.pages.length}</div>
    </div>
  );
}
