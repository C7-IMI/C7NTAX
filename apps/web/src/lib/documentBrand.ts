/**
 * The brand every **generated** document wears — the reporting outputs and the ticket's own print
 * sheet.
 *
 * One place, because the same report leaves this application three ways: printed from the report
 * screen, printed from the browser, and saved as a PDF. A reader who is handed two of those should be
 * able to see they are the same document, and the application's answer to "what does our paper look
 * like" belongs in one file rather than in three `<style>` blocks that slowly disagree.
 *
 * The **shield** is the app icon's own artwork (`/icon-192.png`), which is the shield + 7 glyph from
 * the brand composite sheet on its black tile — `brand/README.md` is the record of how it was cut and
 * why the crops are what they are. It is fetched as a data URL for jsPDF, which cannot draw a URL,
 * and referenced directly in a print window, which is HTML and can.
 *
 * **A custom report is deliberately excluded.** A report drawn in the banded designer has header
 * bands its author placed by hand; putting the product's shield above them would be overruling the
 * person who designed the page. Everything the application generates on a user's behalf wears this.
 */
export const DOCUMENT_BRAND = {
  product: "C7NTAX",
  company: "Cyber 7 Group, LLC",
  /** The shield, from the composite sheet's icon variation. */
  shield: "/icon-192.png",
  /** Brand crimson — the 7's colour everywhere else in the product. */
  crimson: "#c00000",
  /** The accent the interface uses for a rule, a bar or a selected row. */
  accent: "#00c0f4",
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  rule: "#cbd5e1",
  hairline: "#e2e8f0",
  tint: "#f1f5f9",
  zebra: "#f8fafc",
} as const;

/** The line under a document's title: what it is about, and when it was made. */
export function documentMetaLine(subtitle?: string, period?: string, at: Date = new Date()): string {
  return [subtitle, period, `Generated ${at.toLocaleString()}`].filter(Boolean).join(" · ");
}

/**
 * The shield as a data URL, fetched once per session.
 *
 * Cached as the *promise* rather than the result so two exports starting together share one request,
 * and a failure is cached too — a missing badge is a cosmetic loss, and retrying it on every export
 * would turn it into a slow document instead.
 */
let shieldPromise: Promise<string | null> | null = null;

export function shieldDataUrl(): Promise<string | null> {
  if (!shieldPromise) {
    shieldPromise = (async () => {
      try {
        const response = await fetch(DOCUMENT_BRAND.shield);
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
  }
  return shieldPromise;
}
