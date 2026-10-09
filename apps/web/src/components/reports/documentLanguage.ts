/**
 * The document language — paper, type, rules and the basis block, in one file.
 *
 * A report leaves this application three ways: printed from the report screen, printed from the browser
 * and saved as a PDF. Before this module each of those decided a paper size, a type scale and a set of
 * colours for itself, so a document that left through two of them could be two different documents —
 * the ticket's own print window had no `@page` rule at all and every PDF was landscape A4 whatever the
 * screen showed.
 *
 * **The renderer holds no branding.** Nothing here knows a company name, a logo or a colour: it is
 * handed a resolved `DocumentBrand` (letterhead already chosen, paper already resolved, palette
 * attached) and it draws it. That is what makes "I uploaded a logo and it appears on every document"
 * true without a code change, and it is why no hex literal appears below — every colour is read from
 * `brand.palette` or `brand.accent`.
 *
 * Two things it does own, because they are the document's rather than the instance's:
 *
 *  - **Paper, in millimetres.** A4 is 210 × 297 mm and Letter is 215.9 × 279.4 mm; 18 mm side margins,
 *    16 mm top and 20 mm bottom, on a 4.5 mm baseline grid. Landscape swaps the sides, it does not
 *    scale the type: a nine-column matrix prints nine columns at 9 pt or it prints in portrait.
 *  - **A type floor of 8.5 pt**, in points, because a page is measured in points and a rule written in
 *    `px` is a rule that means something different in every browser. Nothing prints below it.
 *
 * The print window is **paginated here, not by the browser**: each sheet is a `<div>` of exactly the
 * paper size and the blocks are distributed across them by measuring, so a table breaks between rows and
 * never between a heading and its first row, and "page n of m" is a number this code counted rather
 * than the browser's own guess. A table that cannot fit in a page's remaining space is split; a section
 * that would be orphaned starts a new sheet.
 */
import type { DocumentBrand, DocumentPresentation } from "@C7NTAX/shared";

// ═══════════════════════════════════════════════════════════════════
//  Paper, margins and the grid
// ═══════════════════════════════════════════════════════════════════

