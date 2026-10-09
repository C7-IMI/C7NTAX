/**
 * One renderer for every document that leaves the building.
 *
 * The invoice, the statement and the quote are all assembled **on the server** and handed to a browser
 * as a standalone HTML page (`GET /billing/invoices/:id/pdf`, the client statement, `GET /quotes/:id/pdf`).
 * Nothing here may depend on the application's stylesheet, the theme or any of the eight colour schemes:
 * the document is fetched on its own, possibly printed, possibly filed as a PDF, and it is read as paper.
 * DESIGN.md section 8 calls this a third surface, and this module is that surface's whole vocabulary.
 *
 * The rules, each of which is a defect that was fixed by writing them down:
 *
 *  - **Paper first, at true size in millimetres.** A4 is 210 x 297 mm and Letter is 215.9 x 279.4 mm,
 *    with 18 mm margins. The sheet is white and the ink is `#0f172a` whatever theme the app is in: the
 *    invoice this replaces was a dark screen (`background:#0b1120`) printed to PDF.
 *  - **Type in points, nothing below 8.5 pt**, so a line survives a photocopy.
 *  - **Hairlines, not cards.** No `border-radius`, no shadow, no card-in-card. That furniture is exactly
 *    what makes a screen look like a screen; a document gets rules and space.
 *  - **Tabular numerals in every money column**, so the decimal points line up.
 *  - **A footer on every page** with page n of m, and a running head on every continuation.
 *  - **One accent**, and it is `brand.accent`, the instance's own primary colour. The interface's cyan is
 *    deliberately never used on paper: it measures 2.1:1 against white and disappears in greyscale.
 *
 * Everything branding-related comes from the `DocumentBrand` that `brandForDocument` returns, so this
 * file contains no company name, no logo and no wordmark of its own.
 */

import { API_ORIGIN, type DocumentBrand } from "@C7NTAX/shared";
import { escapeHtml } from "./emailHtml";

// --- Paper ---------------------------------------------------------------------------------------

/** The two sheet sizes a money document is ever drawn on. Both portrait, always. */
export type DocumentPageSize = "a4" | "letter";

interface PaperProfile {
  /** The sheet, in millimetres: a ruler's values, and what the DOM must measure. */
  widthMm: number;
  heightMm: number;
  /** 18 mm on every side. */
  marginMm: number;
  /** How much of the sheet's height the flowing content may use, once the footer has its room. */
  flowMm: number;
}

/** Room the footer always gets. A footer that could be squeezed out is not a footer. */
const FOOTER_MM = 16;

/** Room a continuation sheet's running head takes off the top of its flow. */
const CONTINUATION_HEAD_MM = 10.5;

/**
 * Slack left unused on every sheet.
 *
 * The block heights are estimates calibrated against the rendered document, and an estimate that is
 * half a millimetre short is a sheet 0.5 mm taller than 297 mm — which prints as a blank extra page.
 * Three millimetres of unused space is invisible and absorbs the rounding.
 */
const PAGE_SAFETY_MM = 3;

const PAPER: Record<DocumentPageSize, PaperProfile> = {
  a4: { widthMm: 210, heightMm: 297, marginMm: 18, flowMm: 297 - 36 - FOOTER_MM },
  letter: { widthMm: 215.9, heightMm: 279.4, marginMm: 18, flowMm: 279.4 - 36 - FOOTER_MM },
};

export function paperProfile(size: DocumentPageSize): PaperProfile {
  return PAPER[size];
}

// --- Values --------------------------------------------------------------------------------------

/**
 * A money amount, with the thousands separator the old invoice did not have.
 *
 * `amount.toFixed(2)` produced `$8680.00` in the overdue-reminder email; a document states `$8,680.00`.
 */
