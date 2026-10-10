/**
 * The brand, in one module.
 *
 * There is exactly one brand record (`BrandKit`, id `instance`) and this is its only reader and writer,
 * on the server. It answers two different callers and the difference is worth stating plainly:
 *
 * · **The email path** asks for `EmailBrandValues` — flat strings already resolved, because a message's
 *   blocks interpolate them and a missing value would print `undefined` into a customer's inbox.
 *   `loadBrandKit()` keeps that shape and the short cache the send path relies on.
 * · **A document** asks for a `DocumentBrand` — the letterhead *decided*, the paper and orientation
 *   resolved, the palette attached — via `brandForDocument()`. A renderer therefore contains no
 *   branding logic and no hex values, and adding a document family later is a call, not a template.
 *
 * The record moved here from `emailTemplateSend.ts` (and was renamed from `EmailBrandKit`) because it
 * stopped being an email setting: it now decides the letterhead of every report, PDF, invoice,
 * statement and ticket sheet. Two readers of one record is how a settings screen comes to disagree
 * with the document it is previewing, which is the specific failure this module exists to prevent.
 *
 * **Why a cache, and why it is dropped on write.** The brand is read on every send and every preview,
 * so one row read per notification is one query per notification. It is cached for a short window and
 * invalidated the instant it is saved, so a change is live immediately rather than after the window —
 * a person who saves a new logo and prints a document must see the new logo.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../index";
import {
  BRAND_UPLOAD_MAX_BYTES,
  documentBrandFor,
  normaliseBrand,
  resolvePresentation,
  type BrandKit,
  type BrandOverride,
  type DocumentBrand,
  type DocumentFamily,
  type DocumentPresentation,
} from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { logger } from "./logger";
import { DEFAULT_BRAND as EMAIL_DEFAULT_BRAND, type EmailBrandValues } from "./emailMessages";

/** The one brand-kit row. A fixed id, so "the instance's brand" cannot become two rows. */
export const BRAND_ROW_ID = "instance";

/** The columns this module reads. Explicit, so adding a column is a visible decision. */
type BrandRow = {
  productName: string;
  companyName: string;
  tagline: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  wordmark: string | null;
  contactLine: string | null;
  addressLines: unknown;
  website: string | null;
  primaryColor: string;
  accentColor: string;
  footerText: string | null;
  documentFooter: string | null;
  legalText: string | null;
  documentPresentation: unknown;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  updatedById: string | null;
  updatedAt: Date;
};

const BRAND_COLUMNS = {
  productName: true, companyName: true, tagline: true, logoUrl: true, logoDarkUrl: true, iconUrl: true,
  wordmark: true, contactLine: true, addressLines: true, website: true, primaryColor: true, accentColor: true,
  footerText: true, documentFooter: true, legalText: true, documentPresentation: true,
  fromName: true, fromEmail: true, replyTo: true, updatedById: true, updatedAt: true,
} as const;

/** The sender identity an email uses. A blank address means "whatever `SMTP_FROM` says". */
export interface BrandIdentity {
  from: string | null;
  replyTo: string | null;
}

let brandCache: { at: number; values: EmailBrandValues; identity: BrandIdentity } | null = null;
const BRAND_CACHE_MS = 30_000;

export function invalidateBrandKit(): void {
  brandCache = null;
}

/**
 * The brand record, or null when it has never been saved.
 *
 * A read failure is warned about and treated as "no row" rather than thrown: the brand decides a
 * letterhead, and a document with the shipped defaults is a far better outcome than a 500 where an
 * invoice should be.
 */
