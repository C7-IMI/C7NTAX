/**
 * Importing a document — the screen where somebody brings one in.
 *
 * A Publisher newsletter is two columns, text boxes, a gradient band, an embedded font and vector art.
 * None of that survives a mail client, and this application has to send mail that **survives Outlook**.
 * So this is not a conversion screen and it does not pretend to be one: it is a **mapping and review
 * step**. Every element is reported with its own disposition — kept, reflowed, simplified, carried as an
 * image, moved, dropped — with a count taken from what the file actually contained, and the choice
 * offered per element where a person has one. What it cannot do is written in the interface rather than
 * in a footnote.
 *
 * ── Two real paths, one mapper ──────────────────────────────────────────────────────────────────────
 *
 * 1. **Paste from any application.** The paste is read as `text/html` and lands through the composition
 *    the rich-text composer already uses (`cleanPastedHtml` is the "Word-aware paste" precedent for
 *    this), which is also the shape the API's own sanitiser expects on the way out.
 * 2. **A `.docx`.** It is a zip; `word/document.xml` is read out of it, turned into the same HTML the
 *    paste path produces, and mapped by the same mapper. No dependency is added for this: the zip is
 *    read from its central directory and inflated with the browser's own `DecompressionStream`, which is
 *    why no `package.json` in this repository changed for this screen.
 *
 * Anything else — `.doc`, `.pub`, `.pptx`, `.rtf`, `.odt` — is **not accepted**, and instead of a control
 * that cannot work the screen says what to do instead and why. A `.docm`/`.pptm` is refused before
 * anything is read, because a macro project is not something to open in order to look at it.
 *
 * ── The conversion may happen on the API, and this screen says which ────────────────────────────────
 *
 * `POST /api/email/import` is the contract for a server-side converter. If it is not on the instance the
 * conversion happens in the browser and the screen says so. Either way what comes back is a list of
 * `EmailBlock`s — the vocabulary the editor composes — so a template made here is not an opaque
 * "imported document".
 *
 * ── Two designs, deliberately ───────────────────────────────────────────────────────────────────────
 *
 * The **modern** arrangement is a flow of decisions: a drop band, the mapping as rows whose disposition
 * is a chip, the options as segmented controls with the consequence written beside the one that is on,
 * and the resulting blocks as a rail.
 * The **classic** arrangement is a form: labelled fields in a grid (file, paste box, template name), a
 * `select` per option, a plain table of the mapping, and `Re-read` / `Save as a template` — read top to
 * bottom once, which is what a form is for.
 */
import { useCallback, useRef, useState, type ClipboardEvent } from "react";
import toast from "react-hot-toast";
import { ClipboardPaste, FileText, Loader2, Upload, X } from "lucide-react";
import api from "../../api";
import { useRedesign } from "../../hooks/useNavigationStyle";
import {
  CallNote, EMAIL_API, Tile, blockLabel, blockReads, blockSummary, describeFailure, unwrap,
  type CallFailure, type EmailBlock,
} from "./sendKit";
import {
  DEFAULT_MAPPING, docxToBlocks, pasteToBlocks,
  type Disposition, type ImportOutcome, type MappingChoice,
} from "./documentImport";

/** The formats this screen will not read, and what to do instead. A control that cannot work is not drawn. */
const OTHER_FORMATS: Array<{ ext: string; what: string; instead: string; why: string }> = [
  { ext: ".pub", what: "Microsoft Publisher", instead: "Export to PDF, or copy the text and paste it", why: "Publisher's own format has no text stream a browser can read; a PDF travels and paste takes the words" },
  { ext: ".pptx", what: "PowerPoint", instead: "Export to PDF, or copy each slide's text and paste it", why: "a slide is a canvas of positioned shapes, so reading it would produce blocks in the wrong order" },
  { ext: ".doc", what: "Word 97–2003", instead: "Save as .docx in Word, then drop it here", why: "the old binary format is not a zip and cannot be read in the browser" },
  { ext: ".rtf", what: "Rich Text Format", instead: "Copy the text and paste it", why: "the paste path already keeps the emphasis and the structure" },
  { ext: ".odt", what: "OpenDocument text", instead: "Save as .docx, or paste it", why: "the same content in a different zip layout, which is another reader to maintain for no gain" },
  { ext: ".docm", what: "A document carrying macros", instead: "Save it without macros first", why: "a macro project is discarded before anything is read, so the document is treated as read-only" },
];

