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
 * **Two widths, and neither is a setting.** A frame is a *viewport*: 600 px is the measure the message's
 * body is drawn at and 375 px is an iPhone SE/13 mini class screen, so the mobile frame is a different
 * arrangement by computed style rather than by eye. The frame component and the two honest sentences
 * about it live in `emailMailFrame.tsx`, shared with the send sheet and the simulation window, because
 * three surfaces looking at one message must not describe the widths three ways.
 *
 * **The frames follow their content.** Their height is measured from the frame's own document rather
 * than fixed, so a short message is a short frame. A fixed height is what leaves a few hundred pixels of
 * nothing under the message, which reads as a panel nobody finished.
 *
 * **Simulate** opens the same message at both widths in a window of its own, where there is room for the
 * two devices side by side — `EmailSimulation.tsx`. Same frames, same renderer, same words; it differs
 * only in having somewhere to put them.
 *
 * Two interfaces, two arrangements: the modern screen draws both widths at once, because the question
 * being asked is *"does it still read on a phone"* and showing both answers it in one look. The classic
 * screen is a Record select and a Preview button opening a dialog with a Width select, with Simulate
 * beside them — the classic way to ask the same question, one width at a time.
 */
import { useEffect, useState } from "react";
import { Mail, Monitor, Paperclip, Smartphone } from "lucide-react";
import type { EmailBlock } from "@C7NTAX/shared";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { Band, MonoTm, StateChip, UnavailablePanel, plural } from "./emailChrome";
import { EMAIL_RECORDS, resolveFields } from "./emailRecords";
import { compareTextFacts } from "./emailBlocks";
import type { PreviewState } from "./emailStudioApi";
import { MAIL_DEVICES, MailFrame, type MailDevice } from "./emailMailFrame";
import { EmailSimulation, type SimulationMessage } from "./EmailSimulation";

/**
 * What a frame says when the renderer did not answer. One sentence for both widths, because the fact is
 * the same fact: the width is real and the words are not.
 */
const NO_MESSAGE =
  "The renderer did not answer, so this frame holds a layout sample rather than the message. The width is real; the words are not.";

/**
 * One device's card: the honest label, the viewport itself, and the sentence about what it is for.
 *
 * The head says `600 px — desktop`, which is the **viewport**; the note says so in words. The two used to
 * describe the number as "the width the message is mailed at", which is a claim about the mail path that
 * nothing in the product makes. The card hugs its frame (`w-fit`) so that a row of two devices reads as
 * two devices rather than as two columns stretched to the same width — and so the phone frame cannot be
 * silently narrowed, which is the one thing that would stop it being a phone.
 */