async function readBrandRow(): Promise<BrandRow | null> {
  try {
    return (await prisma.brandKit.findUnique({ where: { id: BRAND_ROW_ID }, select: BRAND_COLUMNS })) as BrandRow | null;
  } catch (err) {
    logger.warn("brand", "Could not read the brand kit; the built-in defaults were used", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** A stored address list, whichever way it was written. */
function addressLinesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Everything a message interpolates, defaults already applied. */
function toValues(row: BrandRow | null): EmailBrandValues {
  return {
    productName: row?.productName || EMAIL_DEFAULT_BRAND.productName,
    companyName: row?.companyName || EMAIL_DEFAULT_BRAND.companyName,
    wordmark: row?.wordmark || EMAIL_DEFAULT_BRAND.wordmark,
    primaryColor: row?.primaryColor || EMAIL_DEFAULT_BRAND.primaryColor,
    accentColor: row?.accentColor || EMAIL_DEFAULT_BRAND.accentColor,
    footerText: row?.footerText ?? EMAIL_DEFAULT_BRAND.footerText,
    legalText: row?.legalText ?? EMAIL_DEFAULT_BRAND.legalText,
  };
}

/** A sender identity only exists once somebody has set one. */
function toIdentity(row: BrandRow | null): BrandIdentity {
  const email = row?.fromEmail?.trim();
  if (!email) return { from: null, replyTo: row?.replyTo?.trim() || null };
  const name = row?.fromName?.trim();
  return { from: name ? `${name} <${email}>` : email, replyTo: row?.replyTo?.trim() || null };
}

/**
 * The brand as the email path wants it: effective values, the sender identity, and the raw row.
 *
 * `row` is null on a cache hit — the cache holds the resolved values, not the row — so a caller that
 * needs the row itself must not treat null as "unset". The send path does not need it.
 */
export async function loadBrandKit(): Promise<{ values: EmailBrandValues; identity: BrandIdentity; row: BrandRow | null }> {
  if (brandCache && Date.now() - brandCache.at < BRAND_CACHE_MS) {
    return { values: brandCache.values, identity: brandCache.identity, row: null };
  }
  const row = await readBrandRow();
  const values = toValues(row);
  const identity = toIdentity(row);
  brandCache = { at: Date.now(), values, identity };
  return { values, identity, row };
}

/** The brand as a document and the settings screens want it: every field decided. */
export async function loadBrand(): Promise<BrandKit> {
  const row = await readBrandRow();
  if (!row) return normaliseBrand(null);
  return normaliseBrand({
    productName: row.productName,
    companyName: row.companyName,
    tagline: row.tagline,
    logoUrl: row.logoUrl,
    logoDarkUrl: row.logoDarkUrl,
    iconUrl: row.iconUrl,
    wordmark: row.wordmark,
    contactLine: row.contactLine,
    addressLines: addressLinesFrom(row.addressLines),
    website: row.website,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    documentFooter: row.documentFooter,
    legalText: row.legalText,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
    documentPresentation: presentationMap(row.documentPresentation),
  } satisfies Partial<BrandKit>);
}

/**
 * One family's settings, with the instance's and then a specific report's laid over the family default.
 *
 * `reportKey` is what makes "this report, landscape, no basis block" possible without a second place to
 * keep a page size: the report's own row is a patch on its family's, which is a patch on the code's
 * default.
 */
export function presentationFor(
  family: DocumentFamily,
  stored: unknown,
  reportPresentation?: unknown,
): DocumentPresentation {
  const familySaid = (stored && typeof stored === "object" ? (stored as Record<string, unknown>)[family] : null) as
    | Partial<DocumentPresentation>
    | null
    | undefined;
  const reportSaid = (reportPresentation ?? null) as Partial<DocumentPresentation> | null;
  return resolvePresentation(family, { ...(familySaid ?? {}), ...(reportSaid ?? {}) });
}

/**
 * The brand a document of one family wears — the only way a renderer should get a brand.
 *
 * `companyId` is the client the document is issued to, and it is where a case-by-case brand is looked
 * up. `reportKey` narrows a report's own presentation. Both are optional and both default to the
 * instance's own, so a caller that knows neither still prints a correctly branded page.
 */
export async function brandForDocument(
  family: DocumentFamily,
  companyId?: string | null,
  reportKey?: string | null,
): Promise<DocumentBrand> {
  const kit = await loadBrand();
  const override = companyId ? await loadCompanyOverride(companyId) : null;
  const reportPresentation = reportKey ? (await loadReportPresentation(reportKey))?.presentation ?? null : null;
  // The kit already carries the per-family map, so the precedence (family ← client ← report) lives in
  // one place in the shared contract rather than being re-derived here and in the browser.
  return documentBrandFor(kit, family, override, reportPresentation);
}

/** The nickname a person is known by, for the "who generated it" line and the settings' history. */
async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return new Map(
    users.map((user) => [
      user.id,
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
    ]),
  );
}

/**
 * The brand as the API hands it out: the stored fields, plus what each unset field falls back to.
 *
 * The `effective` block exists so a settings screen can show the value that will actually be used
 * rather than an empty box that means something the reader has to guess.
 */
export interface BrandKitDto {
  productName: string;
  companyName: string;
  tagline: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  wordmark: string | null;
  contactLine: string | null;
  addressLines: string[];
  website: string | null;
  primaryColor: string;
  accentColor: string;
  footerText: string | null;
  documentFooter: string | null;
  legalText: string | null;
  /** Per-family `DocumentPresentation`, as stored — absent keys mean the family's default. */
  documentPresentation: Record<string, Partial<DocumentPresentation>>;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  /** What every send actually uses, defaults included. */
  effective: EmailBrandValues;
  /** What an `SMTP_FROM` the brand kit does not override would send from. */
  smtpFrom: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

function presentationMap(value: unknown): Record<string, Partial<DocumentPresentation>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Partial<DocumentPresentation>>;
}

export async function brandKitDto(): Promise<BrandKitDto> {
  const row = await readBrandRow();
  const names = await userNames([row?.updatedById]);
  return {
    productName: row?.productName ?? EMAIL_DEFAULT_BRAND.productName,
    companyName: row?.companyName ?? EMAIL_DEFAULT_BRAND.companyName,
    tagline: row?.tagline ?? null,
    logoUrl: row?.logoUrl ?? null,
    logoDarkUrl: row?.logoDarkUrl ?? null,
    iconUrl: row?.iconUrl ?? null,
    wordmark: row?.wordmark ?? null,
    contactLine: row?.contactLine ?? null,
    addressLines: addressLinesFrom(row?.addressLines),
    website: row?.website ?? null,
    primaryColor: row?.primaryColor ?? EMAIL_DEFAULT_BRAND.primaryColor,
    accentColor: row?.accentColor ?? EMAIL_DEFAULT_BRAND.accentColor,
    footerText: row?.footerText ?? EMAIL_DEFAULT_BRAND.footerText,
    documentFooter: row?.documentFooter ?? null,
    legalText: row?.legalText ?? null,
    documentPresentation: presentationMap(row?.documentPresentation),
    fromName: row?.fromName ?? null,
    fromEmail: row?.fromEmail ?? null,
    replyTo: row?.replyTo ?? null,
    effective: toValues(row),
    smtpFrom: process.env.SMTP_FROM ?? "noreply@cyber7group.com",
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    updatedByName: row?.updatedById ? names.get(row.updatedById) ?? null : null,
  };
}

/** A stored string, trimmed, or null when the field was cleared. */
function optionalText(value: unknown, limit = 1000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

/** A hex colour, refused rather than stored, so a typo cannot reach a printed page. */
function colour(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    throw new AppError("A colour must be a hex value such as #c00000", 400);
  }
  return value.trim();
}

/** How a presentation may be stored: the four answers, each one of a known set. */
function presentationPatch(value: unknown): Partial<DocumentPresentation> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const patch: Partial<DocumentPresentation> = {};
  const letters = ["logo", "icon", "wordmark", "none"] as const;
  if (typeof input.letterhead === "string" && (letters as readonly string[]).includes(input.letterhead)) {
    patch.letterhead = input.letterhead as DocumentPresentation["letterhead"];
  }
  if (input.pageSize === "a4" || input.pageSize === "letter") patch.pageSize = input.pageSize;
  if (input.orientation === "portrait" || input.orientation === "landscape") patch.orientation = input.orientation;
  for (const flag of ["showFooter", "showPageNumbers", "showBasis"] as const) {
    if (typeof input[flag] === "boolean") patch[flag] = input[flag] as boolean;
  }
  // Only the keys actually sent. Writing `title: null` for a body that never mentioned a title is how a
  // reset turns into an override — an empty patch must stay empty so it can be recognised as "no
  // override at all" and deleted rather than stored.
  for (const key of ["title", "subtitle", "footerNote"] as const) {
    if (Object.prototype.hasOwnProperty.call(input, key)) patch[key] = optionalText(input[key], key === "footerNote" ? 500 : 200);
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Save the brand.
 *
 * A field that is absent from the body is **left alone**; a field present and blank clears it. The
 * settings form sends everything it holds, so the distinction only matters to a partial write — and
 * getting it backwards is how one screen's save silently empties another screen's field.
 */
export async function saveBrandKit(input: Record<string, unknown>, userId: string): Promise<BrandKitDto> {
  const before = await readBrandRow();
  const existing = (before ?? {}) as Partial<BrandRow>;
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(input, key);
  const text = (key: string, limit: number, fallback: unknown): unknown =>
    has(key) ? optionalText(input[key], limit) : fallback;

  const data = {
    productName: (has("productName") ? optionalText(input.productName, 100) : existing.productName) ?? EMAIL_DEFAULT_BRAND.productName,
    companyName: (has("companyName") ? optionalText(input.companyName, 200) : existing.companyName) ?? EMAIL_DEFAULT_BRAND.companyName,
    tagline: text("tagline", 200, existing.tagline),
    logoUrl: text("logoUrl", 2000, existing.logoUrl),
    logoDarkUrl: text("logoDarkUrl", 2000, existing.logoDarkUrl),
    iconUrl: text("iconUrl", 2000, existing.iconUrl),
    wordmark: text("wordmark", 100, existing.wordmark),
    contactLine: text("contactLine", 300, existing.contactLine),
    addressLines: has("addressLines")
      ? addressLinesFrom(input.addressLines).slice(0, 8)
      : (existing.addressLines ?? []),
    website: text("website", 300, existing.website),
    primaryColor: has("primaryColor") ? colour(input.primaryColor, existing.primaryColor ?? EMAIL_DEFAULT_BRAND.primaryColor) : existing.primaryColor,
    accentColor: has("accentColor") ? colour(input.accentColor, existing.accentColor ?? EMAIL_DEFAULT_BRAND.accentColor) : existing.accentColor,
    footerText: text("footerText", 1000, existing.footerText),
    documentFooter: text("documentFooter", 1000, existing.documentFooter),
    legalText: text("legalText", 2000, existing.legalText),
    documentPresentation: has("documentPresentation")
      ? documentPresentationPatch(input.documentPresentation)
      : existing.documentPresentation,
    fromName: text("fromName", 200, existing.fromName),
    fromEmail: text("fromEmail", 320, existing.fromEmail),
    replyTo: text("replyTo", 320, existing.replyTo),
    updatedById: userId,
  };
  for (const address of [data.fromEmail, data.replyTo]) {
    if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(address))) {
      throw new AppError("The sender address is not a valid email address", 400);
    }
  }
  const create = { id: BRAND_ROW_ID, ...data, addressLines: data.addressLines ?? [] };
  await prisma.brandKit.upsert({
    where: { id: BRAND_ROW_ID },
    create: create as never,
    update: data as never,
  });
  invalidateBrandKit();
  return brandKitDto();
}

/** The whole per-family map, merged with a patch for one family — what the documents screen saves. */
function documentPresentationPatch(value: unknown): Record<string, Partial<DocumentPresentation>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Partial<DocumentPresentation>> = {};
  for (const [family, entry] of Object.entries(value as Record<string, unknown>)) {
    const patch = presentationPatch(entry);
    if (patch) out[family] = patch;
  }
  return out;
}

