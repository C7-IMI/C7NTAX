/**
 * One client's own brand — the ten fields a client may override, and the state of each one.
 *
 * Split out of the page for the reason the section's other pages split: the page owns the list, the
 * choosing, the reads and the writes; this owns **a form**. It is also the one place the API's two
 * awkward shapes about a client's brand are dealt with, so a reader meets them once:
 *
 *  - `saveCompanyOverride` writes all ten keys every time with `null` for the ones that were left empty,
 *    so a stored patch says "inherit" ten times and "set" once. `ownOverrideKeys` (in `brandApi`) is what
 *    tells them apart, and only a key that is genuinely this client's own is seeded into the form.
 *  - a client with no logo of its own **wears its portal logo** (`Company.portalLogoUrl`), and
 *    `loadCompanyOverride` resolves that into `logoUrl`. The API says so with `inheritedLogo: "portal"`,
 *    which is why the picker must start empty with the reason beside it rather than showing an image the
 *    form does not contain: a save seeded from the portal's URL would store it as an override and the
 *    client would stop following its portal.
 *
 * **The rule the form is built on** is that an empty box means "inherit the instance's". It is stated on
 * the form, the chip beside each field follows the box, and clearing a box is how a value goes back to
 * being inherited — nothing is copied, so nothing has to be deleted. That is the whole reason a client's
 * brand is a patch rather than a second brand: the two can never disagree about the parts nobody
 * overrode.
 */
import { useRef } from "react";
import { Loader2, X } from "lucide-react";
import { DOCUMENT_PALETTE } from "@C7NTAX/shared";
import type { BrandKit, BrandOverride } from "@C7NTAX/shared";
import { Band, StateChip } from "../email/emailChrome";
import {
  UPLOAD_ACCEPT,
  UPLOAD_TYPES_SENTENCE,
  ownOverrideKeys,
  uploadLimitSentence,
  type ClientBrandRow,
} from "./brandApi";
import { useBrandUpload } from "./BrandAssetField";

/** The ten fields a client may override, in the order the form reads them. */
interface OverrideField {
  key: keyof BrandOverride;
  label: string;
  help: string;
  kind: "text" | "lines" | "colour" | "image";
}

export const OVERRIDE_FIELDS: OverrideField[] = [
  { key: "companyName", label: "Company name", help: "The legal entity this client is invoiced as.", kind: "text" },
  { key: "tagline", label: "Tagline", help: "One line under the name, where this client has one.", kind: "text" },
  { key: "logoUrl", label: "Logo", help: "This client's lockup, for the documents addressed to it.", kind: "image" },
  { key: "iconUrl", label: "Icon", help: "This client's square mark, where a document asks for one.", kind: "image" },
  { key: "contactLine", label: "Contact line", help: "The phone number and address as they should read on this client's paper.", kind: "text" },
  { key: "addressLines", label: "Postal address", help: "One line each, printed in the footer of a document that is posted.", kind: "lines" },
  { key: "primaryColor", label: "Primary colour", help: "The accent on this client's documents. It has to be readable on white.", kind: "colour" },
  { key: "accentColor", label: "Accent colour", help: "The interface and email secondary colour. Not printed on paper.", kind: "colour" },
  { key: "documentFooter", label: "Document footer", help: "The sentence at the foot of this client's documents — payment terms, a confidentiality line.", kind: "text" },
  { key: "legalText", label: "Legal text", help: "This client's small print.", kind: "text" },
];

export type ClientDraft = Record<string, string>;

/** The draft, seeded only from the keys that are genuinely this client's own. */
export function draftFromClient(row: ClientBrandRow): ClientDraft {
  const own = new Set(ownOverrideKeys(row.override, row.inheritedLogo));
  const draft: ClientDraft = {};
  for (const field of OVERRIDE_FIELDS) {
    const value = row.override?.[field.key as keyof BrandOverride];
    if (!own.has(field.key)) {
      draft[field.key] = "";
      continue;
    }
    if (field.key === "addressLines") {
      draft[field.key] = Array.isArray(value) ? (value as string[]).join("\n") : "";
    } else {
      draft[field.key] = value === null || value === undefined ? "" : String(value);
    }
  }
  return draft;
}

/** The draft as the patch the API expects: only the boxes with something in them. */
export function overrideFromDraft(draft: ClientDraft): BrandOverride {
  const patch: BrandOverride = {};
  for (const field of OVERRIDE_FIELDS) {
    const raw = (draft[field.key] ?? "").trim();
    if (field.key === "addressLines") {
      const lines = (draft.addressLines ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length) patch.addressLines = lines;
    } else if (raw) {
      Object.assign(patch, { [field.key]: raw });
    }
  }
  return patch;
}

/** Whether the draft says anything at all, for the sentence under the form. */
export function draftIsEmpty(draft: ClientDraft): boolean {
  return Object.keys(overrideFromDraft(draft)).length === 0;
}

/**
 * The instance's own value for a field, so an empty box can say what it is inheriting.
 *
 * An uploaded image is described rather than quoted: the stored value of `logoUrl` is an asset URL
 * (`/api/brand/asset/<id>`), and printing that beside a form is a string nobody can read while the image
 * it names is on the screen next door.
 */
function instanceValue(kit: BrandKit, field: OverrideField): string {
  const value = kit[field.key as keyof BrandKit];
  if (field.key === "addressLines") return Array.isArray(value) ? (value as string[]).join(", ") : "";
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/^(\/api\/|https?:\/\/)/.test(text) && field.kind === "image") {
    return "the image uploaded on the Identity screen";
  }
  return text;
}

