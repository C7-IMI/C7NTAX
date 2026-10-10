/**
 * The brand, for the browser.
 *
 * Documents are produced **imperatively** as well as declaratively: a report is drawn into a print
 * window, an invoice is fetched as HTML, a PDF is built by jsPDF. None of those can await a hook, and
 * a print window opened before the brand arrived would produce a letterhead-less page — so the
 * resolved brand is held in a module-level cache that both worlds read. React subscribes to it; the
 * print and export paths read `currentBrand()` synchronously.
 *
 * **The default is the shipped brand, not an empty one.** Until `/api/brand` answers — and forever, on
 * an instance that has never opened Branding — every document is drawn with the values the product
 * shipped with as literals. A failed request is therefore a cosmetic no-op rather than a document with
 * a missing company name, which is the correct way round: the reader of a report should never be shown
 * the state of an HTTP call.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_BRAND,
  documentBrandFor,
  normaliseBrand,
  type BrandKit,
  type BrandOverride,
  type DocumentBrand,
  type DocumentFamily,
  type DocumentPresentation,
} from "@C7NTAX/shared";
import api from "../api";

let current: BrandKit = DEFAULT_BRAND;
/**
 * One report's own presentation, keyed by the report's id.
 *
 * Loaded with the brand rather than fetched when a report is printed, because a print path cannot await
 * a request: a report that had to ask what paper it was on would either print wrongly or print late. A
 * permission error is not an error here — a person without `branding:view` simply gets their family's
 * settings, which is exactly what they were getting before this existed.
 */
let reportPresentations = new Map<string, Partial<DocumentPresentation>>();
let inflight: Promise<BrandKit> | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** The brand as it stands, for a caller that cannot wait — a print window, a PDF export, a canvas. */
export function currentBrand(): BrandKit {
  return current;
}

/**
 * The render-ready brand for one document family.
 *
 * The synchronous form is the important one: `documentBrand("invoice", clientOverride)` is what a
 * print or export path calls, and it is the same resolution the settings screen previews, so the
 * preview a person approves and the document that is produced cannot differ.
 */
export function documentBrandOf(
  family: DocumentFamily,
  override?: BrandOverride | null,
  reportKey?: string | null,
): DocumentBrand {
  const report = reportKey ? reportPresentations.get(reportKey) ?? null : null;
  return documentBrandFor(current, family, override, report);
}

/** Replace the cached brand — used by the settings screen after a save, so a preview updates itself. */
export function setBrandKit(kit: Partial<BrandKit> | null | undefined): void {
  current = normaliseBrand(kit);
  announce();
}

/**
 * Read the brand once per session.
 *
 * Concurrent callers share the one request; a failure resolves to the shipped default and is *not*
 * cached as a failure, so a later page can try again — the API may simply have been restarting.
 */
export function ensureBrandKit(): Promise<BrandKit> {
  if (!inflight) {
    inflight = Promise.all([
      api.get<Partial<BrandKit> & { brand?: Partial<BrandKit> }>("/brand"),
      // One report's own settings travel with the brand so that a report printed from the browser obeys
      // Report Branding. A refusal here is not an error: no permission means the family's settings, which
      // is what the person had before the feature existed.
      api.get<{ reports?: { reportKey: string; presentation: Partial<DocumentPresentation> }[] }>("/brand/reports")
        .catch(() => null),
    ])
      .then(([response, reports]) => {
        const payload = response.data?.brand ?? response.data;
        current = normaliseBrand(payload);
        reportPresentations = new Map(
          (reports?.data?.reports ?? []).map((row) => [row.reportKey, row.presentation]),
        );
        announce();
        return current;
      })
      .catch(() => {
        inflight = null;
        return current;
      });
  }
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The instance's brand, loaded on first use and re-read when it changes. */
export function useBrandKit(): BrandKit {
  const kit = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    void ensureBrandKit();
  }, []);
  return kit;
}

/** One family's resolved brand, for a screen that renders a document preview. */
export function useDocumentBrand(family: DocumentFamily, override?: BrandOverride | null): DocumentBrand {
  const kit = useBrandKit();
  return documentBrandFor(kit, family, override);
}
