/**
 * The send sheet — the moment a person actually sends something.
 *
 * Three entry points into one sheet: **a note to a client** (a ticket's thread and its fields),
 * **an invoice** (the invoice's own PDF attached, the amount and the due date in the body, and what the
 * customer is told) and **a report** (a saved report attached as PDF with a covering note). The state,
 * the send call and the words are the same in all three; what differs is the contents. That is why the
 * **contents chooser is a separate list from the composition**: the owner asked to choose *what
 * information gets sent*, not to rearrange a layout, so the facts are switchable on their own while the
 * message's blocks are listed beside them and edit the same state. One choice, two views.
 *
 * ── The three states of confidence, and why all three are drawn ─────────────────────────────────────
 *
 * *Before* — the preview **is** the message (`POST /api/email/preview`, never a second renderer), and
 * the button names the recipients and counts them.
 * *During* — the exact list the mailer receives: `to`, `cc`, `bcc`, the subject, the attachments and the
 * inline parts, all built before the call rather than summarised after it.
 * *After* — what went, to whom, with a message id and a time, and the three answers when it was wrong:
 * resend the same message, send a correction, or read the log. A sheet that draws only the happy middle
 * is a sheet of a button, so a *failure* is a state of its own and keeps the API's own words — the
 * ticket and billing routes already answer `The email could not be sent — check the SMTP configuration
 * under Administration → System Settings`, and this sheet repeats that rather than inventing a friendlier
 * sentence or pretending to have sent.
 *
 * ── Both parts of the message are shown ─────────────────────────────────────────────────────────────
 *
 * Every message leaves as `multipart/alternative`: the HTML and a plain-text part derived from the same
 * blocks. The owner asked for this in so many words — some mail systems strip the HTML — so the text
 * part sits *beside* the HTML in both arrangements, with the full URLs written out, and the sheet says
 * which of the two it is showing and whether they carry the same facts.
 *
 * ── Two designs, deliberately ───────────────────────────────────────────────────────────────────────
 *
 * The **modern** arrangement is a sheet: a record band, a step track you follow, chips you press for the
 * template, the blocks as a rail of switches with the sentence beside the control that acts, and the
 * preview and the text part pinned in the second column.
 * The **classic** arrangement is a form: a dialog with a heading, labelled fields in a grid (`To`, `Cc`,
 * `Bcc`, `Template` as a `select`, `Subject`, `Message`), the contents list as an ordinary list of
 * checkboxes in field order, a preview pane that is *permanently* in view rather than revealed, and
 * `Cancel` / `Send`. It is read top to bottom once before the send, which is the shape a classic form
 * has and a modern sheet does not.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertTriangle, ArrowRight, Check, FileText, Loader2, Mail, Paperclip, RefreshCw, Send, X,
} from "lucide-react";
import api from "../../api";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { toAttachmentDraft, type EmailAttachmentDraft } from "../richText";
import { EMAIL_MESSAGE_KEYS, type EmailMessageKey } from "@C7NTAX/shared";
import { blockIsRequired, codeBlocksFor } from "./emailCodeV0";
import { EMAIL_FACTS_BY_KEY } from "./emailCatalogue";
import { resolveFields } from "./emailRecords";
import {
  BothPartsNote, CallNote, EMAIL_API, PreviewFrame, Switch, TextPane, Tile, blockLabel,
  blockPlainText, blockReads, blockSummary, blockText, checkAttachment, compareTextFacts,
  describeFailure, derivePlainText, formatBytes, isEditable, readPreview, selectedBlocks, tokensInBlock, unwrap,
  withBlockText,
  type AttachmentRef, type CallFailure, type EmailBlock, type EmailTemplate, type PreviewState,
} from "./sendKit";

// ── What a caller hands the sheet ────────────────────────────────────────────

/** The invoice fields the sheet reads. `Billing.tsx`'s own `Invoice` is assignable to this. */
export interface SendSheetInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  subtotal?: number;
  issueDate?: string;
  dueDate: string;
  lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  company: { id?: string; name?: string } | null;
}

export type SendSheetContext =
  | { kind: "ticket"; id: string }
  | { kind: "invoice"; invoice: SendSheetInvoice }
  | {
      kind: "report";
      id: string;
      title: string;
      /** The client whose copy this is; without one the recipients are typed by hand. */
      companyId?: string;
      /** A schedule's stored addresses, shown as the schedule's own rather than chosen for it. */
      scheduleRecipients?: string[];
      scheduleName?: string;
    };

export interface SendOutcome {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  messageId?: string;
  attachments: string[];
  /** Set when the instance has no general send endpoint and the invoice was only marked sent. */
  statusOnly?: boolean;
}

/** The message key each entry point starts from. */
const KEY_FOR_CONTEXT: Record<SendSheetContext["kind"], string> = {
  ticket: "ticket.note",
  invoice: "invoice.send",
  report: "report.scheduled",
};

// ── Record shapes the sheet reads (the API's own payloads) ───────────────────

interface TicketRecord {
  id: string;
  ticketNumber: string;
  title: string;
  status: string;
  priority?: string | null;
  company?: { id?: string; name?: string } | null;
  contact?: { firstName?: string; lastName?: string; email?: string | null } | null;
  additionalContacts?: Array<{
    id: string;
    role?: string;
    notifyOnNote?: boolean;
    contact?: { id?: string; firstName?: string; lastName?: string; email?: string };
  }>;
  comments?: Array<{
    id: string;
    body: string;
    isInternal?: boolean;
    isEmail?: boolean;
    createdAt: string;
    author?: { firstName?: string; lastName?: string } | null;
  }>;
  timeEntries?: Array<{ id: string; minutes: number; billable?: boolean; noCharge?: boolean; rate?: number | null; date: string }>;
  attachments?: Array<{ id: string; filename: string; size?: number }>;
  board?: { name?: string; notifyOnClose?: boolean } | null;
}

interface ClientRecord {
  id: string;
  name: string;
  billingEmail?: string | null;
  portalEnabled?: boolean;
  contacts?: Array<{ id: string; firstName?: string; lastName?: string; email?: string | null; isPrimary?: boolean; title?: string | null }>;
}

// ── Facts, and the blocks each one owns ──────────────────────────────────────

interface Fact {
  key: string;
  name: string;
  say: string;
  /** Blocks whose words or values name this fact. A fact that owns no block is reported as absent. */
  owns: (block: EmailBlock) => boolean;
  /** Never selectable, and the row says why instead of drawing a switch that cannot move. */
  lockedOn?: boolean;
  lockedOff?: string;
}

/** One row of `GET /email/messages`: the registry's facts about a key, with the template in force. */
interface ApiMessageEntry {
  key: string;
  live?: boolean;
  trigger?: string;
  recipients?: string;
  attachments?: string | null;
  requiredTokens?: string[];
  /** The template as stored — `subject`, `blocks`, `text`, `derivedText` and its state. */
  template?: EmailTemplate | null;
}

function isMessageKey(value: string): value is EmailMessageKey {
  return (EMAIL_MESSAGE_KEYS as readonly string[]).includes(value);
}

/** Every word a block carries, lowercased, so a fact can be found inside it. */
function blockSearchText(block: EmailBlock): string {
  const parts: string[] = [block.kind];
  switch (block.kind) {
    case "heading": parts.push(block.text); break;
    case "paragraph": parts.push(blockPlainText(block.html)); break;
    case "button": parts.push(block.label, block.href); break;
    case "facts": parts.push(block.title ?? "", ...block.items.flatMap((item) => [item.label, item.value])); break;
    case "quote": parts.push(blockPlainText(block.html), block.source ?? ""); break;
    case "table": parts.push(block.title ?? "", ...block.columns, ...block.rows.flat()); break;
    case "image": parts.push(block.alt, block.src); break;
    case "note": parts.push(block.text); break;
    case "attachment": parts.push(block.name, block.note ?? ""); break;
    case "conditional": parts.push(block.when, ...block.blocks.map(blockSearchText)); break;
    default: break;
  }
  return parts.join(" ").toLowerCase();
}

function mentions(needles: string[]) {
  return (block: EmailBlock) => {
    const hay = blockSearchText(block);
    return needles.some((needle) => hay.includes(needle));
  };
}

function isKind(...kinds: EmailBlock["kind"][]) {
  return (block: EmailBlock) => kinds.includes(block.kind);
}

function anyOf(...tests: Array<(block: EmailBlock) => boolean>) {
  return (block: EmailBlock) => tests.some((test) => test(block));
}

// ── Names and figures ────────────────────────────────────────────────────────

function personName(contact?: { firstName?: string; lastName?: string } | null): string {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || "Unnamed contact";
}

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000);
}

