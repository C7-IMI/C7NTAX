/**
 * The design canvas (PLAN-020).
 *
 * Bands are stacked in the order they print, at the page's real width and margins, so **horizontal
 * positions on this canvas are the positions on the page** — column widths, alignment and overflow are
 * decided here rather than discovered in the PDF. Vertical arrangement is the band order, with a dashed
 * line where the printable area ends; pagination itself is the Preview tab's job, because a designer
 * that paginated while you edited would move your elements around under the cursor.
 *
 * Elements are dragged and resized in millimetres, snapped to a millimetre (a quarter with Alt), and
 * clamped to their band — an element that could be dropped past its band's bottom would be clipped the
 * moment the report ran, which the validator would then refuse.
 */
import { useEffect, useRef, useState } from "react";
import {
  MM_PER_PX, contentBox, inkStyle, mmToPx, pageDimensions,
  type LaidOutChart, type PageSetup, type ReportTemplateDocument, type TemplateBand, type TemplateElement, type TemplateIssue,
} from "@C7NTAX/shared";
import { chartSvg } from "../../../lib/reportChartSvg";
import type { Selection } from "./Inspector";

const BAND_TINTS: Record<string, string> = {
  pageHeader: "rgba(148,163,184,.12)",
  reportTitle: "rgba(34,211,238,.10)",
  columnHeader: "rgba(148,163,184,.16)",
  groupHeader: "rgba(34,211,238,.14)",
  detail: "rgba(255,255,255,.03)",
  groupFooter: "rgba(20,184,166,.12)",
  columnFooter: "rgba(148,163,184,.10)",
  pageFooter: "rgba(148,163,184,.10)",
  reportSummary: "rgba(250,204,21,.10)",
};

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface DragState {
  bandId: string;
  elementId: string;
  mode: Handle | "move";
  startX: number;
  startY: number;
  origin: { x: number; y: number; w: number; h: number };
  pushed: boolean;
}

interface CanvasProps {
  document: ReportTemplateDocument;
  selection: Selection;
  zoom: number;
  issues: TemplateIssue[];
  /** elementId → the value it prints with the current data, so the canvas shows real content. */
  values: Map<string, string>;
  /** elementId → the chart the current data produced, so a chart is designed against real numbers. */
  charts: Map<string, LaidOutChart>;
  onSelect: (selection: Selection) => void;
  onDocument: (next: ReportTemplateDocument, options?: { push?: boolean }) => void;
  onDropField: (bandId: string, fieldKey: string, at: { x: number; y: number }) => void;
  /**
   * The two views a designer looks *through* rather than edits.
   *
   * Both default to on, so the classic designer — which does not pass them — draws exactly what it
   * always drew. The Modern one offers them as chips: a grid you can turn off is what lets you
   * judge spacing against the sheet, and band guides you can turn off are what lets you see the
   * report as the reader will.
   */
  showGrid?: boolean;
  showBandGuides?: boolean;
  /** The sheet the instance's presentation asks for, when it differs from the document's own setup. */
  page?: PageSetup;
  /** The instance's one accent, so the canvas draws the group rule the way the paper will. */
  accent?: string;
}

/** The order bands are shown in: how they will print, top to bottom. */
export function designBandOrder(document: ReportTemplateDocument): TemplateBand[] {
  const take = (kind: string, groupKey?: string) =>
    document.bands.find(band => band.kind === kind && (groupKey === undefined ? !band.groupKey : band.groupKey === groupKey));
  const ordered: TemplateBand[] = [];
  const push = (band: TemplateBand | undefined) => { if (band && !ordered.includes(band)) ordered.push(band); };

  push(take("pageHeader"));
  push(take("reportTitle"));
  push(take("columnHeader"));
  for (const group of document.groups) push(take("groupHeader", group.key));
  push(take("detail"));
  for (const group of [...document.groups].reverse()) push(take("groupFooter", group.key));
  push(take("reportSummary"));
  push(take("columnFooter"));
  push(take("pageFooter"));
  // Anything the order above did not name (a second group header, a band added out of turn) still shows.
  for (const band of document.bands) push(band);
  return ordered;
}

