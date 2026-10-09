/**
 * The Branding section's reads and writes.
 *
 * One module rather than four, because the four screens are four views of **one record**: the identity,
 * what each family of document wears, the client overrides and the reports that differ are all
 * `GET /api/brand` plus one narrowing read. The read/write helpers are the Email Studio's
 * (`components/email/emailApi.ts`), reused rather than rewritten: a read there resolves to a *status*
 * rather than to data, so a panel that could not be read says what could not be read instead of drawing
 * an empty form, and a write answers in the API's own words.
 *
 * **Three facts about this API that shape every screen below.**
 *
 * 1. `PUT /api/brand` is a *partial* write: a field absent from the body is left alone, a field present
 *    and blank clears it. The identity form therefore sends all seventeen fields it owns and never
 *    sends `documentPresentation` — that map belongs to the Documents screen, and a save here would
 *    otherwise wipe all eight family rows (see `savePresentationMap`).
 * 2. An upload is a separate call that returns a URL: `POST /api/brand/assets` keeps the bytes and the
 *    URL is put in `logoUrl` / `logoDarkUrl` / `iconUrl` and saved afterwards. So a picked file changes
 *    the draft and the accompanying Save persists it, exactly as typing does.
 * 3. `setBrandKit(…)` after a save is what makes the promise in the owner's words true on screen rather
 *    than at the next reload: the module-level cache behind `hooks/useBrandKit` is what every print
 *    window, PDF and preview in the application reads, so it is replaced with the API's own answer.
 */
import {
  BRAND_UPLOAD_MAX_BYTES,
  BRAND_UPLOAD_TYPES,
  DOCUMENT_FAMILY_LABELS,
  type BrandKit,
  type BrandOverride,
  type DocumentFamily,
  type DocumentPresentation,
} from "@C7NTAX/shared";
import { useEffect, useState } from "react";
import { setBrandKit } from "../../hooks/useBrandKit";
import { useEmailRead, writeEmail, type Read, type WriteResult } from "../email/emailApi";

/** One family of document, as `GET /api/brand` resolves it: the family default ← stored. */
export interface DocumentRow {
  family: DocumentFamily;
  /** `DOCUMENT_FAMILY_LABELS[family].title`, sent by the API so the two cannot drift. */
  title: string;
  /** …and `.what`, the sentence saying which documents these are. */
  what: string;
  presentation: DocumentPresentation;
  /** True when the resolved presentation differs from the one the code ships with. */
  changed: boolean;
}

/**
 * `GET /api/brand`.
 *
 * Every `BrandKit` field is present (the API resolves absent ones to what a document would use), plus
 * what a settings screen needs to draw itself honestly: the documents, the fixed palette, and the
 * contrast of the two settable colours against paper.
 */
