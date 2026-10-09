/**
 * What the two arrangements of the brand screen share: **the words, the state and the calls** — never
 * the layout.
 *
 * `DESIGN.md` §3 asks a screen to have two designs and to share everything except the arrangement. The
 * subject list, the field labels, the help beside each field and the sentences saying where a value came
 * from are shared here; `EmailBrandModern` draws a rail you press, rows with a sentence beside the
 * control and a sheet for a write, and `EmailBrandClassic` draws a table with an Action column, labelled
 * fields in a grid and a dialog with a heading and Save/Cancel. Neither is a restyle of the other.
 *
 * The `subtitle` is a constant because `Layout.tsx`'s `SECTION_DESCRIPTIONS` is what the classic header
 * reads: DESIGN §5 says the two must be the same sentence, and a copy in two files is a copy that drifts.
 */
import type { LucideIcon } from "lucide-react";
import { Clock, Globe, ListChecks, Mail, Palette, SlidersHorizontal, Users } from "lucide-react";
import type { ApiBrand, ClientsResponse, Read, ApiBrandValues } from "./emailApi";
import type { BrandView, SettingsView } from "./brandView";
import type { MatrixView } from "./matrixView";

/**
 * The page's subtitle, identical to the entry in `Layout.tsx`'s `SECTION_DESCRIPTIONS`.
 *
 * `Layout.tsx` is not this screen's file, so this constant is the copy the page passes to `PageHeader`;
 * if the sentence there changes, this one changes with it.
 */
export const BRAND_SUBTITLE =
  "What every message inherits — the logo, the colours, the footer and the address it is sent from.";

export type BrandSubject = "kit" | "senders" | "matrix" | "rules" | "recipients" | "overrides";