export function money(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A negative amount in the shape a totals block uses: a real minus sign then the figure. */
export function moneyNegative(amount: number): string {
  return `\u2212${money(Math.abs(amount))}`;
}

/** The symbol for a currency code. An unknown code keeps its own letters rather than inventing one. */
export function currencySymbol(code: string | null | undefined): string {
  switch ((code ?? "USD").toUpperCase()) {
    case "USD": return "$";
    case "EUR": return "\u20ac";
    case "GBP": return "\u00a3";
    case "CAD": return "CA$";
    case "AUD": return "A$";
    case "NZD": return "NZ$";
    default: return `${(code ?? "USD").toUpperCase()} `;
  }
}

/** The currency in words, for the line under the amount. */
export function currencyName(code: string | null | undefined): string {
  switch ((code ?? "USD").toUpperCase()) {
    case "USD": return "US dollars";
    case "EUR": return "euros";
    case "GBP": return "pounds sterling";
    case "CAD": return "Canadian dollars";
    case "AUD": return "Australian dollars";
    default: return (code ?? "USD").toUpperCase();
  }
}

/**
 * A date a reader anywhere can read: `7 August 2026`.
 *
 * The invoice this replaces printed `8/7/2026`, which is either 8 July or 7 August depending on which
 * side of the Atlantic the customer is on: an ambiguity a money document cannot afford on its due date.
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "\u2014";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "\u2014";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${date.getDate()} ${months[date.getMonth()] ?? ""} ${date.getFullYear()}`;
}

/** The date and time a document was generated, for the footer. */
export function formatStamp(value: Date): string {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${formatDate(value)}, ${hours}:${minutes}`;
}

/** Whole days between two moments, counted on the calendar rather than in milliseconds. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / 86_400_000);
}

/**
 * A tax rate as the percentage the document prints.
 *
 * `taxRate` is written two ways in this database, and `services/reportData.ts` already established the
 * convention this follows: **invoices and quotes carry a percentage (8.5 = 8.5%), while service
 * agreements carry a fraction (0.085 = 8.5%)**. No tax rate is 100% or more, so a value above 1 is read
 * as a percentage and one at or below 1 as a fraction. Applying `rate * 100` without the test is what
 * printed `Tax (850.0%)` on a live invoice, beside a correct $680.00.
 */
export function ratePercent(rate: number): number {
  return +((rate > 1 ? rate : rate * 100)).toFixed(4);
}

/** The percentage, trimmed of pointless decimals: `8.5%`, `8.25%`, `0%`. */
export function rateLabel(rate: number): string {
  const percent = ratePercent(rate);
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}
// --- The letterhead mark -------------------------------------------------------------------------

/**
 * The `src` a document may draw, or null when the mark must be set in type instead.
 *
 * An image the document cannot load is worse than no image: the customer sees a broken-image glyph on
 * the one page that is supposed to look like it came from a company. Two things decide this.
 *
 *  1. The document is served by the API, and helmet (applied to every response) sends
 *     `img-src 'self' data:`, so an image on another origin is refused by the browser, and an inline
 *     `onerror` fallback cannot be used either, because `script-src-attr` is `'none'`.
 *  2. The API serves no static files. The product's own shield lives in the *web* app's `public`
 *     directory (`/icon-192.png`), which this server cannot hand out; a client's uploaded logo lives
 *     under the API's own `/uploads`, which is the one image location the API owns.
 *
 * So an image is drawn only when it is a data URI (an upload the instance stored inline), a path under
 * `/uploads` (resolved against the API's own origin, which the CSP allows), or an absolute URL already
 * on the API's origin. Anything else, including the shipped `/icon-192.png`, is a mark the document
 * would draw broken, and it is set as the typeset wordmark `brandForDocument` supplies for exactly this
 * case. That is how "an instance with no logo gets a wordmark rather than a broken image" stays true.
 */
export function drawableMarkSrc(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  if (/^data:image\//i.test(value)) return value;
  if (/^\/uploads\//i.test(value)) return `${API_ORIGIN}${value}`;
  if (/^https?:\/\//i.test(value)) return value.startsWith(API_ORIGIN) ? value : null;
  return null;
}

/** The wordmark, with the first run of digits in the instance's accent: the mark when there is no image. */
function wordmarkHtml(text: string): string {
  const escaped = escapeHtml(text);
  return `<span class="dh-mark">${escaped.replace(/(\d+)/, "<b>$1</b>")}</span>`;
}

// --- Blocks and pagination -----------------------------------------------------------------------

/** A block of content with the height it is expected to occupy, in millimetres. */
export interface HtmlBlock {
  kind: "html";
  html: string;
  mm: number;
  /** A heading may not be the last thing on a page: it moves with what it introduces. */
  keepWithNext?: boolean;
}

/** A table whose rows may be split across a page break, repeating its heading. */
export interface TableBlock {
  kind: "table";
  /** Everything before the first row: the `<colgroup>` and the `<thead>`. */
  head: string;
  headMm: number;
  rows: { html: string; mm: number }[];
  /** A closing row that belongs to the *whole* table. */
  footerRow?: { html: string; mm: number };
}

export type DocumentBlock = HtmlBlock | TableBlock;

/** The height a block is expected to occupy, in millimetres. */
function blockMm(block: DocumentBlock): number {
  if (block.kind === "html") return block.mm;
  return block.headMm + block.rows.reduce((sum, row) => sum + row.mm, 0) + (block.footerRow?.mm ?? 0);
}

/** One block's HTML, drawn whole. Used for measuring and for a table that happens to fit. */
export function blockHtml(block: DocumentBlock): string {
  if (block.kind === "html") return block.html;
  return `${block.head}<tbody>${block.rows.map(row => row.html).join("")}${block.footerRow ? block.footerRow.html : ""}</tbody></table>`;
}

function tableHtml(block: TableBlock, rows: TableBlock["rows"], footerRow?: TableBlock["footerRow"]): string {
  return `${block.head}<tbody>${rows.map(row => row.html).join("")}${footerRow ? footerRow.html : ""}</tbody></table>`;
}

/** A page of a document: its flowing content, and whether it is a continuation. */
export interface DocumentPage {
  html: string;
  continuation: boolean;
}

/**
 * How much of what follows a heading has to fit under it before the heading may be left where it is.
 *
 * The paginator looks ahead one block, because a section heading is only useful with the thing it
 * introduces: the estimate is the next block's own height, capped at 65 mm so that a heading before a
 * very tall block does not drag it onto a fresh page for no reason. The cap is above the tallest block a
 * heading introduces anywhere in this product — the pay and answer blocks, which are 67 mm and 63 mm — so
 * a heading is never left at the foot of a sheet with its block overleaf.
 */
function reserveAfter(block: DocumentBlock | undefined): number {
  if (!block) return 0;
  if (block.kind === "html") return Math.min(block.mm, 65);
  const first = block.rows[0];
  return block.headMm + (first?.mm ?? 0);
}

/** The height a list of blocks is expected to occupy. Used to reserve room for an action block. */
export function blocksHeight(blocks: DocumentBlock[]): number {
  return blocks.reduce((sum, block) => sum + blockMm(block), 0);
}

/**
 * Pack blocks onto pages, splitting a long table rather than letting it run off the sheet.
 *
 * The sheet draws the running head on a continuation, and a split table re-emits its own `<thead>`, so a
 * table that continues across a page break still says what its columns are: a table without its
 * headings is unreadable. A heading block moves with what it introduces, so a section is never orphaned
 * at the foot of a page.
 *
 * `reserveMm` holds room back on the first sheet for a block appended afterwards (see
 * `paginateKeepingAction`), and `continuations` says every sheet this call produces carries a running
 * head, which costs it that head's height.
 */
export function paginate(
  blocks: DocumentBlock[],
  size: DocumentPageSize = "a4",
  opts: { reserveMm?: number; continuations?: boolean } = {},
): DocumentPage[] {
  const full = PAPER[size].flowMm - PAGE_SAFETY_MM;
  const afterFirst = full - CONTINUATION_HEAD_MM;
  const pages: DocumentPage[] = [];
  let current: string[] = [];
  let used = 0;
  let budget = (opts.continuations ? afterFirst : full) - (opts.reserveMm ?? 0);

  const flush = (): void => {
    pages.push({ html: current.join(""), continuation: pages.length > 0 });
    current = [];
    used = 0;
    budget = afterFirst;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === "html") {
      const needed = block.keepWithNext ? block.mm + reserveAfter(blocks[index + 1]) : block.mm;
      if (used > 0 && used + needed > budget) flush();
      current.push(block.html);
      used += block.mm;
      continue;
    }

    // A table is placed row by row so that a break falls between rows, never through one, and the
    // heading is accounted for before the rows are counted: a chunk that fits only because its heading
    // was ignored is a chunk that overflows the sheet.
    let start = 0;
    while (start < block.rows.length) {
      const limit = budget - used - block.headMm;
      let taken = 0;
      let height = 0;
      while (start + taken < block.rows.length) {
        const row = block.rows[start + taken];
        if (!row) break;
        if (height + row.mm > limit && taken > 0) break;
        height += row.mm;
        taken += 1;
      }
      let footer = start + taken >= block.rows.length ? block.footerRow : undefined;
      // Make room for the closing row rather than letting it fall off the sheet.
      if (footer && block.headMm + height + footer.mm > budget - used && taken > 1) {
        taken -= 1;
        height -= block.rows[start + taken]?.mm ?? 0;
        footer = undefined;
      }
      const needed = block.headMm + height + (footer?.mm ?? 0);
      if (used > 0 && needed > budget) {
        flush();
        continue;
      }
      current.push(tableHtml(block, block.rows.slice(start, start + taken), footer));
      used += needed;
      start += taken;
      if (start < block.rows.length) flush();
    }
  }

  if (current.length > 0 || pages.length === 0) flush();
  return pages;
}

/**
 * Lay a document out with a block that must stay on its first sheet.
 *
 * The summary gets the sheet minus the room the action block needs, and the action block is appended to
 * the last sheet that summary produced — so a document never ends a page with the balance and leaves
 * the ways to pay overleaf. The approved mockup's rule is that the amount, the date and the ways to pay
 * are what must survive; this is what makes that true when the summary only just fits.
 */
export function paginateKeepingAction(
  leading: DocumentBlock[],
  action: DocumentBlock[],
  size: DocumentPageSize,
  opts: { continuations?: boolean } = {},
): DocumentPage[] {
  const pages = paginate(leading, size, { reserveMm: blocksHeight(action), continuations: opts.continuations });
  const html = action.map(blockHtml).join("");
  const last = pages[pages.length - 1];
  if (last) last.html += html;
  else pages.push({ html, continuation: false });
  return pages;
}

// --- The money grid ------------------------------------------------------------------------------

export interface DocTableColumn {
  label: string;
  align?: "left" | "right";
  width?: string;
}

/** A cell is a string, or a value with a second line of explanation under it. */
export type DocTableCell = string | { text: string; sub?: string | null; mono?: boolean };

export interface DocTableRow {
  cells: DocTableCell[];
}

export interface DocTableSpec {
  columns: DocTableColumn[];
  rows: DocTableRow[];
  /** A closing row spanning to the last column, for a total. */
  totalRow?: { label: string; value: string; span?: number };
  headMm?: number;
}

/** A table the paginator can split, or draw whole when it happens to fit on the page. */
export function tableBlock(spec: DocTableSpec): TableBlock {
  const widths = spec.columns.map(column => (column.width ? `<col style="width:${column.width};">` : "<col>")).join("");
  const headCells = spec.columns
    .map(column => `<th${column.align === "right" ? ' class="dh-num"' : ""}>${escapeHtml(column.label)}</th>`)
    .join("");
  const head = `<table class="dh-grid"><colgroup>${widths}</colgroup><thead><tr>${headCells}</tr></thead>`;
  const rows = spec.rows.map(row => ({ html: tableRowHtml(spec, row), mm: rowMm(row) }));
  const footerRow = spec.totalRow ? { html: tableTotalHtml(spec, spec.totalRow), mm: 8 } : undefined;
  return { kind: "table", head, headMm: spec.headMm ?? TABLE_HEAD_MM, rows, footerRow };
}

function cellText(cell: DocTableCell): { text: string; sub: string | null; mono: boolean } {
  if (typeof cell === "string") return { text: cell, sub: null, mono: false };
  return { text: cell.text, sub: cell.sub ?? null, mono: !!cell.mono };
}

/** A row with a second line needs the room for it; without one it is a single line. */
function rowMm(row: DocTableRow): number {
  const hasSub = row.cells.some(cell => typeof cell !== "string" && !!cell.sub);
  return hasSub ? 13.9 : 9.2;
}

/**
 * The space a table's heading occupies, including the margin above it, in millimetres.
 *
 * Calibrated against the rendered sheet rather than guessed: the header row is 7.4 mm of type and rule
 * plus the table's own 4 mm leading margin.
 */
const TABLE_HEAD_MM = 15;

function tableRowHtml(spec: DocTableSpec, row: DocTableRow): string {
  const cells = row.cells.map((cell, index) => {
    const value = cellText(cell);
    const classes = [spec.columns[index]?.align === "right" ? "dh-num" : "", index === 0 ? "dh-desc" : "", value.mono ? "dh-mono" : ""].filter(Boolean).join(" ");
    const sub = value.sub ? `<span class="dh-sub">${escapeHtml(value.sub)}</span>` : "";
    return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(value.text)}${sub}</td>`;
  });
  return `<tr>${cells.join("")}</tr>`;
}