function dateWords(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(2).replace(/\.00$/, "")} h`;
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── The sheet ────────────────────────────────────────────────────────────────

export function EmailSendDialog({
  context, onClose, onSent,
}: {
  context: SendSheetContext;
  onClose: () => void;
  /** So the page can refresh what it owns — Billing refetches its invoices after a real send. */
  onSent?: (outcome: SendOutcome) => void;
}) {
  const redesign = useRedesign();
  const navigate = useNavigate();

  // Records the sheet reads rather than guesses.
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [clientFailure, setClientFailure] = useState<CallFailure | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  /**
   * What the live catalogue says about each key beyond its words: who reads it, what it carries and
   * which tokens are mechanisms rather than copy. `GET /email/messages` returns the template nested
   * under `template`, with those facts beside it.
   */
  const [messageFacts, setMessageFacts] = useState<ApiMessageEntry[] | null>(null);
  const [catalogueFailure, setCatalogueFailure] = useState<CallFailure | null>(null);

  // Composition.
  const [templateKey, setTemplateKey] = useState(KEY_FOR_CONTEXT[context.kind]);
  const [subject, setSubject] = useState("");
  /** True once the author has typed a subject, so a resolved one is never written over their words. */
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [off, setOff] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [factsOff, setFactsOff] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Recipients.
  const [primaryOn, setPrimaryOn] = useState(true);
  const [contactOn, setContactOn] = useState<Record<string, boolean>>({});
  const [extraCc, setExtraCc] = useState<string[]>([]);
  const [typedCc, setTypedCc] = useState("");

  // Attachments.
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploads, setUploads] = useState<EmailAttachmentDraft[]>([]);
  const [refusedFile, setRefusedFile] = useState<{ name: string; bytes: number } | null>(null);
  /** A file that is too big for the mail server, offered as a link into the customer portal instead. */
  const [portalLink, setPortalLink] = useState<string | null>(null);

  // The call.
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [phase, setPhase] = useState<"compose" | "sending" | "sent" | "failed">("compose");
  const [sent, setSent] = useState<SendOutcome | null>(null);
  const [sendFailure, setSendFailure] = useState<CallFailure | null>(null);
  const previewToken = useRef(0);

  /**
   * The record this message is *about*, as the API names it. Defined before the effects that read it,
   * because a dependency array is evaluated during the render.
   */
  const contextRef = {
    kind: context.kind,
    id: context.kind === "invoice" ? context.invoice.id : context.id,
  };
  const contextKey = `${contextRef.kind}:${contextRef.id}`;

  /** The record the merge fields resolve against, as the shared field resolver names it. */
  const recordId = context.kind === "invoice"
    ? context.invoice.invoiceNumber
    : context.kind === "ticket"
      ? ticket?.ticketNumber ?? null
      : null;

  /**
   * The subject that actually goes.
   *
   * The message's own subject is a template string carrying merge fields; the renderer resolves them
   * against the record. The author's own words are never rewritten, so this is their subject when they
   * have typed one and the resolved one otherwise — and the resolved form is what the field shows once
   * the preview answers.
   */
  const outgoingSubject = subjectTouched ? subject : resolveFields(subject, recordId);

  const template = useMemo(
    () => templates?.find((entry) => entry.key === templateKey) ?? null,
    [templates, templateKey],
  );
  /** The live catalogue's own facts for the key, which the code's own catalogue stands in for when absent. */
  const live = useMemo(
    () => messageFacts?.find((entry) => entry.key === templateKey) ?? null,
    [messageFacts, templateKey],
  );
  /** The code's own body for the key, from the one place that composition is written down. */
  const codeBlocks = useMemo<EmailBlock[]>(
    () => (isMessageKey(templateKey) ? codeBlocksFor(templateKey) : []),
    [templateKey],
  );
  /**
   * Which composition this is. `fromCode` is not a failure: the code's own body is the v0 every
   * instance starts from, and the sheet says which one it is showing rather than leaving the reader to
   * wonder whether they are looking at a stored template.
   */
  const fromCode = !template;
  const fact = EMAIL_FACTS_BY_KEY[templateKey];
  /** Who the message is written for: the live catalogue's answer, or the code's own when it is unread. */
  const reader = live?.recipients ?? fact?.reader;
  /** True when no code path reaches the sender — the finding the sheet must not dress up. */
  const neverSent = live ? live.live === false : fact?.live === false;

  /** Memoised: `template?.blocks ?? []` would be a new array every render, and a new array re-runs the preview. */
  const blocks = useMemo<EmailBlock[]>(() => (template ? template.blocks : codeBlocks), [template, codeBlocks]);

  // ── Load: the catalogue of messages ──
  useEffect(() => {
    let alive = true;
    api.get(EMAIL_API.messages)
      .then((response) => {
        if (!alive) return;
        const payload = unwrap<{ messages?: ApiMessageEntry[] } | ApiMessageEntry[]>(response.data);
        // Two shapes are in the wild: the catalogue's own `{ messages: [...] }` and a bare array. An
        // entry may be the template itself or the registry row with the template nested under `template`.
        const list: ApiMessageEntry[] = Array.isArray(payload) ? payload : payload?.messages ?? [];
        const found: EmailTemplate[] = [];
        const facts: ApiMessageEntry[] = [];
        for (const entry of list) {
          if (!entry?.key) continue;
          const nested = entry.template;
          const dto: EmailTemplate | null = nested && Array.isArray(nested.blocks)
            ? nested
            : Array.isArray((entry as unknown as EmailTemplate).blocks)
              ? (entry as unknown as EmailTemplate)
              : null;
          if (!dto) continue;
          found.push(dto);
          facts.push(entry);
        }
        setMessageFacts(facts);
        if (!found.length) {
          setCatalogueFailure({ endpoint: EMAIL_API.messages, reason: "the catalogue answered, but without a template or a block list in it", absent: false });
          setTemplates(null);
          return;
        }
        setTemplates(found);
        setCatalogueFailure(null);
      })
      .catch((error) => {
        if (!alive) return;
        setCatalogueFailure(describeFailure(EMAIL_API.messages, error));
      });
    return () => { alive = false; };
  }, []);

  // ── Load: the record the context names ──
  useEffect(() => {
    let alive = true;
    if (context.kind === "ticket") {
      api.get(`/tickets/${context.id}`)
        .then((response) => { if (alive) setTicket(unwrap<TicketRecord>(response.data)); })
        .catch((error) => { if (alive) setClientFailure(describeFailure(`/tickets/${context.id}`, error)); });
    }
    const companyId = context.kind === "invoice" ? context.invoice.company?.id : context.kind === "report" ? context.companyId : undefined;
    if (companyId) {
      api.get(`/clients/${companyId}`)
        .then((response) => { if (alive) setClient(unwrap<ClientRecord>(response.data)); })
        .catch((error) => { if (alive) setClientFailure(describeFailure(`/clients/${companyId}`, error)); });
    }
    return () => { alive = false; };
    // The context object is rebuilt by the caller's JSX, so the identity that matters is the record's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, context.kind]);

  useEffect(() => {
    // The sender's own subject, shown rather than hidden. When the catalogue cannot be read this is the
    // literal the code writes (`Invoice {n} — Due {due}`), so the author can see and correct it.
    const written = template?.subject || fact?.subject || "";
    if (written) setSubject((current) => current || written);
  }, [template, fact]);

  useEffect(() => {
    // The subject as written carries merge fields. The renderer resolves them against the record, and the
    // resolved subject is what the recipient reads — so it is what the field shows, until the author types
    // their own. Without this the sheet displays `Invoice {{invoice.number}}` in the one line everybody reads.
    if (preview.status === "ready" && preview.preview.subject && !subjectTouched) {
      setSubject((current) => (current === preview.preview.subject ? current : preview.preview.subject));
    }
  }, [preview, subjectTouched]);

  useEffect(() => {
    setSubject("");
    setSubjectTouched(false);
    setOff(new Set());
    setEdits({});
  }, [templateKey]);

  // ── Attachments the sheet will carry ──
  const recordAttachments = useMemo<AttachmentRef[]>(() => {
    if (context.kind === "invoice") {
      return [{
        kind: "invoice",
        id: context.invoice.id,
        name: `invoice-${context.invoice.invoiceNumber}.pdf`,
        why: `generated by ${EMAIL_API.invoicePdf(context.invoice.id)} — the letterhead page Billing already prints`,
      }];
    }
    if (context.kind === "report") {
      return [{
        kind: "report",
        id: context.id,
        name: `${slug(context.title) || context.id}.pdf`,
        why: "the report's own export — A4, banded and page-numbered, produced by the same path as its PDF button",
      }];
    }
    return (ticket?.attachments ?? []).map((file) => ({
      kind: "ticketAttachment" as const,
      id: file.id,
      name: file.filename,
      bytes: file.size,
      why: `already on ${ticket?.ticketNumber ?? "this ticket"} — read by ticketId, so no other ticket's file can be offered here`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, ticket]);

  useEffect(() => {
    // A billing send is the document, and a report send is the report: those two start attached.
    setAttachments(recordAttachments.filter((entry) => entry.kind !== "ticketAttachment"));
  }, [recordAttachments]);

  // ── Recipients ──
  interface Candidate {
    key: string;
    name: string;
    email: string;
    /** Which header it belongs in when it is on. */
    channel: "to" | "cc";
    /** The rule that put it here, in the words the person needs to judge it. */
    why: string;
    /** False when the rule offers it but does not put it on. */
    on: boolean;
    /** Notes only — the ticket's own per-contact rule (`TicketContact.notifyOnNote`). */
    notesOnly?: boolean;
  }

  const candidates = useMemo<Candidate[]>(() => {
    if (context.kind === "invoice") {
      const contacts = client?.contacts ?? [];
      const primary = contacts.find((contact) => contact.isPrimary && contact.email) ?? contacts.find((contact) => contact.email) ?? null;
      const out: Candidate[] = [];
      if (client?.billingEmail) {
        out.push({ key: "billing", name: "Billing address", email: client.billingEmail, channel: "to", why: "the client's own billingEmail", on: true });
      } else if (client) {
        out.push({ key: "billing-missing", name: "No billing address", email: "", channel: "to", why: `${client.name}'s billingEmail is null, and a contact has no billing flag — only isPrimary, a title and a department`, on: false });
      }
      if (primary?.email) {
        out.push({
          key: `contact-${primary.id}`,
          name: personName(primary),
          email: primary.email,
          channel: "to",
          why: client?.billingEmail ? "the client's primary contact — offered as well as the billing address" : "the client's primary contact, because there is no billing address to use",
          on: !client?.billingEmail,
        });
      }
      for (const contact of (client?.contacts ?? []).filter((entry) => entry.email && entry.id !== primary?.id)) {
        out.push({ key: `contact-${contact.id}`, name: personName(contact), email: contact.email!, channel: "cc", why: contact.title ? `${contact.title} — a contact of this client, not copied by default` : "a contact of this client, not copied by default", on: false });
      }
      return out;
    }
    if (context.kind === "ticket") {
      if (!ticket) return [];
      const out: Candidate[] = [];
      const primaryEmail = ticket.contact?.email?.trim();
      if (primaryEmail) {
        out.push({ key: "primary", name: personName(ticket.contact), email: primaryEmail, channel: "to", why: "the ticket's own contact", on: true });
      }
      for (const link of ticket.additionalContacts ?? []) {
        const email = link.contact?.email?.trim();
        if (!email) continue;
        const isCc = link.role === "cc";
        out.push({
          key: `link-${link.id}`,
          name: personName(link.contact),
          email,
          channel: isCc ? "cc" : "to",
          why: isCc
            ? "copied on every customer-facing ticket email"
            : link.notifyOnNote
              ? "an additional contact with “email this contact notes” switched on — offered for a note only"
              : "an additional contact with “email this contact notes” switched off — the switch is on the ticket, and it is off",
          on: isCc,
          notesOnly: !isCc,
        });
      }
      return out;
    }
    // A report goes to the client whose copy it is.
    const contacts = client?.contacts ?? [];
    const primary = contacts.find((contact) => contact.isPrimary && contact.email) ?? contacts.find((contact) => contact.email) ?? null;
    const out: Candidate[] = [];
    if (primary?.email) {
      out.push({ key: `contact-${primary.id}`, name: personName(primary), email: primary.email, channel: "to", why: "this client's primary contact", on: true });
    }
    for (const address of context.scheduleRecipients ?? []) {
      out.push({ key: `schedule-${address}`, name: "The schedule's address", email: address, channel: "cc", why: `stored on ${context.scheduleName ?? "the schedule"} — an internal placeholder until somebody says otherwise, so it is not chosen for you`, on: false });
    }
    return out;
  }, [context, client, ticket]);

  // The initial on/off for each candidate, remembered across the record's arrival.
  useEffect(() => {
    setContactOn((current) => {
      const next = { ...current };
      for (const candidate of candidates) {
        if (next[candidate.key] === undefined) next[candidate.key] = candidate.on;
      }
      return next;
    });
  }, [candidates]);

  const chosen = candidates.filter((candidate) => contactOn[candidate.key] && candidate.email);
  const to = [
    ...(context.kind === "ticket" ? chosen.filter((c) => c.channel === "to" && (primaryOn || c.key !== "primary")).map((c) => c.email) : []),
    ...(context.kind !== "ticket" ? chosen.filter((c) => c.channel === "to").map((c) => c.email) : []),
  ];
  const cc = [...chosen.filter((c) => c.channel === "cc").map((c) => c.email), ...extraCc];
  const recipientCount = new Set([...to, ...cc]).size;
  const primaryOff = context.kind === "ticket" && !primaryOn;

  // ── The facts, per entry point ──
  const facts = useMemo<Fact[]>(() => {
    if (context.kind === "invoice") {
      const invoice = context.invoice;
      const past = daysBetween(invoice.dueDate, new Date());
      const lineItems = invoice.lineItems ?? [];
      return [
        { key: "amount", name: "Amount due and due date", say: `${money(invoice.total)} · ${dateWords(invoice.dueDate)}`, owns: mentions(["invoice.total", "invoice.duedate", "amount due", "amount:", "due date"]) },
        { key: "pay", name: "Pay-online button", say: "the template's own link, kept exactly as it is", owns: isKind("button") },
        { key: "overdue", name: "Days past due", say: past > 0 ? `${past} — read from the due date` : `${Math.abs(past)} days before it is due`, owns: mentions(["daysoverdue", "past due", "days overdue"]) },
        { key: "bank", name: "Bank transfer details", say: "no such field exists on a client, an invoice or the configuration, so it is not offered", owns: mentions(["bank", "iban", "sort code"]), lockedOff: "there is no field to fill it from" },
        { key: "pdf", name: "The invoice PDF", say: "always attached — the document is the message", owns: isKind("attachment"), lockedOn: true },
        { key: "lineitems", name: "Line items table", say: lineItems.length ? `${lineItems.length} line item${lineItems.length === 1 ? "" : "s"}` : "this invoice carries no line items", owns: mentions(["lineitem", "line item"]), lockedOff: lineItems.length ? undefined : "the invoice has no line items to list" },
        { key: "tickets", name: "Ticket history from the billing run", say: "off, and worth saying why: billing-aging and revenue list other clients' balances", owns: mentions(["billing-aging", "revenue", "source ticket"]), lockedOff: "it would put other clients' figures in this client's copy" },
        { key: "footer", name: "Letterhead footer block", say: "the PDF's own letterhead, reused — the brand footer, not the document's", owns: anyOf(isKind("footer", "signature")) },
      ];
    }
    if (context.kind === "ticket") {
      const visible = (ticket?.comments ?? []).filter((comment) => !comment.isInternal);
      const last = visible.find((comment) => !comment.isEmail) ?? visible[0] ?? null;
      const internal = (ticket?.comments ?? []).filter((comment) => comment.isInternal);
      const entries = ticket?.timeEntries ?? [];
      const minutes = entries.reduce((total, entry) => total + entry.minutes, 0);
      const amount = entries.reduce((total, entry) => total + (entry.billable && !entry.noCharge && entry.rate ? (entry.minutes / 60) * entry.rate : 0), 0);
      return [
        { key: "number", name: "Ticket number and title", say: "in the header and in the footer", owns: mentions(["ticket.number", "ticket.title"]) },
        { key: "greeting", name: "Greeting by first name", say: `contactName — ${ticket?.contact?.firstName ?? "the contact"}`, owns: mentions(["contact.firstname", "contactname", "contact.fullname"]) },
        { key: "quote", name: "Quote the thread", say: last ? `the last client-visible comment, ${dateWords(last.createdAt)}` : "there is no client-visible comment to quote", owns: anyOf(isKind("quote"), mentions(["note.body", "ticket.hasnote"])), lockedOff: last ? undefined : "there is nothing on this ticket the client has seen" },
        { key: "time", name: "Include time entries", say: entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} · ${hours(minutes)}${amount ? ` · ${money(amount)}` : ""}` : "no time has been logged on this ticket", owns: anyOf(mentions(["ticket.hastimeentries", "time on this ticket", "timeentries"]), (block) => block.kind === "table"), lockedOff: entries.length ? undefined : "the ticket has no time entries" },
        { key: "internal", name: "Internal notes", say: `${internal.length} on this ticket and none can be selected — internal is internal`, owns: () => false, lockedOff: "internal is internal" },
        { key: "board", name: "Board policy line", say: ticket?.board?.name ? `${ticket.board.name} ${ticket.board.notifyOnClose === false ? "does not email the client on closure" : "closes by emailing the client"}` : "read from the ticket's board", owns: mentions(["board.", "closes by emailing", "notifyonclose"]) },
        { key: "sla", name: "SLA figures", say: "withheld — they are the provider's numbers, not the client's", owns: mentions(["sla"]), lockedOff: "not the client's numbers to read" },
      ];
    }
    return [
      { key: "pdf", name: "The report PDF", say: "the document, attached", owns: isKind("attachment"), lockedOn: true },
      { key: "kpis", name: "Headline figures in the body", say: "so the email is readable without opening the PDF", owns: anyOf(mentions(["kpi", "figures", "raised"]), isKind("facts", "table")) },
      { key: "others", name: "Other clients' figures", say: "the revenue and billing-aging reports list every client's balances — a document that names another client is not offered", owns: mentions(["revenue", "billing-aging", "other client"]), lockedOff: "it would leak the rest of the book" },
      { key: "period", name: "Period covered", say: "worth saying so the recipient knows what window the figures are", owns: mentions(["period", "covered"]) },
      { key: "footer", name: "The report's own footer line", say: "{{page}} is deliberately unavailable here — see the designer tie-in", owns: anyOf(isKind("footer", "signature")) },
    ];
  }, [context, client, ticket]);

  // A fact that is switched off takes its blocks out; a block whose kinds no fact owns is untouched.
  const ownOff = useMemo(() => {
    const set = new Set(off);
    for (const fact of facts) {
      if (!factsOff.has(fact.key)) continue;
      blocks.forEach((block, index) => { if (fact.owns(block)) set.add(index); });
    }
    return set;
  }, [off, facts, factsOff, blocks]);

  const composed = useMemo(() => {
    const chosen = selectedBlocks(blocks, ownOff)
      .map((block, index) => (edits[index] === undefined ? block : withBlockText(block, edits[index]!)));
    // A file too big to travel becomes a link the recipient can follow instead — the message stays whole
    // without the mail server refusing it.
    return portalLink
      ? [...chosen, { kind: "button" as const, label: "Download it from the customer portal", href: portalLink }]
      : chosen;
  }, [blocks, ownOff, edits, portalLink]);

  // ── The preview: the message that will actually be sent ──

  useEffect(() => {
    if (!blocks.length) {
      // With no message there is nothing to preview, and saying "reading…" forever would be a lie.
      setPreview({
        status: "failed",
        failure: catalogueFailure ?? { endpoint: EMAIL_API.messages, reason: "the message catalogue has not been read, and there is no composition for this key", absent: false },
      });
      return;
    }
    const token = ++previewToken.current;
    setPreview({ status: "loading" });
    const timer = setTimeout(() => {
      api.post(EMAIL_API.preview, {
        key: templateKey,
        // Only an edited subject is sent: the message's own subject is a template string carrying merge
        // fields, and the renderer resolves them against the record. Sending the literal back would have
        // the sheet show `Invoice {{invoice.number}}` in the one field a recipient always reads.
        ...(subjectTouched ? { subject } : {}),
        blocks: composed,
        // The API previews against a ticket, an invoice or the sample records. A report has no record
        // of its own in the renderer yet, and the sheet says so rather than pretending otherwise.
        target: contextRef.kind === "report" ? { kind: "sample" } : { kind: contextRef.kind, id: contextRef.id },
      })
        .then((response) => {
          if (previewToken.current !== token) return;
          const read = readPreview(response.data);
          setPreview(read
            ? { status: "ready", preview: read }
            : { status: "failed", failure: { endpoint: EMAIL_API.preview, reason: "the preview came back without a message in it", absent: false } });
        })
        .catch((error) => {
          if (previewToken.current !== token) return;
          setPreview({ status: "failed", failure: describeFailure(EMAIL_API.preview, error) });
        });
    }, 320);
    return () => clearTimeout(timer);
    // `composed`, `subject` and the context are the whole input to the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, templateKey, composed, subject, subjectTouched, contextKey, catalogueFailure]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "sending") onClose();
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && phase === "compose") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── The send ──
  const payload = useCallback(() => ({
    context: contextRef,
    to,
    cc,
    bcc: [] as string[],
    subject: outgoingSubject,
    blocks: composed,
    attachments: attachments.map((entry) => ({ kind: entry.kind, id: entry.id, filename: entry.name })),
    uploads: uploads.map((file) => ({ filename: file.filename, mimeType: file.mimeType, contentBase64: file.contentBase64 })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [contextKey, to.join(","), cc.join(","), outgoingSubject, composed, attachments, uploads]);

  async function submit() {
    if (!to.length) { toast.error("Add at least one recipient — a mail client needs a To"); return; }
    setPhase("sending");
    setSendFailure(null);
    try {
      const response = await api.post(EMAIL_API.send, payload());
      const body = unwrap<{ messageId?: string }>(response.data);
      finish({ to, cc, bcc: [], subject, messageId: body?.messageId, attachments: attachments.map((entry) => entry.name) });
    } catch (error) {
      const failure = describeFailure(EMAIL_API.send, error);
      const canMarkOnly = context.kind === "invoice";
      if (failure.absent && canMarkOnly) {
        setPhase("compose");
        setSendFailure(failure);
        return;
      }
      setSendFailure(failure);
      setPhase("failed");
    }
  }

  /** The invoice's own route, which writes the status and sends nothing. Offered only as itself. */
  async function markSentOnly() {
    if (context.kind !== "invoice") return;
    setPhase("sending");
    try {
      await api.post(EMAIL_API.invoiceSend(context.invoice.id));
      finish({ to, cc, bcc: [], subject, attachments: [], statusOnly: true });
    } catch (error) {
      setSendFailure(describeFailure(EMAIL_API.invoiceSend(context.invoice.id), error));
      setPhase("failed");
    }
  }

  function finish(outcome: SendOutcome) {
    setSent(outcome);
    setPhase("sent");
    onSent?.(outcome);
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: EmailAttachmentDraft[] = [];
    for (const file of Array.from(files)) {
      const verdict = checkAttachment(file);
      if (!verdict.ok) {
        setRefusedFile({ name: file.name, bytes: "bytes" in verdict ? verdict.bytes : file.size });
        toast.error(verdict.reason);
        continue;
      }
      next.push(await toAttachmentDraft(file));
    }
    if (next.length) setUploads((current) => [...current, ...next].slice(0, 10));
  }

  // ── Figures the sheet states, all read from what it holds ──
  const inlineImages = preview.status === "ready" ? (preview.preview.html.match(/src="cid:/g) ?? []).length : 0;
  const carriedBytes = attachments.reduce((total, entry) => total + (entry.bytes ?? 0), 0);
  const generatedFiles = attachments.filter((entry) => entry.bytes === undefined).length;
  const messageBytes = carriedBytes + uploads.reduce((total, file) => total + file.size, 0) + (preview.status === "ready" ? preview.preview.html.length : 0);
  const tooBig = refusedFile !== null;

  /**
   * The text part. From the API when it answers — that is the one that will be sent — and otherwise
   * derived from the same blocks by the shared renderer, with the fields resolved against this record.
   * Which of the two it is, the pane says.
   */
  const localText = useMemo(() => derivePlainText(composed, (value) => resolveFields(value, recordId)), [composed, recordId]);
  const textPart = preview.status === "ready" ? (preview.preview.text || preview.preview.derivedText) : localText;
  /**
   * Whether the text part is the text of the blocks.
   *
   * `text` is the part that will be sent; `derivedText` is the same blocks through the renderer. They
   * differ only when somebody has edited the text part, and that is exactly when the interface owes a
   * warning — a message read in a client that strips HTML has to be the same message. The detail comes
   * from the shared comparison of the two *texts*, not of the HTML: a URL lives in an `href`, so
   * comparing the HTML's text form against the text part would report every link as missing.
   */
  const textEdited = preview.status === "ready" && textPart.trim() !== preview.preview.derivedText.trim();
  const difference = preview.status === "ready" && textEdited
    ? compareTextFacts(preview.preview.derivedText, textPart)
    : null;
  /** Null while there is no API text to compare against, so the note can say that rather than claim agreement. */
  const agree = preview.status === "ready" ? !textEdited : null;
  const sendLabel = recipientCount
    ? `Send to ${recipientCount} ${recipientCount === 1 ? "person" : "people"}`
    : "Send";
  const attachmentBox = (
    <div className="space-y-2">
      {attachments.map((entry) => (
        <div key={`${entry.kind}-${entry.id}`} className="flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-light p-2.5">
          <FileText size={15} className="mt-0.5 shrink-0 text-cyber-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white">{entry.name}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">{entry.why}{entry.bytes ? ` · ${formatBytes(entry.bytes)}` : ""}</p>
          </div>
          {entry.kind !== "invoice" && entry.kind !== "report" && (
            <button className="text-[11px] text-gray-400 hover:text-white" onClick={() => setAttachments((current) => current.filter((item) => item !== entry))}>Remove</button>
          )}
          {entry.kind === "ticketAttachment" && <span className="chip chip--good">on the ticket</span>}
          {entry.kind !== "ticketAttachment" && <span className="chip">generated on send</span>}
        </div>
      ))}
      {uploads.map((file) => (
        <div key={file.filename} className="flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-light p-2.5">
          <Paperclip size={15} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white">{file.filename}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">{formatBytes(file.size)} · from this machine</p>
          </div>
          <button className="text-[11px] text-gray-400 hover:text-white" onClick={() => setUploads((current) => current.filter((item) => item !== file))}>Remove</button>
        </div>
      ))}
      {(ticket?.attachments?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-surface-border p-2.5">
          <p className="text-[11px] uppercase tracking-wider text-gray-500">From {ticket?.ticketNumber}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(ticket?.attachments ?? []).map((file) => {
              const on = attachments.some((entry) => entry.id === file.id);
              return (
                <button
                  key={file.id}
                  type="button"
                  aria-pressed={on}
                  className={`chip ${on ? "chip--on" : ""}`}
                  onClick={() => setAttachments((current) => on
                    ? current.filter((entry) => entry.id !== file.id)
                    : [...current, { kind: "ticketAttachment", id: file.id, name: file.filename, bytes: file.size, why: `${ticket?.ticketNumber}'s own file` }])}
                >
                  {file.filename}{file.size ? ` · ${formatBytes(file.size)}` : ""}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Attachments are read by `ticketId`, so another ticket's file cannot appear here — and a file
            behind a permission the recipient does not hold is not offered either. What matters is what the
            recipient may be sent, not what the author may read.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer text-xs">
          Upload…
          <input type="file" multiple className="hidden" onChange={(event) => void addFiles(event.target.files)} />
        </label>
        <span className="text-[11px] text-gray-500">5 MB a file, 10 files, 10 MB a message — the composer's own limits.</span>
      </div>
      {refusedFile && (
        <div className="rounded-lg border border-surface-border bg-surface-light p-3">
          <p className="flex items-center gap-2 text-xs text-alert-amber">
            <AlertTriangle size={14} /> {refusedFile.name} is {formatBytes(refusedFile.bytes)} — over the {formatBytes(5 * 1024 * 1024)} limit
          </p>
          <p className="mt-1.5 text-[11px] text-gray-400">
            A file has three answers, not an error: send a portal link instead, compress it to fit, or leave it out.
            Nothing in this repository compresses an arbitrary document, and a lossy re-render would change the
            document itself, so compressing is not drawn as a control that cannot work.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={client?.portalEnabled === false}
              onClick={() => {
                const link = `${window.location.origin}/portal`;
                setPortalLink(link);
                setRefusedFile(null);
                toast.success("The message now carries a portal link instead of the file");
              }}
            >
              Send as a portal link instead
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setRefusedFile(null)}>Leave it out</button>
          </div>
          {portalLink && (
            <p className="mt-2 text-[11px] text-gray-400">
              The message carries a button to <span className="font-mono">{portalLink}</span> instead of the file. It opens
              for a contact with portal access, and the file has to be on a ticket the portal shows — so upload it
              where it belongs before sending.
            </p>
          )}
          {client?.portalEnabled === false && (
            <p className="mt-2 text-[11px] text-gray-500">
              {client.name}'s portal is switched off (<span className="font-mono">portalEnabled</span> is false), so the
              portal-link button is disabled rather than quietly failing at the mail server: the link would not open for
              anyone yet.
            </p>
          )}
        </div>
      )}
    </div>
  );

  const duringList = (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">To</span><span className="min-w-0 break-all text-right text-gray-300">{to.join(", ") || "—"}</span></div>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Cc</span><span className="min-w-0 break-all text-right text-gray-300">{cc.join(", ") || "—"}</span></div>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Bcc</span><span className="min-w-0 break-all text-right text-gray-300">— nobody</span></div>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Subject</span><span className="min-w-0 break-all text-right text-gray-300">{outgoingSubject || "—"}</span></div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-gray-500">Attachments</span>
        <span className="min-w-0 break-all text-right text-gray-300">
          {[...attachments.map((entry) => entry.name), ...uploads.map((file) => file.filename)].join(" · ") || "none"}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Inline parts</span><span className="text-right text-gray-300">{inlineImages ? `${inlineImages} embedded image${inlineImages === 1 ? "" : "s"}` : "none in this message"}</span></div>
      <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Size</span><span className="text-right text-gray-300">{formatBytes(messageBytes)} of a 10 MB request body</span></div>
    </div>
  );

  const afterPanel = sent && (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-surface-light p-3">
        <p className="flex items-center gap-2 text-xs text-alert-green">
          <Check size={14} /> {sent.statusOnly ? "Marked sent" : `Sent to ${sent.to.join(", ") || "nobody"}`}
          {!sent.statusOnly && <span className="text-gray-500">{new Date().toLocaleString()}</span>}
        </p>
        <p className="mt-1 text-[11px] text-gray-400">
          {sent.statusOnly
            ? "No message was transmitted. This route writes the status alone — nothing in this repository calls the invoice sender, so an invoice cannot yet be emailed from here."
            : "The record now carries the send, and a reply from the client comes back to the ticket or the invoice it belongs to."}
        </p>
      </div>
      <div className="space-y-1.5">
        {sent.messageId && (
          <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Message id</span><span className="break-all text-right font-mono text-gray-300">{sent.messageId}</span></div>
        )}
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">To</span><span className="break-all text-right text-gray-300">{sent.to.join(", ") || "—"}</span></div>
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Cc</span><span className="break-all text-right text-gray-300">{sent.cc.join(", ") || "none"}</span></div>
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Carried</span><span className="break-all text-right text-gray-300">{sent.attachments.join(", ") || "nothing"}</span></div>
        <div className="flex items-baseline justify-between gap-3 text-xs"><span className="text-gray-500">Recorded</span><span className="text-right text-gray-300">{sent.statusOnly ? "the invoice's status" : "a send entry with the recipients, the subject and the files"}</span></div>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-gray-500">If it was wrong</p>
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => { setPhase("compose"); void submit(); }}>
              <RefreshCw size={13} className="mr-1 inline" /> Resend the same message
            </button>
            <span className="text-[11px] text-gray-500">to the same people, recorded as a resend</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary text-xs"
              onClick={() => {
                setPhase("compose");
                setSubject((current) => (current.startsWith("Correction:") ? current : `Correction: ${current}`));
                if (blocks.length) setEdits((current) => ({ ...current }));
              }}
            >
              <Mail size={13} className="mr-1 inline" /> Send a correction
            </button>
            <span className="text-[11px] text-gray-500">a new message that quotes the first, so the client sees both</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs" onClick={() => navigate("/admin/email/log")}>
              See the log
            </button>
            <span className="text-[11px] text-gray-500">what left, to which address, when — and what failed to leave</span>
          </div>
        </div>
      </div>
      <button className="btn-secondary text-xs" onClick={onClose}>Close</button>
    </div>
  );

  // ══ Modern: the sheet ═════════════════════════════════════════════════════
  if (redesign) {
    const step = phase === "compose" ? 0 : phase === "sending" ? 1 : 2;
    const steps = ["Before", "During", "After"];
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => phase !== "sending" && onClose()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Send a message"
          className="w-full max-w-6xl rounded-xl border border-surface-border bg-surface shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-5 py-4">
            <Tile>{context.kind === "invoice" ? <FileText size={15} /> : <Mail size={15} />}</Tile>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">
                {context.kind === "ticket" ? "Reply to the client" : context.kind === "invoice" ? "Send this invoice" : "Email this report"}
              </h2>
              <p className="truncate text-xs text-gray-500">
                {context.kind === "invoice"
                  ? `${context.invoice.invoiceNumber} — ${context.invoice.company?.name ?? "no client"}`
                  : context.kind === "report"
                    ? `${context.title}${context.companyId ? "" : " · no client chosen"}`
                    : ticket ? `${ticket.ticketNumber} — ${ticket.title}` : "reading the ticket…"}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5">
                {steps.map((label, index) => (
                  <span key={label} className={`text-[11px] ${index === step ? "text-cyber-400" : "text-gray-600"}`}>
                    {label}{index < steps.length - 1 && <ArrowRight size={11} className="mx-1 inline text-gray-700" />}
                  </span>
                ))}
              </span>
              <button className="rounded-lg p-1.5 text-gray-500 hover:bg-surface-lighter hover:text-white" onClick={onClose} aria-label="Close" disabled={phase === "sending"}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {phase === "sent" ? (
              <div className="lg:col-span-2">{afterPanel}</div>
            ) : (
              <>
                <div className="space-y-4">
                  {/* The record the message is about. */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface-light px-3 py-2.5">
                    <span className="text-xs text-white">
                      {context.kind === "invoice"
                        ? `${context.invoice.invoiceNumber} — ${context.invoice.company?.name ?? "no client"}`
                        : context.kind === "report"
                          ? context.title
                          : ticket ? `${ticket.ticketNumber} — ${ticket.title}` : "…"}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {context.kind === "invoice"
                        ? `${money(context.invoice.total)} · due ${dateWords(context.invoice.dueDate)} · ${daysBetween(context.invoice.dueDate, new Date()) > 0 ? `${daysBetween(context.invoice.dueDate, new Date())} days past due` : `due in ${Math.abs(daysBetween(context.invoice.dueDate, new Date()))} days`}`
                        : context.kind === "report"
                          ? "a saved report, attached as PDF with a covering note"
                          : ticket ? `${ticket.company?.name ?? ""} · ${ticket.status.replace(/_/g, " ")}` : ""}
                    </span>
                    {context.kind === "invoice" && <span className={`chip ${context.invoice.status === "overdue" ? "chip--bad" : context.invoice.status === "paid" ? "chip--good" : ""}`}>{context.invoice.status}</span>}
                    {context.kind === "ticket" && ticket && <span className={`badge ${`badge-status-${ticket.status}`}`}>{ticket.status.replace(/_/g, " ")}</span>}
                  </div>

                  {/* What the button says it is about to do — the sentence beside the control that acts. */}
                  <div className="rounded-lg border border-surface-border bg-surface-light p-3">
                    <p className="text-xs text-white">
                      {recipientCount
                        ? <>Sends <b>1 email</b> to {recipientCount === 1 ? "one person" : `${recipientCount} people`}
                          {attachments.length + uploads.length ? <> with {attachments.length + uploads.length} attachment{attachments.length + uploads.length === 1 ? "" : "s"}</> : null}
                          {cc.length ? <> and copies {cc.length}</> : null}, then writes the record.</>
                        : "No recipient yet — the sheet will not send to nobody."}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      Both parts go: the HTML and the plain text derived from the same blocks.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => void submit()} disabled={phase === "sending" || !recipientCount || !blocks.length}>
                        {phase === "sending" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {phase === "sending" ? "Sending one message…" : sendLabel}
                      </button>
                      <span className="kbd text-[11px] text-gray-500">Ctrl</span><span className="text-[11px] text-gray-500">Enter</span>
                      <button className="btn-secondary text-xs" onClick={onClose} disabled={phase === "sending"}>Cancel</button>
                      {!blocks.length && (
                        <span className="text-[11px] text-alert-amber">
                          Disabled: there is no message for this key — not in the catalogue and not in the code — so
                          there is nothing to send.
                        </span>
                      )}
                    </div>
                  </div>

                  {sendFailure && (
                    <div className="space-y-2">
                      <CallNote failure={sendFailure} what="The message was not sent." />
                      {sendFailure.absent && context.kind === "invoice" && (
                        <div className="rounded-lg border border-surface-border bg-surface-light p-3">
                          <p className="text-xs text-white">What this instance can still do</p>
                          <p className="mt-1 text-[11px] text-gray-400">
                            The general send endpoint is not here, so the invoice can only be marked sent — the
                            route writes <span className="font-mono">status: sent</span> and transmits nothing.
                            It accepts a draft or an already-sent invoice, so an invoice in another status is
                            refused by the route itself rather than by this sheet.
                          </p>
                          <button className="btn-secondary mt-2 text-xs" onClick={() => void markSentOnly()}>
                            Mark {context.invoice.invoiceNumber} as sent (sends no email)
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {clientFailure && <CallNote failure={clientFailure} what="The client's contacts could not be read, so the recipients are the ones you type." />}

                  {/* Recipients. */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Recipients the sheet will use</p>
                    {reader && (
                      <p className="mt-1 text-[11px] text-gray-500">
                      <span className="font-mono">{templateKey}</span> is written for {reader}
                      </p>
                    )}
                    <div className="mt-2 space-y-1.5">
                      {candidates.map((candidate) => (
                        <label key={candidate.key} className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${candidate.email ? "cursor-pointer border-surface-border hover:border-gray-600" : "border-surface-border opacity-70"}`}>
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-cyber-500"
                            checked={Boolean(contactOn[candidate.key] && candidate.email)}
                            disabled={!candidate.email}
                            onChange={(event) => setContactOn((current) => ({ ...current, [candidate.key]: event.target.checked }))}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-2">
                              <span className="text-xs text-white">{candidate.name}</span>
                              {candidate.email && <span className="font-mono text-[11px] text-gray-400">{candidate.email}</span>}
                              <span className="chip">{candidate.channel === "cc" ? "Cc" : "To"}</span>
                              {candidate.notesOnly && <span className="chip">notes only</span>}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-gray-500">{candidate.why}</span>
                          </span>
                        </label>
                      ))}
                      {context.kind === "ticket" && (
                        <label className="flex items-center gap-2.5 rounded-lg border border-surface-border p-2.5">
                          <input type="checkbox" className="accent-cyber-500" checked={primaryOn} onChange={(event) => setPrimaryOn(event.target.checked)} />
                          <span className="text-[11px] text-gray-400">
                            Unticking the primary contact stops the ticket's own contact being emailed — the
                            composer's rule, and the same one <span className="font-mono">includePrimary</span> carries to the API.
                          </span>
                        </label>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="input-field max-w-xs text-xs"
                        placeholder="Copy somebody else — type an address"
                        value={typedCc}
                        onChange={(event) => setTypedCc(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const address = typedCc.trim();
                            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && !cc.includes(address)) setExtraCc((current) => [...current, address]);
                            setTypedCc("");
                          }
                        }}
                      />
                      {extraCc.map((address) => (
                        <span key={address} className="chip chip--on">
                          {address}
                          <span className="chip__n" role="button" tabIndex={0} onClick={() => setExtraCc((current) => current.filter((entry) => entry !== address))}>×</span>
                        </span>
                      ))}
                    </div>
                    {primaryOff && <p className="mt-2 text-[11px] text-alert-amber">The ticket's own contact is switched off for this send — the button above will not reach them.</p>}
                  </div>

                  {/* Subject. */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Subject</p>
                      <input
                        className="input-field mt-2 text-sm"
                        value={subject}
                        onChange={(event) => { setSubject(event.target.value); setSubjectTouched(true); }}
                        aria-label="Subject"
                      />
                    {context.kind === "ticket" ? (
                      <p className="mt-1.5 text-[11px] text-gray-500">
                        The <span className="font-mono">[{ticket?.ticketNumber ?? context.id}]</span> prefix is added by the
                        route, not typed, so a reply that comes back can find its ticket.
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-gray-500">
                        {template?.subject
                          ? "The message's own subject, shown rather than hidden — change it if you need to."
                          : "The subject lives with the message, so it arrives with the catalogue."}
                      </p>
                    )}
                  </div>

                  {/* The message, as blocks. */}
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] uppercase tracking-wider text-gray-500">The message, as blocks</p>
                      <span className="chip chip--on">{templateKey}</span>
                      {fromCode && <span className="chip chip--warn">the code's own body</span>}
                      {neverSent && <span className="chip chip--bad">written, never sent</span>}
                      {templates && (
                        <select
                          className="input-field max-w-xs py-1 text-xs"
                          value={templateKey}
                          onChange={(event) => setTemplateKey(event.target.value)}
                          aria-label="Which message"
                        >
                          {templates.some((entry) => entry.key === templateKey)
                            ? null
                            : <option value={templateKey}>{templateKey} — the sheet's own choice</option>}
                          {templates.map((entry) => (
                            <option key={entry.key} value={entry.key}>{entry.key} — {entry.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {catalogueFailure && (
                      <div className="mt-2">
                        <CallNote
                          failure={catalogueFailure}
                          what={`The stored catalogue could not be read, so these are the code's own blocks for ${templateKey} — the v0 every instance starts from, read from the same place the editor reads them.`}
                        />
                      </div>
                    )}
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[11px] text-gray-500">
                        The same blocks the editor composes and the template renders. Nothing here is drawn twice.
                        {fact?.requiredLine ? ` One line of this message is a mechanism rather than copy (“${fact.requiredLine}”) and cannot be switched off.` : ""}                      </p>
                      {blocks.map((block, index) => {
                        const required = (isMessageKey(templateKey) && blockIsRequired(templateKey, block))
                          || Boolean(live?.requiredTokens?.length && tokensInBlock(block).some((token) => live.requiredTokens!.includes(token)));
                        return (
                          <div key={index} className={`flex items-start gap-2.5 rounded-lg border border-surface-border p-2.5 ${ownOff.has(index) ? "opacity-50" : ""}`}>
                            <Switch
                              on={!ownOff.has(index)}
                              label={blockLabel(block)}
                              disabled={required}
                              onToggle={(next) => setOff((current) => {
                                const set = new Set(current);
                                if (next) set.delete(index); else set.add(index);
                                return set;
                              })}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] uppercase tracking-wider text-gray-500">
                                {blockLabel(block)}
                                {required && <span className="ml-2 text-alert-amber">required — the sentence is the mechanism</span>}
                              </p>
                              {isEditable(block) ? (
                                <input
                                  className="input-field mt-1 py-1 text-xs"
                                  value={edits[index] ?? blockText(block)}
                                  onChange={(event) => setEdits((current) => ({ ...current, [index]: event.target.value }))}
                                  aria-label={blockLabel(block)}
                                />
                              ) : (
                                <p className="mt-0.5 break-words text-xs text-gray-300">{blockSummary(block)}</p>
                              )}
                              <p className="mt-0.5 text-[11px] text-gray-600">{blockReads(block)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {blocks.length === 0 && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        This message has no body of its own for <span className="font-mono">{templateKey}</span>.
                      </p>
                    )}
                  </div>

                  {/* Attachments. */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">What this send will carry</p>
                    <div className="mt-2">{attachmentBox}</div>
                  </div>

                  {/* What information gets sent — the facts, apart from the layout. */}
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">What information gets sent</p>
                    <p className="mt-1 text-[11px] text-gray-500">Facts, not layout. Each of these puts a value into the message or keeps it out of it.</p>
                    <div className="mt-2 space-y-1">
                      {facts.map((fact) => {
                        const owners = blocks.filter((block) => fact.owns(block)).length;
                        const on = !fact.lockedOn && !fact.lockedOff && !factsOff.has(fact.key);
                        return (
                          <div key={fact.key} className="flex items-start gap-2.5 rounded-lg border border-surface-border p-2.5">
                            <Switch
                              on={on}
                              disabled={Boolean(fact.lockedOn || fact.lockedOff || catalogueFailure)}
                              label={fact.name}
                              onToggle={(next) => setFactsOff((current) => {
                                const set = new Set(current);
                                if (next) set.delete(fact.key); else set.add(fact.key);
                                return set;
                              })}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-white">{fact.name}</p>
                              <p className="mt-0.5 text-[11px] text-gray-500">
                                {fact.lockedOff && <span className="text-alert-amber">{fact.lockedOff}. </span>}
                                {fact.say}
                                {!fact.lockedOn && !fact.lockedOff && !catalogueFailure && (
                                  <> · {owners ? `owns ${owners} block${owners === 1 ? "" : "s"} of this message` : "not in this message as it stands"}</>
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Off is not the same as absent: a fact that is switched off is not sent and not mentioned.
                    </p>
                  </div>

                  {/* During. */}
                  {phase === "sending" && (
                    <div className="rounded-lg border border-surface-border bg-surface-light p-3">
                      <p className="flex items-center gap-2 text-xs text-alert-amber"><Loader2 size={14} className="animate-spin" /> Sending one message…</p>
                      <p className="mt-1 text-[11px] text-gray-500">The button is disabled while the call is in flight, so a second press cannot send twice.</p>
                      <div className="mt-3">{duringList}</div>
                      <p className="mt-2 text-[11px] text-gray-500">
                        This is the list the mailer receives, not a summary of it — <span className="font-mono">to</span>,{" "}
                        <span className="font-mono">cc</span>, <span className="font-mono">bcc</span> and the attachments are all built before the call.
                        Nothing is written yet: the record and the files happen after the send returns.
                      </p>
                    </div>
                  )}

                  {phase === "failed" && sendFailure && (
                    <div className="rounded-lg border border-surface-border bg-surface-light p-3">
                      <p className="flex items-center gap-2 text-xs text-alert-red"><AlertTriangle size={14} /> The mail could not leave</p>
                      <p className="mt-1 text-xs text-gray-300">{sendFailure.reason}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        Nothing was recorded: no phantom “sent” entry and no orphan files. “Did it go?” is the
                        question this state is for, and the answer is no.
                      </p>
                      <button className="btn-secondary mt-2 text-xs" onClick={() => void submit()}>Try again</button>
                    </div>
                  )}
                </div>

                {/* The preview and the two parts, in the second column. */}
                <div className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip chip--on">Preview</span>
                      <span className="font-mono text-[11px] text-gray-500">{templateKey}</span>
                      <span className="text-[11px] text-gray-500">the exact message, not a picture of it</span>
                    </div>
                    <div className="mt-2">
                      {preview.status === "ready" ? (
                        <PreviewFrame html={preview.preview.html} title="The message as the recipient will receive it" className="h-[26rem]" />
                      ) : preview.status === "loading" ? (
                        <div className="flex h-[26rem] items-center justify-center rounded-lg border border-surface-border bg-surface-light text-xs text-gray-500">
                          <Loader2 size={14} className="mr-2 animate-spin" /> Reading the preview…
                        </div>
                      ) : (
                        <CallNote failure={preview.failure} what="The message could not be previewed, so this sheet will not claim to show it." />
                      )}
                    </div>
                    {preview.status === "ready" && preview.preview.warnings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {preview.preview.warnings.map((warning) => (
                          <li key={warning} className="text-[11px] text-alert-amber">▲ {warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip">Plain text</span>
                      <span className="text-[11px] text-gray-500">the part that survives a mail system stripping the HTML</span>
                      {preview.status === "ready"
                        ? <span className={`chip ${agree ? "chip--good" : "chip--warn"}`}>{agree ? "same facts" : "edited by hand"}</span>
                        : <span className="chip">derived here</span>}
                    </div>
                    <div className="mt-2">
                      <TextPane text={textPart} />
                      {preview.status !== "ready" && (
                        <p className="mt-1.5 text-[11px] text-gray-500">
                          Derived in this browser from the same blocks, by the same renderer the editor uses
                          {recordId ? <>, with the fields resolved against <span className="font-mono">{recordId}</span></> : null}, because{" "}
                          <span className="font-mono">{preview.status === "failed" ? preview.failure.endpoint : EMAIL_API.preview}</span> did not
                          answer. The API's own text part is the one that will be sent, and it is built from these blocks.
                        </p>
                      )}
                      {difference && !agree && (
                        <p className="mt-1.5 text-[11px] text-alert-amber">
                          ▲ The stored text part is not the text of the blocks
                          {difference.missingFromText.length ? `: it is missing ${difference.missingFromText.slice(0, 4).join(", ")}` : ""}
                          {difference.extraInText.length ? `${difference.missingFromText.length ? "; " : ": "}it adds ${difference.extraInText.slice(0, 4).join(", ")}` : ""}.
                          What it says is what a reader whose client strips HTML will read.
                        </p>
                      )}
                    </div>
                    <div className="mt-2"><BothPartsNote agree={agree} /></div>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500">Figures for this message</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: "Files going", value: String(attachments.length + uploads.length), foot: attachments[0]?.name ?? uploads[0]?.filename ?? "nothing attached" },
                        { label: "Refused", value: tooBig ? "1" : "0", foot: tooBig ? "over the limit" : "nothing refused" },
                        { label: "Inline images", value: String(inlineImages), foot: "of 20, 2 MB each" },
                        { label: "Message size", value: formatBytes(messageBytes), foot: generatedFiles ? `plus ${generatedFiles} generated on send` : "of a 10 MB request body" },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-lg border border-surface-border bg-surface-light p-2.5">
                          <p className="text-[10px] uppercase tracking-wider text-gray-500">{stat.label}</p>
                          <p className="mt-1 text-lg font-semibold leading-none text-white tabular-nums">{stat.value}</p>
                          <p className="mt-1 truncate text-[10px] text-gray-500" title={stat.foot}>{stat.foot}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ══ Classic: the form ═════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={() => phase !== "sending" && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send a message"
        className="card w-full max-w-5xl space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">
              {context.kind === "ticket"
                ? `Reply to the client${ticket ? ` about ${ticket.ticketNumber}` : ""}`
                : context.kind === "invoice"
                  ? `Send invoice ${context.invoice.invoiceNumber}`
                  : `Email ${context.title}`}
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              {context.kind === "invoice"
                ? `${context.invoice.company?.name ?? "no client"} · ${money(context.invoice.total)} · due ${dateWords(context.invoice.dueDate)}`
                : context.kind === "report"
                  ? "A covering note plus the PDF the report already exports"
                  : ticket ? `${ticket.company?.name ?? ""} · ${ticket.title}` : "Reading the ticket…"}
            </p>
          </div>
          <button className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-surface-lighter hover:text-white" onClick={onClose} aria-label="Close" disabled={phase === "sending"}>
            <X size={16} />
          </button>
        </div>

        {phase === "sent" ? (
          afterPanel
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            {/* The form: labelled fields, in the order they are read. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-to">To</label>
                <input
                  id="send-to"
                  className="input-field"
                  value={to.join(", ")}
                  readOnly
                  aria-label="To"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  {candidates.length
                    ? "Chosen below. Every address here is one the recipient's client owns or the ticket already carries."
                    : "No recipients could be read for this message — type a copy below and the sheet will say so."}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-cc">Cc</label>
                <input
                  id="send-cc"
                  className="input-field"
                  placeholder="No copy — type or pick an address"
                  value={typedCc}
                  onChange={(event) => setTypedCc(event.target.value)}
                  onBlur={() => {
                    const address = typedCc.trim();
                    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && !cc.includes(address)) setExtraCc((current) => [...current, address]);
                    setTypedCc("");
                  }}
                  aria-label="Cc"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-bcc">Bcc</label>
                <input id="send-bcc" className="input-field" value="Nobody" readOnly aria-label="Bcc" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-template">Template</label>
                <select id="send-template" className="input-field" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
                  {(templates ?? (isMessageKey(templateKey) ? [{ key: templateKey, name: templateKey } as EmailTemplate] : [])).map((entry) => (
                    <option key={entry.key} value={entry.key}>{entry.key} — {entry.name}</option>
                  ))}
                </select>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {fromCode && <span className="chip chip--warn">the code's own body</span>}
                  {neverSent && <span className="chip chip--bad">written, never sent</span>}
                </div>
                {reader && <p className="mt-1 text-[11px] text-gray-500">Written for {reader}</p>}
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-replyto">Reply-to</label>
                <input id="send-replyto" className="input-field" value="the instance's sender address" readOnly aria-label="Reply-to" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-subject">Subject</label>
                <input id="send-subject" className="input-field" value={subject} onChange={(event) => { setSubject(event.target.value); setSubjectTouched(true); }} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-gray-500" htmlFor="send-message">Message</label>
                <textarea
                  id="send-message"
                  className="input-field"
                  rows={6}
                  value={composed.map((block) => blockSummary(block)).join("\n\n")}
                  readOnly
                  aria-label="Message"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Read-only here: the words of a block are edited beside the block's own switch in the modern
                  sheet, and this form shows the whole message in one field because that is how a form is read.
                </p>
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-500">Attachment</span>
                {attachmentBox}
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs text-gray-500">What information gets sent</span>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {facts.map((fact) => (
                    <label key={fact.key} className="flex items-start gap-2 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-cyber-500"
                        checked={!fact.lockedOn && !fact.lockedOff && !factsOff.has(fact.key)}
                        disabled={Boolean(fact.lockedOn || fact.lockedOff || catalogueFailure)}
                        onChange={(event) => setFactsOff((current) => {
                          const set = new Set(current);
                          if (event.target.checked) set.delete(fact.key); else set.add(fact.key);
                          return set;
                        })}
                      />
                      <span>
                        {fact.name}
                        <span className="block text-[11px] text-gray-600">{fact.lockedOff ? `${fact.lockedOff}. ` : ""}{fact.say}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {catalogueFailure && <div className="mt-2"><CallNote failure={catalogueFailure} what="The message catalogue could not be read." /></div>}
                {clientFailure && <div className="mt-2"><CallNote failure={clientFailure} what="The client's contacts could not be read." /></div>}
              </div>
              {context.kind === "invoice" && (
                <div className="sm:col-span-2 rounded-lg border border-surface-border bg-surface-light p-3">
                  <p className="text-xs text-white">A billing document</p>
                  <p className="mt-1 text-[11px] text-gray-400">
                    No unsubscribe, because there is no marketing mail in this product; and no quiet hours to be
                    exempt from, because nothing here defers a message by time of day. An invoice that waits until
                    morning is an invoice that arrives late.
                  </p>
                </div>
              )}
              {sendFailure && (
                <div className="sm:col-span-2 space-y-2">
                  <CallNote failure={sendFailure} what="The message was not sent." />
                  {sendFailure.absent && context.kind === "invoice" && (
                    <button className="btn-secondary text-xs" onClick={() => void markSentOnly()}>
                      Mark {context.invoice.invoiceNumber} as sent (sends no email)
                    </button>
                  )}
                </div>
              )}
              {phase === "sending" && (
                <div className="sm:col-span-2 rounded-lg border border-surface-border bg-surface-light p-3">
                  <p className="flex items-center gap-2 text-xs text-alert-amber"><Loader2 size={14} className="animate-spin" /> Sending one message…</p>
                  <div className="mt-3">{duringList}</div>
                </div>
              )}
              {phase === "failed" && sendFailure && (
                <div className="sm:col-span-2 rounded-lg border border-surface-border bg-surface-light p-3">
                  <p className="text-xs text-alert-red">{sendFailure.reason}</p>
                  <p className="mt-1 text-[11px] text-gray-500">Nothing was recorded — no phantom “sent” entry.</p>
                  <button className="btn-secondary mt-2 text-xs" onClick={() => void submit()}>Try again</button>
                </div>
              )}
            </div>

            {/* The preview pane, permanently in view rather than revealed behind a toggle. */}
            <div className="space-y-3">
              <div>
                <span className="chip">Preview</span>
                <div className="mt-2">
                  {preview.status === "ready" ? (
                    <PreviewFrame html={preview.preview.html} title="The message as the recipient will receive it" className="h-72" />
                  ) : preview.status === "loading" ? (
                    <div className="flex h-72 items-center justify-center rounded-lg border border-surface-border bg-surface-light text-xs text-gray-500">
                      <Loader2 size={14} className="mr-2 animate-spin" /> Reading the preview…
                    </div>
                  ) : (
                    <CallNote failure={preview.failure} what="The message could not be previewed." />
                  )}
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">Plain text</span>
                  {preview.status === "ready"
                    ? <span className={`chip ${agree ? "chip--good" : "chip--warn"}`}>{agree ? "same facts" : "edited by hand"}</span>
                    : <span className="chip">derived here</span>}
                </div>
                <div className="mt-2">
                  <TextPane text={textPart} />
                  {preview.status !== "ready" && (
                    <p className="mt-1.5 text-[11px] text-gray-500">
                      Derived in this browser from the same blocks by the editor's own renderer; the API's text part is what
                      will be sent.
                    </p>
                  )}
                  {difference && !agree && (
                    <p className="mt-1.5 text-[11px] text-alert-amber">
                      ▲ The stored text part is not the text of the blocks: it is missing {difference.missingFromText.slice(0, 3).join(", ") || "nothing"};
                      it adds {difference.extraInText.slice(0, 3).join(", ") || "nothing"}.
                    </p>
                  )}
                </div>
                <div className="mt-2"><BothPartsNote agree={agree} /></div>
              </div>
              <p className="text-[11px] text-gray-500">
                The classic dialog keeps the preview permanently in view and the contents list as checkboxes in
                field order. A form is read top to bottom, once, before pressing Send — which is why the two
                arrangements are not the same arrangement.
              </p>
            </div>
          </div>
        )}

        {phase !== "sent" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-surface-border pt-3">
            <span className="mr-auto text-xs text-gray-500">
              {recipientCount
                ? `Sends 1 email to ${to.join(", ") || "nobody"}${cc.length ? ` and copies ${cc.length}` : ""} with ${attachments.length + uploads.length} attachment${attachments.length + uploads.length === 1 ? "" : "s"}. Both parts go.`                : "No recipient — nothing will be sent."}
            </span>
            <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={phase === "sending"}>Cancel</button>
            <button type="button" className="btn-primary text-sm" onClick={() => void submit()} disabled={phase === "sending" || !recipientCount || !blocks.length}>
              {phase === "sending" ? "Sending…" : "Send"}
            </button>
            {!blocks.length && <span className="w-full text-[11px] text-alert-amber">Disabled: there is no message for this key to send.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default EmailSendDialog;
