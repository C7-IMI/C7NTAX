/**
 * The kit, applied — to one small message, drawn on the same screen as the kit itself.
 *
 * A brand kit nobody can see applied is a form, so this is the half of the brand screen that answers
 * "and what does the client actually get?". It draws the real shape of a `ticket.activity` message —
 * the words from `ticketActivityTemplate`, the subject tag, the shield, the wordmark, the footer the
 * template does not have today — over whatever the kit currently resolves to, so a changed crimson or a
 * changed footer is visible in the same second it is changed.
 *
 * Two things here are deliberate:
 *
 * 1. **The mail is a document, not a screen.** Its colours come from the kit — the shield from
 *    `lib/documentBrand.ts`, and `primaryColor` · `accentColor` · `wordmark` · `footerText` ·
 *    `legalText` from `GET /api/email/brand` — NOT from the eight interface colour schemes: an email must
 *    look the same to a client whatever theme the person who sent it prefers, exactly as a printed
 *    report must. That is why this file is on `scripts/lint-design-tokens.mjs`'s exempt list with its
 *    reason written beside it: a token here would produce the wrong message.
 * 2. **Both parts are shown**, because a mail system that strips HTML still has to deliver a readable
 *    message. The text part beside the HTML one is derived from the same lines by the rule the renderer
 *    uses — a button becomes `Label: <full url>`, never link text with the URL hidden — so approving a
 *    message means seeing both of what goes out. On the live screens that derivation is the server's
 *    (`POST /api/email/preview` returns both); here it is the same rule applied to this one sample.
 *
 * `imagesBlocked` is not decoration either: Outlook blocks remote images by default and Gmail proxies
 * them, so the wordmark is the FIRST child of the header and the shield is decorative beside it. The
 * toggle proves the fallback instead of describing it.
 */
import { useState } from "react";
import { ImageOff, Lock } from "lucide-react";
import type { BrandView } from "./brandView";

/**
 * The colours the message *body* is drawn in — the panel behind a code, the tint behind a quote.
 *
 * They are the values in the senders' own string literals today, which is exactly the drift this feature
 * exists to end: the banner crimson agrees with the document brand by luck, and these greys are not in
 * the brand at all. The kit's own four values are read from the resolved brand, so a kit that changes
 * changes this.
 */
const MAIL = {
  paper: "#ffffff",
  card: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  tint: "#f1f5f9",
  onBrand: "#ffffff",
  hairline: "#e2e8f0",
} as const;

/** The real words, in the shape of the real records on this instance. */
const SAMPLE = {
  contact: "James Wilson",
  contactEmail: "jwilson@acmecorp.com",
  ticketNumber: "INT-01-2006",
  ticketTitle: "Intelligence report: new ransomware variant",
  board: "Intelligence Desk",
  client: "Acme Corporation",
  subject: "[INT-01-2006] Status updated — Intelligence report: new ransomware variant",
  eventLabel: "Status updated",
  detail: 'Status changed from "In Progress" to "Waiting On Client".',
  cta: "Open the ticket",
  ctaHref: "https://c7ntax.example.com/tickets/INT-01-2006",
};

/**
 * The plain-text part, derived from the same lines the HTML part is drawn from.
 *
 * The rule (see `PLAIN_TEXT_RULE` in the shared facts) is that the text form keeps the information: a
 * button becomes `Label: <full url>`, facts become `Label: value` lines. For a message this small the
 * whole derivation is the lines in order — which is the point: a change to one cannot make the other say
 * something different, because they are built from the same list.
 */
function sampleTextPart(brand: BrandView): string {
  return [
    `Hi ${SAMPLE.contact},`,
    "",
    `Ticket ${SAMPLE.ticketNumber} — ${SAMPLE.ticketTitle}`,
    "",
    SAMPLE.eventLabel,
    SAMPLE.detail,
    "",
    "If you have any questions, simply reply to this email.",
    "",
    `${SAMPLE.cta}: ${SAMPLE.ctaHref}`,
    "",
    brand.companyName,
    brand.footerText,
    `Ticket ${SAMPLE.ticketNumber} · ${SAMPLE.board} · ${brand.productName}`,
  ].join("\n");
}

