/**
 * What one document family (or one report) wears — one component, one set of handlers, two returns.
 *
 * The state and the words are the page's and this module's; the arrangement is not. In the modern
 * interface the choices are **pills you press**: a row of four for the letterhead with the explanation
 * of the chosen one beside it, two for the paper, two for the orientation, and the three switches as
 * chips that read "Footer · on". In the classic interface it is a **form**: labelled fields in a grid
 * with a `<select>` where the modern screen has pills, checkboxes for the switches and `<input>`s for the
 * three text overrides. That is DESIGN.md §3's rule applied to the control rather than to the page, and
 * it is the same pattern `components/email/EmailEditors.tsx` follows for the brand kit's fields.
 *
 * Every control carries the sentence saying **what reads it**, from `presentationSpec`. Four of the nine
 * settings are read by nothing yet, and a control that silently did nothing when pressed would be worse
 * than one that says so.
 */
import { Info } from "lucide-react";
import type { DocumentPresentation } from "@C7NTAX/shared";
import { useRedesign } from "../../hooks/useNavigationStyle";
import {
  FLAG_SPECS,
  LETTERHEAD_OPTIONS,
  ORIENTATION_OPTIONS,
  PAPER_OPTIONS,
  TEXT_SPECS,
} from "./presentationSpec";

export function PresentationForm({
  draft,
  onChange,
  disabled,
  resetLabel,
  onReset,
  footerContext,
}: {
  draft: DocumentPresentation;
  onChange: (next: DocumentPresentation) => void;
  disabled?: boolean;
  /** Shown when the draft differs from the reference the caller is measuring against. */
  resetLabel?: string;
  onReset?: () => void;
  /** The instance's own footer sentence, so a footer note is not mistaken for a replacement for it. */
  footerContext?: string | null;
}) {
  const redesign = useRedesign();
  const set = <K extends keyof DocumentPresentation>(key: K, value: DocumentPresentation[K]) =>
    onChange({ ...draft, [key]: value });

  const letterhead = LETTERHEAD_OPTIONS.find((option) => option.id === draft.letterhead) ?? LETTERHEAD_OPTIONS[0]!;

  /**
   * The sentence each control carries about who reads it — rendered in both arrangements, because it is
   * a fact about the setting rather than part of either layout.
   */
  const carried = (text: string) => (
    <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
      <Info size={11} className="mt-0.5 shrink-0 text-gray-600" />
      <span>{text}</span>
    </p>
  );

  const readOnly = disabled === true;

  if (redesign) {
    return (
      <div className="space-y-3.5">
        <div>
          <p className="text-xs font-semibold text-white">The letterhead</p>
          <p className="mt-0.5 text-[11.5px] text-gray-500">{letterhead.help}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Letterhead">
            {LETTERHEAD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={readOnly}
                aria-pressed={draft.letterhead === option.id}
                title={option.help}
                className={`chip ${draft.letterhead === option.id ? "chip--on" : ""}`}
                onClick={() => set("letterhead", option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {carried("Every renderer draws the mark this chooses — the print document, the PDF, the invoice, the statement and the quote.")}
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-white">Paper</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Paper size">
              {PAPER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={draft.pageSize === option.id}
                  className={`chip ${draft.pageSize === option.id ? "chip--on" : ""}`}
                  onClick={() => set("pageSize", option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {carried("Every renderer sets its sheet to this, including the invoice's own page.")}
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Orientation</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Orientation">
              {ORIENTATION_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={draft.orientation === option.id}
                  className={`chip ${draft.orientation === option.id ? "chip--on" : ""}`}
                  onClick={() => set("orientation", option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {carried("The type does not shrink for landscape — a nine-column table fits or the document is read in portrait.")}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-white">On the page</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {FLAG_SPECS.map((spec) => (
              <button
                key={spec.key}
                type="button"
                disabled={readOnly}
                aria-pressed={draft[spec.key]}
                title={spec.help}
                className={`chip ${draft[spec.key] ? "chip--on" : ""}`}
                onClick={() => set(spec.key, !draft[spec.key])}
              >
                {spec.label}
                <span className="chip__n">{draft[spec.key] ? "on" : "off"}</span>
              </button>
            ))}
          </div>
          <ul className="mt-2 space-y-1">
            {FLAG_SPECS.map((spec) => (
              <li key={spec.key} className="text-[11px] leading-relaxed text-gray-500">
                <span className="text-gray-400">{spec.label}:</span> {spec.help} <span className="text-gray-600">{spec.carried}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2.5">
          {TEXT_SPECS.map((spec) => (
            <div key={spec.key}>
              <label className="text-xs font-semibold text-white" htmlFor={`pres-${spec.key}`}>
                {spec.label}
              </label>
              <input
                id={`pres-${spec.key}`}
                className="input-field mt-1"
                placeholder={spec.placeholder}
                value={draft[spec.key] ?? ""}
                disabled={readOnly}
                onChange={(event) => set(spec.key, event.target.value || null)}
              />
              {carried(`${spec.help} ${spec.carried}`)}
            </div>
          ))}
        </div>

        {footerContext ? (
          <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-[11px] text-gray-400">
            The instance's own footer sentence still applies: <span className="text-gray-300">{footerContext}</span>
          </p>
        ) : null}

        {onReset && resetLabel ? (
          <button type="button" className="btn-secondary text-xs" disabled={readOnly} onClick={onReset}>
            {resetLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-xs font-medium text-gray-400">Letterhead</span>
          <select
            className="input-field mt-1"
            value={draft.letterhead}
            disabled={readOnly}
            onChange={(event) => set("letterhead", event.target.value as DocumentPresentation["letterhead"])}
          >
            {LETTERHEAD_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-gray-500">{letterhead.help}</span>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-gray-400">Paper size</span>
          <select
            className="input-field mt-1"
            value={draft.pageSize}
            disabled={readOnly}
            onChange={(event) => set("pageSize", event.target.value as DocumentPresentation["pageSize"])}
          >
            {PAPER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-gray-400">Orientation</span>
          <select
            className="input-field mt-1"
            value={draft.orientation}
            disabled={readOnly}
            onChange={(event) => set("orientation", event.target.value as DocumentPresentation["orientation"])}
          >
            {ORIENTATION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-gray-400">On the page</legend>
        {FLAG_SPECS.map((spec) => (
          <label key={spec.key} className="flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-light px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft[spec.key]}
              disabled={readOnly}
              onChange={(event) => set(spec.key, event.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-white">{spec.label}</span>
              <span className="block text-[11px] leading-relaxed text-gray-500">{spec.help} <span className="text-gray-600">{spec.carried}</span></span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TEXT_SPECS.map((spec) => (
          <label key={spec.key} className="block text-sm">
            <span className="text-xs font-medium text-gray-400">{spec.label}</span>
            <input
              className="input-field mt-1"
              placeholder={spec.placeholder}
              value={draft[spec.key] ?? ""}
              disabled={readOnly}
              onChange={(event) => set(spec.key, event.target.value || null)}
            />
            <span className="mt-1 block text-[11px] text-gray-500">{spec.help}</span>
          </label>
        ))}
      </div>

      {footerContext ? (
        <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-[11px] text-gray-400">
          The instance's own footer sentence still applies: <span className="text-gray-300">{footerContext}</span>
        </p>
      ) : null}

      {onReset && resetLabel ? (
        <button type="button" className="btn-secondary text-xs" disabled={readOnly} onClick={onReset}>
          {resetLabel}
        </button>
      ) : null}
    </div>
  );
}
