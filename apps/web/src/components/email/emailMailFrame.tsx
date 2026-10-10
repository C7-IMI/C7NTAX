/**
 * The mail frame — the viewport a message is looked at through.
 *
 * One component, because there are three surfaces that ask the same question and answering it three
 * ways is how two of them come to disagree about what the message looks like:
 *
 *  · the **Preview** tab, which draws both widths beside each other;
 *  · the **send sheet**, whose preview pane is the message about to leave;
 *  · the **simulation window**, whose whole point is a real viewport at a size the panel cannot give.
 *
 * ── The widths are viewports, not settings ─────────────────────────────────────────────────────────
 *
 * `600 px` is the width a desktop client opens the message in — the measure the design is drawn for —
 * and `375 px` is an iPhone SE/13 mini class screen. **Neither is a number the mailer applies** — a
 * client decides how wide it will be — so the frames print the number as a fact about the viewport and
 * never as a claim about the send.
 *
 * ── The frame is the client, and it brings only what a client brings ───────────────────────────────
 *
 * The HTML in the frame is the API's own, unmodified: `mailDocument` wraps it in a *client* document,
 * the way a mail client wraps it in its own chrome — a page margin, a light canvas, and the one safety
 * rule every phone client applies (an image or a table may not be wider than the screen). Nothing else:
 * the message's blocks carry their own geometry inline, so anything this file restated would be a second
 * design of the message rather than a preview of it. Nothing here re-renders the message, and nothing
 * here is drawn from the blocks.
 *
 * The frame document sets `color-scheme: light`, so the `canvas` and `canvastext` system colours
 * resolve to the white page and black text a mail client shows whatever theme the reader has chosen —
 * the same reason `.print-letterhead` uses literal colours. There is no colour literal in this file.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** The two devices, and the honest sentence for each. Worded once so three surfaces cannot differ. */
export const MAIL_DEVICES = {
  desktop: {
    width: 600,
    label: "600 px — desktop",
    note:
      "The API's own HTML in a 600 px viewport — the room a desktop client gives it. The message draws its own card and page gutter; this frame is only the space it sits in, because the number here is a viewport and not a setting: nothing in the mail path sends a width.",
  },
  mobile: {
    width: 375,
    label: "375 px — mobile",
    note:
      "The same HTML in a 375 px viewport — an iPhone SE/13 mini class screen. What to notice: the card narrows to the screen and every fact pair and line wraps into it. The message is one column at both widths, so nothing is squeezed into a phone-shaped desktop.",
  },
} as const;

export type MailDevice = keyof typeof MAIL_DEVICES;

/** The frame's own height before its content has been measured. */
const UNMEASURED_HEIGHT = 420;

/**
 * The API's HTML, inside a mail document.
 *
 * `color-scheme: light` is what keeps the frame out of the application's theme without a colour
 * literal: it makes the `canvas` and `canvastext` keywords the white page and black text a mail client
 * shows.
 *
 * The only rules in here besides that are the two a *client* brings and the message cannot state for
 * itself: an image or a table may not be wider than the screen. Nothing here changes a `display`, a
 * padding or a colour — the message's blocks carry their own geometry inline, and re-stating any of it
 * would be a second design of the message, which is the one thing a preview must never be.
 */
export function mailDocument(html: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    "<style>",
    "html{color-scheme:light;}",
    "html,body{margin:0;padding:0;background:canvas;color:canvastext;}",
    "body{font:14px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}",
    "@media (max-width:420px){",
    "  img{max-width:100% !important;height:auto !important;}",
    "  table{max-width:100% !important;}",
    "}",
    "</style></head><body>",
    html,
    "</body></html>",
  ].join("\n");
}

/**
 * What is inside a frame when the renderer has not answered: **a layout sample, never a message.**
 *
 * Drawing the widths matters — they are the question the preview exists to ask, and the phone frame is
 * an arrangement rather than a narrower copy of the desktop one. Drawing the *message* does not: that
 * would be a second renderer, and the preview would stop being the thing that goes out. So the sample is
 * a table and a fact list, which is what actually has to reflow, and the frame says what it is.
 *
 * No colour literal anywhere in it: the sample is drawn with `currentColor`, `opacity` and the two
 * system colour keywords the frame already sets — and there is nothing here to read as copy.
 */
