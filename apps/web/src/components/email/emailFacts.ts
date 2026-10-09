/**
 * The rules, and the extra columns the matrix needs that the catalogue does not carry.
 *
 * **The catalogue is not duplicated here.** What each of the twelve messages is, what fires it, who
 * reads it and what its body is today lives in `emailCatalogue.ts` — one file, written once, shared
 * with the Studio's list. This file adds only what the *matrix* needs on top of it, keyed by the same
 * keys:
 *
 *   · **`canBeTurnedOff`** — a fact about which switch exists and whether a sender reads it, which the
 *     API does not carry and the catalogue does not hold. Every row's answer is read from the sender
 *     code, and the screen says so above the table rather than pretending it came over the wire;
 *   · **`locked`** — the rows the rules do not apply to: `editingClass: "security"` (no brand kit at
 *     all) plus the never-wait list;
 *   · **`from`, `replyTo`, `sender`** — the sender identity per message, as the API's registry states
 *     it and as the code does it today;
 *   · **`note`** — the one thing about this row that a reader has to know and would otherwise assume
 *     wrongly.
 *
 * **The rules themselves** — quiet hours, batching, who may be emailed, suppression, the override
 * chain — are design decisions this feature makes, and none of them is enforced anywhere yet. Each
 * carries `enforcedIn`, the line saying *where* it would be applied, because a rule that is not
 * enforced somewhere is a sentence rather than a rule.
 *
 * Every "today" claim was read from the repository on 9 October 2026 and names its evidence. Where the
 * brief and the code disagreed, the code wins and the difference is written down: the per-contact note
 * switch is `TicketContact.notifyOnNote` (a column on the ticket's contact link, not a configuration
 * field); three of the four per-board switches the board screen offers are stored and settable but read
 * by nobody; the registry has **twelve** keys rather than the fourteen the approved drawing shows, so
 * the two extra security notices are named as proposals rather than listed as rows; and there is **no
 * `/api/email/settings` and no resend route**, which the screens say in words instead of calling
 * something that is not there.
 */

export type MessageStatus = "live" | "written-never-sent" | "proposed";

export const STATUS_LABEL: Record<MessageStatus, string> = {
  live: "live",
  "written-never-sent": "written, never sent",
  proposed: "proposed",
};

/** The registry's group order, so the fallback and the API sort the same way. */
export const GROUP_ORDER = ["Ticket activity", "Money", "Access & security", "Portal", "Reports"];

export interface MatrixExtra {
  /** The group as the API's registry declares it — the API's grouping wins when it answers. */
  group: string;
  canBeTurnedOff: string;
  template: string;
  /** The function or route that sends it today, as the registry states it. */
  sender: string;
  /** The address it leaves from today — one address for every message. */
  from: string;
  replyTo: string | null;
  locked: boolean;
  note: string;
}

const FROM_TODAY = "SMTP_FROM — one address for every message";

