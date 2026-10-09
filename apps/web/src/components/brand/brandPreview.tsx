/**
 * The live preview every Branding screen carries — **drawn by the renderer, at true paper size**.
 *
 * The requirement this file exists to satisfy is "the preview a person approves is the page they get",
 * and there is only one way to make that true rather than approximately true: hand the same resolved
 * `DocumentBrand` to the same renderer the printed page comes from. So the preview is an `<iframe>`
 * whose document is `renderPrintDocument(…)` from `components/reports/documentLanguage.ts` — the same
 * function a report's Print button calls, with the same paginator and the same stylesheet. Nothing here
 * draws a letterhead, sets a type size or picks a colour; a preview that drew its own would be a second
 * description of a document, which is the defect the document language was written to end.
 *
 * Three consequences, each of them the point:
 *
 *  - **It is measured in millimetres.** The sheet is `210 × 297mm` because `pageBox` says so, not
 *    because the frame was sized to look like a page, and the frame is the sheet's own size in CSS
 *    millimetres so nothing is scaled to fit behind the person's back. A landscape sheet is *scaled
 *    down to fit the column* with a `transform`, and the line under it says the paper size, because
 *    scaling is the one thing that could otherwise let a Letter sheet pass for an A4 one.
 *  - **The paper is white in both interface themes**, and not by a rule here: the sheet is a separate
 *    document with its own `color-scheme: light` and its own paper colour. The interface's theme cannot
 *    reach inside it, which is the property most worth doubting and therefore the one stated on screen.
 *  - **The figures are a specimen.** A settings screen has no report to show, so the blocks below are
 *    labelled as a specimen in the document's own lead line. The letterhead, the paper, the orientation,
 *    the type and the footer are real; the numbers are not, and the sheet says so on itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  documentBrandFor,
  normaliseBrand,
  type BrandKit,
  type BrandOverride,
  type DocumentBrand,
  type DocumentFamily,
  type DocumentPresentation,
} from "@C7NTAX/shared";
import { PAPER_SIZES, pageBox, renderPrintDocument, type PrintBlock } from "../reports/documentLanguage";

/**
 * The brand a preview is drawn from, resolved exactly as the API resolves it for a real document:
 * the instance's brand ← a client's override, and the presentation as family default ← family stored ←
 * the report's own patch.
 *
 * `documentBrandFor` is the shared function, not a re-implementation, so a screen that previews an
 * unsaved draft and the API that later produces the PDF cannot disagree about what an unset field
 * falls back to.
 */
export function previewBrand(input: {
  /** The instance's brand as it stands, or the draft — see `kitFromDraft`. */
  kit: Partial<BrandKit> | BrandKit;
  family: DocumentFamily;
  /** A client's patch, with its `presentation` (where it has one) laid over the family's, as the API does. */
  override?: BrandOverride | null;
  /** Family default ← family stored ← a report's own patch, already merged. */
  presentation?: Partial<DocumentPresentation> | null;
}): DocumentBrand {
  return documentBrandFor(
    normaliseBrand(input.kit),
    input.family,
    input.override ?? null,
    input.presentation ?? null,
  );
}

export type SpecimenFlavour = "report" | "invoice" | "ticket";

/**
 * The line under a specimen sheet's title, written the way the report kit writes a real one — so the
 * preview's own meta line is not a nicer-looking invention.
 */
export function specimenMetaLine(what: string, at: Date): string {
  return [what, `Generated ${at.toLocaleString()}`].filter(Boolean).join(" · ");
}

/** The left half of the specimen's footer: the stamp and the confidential line, as a real page has it. */
export function specimenFooterLeft(brand: DocumentBrand, at: Date): string {
  return [at.toLocaleString(), brand.legalText ?? `Confidential — ${brand.company}`].join(" · ");
}

/**
 * A specimen document — the shape of one family, with figures that are obviously not a client's.
 *
 * Every number carries "(specimen)" the first time it appears in a block, because a settings screen is
 * the one place a plausible figure can be mistaken for a real one.
 */
