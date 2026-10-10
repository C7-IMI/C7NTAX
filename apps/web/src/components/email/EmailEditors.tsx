/**
 * The one place a brand-kit field is written: one component, one set of handlers, two returns.
 *
 * Both surfaces it edits go to `PUT /api/email/brand` — the kit itself and the sender identity — because
 * that is the row the API stores and the row every send reads.
 *
 * The classic arrangement is the dialog this product has always had: a heading, labelled fields in a
 * grid, Cancel and Save at the end, which is what every other classic settings screen is. The modern
 * arrangement is a sheet in the Modern interface's furniture: each field is a row with its current value, a
 * single sentence saying what the field does beside the control that changes it, and one Save at the
 * bottom rather than a Save/Cancel pair. The state, the validation, the payload and the words are
 * identical; only the arrangement differs, which is the rule in `DESIGN.md` §3.
 *
 * **What is not drawn, and why.** A control this account may not use because of a *permission* is not
 * drawn at all — the arrangement prints which permission would be needed instead, and the API refuses
 * the same thing (`PUT /brand` is `email:manage`). A control blocked by *state* — the read failed, so a
 * save has nothing to write over — is drawn disabled with the reason beside it, which is the opposite
 * case and gets the opposite treatment.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import type { FieldCtx, FieldSpec } from "./brandScreen";
import { IDENTITY_FIELDS, KIT_FIELDS } from "./brandScreen";
import { WriteFailure } from "./emailChrome";

export type EditorSurface = "kit" | "identity";

const SURFACE_TITLE: Record<EditorSurface, string> = {
  kit: "Edit the brand kit",
  identity: "Edit the sending identity",
};

const SURFACE_BLURB: Record<EditorSurface, string> = {
  kit: "Applies to every message this deployment sends and to every document it prints — one kit, not two brands.",
  identity: "The address each message leaves from, and where a reply to it goes. Nothing here can give a domain permission to send.",
};

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function FieldsEditor({
  surface,
  ctx,
  blockedReason,
  saving,
  error,
  onSave,
  onClose,
}: {
  surface: EditorSurface;
  ctx: FieldCtx;
  /** Set when the values cannot be saved — the fields are then shown disabled with this beside them. */
  blockedReason: string | null;
  saving: boolean;
  error: string | null;
  onSave: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const modern = useModernInterface();
  const fields = useMemo<FieldSpec[]>(() => (surface === "identity" ? IDENTITY_FIELDS : KIT_FIELDS), [surface]);
  const initial = useMemo(() => {
    const draft: Record<string, string> = {};
    for (const field of fields) draft[field.id] = field.value(ctx);
    return draft;
  }, [fields, ctx]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);

  useEscape(onClose);

  const set = (id: string, value: string) => setDraft((current) => ({ ...current, [id]: value }));

  const submit = () => {
    const patch: Record<string, unknown> = {};
    for (const field of fields) patch[field.id] = field.payload(draft[field.id] ?? "");
    onSave(patch);
  };

  const control = (field: FieldSpec, long: boolean): ReactNode => {
    const shared = {
      value: draft[field.id] ?? "",
      disabled: blockedReason !== null,
      "aria-label": field.label,
    };
    if (long) {
      return (
        <textarea
          {...shared}
          rows={2}
          className="input-field"
          onChange={(event) => set(field.id, event.target.value)}
        />
      );
    }
    return (
      <input
        {...shared}
        type={field.kind === "colour" ? "text" : field.kind === "url" ? "text" : "text"}
        className="input-field"
        onChange={(event) => set(field.id, event.target.value)}
      />
    );
  };

  if (modern) {
    return (
      <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh]" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={SURFACE_TITLE[surface]}
          className="w-full max-w-xl space-y-3 overflow-hidden rounded-xl border border-surface-border bg-surface p-5"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{SURFACE_TITLE[surface]}</h2>
              <p className="mt-0.5 text-xs text-gray-500">{SURFACE_BLURB[surface]}</p>
            </div>
            <button type="button" onClick={onClose} className="chip p-1.5" aria-label="Close">
              <X size={13} />
            </button>
          </div>

          {blockedReason ? (
            <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">{blockedReason}</p>
          ) : null}

          <div className="space-y-2.5">
            {fields.map((field) => (
              <div key={field.id} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <label className="text-xs font-semibold text-white" htmlFor={`sheet-${surface}-${field.id}`}>{field.label}</label>
                  <span className="min-w-0 flex-1">
                    <span id={`sheet-${surface}-${field.id}`} className="block">
                      {control(field, field.kind === "longtext")}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{field.help}</p>
              </div>
            ))}
          </div>

          {error ? <WriteFailure message={error} /> : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-gray-500">
              {blockedReason ? "Shown, not offered." : "Saved to the brand kit, under email:manage."}
            </span>
            <button type="button" className="btn-primary text-sm" onClick={submit} disabled={saving || blockedReason !== null}>
              {saving ? <Loader2 size={13} className="mr-1.5 inline animate-spin" /> : null}
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Classic: labelled fields in a grid, with a heading and Save/Cancel ──────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SURFACE_TITLE[surface]}
        className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-semibold text-white">{SURFACE_TITLE[surface]}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{SURFACE_BLURB[surface]}</p>
        </div>

        {blockedReason ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-gray-300">{blockedReason}</p>
        ) : null}

        {fields.map((field) => (
          <div key={field.id}>
            <label className="mb-1 block text-xs text-gray-500" htmlFor={`${surface}-${field.id}`}>{field.label}</label>
            {field.kind === "longtext" ? (
              <textarea
                id={`${surface}-${field.id}`}
                className="input-field"
                rows={2}
                disabled={blockedReason !== null}
                value={draft[field.id] ?? ""}
                onChange={(event) => set(field.id, event.target.value)}
              />
            ) : (
              <input
                id={`${surface}-${field.id}`}
                className="input-field"
                disabled={blockedReason !== null}
                value={draft[field.id] ?? ""}
                onChange={(event) => set(field.id, event.target.value)}
              />
            )}
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{field.help}</p>
          </div>
        ))}

        {error ? <WriteFailure message={error} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submit} disabled={saving || blockedReason !== null}>
            {saving ? <Loader2 size={13} className="mr-1.5 inline animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