export const MATRIX_EXTRAS: Record<string, MatrixExtra> = {
  "ticket.note": {
    group: "Ticket activity",
    canBeTurnedOff: "No — it is a deliberate send, and a switch that stopped it would break the button.",
    template: "the composer's own body plus the template's footer",
    sender: "routes/tickets/index.ts — POST /tickets/:id/email",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "The composer appends a hard-coded <hr> and a fixed footer (Ticket: … · Client: …) to every note it sends, at routes/tickets/index.ts:515 — words a client reads, owned by a string literal.",
  },
  "ticket.activity": {
    group: "Ticket activity",
    canBeTurnedOff:
      "Not today. The board holds notifyCustomerOnClose and the Boards route writes it, but no sender reads it — a board with it switched off still emails its closures.",
    template: "ticketActivityTemplate",
    sender: "services/ticketNotifications.ts — notifyTicketContact, notifyTicketClosure",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "The closure rides on this key rather than on one of its own, so an exemption for it cannot be a property of the key alone: it has to travel with the event, or a closure is held by quiet hours with everything else.",
  },
  "ticket.closure": {
    group: "Ticket activity",
    canBeTurnedOff: "Not today — the same board switch, and the same silence.",
    template: "sendTicketAutoClose → autoCloseTemplate (written; no caller)",
    sender: "packages/email — sendTicketAutoClose (no caller)",
    from: FROM_TODAY,
    replyTo: null,
    locked: true,
    note: "Marked rather than omitted: a complete, well-formed sender with no caller anywhere in the repository is the strongest argument this feature has. The wording that must be migrated is ticket.activity's, not this template's.",
  },
  "ticket.follow_up": {
    group: "Ticket activity",
    canBeTurnedOff:
      "Not today. The board holds followUpEnabled and followUpIntervalHours and the Boards route writes them, but the worker reads neither — it uses a fixed 24 hours.",
    template: "followUpTemplate",
    sender: "worker.ts — EmailService.sendTicketFollowUp",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "The interval is fixed in the worker, so the board's followUpIntervalHours changes a stored value and nothing else.",
  },
  "ticket.reopened_internal": {
    group: "Ticket activity",
    canBeTurnedOff: "No — it is the one notification that stops a reopened ticket being missed.",
    template: "ticketReopenedTemplate",
    sender: "services/ticketNotifications.ts — notifyTicketReopenedByClient",
    from: FROM_TODAY,
    replyTo: null,
    locked: true,
    note: "Internal: it needs the ticket's fields rather than the customer's, and it is never batched — the whole point is that somebody sees it now.",
  },
  "invoice.send": {
    group: "Money",
    canBeTurnedOff: "Per client, proposed — a client may be billed without being emailed.",
    template: "sendInvoice → invoiceTemplate (written; no caller)",
    sender: "packages/email — sendInvoice (no caller)",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "This is the request that started the feature: the email has been sitting in the code the whole time with no path to it, and an invoice's \"sent\" today is a status change rather than a message.",
  },
  "invoice.overdue": {
    group: "Money",
    canBeTurnedOff:
      "Proposed: an instance rule, because a reminder a client can switch off is not a reminder. There is no switch today.",
    template: "overdueTemplate",
    sender: "worker.ts — EmailService.sendOverdueReminder",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "Sent every seven days while the invoice stays unpaid, not once — the worker checks every 6 hours and the day count is what decides.",
  },
  "quote.send": {
    group: "Money",
    canBeTurnedOff: "No switch proposed — it is a deliberate send, like ticket.note.",
    template: "proposed — the invoice template is the obvious parent",
    sender: "nothing — a reserved key",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "Named in the shared vocabulary so the set is complete: the Studio shows it and says it does not exist.",
  },
  "auth.mfa_code": {
    group: "Access & security",
    canBeTurnedOff: "No.",
    template: "mfaTemplate",
    sender: "routes/auth.ts — EmailService.sendMfaCode",
    from: FROM_TODAY,
    replyTo: null,
    locked: true,
    note: "Plain by rule and never held: it expires in ten minutes and is read once, in a hurry, on the worst connection of the day.",
  },
  "user.invite": {
    group: "Access & security",
    canBeTurnedOff: "No.",
    template: "the account-ready message, with the temporary password",
    sender: "routes/users.ts — sendWelcomeEmail",
    from: FROM_TODAY,
    replyTo: null,
    locked: true,
    note: "Carries a credential in plain sight, which is why it is plain by rule: no shield, no wordmark, no crimson header, no footer, no reply-to.",
  },
  "portal.login_code": {
    group: "Portal",
    canBeTurnedOff: "No.",
    template: "the portal sign-in message — the one live send that already carries a text part",
    sender: "routes/portal.ts — POST /api/portal/auth/request",
    from: FROM_TODAY,
    replyTo: null,
    locked: true,
    note: "Holding a code back would make the client wait on the product's convenience.",
  },
  "report.scheduled": {
    group: "Reports",
    canBeTurnedOff: "Yes — isActive on the schedule, already.",
    template: "proposed — the report PDF is an attachment, not a body",
    sender: "nothing — a reserved key",
    from: FROM_TODAY,
    replyTo: null,
    locked: false,
    note: "The one row the unsubscribe link applies to. A value report may be internal, in which case it does not — and the schedule on this instance is real while the sender is not.",
  },
};

/** `editingClass: "security"` in the registry — the rows that get no brand kit at all. */
export const PLAIN_BY_RULE_KEYS = ["auth.mfa_code", "user.invite", "portal.login_code"];

/**
 * The two security notices the approved drawing shows and the registry does not have.
 *
 * They are not matrix rows, because a row would claim the system can send something it cannot: the
 * registry declares twelve keys and neither of these is one. They are named so the design's intent
 * survives the correction — a password change and a password reset are the two notices a person expects
 * and this product does not yet send.
 */
