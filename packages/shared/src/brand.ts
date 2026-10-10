/**
 * The instance's identity, and the settings that decide what a printed page looks like.
 *
 * There is **one brand record**, and it is the answer to "whose paper is this" everywhere: a standard
 * report, a business review, a designed report, an invoice, a quote, a statement, a ticket sheet, and
 * every email the product sends. Before this file each of those carried its own copy of the same five
 * facts — the wordmark `C7NTAX`, `Cyber 7 Group, LLC`, the shield, `#c00000`, and the contact line — so
 * changing a logo meant finding every copy, and a missing one showed as a document that was *almost*
 * branded. `apps/web/src/lib/documentBrand.ts` was the closest thing to a single source and it was a
 * frozen `const`: nothing could change it, which is precisely the complaint this replaces.
 *
 * **Why the stored shape and the render shape are different types.** A stored record is a form: mostly
 * optional strings, because a half-filled brand is a legitimate state and a person may clear a field.
 * A renderer cannot work with that. It needs to know that `wordmark` is never empty, that there is
 * *something* to draw at the top of the page, and which of four letterhead arrangements was chosen —
 * so `resolveDocumentBrand` does that work once, in one place, and every renderer receives a
 * `DocumentBrand` whose fields are all decided. A document that has to guess is a document that
 * eventually prints "undefined", and it prints it in front of a customer.
 *
 * **What the brand may change, and what it deliberately may not.** An instance may change its name,
 * its logo, its icon, its contact details, its legal footer, and its two brand colours. It may **not**
 * change the document's ink, its body text colour or its rules. Those four are the difference between
 * a page a reader can read and a page they cannot: a brand kit is not a stylesheet, and an instance
 * that set its body text to its own mid-tone accent would produce an invoice nobody can read and would
 * have no way to know until a customer said so. `DOCUMENT_PALETTE` is therefore fixed, and the two
 * settable colours are constrained to places where a wrong value is a cosmetic problem — the wordmark's
 * numeral, a rule, a section bar.
 */

/** Where a document's top-of-page mark comes from. */
export type DocumentLetterhead =
  /** The uploaded logo lockup (`logoUrl`), falling back to the icon, then the wordmark. */
  | "logo"
  /** The square mark alone (`iconUrl`) — for a document whose own title is the headline. */
  | "icon"
  /** The typeset wordmark, no image at all: the correct choice for a shop with no artwork. */
  | "wordmark"
  /** Nothing: the document begins with its title, 18mm down. */
  | "none";

/**
 * The document palette.
 *
 * Fixed literals rather than theme tokens, for the reason stated at the top of this file and in
 * DESIGN.md §8: a printed page is a third surface with no CSS variables to resolve, and it is read as
 * paper — often in greyscale, often photocopied. These values are the ones the Modern documents
 * were drawn against.
 */
export const DOCUMENT_PALETTE = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  rule: "#cbd5e1",
  hairline: "#e2e8f0",
  tint: "#f1f5f9",
  paper: "#ffffff",
} as const;

/** The two colours an instance owns. Everything else about a page is decided by the document. */
export const BRAND_COLOR_DEFAULTS = {
  /** The wordmark's numeral and **the one accent a printed page uses** — the product's crimson. */
  primaryColor: "#c00000",
  /**
   * The interface's and email's secondary colour.
   *
   * Deliberately **not** used on paper. It is `#00c0f4`, which measures 2.1:1 against white — below the
   * 3:1 a non-text object needs to be seen at all (DESIGN.md §7) — so as a printed rule or bar it
   * disappears in greyscale and is close to invisible in colour. Paper gets `primaryColor`, and a
   * document carries its meaning in the *weight* of a stroke as well as its colour so that a reader
   * with a mono printer still gets the signal.
   */
  accentColor: "#00c0f4",
} as const;

/** The contrast a colour needs against paper before it may be used as a mark rather than as text. */
export const DOCUMENT_MARK_MIN_CONTRAST = 3;

