/**
 * The simulation — the message in a window of its own, at both widths a reader opens it at.
 *
 * The Preview tab draws the two widths inside the Studio's own panel, which is the right place to *read*
 * them and the wrong place to *see* them: the panel is narrower than the desktop frame plus the phone
 * frame, so at least one of them is always being scrolled past. The simulation exists for the other
 * question — "what will this look like when it arrives?" — and it answers it by opening a real window
 * (`window.open`) holding both devices side by side with room to spare, which the reader may resize
 * themselves.
 *
 * ── What the window holds, and what it promises ────────────────────────────────────────────────────
 *
 *   · **the API's own HTML**, at 600 px and 375 px, in a frame of that width — the same frames the
 *     Preview tab draws, through the same component (`emailMailFrame.tsx`), so the window cannot show a
 *     different message from the panel;
 *   · **the plain-text part on the same footing**, through `EmailPlainText` — not restated, because a
 *     simulation that only simulates the pretty half is half a simulation;
 *   · **which message and which record** it is showing — the key, the name and the record the fields
 *     resolved against — so a screenshot of it is self-explanatory when somebody pastes it into a ticket;
 *   · **the same failure voice as the Studio** (`UnavailablePanel`, the read's own sentence, the retry)
 *     when the renderer or the record fails. Never a blank frame, and never an invented message.
 *
 * ── A blocked window is not a dead end ─────────────────────────────────────────────────────────────
 *
 * `window.open` may return `null`. When it does, the *same* content is drawn in an overlay inside the
 * app — a sheet over the panel in the modern interface, a dialog with a heading and a Close button in the
 * classic one — and nothing is said about pop-ups: the reader asked to see the message at both widths and
 * the answer to that is the same either way. The two arrangements share the state, the frames and the
 * words, and differ in their furniture, as the two interfaces must.
 *
 * ── The window is a document, not a screen ─────────────────────────────────────────────────────────
 *
 * It inherits nothing — not the app's stylesheet, not the attributes the theme, the palette and the
 * density hang off — so both are copied into it when it is opened. Copying rather than re-typing is also
 * what keeps this file free of a colour literal: the window wears the same variables the app is wearing.
 * Because it is a document of its own, one arrangement serves both interfaces here; the two designs are
 * the *app's* surfaces (the control and the fallback), which is where the branch belongs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MonitorSmartphone, X } from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { Band, LoadingBlock, Mono, MonoTm, UnavailablePanel } from "./emailChrome";
import { EmailPlainText } from "./EmailPlainText";
import { MAIL_DEVICES, MailFrame, type MailDevice } from "./emailMailFrame";
import { EMAIL_RECORDS } from "./emailRecords";

/** Why there is no message to show, in the Studio's own voice. */
export interface SimulationFailure {
  /** The sentence the panel would print. `describeReadFailure` writes it; nothing here invents one. */
  message: string;
  /** The route it came from, printed under the sentence when there is one. */
  endpoint?: string;
  onRetry?: () => void;
}

/** Everything the simulation is about, mapped from whichever screen is asking. */
export interface SimulationMessage {
  messageKey: string;
  /** The message's own name from the catalogue, when it is known. */
  messageName?: string | null;
  /** The record the fields resolved against, as the chooser names it. */
  recordId?: string | null;
  /** The resolved subject, when the renderer answered with one. */
  subject?: string | null;
  /** The API's own HTML — `POST /api/email/preview`'s answer, and never a stand-in. */
  html: string | null;
  /** The API's own text part. */
  text: string | null;
  /** The derivation the screen already has, shown when the renderer has not answered. */
  derivedText: string;
  warnings?: string[];
  failure: SimulationFailure | null;
  loading: boolean;
}

export interface EmailSimulationProps extends SimulationMessage {
  /** The trigger's classes, so each arrangement can place it in its own control row. */
  className?: string;
}

const DEVICE_ORDER: MailDevice[] = ["desktop", "mobile"];

/** The window's own name, so a second press raises the window that is already open. */
const POPUP_NAME = "c7ntax-email-simulation";
const POPUP_FEATURES = "popup=yes,width=1320,height=920,left=60,top=40";

/** The record's label as the chooser writes it, falling back to the id the caller had. */
function recordLabel(id: string): string {
  return EMAIL_RECORDS.find((record) => record.id === id)?.label ?? id;
}

