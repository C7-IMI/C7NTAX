/**
 * `/admin/branding` — **Identity**: the one screen that answers "whose paper is this".
 *
 * The logo, the icon, the wordmark, the name, the contact details, the two colours, the document footer
 * and the legal text, plus the sender the product's own mail comes from. Everything on it is one record:
 * `GET /api/brand` reads it and `PUT /api/brand` writes it, partially — a field present and blank is
 * cleared, a field absent is left alone, so this form sends all seventeen fields it owns and *never*
 * sends `documentPresentation`, which belongs to the Documents screen.
 *
 * **What the owner asked for, and where it is.** "I want to be able to add a company logo and icon, AKA
 * change the header." The two fields named by `BRAND_HEADLINE_FIELDS` are therefore the ones that draw
 * the eye, in both arrangements: they are the first thing on the screen, drawn large, above everything
 * else, rather than rows 4 and 6 of a list of seventeen. Uploading one and pressing Save changes every
 * generated document — the reports, the PDFs, the invoices, the quotes, the statements, the ticket sheets
 * and the email the product sends — because all of them read this one record at the moment they are
 * produced. The sentence on the page says so, because a person cannot see it and a promise nobody can see
 * is a promise nobody believes.
 *
 * **Two arrangements, one state.** The modern interface is a rail of six subjects with rows-as-cards
 * whose sentence sits beside the control, the marks drawn as tiles you press, and a specimen sheet that
 * follows what you type. The classic interface is a form: sections with labelled fields in a grid, a
 * thumbnail and a file input per image, and Save/Cancel at the end. The draft, the uploads, the save and
 * the words are shared; nothing about the layout is.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Palette } from "lucide-react";
import type { BrandKit, DocumentFamily } from "@C7NTAX/shared";
import { Permission } from "@C7NTAX/shared";
import { PageHeader } from "../components/ui";
import { Band, LoadingBlock, UnavailablePanel } from "../components/email/emailChrome";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import { useBrand, saveBrandFields, useLastGood } from "../components/brand/brandApi";
import {
  IDENTITY_SUBJECTS,
  draftFromKit,
  fieldsIn,
  identityPatch,
  kitFromDraft,
  colourProblem,
  contrastSentence,
  type BrandDraft,
  type BrandFieldSpec,
  type IdentitySubject,
} from "../components/brand/brandFields";
import { BrandAssetField, BrandColourField } from "../components/brand/BrandAssetField";
import { BrandLinks, BrandWriteError, PreviewPanel, useBrandWrite } from "../components/brand/brandChrome";
import {
  previewBrand,
  specimenBlocks,
  specimenFooterLeft,
  specimenMetaLine,
} from "../components/brand/brandPreview";

const SCREEN = "/admin/branding";

/** The same sentence `Layout.tsx`'s `SECTION_DESCRIPTIONS` carries for this route. */
export const BRAND_IDENTITY_SUBTITLE =
  "The logo, the icon, the name, the colours and the small print — one record, worn by every document and every message.";

const PROMISE =
  "Saving here changes every document this instance produces — reports, PDFs, invoices, quotes, statements and ticket sheets — and the email it sends. They all read this one record when they are produced, so there is no second copy of the logo to find.";

const NEEDS_MANAGE = "Changing the brand is branding:manage, which this account does not hold. The screen is readable and every control is disabled.";

