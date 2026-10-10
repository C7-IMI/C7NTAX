/**
 * What a document wears, in the words the two settings screens use — and, for each control, **who reads
 * it**.
 *
 * The words and the choices live here so the Documents screen and the Reports screen describe a
 * `DocumentPresentation` the same way; the arrangement belongs to the pages, the description does not.
 *
 * **The `carried` sentences are the honest part of this file.** The record holds nine presentation
 * settings and they are not equally wired up, which was established by reading the renderers rather
 * than by assuming:
 *
 *  - the **letterhead** and the **paper size** reach the API's own documents — an invoice, a statement
 *    and a quote are drawn through `brandForDocument()`, which lays the family's row (and a report's own
 *    patch) over the code's default, and then set their sheet from `presentation.pageSize`;
 *  - the **basis block** is read by the report print and PDF paths (`reportKit.basisOf`);
 *  - the **orientation**, and the footer, page numbers and three text overrides, are read by **no**
 *    renderer: they are stored and resolved and nothing consumes them;
 *  - and the **web** print and PDF paths (`reportKit`, the ticket sheet) read the family's presentation
 *    from the *code's* default rather than from this record, because the browser's brand cache
 *    (`hooks/useBrandKit`) carries the brand and not the per-family map.
 *
 * A settings screen that drew all nine as though they were all enforced would be promising a page nobody
 * gets, so each control says which it is and the page says it once more at the top.
 */
import {
  DEFAULT_DOCUMENT_PRESENTATION,
  type DocumentFamily,
  type DocumentPresentation,
} from "@C7NTAX/shared";
import { ORIENTATION_LABELS, PAPER_SIZES } from "../reports/documentLanguage";

/** Where a document's top-of-page mark comes from, each choice explained. */
export interface LetterheadOption {
  id: DocumentPresentation["letterhead"];
  label: string;
  help: string;
}

export const LETTERHEAD_OPTIONS: LetterheadOption[] = [
  {
    id: "logo",
    label: "The logo",
    help: "The uploaded lockup. Falls back to the icon, and to the wordmark in type when there is neither — a document never draws a broken image.",
  },
  {
    id: "icon",
    label: "The icon",
    help: "The square mark alone, for a document whose own title is the headline — an internal report, a ticket sheet.",
  },
  {
    id: "wordmark",
    label: "The wordmark",
    help: "The name set in type, with no image at all: the right choice for a shop with no artwork.",
  },
  {
    id: "none",
    label: "Nothing",
    help: "For a designed report whose author placed its header: no mark is chosen for you. Note that the renderer draws the wordmark where a lockup would go today, so this and the wordmark print the same page — reported, not hidden.",
  },
];

export const PAPER_OPTIONS = [
  { id: "a4" as const, label: PAPER_SIZES.a4.label },
  { id: "letter" as const, label: PAPER_SIZES.letter.label },
];

export const ORIENTATION_OPTIONS = [
  { id: "portrait" as const, label: "Portrait" },
  { id: "landscape" as const, label: ORIENTATION_LABELS.landscape },
];

/** A yes/no presentation setting, with the sentence saying what reads it. */
export interface FlagSpec {
  key: "showFooter" | "showPageNumbers" | "showBasis";
  label: string;
  help: string;
  carried: string;
}

const API_DOCUMENTS =
  "Read by the API's own documents — an invoice, a statement and a quote are drawn through brandForDocument(), which lays this row over the code's default.";
const RECORDED_ONLY =
  "Recorded and resolved, and read by no renderer yet: changing it stores the choice rather than changing a page.";

export const FLAG_SPECS: FlagSpec[] = [
  {
    key: "showFooter",
    label: "Footer",
    help: "The line at the foot of the sheet: who printed it, when, and the confidential line.",
    carried: RECORDED_ONLY,
  },
  {
    key: "showPageNumbers",
    label: "Page numbers",
    help: "“Page n of m”, counted by the paginator rather than guessed by the browser.",
    carried: RECORDED_ONLY,
  },
  {
    key: "showBasis",
    label: "The basis block",
    help: "“How this is measured, and what it cannot say”, printed from the endpoint's own sentences. Leaving it out is a decision somebody should make on purpose.",
    carried: "Read by the report print and PDF paths, and stored as the family's default so those two agree. The invoice, the statement and the quote never carry one.",
  },
];

