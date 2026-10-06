/**
 * The app mark — the brand sheet's shield, keyed onto its black tile
 * (`apps/web/public/icon-192.png`; see `brand/README.md` for the crop bounds).
 * The tile's rounded corners are baked into the PNG, so no CSS radius is
 * needed. Decorative: pair it with the wordmark, which carries the name.
 */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <img src="/icon-192.png" alt="" width={size} height={size} className={`shrink-0 ${className}`} />
  );
}
