/**
 * The preview — one renderer, two widths, and the other half of the message beside it.
 *
 * **The HTML comes from `POST /api/email/preview` and from nowhere else.** There is no second renderer
 * in this file, on purpose: the whole reason the preview exists is that the message a person approves
 * is literally the message that goes out, and the way that stops being true is a client-side renderer
 * written to fill a gap when the endpoint is missing. So when the call fails this panel says which read
 * failed and draws **nothing** in either frame, rather than drawing a plausible message that no
 * send path would produce.
 *
 * **The two frames are two arrangements, not one squeezed.** Each frame is an iframe whose viewport
 * *is* the width being asked about — 520 px, the width the message is mailed at, and 340 px, the width
 * it is most often opened at — so the mobile frame is a different arrangement by computed style rather
 * than by eye: inside it the fact pairs and the invoice lines stack to one column, the call to action
 * becomes a full-width target because a thumb is not a cursor, and the body padding comes in so the
 * blocks keep a readable measure. A phone frame holding the 520 px layout would answer no question
 * anybody has.
 *
 * Two interfaces, two arrangements: the modern screen shows both widths at once, because the question
 * being asked is *"does it still read on a phone"* and a select answers it one click at a time. The
 * classic screen is a Record select and a Preview button opening a dialog with a Width select — the
 * classic way to ask the same question.
 */
import { useEffect, useState } from "react";
import { Eye, Mail, Paperclip, Smartphone } from "lucide-react";
import type { EmailBlock } from "@C7NTAX/shared";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { Band, MonoTm, StateChip, UnavailablePanel, plural } from "./emailChrome";
import { EMAIL_RECORDS } from "./emailRecords";
import { compareTextFacts } from "./emailBlocks";
import type { PreviewState } from "./emailStudioApi";

/**
 * The email's own viewport, plus the phone refinements the mockup draws as `.mail--mobile`.
 *
 * A media query rather than a transform, because the iframe's width *is* the phone's width — so the
 * rules cannot reach the 520 px frame, and what the reader sees at each width is what the layout
 * genuinely does at that width.
 */
function frameDocument(html: string): string {
  /*
   * The frame is a **mail document**, so it must not follow this application's theme — the same reason
   * `.print-letterhead` uses literal colours. It gets there without a colour literal: `color-scheme: light`
   * makes the `canvas` and `canvastext` system colours resolve to the white page and black text a mail
   * client shows, whatever theme, palette or density the person reading this screen has chosen.
   */
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<meta name=\"color-scheme\" content=\"light\">",
    "<style>",
    "html{color-scheme:light;}",
    "html,body{margin:0;padding:0;background:canvas;color:canvastext;}",
    "body{font:14px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:8px;}",
    "@media (max-width:420px){",
    "  body{padding:6px 16px;font-size:15px;}",
    "  table{width:100% !important;border-collapse:collapse;}",
    "  table tr{display:block !important;}",
    "  table td,table th{display:block !important;width:auto !important;text-align:left !important;}",
    "  dl{display:block !important;}",
    "  dl dt,dl dd{display:block !important;width:auto !important;margin:0 !important;}",
    "  dl dt{margin-top:6px !important;}",
    "  a{display:block !important;width:100% !important;box-sizing:border-box;text-align:center !important;}",
    "}",
    "</style></head><body>",
    html,
    "</body></html>",
  ].join("\n");
}

function Frame({
  title,
  width,
  html,
  phone,
  placeholder,
}: {
  title: string;
  width: number;
  /** The API's own HTML. Absent when the renderer did not answer. */
  html: string | null;
  phone?: boolean;
  /** Why there is no message in the frame, when there is not. */
  placeholder?: string;
}) {
  return (
    <div className="card !p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2">
        {phone ? <Smartphone size={14} className="text-gray-400" /> : <Eye size={14} className="text-cyber-400" />}
        <span className="text-xs font-semibold text-white">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-gray-500">{width} px</span>
      </div>
      <div className="overflow-x-auto p-3">
        {/*
          * `allow-same-origin` and deliberately **not** `allow-scripts`: the message's own scripts can
          * never run in here, and the frame's document stays readable so the two widths can be checked by
          * computed style — which is the only way to check that the phone frame is an arrangement rather
          * than a narrower copy of the desktop one.
          */}
        <iframe
          title={`${title} — ${html ? "rendered by the API" : "a width frame, without the message"}`}
          srcDoc={frameDocument(html ?? layoutSample(width))}
          sandbox="allow-same-origin"
          data-frame-width={width}
          data-frame-content={html ? "message" : "layout-sample"}
          style={{ width, height: 420 }}
          className="block max-w-full rounded-lg border border-surface-border"
        />
      </div>
      <p className="border-t border-surface-border px-3.5 py-2 text-[11px] leading-relaxed text-gray-500">
        {placeholder
          ? placeholder
          : phone
            ? "Reflowed rather than squeezed: the fact pairs and any table columns stack to one column, the call to action fills the width, and the padding comes in."
            : "The width the message is mailed at. The API's own HTML, in a frame this wide."}
      </p>
    </div>
  );
}

