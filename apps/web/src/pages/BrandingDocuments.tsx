/**
 * `/admin/branding/documents` — **Documents**: one row per family of document this instance produces, and
 * what a document of that family wears.
 *
 * This is the "brand the reports" half of the owner's request, done at the level it actually works at:
 * not per template, but per **family** — the sixteen standard reports, the business reviews, report
 * packs, designed reports, invoices, quotes, statements and ticket sheets. A family's settings are a patch
 * over the code's own defaults (`DEFAULT_DOCUMENT_PRESENTATION`), so a row that has never been touched
 * holds nothing and a row that holds one change holds one key; `changed` on `GET /api/brand` means
 * "somebody changed something" rather than "somebody pressed Save". That is why a save here sends only the
 * keys that differ — and the **whole map**, because `PUT /api/brand` replaces `documentPresentation` and a
 * save that sent one family would delete the other seven.
 *
 * **Four of the nine settings are read by nothing yet**, and each control says which. The letterhead, the
 * paper size and the orientation are read by every renderer; `showBasis` by the report print and PDF
 * paths; the footer, the page numbers and the three text overrides are stored and resolved and read by no
 * renderer. A settings screen that drew the nine as though they were all enforced would be promising a
 * page nobody gets, so the control says, and the band at the top says it once more.
 *
 * **The preview is that family's page**, drawn by the real renderer at the paper size chosen, and it
 * follows the draft rather than the saved row.
 */
import { useCallback, useMemo, useState } from "react";
import { FileText, Loader2, RotateCcw, X } from "lucide-react";
import { type DocumentFamily, type DocumentPresentation } from "@C7NTAX/shared";
import { Permission } from "@C7NTAX/shared";
import { PageHeader } from "../components/ui";
import { Band, LoadingBlock, StateChip, UnavailablePanel } from "../components/email/emailChrome";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import {
  savePresentationMap,
  useBrand,
  useLastGood,
  withFamily,
  withoutFamily,
  type BrandResponse,
  type DocumentRow,
} from "../components/brand/brandApi";
import {
  familyDefaults,
  isChanged,
  letterheadLabel,
  orientationLabel,
  paperLabel,
  patchAgainst,
  presentationLine,
  LETTERHEAD_OPTIONS,
} from "../components/brand/presentationSpec";
import { PresentationForm } from "../components/brand/PresentationForm";
import { BrandLinks, BrandWriteError, PreviewPanel, useBrandWrite } from "../components/brand/brandChrome";
import {
  previewBrand,
  specimenBlocks,
  specimenFooterLeft,
  specimenMetaLine,
  type SpecimenFlavour,
} from "../components/brand/brandPreview";

const SCREEN = "/admin/branding/documents";

/** The same sentence `Layout.tsx`'s `SECTION_DESCRIPTIONS` carries for this route. */
export const BRAND_DOCUMENTS_SUBTITLE =
  "What each family of document wears — the letterhead, the paper, the footer and the basis block.";

const CARRIED_NOTE =
  "The letterhead, the paper size and the orientation are read by every renderer, and the basis block by the report print and PDF paths. The footer, the page numbers and the three text overrides are stored and resolved by the API and read by no renderer yet, so changing one records the choice rather than changing a page. Each control below says which it is.";

const NEEDS_MANAGE = "Changing a document's presentation is branding:manage, which this account does not hold.";

/** What a specimen of one family is called, and which blocks look like it. */
function specimenFor(family: DocumentFamily): { title: string; flavour: SpecimenFlavour; caption: string } {
  if (family === "invoice") return { title: "A specimen invoice", flavour: "invoice", caption: "Preview — an invoice" };
  if (family === "quote") return { title: "A specimen quote", flavour: "invoice", caption: "Preview — a quote" };
  if (family === "statement") return { title: "A specimen statement", flavour: "invoice", caption: "Preview — a statement" };
  if (family === "ticket") return { title: "A specimen ticket sheet", flavour: "ticket", caption: "Preview — a ticket sheet" };
  return { title: "A specimen sheet", flavour: "report", caption: "Preview — this family's page" };
}