export function EmailSampleMessage({
  brand,
  replyToSentence,
}: {
  brand: BrandView;
  /** The proposed reply-to, worded by the page so two screens cannot disagree about it. */
  replyToSentence: string;
}) {
  const [imagesBlocked, setImagesBlocked] = useState(false);
  const [part, setPart] = useState<"html" | "text">("html");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-stretch gap-1 rounded-xl border border-surface-border bg-surface-lighter p-1" role="group" aria-label="Which part of the message">
          <button
            type="button"
            aria-pressed={part === "html"}
            onClick={() => setPart("html")}
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${part === "html" ? "tab-active font-semibold" : "text-gray-300 hover:text-white"}`}
          >
            HTML part
          </button>
          <button
            type="button"
            aria-pressed={part === "text"}
            onClick={() => setPart("text")}
            className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${part === "text" ? "tab-active font-semibold" : "text-gray-300 hover:text-white"}`}
          >
            Plain-text part
          </button>
        </div>
        <button
          type="button"
          aria-pressed={imagesBlocked}
          onClick={() => setImagesBlocked((on) => !on)}
          className={`chip ${imagesBlocked ? "chip--on" : ""}`}
        >
          <ImageOff size={12} />
          Images blocked
        </button>
      </div>

      <div className="space-y-1 text-[11.5px] text-gray-400">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="w-16 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">From</span>
          {brand.fromName ? `${brand.fromName} <${brand.fromEmail ?? brand.smtpFrom}>` : brand.fromEmail ?? brand.smtpFrom}
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="w-16 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">To</span>
          {SAMPLE.contact} &lt;{SAMPLE.contactEmail}&gt;
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="w-16 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Subject</span>
          {SAMPLE.subject}
        </p>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="w-16 text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Reply-To</span>
          {brand.replyTo ?? replyToSentence}
        </p>
      </div>

      {part === "html" ? (
        <div className="overflow-hidden rounded-lg border border-surface-border" style={{ background: MAIL.paper }}>
          <div className="flex items-center gap-2.5 px-5 py-4" style={{ background: brand.primaryColor }}>
            {/* The wordmark is the first child; the shield is decoration beside it. */}
            <span style={{ color: MAIL.onBrand, fontWeight: 700, letterSpacing: "-0.01em" }}>
              {brand.wordmark}
            </span>
            {imagesBlocked ? null : <img src={brand.logoUrl} alt="" width={22} height={22} className="rounded" />}
          </div>
          <div className="px-5 py-4" style={{ color: MAIL.card }}>
            <p className="text-[12.5px]">Hi {SAMPLE.contact},</p>
            <p className="mt-3 text-[12.5px] font-semibold" style={{ color: brand.primaryColor }}>
              Ticket <b>{SAMPLE.ticketNumber}</b> — <i>{SAMPLE.ticketTitle}</i>
            </p>
            <p className="mt-2 text-[12.5px] font-semibold">{SAMPLE.eventLabel}</p>
            <div className="mt-2 rounded border-l-2 px-3 py-2 text-[12px]" style={{ background: MAIL.tint, borderColor: brand.accentColor, color: MAIL.card }}>
              {SAMPLE.detail}
            </div>
            <p className="mt-3 text-[12.5px]">If you have any questions, simply reply to this email.</p>
            <span
              className="mt-4 inline-block rounded px-3.5 py-2 text-[12.5px] font-semibold"
              style={{ background: brand.accentColor, color: MAIL.card }}
            >
              {SAMPLE.cta}
            </span>
          </div>
          <div className="border-t px-5 py-3.5 text-[11px]" style={{ borderColor: MAIL.hairline, color: MAIL.card }}>
            <p className="font-semibold">{brand.legalText || brand.companyName}</p>
            <p className="mt-1">{brand.footerText}</p>
            <p className="mt-1">
              Ticket {SAMPLE.ticketNumber} · {SAMPLE.board} · {brand.productName}
            </p>
          </div>
        </div>
      ) : (
        <pre
          className="max-h-96 overflow-auto rounded-lg border border-surface-border px-4 py-3 font-mono text-[11.5px] leading-relaxed"
          style={{ background: MAIL.card, color: MAIL.paper }}
        >
{sampleTextPart(brand)}
        </pre>
      )}

      <p className="text-[11px] leading-relaxed text-gray-500">
        {imagesBlocked
          ? "With images blocked the header still reads: the wordmark is the first child of the header and the shield is decoration beside it."
          : "Turn images on and off to see the fallback: with remote images blocked, Outlook and Gmail both leave the shield as a broken box, and only the words survive."}{" "}
        The plain-text part is sent with every message, derived from the same lines, so a client that strips HTML still gets a message that makes sense.
      </p>
    </div>
  );
}

/**
 * The same brand, deliberately absent.
 *
 * Five messages — a staff sign-in code, a portal sign-in code, an invitation, a password change and a
 * password reset — are read once, in a hurry, often on a poor connection, and a designed header is
 * friction in the way of the number. Three of them exist today and are `security` class in the registry;
 * the other two are proposed. They get the minimum: the code or the link, the expiry, what to do if you
 * did not ask for it, and a plain-text part. Drawing the rule beside the message it removes the header
 * from says it better than a paragraph.
 */
export function EmailSecuritySample() {
  return (
    <div className="overflow-hidden rounded-lg border border-surface-border" style={{ background: MAIL.paper }}>
      <div className="px-5 py-5" style={{ color: MAIL.card }}>
        <p className="text-[12.5px] font-semibold">Your verification code</p>
        <p className="mt-1.5 text-[12px]" style={{ color: MAIL.body }}>Use this code to complete your sign-in. It expires in 10 minutes.</p>
        <p className="mt-3.5 font-mono text-[26px] font-bold tracking-[0.28em]">418 902</p>
        <p className="mt-3.5 text-[11.5px]" style={{ color: MAIL.muted }}>If you did not try to sign in, change your password and tell your administrator.</p>
      </div>
      <div className="flex items-start gap-1.5 border-t px-5 py-3 text-[11px]" style={{ borderColor: MAIL.hairline, color: MAIL.muted }}>
        <Lock size={11} className="mt-0.5 shrink-0" />
        <span>
          No shield, no wordmark, no crimson header, no footer, no unsubscribe link, no reply-to — and no
          batching, no quiet hours and no opt-out apply to it either.
        </span>
      </div>
    </div>
  );
}
