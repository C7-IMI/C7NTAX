/**
 * `/admin/branding/reports` — **Reports**: the shipped reports that have a presentation of their own.
 *
 * The catalogue of reports is **code**, not data: `STANDARD_REPORTS` in
 * `components/reports/standardReports.ts` is the list, and this screen lists it and marks the rows that
 * differ. `GET /api/brand/reports` returns only the reports whose presentation has been changed, which is
 * why the screen never invents a report key — a row that exists in the API and not in the catalogue would
 * be a report this screen could offer to edit and no screen could produce.
 *
 * A report's presentation is a patch **over its family's**, which is itself a patch over the code's
 * default (`presentationFor` in `services/brand.ts`), so that "this report, landscape, without the basis
 * block" needs no second place to keep a page size. Which is why the reference a draft is measured
 * against is the *family as it resolves* rather than the code's default: a report that differs from its
 * family by nothing stores nothing, and Reset puts it back under whatever the family says today.
 *
 * **The preview is that report's shape**: the family's page with this report's own choices laid over it,
 * under this report's title. As everywhere in this section the figures are a specimen and the sheet says
 * so — what is real is the paper, the letterhead and the type, which is what setting a report's
 * presentation actually changes.
 */
import { useCallback, useMemo, useState } from "react";
import { FileText, Loader2, RotateCcw, X } from "lucide-react";
import { Permission } from "@C7NTAX/shared";
import type { DocumentFamily, DocumentPresentation } from "@C7NTAX/shared";
import { PageHeader } from "../components/ui";
import { Band, LoadingBlock, StateChip, UnavailablePanel } from "../components/email/emailChrome";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import {
  resetReportPresentation,
  saveReportPresentation,
  useBrand,
  useBrandReports,
  useLastGood,
  type BrandResponse,
  type ReportBrandRow,
} from "../components/brand/brandApi";
import {
  familyDefaults,
  patchAgainst,
  presentationLine,
} from "../components/brand/presentationSpec";
import { PresentationForm } from "../components/brand/PresentationForm";
import { BrandLinks, BrandWriteError, PreviewPanel, useBrandWrite } from "../components/brand/brandChrome";
import {
  previewBrand,
  specimenBlocks,
  specimenFooterLeft,
  specimenMetaLine,
} from "../components/brand/brandPreview";
import { REVIEW_REPORTS, STANDARD_REPORTS, type StandardReport } from "../components/reports/standardReports";

const SCREEN = "/admin/branding/reports";

/** The same sentence `Layout.tsx`'s `SECTION_DESCRIPTIONS` carries for this route. */
export const BRAND_REPORTS_SUBTITLE =
  "The reports that have a presentation of their own, laid over their family's.";

const CARRIED_NOTE =
  "A report's presentation is a patch over its family's, and it is stored and resolved — GET /api/brand/reports returns exactly the rows that differ. Nothing produced today reads one: brandForDocument() takes a report key and lays the report over its family, but no caller passes a key yet, so the report print and PDF paths still resolve from the code's defaults and an invoice is drawn from its family alone. That is a gap between this screen and the renderers, and it is said here rather than discovered later.";

const NEEDS_MANAGE = "Changing a report's presentation is branding:manage, which this account does not hold.";

/** Which family a catalogue report belongs to. The three reviews have a family of their own. */
function familyOf(report: StandardReport): DocumentFamily {
  return REVIEW_REPORTS.some((review) => review.id === report.id) ? "report.review" : "report.standard";
}

function familyTitle(family: DocumentFamily): string {
  return family === "report.review" ? "Business reviews" : "Standard reports";
}