export interface SubjectSpec {
  id: BrandSubject;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

export const BRAND_SUBJECTS: SubjectSpec[] = [
  {
    id: "kit",
    label: "Brand kit",
    icon: Palette,
    blurb: "One set of assets for the PDFs and the email — including the text wordmark a mail client must fall back to.",
  },
  {
    id: "senders",
    label: "Sending identity",
    icon: Globe,
    blurb: "Which address each message leaves from, why a ticket notification replies into the ticket, and what the application can and cannot verify about a domain.",
  },
  {
    id: "matrix",
    label: "Trigger matrix",
    icon: ListChecks,
    blurb: "One row per message: when it fires, who receives it, whether the customer sees it, whether it can be turned off, and its state.",
  },
  {
    id: "rules",
    label: "Quiet hours & batching",
    icon: Clock,
    blurb: "Six changes in an hour must not be six emails: a window, a threshold, a digest, and the messages that never wait at all.",
  },
  {
    id: "recipients",
    label: "Who may be emailed",
    icon: Users,
    blurb: "The recipient rules as they are enforced today, plus opt-out and bounce handling — each with the line saying where it is applied.",
  },
  {
    id: "overrides",
    label: "Per-client overrides",
    icon: SlidersHorizontal,
    blurb: "One client on its own footer, from-name or quiet hours: how it is created, what it inherits, and how it is reverted.",
  },
];

/** The counts the rail and the table of contents show, computed from the reads. */
export function subjectCounts(
  matrix: MatrixView,
  overridden: number | null,
  clients: number | null,
  delivery: SettingsView,
): Record<BrandSubject, string> {
  return {
    kit: "9 fields",
    senders: `${matrix.rows.length} identities`,
    matrix: `${matrix.rows.length} messages`,
    rules: `${delivery.batchWindowMinutes} min · ${delivery.batchThreshold}`,
    recipients: "3 roles · 2 suppressions",
    overrides: `${overridden ?? "—"} of ${clients ?? "—"} overridden`,
  };
}

// ── The fields, and the words beside them ────────────────────────────────────────────────────────

export interface FieldCtx {
  brand: BrandView;
  canManage: boolean;
}

export interface FieldSpec {
  /** The key `PUT /api/email/brand` expects. */
  id: keyof ApiBrandValues | "logoUrl" | "logoDarkUrl" | "wordmark" | "fromName" | "fromEmail" | "replyTo";
  label: string;
  help: string;
  kind: "text" | "url" | "colour" | "longtext";
  /** The value the row shows, read from the kit's effective values. */
  value: (ctx: FieldCtx) => string;
  /** How the string becomes what the API is sent; an empty box clears the field. */
  payload: (raw: string) => unknown;
  /** `null` when the screen may offer to change it; otherwise the sentence saying why not. */
  readonly: (ctx: FieldCtx) => string | null;
}

/**
 * What an empty value means, per field, so "unset" is never left to be guessed at.
 *
 * It is a function rather than a property on each field because the same sentence has to appear in both
 * arrangements and in the sample message, and three copies of one sentence is three chances for them to
 * disagree.
 */
export function unsetNote(id: string): string {
  switch (id) {
    case "logoUrl":
      return "unset — the built-in shield, /icon-192.png, is used";
    case "logoDarkUrl":
      return "unset — the light logo is used for both";
    case "fromName":
      return "unset — the address is shown on its own";
    case "fromEmail":
      return "unset — the instance's own SMTP_FROM is used";
    case "replyTo":
      return "unset — no Reply-To is sent, which is what all twelve messages do today";
    case "legalText":
      return "unset — the company name stands in";
    case "footerText":
      return "unset — the built-in footer line is used";
    case "wordmark":
      return "unset — the product name stands in when an image will not load";
    default:
      return "unset — the built-in value is used";
  }
}

const NOT_MANAGE = "Changing the kit is email:manage, which this account does not hold.";
const READ_FAILED =
  "GET /api/email/brand did not answer, so these are the built-in defaults and lib/documentBrand.ts. They are shown rather than offered, because a change here could not be saved.";

function kitReadonly(ctx: FieldCtx): string | null {
  if (!ctx.canManage) return NOT_MANAGE;
  if (ctx.brand.source !== "api") return READ_FAILED;
  return null;
}

const asText = (raw: string) => raw.trim();
const asNullableText = (raw: string) => (raw.trim() ? raw.trim() : null);

export const KIT_FIELDS: FieldSpec[] = [
  {
    id: "productName",
    label: "Product name",
    help: "What the product is called in a message. The number in C7NTAX is the brand's, not a word.",
    kind: "text",
    value: (ctx) => ctx.brand.productName,
    payload: asText,
    readonly: kitReadonly,
  },
  {
    id: "companyName",
    label: "Company name",
    help: "The company sending the mail. This is the print sheet's own line, so a report and an email cannot disagree about who sent them.",
    kind: "text",
    value: (ctx) => ctx.brand.companyName,
    payload: asText,
    readonly: kitReadonly,
  },
  {
    id: "wordmark",
    label: "Wordmark — the fallback",
    help: "The words that stand in when a mail client refuses to load a remote image. Outlook blocks them by default, so this is not optional: the wordmark is the first thing in the header and the shield is decoration beside it.",
    kind: "text",
    value: (ctx) => ctx.brand.wordmark,
    payload: asText,
    readonly: kitReadonly,
  },
  {
    id: "logoUrl",
    label: "Logo (light)",
    help: "The shield as a mail client loads it. Empty means /icon-192.png — the app icon's own artwork, which is the file the report PDFs use.",
    kind: "url",
    value: (ctx) => (ctx.brand.stored.logoUrl ? ctx.brand.logoUrl : ""),
    payload: asNullableText,
    readonly: kitReadonly,
  },
  {
    id: "logoDarkUrl",
    label: "Logo (dark)",
    help: "The same shield on a dark tile. The artwork is already black-backed, so this is usually the same file — empty means the light one.",
    kind: "url",
    value: (ctx) => (ctx.brand.stored.logoDarkUrl ? ctx.brand.logoDarkUrl : ""),
    payload: asNullableText,
    readonly: kitReadonly,
  },
  {
    id: "primaryColor",
    label: "Primary colour",
    help: "The banner crimson, shared with the printed documents. A hex value such as #c00000.",
    kind: "colour",
    value: (ctx) => ctx.brand.primaryColor,
    payload: asText,
    readonly: kitReadonly,
  },
  {
    id: "accentColor",
    label: "Accent colour",
    help: "The rule or bar a document uses beside the primary one.",
    kind: "colour",
    value: (ctx) => ctx.brand.accentColor,
    payload: asText,
    readonly: kitReadonly,
  },
  {
    id: "footerText",
    label: "Footer text",
    help: "The line that says why the person is receiving the message — which is the question every email answers worse than it should. Empty means the built-in line.",
    kind: "longtext",
    value: (ctx) => ctx.brand.footerText,
    payload: asNullableText,
    readonly: kitReadonly,
  },
  {
    id: "legalText",
    label: "Legal line",
    help: "The company line the footer carries, and the line the print sheet carries. Empty leaves the company name alone.",
    kind: "longtext",
    value: (ctx) => ctx.brand.legalText,
    payload: asNullableText,
    readonly: kitReadonly,
  },
];

export const IDENTITY_FIELDS: FieldSpec[] = [
  {
    id: "fromName",
    label: "From name",
    help: "What a client sees beside the address. Empty falls back to the address on its own.",
    kind: "text",
    value: (ctx) => ctx.brand.fromName ?? "",
    payload: asNullableText,
    readonly: kitReadonly,
  },
  {
    id: "fromEmail",
    label: "From address",
    help: "Must be an address the relay accepts. Empty means the instance's own SMTP_FROM is used. Nothing on this screen can give a domain permission to send — only the relay can.",
    kind: "text",
    value: (ctx) => ctx.brand.fromEmail ?? "",
    payload: asNullableText,
    readonly: kitReadonly,
  },
  {
    id: "replyTo",
    label: "Reply-To",
    help: "Where a reply to a ticket message lands: the connector's mailbox, so the reply becomes a reply on the ticket rather than a message to a person. Empty sends no Reply-To at all, which is what all twelve messages do today.",
    kind: "text",
    value: (ctx) => ctx.brand.replyTo ?? "",
    payload: asNullableText,
    readonly: kitReadonly,
  },
];

/**
 * The delivery rules, as a display list rather than a form.
 *
 * There is no editor for these: the API does not expose them, so a Save could not save. Each row
 * carries the value this feature proposes and the sentence saying what it means; both arrangements draw
 * them disabled, with `NO_SETTINGS_ENDPOINT` beside them.
 */
export interface RuleField {
  id: string;
  label: string;
  help: string;
  value: (delivery: SettingsView) => string;
}

export const RULE_FIELDS: RuleField[] = [
  { id: "quietHoursEnabled", label: "Quiet hours", help: "On or off, per instance.", value: (d) => (d.quietHoursEnabled ? "On" : "Off") },
  { id: "quietHoursStart", label: "Quiet hours start", help: "24-hour clock, in the client's own timezone.", value: (d) => d.quietHoursStart },
  { id: "quietHoursEnd", label: "Quiet hours end", help: "Nothing held is released before this, and nothing is released at 07:00 to make up for it.", value: (d) => d.quietHoursEnd },
  { id: "batchWindowMinutes", label: "Batch window (minutes)", help: "Measured from the first customer-visible event. It is a hold that only becomes real if a second event arrives inside it.", value: (d) => String(d.batchWindowMinutes) },
  { id: "batchThreshold", label: "Collapse threshold", help: "The event that turns the window into a digest. Two is the minimum that can collapse anything.", value: (d) => String(d.batchThreshold) },
  { id: "batchCeilingMinutes", label: "Hard ceiling on any wait (minutes)", help: "Nothing is held longer, whatever has been queued. The ceiling is what stops a busy ticket being silent for an afternoon.", value: (d) => String(d.batchCeilingMinutes) },
  { id: "digestEnabled", label: "Digest", help: "One message listing every event in order, instead of one message per event.", value: (d) => (d.digestEnabled ? "On" : "Off") },
  { id: "bounceThreshold", label: "Hard bounces before suppression", help: "Two consecutive hard bounces suppress the address. A soft bounce never does — a full mailbox is a Tuesday.", value: (d) => String(d.bounceThreshold) },
  { id: "retentionDays", label: "Delivery log retention (days)", help: "Longer for anything that bounced, so the reason an address is suppressed outlives the message that caused it.", value: (d) => String(d.retentionDays) },
];

// ── The reads the page hands to both arrangements ────────────────────────────────────────────────

/** `GET /api/system/deployment` reports the relay under `mail` — `{ mail: { … }, database, runtime, … }`. */
export interface DeploymentMail {
  configured?: boolean;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  hasCredentials?: boolean;
  from?: string | null;
}

export interface DeploymentResponse {
  mail?: DeploymentMail;
}

export interface BoardRow {
  id: string;
  name?: string | null;
  notifyCustomerOnClose?: boolean | null;
}

/** `GET /api/boards` answers with a bare array; the list envelope is accepted too, since routes differ. */
export type BoardsResponse = BoardRow[] | { data?: BoardRow[] };

/** What the override subject can say about the instance without inventing an endpoint. */
export interface OverrideSummary {
  clients: number | null;
  brandOverridden: number | null;
  clientsMessage: string | null;
  boards: number | null;
  boardsDiffering: number | null;
  boardNamesDiffering: string[];
  boardsMessage: string | null;
}

export interface EmailBrandProps {
  /* the reads, so a subject can draw its own "could not be read" panel */
  messages: Read<unknown>;
  brand: Read<ApiBrand>;
  relay: Read<DeploymentResponse>;
  clientsRead: Read<ClientsResponse>;
  boardsRead: Read<BoardsResponse>;
  /* resolved */
  brandView: BrandView;
  delivery: SettingsView;
  matrix: MatrixView;
  overrides: OverrideSummary;
  /* who may write */
  canManage: boolean;
  /* the chosen subject — the page owns it so the choice survives a reload */
  subject: BrandSubject;
  onSubject: (subject: BrandSubject) => void;
  /* the one write */
  saving: boolean;
  writeError: string | null;
  onSaveBrand: (patch: Record<string, unknown>) => void;
}

/** The icon the rail's foot uses, where a subject wants one. */
export const SUBJECT_ICON: LucideIcon = Mail;