// ── A client's own brand ────────────────────────────────────────────────────

/**
 * The client's brand patch, or null.
 *
 * A client with `portalLogoUrl` and no logo of its own falls back to it — a client has one logo, and
 * two would drift. Invalid JSON in the column is treated as no override rather than thrown: a
 * document must still print.
 */
export async function loadCompanyOverride(companyId: string): Promise<BrandOverride | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { brandOverride: true, portalLogoUrl: true, portalAccentColor: true },
  });
  if (!company) return null;
  const stored = (company.brandOverride && typeof company.brandOverride === "object" && !Array.isArray(company.brandOverride)
    ? (company.brandOverride as Record<string, unknown>)
    : {}) as BrandOverride;
  const patch: BrandOverride = { ...stored };
  if (!patch.logoUrl && company.portalLogoUrl) patch.logoUrl = company.portalLogoUrl;
  if (!patch.primaryColor && company.portalAccentColor) patch.primaryColor = company.portalAccentColor;
  if (!Object.keys(patch).length) return null;
  if (patch.presentation) patch.presentation = presentationPatch(patch.presentation) ?? undefined;
  return patch;
}

export async function saveCompanyOverride(companyId: string, input: unknown): Promise<BrandOverride | null> {
  const patch = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as BrandOverride;
  const cleaned: BrandOverride = {
    companyName: optionalText(patch.companyName, 200),
    tagline: optionalText(patch.tagline, 200),
    logoUrl: optionalText(patch.logoUrl, 2000),
    logoDarkUrl: optionalText(patch.logoDarkUrl, 2000),
    iconUrl: optionalText(patch.iconUrl, 2000),
    wordmark: optionalText(patch.wordmark, 100),
    contactLine: optionalText(patch.contactLine, 300),
    addressLines: Array.isArray(patch.addressLines) ? addressLinesFrom(patch.addressLines).slice(0, 8) : null,
    website: optionalText(patch.website, 300),
    primaryColor: patch.primaryColor ? colour(patch.primaryColor, "#c00000") : null,
    accentColor: patch.accentColor ? colour(patch.accentColor, "#00c0f4") : null,
    documentFooter: optionalText(patch.documentFooter, 1000),
    legalText: optionalText(patch.legalText, 2000),
    presentation: patch.presentation ? presentationPatch(patch.presentation) : null,
  };
  const empty = Object.values(cleaned).every((value) => value === null || value === undefined);
  await prisma.company.update({
    where: { id: companyId },
    // SQL NULL rather than the JSON value `null`, which would store the four characters "null" and read
    // back as an override that is present and empty.
    data: { brandOverride: empty ? Prisma.DbNull : (cleaned as never) },
  });
  return empty ? null : cleaned;
}