export interface BrandResponse extends BrandKit {
  documents: DocumentRow[];
  palette: {
    ink: string;
    body: string;
    muted: string;
    rule: string;
    hairline: string;
    tint: string;
    paper: string;
  };
  /**
   * Contrast against paper, and the minimum a mark needs. Supplied by the API rather than computed here
   * so the number on the screen and the rule the documents were designed against are the same number.
   */
  contrast: { primary: number; accent: number; minimum: number };
  /** The stored per-family map: absent keys mean the family's default. */
  documentPresentation: Record<string, Partial<DocumentPresentation>>;
  /** The email footer line, which the Email Studio owns and this section only reports. */
  footerText: string | null;
  smtpFrom: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

/** A client that may wear its own brand on the documents addressed to it. */
export interface ClientBrandRow {
  id: string;
  name: string;
  legalName: string | null;
  /** The patch stored for this client, already resolved with the portal logo/accent where it has none. */
  override: BrandOverride | null;
  /**
   * `"portal"` when the logo being worn is the client's **portal** logo
   * (`Company.portalLogoUrl`) rather than one set here — worth saying on screen, because the form does
   * not contain the image it is showing.
   */
  inheritedLogo: "portal" | null;
}

/** One report whose presentation differs from its family's. Only the rows that exist. */
export interface ReportBrandRow {
  reportKey: string;
  presentation: Partial<DocumentPresentation>;
  updatedAt: string;
  updatedByName: string | null;
}

export interface BrandAsset {
  id: string;
  url: string;
  contentType: string;
  byteSize: number;
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────

export function useBrand(): Read<BrandResponse> {
  return useEmailRead<BrandResponse>("/brand", "The brand record");
}

export function useBrandClients(): Read<{ clients: ClientBrandRow[] }> {
  return useEmailRead<{ clients: ClientBrandRow[] }>("/brand/clients", "The client list");
}

export function useBrandReports(): Read<{ reports: ReportBrandRow[] }> {
  return useEmailRead<{ reports: ReportBrandRow[] }>("/brand/reports", "The report presentations");
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Save fields of the brand record, and hand the API's answer to the whole application.
 *
 * `setBrandKit` is not an optimisation: the resolved brand is cached in a module so an imperative path
 * — a print window, a jsPDF run — can read it without awaiting, and that cache is what a preview drawn
 * a second from now will read. Replacing it with the saved row is what makes "I changed the logo and
 * every document changed" true on the screen that changed it.
 */
export async function saveBrandFields(
  patch: Record<string, unknown>,
): Promise<WriteResult<BrandResponse>> {
  const result = await writeEmail<BrandResponse>("put", "/brand", patch, "The brand record");
  if (result.ok && result.payload) setBrandKit(result.payload);
  return result;
}

/**
 * Save the **whole** per-family map.
 *
 * `documentPresentation` is replaced rather than merged by `PUT /api/brand`, so a save that sent one
 * family would delete the other seven. The caller therefore always passes the map as it should end up
 * — see `withFamily` / `withoutFamily`.
 */
export async function savePresentationMap(
  map: Record<string, Partial<DocumentPresentation>>,
): Promise<WriteResult<BrandResponse>> {
  return saveBrandFields({ documentPresentation: map });
}

/** The map with one family replaced. Used by the Documents screen to save a single row. */
export function withFamily(
  map: Record<string, Partial<DocumentPresentation>>,
  family: DocumentFamily,
  patch: Partial<DocumentPresentation>,
): Record<string, Partial<DocumentPresentation>> {
  const next = { ...map };
  if (Object.keys(patch).length) next[family] = patch;
  else delete next[family];
  return next;
}

/** The map with one family's row removed — "Reset to the default". */
export function withoutFamily(
  map: Record<string, Partial<DocumentPresentation>>,
  family: DocumentFamily,
): Record<string, Partial<DocumentPresentation>> {
  const next = { ...map };
  delete next[family];
  return next;
}

export async function uploadBrandAsset(
  kind: "logo" | "logoDark" | "icon",
  dataUrl: string,
): Promise<WriteResult<BrandAsset>> {
  return writeEmail<BrandAsset>("post", "/brand/assets", { kind, dataUrl }, "The upload");
}

/** Save (or, with an empty patch, remove) one client's own brand. */
export async function saveClientOverride(
  companyId: string,
  override: BrandOverride,
): Promise<WriteResult<{ override: BrandOverride | null }>> {
  return writeEmail<{ override: BrandOverride | null }>(
    "put",
    `/brand/clients/${encodeURIComponent(companyId)}`,
    override,
    "This client's brand",
  );
}

export async function saveReportPresentation(
  reportKey: string,
  presentation: Partial<DocumentPresentation>,
): Promise<WriteResult<{ report: ReportBrandRow | null }>> {
  return writeEmail<{ report: ReportBrandRow | null }>(
    "put",
    `/brand/reports/${encodeURIComponent(reportKey)}`,
    presentation,
    "This report's presentation",
  );
}

/**
 * Reset one report to its family's presentation.
 *
 * The body is an **empty array, not an empty object**, and that is worth explaining because it looks
 * like a mistake. `PUT /api/brand/reports/:reportKey` deletes the row only when
 * `presentationPatch(req.body)` returns `null`, which happens for a body that is not an object; for
 * `{}` it returns a patch of three explicit nulls (`title`, `subtitle`, `footerNote`), so an empty
 * object *stores* a row instead of deleting one. `[]` is the smallest body that is not an object and
 * that `express.json({ strict: true })` accepts, so it is the request that means "no presentation at
 * all". The honest fix is in the service (`presentationPatch` should not fabricate the three nulls);
 * it is reported rather than worked around in the API.
 */
export async function resetReportPresentation(
  reportKey: string,
): Promise<WriteResult<{ report: ReportBrandRow | null }>> {
  return writeEmail<{ report: ReportBrandRow | null }>(
    "put",
    `/brand/reports/${encodeURIComponent(reportKey)}`,
    [],
    "This report's presentation",
  );
}

// ── Picking a file ───────────────────────────────────────────────────────────────────────────────

/** The types the picker offers. SVG is refused in the reader below, and says why. */
export const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const UPLOAD_TYPES_SENTENCE = "PNG, JPEG or WebP";
export const uploadLimitSentence = (): string =>
  `Up to ${Math.round(BRAND_UPLOAD_MAX_BYTES / (1024 * 1024))} MB.`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileReadResult = { ok: true; dataUrl: string } | { ok: false; message: string };

/**
 * Read a picked file as the data URL the API expects, refusing what the API would refuse — in the same
 * words, so the refusal arrives while the person is still at the picker rather than after an upload
 * that silently did nothing.
 *
 * An **SVG is refused here too**, and by name: it is the one image type a person is most likely to try
 * (it is what a design tool exports), and it is refused because an SVG is a script with an image's
 * extension rather than because the API has not got round to it.
 */
export function readImageFile(file: File): Promise<FileReadResult> {
  const type = (file.type || "").toLowerCase();
  if (type === "image/svg+xml" || /\.svgz?$/i.test(file.name)) {
    return Promise.resolve({
      ok: false,
      message:
        "An SVG is not an image here — it is a script with an image's extension, and a logo is fetched " +
        "by a stranger's mail client. Export a PNG instead.",
    });
  }
  if (!(BRAND_UPLOAD_TYPES as readonly string[]).includes(type)) {
    return Promise.resolve({
      ok: false,
      message: `A logo must be a ${UPLOAD_TYPES_SENTENCE} image. That file is ${file.type || "of an unknown type"}.`,
    });
  }
  if (file.size > BRAND_UPLOAD_MAX_BYTES) {
    return Promise.resolve({
      ok: false,
      message: `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(BRAND_UPLOAD_MAX_BYTES)} — a letterhead is a drawn page on a document, not a photograph.`,
    });
  }
  return new Promise<FileReadResult>((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(
        typeof reader.result === "string"
          ? { ok: true, dataUrl: reader.result }
          : { ok: false, message: "That file could not be read as an image." },
      );
    reader.onerror = () => resolve({ ok: false, message: "That file could not be read as an image." });
    reader.readAsDataURL(file);
  });
}

/**
 * The last value a read successfully returned, so a reload does not blank a screen.
 *
 * `useEmailRead` clears its data while a second read is in flight — the right answer for a panel that
 * must not show stale numbers as though they were current, and the wrong one for a settings form: a save
 * triggers a reload, and a form that vanished under the person pressing Save would be worse than one
 * showing the value it just wrote. The status is still returned separately by the read, so a screen can
 * still say that a *re*-read failed while showing what it last knew.
 */
export function useLastGood<T>(read: Read<T>): T | null {
  const [last, setLast] = useState<T | null>(null);
  useEffect(() => {
    if (read.status === "ok" && read.data) setLast(read.data);
  }, [read.status, read.data]);
  return read.status === "ok" ? read.data : last;
}

/** `DOCUMENT_FAMILY_LABELS` reached through one helper, so a screen never indexes the record by hand. */
export function familyLabels(family: DocumentFamily): { title: string; what: string } {
  return DOCUMENT_FAMILY_LABELS[family];
}

/**
 * The keys of a client's override that are genuinely **this client's own**.
 *
 * Two shapes have to be seen through here, and both are facts about the API rather than choices this
 * screen makes:
 *
 *  - `saveCompanyOverride` writes **all ten keys** every time, with `null` for the ones that were not
 *    filled in, so `Object.keys(override)` is ten whether one field is set or eight. A key with a null,
 *    an empty string or an empty array means "inherit", not "set".
 *  - a client with no logo of its own *wears its portal logo* (`Company.portalLogoUrl`), and
 *    `loadCompanyOverride` resolves that into `logoUrl`. The API says so with `inheritedLogo: "portal"`,
 *    which is why the file picker must not be seeded with an image the form does not contain: a save
 *    would then store the portal's URL as an override and the client would stop following its portal.
 *
 * **The accent colour has no such flag**, although `loadCompanyOverride` resolves `portalAccentColor`
 * into `primaryColor` in exactly the same way. So a client whose portal sets an accent shows that colour
 * in the form, and this screen cannot say whether it is the portal's or the client's own. It is reported
 * rather than guessed at.
 */
export function ownOverrideKeys(override: BrandOverride | null, inheritedLogo: "portal" | null): string[] {
  if (!override) return [];
  return Object.keys(override).filter((key) => {
    if (key === "logoUrl" && inheritedLogo === "portal") return false;
    const value = (override as Record<string, unknown>)[key];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return String(value).trim().length > 0;
  });
}

/** Whether a client differs from the instance at all, by the rule above. */
export function clientDiffers(row: ClientBrandRow): boolean {
  return ownOverrideKeys(row.override, row.inheritedLogo).length > 0;
}
