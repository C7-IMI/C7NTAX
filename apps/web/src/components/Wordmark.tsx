/**
 * The product logotypes, taken from the brand sheet's wordmark.
 *
 * They are drawn from two alpha masks each (see `.c7-wordmark` in `index.css`) rather
 * than a flat image, so there is no background plate behind them: the letters paint
 * with the inherited `color` — i.e. the active colour scheme's text colour — and the 7
 * is overprinted in brand crimson. That makes the same asset legible on both light and
 * dark surfaces.
 *
 * **C7NC wears the same mark as C7NTAX**, because it is the same logotype with two
 * letters fewer: same face, same tracking, same crimson 7. Its masks are composed from
 * the C7NTAX ones rather than drawn again (`scripts/brand/build-c7nc-wordmark.py`), so
 * the two read as siblings rather than as a mark and a lookalike.
 */
export type WordmarkKind = "c7ntax" | "c7nc";

const LABELS: Record<WordmarkKind, string> = { c7ntax: "C7NTAX", c7nc: "C7NC" };

export function Wordmark({
  height = 24,
  className = "",
  mark = "c7ntax",
}: {
  height?: number;
  className?: string;
  /** Which logotype: the product, or the companion-connector mark that sits inside it. */
  mark?: WordmarkKind;
}) {
  return (
    <span
      className={`c7-wordmark ${mark === "c7nc" ? "c7-wordmark--c7nc" : ""} ${className}`}
      style={{ height }}
      role="img"
      aria-label={LABELS[mark]}
    >
      <span className="c7-wordmark__letters" />
      <span className="c7-wordmark__seven" />
    </span>
  );
}
