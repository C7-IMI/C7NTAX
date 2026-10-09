/**
 * The brand kit and the delivery rules as the screens draw them.
 *
 * **The kit is a real reading, with real defaults under it.** `GET /api/email/brand` answers with the
 * stored row *and* `effective` — the values every send actually uses once the built-in defaults are
 * applied — plus `smtpFrom`, the address the instance was started with. That is why an unset field is
 * drawn with the default it falls back to and a sentence saying so, rather than as an empty box that
 * could mean either "nothing" or "the default": `logoUrl: null` means the shield, and the shield is
 * `/icon-192.png`, which is the same file `lib/documentBrand.ts` hands the report PDFs.
 *
 * When that read fails the screen falls back to those same constants read locally from
 * `lib/documentBrand.ts` — the brand the PDFs already wear — and says per value that this is what it is
 * doing, because a kit shown from a different source than the one it claims is the sort of thing this
 * feature exists to prevent.
 *
 * **The rules have no source at all.** Nothing stores quiet hours, the batch window or the bounce
 * threshold: the API does not expose them, so `proposedSettings()` returns this feature's design and
 * every screen that draws them says they are proposed and disables the controls with the reason.
 */
import { DOCUMENT_BRAND } from "../../lib/documentBrand";
import type { ApiBrand } from "./emailApi";
import { DELIVERY_DEFAULTS } from "./emailFacts";

/** Where a value came from, so the screen can say it beside the value rather than only in a note. */
export type ValueSource = "api" | "document" | "proposed";

export const BRAND_FIELDS = [
  "productName", "companyName", "wordmark", "logoUrl", "logoDarkUrl",
  "primaryColor", "accentColor", "footerText", "legalText",
  "fromName", "fromEmail", "replyTo",
] as const;

export type BrandFieldId = (typeof BRAND_FIELDS)[number];

export interface BrandView {
  source: ValueSource;
  productName: string;
  companyName: string;
  wordmark: string;
  logoUrl: string;
  logoDarkUrl: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
  legalText: string;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  /** The address the instance was started with, which a blank kit falls back to. */
  smtpFrom: string;
  /**
   * True per field when the kit appears to store a value.
   *
   * It is only *meaningful* for the fields the DTO keeps `null` when unset — `logoUrl`, `logoDarkUrl`,
   * `wordmark`, `legalText`, `fromName`, `fromEmail` and `replyTo`. For `productName`, `companyName`,
   * `primaryColor`, `accentColor` and `footerText` the DTO hands back the effective value whether or not
   * the row holds it, so those read as set and a screen must not claim they are stored.
   */
  stored: Record<BrandFieldId, boolean>;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface SettingsView {
  source: ValueSource;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  batchWindowMinutes: number;
  batchThreshold: number;
  batchCeilingMinutes: number;
  digestEnabled: boolean;
  unsubscribeEnabled: boolean;
  bounceThreshold: number;
  retentionDays: number;
}

/** The footer a message carries when nobody has written one, in the words the senders use today. */
const DEFAULT_FOOTER = "Sent by C7NTAX on behalf of Cyber 7 Group, LLC.";

export function resolveBrand(api: ApiBrand | null): BrandView {
  const effective = api?.effective;
  const stored: Record<BrandFieldId, boolean> = {
    productName: Boolean(api?.productName),
    companyName: Boolean(api?.companyName),
    wordmark: Boolean(api?.wordmark),
    logoUrl: Boolean(api?.logoUrl),
    logoDarkUrl: Boolean(api?.logoDarkUrl),
    primaryColor: Boolean(api?.primaryColor),
    accentColor: Boolean(api?.accentColor),
    footerText: api?.footerText != null,
    legalText: api?.legalText != null,
    fromName: Boolean(api?.fromName),
    fromEmail: Boolean(api?.fromEmail),
    replyTo: Boolean(api?.replyTo),
  };
  return {
    source: api ? "api" : "document",
    productName: effective?.productName ?? api?.productName ?? DOCUMENT_BRAND.product,
    companyName: effective?.companyName ?? api?.companyName ?? DOCUMENT_BRAND.company,
    wordmark: effective?.wordmark ?? api?.wordmark ?? DOCUMENT_BRAND.product,
    logoUrl: api?.logoUrl ?? DOCUMENT_BRAND.shield,
    logoDarkUrl: api?.logoDarkUrl ?? DOCUMENT_BRAND.shield,
    primaryColor: effective?.primaryColor ?? api?.primaryColor ?? DOCUMENT_BRAND.crimson,
    accentColor: effective?.accentColor ?? api?.accentColor ?? DOCUMENT_BRAND.accent,
    footerText: effective?.footerText ?? api?.footerText ?? DEFAULT_FOOTER,
    legalText: effective?.legalText ?? api?.legalText ?? "",
    fromName: api?.fromName ?? null,
    fromEmail: api?.fromEmail ?? null,
    replyTo: api?.replyTo ?? null,
    smtpFrom: api?.smtpFrom ?? "the address in SMTP_FROM",
    stored,
    updatedAt: api?.updatedAt ?? null,
    updatedByName: api?.updatedByName ?? null,
  };
}

/**
 * The delivery rules as proposed. There is no read to fail here: the API does not expose these at all,
 * which is itself the fact the screen states.
 */
export function proposedSettings(): SettingsView {
  return { source: "proposed", ...DELIVERY_DEFAULTS };
}

/** The sentence each source prints, so the two screens word it identically. */
export const SOURCE_SENTENCE: Record<ValueSource, string> = {
  api: "Read from GET /api/email/brand, with the values every send actually uses.",
  document:
    "GET /api/email/brand did not answer, so these are the built-in defaults and the constants in lib/documentBrand.ts — the same brand the report PDFs and the ticket's print sheet already wear.",
  proposed:
    "Proposed. The API does not expose the delivery rules (there is no /api/email/settings), so these are the values this feature asks for and every control that would change them is disabled with the reason beside it.",
};