/**
 * What is inside a frame when the renderer has not answered: **a layout sample, never a message.**
 *
 * Drawing the widths matters — they are the question the preview exists to ask, and the phone frame is
 * an arrangement rather than a narrower copy of the desktop one. Drawing the *message* does not: that
 * would be a second renderer, and the preview would stop being the thing that goes out. So the sample is
 * a table and a fact list, which is what actually has to reflow, and the frame says what it is.
 */
function layoutSample(width: number): string {
  /*
   * No colour literal anywhere in it: the sample is drawn with `currentColor`, `opacity` and the two
   * system colour keywords the frame already sets, so the guard that refuses a hex outside the print
   * document and the user's own colours is satisfied — and there is nothing here to read as copy.
   */
  const rule = 'border-bottom:1px solid';
  const cell = "padding:4px 12px 4px 0;font-size:12px";
  return [
    '<div style="max-width:480px">',
    '<h2 style="margin:0 0 10px;font-size:17px">The message is not drawn here</h2>',
    '<p style="opacity:.75;margin:0 0 14px;font-size:13px">',
    `This is a ${width} px frame with a layout sample in it, not the message. The message comes from the one`,
    " renderer and it did not answer — so what is inside is what has to reflow, and nothing that reads as copy.",
    "</p>",
    "<table><thead><tr>",
    `<th style="${cell};${rule};text-align:left">Line</th>`,
    `<th style="${cell};${rule};text-align:left">Amount</th>`,
    "</tr></thead><tbody>",
    `<tr><td style="${cell};${rule}">A managed-services line</td><td style="${cell};${rule}">$0.00</td></tr>`,
    `<tr><td style="${cell};${rule}">Tax</td><td style="${cell};${rule}">$0.00</td></tr>`,
    "</tbody></table>",
    '<dl style="margin:14px 0 0;font-size:12px">',
    '<dt style="opacity:.7;font-size:11px">Status</dt><dd style="margin:0 0 6px">one column on a phone</dd>',
    '<dt style="opacity:.7;font-size:11px">Priority</dt><dd style="margin:0 0 6px">label above value</dd>',
    "</dl>",
    '<p style="margin:16px 0 0"><span style="display:inline-block;border:1px solid;border-radius:6px;padding:10px 18px;font-size:13px">a full-width target on a phone</span></p>',
    "</div>",
  ].join("\n");
}

function TextPart({ text, derived, html }: { text: string; derived: string; html: string }) {
  const overridden = text !== derived;
  const difference = overridden ? compareTextFacts(html, text) : { missingFromText: [], extraInText: [] };
  const disagrees = difference.missingFromText.length > 0 || difference.extraInText.length > 0;
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Plain text — the alternative part</h3>
        {overridden ? <StateChip tone="warn">overridden</StateChip> : <StateChip tone="good">derived from the blocks</StateChip>}
        <StateChip tone="neutral">{plural(text.split("\n").filter(Boolean).length, "line")}</StateChip>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
        The same message in words, sent alongside the HTML so a client that strips HTML still gets something
        readable. A URL appears in full here — never hidden behind link text.
      </p>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-surface-light p-3 font-mono text-[11.5px] leading-relaxed text-gray-300">
        {text}
      </pre>
      {disagrees && (
        <div className="mt-2">
          <Band tone="warn" title="The two parts do not carry the same facts">
            {difference.missingFromText.length > 0 && (
              <p>In the HTML and not in the text: <code className="font-mono text-gray-300">{difference.missingFromText.join(", ")}</code>.</p>
            )}
            {difference.extraInText.length > 0 && (
              <p>In the text and not in the HTML: <code className="font-mono text-gray-300">{difference.extraInText.join(", ")}</code>.</p>
            )}
          </Band>
        </div>
      )}
    </section>
  );
}