export function BrandingDocumentsPage() {
  const redesign = useRedesign();
  const brand = useBrand();
  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.BrandingManage);
  const { saving, error, run } = useBrandWrite();

  const [chosen, setChosen] = useState<DocumentFamily>("report.standard");
  const [draft, setDraft] = useState<DocumentPresentation | null>(null);
  const [editing, setEditing] = useState(false);

  const kit: BrandResponse | null = useLastGood(brand);
  const rows: DocumentRow[] = kit?.documents ?? [];
  const map = kit?.documentPresentation ?? {};
  const rereadFailed = brand.status === "unavailable";
  const chosenRow = rows.find((row) => row.family === chosen) ?? null;
  /** The draft when one is being edited, the family as saved when it is not. */
  const presentation = draft ?? chosenRow?.presentation ?? (chosenRow ? familyDefaults(chosen) : null);

  const openFamily = useCallback(
    (family: DocumentFamily) => {
      const row = rows.find((entry) => entry.family === family);
      setChosen(family);
      setDraft(row ? { ...row.presentation } : familyDefaults(family));
      setEditing(true);
    },
    [rows],
  );

  const closeEditor = useCallback(() => {
    setEditing(false);
    setDraft(null);
  }, []);

  const save = async () => {
    if (!canManage || !presentation) return;
    const patch = patchAgainst(familyDefaults(chosen), presentation);
    const result = await run(
      patch && Object.keys(patch).length ? "This family's documents changed" : "This family is back on the default",
      () => savePresentationMap(withFamily(map, chosen, patch)),
    );
    if (result) {
      closeEditor();
      brand.reload();
    }
  };

  const reset = async () => {
    if (!canManage) return;
    await resetFamily(chosen, chosenRow?.title ?? chosen, true);
  };

  /** Reset a row to its family's default: the whole map with that family's key removed. */
  const resetFamily = async (family: DocumentFamily, title: string, close: boolean): Promise<void> => {
    if (!canManage) return;
    setChosen(family);
    setDraft(null);
    const result = await run(`Back to the default for ${title}`, () =>
      savePresentationMap(withoutFamily(map, family)),
    );
    if (result) {
      if (close) closeEditor();
      brand.reload();
    }
  };

  const at = useMemo(() => new Date(), []);
  const specimen = specimenFor(chosen);
  const blocks = useMemo(() => specimenBlocks(specimen.flavour), [specimen.flavour]);
  const preview = useMemo(
    () =>
      kit && presentation
        ? previewBrand({ kit, family: chosen, presentation })
        : null,
    [kit, chosen, presentation],
  );
  const draftDiffers =
    draft !== null && chosenRow !== null && JSON.stringify(draft) !== JSON.stringify(chosenRow.presentation);
  const changed = chosenRow ? isChanged(chosen, chosenRow.presentation) : false;

  if (brand.status === "loading" && !kit) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Documents" icon={<FileText size={16} className="text-cyber-400" />} subtitle={BRAND_DOCUMENTS_SUBTITLE} />
        <LoadingBlock label="the document settings" />
      </div>
    );
  }

  if (!kit) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Documents" icon={<FileText size={16} className="text-cyber-400" />} subtitle={BRAND_DOCUMENTS_SUBTITLE} />
        <UnavailablePanel
          message={brand.message ?? "The document settings could not be read."}
          onRetry={brand.reload}
          what="Eight families of document read these settings when they are produced, so the screen will not offer to edit what it could not read."
        />
      </div>
    );
  }

  const editor = presentation ? (
    <PresentationForm
      draft={presentation}
      onChange={setDraft}
      disabled={!canManage || saving}
      footerContext={kit.documentFooter}
      resetLabel={changed || draftDiffers ? `Reset ${chosenRow?.title ?? chosen} to the default` : undefined}
      onReset={() => void reset()}
    />
  ) : null;

  if (redesign) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Branding — Documents"
          icon={<FileText size={16} className="text-cyber-400" />}
          subtitle={BRAND_DOCUMENTS_SUBTITLE}
          actions={<BrandLinks current={SCREEN} />}
        />

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="min-w-0 space-y-3.5">
            <PageHeader variant="section" title="Eight families of document" subtitle="Each row is a family, not a template: every family reads its settings from this one record." />
            <Band tone="info" title="What is enforced today">{CARRIED_NOTE}</Band>
            {rereadFailed ? (
              <Band tone="warn" title="The document settings could not be re-read">
                {brand.message} What is shown is the last answer that arrived, so it may be a moment out of date.
              </Band>
            ) : null}
            {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

            <div className="space-y-2.5">
              {rows.map((row) => (
                <div
                  key={row.family}
                  className={`card ${row.family === chosen ? "border-cyber-500/40" : ""}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-white">{row.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.changed ? <StateChip tone="on">changed</StateChip> : <StateChip tone="neutral">the default</StateChip>}
                      {row.family === chosen ? <StateChip tone="locked">showing</StateChip> : null}
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{row.what}</p>
                  <p className="mt-2 text-[11.5px] text-gray-400">{presentationLine(row.presentation)}</p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button type="button" className="chip" onClick={() => openFamily(row.family)}>
                      Edit what it wears
                    </button>
                    {row.changed ? (
                      <button
                        type="button"
                        className="chip"
                        disabled={!canManage || saving}
                        onClick={() => void resetFamily(row.family, row.title, false)}
                      >
                        <RotateCcw size={11} />
                        Reset to the default
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="space-y-3.5 xl:sticky xl:top-4">
            {preview ? (
              <PreviewPanel
                caption={`${specimen.caption} — ${chosenRow?.title ?? chosen}`}
                brand={preview}
                title={specimen.title}
                metaLine={specimenMetaLine("Prepared for a specimen client", at)}
                blocks={blocks}
                footerLeft={specimenFooterLeft(preview, at)}
                note="The figures are a specimen. The mark, the paper, the orientation and the type are the ones this family wears."
              />
            ) : null}
          </aside>
        </div>

        {editing && presentation && editor ? (
          <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]" onClick={closeEditor}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`What ${chosenRow?.title ?? chosen} wears`}
              className="w-full max-w-2xl space-y-3 rounded-xl border border-surface-border bg-surface p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">{chosenRow?.title ?? chosen}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">{chosenRow?.what}</p>
                </div>
                <button type="button" onClick={closeEditor} className="chip p-1.5" aria-label="Close">
                  <X size={13} />
                </button>
              </div>
              {editor}
              <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
                <button type="button" className="btn-primary" disabled={!canManage || saving} onClick={() => void save()}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span className={saving ? "ml-1.5" : ""}>Save</span>
                </button>
                <button type="button" className="btn-secondary" onClick={closeEditor}>
                  Cancel
                </button>
              </div>
              <BrandWriteError message={error} />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Classic: a table, a dialog and the sheet ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding — Documents"
        subtitle={BRAND_DOCUMENTS_SUBTITLE}
        actions={<BrandLinks current={SCREEN} />}
      />
      <Band tone="info" title="What is enforced today">{CARRIED_NOTE}</Band>
      {rereadFailed ? (
        <Band tone="warn" title="The document settings could not be re-read">
          {brand.message} What is shown is the last answer that arrived, so it may be a moment out of date.
        </Band>
      ) : null}
      {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Eight families of document</h2>
        <table className="ptable w-full text-xs">
          <caption className="sr-only">Every family of document, what its letterhead is, and its paper</caption>
          <thead>
            <tr>
              <th className="px-2 py-2 text-left">Family</th>
              <th className="px-2 py-2 text-left">Letterhead</th>
              <th className="px-2 py-2 text-left">Paper</th>
              <th className="px-2 py-2 text-left">Footer</th>
              <th className="px-2 py-2 text-left">Pages</th>
              <th className="px-2 py-2 text-left">Basis</th>
              <th className="px-2 py-2 text-left">State</th>
              <th className="px-2 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.family} className={row.family === chosen ? "bg-surface-lighter" : undefined}>
                <td className="px-2 py-1.5">
                  <span className="block font-medium text-white">{row.title}</span>
                  <span className="block text-gray-500">{row.what}</span>
                </td>
                <td className="px-2 py-1.5">{letterheadLabel(row.presentation.letterhead)}</td>
                <td className="px-2 py-1.5">{paperLabel(row.presentation.pageSize)} · {orientationLabel(row.presentation.orientation).toLowerCase()}</td>
                <td className="px-2 py-1.5">{row.presentation.showFooter ? "on" : "off"}</td>
                <td className="px-2 py-1.5">{row.presentation.showPageNumbers ? "on" : "off"}</td>
                <td className="px-2 py-1.5">{row.presentation.showBasis ? "on" : "off"}</td>
                <td className="px-2 py-1.5">{row.changed ? "changed" : "the default"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => openFamily(row.family)}>
                      Edit
                    </button>
                    {row.changed ? (
                      <button
                        type="button"
                        className="btn-secondary !px-2.5 !py-1 text-xs"
                        disabled={!canManage || saving}
                        onClick={() => void resetFamily(row.family, row.title, false)}
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500">
          The letterhead is what chooses a mark: {LETTERHEAD_OPTIONS.map((option) => option.label.toLowerCase()).join(", ")}.
          A family that has never been changed stores nothing at all.
        </p>
      </section>

      {preview ? (
        <PreviewPanel
          caption={`${specimen.caption} — ${chosenRow?.title ?? chosen}`}
          brand={preview}
          title={specimen.title}
          metaLine={specimenMetaLine("Prepared for a specimen client", at)}
          blocks={blocks}
          footerLeft={specimenFooterLeft(preview, at)}
          note="The figures are a specimen. The mark, the paper, the orientation and the type are the ones this family wears."
        />
      ) : null}

      {editing && presentation && editor ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={closeEditor}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`What ${chosenRow?.title ?? chosen} wears`}
            className="w-full max-w-3xl rounded-xl border border-surface-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-white">What {chosenRow?.title ?? chosen} wears</h2>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">{chosenRow?.what}</p>
            {editor}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-surface-border pt-3">
              <button type="button" className="btn-secondary" onClick={closeEditor}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={!canManage || saving} onClick={() => void save()}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                <span className={saving ? "ml-1.5" : ""}>Save</span>
              </button>
            </div>
            <div className="mt-2">
              <BrandWriteError message={error} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
