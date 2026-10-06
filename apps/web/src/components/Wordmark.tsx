/**
 * The C7NTAX logotype, taken from the brand sheet's wordmark.
 *
 * It is drawn from two alpha masks (see `.c7-wordmark` in `index.css`) rather
 * than a flat image, so there is no background plate behind it: the letters
 * paint with the inherited `color` — i.e. the active colour scheme's text
 * colour — and the 7 is overprinted in brand crimson. That makes the same
 * asset legible on both light and dark surfaces.
 */
export function Wordmark({ height = 24, className = "" }: { height?: number; className?: string }) {
  return (
    <span
      className={`c7-wordmark ${className}`}
      style={{ height }}
      role="img"
      aria-label="C7NTAX"
    >
      <span className="c7-wordmark__letters" />
      <span className="c7-wordmark__seven" />
    </span>
  );
}