export function EmailSimulation(props: EmailSimulationProps) {
  const modern = useModernInterface();
  const [fallback, setFallback] = useState(false);
  const [popupLive, setPopupLive] = useState(false);
  const popup = useRef<{ win: Window; root: Root } | null>(null);

  const message: SimulationMessage = {
    messageKey: props.messageKey,
    messageName: props.messageName,
    recordId: props.recordId,
    subject: props.subject,
    html: props.html,
    text: props.text,
    derivedText: props.derivedText,
    warnings: props.warnings,
    failure: props.failure,
    loading: props.loading,
  };

  /*
   * The content is pushed into the window on every render rather than only when it opens: the preview
   * answers after the press in most cases, and a window that showed "asking the renderer…" and then
   * never changed would be worse than no window at all.
   */
  useEffect(() => {
    const current = popup.current;
    if (!current || current.win.closed) return;
    current.root.render(<SimulationDocument message={message} />);
  });

  /**
   * The window belongs to the surface that opened it: when that goes, the window goes with it. Unmounting
   * the React root and leaving the window would leave a blank page wearing the app's stylesheet, and
   * closing is the smaller surprise of the two.
   */
  useEffect(
    () => () => {
      const current = popup.current;
      popup.current = null;
      if (!current) return;
      try {
        current.root.unmount();
      } catch {
        // The window has already gone; there is nothing left to unmount.
      }
      if (!current.win.closed) {
        try {
          current.win.close();
        } catch {
          // A browser may refuse a script's attempt to close a window; there is nothing to do about it.
        }
      }
    },
    [],
  );

  /** The reader may close the window themselves; noticing is what lets the next press open a new one. */
  useEffect(() => {
    if (!popupLive) return;
    const timer = window.setInterval(() => {
      const current = popup.current;
      if (!current || !current.win.closed) return;
      popup.current = null;
      try {
        current.root.unmount();
      } catch {
        // The document it was mounted into is already gone.
      }
      setPopupLive(false);
    }, 700);
    return () => window.clearInterval(timer);
  }, [popupLive]);

  const simulate = useCallback(() => {
    const current = popup.current;
    if (current && !current.win.closed) {
      current.win.focus();
      return;
    }
    /*
     * Opened synchronously, before anything could be awaited: a window raised after an `await` has lost
     * the press's activation and is blocked. The content follows through the render effect above.
     */
    let opened: { win: Window; host: HTMLElement } | null = null;
    try {
      opened = openSimulationWindow(`The message — ${props.messageKey}`);
    } catch {
      opened = null;
    }
    if (!opened) {
      setFallback(true);
      return;
    }
    popup.current = { win: opened.win, root: createRoot(opened.host) };
    popup.current.root.render(<SimulationDocument message={message} />);
    setPopupLive(true);
  }, [message, props.messageKey]);

  return (
    <>
      <button
        type="button"
        onClick={simulate}
        /* The layout is fixed here rather than left to the caller: the icon and the word have to stay on
         * one line in a control row that is already tight, and a wrapped button reads as two controls. */
        className={`inline-flex items-center gap-1.5 whitespace-nowrap ${props.className ?? "btn-secondary text-xs"}`}
        title="The message at both widths, side by side"
      >
        <MonitorSmartphone size={13} aria-hidden />
        Simulate
      </button>

      {fallback ? (
        modern ? (
          <SimulationSheet message={message} onClose={() => setFallback(false)} />
        ) : (
          <SimulationDialog message={message} onClose={() => setFallback(false)} />
        )
      ) : null}
    </>
  );
}

// ── The window itself ────────────────────────────────────────────────────────────────────────────

/**
 * A window holding the simulation, with the app's own skin written into it.
 *
 * The stylesheets are **cloned**, and the theme attributes copied, at the moment the window opens: a
 * separate document resolves no variable and loads no rule of its own, and re-typing the palette here
 * would be the same colour literal in a second place, drifting from the first.
 */
function openSimulationWindow(title: string): { win: Window; host: HTMLElement } | null {
  const win = window.open("", POPUP_NAME, POPUP_FEATURES);
  if (!win) return null;
  // The window keeps a reference to this one otherwise, which lets the document it lands on navigate it.
  win.opener = null;

  const doc = win.document;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "</head><body></body></html>",
  );
  doc.close();

  const root = document.documentElement;
  for (const name of ["data-theme", "data-palette-dark", "data-palette-light", "data-density"]) {
    const value = root.getAttribute(name);
    if (value) doc.documentElement.setAttribute(name, value);
  }
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    doc.head.appendChild(node.cloneNode(true));
  }
  doc.title = title;

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  return { win, host };
}