export const PROPOSED_SECURITY_NOTICES: { key: string; why: string }[] = [
  {
    key: "auth.password_changed",
    why: "A password was changed from My Account, or reset by an administrator. Plain by rule: it is a security notice, and told late it is told after the window in which it would have mattered.",
  },
  {
    key: "user.password_reset",
    why: "A reset was requested for an account. The link would expire, so a batched one would arrive dead.",
  },
];

// ── Quiet hours, batching and the digest ─────────────────────────────────────────────────────────

/** The proposed defaults, so a screen with no API to read still states the rule it is proposing. */
export const DELIVERY_DEFAULTS = {
  quietHoursEnabled: true,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  quietHoursTimezone: "the client's own timezone",
  batchWindowMinutes: 15,
  batchThreshold: 3,
  batchCeilingMinutes: 30,
  digestEnabled: true,
  unsubscribeEnabled: true,
  bounceThreshold: 2,
  retentionDays: 90,
} as const;

/**
 * The messages that never wait, drawn as locked rows in the matrix rather than only as prose here. Each
 * is a message whose value *is* the delay.
 */
export const BATCH_EXEMPT: { key: string; why: string; inRegistry: boolean }[] = [
  { key: "auth.mfa_code", why: "Expires in ten minutes and is read once, in a hurry. A digest of two codes is not a thing that can exist.", inRegistry: true },
  { key: "portal.login_code", why: "Same reason, and the rate limit is already there — holding a code back makes the client wait on the product's convenience.", inRegistry: true },
  { key: "user.invite", why: "A temporary password with an expiry. Held to the morning it is a password somebody has already asked for again.", inRegistry: true },
  { key: "ticket.closure", why: "A closure carries an instruction — reply and it reopens — and is read within minutes by somebody who was waiting for it. Held to 07:00 it would tell them a ticket was closed eight hours after they saw it close.", inRegistry: true },
  { key: "ticket.reopened_internal", why: "Internal, and the whole point is that a reopened ticket with no reader is the failure it exists to prevent.", inRegistry: true },
  { key: "auth.password_changed", why: "A security notice. Proposed: the registry does not have this key yet.", inRegistry: false },
  { key: "user.password_reset", why: "The reset link expires; a batched one arrives dead. Proposed: the registry does not have this key yet.", inRegistry: false },
];

/**
 * Where each rule is applied. A rule that is not enforced somewhere is a sentence, so every row names
 * the component that would have to hold it — and why there rather than in a screen.
 */
export const ENFORCEMENT: { rule: string; enforcedIn: string; why: string }[] = [
  {
    rule: "Batch window & threshold",
    enforcedIn: "the sender — a delivery-policy layer in the API between the caller and the send",
    why: "So a caller that forgets cannot bypass it. Every live sender goes through ticketNotifications.ts or worker.ts; a rule that lived in a screen is a rule curl could skip.",
  },
  {
    rule: "Quiet hours",
    enforcedIn: "the worker and the sender — the worker because it is the thing that sends at 03:00, the sender because a person pressing Send at 22:00 must get the same answer",
    why: "A hold applied in one path and not the other is a hold that leaks at night.",
  },
  {
    rule: "Which messages never wait",
    enforcedIn: "the message key itself — a property of the key, not a checkbox anybody can tick",
    why: "An exemption a screen can switch off is not an exemption. It is also why the closure is the awkward one: it rides on ticket.activity, so its exemption has to travel with the event rather than with the key.",
  },
  {
    rule: "Opt-out",
    enforcedIn: "the sender — a suppressed address is dropped from the resolved recipient list before the send",
    why: "An opt-out that only removes a link from a footer is not a rule; the drop has to happen where the message is addressed — and it is what lets the log say \"skipped by a rule\" rather than showing a message that never had a chance.",
  },
  {
    rule: "Bounce and complaint",
    enforcedIn: "the sender for the drop, and the delivery log for the record",
    why: "The same drop as an opt-out, so one place enforces both — and a bounce is only useful if it is attached to the message that caused it.",
  },
  {
    rule: "Per-client overrides",
    enforcedIn: "the renderer — the API resolves instance → board → client → language immediately before it renders, and the log records the scope it used",
    why: "An override is about content, and the sender only sees the finished message. A resolution that happens after rendering is a resolution nothing can act on.",
  },
];

/** Why the rules screen has no Save: there is no route to save to. */
export const NO_SETTINGS_ENDPOINT =
  "The API does not expose the delivery rules: there is no GET or PUT /api/email/settings, and nothing stores a quiet-hours window, a batch threshold or a bounce count. So these are the values this feature asks for, drawn as disabled fields with the reason beside them rather than as a form that cannot save.";