// ── One report's own presentation ───────────────────────────────────────────

export interface ReportPresentationDto {
  reportKey: string;
  presentation: Partial<DocumentPresentation>;
  updatedAt: string;
  updatedByName: string | null;
}

export async function loadReportPresentation(reportKey: string): Promise<ReportPresentationDto | null> {
  const row = await prisma.reportPresentation.findUnique({ where: { reportKey } });
  if (!row) return null;
  const names = await userNames([row.updatedById]);
  return {
    reportKey: row.reportKey,
    presentation: (row.presentation ?? {}) as Partial<DocumentPresentation>,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedById ? names.get(row.updatedById) ?? null : null,
  };
}

export async function listReportPresentations(): Promise<ReportPresentationDto[]> {
  const rows = await prisma.reportPresentation.findMany({ orderBy: { reportKey: "asc" } });
  const names = await userNames(rows.map((row) => row.updatedById));
  return rows.map((row) => ({
    reportKey: row.reportKey,
    presentation: (row.presentation ?? {}) as Partial<DocumentPresentation>,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedById ? names.get(row.updatedById) ?? null : null,
  }));
}

export async function saveReportPresentation(
  reportKey: string,
  input: unknown,
  userId: string,
): Promise<ReportPresentationDto | null> {
  const key = reportKey.trim();
  if (!key) throw new AppError("A report key is required", 400);
  const patch = presentationPatch(input);
  if (!patch || !Object.keys(patch).length) {
    await prisma.reportPresentation.deleteMany({ where: { reportKey: key } });
    return null;
  }
  await prisma.reportPresentation.upsert({
    where: { reportKey: key },
    create: { reportKey: key, presentation: patch as never, updatedById: userId },
    update: { presentation: patch as never, updatedById: userId },
  });
  return loadReportPresentation(key);
}