// ── The content, in one place, so three surfaces cannot disagree ─────────────────────────────────

/** Which message, which record and which subject — the facts a screenshot has to carry. */
function SimulationIdentity({ message }: { message: SimulationMessage }) {
  const record = message.recordId
    ? `Resolved against ${recordLabel(message.recordId)}`
    : "No record — the fields show the samples the vocabulary carries, which is not a record.";
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[11.5px]">
      <div className="min-w-0">
        <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Message</dt>
        <dd className="mt-0.5 text-gray-300">
          <MonoTm>{message.messageKey}</MonoTm>
          {message.messageName ? <span className="ml-2 text-gray-400">{message.messageName}</span> : null}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Record</dt>
        <dd className="mt-0.5 text-gray-300">{record}</dd>
      </div>
      {message.subject ? (
        <div className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Subject</dt>
          <dd className="mt-0.5 break-words text-gray-300">{message.subject}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * The two devices.
 *
 * `arrangement` is the one thing the surfaces differ about: the window and the modern sheet put them
 * side by side, because the question is *"does it still read on a phone"* and answering it by scrolling
 * is answering it twice; the classic dialog stacks them, because a form is read top to bottom and a
 * 600 px frame never has to be scrolled there.
 */
function SimulationDevices({
  message,
  arrangement,
}: {
  message: SimulationMessage;
  arrangement: "row" | "column";
}) {
  if (!message.html) {
    if (message.failure) {
      return (
        <UnavailablePanel
          message={message.failure.message}
          onRetry={message.failure.onRetry}
          what={
            <>
              Nothing is drawn, and that is deliberate: the message in here has to come from the one
              renderer, because the message a person approves has to be literally the message that goes
              out. A renderer written to fill the gap would be a second one, and a second renderer is how
              the preview and the send come to disagree.
              {message.failure.endpoint ? (
                <>
                  {" "}
                  The call is <Mono>{message.failure.endpoint}</Mono>.
                </>
              ) : null}
            </>
          }
        />
      );
    }
    return message.loading ? (
      <LoadingBlock label="the renderer" />
    ) : (
      <Band tone="info" title="Nothing has been rendered yet">
        Press <em>Preview</em>, and both widths appear here from the renderer&apos;s own HTML — this window
        never draws a message of its own.
      </Band>
    );
  }

  return (
    <div className={arrangement === "row" ? "flex flex-wrap items-start gap-6" : "space-y-6"}>
      {DEVICE_ORDER.map((device) => (
        <figure key={device} className="min-w-0">
          <figcaption className="text-xs font-semibold text-white">{MAIL_DEVICES[device].label}</figcaption>
          <div className="mt-2 max-w-full overflow-x-auto pb-1">
            <MailFrame device={device} html={message.html} title={MAIL_DEVICES[device].label} className="w-fit" />
          </div>
          <p className="mt-2 max-w-[520px] text-[11px] leading-relaxed text-gray-500">
            {MAIL_DEVICES[device].note}
          </p>
        </figure>
      ))}
    </div>
  );
}

/** The text part, through the pane the rest of the product uses — read-only here, and that is all. */
function SimulationText({ message }: { message: SimulationMessage }) {
  const apiText = message.text ?? "";
  const overridden = apiText.length > 0 && apiText !== message.derivedText;
  return (
    <EmailPlainText
      derived={message.derivedText}
      edited={overridden ? apiText : null}
      readOnly
      derivedLocally={!message.html}
    />
  );
}

/** The window's document: a title, a heading, and labelled sections. */
function SimulationDocument({ message }: { message: SimulationMessage }) {
  return (
    <div className="min-h-screen bg-navy-950 px-6 py-6">
      <div className="mx-auto max-w-[1240px]">
        <header>
          <span className="chip chip--on">Simulation</span>
          <h1 className="mt-3 text-lg font-semibold text-white">
            The message, at the two widths a reader opens it at
          </h1>
          <p className="mt-1.5 max-w-[76ch] text-xs leading-relaxed text-gray-400">
            Both frames below hold the API&apos;s own HTML and nothing else — the same renderer the send
            uses, at 600 px and at a real phone&apos;s 375 px. Resize this window and the frames stay the
            width they are labelled: the number is the viewport, and the message reflows inside it.
          </p>
          <div className="mt-4 rounded-xl border border-surface-border bg-surface p-3.5">
            <SimulationIdentity message={message} />
          </div>
        </header>

        <section aria-labelledby="simulation-message-heading" className="mt-6">
          <h2 id="simulation-message-heading" className="text-sm font-semibold text-white">
            The message, at both widths
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Nothing is being sent from this window, and nothing here changes the template: this is the
            current draft, rendered against the chosen record.
          </p>
          <div className="mt-3">
            <SimulationDevices message={message} arrangement="row" />
          </div>
          {message.warnings && message.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {message.warnings.map((warning) => (
                <li key={warning} className="text-[11.5px] text-alert-amber">
                  ▲ {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section aria-labelledby="simulation-text-heading" className="mt-7">
          <h2 id="simulation-text-heading" className="text-sm font-semibold text-white">
            The plain-text part
          </h2>
          <p className="mt-1 max-w-[76ch] text-[11.5px] leading-relaxed text-gray-500">
            What a client reads when it strips the HTML. It travels in the same message, in the same
            send, so it is simulated here too rather than described.
          </p>
          <div className="mt-3">
            <SimulationText message={message} />
          </div>
        </section>
      </div>
    </div>
  );
}

// ── The fallback: the same content, in the app ───────────────────────────────────────────────────

/** Escape closes, and the close control takes the focus, so the overlay is not a trap. */
function useDismissible(onClose: () => void) {
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    close.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return close;
}

function SimulationSheet({ message, onClose }: { message: SimulationMessage; onClose: () => void }) {
  const close = useDismissible(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 animate-fade-in" role="dialog" aria-modal="true" aria-label="Message simulation">
      <div className="flex h-full w-full max-w-[1220px] animate-slide-in-right flex-col border-l border-surface-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-5 py-3">
          <span className="chip chip--on">Simulation</span>
          <span className="text-sm font-semibold text-white">The message, at both widths</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[11px] text-gray-500">{message.messageKey}</span>
            <button ref={close} type="button" onClick={onClose} className="btn-secondary text-xs">
              <X size={13} aria-hidden />
              Close
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <SimulationIdentity message={message} />
          <p className="mt-3 text-[11.5px] leading-relaxed text-gray-500">
            Both frames hold the API&apos;s own HTML, in a viewport of the width they are labelled. Widen
            this sheet and the phone frame stays a phone: a frame that shrank with its column would take
            the phone&apos;s own rules with it.
          </p>
          <div className="mt-4">
            <SimulationDevices message={message} arrangement="row" />
          </div>
          {message.warnings && message.warnings.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {message.warnings.map((warning) => (
                <li key={warning} className="text-[11.5px] text-alert-amber">
                  ▲ {warning}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-5">
            <SimulationText message={message} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SimulationDialog({ message, onClose }: { message: SimulationMessage; onClose: () => void }) {
  const close = useDismissible(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Message simulation">
      <div className="card max-h-[92vh] w-full max-w-4xl overflow-auto animate-fade-in !p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Message simulation</h2>
          <span className="text-xs text-gray-500">
            The message at both widths, from the renderer&apos;s own HTML.
          </span>
          <button ref={close} type="button" onClick={onClose} className="btn-secondary ml-auto text-xs">
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          <SimulationIdentity message={message} />
          {/* A form is read top to bottom, so the two widths are labelled fields in order rather than a
           * row to be scanned — the arrangement the classic interface is for. */}
          {message.html ? (
            DEVICE_ORDER.map((device) => (
              <fieldset key={device} className="rounded-lg border border-surface-border p-3">
                <legend className="px-1 text-xs font-semibold text-white">{MAIL_DEVICES[device].label}</legend>
                <div className="max-w-full overflow-x-auto">
                  <MailFrame device={device} html={message.html} title={MAIL_DEVICES[device].label} className="w-fit" />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{MAIL_DEVICES[device].note}</p>
              </fieldset>
            ))
          ) : (
            <SimulationDevices message={message} arrangement="column" />
          )}
          {message.warnings && message.warnings.length > 0 ? (
            <ul className="space-y-1">
              {message.warnings.map((warning) => (
                <li key={warning} className="text-[11.5px] text-alert-amber">
                  ▲ {warning}
                </li>
              ))}
            </ul>
          ) : null}
          <SimulationText message={message} />
        </div>
      </div>
    </div>
  );
}