const INHERIT_RULE =
  "An empty box means this client inherits the instance's value, and the chip beside the field says so. Clearing a box is how a value goes back to being inherited; nothing is deleted, because nothing was copied.";

export function ClientOverrideForm({
  row,
  kit,
  draft,
  disabled,
  onChange,
}: {
  row: ClientBrandRow;
  kit: BrandKit;
  draft: ClientDraft;
  disabled: boolean;
  onChange: (key: keyof BrandOverride, value: string) => void;
}) {
  const field = (key: keyof BrandOverride): string => draft[key] ?? "";

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-[11.5px] text-gray-400">
        {INHERIT_RULE}
      </p>
      {row.inheritedLogo === "portal" ? (
        <Band tone="warn" title="This client is wearing its portal logo">
          Its client portal has a logo of its own and no document logo was set here, so the portal logo is what its
          documents and messages currently wear. The picker below starts empty on purpose: choosing a file here replaces
          the portal logo on documents only.
        </Band>
      ) : null}
      <div className="space-y-2.5">
        {OVERRIDE_FIELDS.map((spec) => {
          const value = field(spec.key);
          const set = value.trim().length > 0;
          const inherited = instanceValue(kit, spec) || "nothing is set on the instance either";
          return (
            <div key={spec.key} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <label className="text-xs font-semibold text-white" htmlFor={`client-${spec.key}`}>
                  {spec.label}
                </label>
                {set ? <StateChip tone="on">set for this client</StateChip> : <StateChip tone="neutral">the instance's</StateChip>}
              </div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{spec.help}</p>
              <div className="mt-2">
                {spec.kind === "image" ? (
                  <ClientImageField
                    kind={spec.key === "iconUrl" ? "icon" : "logo"}
                    value={value}
                    disabled={disabled}
                    onChange={(url) => onChange(spec.key, url ?? "")}
                  />
                ) : spec.kind === "lines" ? (
                  <textarea
                    id={`client-${spec.key}`}
                    rows={3}
                    className="input-field"
                    value={value}
                    disabled={disabled}
                    placeholder={`Inherited — ${inherited}`}
                    onChange={(event) => onChange(spec.key, event.target.value)}
                  />
                ) : spec.kind === "colour" ? (
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-8 w-8 shrink-0 rounded-lg border border-surface-border"
                      style={{ background: value || "transparent" }}
                    />
                    <input
                      id={`client-${spec.key}`}
                      className="input-field font-mono"
                      value={value}
                      disabled={disabled}
                      placeholder={instanceValue(kit, spec)}
                      spellCheck={false}
                      onChange={(event) => onChange(spec.key, event.target.value)}
                    />
                  </div>
                ) : (
                  <input
                    id={`client-${spec.key}`}
                    className="input-field"
                    value={value}
                    disabled={disabled}
                    placeholder={`Inherited — ${inherited}`}
                    onChange={(event) => onChange(spec.key, event.target.value)}
                  />
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-gray-600">
                  {set ? "This client's own value." : `Inherited from the instance: ${inherited}`}
                </p>
                {set ? (
                  <button type="button" className="chip" disabled={disabled} onClick={() => onChange(spec.key, "")}>
                    <X size={11} />
                    Inherit instead
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A client's logo or icon.
 *
 * It shares `useBrandUpload` with the Identity screen's control rather than re-implementing the three
 * steps — a picked file, its validation and the URL it comes back as — because a second copy of "which
 * types, how large, and why an SVG is refused" is a second set of rules that can drift. What differs is
 * the shape: this is a small row inside a form of ten fields, not the tile the Identity screen builds its
 * page around.
 */
function ClientImageField({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: "logo" | "icon";
  value: string;
  disabled: boolean;
  onChange: (url: string | null) => void;
}) {
  const { busy, problem, clear, choose } = useBrandUpload(kind, onChange);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex h-14 w-24 shrink-0 items-center justify-center rounded-lg border border-surface-border"
          /* A mark is shown on the paper a document prints it on — white in both themes. See the note in
             `components/brand/BrandAssetField.tsx`. */
          style={{ background: DOCUMENT_PALETTE.paper }}
        >
          {value ? (
            <img src={value} alt="This client's mark, as it is set now" className="max-h-12 max-w-[5.5rem]" />
          ) : (
            <span className="text-[10.5px] text-gray-500">none</span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="input-field max-w-xs"
          disabled={disabled || busy}
          aria-label={`Choose a file for this client's ${kind}`}
          onChange={(event) => {
            void (async () => {
              await choose(event.target.files?.[0] ?? null);
              if (inputRef.current) inputRef.current.value = "";
            })();
          }}
        />
        {value ? (
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5 text-xs"
            disabled={disabled || busy}
            onClick={() => {
              clear();
              onChange(null);
            }}
          >
            Remove
          </button>
        ) : null}
        {busy ? <Loader2 size={13} className="animate-spin text-gray-500" /> : null}
      </div>
      <p className="text-[11px] text-gray-500">
        {UPLOAD_TYPES_SENTENCE} · {uploadLimitSentence()} An SVG is refused: it is a script with an image's extension.
      </p>
      {problem ? (
        <p role="alert" className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-2.5 py-1.5 text-[11px] text-gray-300">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
