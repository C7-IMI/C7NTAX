/**
 * One image field — the logo, the dark-background lockup or the icon — in both interfaces.
 *
 * These three fields are the ones people come to Branding for, and the control is deliberately more than
 * a file input: it shows **the image that is there**, states what is there when there is nothing, names
 * the types and the size limit before the picker rather than after a refusal, uploads on picking, and
 * offers a **Remove** that clears the field rather than a delete nobody can undo.
 *
 * The upload and the save are two steps and that is not an accident of the API: picking a file posts its
 * bytes and receives a URL, and the URL becomes a *draft* value like anything typed on the form — so
 * Save still means "make this true", and Cancel still means nothing happened. An instance's documents
 * only change when the save lands.
 *
 * The two arrangements differ in the way the whole product's do: the modern one is a tile you press with
 * the mark drawn large in it and a sentence under it, the classic one is a labelled field in a grid with
 * a thumbnail, a file input and a Remove button beside it. The handler behind both is `upload`.
 */
import { useRef, useState } from "react";
import { AlertTriangle, ImageOff, Loader2, Trash2, Upload } from "lucide-react";
import { BRAND_COLOR_DEFAULTS, DOCUMENT_PALETTE } from "@C7NTAX/shared";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { COLOUR_PATTERN, COLOUR_SWATCHES, type BrandFieldSpec } from "./brandFields";
import {
  UPLOAD_ACCEPT,
  UPLOAD_TYPES_SENTENCE,
  readImageFile,
  uploadBrandAsset,
  uploadLimitSentence,
} from "./brandApi";

/** Which asset kind a brand field uploads as. */
function kindOf(key: string): "logo" | "logoDark" | "icon" {
  if (key === "logoUrl") return "logo";
  if (key === "logoDarkUrl") return "logoDark";
  return "icon";
}

/**
 * The upload behaviour, shared by the control below and by any screen that wants the same three steps in
 * a shape of its own — the client-override form does, because a client's logo is a deliberate rarity
 * rather than the headline job the Identity screen exists for.
 *
 * Picking a file is one call that ends in a URL (`POST /api/brand/assets`), and the URL becomes a *draft*
 * value; nothing here saves. So a refusal arrives while the person is still at the picker, and the byte
 * size, the type and the SVG rule are all applied before a request is made.
 */
export function useBrandUpload(
  kind: "logo" | "logoDark" | "icon",
  onChange: (url: string | null) => void,
): {
  busy: boolean;
  problem: string | null;
  clear: () => void;
  choose: (file: File | null) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | null) => {
    if (!file) return;
    setProblem(null);
    const read = await readImageFile(file);
    if (!read.ok) {
      setProblem(read.message);
      return;
    }
    setBusy(true);
    const result = await uploadBrandAsset(kind, read.dataUrl);
    setBusy(false);
    if (!result.ok || !result.payload) {
      setProblem(result.message ?? "The upload did not answer with an image.");
      return;
    }
    onChange(result.payload.url);
  };

  return { busy, problem, clear: () => setProblem(null), choose };
}

/** The label, help and empty-state a screen has to supply to the control below. */
export interface AssetFieldSpec {
  key: string;
  label: string;
  help: string;
  unset: string;
}