function tableTotalHtml(spec: DocTableSpec, total: NonNullable<DocTableSpec["totalRow"]>): string {
  const span = total.span ?? Math.max(1, spec.columns.length - 1);
  const trailing = spec.columns.length - span > 0 ? `<td class="dh-num">${escapeHtml(total.value)}</td>` : "";
  return `<tr class="dh-total"><td colspan="${span}">${escapeHtml(total.label)}</td>${trailing}</tr>`;
}
// --- The furniture -------------------------------------------------------------------------------

/** A heading block. `keepWithNext` stops it being orphaned at the foot of a page. */
export function section(title: string, aside?: string): HtmlBlock {
  return {
    kind: "html",
    keepWithNext: true,
    mm: 10.8,
    html: `<div class="dh-sec"><h2>${escapeHtml(title)}</h2>${aside ? `<span class="dh-small">${escapeHtml(aside)}</span>` : ""}</div>`,
  };
}

/** Lines a rough estimate assumes a sentence takes. Measured against the rendered document, not guessed. */
function estimatedLines(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/** A sentence of prose. */
export function paragraph(text: string, mm?: number): HtmlBlock {
  return { kind: "html", mm: mm ?? estimatedLines(text, 120) * 4.9, html: `<p class="dh-body">${escapeHtml(text)}</p>` };
}

/** A note the document makes: a rule and a sentence, never a card. */
export function note(text: string, accent = false): HtmlBlock {
  return {
    kind: "html",
    mm: 5 + estimatedLines(text, 90) * 4.3,
    html: `<div class="dh-note${accent ? " dh-note--accent" : ""}"><p>${escapeHtml(text)}</p></div>`,
  };
}

/** A label/value grid, for a document's meta line or a tax breakdown. */
export function metaGrid(
  items: { label: string; value: string; sub?: string | null; mono?: boolean; accent?: boolean; span?: number }[],
  columns = 4,
): HtmlBlock {
  const cells = items.map(item => {
    const sub = item.sub ? `<span class="dh-small${item.accent ? " dh-accent" : ""}">${escapeHtml(item.sub)}</span>` : "";
    const width = item.span && item.span > 1 ? ` style="grid-column: span ${item.span};"` : "";
    return `<div${width}><dt>${escapeHtml(item.label)}</dt><dd${item.mono ? ' class="dh-mono"' : ""}>${escapeHtml(item.value)}${sub}</dd></div>`;
  }).join("");
  // A grid row is as tall as its tallest cell, and a cell with a second line is taller than one without.
  const rowHeights: number[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    let span = 0;
    let hasSub = false;
    while (cursor < items.length && span < columns) {
      const item = items[cursor];
      if (!item) break;
      span += item.span ?? 1;
      if (item.sub) hasSub = true;
      cursor += 1;
    }
    rowHeights.push(hasSub ? 17.7 : 12.5);
  }
  return {
    kind: "html",
    mm: 5 + rowHeights.reduce((sum, height) => sum + height, 0),
    html: `<dl class="dh-meta" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));">${cells}</dl>`,
  };
}

/** The 0.6 pt ink rule: the strongest line on the page. */
export function inkRule(marginTopMm = 3.5): HtmlBlock {
  return { kind: "html", mm: marginTopMm + 0.3, html: `<div class="dh-rule" style="margin-top:${marginTopMm}mm;"></div>` };
}

/** A sentence in muted small type, under a rule. `innerHtml` must already be escaped or built from safe parts. */
export function metaLine(innerHtml: string): HtmlBlock {
  return { kind: "html", mm: 6.5, html: `<p class="dh-small dh-muted" style="margin-top:2mm;">${innerHtml}</p>` };
}

/** The state of the document, as a word with a mark: legible in black and white. */
export type DocumentStatusTone = "overdue" | "part" | "paid" | "draft" | "plain";

export function statusMark(label: string, tone: DocumentStatusTone = "plain"): string {
  return `<span class="dh-status dh-status--${tone}"><span class="dh-status__mark"></span>${escapeHtml(label)}</span>`;
}

/** The letterhead: the mark, the instance's identity, the document's title and its state. */
export function letterhead(brand: DocumentBrand, title: string, statusHtml?: string): HtmlBlock {
  const contact = [brand.contactLine, brand.website].filter(Boolean).map(value => escapeHtml(String(value))).join(" \u00b7 ");
  const who = `${escapeHtml(brand.company)}${brand.tagline ? ` \u00b7 ${escapeHtml(brand.tagline)}` : ""}`;
  return {
    kind: "html",
    mm: 15.5,
    html: `<div class="dh-lh">${letterheadMark(brand)}<div class="dh-lh__id">${wordmarkHtml(brand.wordmark)}<div class="dh-lh__who">${who}${contact ? `<br>${contact}` : ""}</div></div><div class="dh-lh__right"><div class="dh-title">${escapeHtml(title)}</div>${statusHtml ? `<div style="margin-top:2mm;">${statusHtml}</div>` : ""}</div></div>`,
  };
}

/**
 * The image mark, or nothing at all when the brand gave the document a mark it cannot load.
 *
 * Returning nothing rather than a broken `<img>` is deliberate: `letterhead` then sets the wordmark that
 * every `DocumentBrand` carries, which is the whole reason `resolveDocumentBrand` decides the mark.
 */
function letterheadMark(brand: DocumentBrand): string {
  if (brand.mark.kind !== "image") return "";
  const src = drawableMarkSrc(brand.mark.src);
  if (!src) return "";
  return `<img class="dh-lh__img" src="${escapeHtml(src)}" alt="${escapeHtml(brand.mark.alt)}">`;
}

/**
 * The amount the reader must act on, stated once.
 *
 * The totals block ends at Total, so the sum owed appears here and nowhere else. When something has been
 * paid this becomes *Balance due* and the totals block gains a *Less payments applied* line, so the
 * reader never has to work out which of two figures is the one to pay.
 */
export function amountDueBox(opts: {
  label: string;
  sub: string;
  amount: number;
  currency: string;
  overdue?: boolean;
  footnote?: string;
}): HtmlBlock {
  return {
    kind: "html",
    mm: 28 + (opts.footnote ? 5 : 0),
    html: `<div class="dh-due${opts.overdue ? " dh-due--overdue" : ""}">
      <div class="dh-due__l"><div class="dh-due__label">${escapeHtml(opts.label)}</div><div class="dh-due__sub">${escapeHtml(opts.sub)}</div></div>
      <div class="dh-due__amount"><div class="dh-money-xl">${escapeHtml(currencySymbol(opts.currency))}${money(opts.amount)}</div>
      <div class="dh-small dh-muted" style="margin-top:.6mm;">${escapeHtml(opts.currency.toUpperCase())}</div>
      ${opts.footnote ? `<div class="dh-small dh-accent" style="margin-top:.6mm;">${escapeHtml(opts.footnote)}</div>` : ""}</div></div>`,
  };
}

/**
 * How to pay, and what happens next.
 *
 * The account number and sort code are **not in the product**: `Invoice` has nowhere to keep payment
 * instructions. So the block states what the product does know, the reference to quote, who a cheque is
 * payable to, and the link that takes the reader to the invoice, and it claims nothing it cannot stand
 * behind.
 */
export function payBlock(opts: {
  title: string;
  ways: { label: string; body: string; reference?: string }[];
  nextTitle: string;
  nextBody: string;
  portalLabel: string;
  portalUrl: string;
  closing: string;
}): HtmlBlock {
  const ways = opts.ways
    .map(way => `<div class="dh-pay__way"><dt>${escapeHtml(way.label)}</dt><dd>${escapeHtml(way.body)}${way.reference ? `<span class="dh-refs dh-mono">${escapeHtml(way.reference)}</span>` : ""}</dd></div>`)
    .join("");
  return {
    kind: "html",
    mm: 67,
    html: `<div class="dh-pay">
      <div><h2>${escapeHtml(opts.title)}</h2><dl class="dh-pay__ways">${ways}</dl></div>
      <div class="dh-pay__next"><h2>${escapeHtml(opts.nextTitle)}</h2>
        <p class="dh-body" style="margin-top:2mm;">${escapeHtml(opts.nextBody)}</p>
        <div class="dh-portal"><div class="dh-label">${escapeHtml(opts.portalLabel)}</div><div class="dh-url dh-mono">${escapeHtml(opts.portalUrl)}</div></div>
        <p class="dh-small dh-muted" style="margin-top:2.5mm;">${escapeHtml(opts.closing)}</p></div>
    </div>`,
  };
}

/** The totals block: subtotal, tax, total, and, when there are payments, the balance. */
export function totalsBlock(
  rows: { key: string; value: string; strong?: boolean; rule?: boolean }[],
  noteText?: string,
): HtmlBlock {
  const body = rows
    .map(row => {
      const classes = ["dh-tot__row", row.strong ? "dh-tot__grand" : "", row.rule ? "dh-tot__rule" : ""].filter(Boolean).join(" ");
      return `<div class="${classes}"><span class="k">${escapeHtml(row.key)}</span><span class="v">${escapeHtml(row.value)}</span></div>`;
    })
    .join("");
  const note = noteText ? `<div class="dh-tot__note">${escapeHtml(noteText)}</div>` : "";
  const ruledRows = rows.filter(row => row.rule).length;
  const noteLines = noteText ? estimatedLines(noteText, 78) : 0;
  return {
    kind: "html",
    mm: 3 + rows.length * 7.8 + ruledRows * 3.6 + noteLines * 5.7,
    html: `<div class="dh-tot">${body}${note}</div>`,
  };
}

/** Signature lines, for a proposal the client signs to accept. */
export function signatureLines(labels: string[]): HtmlBlock {
  const cells = labels.map(label => `<div class="dh-sig__b">${escapeHtml(label)}</div>`).join("");
  return { kind: "html", mm: 12, html: `<div class="dh-sig">${cells}</div>` };
}

/** The running head a continuation sheet carries: what document this is, and which page. */
export function runHead(reference: string, client: string, documentName: string, page: number, pages: number): string {
  return `<div class="dh-runhead"><span class="dh-small"><b>${escapeHtml(reference)}</b> \u00b7 ${escapeHtml(client)} \u00b7 ${escapeHtml(documentName)}, continued</span><span class="r dh-small">Page ${page} of ${pages}</span></div>`;
}

/** The foot of every page: who generated it, on what terms, and which page of how many. */
export function footer(brand: DocumentBrand, opts: { page: number; pages: number; generatedAt: Date; terms: string }): string {
  const terms = [escapeHtml(opts.terms), brand.documentFooter ? escapeHtml(brand.documentFooter) : ""].filter(Boolean).join(" ");
  const legal = brand.legalText ? `<br>${escapeHtml(brand.legalText)}` : "";
  return `<div class="dh-foot">
    <div class="dh-foot__l">${escapeHtml(brand.product)} \u00b7 instance <span class="dh-mono">${escapeHtml(instanceLabel())}</span></div>
    <div class="dh-foot__c">${escapeHtml(brand.company)} \u00b7 ${terms}<br>Generated ${escapeHtml(formatStamp(opts.generatedAt))}${legal}</div>
    <div class="dh-foot__r">Page ${opts.page} of ${opts.pages}</div>
  </div>`;
}

/** The instance a document came from, which is what a reader quotes when they call about it. */
export function instanceLabel(): string {
  try {
    return new URL(API_ORIGIN).host;
  } catch {
    return API_ORIGIN;
  }
}
// --- The sheet and the document ------------------------------------------------------------------

/**
 * Draw the pages into one standalone document.
 *
 * The stylesheet is inlined because the document is fetched on its own and cannot depend on the app's.
 * Every colour is a literal out of `brand.palette` (DESIGN.md section 8), and the only settable colour
 * on the page is `brand.accent`.
 */
export function renderDocument(opts: {
  brand: DocumentBrand;
  size: DocumentPageSize;
  title: string;
  pages: DocumentPage[];
  /** Drawn at the top of a continuation sheet, above its own content. */
  continuationHead?: (page: number, pages: number) => string;
  terms: string;
  generatedAt: Date;
}): string {
  const { brand, size, pages } = opts;
  const total = pages.length;
  const sheets = pages
    .map((page, index) => {
      const number = index + 1;
      const head = page.continuation && opts.continuationHead ? opts.continuationHead(number, total) : "";
      const foot = footer(brand, { page: number, pages: total, generatedAt: opts.generatedAt, terms: opts.terms });
      return `<div class="dh-sheet">${head}<div class="dh-flow">${page.html}</div>${foot}</div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${stylesheet(brand, size)}</style>
</head>
<body>
${sheets}
</body>
</html>`;
}

/**
 * The document's whole vocabulary, in points and millimetres.
 *
 * A literal for every colour, because a document has no CSS variables to resolve and must not follow the
 * theme, and `brand.accent` is the instance's own primary colour. It is applied to the wordmark's
 * numeral, the overdue edge and a section's leading rule, and nowhere else.
 */
function stylesheet(brand: DocumentBrand, size: DocumentPageSize): string {
  const p = PAPER[size];
  return `
:root {
  --dh-paper: ${brand.palette.paper};
  --dh-ink: ${brand.palette.ink};
  --dh-body: ${brand.palette.body};
  --dh-muted: ${brand.palette.muted};
  --dh-rule: ${brand.palette.rule};
  --dh-hair: ${brand.palette.hairline};
  --dh-tint: ${brand.palette.tint};
  --dh-accent: ${brand.accent};
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  background: ${brand.palette.tint};
  color: var(--dh-ink);
  font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 9.5pt;
  line-height: 1.42;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.dh-mono { font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; }

/* The sheet: true paper size in millimetres, always white, always ink. */
.dh-sheet {
  width: ${p.widthMm}mm;
  min-height: ${p.heightMm}mm;
  padding: ${p.marginMm}mm;
  margin: 8mm auto;
  background: ${brand.palette.paper};
  color: var(--dh-ink);
  display: flex;
  flex-direction: column;
  position: relative;
}
.dh-flow { flex: 1 0 auto; }

/* Type, in points. Nothing below 8.5pt. */
.dh-title { font-size: 20pt; font-weight: 700; letter-spacing: -.005em; line-height: 1.05; text-transform: uppercase; }
.dh-lh { display: flex; align-items: flex-start; gap: 4.5mm; }
.dh-lh__img { width: 34mm; max-height: 13mm; object-fit: contain; flex: none; }
.dh-lh__id { flex: 1; min-width: 0; }
.dh-lh__right { margin-left: auto; text-align: right; }
.dh-mark { display: block; font-size: 16pt; font-weight: 700; letter-spacing: -.01em; line-height: 1.05; color: var(--dh-ink); }
.dh-mark b { color: var(--dh-accent); }
.dh-lh__who { font-size: 8.5pt; color: var(--dh-muted); line-height: 1.45; margin-top: .6mm; }
.dh-sec h2, .dh-pay h2 { font-size: 10.5pt; font-weight: 700; letter-spacing: .075em; text-transform: uppercase; color: var(--dh-ink); }
.dh-body { font-size: 9.5pt; }
.dh-small { font-size: 8.5pt; }
.dh-label { font-size: 8.5pt; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--dh-muted); }
.dh-muted { color: var(--dh-muted); }
.dh-accent { color: var(--dh-accent); }
.dh-sub { display: block; font-size: 8.5pt; color: var(--dh-muted); margin-top: .5mm; }

/* Rules. A hairline is a hairline and the ink rule is the strongest line on the page. */
.dh-rule { border-top: .6pt solid var(--dh-ink); }

/* The meta line. */
.dh-meta { display: grid; gap: 3mm 4mm; margin-top: 5mm; }
.dh-meta dt { font-size: 8.5pt; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--dh-muted); }
.dh-meta dd { font-size: 9.5pt; color: var(--dh-ink); }
.dh-meta dd .dh-small { display: block; color: var(--dh-muted); }

/* The state: a word, a heavy edge and a hatch, legible in black and white. */
.dh-status { display: inline-flex; align-items: center; gap: 1.8mm; border: .6pt solid var(--dh-ink); padding: .5mm 2mm; font-size: 8.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--dh-ink); }
.dh-status__mark { width: 2.6mm; height: 2.6mm; flex: none; border: .6pt solid currentColor; }
.dh-status--overdue { border-color: var(--dh-accent); border-width: 1pt; color: var(--dh-accent); }
.dh-status--overdue .dh-status__mark { background: repeating-linear-gradient(45deg, currentColor 0 .5pt, transparent .5pt 1.2pt); }
.dh-status--part .dh-status__mark { background: linear-gradient(90deg, currentColor 50%, transparent 50%); }
.dh-status--paid .dh-status__mark { background: currentColor; }
.dh-status--draft { color: var(--dh-muted); border-style: dashed; }
.dh-status--draft .dh-status__mark { border-style: dashed; }

/* The amount due, stated once. */
.dh-due { display: flex; align-items: flex-end; gap: 6mm; border: .6pt solid var(--dh-ink); padding: 3.4mm 4.5mm; margin-top: 5mm; }
.dh-due__l { flex: 1; }
.dh-due__label { font-size: 8.5pt; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--dh-muted); }
.dh-due__sub { font-size: 9pt; color: var(--dh-body); margin-top: .8mm; }
.dh-due__amount { text-align: right; }
.dh-due--overdue { border-left-width: 2.6mm; border-left-color: var(--dh-accent); }
.dh-money-xl { font-size: 20pt; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }

/* The money grid: measured columns, hairlines, tabular numerals. */
table.dh-grid { width: 100%; border-collapse: collapse; margin-top: 4mm; }
.dh-grid th { text-align: left; font-size: 8.5pt; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--dh-muted); padding: 0 0 1.8mm; border-bottom: .6pt solid var(--dh-ink); }
.dh-grid td { font-size: 9.5pt; padding: 2.2mm 0; border-bottom: .4pt solid var(--dh-hair); vertical-align: top; font-variant-numeric: tabular-nums; color: var(--dh-ink); }
.dh-grid .dh-num { text-align: right; white-space: nowrap; }
.dh-grid td.dh-desc { padding-right: 5mm; }
.dh-grid tr.dh-total td { border-bottom: 0; border-top: .6pt solid var(--dh-ink); font-weight: 700; }

/* The totals block. */
.dh-tot { margin-left: auto; width: 82mm; margin-top: 3mm; }
.dh-tot__row { display: flex; justify-content: space-between; gap: 5mm; padding: 1.5mm 0; font-size: 9.5pt; color: var(--dh-ink); }
.dh-tot__row .k { color: var(--dh-body); }
.dh-tot__row .v { font-variant-numeric: tabular-nums; }
.dh-tot__rule { border-top: .6pt solid var(--dh-ink); margin-top: 1.4mm; padding-top: 2.2mm; }
.dh-tot__grand { font-size: 13pt; font-weight: 700; }
.dh-tot__note { font-size: 8.5pt; color: var(--dh-muted); text-align: right; margin-top: 1.4mm; }

/* How to pay, and what happens next. */
.dh-pay { margin-top: 5.5mm; border-top: .6pt solid var(--dh-ink); padding-top: 3mm; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 8mm; }
.dh-pay__ways { margin-top: 2.2mm; }
.dh-pay__way { display: flex; gap: 2.5mm; padding: 1.8mm 0; border-top: .4pt solid var(--dh-hair); }
.dh-pay__way:first-child { border-top: 0; }
.dh-pay__way dt { width: 24mm; flex: none; font-size: 8.5pt; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--dh-muted); }
.dh-pay__way dd { font-size: 9.5pt; }
.dh-refs { display: block; margin-top: .5mm; font-size: 9pt; }
.dh-pay__next { border-left: .6pt solid var(--dh-accent); padding-left: 3.5mm; }
.dh-portal { margin-top: 2.5mm; padding: 2.4mm 3mm; background: var(--dh-tint); }
.dh-url { font-size: 8.5pt; word-break: break-all; margin-top: 1mm; }

/* A section heading, and a note the document itself makes. */
.dh-sec { display: flex; align-items: baseline; gap: 3mm; margin-top: 5.5mm; }
.dh-sec .dh-small { margin-left: auto; color: var(--dh-muted); }
.dh-note { border-left: 1.6mm solid var(--dh-rule); padding: 1mm 0 1mm 3.5mm; margin-top: 3mm; }
.dh-note--accent { border-left-color: var(--dh-accent); }
.dh-note p { font-size: 8.5pt; color: var(--dh-body); }

/* The running head on page 2 and after. */
.dh-runhead { display: flex; align-items: baseline; gap: 3mm; padding-bottom: 2mm; margin-bottom: 4mm; border-bottom: .4pt solid var(--dh-rule); }
.dh-runhead .r { margin-left: auto; color: var(--dh-muted); }

/* A signature line, for a proposal. */
.dh-sig { display: flex; gap: 8mm; margin-top: 6mm; }
.dh-sig__b { flex: 1; border-top: .6pt solid var(--dh-ink); padding-top: 1.6mm; font-size: 8.5pt; color: var(--dh-muted); }

/* The footer, on every page. */
.dh-foot { margin-top: auto; padding-top: 2.6mm; border-top: .4pt solid var(--dh-hair); display: flex; gap: 4mm; align-items: flex-start; font-size: 8.5pt; color: var(--dh-muted); }
.dh-foot__l { flex: 1.3; }
.dh-foot__c { flex: 1.8; }
.dh-foot__r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

@media print {
  body { background: #fff; }
  .dh-sheet { margin: 0; }
  .dh-sheet + .dh-sheet { break-before: page; }
}
@page { size: ${size === "letter" ? "Letter" : "A4"} portrait; margin: ${p.marginMm}mm; }
`;
}