function Attachments({ files, allowed }: { files: { filename: string; contentType?: string; note?: string }[]; allowed: string | null }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Attachments this send would carry</h3>
        <StateChip tone={files.length ? "neutral" : "good"}>{plural(files.length, "file")}</StateChip>
      </div>
      {files.length === 0 ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
          None for this message. {allowed ? <>What it <em>may</em> carry: {allowed}.</> : null}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {files.map((file) => (
            <li key={file.filename} className="flex items-start gap-2 text-xs text-gray-300">
              <Paperclip size={13} className="mt-0.5 shrink-0 text-gray-500" />
              <span className="min-w-0">
                <code className="font-mono text-[11.5px] text-gray-200">{file.filename}</code>
                {file.contentType ? <span className="ml-2 text-[11px] text-gray-500">{file.contentType}</span> : null}
                {file.note ? <span className="mt-0.5 block text-[11px] text-gray-500">{file.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Inline images leave as <MonoTm>cid:</MonoTm> parts. The mail path refuses anything over 10 MB of HTML or
        8 MB of inline images; nothing in the product logs a send, handles a bounce or honours an opt-out yet, and
        this panel does not imply otherwise.
      </p>
    </section>
  );
}

export interface EmailPreviewProps {
  messageKey: string;
  subject: string;
  blocks: EmailBlock[];
  /** The derived text part, for use when the renderer has not answered. */
  derivedText: string;
  recordId: string | null;
  onRecord: (id: string | null) => void;
  preview: PreviewState;
  onRender: () => void;
  attachmentsAllowed: string | null;
  canManage: boolean;
  testState: { status: "idle" | "sending" | "ok" | "unavailable"; message: string | null };
  onTest: (to: string) => void;
  testAddress: string;
  onTestAddress: (value: string) => void;
}

export function EmailPreviewPanel(props: EmailPreviewProps) {
  const redesign = useRedesign();
  const { preview } = props;
  const answer = preview.status === "ok" ? preview.data : null;

  if (redesign) {
    return (
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-white">Record</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {EMAIL_RECORDS.map((record) => (
              <button
                key={record.id}
                type="button"
                onClick={() => props.onRecord(record.id)}
                aria-pressed={props.recordId === record.id}
                className={`chip ${props.recordId === record.id ? "chip--on" : ""}`}
                title={record.foot}
              >
                {record.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => props.onRecord(null)}
              aria-pressed={props.recordId === null}
              className={`chip ${props.recordId === null ? "chip--on" : ""}`}
            >
              No record — the fields&apos; own samples
            </button>
          </div>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <StateChip tone="on">{props.messageKey}</StateChip>
            <button type="button" className="btn-secondary text-xs" onClick={props.onRender}>
              Render again
            </button>
          </span>
        </div>

        <p className="text-[11.5px] leading-relaxed text-gray-500">
          {props.recordId
            ? `Resolved against ${props.recordId}: the figures and names in the frame are the record's, not samples.`
            : "No record chosen, so the fields show the samples the vocabulary carries. A sample is not a record — nothing here is rendered into a real message."}
        </p>

        {preview.status === "loading" && <p className="text-xs text-gray-500">Asking the renderer…</p>}

        {preview.status === "unavailable" && (
          <UnavailablePanel
            message={preview.message ?? "The preview could not be rendered."}
            onRetry={props.onRender}
            what={
              <>
                Nothing is drawn in the frames, and that is deliberate: the preview has to come from{" "}
                <MonoTm>POST /api/email/preview</MonoTm>, because there is one renderer and the message a person
                approves has to be literally the message that goes out. A renderer written here to fill the gap would
                be a second one, and a second renderer is how the preview and the send come to disagree.
              </>
            }
          />
        )}

        <div className="grid gap-3.5 xl:grid-cols-2">
          <Frame
            title="Desktop — the width it is mailed at"
            width={520}
            html={answer?.html ?? null}
            placeholder={
              answer
                ? undefined
                : "The renderer did not answer, so this frame holds a layout sample rather than the message. The width is real; the words are not."
            }
          />
          <Frame
            title="Mobile — the reflowing arrangement"
            width={340}
            html={answer?.html ?? null}
            phone
            placeholder={
              answer
                ? undefined
                : "A different arrangement, not a narrower one: inside a 340 px viewport the table columns and the fact pairs stack to one column and the call to action fills the width. The sample shows that; the message is not drawn."
            }
          />
        </div>

        {answer && answer.warnings.length > 0 && (
          <Band tone="warn" title="The renderer raised these">
            <ul className="space-y-0.5">
              {answer.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          </Band>
        )}

        <div className="grid gap-3.5 lg:grid-cols-2">
          <TextPart
            text={answer?.text ?? props.derivedText}
            derived={answer?.derivedText ?? props.derivedText}
            html={answer?.html ?? ""}
          />
          <Attachments files={answer?.attachments ?? []} allowed={props.attachmentsAllowed} />
        </div>

        <TestSend {...props} />
      </div>
    );
  }

  return <ClassicPreview {...props} />;
}

function TestSend(props: EmailPreviewProps) {
  const { testState } = props;
  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={14} className="text-cyber-400" />
        <h3 className="text-sm font-semibold text-white">Send a test</h3>
        <StateChip tone="neutral">one press, one address</StateChip>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
        Sends this exact render, with the fields already resolved, to one address — the only way to see what a
        real mail client does to it, because a canvas is a browser and a browser is not Outlook.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input-field max-w-xs"
          value={props.testAddress}
          onChange={(event) => props.onTestAddress(event.target.value)}
          aria-label="Test address"
          disabled={!props.canManage}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={!props.canManage || testState.status === "sending" || !props.testAddress}
          onClick={() => props.onTest(props.testAddress)}
        >
          {testState.status === "sending" ? "Sending…" : "Send a test"}
        </button>
        {!props.canManage ? <span className="text-[11px] text-gray-500">Needs email:manage.</span> : null}
      </div>
      {testState.message ? (
        <p
          className={`mt-2 rounded-lg border px-3 py-2 text-[11.5px] ${
            testState.status === "ok"
              ? "border-alert-green/30 bg-alert-green/10 text-gray-300"
              : "border-alert-amber/40 bg-alert-amber/10 text-gray-300"
          }`}
        >
          {testState.message}
        </p>
      ) : null}
      <Band tone="warn" className="mt-2" title="There is no mail sandbox">
        A test send goes to a real mailbox through the same SMTP connection the customers&apos; mail uses. Nothing
        in the product records it yet — the log screen draws the delivery log as a proposal for the same reason:
        there is nothing to read.
      </Band>
    </section>
  );
}

function ClassicPreview(props: EmailPreviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const answer = props.preview.status === "ok" ? props.preview.data : null;

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  return (
    <div className="space-y-4">
      <form className="card space-y-3" onSubmit={(event) => { event.preventDefault(); props.onRender(); }}>
        <h3 className="text-lg font-semibold text-white">Preview</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-gray-400">
            Record
            <select
              className="input-field mt-1 w-full"
              value={props.recordId ?? ""}
              onChange={(event) => props.onRecord(event.target.value || null)}
            >
              <option value="">No record — the fields&apos; own samples</option>
              {EMAIL_RECORDS.map((record) => (
                <option key={record.id} value={record.id}>{record.label} — {record.foot}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-400">
            Width for the dialog
            <div className="mt-1 flex items-center gap-3">
              {(["desktop", "mobile"] as const).map((option) => (
                <label key={option} className="flex items-center gap-1.5 text-gray-300">
                  <input type="radio" name="preview-width" checked={width === option} onChange={() => setWidth(option)} />
                  {option === "desktop" ? "Desktop (520 px)" : "Mobile (340 px)"}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={props.preview.status === "loading"}>
            {props.preview.status === "loading" ? "Rendering…" : "Preview"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setDialogOpen(true)} disabled={!answer}>
            Open the rendered message
          </button>
          <span className="text-xs text-gray-500">
            {answer ? "The API's own HTML, rendered when you pressed Preview." : "Nothing rendered yet."}
          </span>
        </div>

        {props.preview.status === "unavailable" && (
          <UnavailablePanel
            message={props.preview.message ?? "The preview could not be rendered."}
            onRetry={props.onRender}
            what={
              <>
                The message is drawn by <MonoTm>POST /api/email/preview</MonoTm> and by nothing else, so a failed
                render leaves the dialog empty rather than showing words this product would not send.
              </>
            }
          />
        )}
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <TextPart
          text={answer?.text ?? props.derivedText}
          derived={answer?.derivedText ?? props.derivedText}
          html={answer?.html ?? ""}
        />
        <Attachments files={answer?.attachments ?? []} allowed={props.attachmentsAllowed} />
      </div>

      <TestSend {...props} />

      {dialogOpen && answer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Rendered message">
          <div className="card max-h-[90vh] w-full max-w-3xl overflow-auto !p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
              <h3 className="text-sm font-semibold text-white">
                {props.messageKey} — {width === "desktop" ? "desktop, 520 px" : "mobile, 340 px"}
              </h3>
              <button type="button" className="btn-secondary ml-auto text-xs" onClick={() => setDialogOpen(false)}>
                Close
              </button>
            </div>
            <div className="flex justify-center overflow-x-auto p-4">
              <iframe
                title="Rendered message"
                srcDoc={frameDocument(answer.html)}
                sandbox="allow-same-origin"
                style={{ width: width === "desktop" ? 520 : 340, height: 600 }}
                className="block max-w-full rounded-lg border border-surface-border"
              />
            </div>
            <p className="border-t border-surface-border px-4 py-2 text-[11px] text-gray-500">
              {width === "desktop"
                ? "The width the message is mailed at."
                : "Reflowed rather than squeezed: columns stack, the call to action fills the width, the padding comes in."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