/**
 * The contrast ratio between two hex colours, 1–21.
 *
 * Here so the settings screen can *say* that a colour will not survive a printed page instead of
 * letting somebody discover it on a document a client has already received. Photocopied pages lose
 * low-contrast marks long before they lose text, and this is the only place in the product where a
 * colour choice is invisible until it is on paper.
 */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const value = hex.replace("#", "");
    const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
    const channel = (pair: string): number => {
      const srgb = parseInt(pair, 16) / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(full.slice(0, 2)) + 0.7152 * channel(full.slice(2, 4)) + 0.0722 * channel(full.slice(4, 6));
  };
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The stored brand: one row per instance (`id: "instance"`).
 *
 * Everything is nullable that a person can reasonably leave blank, and the nulls are meaningful — they
 * are what `resolveDocumentBrand` fills from the defaults below. `null` is also how a *per-client*
 * override says "inherit this from the instance" (see `mergeBrandOverride`), which is why an empty
 * string is normalised to `null` on the way in: a form that was cleared of its contents means "use the
 * instance's", not "draw a blank line where the company name goes".
 */
export interface BrandKit {
  /** The product's own name, as it appears in the interface's chrome and a document's footer. */
  productName: string;
  /** The company that owns this instance — the entity a document is issued by. */
  companyName: string;

  /** A line of description under the company name, e.g. "Professional Services". */
  tagline: string | null;
  /** The lockup for light backgrounds: icon and wordmark together, as exported from a design tool. */
  logoUrl: string | null;
  /** The same lockup drawn for a dark background, if the instance has one. */
  logoDarkUrl: string | null;
  /** The square mark on its own — the app icon, the favicon, and a document's letterhead. */
  iconUrl: string | null;
  /** The typeset fallback. When it is empty, `productName` is used instead. */
  wordmark: string | null;

  /** A phone number and an email address on one line, as they should appear on paper. */
  contactLine: string | null;
  /** Postal address, one entry per line. Kept as lines rather than one blob so a document can place them. */
  addressLines: string[];
  website: string | null;

  primaryColor: string;
  accentColor: string;

  /** The sentence at the foot of every generated document — payment terms, a confidentiality line. */
  documentFooter: string | null;
  /** The small print. Set once here rather than typed into each template. */
  legalText: string | null;

  /** The sender an email is from, and where a reply goes. */
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;

  /**
   * What each family of document wears, as stored — `{ [family]: Partial<DocumentPresentation> }`.
   *
   * On the record rather than fetched separately because the browser needs it to resolve a document's
   * paper and letterhead, and a second request is a document that prints before its settings arrive.
   * Absent keys mean the family's default, so this map being empty is the same as it not existing.
   */
  documentPresentation: Record<string, Partial<DocumentPresentation>>;
}

/**
 * The brand a brand-new instance has before anybody opens the settings.
 *
 * These are the values the product shipped with as literals, gathered in one place. An instance that
 * never opens Branding therefore produces exactly the documents it produced before this file existed,
 * which is the same rule the email templates follow: adopting a feature must not silently restyle
 * something a customer already receives.
 */
export const DEFAULT_BRAND: BrandKit = {
  productName: "C7NTAX",
  companyName: "Cyber 7 Group, LLC",
  tagline: "Professional Services",
  logoUrl: null,
  logoDarkUrl: null,
  /** The shipped artwork: the shield with the 7, from the brand composite sheet. */
  iconUrl: "/icon-192.png",
  wordmark: "C7NTAX",
  contactLine: "info@cyber7group.com · +1-555-0100",
  addressLines: [],
  website: null,
  ...BRAND_COLOR_DEFAULTS,
  documentFooter: null,
  legalText: null,
  fromName: null,
  fromEmail: null,
  replyTo: null,
  documentPresentation: {},
};

/** Every document this instance can produce. Used as the key for per-family settings. */
export const DOCUMENT_FAMILIES = [
  "report.standard",
  "report.review",
  "report.custom",
  "report.designer",
  "invoice",
  "quote",
  "statement",
  "ticket",
] as const;