/** What the letterhead choice actually reaches, in one sentence, for the control's note. */
export const LETTERHEAD_CARRIED = API_DOCUMENTS;

/** The paper size, and the one path that takes its paper from somewhere else. */
export const PAPER_CARRIED =
  `${API_DOCUMENTS} The report print and PDF paths take their paper from the choice made at the moment of export, not from this record.`;

/** The orientation, which nothing reads. */
export const ORIENTATION_CARRIED =
  "Stored and resolved and read by no renderer yet: the API's documents set their paper size and leave the orientation to the sheet's own layout, and the export dialog carries its own choice.";

/** The three text overrides. The sentence says what a value reaches, and what a blank means. */
export interface TextSpec {
  key: "title" | "subtitle" | "footerNote";
  label: string;
  help: string;
  placeholder: string;
  carried: string;
}

export const TEXT_SPECS: TextSpec[] = [
  {
    key: "title",
    label: "Title override",
    help: "Replaces the document's own title. Blank keeps it.",
    placeholder: "Keep the document's own title",
    carried: RECORDED_ONLY,
  },
  {
    key: "subtitle",
    label: "Subtitle",
    help: "A line of context under the title — a period, a client, a reference.",
    placeholder: "Keep the document's own line",
    carried: RECORDED_ONLY,
  },
  {
    key: "footerNote",
    label: "Footer note",
    help: "Extra words for the foot of this family's documents, above the instance's footer sentence.",
    placeholder: "No extra footer note",
    carried: RECORDED_ONLY,
  },
];

/** One sentence for the letterhead, for a chip or a table cell. */
export function letterheadLabel(id: DocumentPresentation["letterhead"]): string {
  return LETTERHEAD_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function paperLabel(id: DocumentPresentation["pageSize"]): string {
  return id === "letter" ? "Letter" : "A4";
}

export function orientationLabel(id: DocumentPresentation["orientation"]): string {
  return id === "landscape" ? "Landscape" : "Portrait";
}

/** "A4 · portrait · the icon · footer and page numbers" — the whole of what a family wears, in a cell. */
export function presentationLine(presentation: DocumentPresentation): string {
  const flags = [
    presentation.showFooter ? "footer" : null,
    presentation.showPageNumbers ? "page numbers" : null,
    presentation.showBasis ? "basis block" : null,
  ].filter(Boolean);
  return [
    `${paperLabel(presentation.pageSize)} · ${orientationLabel(presentation.orientation).toLowerCase()}`,
    letterheadLabel(presentation.letterhead).toLowerCase(),
    flags.length ? flags.join(" + ") : "no footer, page numbers or basis",
  ].join(" · ");
}

/**
 * The keys of `draft` that differ from what it would resolve to without them.
 *
 * This is what keeps a stored row *small and honest*: a family saved with one change stores one key, so
 * `changed` on `GET /api/brand` means "somebody changed something" rather than "somebody opened this
 * row and pressed Save". It is also what a report's patch is measured against — the report's own patch
 * is laid over its family's, so the reference is the family as it resolves rather than the code default.
 */
export function patchAgainst(
  reference: DocumentPresentation,
  draft: DocumentPresentation,
): Partial<DocumentPresentation> {
  const patch: Partial<DocumentPresentation> = {};
  for (const key of Object.keys(reference) as (keyof DocumentPresentation)[]) {
    const before = reference[key];
    const after = draft[key];
    const same = Array.isArray(before) || Array.isArray(after)
      ? JSON.stringify(before) === JSON.stringify(after)
      : before === after;
    if (!same) Object.assign(patch, { [key]: after });
  }
  return patch;
}

/** The family's own defaults, for a screen that needs to say what "the default" is. */
export function familyDefaults(family: DocumentFamily): DocumentPresentation {
  return DEFAULT_DOCUMENT_PRESENTATION[family];
}

/** What a family's row is, and whether it is the code's default or somebody's choice. */
export function isChanged(family: DocumentFamily, presentation: DocumentPresentation): boolean {
  return Object.keys(patchAgainst(DEFAULT_DOCUMENT_PRESENTATION[family], presentation)).length > 0;
}