/** Why the log's Resend is disabled: there is no route to resend through. */
export const NO_RESEND_ROUTE =
  "There is no route that resends a logged message. The only send the API exposes is POST /api/email/templates/:key/test, which sends a test to an address you name — it re-sends nothing and it is not this row. So Resend is drawn disabled with its reason, which is the choice this repository makes: a button that says Resend and cannot resend is worse than a disabled one.";

// ── Who may be emailed ───────────────────────────────────────────────────────────────────────────

export const RECIPIENT_ROLES: { role: string; receives: string; theSwitch: string; storedAt: string }[] = [
  {
    role: "primary — the ticket's own contactId",
    receives:
      "Everything customer-visible: a non-internal note, a logged time entry, a status change, the closure. It is the To unless the author unticked it for this one event.",
    theSwitch: "none as a standing preference — includePrimary: false unticks it for a single event",
    storedAt: "Ticket.contactId",
  },
  {
    role: "cc",
    receives:
      "Copied on all of it — status changes, note notifications, time-entry notices and manual sends. Primary first, deduplicated case-insensitively.",
    theSwitch: "none — being on the ticket as cc *is* the preference",
    storedAt: "TicketContact.role",
  },
  {
    role: "additional",
    receives:
      "Notes only — nothing else, ever — and only while their own switch is on. For a status change an additional contact hears nothing.",
    theSwitch: "on by default — notifyOnNote, default true",
    storedAt: "TicketContact.notifyOnNote",
  },
];

/**
 * The correction this feature had to make to its own brief, kept beside the rules it corrects.
 *
 * The brief placed the per-contact "email this contact notes" switch under **Configuration → Client
 * Apps & Notifications**. Read, that section holds two fields — `outlookAddin` and `push` — and the
 * switch is a column on the ticket's contact link. So the screen does not draw a control at an address
 * where there is nothing, and what it proposes for that section is only the instance-wide default a new
 * ticket's contacts are created with.
 */
export const NOTE_SWITCH_CORRECTION =
  "The per-contact switch is TicketContact.notifyOnNote — a column on the ticket's contact link, default true, set on the ticket. It is not a field of the apps configuration section, which holds only outlookAddin and push. The switch therefore stays where it is enforced, and what is proposed for that section is the instance-wide default new ticket contacts are created with.";

export const OPT_OUT = {
  suppresses: "report.scheduled sent to a client, and the activity digest when it is the only thing left that can be stopped.",
  cannotSuppress:
    "a closure, a follow-up, an invoice notice, a portal sign-in code or an MFA code — these are the delivery of a service the recipient asked for, and a link offering to stop them would be a lie.",
  recordedAs:
    "a proposed field on the contact record beside the address, carrying who set it, when, and from which message — the same three facts every other deliberate exclusion in this product carries.",
  appliedIn:
    "the sender: a suppressed address is dropped from the resolved recipient list before the send, so the log can say \"skipped by a rule\" rather than showing a message that never had a chance.",
};

export const BOUNCE_RULES: { signal: string; whatHappens: string }[] = [
  { signal: "Soft bounce — 4xx, mailbox full", whatHappens: "Three attempts, then logged as failed. Not suppressed: a full mailbox is a Tuesday." },
  { signal: "Hard bounce — 5xx, no such user", whatHappens: "Counted. Two consecutive hard bounces suppress the address, and it is dropped from every future recipient list — the same drop as an opt-out, so one place enforces both." },
  { signal: "Complaint — an ARF report, or Graph's reported-spam", whatHappens: "Suppressed immediately, on one signal. Someone marking a message as spam is a fact about the message, not about their mailbox." },
];

export const BOUNCE_TODAY =
  "There is no bounce handling of any kind today. A send that fails is a logger.warn line — \"Delivery is best-effort — failures are logged and never thrown, so callers are never blocked or broken by SMTP\" — and until a bounce is attached to the message that caused it, the log can only say that the send failed.";

// ── Per-client overrides ─────────────────────────────────────────────────────────────────────────