export type DocumentFamily = (typeof DOCUMENT_FAMILIES)[number];

/** How a family is named in the settings, and what it is for — the words live here so they cannot drift. */
export const DOCUMENT_FAMILY_LABELS: Record<DocumentFamily, { title: string; what: string }> = {
  "report.standard": { title: "Standard reports", what: "The sixteen reports under Reporting → Standard reports" },
  "report.review": { title: "Business reviews", what: "The weekly, monthly and quarterly packs" },
  "report.custom": { title: "Report packs", what: "Several reports gathered into one document" },
  "report.designer": { title: "Designed reports", what: "Reports drawn band by band in the report designer" },
  invoice: { title: "Invoices", what: "Issued to a client, and the one document a client keeps" },
  quote: { title: "Quotes", what: "Sent before the work, and signed by the client" },
  statement: { title: "Statements", what: "What a client owes, listed account by account" },
  ticket: { title: "Ticket sheets", what: "A ticket printed for the file, or sent to the client on request" },
};

/**
 * What a document of one family wears.
 *
 * The defaults are the design decisions, made once, and they differ per family on purpose: an invoice
 * is a formal document that a client files and pays, so it carries the full lockup and page numbers; a
 * standard report is read internally and its own title is the headline, so the icon alone is enough; a
 * designed report's author placed its header bands by hand and the letterhead is left to them.
 */
export interface DocumentPresentation {
  letterhead: DocumentLetterhead;
  pageSize: "a4" | "letter";
  orientation: "portrait" | "landscape";
  showFooter: boolean;
  showPageNumbers: boolean;
  /** The "where these figures came from" block. Off is a decision somebody has to make on purpose. */
  showBasis: boolean;
  /** Replaces the document's own title. Null keeps it. */
  title: string | null;
  /** A line of context under the title — a period, a client, a reference. */
  subtitle: string | null;
  /** Extra words for the foot of this family's documents, above `documentFooter`. */
  footerNote: string | null;
}

export const DEFAULT_DOCUMENT_PRESENTATION: Record<DocumentFamily, DocumentPresentation> = {
  "report.standard": {
    letterhead: "icon", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: true,
    title: null, subtitle: null, footerNote: null,
  },
  "report.review": {
    letterhead: "logo", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: true,
    title: null, subtitle: null, footerNote: null,
  },
  "report.custom": {
    letterhead: "logo", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: true,
    title: null, subtitle: null, footerNote: null,
  },
  "report.designer": {
    letterhead: "none", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: false,
    title: null, subtitle: null, footerNote: null,
  },
  invoice: {
    letterhead: "logo", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: false,
    title: null, subtitle: null, footerNote: null,
  },
  quote: {
    letterhead: "logo", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: false,
    title: null, subtitle: null, footerNote: null,
  },
  statement: {
    letterhead: "logo", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: false,
    title: null, subtitle: null, footerNote: null,
  },
  ticket: {
    letterhead: "icon", pageSize: "a4", orientation: "portrait",
    showFooter: true, showPageNumbers: true, showBasis: false,
    title: null, subtitle: null, footerNote: null,
  },
};

/**
 * A case-by-case brand: one client billed under another entity, or one document drawn differently.
 *
 * Every field is optional and `null` means "inherit". A client that is its own legal entity needs its
 * own name and address on the invoice it receives, and nothing else about the document changes — so an
 * override is a *patch* over the instance's brand rather than a second brand, and the two cannot
 * disagree about the parts nobody overrode.
 *
 * Presentation is overridable too, because "this report, landscape, without the letterhead" is a
 * request a person will make about one document rather than about the family.
 */
export interface BrandOverride {
  companyName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  iconUrl?: string | null;
  wordmark?: string | null;
  contactLine?: string | null;
  addressLines?: string[] | null;
  website?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  documentFooter?: string | null;
  legalText?: string | null;
  presentation?: Partial<DocumentPresentation> | null;
}