export function DesignerCanvas({ document, page, accent, selection, zoom, issues, values, charts, onSelect, onDocument, onDropField, showGrid = true, showBandGuides = true }: CanvasProps) {
  // The sheet this design will print on. It is the document's own page setup unless the instance's
  // presentation asks for another sheet (`paperFor`), in which case the canvas draws *that* one — the
  // authoring surface and the printed page are the same page, which is the whole point of it.
  const setup = page ?? document.page;
  const dims = pageDimensions(setup);
  const content = contentBox(setup);
  const pxPerMm = mmToPx(1) * zoom;
  const pageWidthPx = mmToPx(dims.width) * zoom;
  const contentWidthPx = mmToPx(content.width) * zoom;
  const marginLeftPx = mmToPx(setup.margins.left) * zoom;
  const marginTopPx = mmToPx(setup.margins.top) * zoom;

  const drag = useRef<DragState | null>(null);
  const [hoverBandId, setHoverBandId] = useState<string | null>(null);
  const [snapHint, setSnapHint] = useState<string | null>(null);

  const bands = designBandOrder(document);
  const footerReserve = (document.bands.find(band => band.kind === "columnFooter")?.height ?? 0)
    + (document.bands.find(band => band.kind === "pageFooter")?.height ?? 0);
  const flowLimitPx = marginTopPx + mmToPx(content.height - footerReserve) * zoom;

  const updateElement = (bandId: string, elementId: string, patch: Partial<TemplateElement>, options?: { push?: boolean }) => {
    const next: ReportTemplateDocument = {
      ...document,
      bands: document.bands.map(band =>
        band.id === bandId
          ? { ...band, elements: band.elements.map(element => (element.id === elementId ? ({ ...element, ...patch } as TemplateElement) : element)) }
          : band),
    };
    onDocument(next, options);
  };

  // Pointer moves are tracked on the window so a fast drag that leaves the canvas still works.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const band = document.bands.find(candidate => candidate.id === state.bandId);
      if (!band) return;
      // The undo snapshot is taken on the first movement, so a click that only selects leaves no entry.
      if (!state.pushed) {
        onDocument(document, { push: true });
        state.pushed = true;
      }
      const snap = event.altKey ? 0.25 : 1;
      const round = (value: number) => Math.round(value / snap) * snap;
      const dx = (event.clientX - state.startX) / pxPerMm;
      const dy = (event.clientY - state.startY) / pxPerMm;
      const origin = state.origin;
      const patch: Partial<TemplateElement> = {};

      if (state.mode === "move") {
        patch.x = Math.max(0, Math.min(content.width - origin.w, round(origin.x + dx)));
        patch.y = Math.max(0, Math.min(band.height - origin.h, round(origin.y + dy)));
      } else {
        if (state.mode.includes("e")) patch.w = Math.max(4, round(origin.w + dx));
        if (state.mode.includes("s")) patch.h = Math.max(1.5, round(origin.h + dy));
        if (state.mode.includes("w")) {
          const x = Math.max(0, Math.min(origin.x + origin.w - 4, round(origin.x + dx)));
          patch.x = x;
          patch.w = round(origin.x + origin.w - x);
        }
        if (state.mode.includes("n")) {
          const y = Math.max(0, Math.min(origin.y + origin.h - 1.5, round(origin.y + dy)));
          patch.y = y;
          patch.h = round(origin.y + origin.h - y);
        }
        if (patch.w !== undefined) patch.w = Math.min(patch.w, content.width - (patch.x ?? origin.x));
        if (patch.h !== undefined) patch.h = Math.min(patch.h, band.height - (patch.y ?? origin.y));
      }

      setSnapHint(`${(patch.x ?? origin.x).toFixed(1)} × ${(patch.y ?? origin.y).toFixed(1)}mm${patch.w !== undefined ? `  ${patch.w.toFixed(1)}×${(patch.h ?? origin.h).toFixed(1)}mm` : ""}`);
      updateElement(state.bandId, state.elementId, patch);
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      setSnapHint(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const startDrag = (event: React.PointerEvent, band: TemplateBand, element: TemplateElement, mode: Handle | "move") => {
    event.preventDefault();
    event.stopPropagation();
    onSelect({ kind: "element", bandId: band.id, elementId: element.id });
    drag.current = {
      bandId: band.id, elementId: element.id, mode,
      startX: event.clientX, startY: event.clientY,
      origin: { x: element.x, y: element.y, w: element.w, h: element.h },
      pushed: false,
    };
  };

  const elementIssues = (elementId: string) => issues.filter(issue => issue.elementId === elementId && issue.severity === "error");

  return (
    <div className="inline-block" style={{ width: pageWidthPx }}>
      <div
        className="relative bg-white"
        style={{ width: pageWidthPx, paddingTop: marginTopPx, paddingBottom: mmToPx(document.page.margins.bottom) * zoom, boxShadow: "0 1px 3px rgba(15,23,42,.4)" }}
      >
        {/* The printable area, and the millimetre grid the snapping follows. */}
        <div
          className="relative"
          style={{
            marginLeft: marginLeftPx,
            width: contentWidthPx,
            backgroundImage: showGrid
              ? "repeating-linear-gradient(to right, rgba(148,163,184,.18) 0 1px, transparent 1px 100%), repeating-linear-gradient(to bottom, rgba(148,163,184,.18) 0 1px, transparent 1px 100%)"
              : undefined,
            backgroundSize: showGrid ? `${mmToPx(10) * zoom}px ${mmToPx(10) * zoom}px` : undefined,
          }}
        >
          {bands.map(band => {
            const bandHeightPx = mmToPx(band.height) * zoom;
            const selectedBand = selection.kind === "band" ? selection.bandId : selection.kind === "element" ? selection.bandId : null;
            return (
              <div key={band.id} className="relative">
                {showBandGuides ? (
                  <div
                    className={`flex items-center justify-between px-1 text-[9px] leading-none cursor-pointer select-none ${
                      selectedBand === band.id ? "bg-cyber-600/70 text-white" : "bg-slate-700/80 text-slate-200 hover:bg-slate-600/80"
                    }`}
                    style={{ height: 14 }}
                    onClick={() => onSelect({ kind: "band", bandId: band.id })}
                    onDoubleClick={() => onSelect({ kind: "band", bandId: band.id })}
                  >
                    <span className="truncate">
                      {band.kind}
                      {band.groupKey ? ` · ${document.groups.find(g => g.key === band.groupKey)?.label ?? band.groupKey}` : ""}
                      {band.repeatOnNewPage ? " · repeats" : ""}
                      {band.pageBreakBefore ? " · new page" : ""}
                    </span>
                    <span className="text-slate-400">{band.height}mm</span>
                  </div>
                ) : null}
                <div
                  className="relative"
                  style={{
                    height: bandHeightPx,
                    background: showBandGuides ? BAND_TINTS[band.kind] ?? "transparent" : undefined,
                    outline: showBandGuides && hoverBandId === band.id ? "1px dashed rgba(34,211,238,.6)" : undefined,
                  }}
                  onMouseEnter={() => setHoverBandId(band.id)}
                  onMouseLeave={() => setHoverBandId(null)}
                  onPointerDown={() => onSelect({ kind: "band", bandId: band.id })}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    const data = event.dataTransfer.getData("text/plain");
                    if (!data.startsWith("field:")) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    onDropField(band.id, data.slice("field:".length), {
                      x: Math.max(0, Math.min(content.width - 20, Math.round((event.clientX - rect.left) / pxPerMm))),
                      y: Math.max(0, Math.min(band.height - 5, Math.round((event.clientY - rect.top) / pxPerMm))),
                    });
                  }}
                >
                  {band.elements.map(element => {
                    const isSelected = selection.kind === "element" && selection.elementId === element.id;
                    const problems = elementIssues(element.id);
                    const value = values.get(element.id);
                    // Drawn in the document's ink, not the stored ink: the floor on the type size and the
                    // accent in place of the product's own cyan are applied here for the same reason they
                    // are applied in the engine — the canvas is a picture of the page that will print.
                    const style = inkStyle(element.style, {
                      accent,
                      groupRule: band.kind === "groupHeader" && element.type === "line",
                    });
                    const text = element.type === "text" ? (value ?? element.text) : element.type === "image" ? "" : (value ?? "…");
                    return (
                      <div
                        key={element.id}
                        onPointerDown={event => startDrag(event, band, element, "move")}
                        className="absolute cursor-move"
                        style={{
                          left: mmToPx(element.x) * zoom,
                          top: mmToPx(element.y) * zoom,
                          width: mmToPx(element.w) * zoom,
                          height: mmToPx(element.h) * zoom,
                          background: style.background ?? undefined,
                          border: style.border ? `${Math.max(1, mmToPx(style.border.width) * zoom)}px solid ${style.border.color}` : undefined,
                          // The selection ring and the problem ring are interface chrome, not part of the
                          // document, so they follow the theme: both are `--alert-*` tokens rather than
                          // literals, which is what the design-token guard expects of anything that is not
                          // the printed page itself.
                          outline: problems.length
                            ? "1.5px solid color-mix(in srgb, var(--alert-red) 90%, transparent)"
                            : isSelected ? "1.5px solid var(--cyber-500)" : undefined,
                          overflow: "hidden",
                          display: "flex",
                          alignItems: style.valign === "top" ? "flex-start" : style.valign === "bottom" ? "flex-end" : "center",
                          justifyContent: style.align === "right" ? "flex-end" : style.align === "center" ? "center" : "flex-start",
                          padding: mmToPx(style.padding) * zoom,
                        }}
                        title={problems.length ? problems.map(issue => issue.message).join("\n") : element.type === "field" || element.type === "aggregate" ? `{${(element as { expression?: string }).expression ?? ""}}` : undefined}
                      >
                        {element.type === "chart" ? (
                          charts.get(element.id) ? (
                            <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: chartSvg(charts.get(element.id)!, { zoom, origin: "box" }) }} />
                          ) : (
                            <span className="text-[9px] text-slate-500">{element.categoryExpression ? "No data to draw" : "Chart — choose a category field"}</span>
                          )
                        ) : element.type === "subreport" ? (
                          <span className="text-[9px] text-slate-500">{element.templateName || "Sub-report — choose a saved report"}</span>
                        ) : element.type === "image" ? (
                          <span className="text-[9px] text-slate-500">{element.src}</span>
                        ) : (
                          <span
                            className="whitespace-pre-wrap"
                            style={{
                              fontFamily: style.fontFamily === "mono" ? "monospace" : style.fontFamily === "serif" ? "serif" : "inherit",
                              fontSize: `${style.fontSize * (96 / 72)}px`,
                              fontWeight: style.bold ? 700 : 400,
                              fontStyle: style.italic ? "italic" : "none",
                              textDecoration: style.underline ? "underline" : "none",
                              color: style.color,
                              lineHeight: 1.2,
                            }}
                          >
                            {text || (element.type === "line" || element.type === "box" ? "" : "—")}
                          </span>
                        )}

                        {isSelected ? (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map(handle => (
                          <span
                            key={handle}
                            onPointerDown={event => startDrag(event, band, element, handle)}
                            className="absolute bg-cyber-400 border border-white"
                            style={{
                              width: 7, height: 7,
                              left: handle.includes("w") ? -4 : handle.includes("e") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                              top: handle.includes("n") ? -4 : handle.includes("s") ? "calc(100% - 3px)" : "calc(50% - 3px)",
                              cursor: `${handle}-resize`,
                            }}
                          />
                        )) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Where the printable area ends: bands past this line continue on the next page. */}
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-red-400/60"
            style={{ top: mmToPx(content.height - footerReserve) * zoom }}
          >
            <span className="absolute right-0 -top-4 text-[9px] text-red-400/80">end of printable area — later bands print on the next page</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
        <span>{contentWidthPx > 0 ? `${content.width.toFixed(1)} × ${content.height.toFixed(1)}mm printable` : ""}</span>
        {snapHint ? <span className="font-mono text-cyber-300">{snapHint}</span> : <span>{MM_PER_PX > 0 ? `grid 10mm · snap 1mm (Alt for 0.25mm)` : ""}</span>}
      </div>
    </div>
  );
}
