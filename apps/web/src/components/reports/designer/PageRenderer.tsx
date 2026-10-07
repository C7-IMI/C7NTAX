/**
 * Drawing a laid-out page (PLAN-020).
 *
 * One component renders the engine's output, and the designer, the preview, the saved report's viewer
 * and the print window all use it. Nothing here reads the *document*: an element is drawn where the
 * engine put it, so a change in the engine cannot leave one of those surfaces behind.
 *
 * Coordinates are millimetres and are converted to pixels with `zoom`, which is what makes the page on
 * screen a scaled copy of the page in the PDF rather than a re-interpretation of it.
 */
import type { CSSProperties } from "react";
import { mmToPx, type LaidOutElement, type LaidOutPage, type LaidOutReport } from "@C7NTAX/shared";
import { BAND_BACKGROUNDS } from "../../../lib/reportOutput";
import { chartSvg } from "../../../lib/reportChartSvg";
import { FONT_STACKS } from "../../../lib/reportMeasure";

const isTransparent = (colour: string | null | undefined): boolean =>
  !colour || colour === "transparent" || colour === "none";

/** A placed element's box in pixels at the current zoom. */
export function placedStyle(element: LaidOutElement, zoom: number): CSSProperties {
  return {
    position: "absolute",
    left: mmToPx(element.x) * zoom,
    top: mmToPx(element.y) * zoom,
    width: mmToPx(element.w) * zoom,
    height: mmToPx(element.h) * zoom,
  };
}

function textStyle(element: LaidOutElement): CSSProperties {
  const style = element.payload.style;
  return {
    fontFamily: FONT_STACKS[style.fontFamily].css,
    fontSize: `${style.fontSize * (96 / 72)}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    color: style.color,
    lineHeight: 1.2,
  };
}

/** One placed element. */
export function PlacedElement({ element, zoom }: { element: LaidOutElement; zoom: number }) {
  const style = element.payload.style;
  const border = style.border && !isTransparent(style.border.color)
    ? `${Math.max(0.6, mmToPx(style.border.width) * zoom)}px solid ${style.border.color}`
    : undefined;
  const background = isTransparent(style.background) ? undefined : style.background ?? undefined;

  if (element.payload.kind === "line") {
    const thickness = Math.max(0.5, mmToPx(style.border?.width ?? 0.3) * zoom);
    return (
      <div style={{ position: "absolute", left: mmToPx(element.x) * zoom, top: mmToPx(element.y) * zoom, width: mmToPx(element.w) * zoom, height: thickness }}>
        <div style={{ height: thickness, background: style.border?.color ?? "#94a3b8" }} />
      </div>
    );
  }

  if (element.payload.kind === "box") {
    return <div style={{ ...placedStyle(element, zoom), border, background }} />;
  }

  // A chart is drawn by the same function the print window uses, so the two cannot disagree — the
  // markup is a millimetre box that the `zoom` scales, not a second implementation of the geometry.
  if (element.payload.kind === "chart") {
    return <div style={{ ...placedStyle(element, zoom) }} dangerouslySetInnerHTML={{ __html: chartSvg(element.payload.chart, { zoom, origin: "box" }) }} />;
  }

  return (
    <div style={{ ...placedStyle(element, zoom), border, background, overflow: "hidden" }}>
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

/** One page of the report, at its designed size, with the band tints the designer overlays. */
export function LaidOutPageView({ page, laid, zoom, showBandTint }: {
  page: LaidOutPage;
  laid: LaidOutReport;
  zoom: number;
  showBandTint?: boolean;
}) {
  return (
    <div
      className="relative bg-white shadow-lg mx-auto"
      style={{ width: mmToPx(laid.page.width) * zoom, height: mmToPx(laid.page.height) * zoom }}
      data-page={page.number}
    >
      {showBandTint
        ? page.bands.map((band, index) => (
            <div
              key={`${band.bandId}-${index}`}
              className="absolute left-0 w-full"
              style={{
                top: mmToPx(band.y) * zoom,
                height: mmToPx(band.height) * zoom,
                background: BAND_BACKGROUNDS[band.kind] ?? "#ffffff",
                opacity: 0.55,
              }}
            />
          ))
        : null}
      {page.bands.flatMap((band, bandIndex) =>
        band.elements.map(element => <PlacedElement key={`${bandIndex}-${element.id}`} element={element} zoom={zoom} />),
      )}
      <span className="absolute text-[9px] text-gray-400" style={{ right: 4, bottom: 2 }}>
        Page {page.number} of {laid.pages.length}
      </span>
    </div>
  );
}