// ── Uploaded logos and icons ────────────────────────────────────────────────

/**
 * The bytes of an image, checked against its own type rather than trusted from the request.
 *
 * A file renamed `.png` is not a PNG, and this is the one place where "it looked like an image on the
 * settings screen" would otherwise become "the API serves arbitrary bytes back to a customer's mail
 * client". The magic number is the only claim worth believing.
 */
function looksLikeImage(contentType: string, bytes: Buffer): boolean {
  const head = (...values: number[]) => bytes.subarray(0, values.length).equals(Buffer.from(values));
  if (contentType === "image/png") return bytes.length > 8 && head(0x89, 0x50, 0x4e, 0x47);
  if (contentType === "image/jpeg") return bytes.length > 3 && head(0xff, 0xd8, 0xff);
  if (contentType === "image/webp") {
    return bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

/**
 * Store an uploaded logo or icon and return its public URL.
 *
 * The upload arrives as a data URL because that is what a browser's `FileReader` produces; the bytes
 * are kept and the URL handed back is this API's own, so a document emailed to a client carries a link
 * their mail client can fetch without a session.
 */
export async function putBrandAsset(
  kind: unknown,
  dataUrl: unknown,
  userId: string,
): Promise<{ id: string; url: string; contentType: string; byteSize: number }> {
  const allowed = ["logo", "logoDark", "icon"];
  if (typeof kind !== "string" || !allowed.includes(kind)) {
    throw new AppError("An asset must be a logo or an icon", 400);
  }
  if (typeof dataUrl !== "string") throw new AppError("The upload did not arrive as an image", 400);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  const [, mime, base64] = match ?? [];
  if (!mime || !base64) {
    throw new AppError("A logo must be a PNG, JPEG or WebP image. SVG is not accepted.", 400);
  }
  const contentType = mime.toLowerCase();
  const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
  if (!bytes.length) throw new AppError("That image was empty", 400);
  if (bytes.length > BRAND_UPLOAD_MAX_BYTES) {
    throw new AppError(`An image must be under ${Math.round(BRAND_UPLOAD_MAX_BYTES / (1024 * 1024))} MB`, 400);
  }
  if (!looksLikeImage(contentType, bytes)) {
    throw new AppError("That file is not a PNG, JPEG or WebP image", 400);
  }
  const asset = await prisma.brandAsset.create({
    data: { kind, contentType, bytes, byteSize: bytes.length, uploadedById: userId },
  });
  return { id: asset.id, url: `/api/brand/asset/${asset.id}`, contentType, byteSize: bytes.length };
}

/**
 * The bytes of one uploaded image.
 *
 * Addressed by an opaque id rather than a filename, which is why this route can be served without a
 * session: there is no path to escape and no directory to traverse, and a logo has to be fetchable by
 * a mail client that has no cookie. Assets are never deleted on replace, because a client's override
 * may still point at an older one.
 */
export async function readBrandAsset(id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const asset = await prisma.brandAsset.findUnique({ where: { id }, select: { contentType: true, bytes: true } });
  if (!asset) return null;
  return { contentType: asset.contentType, bytes: Buffer.from(asset.bytes as Uint8Array) };
}