export function BrandingReportsPage() {
  const redesign = useRedesign();
  const brand = useBrand();
  const reports = useBrandReports();
  const { permissions } = useAuth();
  const canManage = permissions.includes(Permission.BrandingManage);
  const { saving, error, run } = useBrandWrite();

  const [view, setView] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [chosenKey, setChosenKey] = useState<string>(STANDARD_REPORTS[0]?.id ?? "");
  const [draft, setDraft] = useState<DocumentPresentation | null>(null);
  const [editing, setEditing] = useState(false);

  const kit: BrandResponse | null = useLastGood(brand);
  const rows: ReportBrandRow[] = useLastGood(reports)?.reports ?? [];
  const rereadFailed = brand.status === "unavailable" || reports.status === "unavailable";

  const chosenReport: StandardReport =
    STANDARD_REPORTS.find((report) => report.id === chosenKey) ?? STANDARD_REPORTS[0]!;
  const chosenFamily: DocumentFamily = familyOf(chosenReport);
  /** One family as it resolves: the family default ← the instance's stored row. */
  const resolvedFamily = useCallback(
    (family: DocumentFamily): DocumentPresentation =>
      kit?.documents.find((row) => row.family === family)?.presentation ?? familyDefaults(family),
    [kit],
  );
  /** The reference a report's patch is measured against: its family as it resolves today. */
  const familyResolved: DocumentPresentation = resolvedFamily(chosenFamily);
  const storedRow = rows.find((row) => row.reportKey === chosenReport.id) ?? null;
  /** What the chosen report wears today: its family, with its own patch laid over it. */
  const storedResolved: DocumentPresentation = useMemo(
    () => (storedRow ? mergeRow(familyResolved, storedRow) : familyResolved),
    [familyResolved, storedRow],
  );
  /** What the sheet beside the list shows: the draft while one is open, the saved row otherwise. */
  const shownPresentation: DocumentPresentation = draft ?? storedResolved;

  const openReport = useCallback((key: string, resolved: DocumentPresentation) => {
    setChosenKey(key);
    setDraft({ ...resolved });
    setEditing(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditing(false);
    setDraft(null);
  }, []);

  const save = async () => {
    if (!canManage || !draft) return;
    const patch = patchAgainst(familyResolved, draft);
    const result = await run(
      Object.keys(patch).length
        ? `${chosenReport.title} now has its own page`
        : `${chosenReport.title} is back with its family`,
      () => saveReportPresentation(chosenReport.id, patch),
    );
    if (result) {
      closeEditor();
      reports.reload();
    }
  };

  const reset = async (key: string, title: string, close: boolean) => {
    if (!canManage) return;
    const result = await run(`${title} is back with its family`, () => resetReportPresentation(key));
    if (result) {
      if (close) closeEditor();
      reports.reload();
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return STANDARD_REPORTS.filter((report) => {
      if (view !== "all" && familyOf(report) !== view) return false;
      if (!needle) return true;
      return report.title.toLowerCase().includes(needle) || report.id.toLowerCase().includes(needle);
    });
  }, [view, query]);

  const overridden = rows.length;
  const at = useMemo(() => new Date(), []);
  const blocks = useMemo(() => specimenBlocks("report"), []);

  const preview = useMemo(
    () =>
      kit ? previewBrand({ kit, family: chosenFamily, presentation: shownPresentation }) : null,
    [kit, shownPresentation, chosenFamily],
  );

  const editor = draft ? (
    <PresentationForm
      draft={draft}
      onChange={setDraft}
      disabled={!canManage || saving}
      footerContext={kit?.documentFooter ?? null}
      resetLabel={
        storedRow || Object.keys(patchAgainst(familyResolved, draft)).length
          ? `Reset ${chosenReport.title} to its family's`
          : undefined
      }
      onReset={() => void reset(chosenReport.id, chosenReport.title, true)}
    />
  ) : null;

  if ((brand.status === "loading" && !kit) || (reports.status === "loading" && !rows.length)) {    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Reports" icon={<FileText size={16} className="text-cyber-400" />} subtitle={BRAND_REPORTS_SUBTITLE} />
        <LoadingBlock label="the report presentations" />
      </div>
    );
  }

  if (!kit || reports.status === "unavailable") {
    return (
      <div className="space-y-4">
        <PageHeader title="Branding — Reports" icon={<FileText size={16} className="text-cyber-400" />} subtitle={BRAND_REPORTS_SUBTITLE} />
        <UnavailablePanel
          message={reports.message ?? brand.message ?? "The report presentations could not be read."}
          onRetry={() => {
            reports.reload();
            brand.reload();
          }}
          what="A report's presentation is a patch over its family's, so both reads are needed before this screen can say what a report wears."
        />
      </div>
    );
  }

  if (redesign) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Branding — Reports"
          icon={<FileText size={16} className="text-cyber-400" />}
          subtitle={BRAND_REPORTS_SUBTITLE}
          actions={<BrandLinks current={SCREEN} />}
        />

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="min-w-0 space-y-3.5">
            <PageHeader
              variant="section"
              title="The shipped reports"
              subtitle={`${STANDARD_REPORTS.length} reports; ${overridden} of them have a page of their own.`}
            />
            <Band tone="info" title="What is enforced today">{CARRIED_NOTE}</Band>
            {rereadFailed ? (
              <Band tone="warn" title="One of the reads did not answer">
                {reports.message ?? brand.message} What is shown is the last answer that arrived, so it may be a
                moment out of date.
              </Band>
            ) : null}
            {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which reports">
              {[
                { id: "all", label: "Every report", count: STANDARD_REPORTS.length },
                { id: "report.standard", label: "Standard reports", count: STANDARD_REPORTS.filter((report) => familyOf(report) === "report.standard").length },
                { id: "report.review", label: "Business reviews", count: REVIEW_REPORTS.length },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  className={`chip ${view === option.id ? "chip--on" : ""}`}
                  onClick={() => setView(option.id)}
                >
                  {option.label}
                  <span className="chip__n">{option.count}</span>
                </button>
              ))}
              <label className="relative ml-auto min-w-0 sm:w-56">
                <input
                  className="input-field"
                  placeholder="Find a report"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>

            <div className="space-y-2.5">
              {filtered.map((report) => {
                const row = rows.find((entry) => entry.reportKey === report.id) ?? null;
                const family = familyOf(report);
                const resolved = row ? mergeRow(resolvedFamily(family), row) : resolvedFamily(family);
                return (
                  <div key={report.id} className={`card ${report.id === chosenKey ? "border-cyber-500/40" : ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-sm font-semibold text-white">{report.title}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row ? <StateChip tone="on">its own presentation</StateChip> : <StateChip tone="neutral">its family&rsquo;s</StateChip>}
                        <StateChip tone="locked">{familyTitle(family)}</StateChip>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{report.description}</p>
                    <p className="mt-2 font-mono text-[11px] text-gray-500">{report.id}</p>
                    <p className="mt-1 text-[11.5px] text-gray-400">
                      {presentationLine(resolved)}
                      {row ? ` · changed ${when(row.updatedAt)}${row.updatedByName ? ` by ${row.updatedByName}` : ""}` : ""}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <button type="button" className="chip" onClick={() => openReport(report.id, resolved)}>
                        Edit its page
                      </button>
                      {row ? (
                        <button
                          type="button"
                          className="chip"
                          disabled={!canManage || saving}
                          onClick={() => void reset(report.id, report.title, false)}
                        >
                          <RotateCcw size={11} />
                          Reset to its family
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {filtered.length ? null : (
                <p className="px-1 py-3 text-xs text-gray-500">No report matches “{query}”.</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 px-1 pb-1 text-xs text-gray-500">
              <span className="tabular-nums">
                {filtered.length} of {STANDARD_REPORTS.length} reports shown
              </span>
              <span className="ml-auto text-[11px] text-gray-600">
                {overridden} of {STANDARD_REPORTS.length} reports differ from their family
              </span>
            </div>
          </div>

          <aside className="space-y-3.5 xl:sticky xl:top-4">
            {preview ? (
              <PreviewPanel
                caption={`Preview — ${chosenReport?.title ?? "a report"}'s page`}
                brand={preview}
                title={chosenReport?.title ?? "A specimen sheet"}
                metaLine={specimenMetaLine("Prepared for a specimen client", at)}
                blocks={blocks}
                footerLeft={specimenFooterLeft(preview, at)}
                note="The figures are a specimen. What is drawn is this report's record — its own choices laid over its family's — and the band above says which renderers read it."
              />
            ) : null}
          </aside>
        </div>

        {editing && draft && editor ? (
          <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]" onClick={closeEditor}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`What ${chosenReport?.title ?? chosenKey} wears`}
              className="w-full max-w-2xl space-y-3 rounded-xl border border-surface-border bg-surface p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">{chosenReport?.title ?? chosenKey}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {chosenReport?.description} · {familyTitle(chosenFamily)}
                  </p>
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
        title="Branding — Reports"
        subtitle={BRAND_REPORTS_SUBTITLE}
        actions={<BrandLinks current={SCREEN} />}
      />
      <Band tone="info" title="What is enforced today">{CARRIED_NOTE}</Band>
      {rereadFailed ? (
        <Band tone="warn" title="One of the reads did not answer">
          {reports.message ?? brand.message} What is shown is the last answer that arrived, so it may be a moment
          out of date.
        </Band>
      ) : null}
      {!canManage ? <Band tone="warn" title="Read only">{NEEDS_MANAGE}</Band> : null}

      <section className="card space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">The shipped reports</h2>
            <p className="text-sm text-gray-400">
              {STANDARD_REPORTS.length} reports; {overridden} of them have a page of their own.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-gray-400">Family</span>
              <select className="input-field mt-1" value={view} onChange={(event) => setView(event.target.value)}>
                <option value="all">Every report</option>
                <option value="report.standard">Standard reports</option>
                <option value="report.review">Business reviews</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-gray-400">Find a report</span>
              <input className="input-field mt-1" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
        </div>

        <table className="ptable w-full text-xs">
          <caption className="sr-only">Every shipped report, its family, and whether it has a presentation of its own</caption>
          <thead>
            <tr>
              <th className="px-2 py-2 text-left">Report</th>
              <th className="px-2 py-2 text-left">Key</th>
              <th className="px-2 py-2 text-left">Family</th>
              <th className="px-2 py-2 text-left">Its own presentation</th>
              <th className="px-2 py-2 text-left">Last changed</th>
              <th className="px-2 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((report) => {
              const row = rows.find((entry) => entry.reportKey === report.id) ?? null;
              const resolved = row ? mergeRow(resolvedFamily(familyOf(report)), row) : resolvedFamily(familyOf(report));
              return (
                <tr key={report.id} className={report.id === chosenKey ? "bg-surface-lighter" : undefined}>
                  <td className="px-2 py-1.5">
                    <span className="block font-medium text-white">{report.title}</span>
                    <span className="block text-gray-500">{report.description}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{report.id}</td>
                  <td className="px-2 py-1.5">{familyTitle(familyOf(report))}</td>
                  <td className="px-2 py-1.5">
                    {row ? "its own" : "its family's"}
                    <span className="block text-gray-500">{presentationLine(resolved)}</span>
                  </td>
                  <td className="px-2 py-1.5">{row ? `${when(row.updatedAt)}${row.updatedByName ? ` · ${row.updatedByName}` : ""}` : "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => openReport(report.id, resolved)}>
                        Edit
                      </button>
                      {row ? (
                        <button
                          type="button"
                          className="btn-secondary !px-2.5 !py-1 text-xs"
                          disabled={!canManage || saving}
                          onClick={() => void reset(report.id, report.title, false)}
                        >
                          Reset
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] text-gray-500">
          {overridden} of {STANDARD_REPORTS.length} reports differ from their family. A report that differs by
          nothing stores nothing, and Reset puts it back under whatever its family says today.
        </p>
      </section>

      {preview ? (
        <PreviewPanel
          caption={`Preview — ${chosenReport?.title ?? "a report"}'s page`}
          brand={preview}
          title={chosenReport?.title ?? "A specimen sheet"}
          metaLine={specimenMetaLine("Prepared for a specimen client", at)}
          blocks={blocks}
          footerLeft={specimenFooterLeft(preview, at)}
          note={`The figures are a specimen. What is drawn is this report's record — its own choices laid over ${familyTitle(chosenFamily).toLowerCase()} — and the band above says which renderers read it.`}
        />
      ) : null}

      {editing && draft && editor ? (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={closeEditor}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`What ${chosenReport?.title ?? chosenKey} wears`}
            className="w-full max-w-3xl rounded-xl border border-surface-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-white">What {chosenReport?.title ?? chosenKey} wears</h2>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">
              {chosenReport?.description} · laid over {familyTitle(chosenFamily)}.
            </p>
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

/** A report's stored patch laid over its family, for a row that has one. */
function mergeRow(family: DocumentPresentation, row: ReportBrandRow): DocumentPresentation {
  const merged: DocumentPresentation = { ...family };
  for (const [key, value] of Object.entries(row.presentation)) {
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

/** "today", "3 days ago" — the same shape the API Keys screen uses, so two screens date the same way. */
function when(iso: string): string {
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return `today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}