export function layoutSample(width: number): string {
  const rule = "border-bottom:1px solid";
  const cell = "padding:4px 12px 4px 0;font-size:12px";
  return [
    '<div style="max-width:480px">',
    '<h2 style="margin:0 0 10px;font-size:17px">The message is not drawn here</h2>',
    '<p style="opacity:.75;margin:0 0 14px;font-size:13px">',
    `This is a ${width} px frame with a layout sample in it, not the message. The message comes from the one`,
    " renderer and it did not answer — so what is inside is a sample of the widths, and nothing that reads as copy.",
    "</p>",
    '<table style="max-width:100%;border-collapse:collapse"><thead><tr>',
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

export interface MailFrameProps {
  device: MailDevice;
  /** The API's own HTML. Absent while the renderer has not answered — the layout sample stands in. */
  html: string | null;
  title: string;
  className?: string;
}

/**
 * One device's viewport, **exactly as wide as the device is**.
 *
 * Two things it does that a plain iframe does not:
 *
 *  · **It follows its content.** Measuring the frame document after load (and on every resize of that
 *    document) is what removes the empty region a fixed height left under the message — a panel with
 *    300 px of nothing under the message reads, correctly, as unfinished.
 *  · **It never shrinks below its device.** The width is a fixed number rather than `w-full`: a frame
 *    that shrank with its column would shrink past the phone's own rules and stop being a phone at all.
 *    A narrow panel scrolls the frame instead, which is the panel's problem, not the message's.
 *
 * `allow-same-origin` and deliberately **not** `allow-scripts`: the message's own scripts can never run
 * in here, and the frame's document stays readable so the width and the height can be measured.
 */
export function MailFrame({ device, html, title, className = "" }: MailFrameProps) {
  const width = MAIL_DEVICES[device].width;
  const frame = useRef<HTMLIFrameElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const timers = useRef<number[]>([]);
  const [height, setHeight] = useState(UNMEASURED_HEIGHT);

  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    const body = doc?.body;
    if (!body) return;
    /*
     * The root element's **offsetHeight**, with the body's as a floor — and never either `scrollHeight`.
     *
     * The root's `scrollHeight` is at least the viewport, so measuring it can only ever grow the frame:
     * that is how a fixed height becomes a few hundred pixels of nothing under a short message. The
     * body's `offsetHeight` is the message's own box, but it excludes a last child's bottom margin, which
     * is space the message occupies and therefore space the frame owes it — clipping the final paragraph
     * of every message that ends in one. The root's `offsetHeight` is the content extent including that,
     * and it does not stretch to the viewport, so it is the honest number.
     */
    const next = Math.max(doc.documentElement?.offsetHeight ?? 0, body.offsetHeight, body.scrollHeight);
    // A frame whose document has not laid out yet reports 0, and shrinking to 0 would collapse it.
    if (next < 40) return;
    setHeight((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);

  /**
   * Measure now, and again as the document settles.
   *
   * Both halves are needed. `onLoad` is the first look, but a frame is filled twice — the layout sample
   * first, the message when the renderer answers — and a single measurement taken against the first
   * document leaves the second one clipped at the sample's height. `ResizeObserver` catches a body that
   * grows while staying put; the hand-timed passes catch a body that was measured mid-swap, and an image
   * that arrives late.
   */
  const settle = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [0, 120, 400, 1200, 2500].map((delay) => window.setTimeout(() => measure(), delay));
  }, [measure]);

  const onLoad = useCallback(() => {
    observer.current?.disconnect();
    measure();
    const body = frame.current?.contentDocument?.body;
    if (body && typeof ResizeObserver !== "undefined") {
      const next = new ResizeObserver(() => measure());
      next.observe(body);
      observer.current = next;
    }
    settle();
  }, [measure, settle]);

  useEffect(() => settle(), [html, settle]);

  useEffect(
    () => () => {
      observer.current?.disconnect();
      timers.current.forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  /*
   * The border is on a wrapper rather than on the frame, because `box-sizing: border-box` would take the
   * two border pixels out of the viewport: the frame's width has to be the width the message is laid out
   * at, exactly, or the phone frame is a 373 px phone.
   */
  const viewport = (
    <div className="w-fit overflow-hidden rounded-lg border border-surface-border bg-surface-light">
      <iframe
        ref={frame}
        title={`${title} — ${html ? "rendered by the API" : "a width frame, without the message"}`}
        srcDoc={mailDocument(html ?? layoutSample(width))}
        sandbox="allow-same-origin"
        onLoad={onLoad}
        data-frame-device={device}
        data-frame-width={width}
        data-frame-content={html ? "message" : "layout-sample"}
        style={{ width, height }}
        className="block"
      />
    </div>
  );

  return (
    <div className={className}>
      {device === "mobile" ? (
        /* A phone the reader can recognise at a glance — the bezel is the only thing here that is not a
         * viewport, and it is outside the 375 px the message lives in. */
        <div className="rounded-[26px] border-2 border-surface-border bg-surface-lighter p-2.5">
          <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-surface-border" aria-hidden />
          {viewport}
        </div>
      ) : (
        viewport
      )}
    </div>
  );
}