/** A value from a stored record: absent, blank and null all mean "nothing was set". */
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** The stored per-family presentation, coerced to the shape a renderer can merge. */
function storedPresentations(value: unknown): Record<string, Partial<DocumentPresentation>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Partial<DocumentPresentation>>;
}

/** The stored brand with every field decided. This is what a form edits and what the API returns. */
export function normaliseBrand(row: Partial<BrandKit> | null | undefined): BrandKit {
  const source = row ?? {};
  const colour = (value: string | null | undefined, fallback: string) => {
    const found = clean(value);
    // A colour is only accepted as a hex triple or sextuplet: an instance that typed "red" would
    // otherwise set a value no renderer agrees on, and it would fail on paper rather than on screen.
    return found && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(found) ? found : fallback;
  };
  const addresses = (source.addressLines ?? []).map((line) => clean(line)).filter((line): line is string => !!line);
  return {
    productName: clean(source.productName) ?? DEFAULT_BRAND.productName,
    companyName: clean(source.companyName) ?? DEFAULT_BRAND.companyName,
    tagline: clean(source.tagline),
    logoUrl: clean(source.logoUrl),
    logoDarkUrl: clean(source.logoDarkUrl),
    // The presence of the key is what distinguishes "never set" (the shipped shield) from "cleared"
    // (no mark at all, so a document sets its wordmark in type instead).
    iconUrl: "iconUrl" in source ? clean(source.iconUrl) : DEFAULT_BRAND.iconUrl,
    wordmark: clean(source.wordmark),
    contactLine: clean(source.contactLine),
    addressLines: addresses,
    website: clean(source.website),
    primaryColor: colour(source.primaryColor, DEFAULT_BRAND.primaryColor),
    accentColor: colour(source.accentColor, DEFAULT_BRAND.accentColor),
    documentFooter: clean(source.documentFooter),
    legalText: clean(source.legalText),
    fromName: clean(source.fromName),
    fromEmail: clean(source.fromEmail),
    replyTo: clean(source.replyTo),
    documentPresentation: storedPresentations(source.documentPresentation),
  };
}

/**
 * Lay an override over the instance's brand.
 *
 * Absent and `null` are the same thing here — leave it alone. Only a *value* overrides, so a client
 * whose override form was never filled in behaves exactly like a client with no override at all, and
 * clearing one field of a client's brand falls back to the instance rather than to nothing.
 */
export function mergeBrandOverride(base: BrandKit, override: BrandOverride | null | undefined): BrandKit {
  if (!override) return base;
  const take = <K extends keyof BrandKit>(key: K): BrandKit[K] =>
    (override[key as keyof BrandOverride] === undefined || override[key as keyof BrandOverride] === null
      ? base[key]
      : (override[key as keyof BrandOverride] as BrandKit[K]));
  const addressLines = override.addressLines && override.addressLines.length ? override.addressLines : base.addressLines;
  return normaliseBrand({
    ...base,
    companyName: take("companyName"),
    tagline: take("tagline"),
    logoUrl: take("logoUrl"),
    logoDarkUrl: take("logoDarkUrl"),
    iconUrl: take("iconUrl") ?? null,
    wordmark: take("wordmark"),
    contactLine: take("contactLine"),
    addressLines,
    website: take("website"),
    primaryColor: take("primaryColor"),
    accentColor: take("accentColor"),
    documentFooter: take("documentFooter"),
    legalText: take("legalText"),
  });
}

/**
 * A renderer's brand: every field decided, and the presentation attached.
 *
 * `ink`, `body`, `muted`, `rule`, `hairline` and `paper` are not on `BrandKit` and cannot be overridden
 * — see the note at the top of this file. A renderer reads them from here so that no renderer keeps its
 * own copy of a hex value.
 */