export function specimenBlocks(flavour: SpecimenFlavour): PrintBlock[] {
  if (flavour === "invoice") {
    return [
      {
        kind: "facts",
        title: "The invoice",
        items: [
          { label: "Invoice number", value: "INV-0000 (specimen)" },
          { label: "Issued", value: "1 January (specimen)" },
          { label: "Due", value: "31 January (specimen)" },
          { label: "Terms", value: "Net 30" },
        ],
        lead: "A specimen sheet. The letterhead, the paper and the type are this instance's; the figures are a specimen and belong to no client.",
      },
      {
        kind: "table",
        title: "What this invoice is for",
        columns: [
          { label: "Description" },
          { label: "Qty", numeric: true },
          { label: "Rate", numeric: true },
          { label: "Amount", numeric: true },
        ],
        rows: [
          ["Managed service — monthly (specimen)", "1", "$1,200.00", "$1,200.00"],
          ["Microsoft 365 licence (specimen)", "24", "$22.00", "$528.00"],
          ["On-site work, 2 hours (specimen)", "2", "$145.00", "$290.00"],
        ],
        total: ["Total due (specimen)", "", "", "$2,018.00"],
        note: "Payable within 30 days. A reminder follows at 45 days.",
      },
      {
        kind: "bars",
        title: "What the amount is made of",
        rows: [
          { label: "Managed service", value: "$1,200", fraction: 0.6, accent: true },
          { label: "Licences", value: "$528", fraction: 0.26 },
          { label: "On-site work", value: "$290", fraction: 0.14 },
        ],
        axis: ["0", "$600", "$1,200"],
        caption: "A specimen — the proportions, not the amounts.",
      },
    ];
  }

  if (flavour === "ticket") {
    return [
      {
        kind: "facts",
        title: "The ticket",
        items: [
          { label: "Ticket", value: "T-0000 (specimen)" },
          { label: "Client", value: "A client (specimen)" },
          { label: "Board", value: "Service desk" },
          { label: "Priority", value: "Normal" },
        ],
      },
      {
        kind: "table",
        title: "What happened",
        columns: [{ label: "When" }, { label: "Who" }, { label: "What was recorded" }],
        rows: [
          ["Day 1, 09:12", "A technician (specimen)", "Ticket raised from a telephone call."],
          ["Day 1, 10:04", "The client (specimen)", "Added a photograph of the fault."],
          ["Day 1, 15:40", "A technician (specimen)", "Resolved — part replaced and tested."],
        ],
        note: "A specimen sheet printed for the file, or sent to the client on request.",
      },
      {
        kind: "callout",
        title: "What was agreed",
        items: [
          "The part is covered by the agreement (specimen).",
          "No charge is raised for this visit (specimen).",
        ],
      },
    ];
  }

  return [
    {
      kind: "masthead",
      figures: [
        { label: "Tickets opened", value: "128", sub: "specimen" },
        { label: "Answered inside target", value: "94.2%", sub: "92% target · specimen", attention: true },
        { label: "First response, median", value: "1h 12m", sub: "4h target · specimen" },
      ],
    },
    {
      kind: "lead",
      text: "A specimen sheet. The letterhead, the paper, the orientation and the type are this instance's; every figure below is a specimen.",
    },
    {
      kind: "table",
      title: "Ticket volume by board",
      columns: [
        { label: "Board" },
        { label: "Opened", numeric: true },
        { label: "Closed", numeric: true },
        { label: "Backlog", numeric: true },
      ],
      rows: [
        ["Service desk (specimen)", "64", "61", "12"],
        ["Field work (specimen)", "31", "27", "9"],
        ["Projects (specimen)", "19", "19", "0"],
        ["Escalations (specimen)", "14", "11", "5"],
      ],
      total: ["All boards (specimen)", "128", "118", "26"],
    },
    {
      kind: "bars",
      title: "Answered inside target, by board",
      rows: [
        { label: "Service desk", value: "96.1%", fraction: 0.961, accent: true },
        { label: "Field work", value: "92.4%", fraction: 0.924 },
        { label: "Projects", value: "89.0%", fraction: 0.89 },
        { label: "Escalations", value: "84.2%", fraction: 0.842 },
      ],
      axis: ["0%", "50%", "100%"],
      caption: "A specimen — the shape of the report, not its figures.",
    },
  ];
}

const MM_PER_CSS_PX = 25.4 / 96;

/** A string that settles before it is used, so typing does not reload the preview on every keystroke. */
function useDebounced<T>(value: T, delay = 240): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The sheet itself.
 *
 * The frame is the paper's own size; the wrapper is the size it is *shown* at, so a landscape A4 that
 * has been scaled down to fit a column still measures 297 × 210mm inside, which is what the checkable
 * claim on screen is about.
 */
export function DocumentPreview({
  brand,
  title,
  metaLine,
  blocks,
  footerLeft,
  className = "",
}: {
  brand: DocumentBrand;
  title: string;
  metaLine: string;
  blocks: PrintBlock[];
  footerLeft: string;
  className?: string;
}) {
  const html = useMemo(
    () =>
      renderPrintDocument({
        brand,
        title,
        metaLine,
        runningHead: `${title} · specimen`,
        blocks,
        footerLeft,
        autoPrint: false,
      }),
    [brand, title, metaLine, blocks, footerLeft],
  );
  const settled = useDebounced(html);

  const { widthMm, heightMm } = pageBox(brand.presentation);
  const widthPx = widthMm / MM_PER_CSS_PX;
  const heightPx = heightMm / MM_PER_CSS_PX;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setAvailable(node.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = available > 0 ? Math.min(1, available / widthPx) : 0;

  return (
    <div ref={boxRef} className={className}>
      <div className="mx-auto" style={{ width: `${widthPx * scale}px`, height: `${heightPx * scale}px` }}>
        <iframe
          title={`A specimen ${PAPER_SIZES[brand.presentation.pageSize].label.split(" — ")[0]} sheet, ${brand.presentation.orientation}`}
          srcDoc={settled}
          className="border border-surface-border bg-white"
          style={{ width: `${widthPx}px`, height: `${heightPx}px`, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      </div>
    </div>
  );
}

/** What the preview says about itself: the paper in millimetres, and the one property worth doubting. */export function PreviewNote({ brand, note }: { brand: DocumentBrand; note?: string }) {
  const paper = PAPER_SIZES[brand.presentation.pageSize];
  const { widthMm, heightMm } = pageBox(brand.presentation);
  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-gray-500">
      <p className="tabular-nums">
        {paper.label.split(" — ")[0]} · {brand.presentation.orientation} · {widthMm} × {heightMm}mm — drawn at true
        size by the document renderer, so this is the sheet that prints.
      </p>
      <p>
        Paper is white in this theme and in the other one, and that is structural rather than a setting: the sheet is
        its own document with its own stylesheet, so the interface's theme cannot reach inside it.
      </p>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