export function BrandingIdentityPage() {
  const redesign = useRedesign();
  const brand = useBrand();
  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.BrandingManage);
  const { saving, error, setError, run } = useBrandWrite();

  const [baseline, setBaseline] = useState<BrandKit | null>(null);
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [subject, setSubject] = useState<IdentitySubject>("marks");

  const read = useLastGood(brand);
  const rereadFailed = brand.status === "unavailable";

  // The draft is seeded once, from the read. A save re-seeds it from the API's own answer rather than
  // from what was typed, so the form shows what is stored, not what was hoped for.
  useEffect(() => {
    if (read && !baseline) {
      setBaseline(read);
      setDraft(draftFromKit(read));
    }
  }, [read, baseline]);

  const baselineDraft = useMemo(() => (baseline ? draftFromKit(baseline) : null), [baseline]);
  const current = draft ?? baselineDraft ?? {};
  const dirty = baselineDraft !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(baselineDraft);

  // The sheet follows the draft, not the saved record: a person choosing a colour wants to see that
  // colour, and the resolution an unset field gets is the contract's rather than this screen's.
  const specimenFamily: DocumentFamily = "report.standard";
  const specimenPresentation = read?.documents.find((row) => row.family === specimenFamily)?.presentation ?? null;
  const at = useMemo(() => new Date(), []);
  const preview = useMemo(
    () =>
      previewBrand({
        kit: kitFromDraft(current),
        family: specimenFamily,
        presentation: specimenPresentation ?? undefined,
      }),
    [current, specimenPresentation],
  );
  const blocks = useMemo(() => specimenBlocks("report"), []);

  const set = (key: keyof BrandKit, value: string) =>
    setDraft((now) => ({ ...(now ?? current), [key]: value }));

  const save = async () => {
    if (!canManage) return;
    const badColour = colourProblem(current.primaryColor ?? "") ?? colourProblem(current.accentColor ?? "");
    if (badColour) {
      setError(badColour);
      return;
    }
    const result = await run("Brand saved — every document and message now wears it", () =>
      saveBrandFields(identityPatch(current)),
    );
    if (result?.payload) {
      setBaseline(result.payload);
      setDraft(draftFromKit(result.payload));
    }
  };

  const disabled = !canManage || saving;

  if (brand.status === "loading" && !baseline) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Identity" icon={<Palette size={16} className="text-cyber-400" />} subtitle={BRAND_IDENTITY_SUBTITLE} />
        <LoadingBlock label="the brand record" />
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Identity" icon={<Palette size={16} className="text-cyber-400" />} subtitle={BRAND_IDENTITY_SUBTITLE} />
        <UnavailablePanel
          message={brand.message ?? "The brand record could not be read."}
          onRetry={brand.reload}
          what="Until it answers, this screen will not offer a form: a save would have nothing to write over, and a half-filled brand is a document with somebody else's logo on it."
        />
      </div>
    );
  }

  if (redesign) {
    const spec = IDENTITY_SUBJECTS.find((entry) => entry.id === subject) ?? IDENTITY_SUBJECTS[0]!;
    const fields = fieldsIn(subject);
    const marks = fieldsIn("marks");
    const hero = marks.filter((field) => field.headline);
    const heroRest = marks.filter((field) => !field.headline);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Branding — Identity"
          icon={<Palette size={16} className="text-cyber-400" />}
          subtitle={BRAND_IDENTITY_SUBTITLE}
          actions={<BrandLinks current={SCREEN} />}
        />

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="grid min-w-0 gap-3.5 lg:grid-cols-[208px_minmax(0,1fr)] lg:items-start">
            <aside className="card p-3 lg:sticky lg:top-4" aria-label="What this identity is made of">
              <p className="mb-1.5 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">What this identity is made of</p>
              <div className="space-y-0.5">
                {IDENTITY_SUBJECTS.map((entry) => {
                  const chosen = entry.id === subject;
                  const count = fieldsIn(entry.id);
                  const unset = count.filter((field) => !(current[field.key] ?? "").trim()).length;
                  const Icon = entry.icon;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setSubject(entry.id)}
                      className={`flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        chosen ? "border-cyber-500/40 bg-cyber-600/15 text-white" : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-2.5">
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                          <Icon size={13} />
                          {entry.label}
                        </span>
                        <span className={`whitespace-nowrap text-[11px] ${unset ? "text-gray-500" : "text-alert-green"}`}>
                          {unset ? `${unset} unset` : "all set"}
                        </span>
                      </span>
                      <span className="text-[10.5px] leading-snug text-gray-500">{entry.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-w-0 space-y-3.5">
              <PageHeader variant="section" title={spec.label} subtitle={spec.blurb} />
              <Band tone="info" title="One record, every document">
                {PROMISE}
              </Band>
              {rereadFailed ? (
                <Band tone="warn" title="The brand record could not be re-read">
                  {brand.message} What is shown is the last answer that arrived, so it may be a moment out of date.
                </Band>
              ) : null}
              {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

              {subject === "marks" ? (
                <>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {hero.map((field) => (
                      <BrandAssetField
                        key={field.key}
                        spec={field}
                        emphasis="hero"
                        value={current[field.key] ?? ""}
                        disabled={disabled}
                        onChange={(url) => set(field.key, url ?? "")}
                      />
                    ))}
                  </div>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {heroRest.map((field) => (
                      <BrandAssetField
                        key={field.key}
                        spec={field}
                        value={current[field.key] ?? ""}
                        disabled={disabled}
                        onChange={(url) => set(field.key, url ?? "")}
                      />
                    ))}
                  </div>
                </>
              ) : (
                fields.map((field) => (
                  <div key={field.key} className="card">
                    <label className="text-xs font-semibold text-white" htmlFor={`id-${field.key}`}>
                      {field.label}
                    </label>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{field.help}</p>
                    <div className="mt-2">
                      {field.kind === "color" ? (
                        <BrandColourField
                          spec={field}
                          value={current[field.key] ?? ""}
                          disabled={disabled}
                          onChange={(value) => set(field.key, value)}
                          onDraft={(value) => set(field.key, value)}
                          warning={field.key === "primaryColor" ? contrastSentence(current[field.key] ?? "", read?.contrast.minimum ?? 3) : null}
                        />
                      ) : field.kind === "lines" ? (
                        <textarea
                          id={`id-${field.key}`}
                          rows={4}
                          className="input-field"
                          value={current[field.key] ?? ""}
                          disabled={disabled}
                          onChange={(event) => set(field.key, event.target.value)}
                        />
                      ) : (
                        <input
                          id={`id-${field.key}`}
                          className="input-field"
                          value={current[field.key] ?? ""}
                          disabled={disabled}
                          onChange={(event) => set(field.key, event.target.value)}
                        />
                      )}
                    </div>
                    {(current[field.key] ?? "").trim() ? null : (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">{field.unset}</p>
                    )}
                  </div>
                ))
              )}

              <SaveBar
                redesign
                dirty={dirty}
                saving={saving}
                canManage={canManage}
                error={error}
                onSave={() => void save()}
                onUndo={() => setDraft(baselineDraft)}
              />
            </div>
          </div>

          <aside className="space-y-3.5 xl:sticky xl:top-4">
            <PreviewPanel
              caption="A specimen sheet"
              brand={preview}
              title="A specimen sheet"
              metaLine={specimenMetaLine("Prepared for a specimen client", at)}
              blocks={blocks}
              footerLeft={specimenFooterLeft(preview, at)}
              note="The figures are a specimen; the letterhead, the paper and the type are the ones this instance prints."
            />
          </aside>
        </div>
      </div>
    );
  }

  // ── Classic: a form ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Branding — Identity"
        subtitle={BRAND_IDENTITY_SUBTITLE}
        actions={<BrandLinks current={SCREEN} />}
      />
      <Band tone="info" title="One record, every document">
        {PROMISE}
      </Band>
      {rereadFailed ? (
        <Band tone="warn" title="The brand record could not be re-read">
          {brand.message} What is shown is the last answer that arrived, so it may be a moment out of date.
        </Band>
      ) : null}
      {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {IDENTITY_SUBJECTS.map((entry) => {
          const fields = fieldsIn(entry.id);
          const images = fields.filter((field) => field.kind === "image");
          const rest = fields.filter((field) => field.kind !== "image");
          return (
            <section key={entry.id} className="card space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white">{entry.label}</h3>
                <p className="text-xs text-gray-500">{entry.blurb}</p>
              </div>
              {images.map((field) => (
                <ClassicImageRow
                  key={field.key}
                  field={field}
                  value={current[field.key] ?? ""}
                  disabled={disabled}
                  onChange={(url) => set(field.key, url ?? "")}
                />
              ))}
              {rest.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {rest.map((field) => (
                    <ClassicField
                      key={field.key}
                      field={field}
                      value={current[field.key] ?? ""}
                      disabled={disabled}
                      minimum={read?.contrast.minimum ?? 3}
                      onChange={(value) => set(field.key, value)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        <SaveBar
          dirty={dirty}
          saving={saving}
          canManage={canManage}
          error={error}
          onSave={() => void save()}
          onUndo={() => setDraft(baselineDraft)}
        />
      </form>

      <PreviewPanel
        caption="Preview — the specimen sheet"
        brand={preview}
        title="A specimen sheet"
        metaLine={specimenMetaLine("Prepared for a specimen client", at)}
        blocks={blocks}
        footerLeft={specimenFooterLeft(preview, at)}
        note="The figures are a specimen; the letterhead, the paper and the type are the ones this instance prints. Paper stays white in both interface themes, because the sheet is its own document."
      />
    </div>
  );
}

/** The Save/Cancel pair, with the one sentence about what an unsaved draft means. */
function SaveBar({
  redesign = false,
  dirty,
  saving,
  canManage,
  error,
  onSave,
  onUndo,
}: {
  redesign?: boolean;
  dirty: boolean;
  saving: boolean;
  canManage: boolean;
  error: string | null;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
    <div className={redesign ? "card space-y-2.5" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <button type={redesign ? "button" : "submit"} className="btn-primary" disabled={!canManage || saving} onClick={redesign ? onSave : undefined}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          <span className={saving ? "ml-1.5" : ""}>Save the brand</span>
        </button>
        <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={onUndo}>
          Discard the changes
        </button>
        <p className="text-[11px] text-gray-500">
          {dirty ? "There are unsaved changes on this screen — nothing has been written yet." : "Everything on this screen is saved."}
        </p>
      </div>
      {dirty && !canManage ? (
        <p className="flex items-start gap-1.5 text-[11px] text-alert-amber">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          These changes cannot be saved, because changing the brand is branding:manage and this account does not hold it.
        </p>
      ) : null}
      <BrandWriteError message={error} />
    </div>
  );
}

/** One labelled field in a grid, for the classic arrangement. */
function ClassicField({
  field,
  value,
  disabled,
  minimum,
  onChange,
}: {
  field: BrandFieldSpec;
  value: string;
  disabled: boolean;
  minimum: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`block text-sm ${field.kind === "lines" ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-gray-400">{field.label}</span>
      {field.kind === "color" ? (
        <div className="mt-1">
          <BrandColourField
            spec={field}
            value={value}
            disabled={disabled}
            onChange={onChange}
            warning={field.key === "primaryColor" ? contrastSentence(value, minimum) : null}
          />
        </div>
      ) : field.kind === "lines" ? (
        <textarea
          className="input-field mt-1"
          rows={3}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input className="input-field mt-1" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
      <span className="mt-1 block text-[11px] leading-relaxed text-gray-500">{value.trim() ? field.help : field.unset}</span>
    </label>
  );
}

/** One image field in the classic arrangement: a thumbnail, a file input, the rules and a Remove. */
function ClassicImageRow({
  field,
  value,
  disabled,
  onChange,
}: {
  field: BrandFieldSpec;
  value: string;
  disabled: boolean;
  onChange: (url: string | null) => void;
}) {
  return (
    <div className="border-t border-surface-border pt-4 first:border-t-0 first:pt-0">
      <p className="text-xs font-medium text-gray-400">{field.label}</p>
      <div className="mt-2">
        <BrandAssetField spec={field} value={value} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  );
}
