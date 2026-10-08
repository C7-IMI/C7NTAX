/**
 * The Kumo logotype — the wordmark with the spider over the M.
 *
 * Kumo is an application inside C7NTAX rather than a section of it, so it is
 * branded as one: this is drawn wherever the navigation would otherwise label it
 * "Kumo" with a generic icon.
 *
 * It is built from two alpha masks (see `.kumo-wordmark` in `index.css`) rather
 * than a flat image, for the same reason the C7NTAX wordmark is: there is no
 * background plate behind it, the letters paint with the inherited `color` — so
 * the mark is black on a light scheme and white on a dark one, and dims with the
 * navigation row it sits in — and the spider is overprinted at Kumo's own red,
 * which no colour scheme changes. One asset, both modes, every scheme.
 */
export function KumoWordmark({ height = 22, className = "" }: { height?: number; className?: string }) {
  return (
    <span
      className={`kumo-wordmark ${className}`}
      style={{ height }}
      role="img"
      aria-label="Kumo"
    >
      <span className="kumo-wordmark__letters" />
      <span className="kumo-wordmark__spider" />
    </span>
  );
}