/** What no import carries, the same for every file. Said here rather than discovered in a mail client. */
const NEVER_CARRIED = [
  "A two-column layout: mail that reflows is mail that survives Outlook, so the columns become one — deliberately, in reading order.",
  "A gradient, a texture or a drop shadow: the colour list is finite and Outlook's is smaller than a browser's.",
  "An embedded font: the name survives in a font-family, the file does not travel, and the client substitutes.",
  "Vector art as art: the logo becomes a PNG, so it is crisp at the width it was flattened at and soft at any other.",
  "Pagination, page numbers and cross-references: an email is one reflowing column.",
  "A mail merge's data, and the field codes behind it: the fields become plain text until they are pointed at this product's own fields.",
  "A round trip: once it is blocks it is not a Publisher file, and there is no export back to one.",
  "Anything a mail client would strip anyway — keeping it would be a lie told twice, so it is removed here.",
];

const DISPOSITION_CHIP: Record<Disposition, string> = {
  kept: "chip--good",
  reflowed: "chip",
  simplified: "chip--warn",
  image: "chip",
  moved: "chip",
  dropped: "chip--bad",
};

/** The options a person holds, each with the consequence beside it. */
const CHOICE_ROWS: Array<{
  key: keyof MappingChoice;
  name: string;
  options: Array<{ value: string; label: string; say: string }>;
}> = [
  {
    key: "headingStyle",
    name: "Headings",
    options: [
      { value: "heading", label: "Keep as heading", say: "They arrive as Heading blocks, whose own line the plain-text part keeps." },
      { value: "bold", label: "Bold paragraph", say: "Flattens them into the body, which is what a document with no real headings wants." },
    ],
  },
  {
    key: "tableMode",
    name: "Tables",
    options: [
      { value: "table", label: "Keep as table", say: "A table block. A table survives plain text as label-and-value lines." },
      { value: "reflow", label: "Reflow to one column", say: "Each row becomes one line, which is the right answer for a table used as a layout." },
    ],
  },
  {
    key: "pageFooter",
    name: "The page footer",
    options: [
      { value: "footer", label: "Keep the words", say: "Its words land as a paragraph, because an email has no pages for a footer to belong to." },
      { value: "drop", label: "Drop", say: "The footer goes with the page it was on." },
    ],
  },
  {
    key: "images",
    name: "Pictures",
    options: [
      { value: "embed", label: "Embed", say: "Carried in the message as cid parts: 2 MB each, 20 maximum, 8 MB in total." },
      { value: "drop", label: "Leave them out", say: "The words around them stay; the pictures do not travel." },
    ],
  },
  {
    key: "links",
    name: "Links",
    options: [
      { value: "safe", label: "Keep safe links", say: "Only https, mailto, tel and site-relative links; anything else is unwrapped to its words." },
      { value: "unwrap", label: "Unwrap all links", say: "The words stay and no address travels, which is what a document full of tracking URLs wants." },
    ],
  },
  {
    key: "footnotes",
    name: "Footnotes",
    options: [
      { value: "move", label: "Move into the body", say: "Bracketed text at the point they were referenced, because a note with no page has no home." },
      { value: "drop", label: "Drop", say: "The reference goes with it, so nothing points at a note that is not there." },
    ],
  },
];

/** The source of an import, kept so an option can be changed without asking for the document again. */
interface ImportSource {
  label: string;
  html?: string;
  file?: File;
}

function readAsBase64(file: File): Promise<{ contentBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve({ contentBase64: result.slice(result.indexOf(",") + 1), mimeType: file.type || "application/octet-stream" });
    };
    reader.readAsDataURL(file);
  });
}

export interface EmailImportProps {
  /** Where a template goes when the host has a store for one. Without it, the blocks are handed over. */
  onSave?: (name: string, blocks: EmailBlock[]) => Promise<void> | void;
  /** Hand the blocks to the composer instead of saving them. */
  onEditInComposer?: (blocks: EmailBlock[]) => void;
  className?: string;
}