export interface DocumentBrand {
  product: string;
  company: string;
  tagline: string | null;
  contactLine: string | null;
  addressLines: string[];
  website: string | null;
  /**
   * The mark for the letterhead, already chosen.
   *
   * `none` is a real answer and not an absence: a designed report whose author placed its own header
   * bands must have nothing drawn above them, and a renderer that treated `none` as "draw the wordmark
   * anyway" would overrule the person who laid the page out.
   */
  mark: { kind: "image"; src: string; alt: string } | { kind: "wordmark"; text: string } | { kind: "none" };
  wordmark: string;
  primaryColor: string;
  /**
   * The document's one accent — the instance's primary colour.
   *
   * A page gets one accent and it is the primary, not the interface's cyan: see
   * `BRAND_COLOR_DEFAULTS.accentColor` for why the interface's secondary colour cannot be printed.
   */
  accent: string;
  documentFooter: string | null;
  legalText: string | null;
  presentation: DocumentPresentation;
  palette: typeof DOCUMENT_PALETTE;
}

/** The palette and the presentation, with a family's defaults applied to whatever was stored. */
export function resolvePresentation(
  family: DocumentFamily,
  stored: Partial<DocumentPresentation> | null | undefined,
): DocumentPresentation {
  const fallback = DEFAULT_DOCUMENT_PRESENTATION[family];
  return {
    letterhead: stored?.letterhead ?? fallback.letterhead,
    pageSize: stored?.pageSize ?? fallback.pageSize,
    orientation: stored?.orientation ?? fallback.orientation,
    showFooter: stored?.showFooter ?? fallback.showFooter,
    showPageNumbers: stored?.showPageNumbers ?? fallback.showPageNumbers,
    showBasis: stored?.showBasis ?? fallback.showBasis,
    title: clean(stored?.title),
    subtitle: clean(stored?.subtitle),
    footerNote: clean(stored?.footerNote),
  };
}

/**
 * Decide the letterhead once, so a renderer never has to ask whether an image exists.
 *
 * This is the function that makes "I uploaded a logo and now the documents use it" true. An instance
 * with no artwork at all gets the typeset wordmark — a document with a wordmark is a branded document,
 * and one with a broken `<img>` is not.
 */
export function resolveDocumentBrand(
  kit: BrandKit,
  family: DocumentFamily,
  stored?: Partial<DocumentPresentation> | null,
): DocumentBrand {
  const presentation = resolvePresentation(family, stored);
  const wordmark = kit.wordmark ?? kit.productName;
  const icon = kit.iconUrl;
  const logo = kit.logoUrl;

  const mark: DocumentBrand["mark"] =
    presentation.letterhead === "none"
      ? { kind: "none" }
      : presentation.letterhead === "wordmark"
        ? { kind: "wordmark", text: wordmark }
        : presentation.letterhead === "icon"
          ? icon
            ? { kind: "image", src: icon, alt: kit.companyName }
            : { kind: "wordmark", text: wordmark }
          : (logo ?? icon)
            ? { kind: "image", src: (logo ?? icon) as string, alt: kit.companyName }
            : { kind: "wordmark", text: wordmark };

  return {
    product: kit.productName,
    company: kit.companyName,
    tagline: kit.tagline,
    contactLine: kit.contactLine,
    addressLines: kit.addressLines,
    website: kit.website,
    mark,
    wordmark,
    primaryColor: kit.primaryColor,
    accent: kit.primaryColor,
    documentFooter: kit.documentFooter,
    legalText: kit.legalText,
    presentation,
    palette: DOCUMENT_PALETTE,
  };
}

/**
 * The whole chain in one call: the instance's brand, a client's override, one family's settings, and a
 * single report's own settings.
 *
 * The order is the order of specificity, and it is the reason a client can be invoiced portrait while
 * one report is drawn landscape: the family's stored settings are the instance's answer, a client's
 * override is an answer about *that client's* documents, and a report's own row is an answer about one
 * document. The last one wins.
 */