export function BrandAssetField({
  spec,
  value,
  onChange,
  disabled,
  emphasis = "row",
}: {
  spec: AssetFieldSpec;
  /** The URL in the draft, or "" for none. */
  value: string;
  /** Called with the uploaded URL, or with null for Remove. The draft decides when it is saved. */
  onChange: (url: string | null) => void;
  disabled?: boolean;
  /** "hero" draws the two fields people came for, larger than everything else on the page. */
  emphasis?: "hero" | "row";
}) {
  const modern = useModernInterface();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { busy, problem, clear, choose } = useBrandUpload(kindOf(spec.key), onChange);

  const pick = async (file: File | null) => {
    await choose(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  /**
   * The file input, rendered once per arrangement with the class that belongs to it — hidden behind a
   * button in the modern interface, a labelled control in the classic one. It is one element with one
   * ref in either case, so picking the *same* file twice still fires a change.
   */
  const picker = (className: string) => (
    <input
      ref={inputRef}
      type="file"
      accept={UPLOAD_ACCEPT}
      disabled={disabled || busy}
      className={className}
      onChange={(event) => void pick(event.target.files?.[0] ?? null)}
      aria-label={`Choose a file for ${spec.label}`}
    />
  );

  const rules = (
    <p className="text-[11px] leading-relaxed text-gray-500">
      {UPLOAD_TYPES_SENTENCE} · {uploadLimitSentence()} An SVG is refused: it is a script with an image's extension, and a
      logo is fetched by somebody else's mail client.
    </p>
  );

  const refusal = problem ? (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-2.5 py-1.5 text-[11px] text-gray-300">
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-alert-amber" />
      {problem}
    </p>
  ) : null;

  if (modern) {
    const hero = emphasis === "hero";
    return (
      <div className={`card ${hero ? "p-4" : ""}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h3 className={hero ? "text-sm font-semibold text-white" : "text-xs font-semibold text-white"}>{spec.label}</h3>
          {value ? <span className="chip chip--good">set</span> : <span className="chip">not set</span>}
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">{spec.help}</p>

        <div
          className={`mt-3 flex items-center justify-center rounded-lg border border-dashed border-surface-border ${
            hero ? "h-28" : "h-16"
          } ${value ? "" : "bg-surface-lighter"}`}
          /* A mark is shown on the paper it is printed on, which is white in both themes. Not `bg-white`
             — `white` is this product's themed *text* token (near-black on the light theme), and a logo
             drawn on that would be a logo misrepresented. The paper colour comes from the document
             palette, which is the contract's own value rather than a hex typed here. */
          style={value ? { background: DOCUMENT_PALETTE.paper } : undefined}
        >
          {value ? (
            <img src={value} alt={`${spec.label}, as it is set now`} className={hero ? "max-h-24 max-w-[90%]" : "max-h-14 max-w-[80%]"} />
          ) : (
            <span className="flex items-center gap-2 px-3 text-center text-[11px] text-gray-500">
              <ImageOff size={13} />
              {spec.unset}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {picker("hidden")}
          <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            <span className="ml-1.5">{value ? `Replace the ${spec.label.toLowerCase()}` : `Upload the ${spec.label.toLowerCase()}`}</span>
          </button>
          {value ? (
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={disabled || busy} onClick={() => { clear(); onChange(null); }}>
              <Trash2 size={12} />
              <span className="ml-1.5">Remove</span>
            </button>
          ) : null}
        </div>

        <div className="mt-2">{refusal}</div>
        <div className="mt-2">{rules}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex h-20 w-32 shrink-0 items-center justify-center rounded-lg border border-surface-border"
          /* The paper a mark is printed on: see the note in the modern arrangement above. */
          style={{ background: DOCUMENT_PALETTE.paper }}
        >
          {value ? (
            <img src={value} alt={`${spec.label}, as it is set now`} className="max-h-16 max-w-[7rem]" />
          ) : (
            <span className="px-2 text-center text-[10.5px] text-gray-500">
              <ImageOff size={13} className="mx-auto mb-1" />
              none
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {picker("input-field")}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              disabled={disabled || busy || !value}
              onClick={() => { clear(); onChange(null); }}
            >
              <Trash2 size={12} />
              <span className="ml-1.5">Remove</span>
            </button>
            {busy ? (
              <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <Loader2 size={12} className="animate-spin" />
                Uploading…
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-gray-500">
            {value ? spec.help : spec.unset}
          </p>
          {refusal}
          <div>{rules}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The colour field — a hex box, a native colour well, and the swatches.
 *
 * The warning beside it is not decoration: this is the only place in the product where a person can
 * choose something that looks right on a monitor and is gone on paper, and the sentence is written by
 * `contrastSentence` from the contract's own threshold.
 */
export function BrandColourField({
  spec,
  value,
  onChange,
  disabled,
  warning,
  onDraft,
}: {
  spec: BrandFieldSpec;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** `contrastSentence`'s answer, when this colour is the one a printed page uses. */
  warning: { survives: boolean; text: string } | null;
  /** The swatches to offer — used by the modern arrangement. */
  onDraft?: (value: string) => void;
}) {
  const modern = useModernInterface();
  const swatches = COLOUR_SWATCHES;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-lg border border-surface-border"
          style={{ background: value || "transparent" }}
        />
        <input
          className="input-field font-mono"
          value={value}
          disabled={disabled}
          aria-label={spec.label}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="color"
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-surface-border bg-surface"
          value={COLOUR_PATTERN.test(value) ? value : BRAND_COLOR_DEFAULTS.primaryColor}
          disabled={disabled}
          aria-label={`Pick ${spec.label.toLowerCase()}`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {modern && onDraft ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {swatches.map((swatch) => (
            <button
              key={swatch}
              type="button"
              disabled={disabled}
              aria-pressed={value.toLowerCase() === swatch}
              className={`chip font-mono ${value.toLowerCase() === swatch ? "chip--on" : ""}`}
              onClick={() => onDraft(swatch)}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-black/20" style={{ background: swatch }} />
              {swatch}
            </button>
          ))}
        </div>
      ) : null}
      {warning ? (
        <p className={`text-[11px] leading-relaxed ${warning.survives ? "text-gray-500" : "text-alert-amber"}`}>
          {warning.survives ? "" : "This will not survive paper. "}
          {warning.text}
        </p>
      ) : null}
    </div>
  );
}
