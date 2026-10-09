import { DOCUMENT_BRAND } from "../lib/documentBrand";

/**
 * The letterhead a printable screen wears.
 *
 * Only one screen prints the page it is on — a ticket, through the browser's own Print — and it did so
 * with a bare heading: a number, a title, a definition list. Anything leaving this application on paper
 * should be recognisable as coming from it, so the shield and the wordmark open the sheet, and the line
 * beneath says what the document is and when it was made.
 *
 * It is a sibling of `lib/documentBrand.ts` rather than a second brand: the same constants, the same
 * shield, so the PDF a report produces and the paper a ticket produces cannot drift apart.
 */
export function PrintLetterhead({ kind, subject, meta }: { kind: string; subject?: string; meta?: string }) {
  return (
    <header className="print-letterhead">
      <img src={DOCUMENT_BRAND.shield} alt="" />
      <span className="print-letterhead__mark">
        C<b>7</b>NTAX
      </span>
      <span className="print-letterhead__who">
        {DOCUMENT_BRAND.company}
        <br />
        {subject ? `${kind} · ${subject}` : kind}
        <br />
        {meta ?? `Generated ${new Date().toLocaleString()}`}
      </span>
    </header>
  );
}