export const OVERRIDE_CHAIN: { level: string; whatItHolds: string; realToday: string }[] = [
  {
    level: "Instance",
    whatItHolds: "The brand kit, the sender identity, the quiet-hours defaults, the batch window.",
    realToday: "The brand kit is real — one EmailBrandKit row, read by every send and every preview. The rules beside it are proposed.",
  },
  {
    level: "Per board",
    whatItHolds:
      "notifyCustomerOnClose, followUpEnabled, followUpIntervalHours, autoCloseEnabled, autoCloseDays, slaResponseMinutes, slaResolutionMinutes.",
    realToday:
      "The columns are real and the Boards route writes them; only autoCloseDays and the SLA fields are read by anything today, so the other switches change a stored value and nothing else.",
  },
  {
    level: "Per client",
    whatItHolds: "Proposed: footer, from-name, quiet hours. Null means inherit, so a client carries a value only when it differs.",
    realToday: "The pattern is already in the schema for the portal: Company.portalLogoUrl and portalAccentColor are nullable for exactly this reason.",
  },
  {
    level: "Per language",
    whatItHolds: "A template's fields translated per Locale, resolved at render.",
    realToday: "The Translation table exists (localeCode/key/value/namespace); email does not read it.",
  },
  {
    level: "Revert",
    whatItHolds: "Clearing a client's value back to null restores inheritance.",
    realToday: "No copy of the instance's value is kept on the client, which is what makes a revert safe after the instance itself has changed.",
  },
];

export const OVERRIDE_FIELDS = ["Footer", "From name", "Quiet hours"] as const;

/** The schema's own sentence about nullable overrides, quoted because it is the rule being reused. */
export const OVERRIDE_PATTERN_QUOTE =
  "A null on any of these means \"use the instance's own setting\" — so a deployment configures the portal once and only the clients that differ carry values of their own.";

// ── The brand kit's assets, and the one an email needs that paper does not ────────────────────────

export const BRAND_ASSET_NOTES: { asset: string; value: string; source: string }[] = [
  { asset: "Logo (light)", value: "logoUrl — empty means the built-in shield", source: "DOCUMENT_BRAND.shield, the app icon's own artwork on its black tile, which a document's letterhead draws too" },
  { asset: "Logo (dark)", value: "logoDarkUrl — empty means the light one", source: "the artwork is already black-backed, so both weights are usually one file" },
  { asset: "Wordmark", value: "wordmark — the fallback when an image will not load", source: "the name set in type: what PrintLetterhead.tsx draws through hooks/useBrandKit when no artwork is uploaded" },
  { asset: "Primary colour", value: "primaryColor — #c00000 by default", source: "DOCUMENT_BRAND.crimson, the 7's colour everywhere else in the product" },
  { asset: "Accent colour", value: "accentColor — #00c0f4 by default", source: "DOCUMENT_BRAND.accent — the interface's and email's secondary colour, deliberately not used on paper (it measures 2.1:1 against white)" },
  { asset: "Footer text", value: "footerText — the reason the person is receiving it", source: "proposed copy; today the only footer a client sees is the composer's hard-coded paragraph" },
  { asset: "Legal line", value: "legalText — the company line", source: "DOCUMENT_BRAND.company, the line the print sheet carries" },
];

export const WORDMARK_FALLBACK_RULE =
  "The wordmark is the FIRST child of the header and the shield is decorative beside it. Outlook blocks remote images by default and Gmail proxies them, so a message that relies on the shield alone shows a broken box for a large share of readers — the header has to read when nothing loads.";

export const UNSUBSCRIBE_RULE =
  "There is no marketing in this product, so unsubscribe cannot mean what it means in a newsletter. It applies to exactly two things — report.scheduled sent to a client, and the activity digest when it is the only thing that can be stopped — and it links to the client's suppression page rather than a third-party list. An invoice notice, a closure, a portal sign-in code and an MFA code carry no unsubscribe link: they are the delivery of a service the recipient asked for, and a link offering to stop them would be a lie. Nothing stores this setting yet — the brand kit has no field for it — so it is a rule rather than a checkbox.";

export const PLAIN_TEXT_RULE =
  "Every message is sent as multipart/alternative with both parts, derived from the same blocks, so a client that strips HTML still gets a readable one. A button becomes \"Label: <full url>\" — never link text with the URL hidden; facts and tables become Label: value lines; a quote is > prefixed; an image always carries its words because the picture may not arrive; an attachment is named. The text part is derived by default and editable by exception, and when it is edited the interface shows both parts and says when the information they carry differs. POST /api/email/preview returns both, which is how a person can see what a plain-text reader receives before approving it.";