export function EmailImport({ onSave, onEditInComposer, className = "" }: EmailImportProps) {
  const redesign = useRedesign();
  const [choices, setChoices] = useState<MappingChoice>(DEFAULT_MAPPING);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CallFailure | null>(null);
  const [localReason, setLocalReason] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; reason: string } | null>(null);
  const [name, setName] = useState("");
  const pasteRef = useRef<HTMLDivElement | null>(null);

  /**
   * Read the document. The API's converter when it answers, the browser's when it is not there — and the
   * screen says which one ran rather than leaving the person to guess where their document went.
   */
  const convert = useCallback(async (input: ImportSource, withChoices: MappingChoice) => {
    setBusy(true);
    setFailure(null);
    setLocalReason(null);
    setOutcome(null);
    try {
      try {
        const body = input.file
          ? { filename: input.file.name, ...(await readAsBase64(input.file)) }
          : { html: input.html ?? "" };
        const response = await api.post(EMAIL_API.import, body);
        const read = unwrap<ImportOutcome>(response.data);
        if (read && Array.isArray(read.blocks)) {
          setOutcome({ blocks: read.blocks, rows: read.rows ?? [], warnings: read.warnings ?? [], footerText: read.footerText ?? "" });
          return;
        }
        setFailure({ endpoint: EMAIL_API.import, reason: "the converter answered without any blocks in it", absent: false });
        return;
      } catch (error) {
        const atApi = describeFailure(EMAIL_API.import, error);
        if (!atApi.absent) { setFailure(atApi); return; }
        setLocalReason(atApi.reason);
      }
      const local = input.file
        ? await docxToBlocks(input.file, withChoices)
        : pasteToBlocks(input.html ?? "", withChoices);
      setOutcome(local);
    } catch (error) {
      setRefused({ name: input.label, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  const choose = (key: keyof MappingChoice, value: string) => {
    const next = { ...choices, [key]: value } as MappingChoice;
    setChoices(next);
    // Re-running the mapping is what makes an option real rather than decorative.
    if (source) void convert(source, next);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (!html && !text) return;
    const paste: ImportSource = {
      label: "Pasted from another application",
      html: html || `<p>${text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).join("</p><p>")}</p>`,
    };
    setSource(paste);
    setRefused(null);
    setName((current) => current || "Imported document");
    void convert(paste, choices);
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setSource(null);
    setOutcome(null);
    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (extension !== ".docx") {
      const guidance = OTHER_FORMATS.find((entry) => entry.ext === extension);
      setRefused({
        name: file.name,
        reason: guidance
          ? `${guidance.what}: ${guidance.instead} — ${guidance.why}.`
          : `${extension} is not a format this screen reads. Copy the text and paste it, or export the document as a PDF and attach that.`,
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setRefused({ name: file.name, reason: `${file.name} is ${Math.round(file.size / (1024 * 1024))} MB — over the 20 MB this screen will read whole` });
      return;
    }
    setRefused(null);
    const picked: ImportSource = { label: file.name, file };
    setSource(picked);
    setName((current) => current || file.name.replace(/\.docx$/i, ""));
    void convert(picked, choices);
  };

  const result = outcome?.blocks ?? [];
  const rows = outcome?.rows ?? [];
  const carried = rows.filter((row) => row.disposition !== "dropped");

  const mappingTable = (title: string) => (
    <>
      <h3 className={redesign ? "text-[11px] uppercase tracking-wider text-gray-500" : "text-sm font-semibold text-white"}>{title}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-border text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="py-2 pr-3">What is in the file</th>
              <th className="py-2 pr-3">What it becomes</th>
              <th className="py-2 pr-3">How many</th>
              <th className="py-2">Disposition</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.element} className="border-b border-surface-border/50 align-top">
                <td className="py-2 pr-3 text-gray-300">{row.element}</td>
                <td className="py-2 pr-3 text-gray-400">{row.becomes}</td>
                <td className="py-2 pr-3 tabular-nums text-gray-300">{row.count}</td>
                <td className="py-2"><span className={`chip ${DISPOSITION_CHIP[row.disposition]}`}>{row.disposition}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="py-3 text-gray-500">Nothing has been read yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        The file's own elements, counted from what it actually contained rather than drawn as a standing list
        of twenty. What no import carries is below, and it is the same for every file.
      </p>
    </>
  );

  const blocksList = (
    <>
      <div className="space-y-1.5">
        {result.map((block, index) => (
          <div key={index} className="flex items-start gap-2.5 rounded-lg border border-surface-border p-2.5">
            <Tile tone="neutral"><FileText size={13} /></Tile>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wider text-gray-500">{blockLabel(block)}</p>
              <p className="mt-0.5 break-words text-xs text-gray-300">{blockSummary(block)}</p>
              <p className="mt-0.5 text-[11px] text-gray-600">{blockReads(block)}</p>
            </div>
          </div>
        ))}
        {result.length === 0 && <p className="text-xs text-gray-500">The review has not produced any blocks yet.</p>}
      </div>
    </>
  );

  const actions = (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <label className="mb-1 block text-xs text-gray-500" htmlFor="import-name">Template name</label>
        <input id="import-name" className="input-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="September at Globex" />
      </div>
      <button
        type="button"
        className="btn-primary text-sm"
        disabled={!result.length || busy}
        onClick={async () => {
          if (!onSave) {
            toast.error("No template store is mounted here — copy the blocks instead");
            return;
          }
          await onSave(name || "Imported document", result);
          toast.success("Saved as a template");
        }}
      >
        Save as a template
      </button>
      <button
        type="button"
        className="btn-secondary text-sm"
        disabled={!result.length}
        onClick={() => {
          if (onEditInComposer) { onEditInComposer(result); return; }
          toast.error("No composer is mounted here — copy the blocks instead");
        }}
      >
        Edit it in the composer
      </button>
      <button
        type="button"
        className="btn-secondary text-sm"
        disabled={!result.length}
        onClick={() => {
          void navigator.clipboard?.writeText(JSON.stringify(result, null, 2));
          toast.success("The blocks are on the clipboard as JSON");
        }}
      >
        Copy the blocks
      </button>
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => { setSource(null); setOutcome(null); setRefused(null); setName(""); setLocalReason(null); }}
      >
        Start over
      </button>
    </div>
  );

  const conversionNote = localReason && (
    <p className="text-[11px] text-gray-400">
      Converted in this browser — <span className="font-mono">{EMAIL_API.import}</span> answered “{localReason}”, so
      the document did not leave this machine.
    </p>
  );

  const refusedNote = refused && (
    <div className="rounded-lg border border-surface-border bg-surface-light p-3">
      <p className="flex items-center gap-2 text-xs text-alert-amber"><X size={14} /> {refused.name}</p>
      <p className="mt-1 text-xs text-gray-400">{refused.reason}</p>
    </div>
  );

  // ══ Modern: a flow of decisions ═══════════════════════════════════════════
  if (redesign) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div
          className="rounded-xl border border-dashed border-surface-border bg-surface-light p-4"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); onFiles(event.dataTransfer.files); }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Tile tone="neutral"><Upload size={15} /></Tile>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">Drop a .docx here, or paste a document</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                A paste arrives as HTML and is mapped the same way; a .docx is read out of its own zip in the
                browser. Nothing leaves this machine unless the instance has a converter of its own.
              </p>
            </div>
            <label className="btn-secondary cursor-pointer text-xs">
              Choose a .docx
              <input type="file" accept=".docx" className="hidden" onChange={(event) => onFiles(event.target.files)} />
            </label>
          </div>
          <div
            ref={pasteRef}
            onPaste={onPaste}
            tabIndex={0}
            className="mt-3 rounded-lg border border-surface-border bg-surface p-3 text-xs text-gray-400 focus:outline-none focus:ring-1 focus:ring-cyber-500"
          >
            <p className="flex items-center gap-2 text-gray-500">
              <ClipboardPaste size={13} /> Click here and paste — the clipboard's own formatting is what gets mapped.
            </p>
          </div>
          {source && <p className="mt-2 text-[11px] text-gray-400">Reading: <span className="text-gray-300">{source.label}</span></p>}
        </div>

        {busy && <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Reading the document…</p>}
        {failure && <CallNote failure={failure} what="The converter answered, and nothing was read." />}
        {refusedNote}
        {conversionNote}

        {outcome && (
          <>
            <div className="card">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip chip--on">The mapping</span>
                <span className="text-[11px] text-gray-500">
                  {carried.length} element{carried.length === 1 ? "" : "s"} carried, {rows.length - carried.length} dropped
                </span>
              </div>
              <div className="mt-3">{mappingTable("")}</div>
              {outcome.warnings.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {outcome.warnings.map((warning) => <li key={warning} className="text-[11px] text-alert-amber">▲ {warning}</li>)}
                </ul>
              )}
            </div>

            <div className="card">
              <p className="text-[11px] uppercase tracking-wider text-gray-500">Your choice, per element</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CHOICE_ROWS.map((row) => (
                  <div key={row.key}>
                    <p className="text-xs text-white">{row.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.options.map((option) => {
                        const on = choices[row.key] === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={on}
                            className={`chip ${on ? "chip--on" : ""}`}
                            onClick={() => choose(row.key, option.value)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {row.options.find((option) => option.value === choices[row.key])?.say}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <p className="text-[11px] uppercase tracking-wider text-gray-500">What the review leaves you with</p>
              <p className="mt-1 text-[11px] text-gray-500">
                A template made of the same blocks the editor composes and the send sheet shows. Nothing about it
                is an opaque “imported document”.
              </p>
              <div className="mt-3">{blocksList}</div>
              {actions}
            </div>
          </>
        )}

        <div className="card">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">What it admits it cannot do</p>
          <ul className="mt-2 space-y-1.5">
            {NEVER_CARRIED.map((line) => <li key={line} className="text-[11px] leading-relaxed text-gray-400">• {line}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-gray-400">
            <span className="text-gray-300">The mapping is a proposal, not a guarantee.</span> A person who expects
            their Publisher file to arrive intact will be disappointed by every importer ever written; a person who
            is shown the mapping first will fix it in a minute.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-border text-left text-[10px] uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3">Not read here</th>
                <th className="py-2 pr-3">What it is</th>
                <th className="py-2 pr-3">Do this instead</th>
                <th className="py-2">Why</th>
              </tr>
            </thead>
            <tbody>
              {OTHER_FORMATS.map((entry) => (
                <tr key={entry.ext} className="border-b border-surface-border/50 align-top">
                  <td className="py-2 pr-3 font-mono text-gray-300">{entry.ext}</td>
                  <td className="py-2 pr-3 text-gray-400">{entry.what}</td>
                  <td className="py-2 pr-3 text-gray-300">{entry.instead}</td>
                  <td className="py-2 text-gray-500">{entry.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ══ Classic: a form ══════════════════════════════════════════════════════
  return (
    <div className={`space-y-4 ${className}`}>
      <form className="card" onSubmit={(event) => { event.preventDefault(); if (source) void convert(source, choices); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-gray-500" htmlFor="import-file">Document (.docx)</label>
            <input id="import-file" type="file" accept=".docx" className="input-field" onChange={(event) => onFiles(event.target.files)} />
            <p className="mt-1 text-[11px] text-gray-500">
              Read out of its zip in the browser. .pub, .pptx, .doc, .rtf, .odt and .docm are not read here — the
              table at the bottom says what to do with each instead, rather than offering a control that cannot work.
            </p>
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs text-gray-500">Or paste from any application</span>
            <div ref={pasteRef} onPaste={onPaste} tabIndex={0} className="input-field text-xs text-gray-400">
              Click here and paste.
            </div>
            <p className="mt-1 text-[11px] text-gray-500">The clipboard's own formatting is what gets mapped.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-gray-500" htmlFor="import-name">Template name</label>
            <input id="import-name" className="input-field" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          {CHOICE_ROWS.map((row) => (
            <div key={row.key}>
              <label className="mb-1 block text-xs text-gray-500" htmlFor={`choice-${row.key}`}>{row.name}</label>
              <select id={`choice-${row.key}`} className="input-field" value={choices[row.key]} onChange={(event) => choose(row.key, event.target.value)}>
                {row.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-500">{row.options.find((option) => option.value === choices[row.key])?.say}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-secondary text-sm" disabled={busy || !source}>Re-read the document</button>
          {busy && <span className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" /> Reading…</span>}
          {source && <span className="text-[11px] text-gray-500">Reading: <span className="text-gray-300">{source.label}</span></span>}
        </div>
      </form>

      {failure && <CallNote failure={failure} what="The converter answered, and nothing was read." />}
      {refusedNote}
      {conversionNote}

      {outcome && (
        <>
          <div className="card">
            {mappingTable("The mapping")}
            {outcome.warnings.length > 0 && (
              <ul className="mt-3 space-y-1">
                {outcome.warnings.map((warning) => <li key={warning} className="text-[11px] text-alert-amber">▲ {warning}</li>)}
              </ul>
            )}
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-white">What the review leaves you with</h3>
            <div className="mt-3">{blocksList}</div>
            {actions}
          </div>
        </>
      )}

      <div className="card">
        <h3 className="text-sm font-semibold text-white">What it admits it cannot do</h3>
        <ul className="mt-2 space-y-1.5">
          {NEVER_CARRIED.map((line) => <li key={line} className="text-[11px] leading-relaxed text-gray-400">• {line}</li>)}
        </ul>
      </div>

      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-white">Formats this screen does not read</h3>
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="border-b border-surface-border text-left text-[10px] uppercase tracking-wider text-gray-500">
              <th className="py-2 pr-3">Format</th>
              <th className="py-2 pr-3">What it is</th>
              <th className="py-2 pr-3">Do this instead</th>
              <th className="py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {OTHER_FORMATS.map((entry) => (
              <tr key={entry.ext} className="border-b border-surface-border/50 align-top">
                <td className="py-2 pr-3 font-mono text-gray-300">{entry.ext}</td>
                <td className="py-2 pr-3 text-gray-400">{entry.what}</td>
                <td className="py-2 pr-3 text-gray-300">{entry.instead}</td>
                <td className="py-2 text-gray-500">{entry.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-gray-400">
          <span className="text-gray-300">The mapping is a proposal, not a guarantee.</span> A person who expects
          their Publisher file to arrive intact will be disappointed by every importer ever written; a person who is
          shown the mapping first will fix it in a minute.
        </p>
      </div>
    </div>
  );
}

export default EmailImport;