function FrameCard({
  device,
  html,
  placeholder,
}: {
  device: MailDevice;
  html: string | null;
  /** Why there is a layout sample in the frame instead of the message, when there is. */
  placeholder?: string;
}) {
  return (
    <div className="card w-fit max-w-full !p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2">
        {device === "mobile" ? (
          <Smartphone size={14} className="text-gray-400" />
        ) : (
          <Monitor size={14} className="text-cyber-400" />
        )}
        <span className="text-xs font-semibold text-white">{MAIL_DEVICES[device].label}</span>
      </div>
      <div className="overflow-x-auto p-3">
        <MailFrame device={device} html={html} title={MAIL_DEVICES[device].label} className="w-fit" />
      </div>
      <p className="max-w-[560px] border-t border-surface-border px-3.5 py-2 text-[11px] leading-relaxed text-gray-500">
        {placeholder ?? MAIL_DEVICES[device].note}
      </p>
    </div>
  );
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
  /** The message's own name from the catalogue, so a simulation is identifiable in a screenshot. */
  messageName?: string | null;
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

/**
 * The panel's state as the simulation wants it.
 *
 * Written once, so the Simulate control in either arrangement opens the same window — and so the window
 * cannot claim a fact the panel does not: the key, the record, the resolved subject and the renderer's
 * own two parts all come from here.
 */
function simulationOf(props: EmailPreviewProps): SimulationMessage {
  const answer = props.preview.status === "ok" ? props.preview.data : null;
  return {
    messageKey: props.messageKey,
    messageName: props.messageName ?? null,
    recordId: props.recordId,
    /*
     * The renderer's own resolved subject when it answered, and the draft's subject with the fields
     * resolved here when it did not — the same fallback the derived text part already uses in that state,
     * and never the raw `{{ticket.number}}` tokens in a window somebody is about to screenshot.
     */
    subject: answer?.subject || resolveFields(props.subject, props.recordId) || null,
    html: answer?.html ?? null,
    text: answer?.text ?? null,
    derivedText: answer?.derivedText ?? props.derivedText,
    warnings: answer?.warnings ?? [],
    failure:
      props.preview.status === "unavailable"
        ? {
            message: props.preview.message ?? "The preview could not be rendered.",
            endpoint: "POST /api/email/preview",
            onRetry: props.onRender,
          }
        : null,
    loading: props.preview.status === "loading" || props.preview.status === "idle",
  };
}

export function EmailPreviewPanel(props: EmailPreviewProps) {
  const redesign = useRedesign();
  const { preview } = props;
  const answer = preview.status === "ok" ? preview.data : null;
  const simulation = simulationOf(props);

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
            {/* Beside Render again, because it renders the same thing — in somewhere with room for it. */}
            <EmailSimulation {...simulation} className="btn-secondary text-xs" />
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

        {/* The two devices wrap rather than share a grid: each card is its frame's own width, so the
          * desktop card is never squeezed below the measure the message is drawn at. */}
        <div className="flex flex-wrap items-start gap-3.5">
          <FrameCard device="desktop" html={answer?.html ?? null} placeholder={answer ? undefined : NO_MESSAGE} />
          <FrameCard device="mobile" html={answer?.html ?? null} placeholder={answer ? undefined : NO_MESSAGE} />
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

/**
 * The classic arrangement: a form, and one width at a time.
 *
 * A Record `<select>` and a Preview button opening a dialog with a Width select — the classic way to ask
 * "does it still read on a phone", one width per look, because a form is read top to bottom once rather
 * than scanned. **Simulate sits in the same control row** and takes the same handler as the modern
 * control; it is the one action here that shows both widths at once, and that is why it is the one that
 * opens a window of its own.
 *
 * The widths the dialog offers are the viewport's own — 600 px and 375 px — and the caption under the
 * frame is the shared sentence from `emailMailFrame.tsx`, so the classic frame and the modern frame
 * cannot describe the same number differently.
 */
function ClassicPreview(props: EmailPreviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [width, setWidth] = useState<MailDevice>("desktop");
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
                  {MAIL_DEVICES[option].label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={props.preview.status === "loading"}>
            {props.preview.status === "loading" ? "Rendering…" : "Preview"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setDialogOpen(true)} disabled={!answer}>
            Open the rendered message
          </button>
          {/* The panel's own control row: the same handler, the same window as the modern control. */}
          <EmailSimulation {...simulationOf(props)} className="btn-secondary text-sm" />
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
              <h3 className="text-sm font-semibold text-white">Rendered message</h3>
              <span className="font-mono text-[11px] text-gray-500">{props.messageKey}</span>
              <span className="chip">{MAIL_DEVICES[width].label}</span>
              <button type="button" className="btn-secondary ml-auto text-xs" onClick={() => setDialogOpen(false)}>
                Close
              </button>
            </div>
            <div className="flex justify-center overflow-x-auto p-4">
              <MailFrame
                device={width}
                html={answer.html}
                title={`Rendered message — ${MAIL_DEVICES[width].label}`}
                className="w-fit"
              />
            </div>
            <p className="max-w-[640px] border-t border-surface-border px-4 py-2 text-[11px] leading-relaxed text-gray-500">
              {MAIL_DEVICES[width].note}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