export const SENDING_IDENTITY_FACTS: { rule: string; label: string; detail: string }[] = [
  {
    rule: "SPF",
    label: "One include, and -all at the end",
    detail:
      "The relay's include has to be inside the existing v=spf1 record, not a second TXT record: two SPF records at one name is a permanent error and the receiver fails the whole check. Adding the include is an edit to the existing record.",
  },
  {
    rule: "DKIM",
    label: "The selector is part of the key's name",
    detail:
      "Publish the public key at <selector>._domainkey.<domain> and give the SAME selector to whoever signs. Get them out of step and every message fails DKIM while looking correctly configured.",
  },
  {
    rule: "DMARC",
    label: "Alignment, not just passing",
    detail:
      "A message can pass SPF on the relay's domain and still fail DMARC because the From header is this domain. Start at p=none with a reporting address, watch it, then move to quarantine — never jump to p=reject on a domain that also sends real mail.",
  },
];

export const IDENTITY_BOUNDARY = {
  cannot:
    "It cannot send mail from a domain it has not been allowed to: the From address must be one the relay accepts, and nothing on this screen can grant that permission. It cannot prove a record nobody pasted. It has no view of your DNS provider and no live DMARC report feed — and no domain record is stored anywhere yet, so a record is a shape this screen illustrates rather than a value it holds. What the kit does store is one sender name, one sender address and one reply-to, for every message alike.",
  can:
    "It reports the relay it was started with, field by field (configured · host · port · secure · hasCredentials · from), from GET /api/system/deployment — and it already sends a text part beside the HTML on the one message that carries one. This feature's rule is that every message does.",
};

/**
 * Where the reply to a ticket notification lands, and why it has to be the ticket rather than a person.
 * The inbound connector matches this product's own ticket tag, so a reply carrying `[INT-01-2006]` is
 * appended to the ticket; a reply addressed to a person stops being a ticket.
 */
export const REPLY_INTO_TICKET =
  "A reply to a customer notification carries the subject tag the product put there — [INT-01-2006] — and the inbound connector matches it (TICKET_TAG_PATTERN in packages/email/src/EmailConnector.ts) and appends it to the ticket. A reply addressed to a person lands in that person's inbox and stops being a ticket. Today no Reply-To is set at all — the registry declares replyTo: null for all twelve messages — so threading depends entirely on the subject tag surviving.";

/** The proposed configuration section, written in the registry's own shape. */
export const PROPOSED_CONFIG_SECTION = {
  id: "email",
  label: "Email & Delivery",
  summary: "The brand every message inherits, the addresses it leaves from, and the rules that decide when and to whom it goes.",
  readPermission: "Permission.EmailView",
  writePermission: "Permission.EmailManage",
  whyNotIntegrations:
    "integrations (\"C7NC & Email\") declares eight fields — the live status check, the verification throttle, emailConnectors, emailCloudConnectors, graphApi, maxAttachmentBytes, M365 offboarding and egressAllowPrivate — and every one of them is about a connection being made TO this deployment. Nothing there describes a message going out.",
  fields: [
    { id: "fromName · fromEmail · replyTo", type: "text", proposed: "already stored on the brand kit" },
    { id: "primaryColor · accentColor", type: "colour", proposed: "already stored on the brand kit" },
    { id: "logoUrl · logoDarkUrl · wordmark · footerText · legalText", type: "text / url", proposed: "already stored on the brand kit" },
    { id: "batchWindowMinutes", type: "number", proposed: `${DELIVERY_DEFAULTS.batchWindowMinutes} (min 0, max 60)` },
    { id: "batchThreshold", type: "number", proposed: `${DELIVERY_DEFAULTS.batchThreshold} (min 2)` },
    { id: "batchCeilingMinutes", type: "number", proposed: `${DELIVERY_DEFAULTS.batchCeilingMinutes} — the hard ceiling` },
    { id: "quietHoursEnabled", type: "boolean", proposed: "true" },
    { id: "quietHoursStart · quietHoursEnd", type: "clock time", proposed: `${DELIVERY_DEFAULTS.quietHoursStart} · ${DELIVERY_DEFAULTS.quietHoursEnd}` },
    { id: "digestEnabled", type: "boolean", proposed: "true" },
    { id: "unsubscribeEnabled", type: "boolean", proposed: "true — applies to report.scheduled only" },
    { id: "bounceThreshold", type: "number", proposed: `${DELIVERY_DEFAULTS.bounceThreshold} hard bounces before suppression` },
    { id: "deliveryLogRetentionDays", type: "number", proposed: `${DELIVERY_DEFAULTS.retentionDays}` },
  ],
};