export interface PaperSize {
  id: "a4" | "letter";
  /** How the chooser names it — the size *and* its measure, never "A4" as a bare word. */
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PAPER_SIZES: Record<PaperSize["id"], PaperSize> = {
  a4: { id: "a4", label: "A4 — 210 × 297mm", widthMm: 210, heightMm: 297 },
  letter: { id: "letter", label: "Letter — 215.9 × 279.4mm", widthMm: 215.9, heightMm: 279.4 },
};

/** The margin is 18 mm whatever the sheet, so a Letter page simply has 5.9 mm more column. */
export const DOC_MARGIN = { top: 16, right: 18, bottom: 20, left: 18 } as const;

/** Everything on a sheet sits on this. Not a spacing scale — a *baseline* the rules align to. */
export const BASELINE_MM = 4.5;

/** 1 pt = 25.4/72 mm. The one conversion the renderer needs, because it draws in mm and types in pt. */
export const MM_PER_PT = 25.4 / 72;
export const ptToMm = (pt: number): number => pt * MM_PER_PT;

/** No type on a printed page is set below this. */
export const MIN_TYPE_PT = 8.5;

/** The type scale, in points. Tile labels used to print at 6.8 pt and footers at 7.5 pt. */
export const TYPE_PT = {
  masthead: 20,
  title: 17,
  section: 9,
  body: 9,
  table: 9,
  small: 8.5,
} as const;

/** The paper and orientation a document's presentation resolves to, in millimetres. */
export function pageBox(presentation: DocumentPresentation): { widthMm: number; heightMm: number; paper: PaperSize } {
  const paper = PAPER_SIZES[presentation.pageSize] ?? PAPER_SIZES.a4;
  const landscape = presentation.orientation === "landscape";
  return {
    widthMm: landscape ? paper.heightMm : paper.widthMm,
    heightMm: landscape ? paper.widthMm : paper.heightMm,
    paper,
  };
}

/** The width a table actually has. Landscape is how a nine-column matrix fits *without* scaling it. */
export function contentWidthMm(presentation: DocumentPresentation): number {
  return pageBox(presentation).widthMm - DOC_MARGIN.left - DOC_MARGIN.right;
}

/** The axis labels on the bar list, and the sentence a person reads before choosing landscape. */
export const ORIENTATION_LABELS = {
  portrait: "Portrait",
  landscape: "Landscape — for a table too wide to read in portrait",
} as const;

// ═══════════════════════════════════════════════════════════════════
//  Blocks — what a document is made of, independent of who draws it
// ═══════════════════════════════════════════════════════════════════

export interface PrintColumn { label: string; /** Right-aligned, tabular numerals. */ numeric?: boolean }
export interface PrintFigure { label: string; value: string; sub?: string; /** Weight and colour in the rule above it. */ attention?: boolean }

/**
 * A heading travels **inside** the block it heads, never as a block of its own.
 *
 * That is what keeps the promise that a table breaks only between rows and never between a heading and
 * its first row: the paginator splits a table's `tbody` and the heading stays with the part that
 * continues on, so a reader on the next sheet is told what the table is.
 */
export interface BlockHeading { /** The section number, so a contents page can refer to it. */ number?: number; title?: string }

export type PrintBlock =
  | { kind: "masthead"; figures: PrintFigure[] }
  | { kind: "lead"; text: string }
  | { kind: "section"; number?: number; title: string }
  | ({ kind: "table"; columns: PrintColumn[]; rows: string[][]; total?: string[]; note?: string } & BlockHeading)
  | ({ kind: "bars"; note?: string; caption?: string; rows: Array<{ label: string; value: string; fraction: number; accent?: boolean }>; axis: string[] } & BlockHeading)
  | ({ kind: "facts"; items: Array<{ label: string; value: string }>; lead?: string } & BlockHeading)
  | ({ kind: "callout"; items: string[] } & BlockHeading)
  | { kind: "note"; text: string };

/** The basis block: where the figures came from, and what could not be known. */
export interface BasisBlock {
  /** The line every figure on the page is measured against, usually the as-of date. */
  asOf?: string;
  /** The measured rules, in order: what a value means, the bucket rule, the statuses counted. */
  measures: Array<{ label: string; value: string }>;
  /** The endpoint's own sentences. Printed verbatim: the pack does not compose them. */
  notes: string[];
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ═══════════════════════════════════════════════════════════════════
//  Blocks → HTML
// ═══════════════════════════════════════════════════════════════════

/** The small-caps heading a section hangs from, with the full-width hairline under it. */
function sectionHeadHtml(heading: BlockHeading): string {
  if (!heading.title) return "";
  return `<div class="section__head">`
    + (heading.number !== undefined ? `<span class="section__n">${esc(heading.number)}</span>` : "")
    + `<span class="section__title">${esc(heading.title)}</span></div>`;
}

function figureHtml(figure: PrintFigure): string {
  return `<div class="figure${figure.attention ? " figure--attention" : ""}">`
    + `<p class="figure__value">${esc(figure.value)}</p>`
    + `<p class="figure__label">${esc(figure.label)}</p>`
    + (figure.sub ? `<p class="figure__sub">${esc(figure.sub)}</p>` : "")
    + "</div>";
}

function tableHtml(block: Extract<PrintBlock, { kind: "table" }>): string {
  const head = "<tr>" + block.columns.map(column =>
    `<th class="${column.numeric ? "num" : ""}">${esc(column.label)}</th>`).join("") + "</tr>";
  const data = block.rows.map(row => "<tr>" + row.map((cell, index) =>
    `<td class="${block.columns[index]?.numeric ? "num" : ""}">${esc(cell)}</td>`).join("") + "</tr>").join("");
  // A total is marked by a rule above it and a heavier weight, never by a fill: it has to survive a
  // photocopy, and an ink-filled row photocopies into a black bar.
  const total = block.total
    ? "<tr class=\"is-total\">" + block.total.map((cell, index) =>
      `<td class="${block.columns[index]?.numeric ? "num" : ""}">${esc(cell)}</td>`).join("") + "</tr>"
    : "";
  return `<div class="table-block">${sectionHeadHtml(block)}`
    + `<table class="doc-table"><thead>${head}</thead><tbody>${data}${total}</tbody></table>`
    + (block.note ? `<p class="note">${esc(block.note)}</p>` : "")
    + "</div>";
}

function barsHtml(block: Extract<PrintBlock, { kind: "bars" }>): string {
  const rows = block.rows.map(row => {
    const width = Math.max(0, Math.min(1, row.fraction)) * 100;
    return `<div class="bar">`
      + `<span class="bar__label">${esc(row.label)}</span>`
      + `<span class="bar__track"><span class="bar__fill${row.accent ? " bar__fill--accent" : ""}" style="width:${width.toFixed(2)}%"></span></span>`
      + `<span class="bar__value">${esc(row.value)}</span>`
      + "</div>";
  }).join("");
  const axis = block.axis.length
    ? `<div class="bar bar--axis"><span class="bar__label"></span><span class="bar__axis">${block.axis.map(label => `<span>${esc(label)}</span>`).join("")}</span><span class="bar__value"></span></div>`
    : "";
  return `<div class="bars-block">${sectionHeadHtml(block)}<div class="bars">${rows}${axis}</div>`
    + (block.caption ? `<p class="note">${esc(block.caption)}</p>` : "")
    + (block.note ? `<p class="note">${esc(block.note)}</p>` : "")
    + "</div>";
}

function factsHtml(block: Extract<PrintBlock, { kind: "facts" }>): string {
  return `<div class="facts-block">${sectionHeadHtml(block)}`
    + (block.lead ? `<p class="lead">${esc(block.lead)}</p>` : "")
    + `<dl class="facts">${block.items.map(item =>
      `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join("")}</dl></div>`;
}

/** One block as an element. The paginator moves these between sheets. */
export function blockHtml(block: PrintBlock): string {
  switch (block.kind) {
    case "masthead":
      return `<div class="masthead">${block.figures.map(figureHtml).join("")}</div>`;
    case "lead":
      return `<p class="lead">${esc(block.text)}</p>`;
    case "section":
      return `<div class="section">${sectionHeadHtml(block)}</div>`;
    case "table":
      return tableHtml(block);
    case "bars":
      return barsHtml(block);
    case "facts":
      return factsHtml(block);
    case "callout":
      return `<div class="callout-block">${sectionHeadHtml(block)}<div class="callout">`
        + `<ul>${block.items.map((item, index) => `<li${index === 0 && block.title ? ' class="callout__first"' : ""}>${esc(item)}</li>`).join("")}</ul></div></div>`;
    case "note":
      return `<p class="note">${esc(block.text)}</p>`;
  }
}

/**
 * The block that closes the document: the measured rules under one heading, then the endpoint's own
 * sentences under "What this cannot say".
 *
 * The sentences are printed verbatim. The pack does not compose them and does not merge two that share
 * a subject: merging three watch items about the same missed target would be the document editing the
 * finding.
 */
export function basisBlocks(basis: BasisBlock): PrintBlock[] {
  const blocks: PrintBlock[] = [];
  if (basis.measures.length) {
    blocks.push({
      kind: "facts",
      title: "How this is measured, and what it cannot say",
      lead: basis.asOf ? `Every figure on these sheets is as at ${basis.asOf}.` : undefined,
      items: basis.measures,
    });
  }
  if (basis.notes.length) {
    blocks.push({
      kind: "callout",
      title: basis.measures.length ? "What this cannot say" : "How this is measured, and what it cannot say",
      items: basis.notes,
    });
  }
  return blocks;
}

// ═══════════════════════════════════════════════════════════════════
//  The document HTML
// ═══════════════════════════════════════════════════════════════════

export interface PrintDocumentInput {
  brand: DocumentBrand;
  title: string;
  /** The line under the title: client · period · as-of · generated at · who generated it. */
  metaLine: string;
  /** The short running head on page 2 and later — document title · client. */
  runningHead: string;
  blocks: PrintBlock[];
  /** The company · generated-at half of the footer. The page count is counted here. */
  footerLeft: string;
  /** Print as soon as the sheets exist — a Print press rather than an Export. */
  autoPrint?: boolean;
}

/** The app's own type stack, and the same Google Fonts link the application loads it from. */
const FONT_LINK = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">';
const FONT_STACK = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * The sheet's stylesheet.
 *
 * Paper is white and ink is the palette's ink **whatever the interface theme is** — a print window has
 * no theme and no CSS variables to inherit, and a dark document is the defect this replaces. The one
 * colour an instance owns reaches this file as `accent`, and it is carried by the *weight* of a stroke
 * as well as by its hue (a 1.4 pt accent rule against a 0.5 pt hairline) so a greyscale photocopy still
 * reads the difference.
 */
export function documentCss(brand: DocumentBrand, presentation: DocumentPresentation): string {
  const { widthMm, heightMm } = pageBox(presentation);
  const ink = brand.palette.ink;
  const body = brand.palette.body;
  const muted = brand.palette.muted;
  const hairline = brand.palette.hairline;
  const tint = brand.palette.tint;
  const paper = brand.palette.paper;
  const accent = brand.accent;
  return `
*{margin:0;padding:0;box-sizing:border-box}
@page{size:${widthMm}mm ${heightMm}mm;margin:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{background:#e9edf2;color:${ink};font-family:${FONT_STACK};font-size:${TYPE_PT.body}pt;line-height:1.45;font-variant-numeric:tabular-nums}
.mono{font-family:${MONO_STACK}}
#stage{position:absolute;left:-9999mm;top:0;width:${contentWidthMm(presentation)}mm;visibility:hidden}
.sheet{width:${widthMm}mm;height:${heightMm}mm;padding:${DOC_MARGIN.top}mm ${DOC_MARGIN.right}mm ${DOC_MARGIN.bottom}mm ${DOC_MARGIN.left}mm;background:${paper};color:${ink};display:flex;flex-direction:column;position:relative;overflow:hidden;margin:0 auto 10mm;box-shadow:0 1px 3px rgb(0 0 0 / 0.18)}
.sheet__body{flex:1 1 auto;min-height:0;overflow:hidden}
.sheet__foot{position:absolute;left:${DOC_MARGIN.left}mm;right:${DOC_MARGIN.right}mm;bottom:0;height:${DOC_MARGIN.bottom}mm;padding-top:2.5mm;border-top:0.5pt solid ${hairline};display:flex;justify-content:space-between;gap:6mm;font-size:${TYPE_PT.small}pt;color:${muted};font-variant-numeric:tabular-nums}
.letterhead{display:flex;align-items:center;gap:3mm;padding-bottom:2mm;border-bottom:0.6pt solid ${ink}}
.letterhead img{width:9mm;height:9mm;object-fit:contain}
.letterhead__mark{font-size:15pt;font-weight:700;letter-spacing:-0.01em;line-height:1}
.letterhead__who{margin-left:auto;text-align:right;font-size:${TYPE_PT.small}pt;color:${muted};line-height:1.45}
.letterhead__who strong{color:${ink};font-weight:600}
.runhead{display:flex;align-items:baseline;justify-content:space-between;gap:6mm;padding-bottom:2mm;border-bottom:0.6pt solid ${hairline};font-size:${TYPE_PT.small}pt;color:${muted}}
.runhead__title{font-weight:600;color:${ink}}
.doc-title{font-size:${TYPE_PT.title}pt;font-weight:700;letter-spacing:-0.015em;margin-top:4mm;line-height:1.15}
.doc-meta{font-size:${TYPE_PT.small}pt;color:${muted};margin-top:1mm}
.doc-rule{height:1.4pt;background:${accent};margin-top:3mm}
.masthead{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:5mm;margin:5mm 0 1mm}
.figure{padding-top:1.6mm;border-top:0.5pt solid ${hairline}}
.figure--attention{border-top:1.4pt solid ${accent}}
.figure__value{font-size:${TYPE_PT.masthead}pt;font-weight:700;letter-spacing:-0.02em;line-height:1.05;font-variant-numeric:tabular-nums}
.figure__label{font-size:${TYPE_PT.small}pt;text-transform:uppercase;letter-spacing:0.06em;color:${muted};margin-top:0.6mm}
.figure__sub{font-size:${TYPE_PT.small}pt;color:${muted};margin-top:0.4mm}
.lead{font-size:${TYPE_PT.body}pt;color:${body};margin:3mm 0 0}
.section{margin-top:6mm}
.section__head{display:flex;align-items:baseline;gap:2.5mm;border-bottom:0.6pt solid ${hairline};padding-bottom:1.4mm;margin:6mm 0 2.2mm}
.masthead+.section__head,.masthead+.table-block>.section__head,.masthead+.facts-block>.section__head,.masthead+.callout-block>.section__head,.masthead+.bars-block>.section__head{margin-top:4mm}
.section__n{font-size:${TYPE_PT.section}pt;font-weight:700;color:${accent};font-variant-numeric:tabular-nums}
.section__title{font-size:${TYPE_PT.section}pt;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${body}}
.doc-table{width:100%;border-collapse:collapse;font-size:${TYPE_PT.table}pt}
.doc-table thead{display:table-header-group}
.doc-table th{text-align:left;font-size:${TYPE_PT.small}pt;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${muted};padding:0 2mm 1.4mm;border-bottom:0.6pt solid ${ink}}
.doc-table td{padding:1.3mm 2mm;border-bottom:0.4pt solid ${hairline};vertical-align:top;color:${body}}
.doc-table td:first-child{color:${ink}}
.doc-table tr.is-total td{border-bottom:none;border-top:0.5pt solid ${ink};font-weight:700;color:${ink}}
.num{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:${TYPE_PT.small}pt;color:${muted};font-style:italic;margin-top:1.5mm}
.bars{margin-top:1mm}
.bar{display:grid;grid-template-columns:60mm 1fr 32mm;gap:3mm;align-items:center;margin:0.9mm 0}
.bar__label{font-size:${TYPE_PT.body}pt}
.bar__track{height:2.4mm;background:${tint};overflow:hidden}
.bar__fill{display:block;height:100%;background:${body}}
.bar__fill--accent{background:${accent}}
.bar__value{font-size:${TYPE_PT.body}pt;text-align:right;font-variant-numeric:tabular-nums}
.bar--axis{margin-top:0.4mm}
.bar__axis{display:flex;justify-content:space-between;font-size:${TYPE_PT.small}pt;color:${muted}}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:0 8mm}
.facts>div{display:flex;justify-content:space-between;gap:3mm;border-bottom:0.4pt solid ${hairline};padding:1.3mm 0}
.facts dt{font-size:${TYPE_PT.body}pt;color:${muted}}
.facts dd{font-size:${TYPE_PT.body}pt;font-weight:600;text-align:right;color:${ink}}
.callout{border-left:1.4pt solid ${accent};padding:0.4mm 0 0.4mm 3mm;margin-bottom:2mm}
.callout ul{list-style:none}
.callout li{font-size:${TYPE_PT.body}pt;color:${body};margin:1mm 0}
@media print{
  body{background:${paper}}
  .sheet{margin:0;box-shadow:none;break-after:page;page-break-after:always}
  .sheet:last-child{break-after:auto;page-break-after:auto}
  .bar,.figure,.callout,.facts>div,.doc-table tr{break-inside:avoid;page-break-inside:avoid}
}
`;
}

/**
 * The paginator, run inside the print window.
 *
 * It moves the staged blocks onto sheets of exactly the paper size, splitting a table between rows
 * rather than across a page edge, and only then writes "page n of m" — a count it made itself. Written
 * as a string with no template literals so nothing in it collides with the outer interpolation.
 */
const PAGINATOR = `
(function(){
  var sheets=document.getElementById('sheets');
  var stage=document.getElementById('stage');
  if(!sheets||!stage){return;}
  var tplFirst=document.getElementById('tpl-first');
  var tplRun=document.getElementById('tpl-run');
  var tplFoot=document.getElementById('tpl-foot');
  function newSheet(first){
    var sheet=document.createElement('div'); sheet.className='sheet';
    var head=document.createElement('div'); head.className='sheet__head';
    head.appendChild((first?tplFirst:tplRun).content.cloneNode(true));
    var body=document.createElement('div'); body.className='sheet__body';
    var foot=document.createElement('div'); foot.className='sheet__foot';
    foot.appendChild(tplFoot.content.cloneNode(true));
    sheet.appendChild(head); sheet.appendChild(body); sheet.appendChild(foot);
    sheets.appendChild(sheet);
    return {sheet:sheet,body:body,continued:false};
  }
  function overflows(body){ return body.scrollHeight-body.clientHeight>1; }
  var current=newSheet(true);
  var children=Array.prototype.slice.call(stage.childNodes);
  for(var i=0;i<children.length;i++){
    var node=children[i];
    if(node.nodeType!==1){continue;}
    current.body.appendChild(node);
    if(!overflows(current.body)){continue;}
    var table=node.classList&&node.classList.contains('table-block')?node.querySelector('table'):null;
    if(table&&table.querySelector('tbody')&&table.querySelectorAll('tbody tr').length>1){
      // A table that will not fit is split between rows. The header travels with the continuation.
      var tbody=table.querySelector('tbody');
      var rows=Array.prototype.slice.call(tbody.children);
      for(var r=0;r<rows.length;r++){tbody.removeChild(rows[r]);}
      var brokeAt=-1;
      for(var r2=0;r2<rows.length;r2++){
        tbody.appendChild(rows[r2]);
        if(overflows(current.body)){brokeAt=r2;break;}
      }
      if(brokeAt>0){
        var carry=rows.slice(brokeAt);
        var next=newSheet(false);
        next.continued=true;
        var clone=table.cloneNode(false);
        var thead=table.querySelector('thead');
        if(thead){clone.appendChild(thead.cloneNode(true));}
        var fresh=document.createElement('tbody');
        for(var c=0;c<carry.length;c++){fresh.appendChild(carry[c]);}
        clone.appendChild(fresh);
        var note=node.querySelector('.note');
        var block=document.createElement('div'); block.className='table-block';
        block.appendChild(clone);
        if(note){block.appendChild(note);}
        next.body.appendChild(block);
        current=next;
        continue;
      }
      if(brokeAt===0){
        // Not even the header and one row fit under the block above, so start the table on a sheet of
        // its own. A table never begins mid-page if beginning it there would orphan its heading.
        var moved=rows.slice();
        for(var m=0;m<moved.length;m++){tbody.removeChild(moved[m]);}
        var clean=node;
        current.body.removeChild(clean);
        var own=newSheet(false);
        own.continued=true;
        own.body.appendChild(clean);
        for(var m2=0;m2<moved.length;m2++){tbody.appendChild(moved[m2]);}
        current=own;
        continue;
      }
      continue;
    }
    if(current.body.children.length===1){continue;} // A block too tall for a whole page: it prints where it is.
    current.body.removeChild(node);
    current=newSheet(false);
    current.body.appendChild(node);
  }
  var all=sheets.children;
  var total=all.length;
  for(var p=0;p<total;p++){
    var pg=all[p].querySelector('.pg');
    if(pg){pg.textContent='Page '+(p+1)+' of '+total;}
  }
  var ready=Promise.resolve();
  if(document.fonts&&document.fonts.ready){ready=document.fonts.ready.catch(function(){});}
  var wait=new Promise(function(resolve){setTimeout(resolve,1200);});
  Promise.race([ready,wait]).then(function(){
    var images=Array.prototype.slice.call(document.images).map(function(image){
      return image.complete?Promise.resolve():new Promise(function(resolve){image.onload=resolve;image.onerror=resolve;});
    });
    return Promise.all(images);
  }).then(function(){
    window.focus();
    if(window.__c7AutoPrint){setTimeout(function(){window.print();},60);}
  });
})();
`;

/**
 * The whole print document, as HTML for a fresh window.
 *
 * `@page { size: … }` is what makes the browser print the size the document chose instead of its own
 * default, and each `.sheet` is that same size to the millimetre, so nothing is scaled to fit.
 */
export function renderPrintDocument(input: PrintDocumentInput): string {
  const { brand } = input;
  const presentation = brand.presentation;
  const ink = brand.palette.ink;
  const accent = brand.accent;

  const markHtml = brand.mark.kind === "image"
    ? `<img src="${esc(brand.mark.src)}" alt="">`
    : "";

  const firstHead = `<div class="letterhead">${markHtml}`
    + `<span class="letterhead__mark" style="color:${esc(ink)}">${esc(brand.wordmark)}</span>`
    + `<span class="letterhead__who"><strong style="color:${esc(accent)}">${esc(brand.company)}</strong><br>`
    + `${esc(brand.tagline ?? brand.product)}</span></div>`
    + `<h1 class="doc-title">${esc(input.title)}</h1>`
    + `<p class="doc-meta">${esc(input.metaLine)}</p>`
    + `<div class="doc-rule"></div>`;

  const runHead = `<div class="runhead"><span class="runhead__title">${esc(input.runningHead)}</span>`
    + `<span class="runhead__continued">continued</span></div>`;

  const foot = `<span>${esc(input.footerLeft)}</span><span class="pg"></span>`;

  const body = input.blocks.map(blockHtml).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
    + `<title>${esc(input.title)}</title>${FONT_LINK}`
    + `<style>${documentCss(brand, presentation)}</style></head><body>`
    + `<div id="sheets"></div>`
    + `<div id="stage" aria-hidden="true">${body}</div>`
    + `<template id="tpl-first">${firstHead}</template>`
    + `<template id="tpl-run">${runHead}</template>`
    + `<template id="tpl-foot">${foot}</template>`
    + `<script>window.__c7AutoPrint=${input.autoPrint ? "true" : "false"};${PAGINATOR}<\/script>`
    + `</body></html>`;
}