export function documentBrandFor(
  kit: BrandKit,
  family: DocumentFamily,
  override?: BrandOverride | null,
  reportPresentation?: Partial<DocumentPresentation> | null,
): DocumentBrand {
  const merged = mergeBrandOverride(kit, override);
  const presentation = {
    ...(kit.documentPresentation?.[family] ?? {}),
    ...(override?.presentation ?? {}),
    ...(reportPresentation ?? {}),
  };
  return resolveDocumentBrand(merged, family, presentation);
}

/** The largest upload accepted, in bytes. A letterhead is a drawn page on a PDF, not a photograph. */
export const BRAND_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** The image types an upload may be. SVG is excluded: an uploaded SVG is a script with a `.svg` name. */
export const BRAND_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * The fields a person edits in the Branding settings.
 *
 * `documentPresentation` is deliberately not one of them: paper size, orientation and the letterhead are
 * chosen **per family of document**, on the Documents screen, rather than as a single value on the
 * identity form — which is what makes an invoice portrait and a report landscape.
 */
export type BrandFieldKey = Exclude<keyof BrandKit, "documentPresentation">;

/**
 * What each field is, in the words the settings screen uses.
 *
 * Here rather than in the page for the reason the email fields are: the API validates against the same
 * list, so a field that gains a rule gains it in one place, and the settings screen cannot drift into
 * describing a field differently from the way it behaves.
 */
export const BRAND_FIELDS: { key: BrandFieldKey; label: string; help: string; kind: "text" | "lines" | "color" | "image" }[] = [
  { key: "productName", label: "Product name", help: "The application's own name, used in the interface and the footer of a document.", kind: "text" },
  { key: "companyName", label: "Company name", help: "The legal entity a document is issued by.", kind: "text" },
  { key: "tagline", label: "Tagline", help: "One line under the company name, such as the practice you run.", kind: "text" },
  { key: "logoUrl", label: "Logo", help: "The full lockup for light paper. Used by invoices, quotes and reviews.", kind: "image" },
  { key: "logoDarkUrl", label: "Logo on dark", help: "If your lockup is drawn for a dark background, for emails that use one.", kind: "image" },
  { key: "iconUrl", label: "Icon", help: "The square mark on its own: the app icon, the favicon, and the letterhead of an internal report.", kind: "image" },
  { key: "wordmark", label: "Wordmark", help: "The name set in type, drawn when no logo has been uploaded. Leave empty to use the product name.", kind: "text" },
  { key: "contactLine", label: "Contact line", help: "A phone number and an address on one line, as they should read on paper.", kind: "text" },
  { key: "addressLines", label: "Postal address", help: "One line each. Printed in the footer of a document that is posted.", kind: "lines" },
  { key: "website", label: "Website", help: "Shown with the contact details.", kind: "text" },
  { key: "primaryColor", label: "Primary colour", help: "The wordmark's numeral and the one accent a printed page uses. Must be readable on white — a mark below 3:1 vanishes on a photocopy.", kind: "color" },
  { key: "accentColor", label: "Accent colour", help: "The interface's and email's secondary colour. Not used on printed pages.", kind: "color" },
  { key: "documentFooter", label: "Document footer", help: "The sentence at the foot of every generated document — payment terms, or a confidentiality line.", kind: "text" },
  { key: "legalText", label: "Legal text", help: "Small print, set once here rather than typed into each template.", kind: "text" },
  { key: "fromName", label: "Email sender name", help: "The name your mail appears to come from.", kind: "text" },
  { key: "fromEmail", label: "Email sender address", help: "The address your mail comes from. Your provider must allow it.", kind: "text" },
  { key: "replyTo", label: "Reply-to address", help: "Where a reply goes, when it should differ from the sender.", kind: "text" },
];

/**
 * The logo and the icon are the two people actually came here to change, so they are named as such
 * rather than buried among the seventeen fields above.
 */
export const BRAND_HEADLINE_FIELDS: BrandFieldKey[] = ["logoUrl", "iconUrl"];
