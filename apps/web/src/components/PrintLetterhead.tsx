import { useDocumentBrand } from "../hooks/useBrandKit";

/**
 * The letterhead a printable screen wears.
 *
 * Only one screen prints the page it is on — a ticket, through the browser's own Print — and it did so
 * with a bare heading: a number, a title, a definition list. Anything leaving this application on paper
 * should be recognisable as coming from it, so the brand's mark and name open the sheet and the line
 * beneath says what the document is, who printed it and when.
 *
 * It is the **same brand** the print window and the PDF draw, read through `useDocumentBrand` rather
 * than through a second copy of the constants: the mark is decided here — an uploaded logo, the icon,
 * or the name set in type, which is what a shop with no artwork gets instead of a broken `<img>` — and
 * the accent beside it is the instance's own primary colour, never the interface's cyan.
 *
 * A document renderer in the print window cannot use this component (a popup cannot await a hook); it
 * draws the same letterhead from the same `DocumentBrand` in `lib/documentBrand`'s companion, the
 * document language in `components/reports/documentLanguage.ts`.
 */
export function PrintLetterhead({
  kind, subject, meta, family = "ticket",
}: {
  kind: string;
  subject?: string;
  /** The meta line — usually `Printed <time>`; the caller owns the words because it owns the facts. */
  meta?: string;
  /** The document family whose presentation decides the letterhead. */
  family?: "ticket";
}) {
  const brand = useDocumentBrand(family);
  return (
    <header className="print-letterhead">
      {brand.mark.kind === "image" && <img src={brand.mark.src} alt="" />}
      <span className="print-letterhead__mark" style={{ color: brand.palette.ink }}>
        {brand.wordmark}
      </span>
      <span className="print-letterhead__who" style={{ color: brand.palette.muted }}>
        <span style={{ color: brand.primaryColor }}>{brand.company}</span>
        <br />
        {subject ? `${kind} · ${subject}` : kind}
        <br />
        {meta ?? `Generated ${new Date().toLocaleString()}`}
      </span>
    </header>
  );
}
