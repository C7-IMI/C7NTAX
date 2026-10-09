/**
 * The brand a **generated** document wears — the reporting outputs and the ticket's own print sheet.
 *
 * This module is an **adapter, not a source of truth.** It used to be a frozen `const`: a company
 * name, a shield path, a crimson, typed here once and unchangeable, which is exactly why uploading a
 * logo could not change a document. The values now live once, in the brand kit in `@C7NTAX/shared`
 * (`DEFAULT_BRAND`, `DOCUMENT_PALETTE`), and the resolved brand for a document family is held in
 * `hooks/useBrandKit`'s module-level cache so an **imperative** path — a print window a browser will
 * not let us await, a jsPDF run — can read it synchronously.
 *
 * A renderer therefore has no business importing this file: it receives a `DocumentBrand` and draws
 * it. Two names are kept here only because existing importers need them:
 *
 *  - `DOCUMENT_BRAND`, the *shipped* brand as a plain object, **derived** from the shared defaults
 *    rather than retyped. It is the fallback the email screens read; a document reader wants
 *    `documentBrandOf(family)` from `hooks/useBrandKit`.
 *  - `shieldDataUrl(mark)`, which fetches a mark's bytes and caches the data URL because **jsPDF
 *    cannot draw a URL**. The cache is keyed by the mark's `src`, so a changed logo is a new fetch and
 *    an unchanged one costs nothing.
 */
import { DEFAULT_BRAND, DOCUMENT_PALETTE, type DocumentBrand } from "@C7NTAX/shared";
import { documentBrandOf } from "../hooks/useBrandKit";

/**
 * The **shipped** brand as a plain object — derived from the shared defaults, never retyped.
 *
 * It exists for the screens that have no brand context of their own (`components/email/brandView.ts`
 * is the one remaining consumer). A document does not want this: it wants `documentBrandOf(family)`,
 * which is the instance's brand as it stands, with the letterhead already chosen.
 */
export const DOCUMENT_BRAND = {
  product: DEFAULT_BRAND.productName,
  company: DEFAULT_BRAND.companyName,
  /** The shipped artwork: the shield on its tile, falling back to the app icon path. */
  shield: DEFAULT_BRAND.iconUrl ?? "/icon-192.png",
  /** Brand crimson: the wordmark's numeral, and the one accent a printed page uses. */
  crimson: DEFAULT_BRAND.primaryColor,
  /** The interface's secondary colour. Deliberately not used on paper — see `BRAND_COLOR_DEFAULTS`. */
  accent: DEFAULT_BRAND.accentColor,
  ...DOCUMENT_PALETTE,
} as const;

/** The line under a document's title: what it is about, and when it was made. */
export function documentMetaLine(subtitle?: string, period?: string, at: Date = new Date()): string {
  return [subtitle, period, `Generated ${at.toLocaleString()}`].filter(Boolean).join(" · ");
}

/**
 * A mark's bytes as a data URL, fetched once and cached **by `src`**.
 *
 * Cached as the *promise* rather than the result so two exports starting together share one request,
 * and a failure is cached too — a missing badge is a cosmetic loss, and retrying it on every export
 * would turn it into a slow document instead. Keyed by `src` rather than held in one slot, because the
 * src is now the instance's uploaded artwork: a logo that changes is a different key, so the new one is
 * fetched and the old one is simply never asked for again.
 */
const markCache = new Map<string, Promise<string | null>>();

export function markDataUrl(src: string): Promise<string | null> {
  const cached = markCache.get(src);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  markCache.set(src, pending);
  return pending;
}

/**
 * The current brand's mark as a data URL, for jsPDF.
 *
 * Named `shieldDataUrl` because that is the name the PDF path has always called, but it is now **the
 * mark of the brand as it stands**: the uploaded logo where there is one, the icon otherwise, and
 * `null` where the document sets its name in type — a typeset wordmark has no bytes to draw and needs
 * none. A caller with no brand in hand gets the internal-report mark, which is what a report drawn
 * before the brand arrived would have worn anyway.
 */
export function shieldDataUrl(mark?: DocumentBrand["mark"]): Promise<string | null> {
  const resolved = mark ?? documentBrandOf("report.standard").mark;
  return resolved.kind === "image" ? markDataUrl(resolved.src) : Promise.resolve(null);
}
