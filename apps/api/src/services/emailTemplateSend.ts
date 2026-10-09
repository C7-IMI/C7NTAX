/**
 * The send path: resolve a template (or the registry's default) → render → send → log.
 *
 * Three properties this file is responsible for, and the reason each matters:
 *
 * · **Every send carries both parts.** `EmailService.send()` has always taken `text?`, and until now
 *   only the portal code and the ticket composer passed one. Every send here passes it: the message is
 *   `multipart/alternative`, so a mail system that strips HTML — which the owner asked about
 *   explicitly — still delivers a readable message, and because the text is derived from the same
 *   blocks the two cannot carry different facts.
 *
 * · **A send failure never throws into a route or a worker.** Delivery is best-effort today (the ticket
 *   notification paths log and carry on, so SMTP trouble cannot fail a status change), and it stays that
 *   way: the outcome is returned for a caller that wants to report it — the Studio's test send does —
 *   and the failure is written to `EmailMessageLog` either way. Nothing is left in a half-state: a
 *   message that could not leave has a log row saying so and no "sent" claim.
 *
 * · **The log write can never break a send.** The mail is already gone by the time the row is written,
 *   so a log failure is swallowed and warned about rather than raised.
 */
import { prisma } from "../index";
import { EmailService } from "@C7NTAX/email";
import {
  EMAIL_MESSAGE_KEYS,
  isSettledTicketStatus,
  type EmailBlock,
  type EmailCondition,
  type EmailMessageKey,
  type EmailTemplate,
  type EmailTemplateState,
  type EmailTemplateVersion,
} from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { logger } from "./logger";
import { extractInlineImages, type InlineImage } from "./emailHtml";
import { DEFAULT_BRAND, emailMessage, requireEmailMessage, type EmailBrandValues } from "./emailMessages";
import {
  formatDateLong,
  formatDateTime,
  formatMoney,
  instanceFields,
  SAMPLE_FIELDS,
  webOrigin,
} from "./emailSampleRecords";

// Re-exported so a caller that already reaches for the send path keeps working, and so the probe
// can use the sample records without loading a Prisma client.
export { formatDateLong, formatDateTime, formatMoney, instanceFields, SAMPLE_FIELDS, webOrigin };
import { loadBrandKit } from "./brand";
import { renderEmail, type EmailRenderContext, type EmailRenderResult } from "./emailTemplateRender";

const emailService = new EmailService();

/** A stored string, trimmed, or null when the field was cleared. */
function optionalText(value: unknown, limit = 1000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

// ── Templates: resolve, save, reset, history ────────────────────────────────
export interface ResolvedTemplate {
  key: EmailMessageKey;
  subject: string;
  blocks: EmailBlock[];
  text: string | null;
  /** Null when the built-in default is what renders — a default is not a saved version. */
  version: number | null;
  updatedAt: Date | null;
  updatedById: string | null;
}

type TemplateRow = {
  key: string;
  subject: string;
  blocks: unknown;
  text: string | null;
  version: number;
  updatedAt: Date;
  updatedById: string | null;
};

function blocksOf(value: unknown): EmailBlock[] {
  return Array.isArray(value) ? (value as EmailBlock[]) : [];
}

/** The stored template for a key, or the registry's default. Never throws for an unknown key. */
export async function resolveTemplate(key: string): Promise<ResolvedTemplate> {
  const entry = requireEmailMessage(key);
  const row = (await prisma.emailTemplate.findUnique({ where: { key } })) as TemplateRow | null;
  if (!row) {
    return { key: entry.key, subject: entry.defaultSubject, blocks: entry.defaultBlocks, text: null, version: null, updatedAt: null, updatedById: null };
  }
  return {
    key: entry.key,
    subject: row.subject,
    blocks: blocksOf(row.blocks),
    text: row.text,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  };
}

/**
 * A canonical rendering of a value, key order included.
 *
 * `blocks` is stored as `jsonb`, and PostgreSQL does not preserve the order of a JSON object's keys —
 * so comparing `JSON.stringify(stored)` with `JSON.stringify(default)` reported a message as changed
 * the moment it had been saved once, even when it said exactly the same thing. This is the comparison
 * the list's "which of these have we changed?" answer depends on.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The state a row is in. `default` is not "no row" — it is "the same words the code ships", which is
 * also the state after a reset, and comparing is how the list can answer "which of these have we
 * changed?" honestly.
 */
export function templateState(resolved: ResolvedTemplate): EmailTemplateState {
  if (resolved.version === null) return "default";
  const entry = requireEmailMessage(resolved.key);
  const same =
    resolved.subject === entry.defaultSubject &&
    canonical(resolved.blocks) === canonical(entry.defaultBlocks) &&
    !(resolved.text ?? "").trim();
  return same ? "default" : "customised";
}

/** Names for a set of user ids, so a version can say who saved it without a join per row. */
async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (!wanted.length) return names;
  try {
    const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, firstName: true, lastName: true } });
    for (const user of users) names.set(user.id, [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Unknown");
  } catch {
    /* a name that cannot be resolved is not a reason to fail a read */
  }
  return names;
}

/** The template as the API hands it to the editor, including its derived text for comparison. */
export async function templateDto(key: string): Promise<EmailTemplate> {
  const resolved = await resolveTemplate(key);
  const row = (await prisma.emailTemplate.findUnique({ where: { key } })) as TemplateRow | null;
  const { values } = await loadBrandKit();
  const names = await userNames([row?.updatedById]);
  return dtoFrom(resolved, row, values, names);
}

/**
 * Every message's template in one pass.
 *
 * The list is the Studio's first screen and it asks for all twelve at once; twelve round trips each for
 * the row, the brand and a name would be thirty-six queries to draw one list.
 */
export async function allTemplateDtos(): Promise<EmailTemplate[]> {
  const rows = (await prisma.emailTemplate.findMany()) as TemplateRow[];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const { values } = await loadBrandKit();
  const names = await userNames(rows.map((row) => row.updatedById));
  return EMAIL_MESSAGE_KEYS.map((key) => {
    const row = byKey.get(key) ?? null;
    const entry = requireEmailMessage(key);
    const resolved: ResolvedTemplate = row
      ? { key: entry.key, subject: row.subject, blocks: blocksOf(row.blocks), text: row.text, version: row.version, updatedAt: row.updatedAt, updatedById: row.updatedById }
      : { key: entry.key, subject: entry.defaultSubject, blocks: entry.defaultBlocks, text: null, version: null, updatedAt: null, updatedById: null };
    return dtoFrom(resolved, row, values, names);
  });
}

function dtoFrom(resolved: ResolvedTemplate, row: TemplateRow | null, brand: EmailBrandValues, names: Map<string, string>): EmailTemplate {
  const entry = requireEmailMessage(resolved.key);
  // Rendered against the sample records rather than an empty map, so the derived text the editor
  // compares against reads like a message instead of a column of stated absences. A preview against a
  // real record is `POST /preview`, and a send is the real thing.
  const derived = renderEmail(
    { key: resolved.key, subject: resolved.subject, blocks: resolved.blocks, text: null },
    { fields: { ...instanceFields(brand), ...SAMPLE_FIELDS[entry.key] }, brand, conditions: {} },
  );
  return {
    key: resolved.key,
    name: entry.name,
    group: entry.group,
    audience: entry.audience,
    editingClass: entry.editingClass,
    live: entry.live,
    subject: resolved.subject,
    blocks: resolved.blocks,
    text: resolved.text,
    derivedText: resolved.text ? derived.derivedText : derived.text,
    state: templateState(resolved),
    version: resolved.version ?? 0,
    updatedAt: resolved.updatedAt ? resolved.updatedAt.toISOString() : null,
    updatedByName: row?.updatedById ? names.get(row.updatedById) ?? null : null,
  };
}

export interface SaveTemplateInput {
  subject?: unknown;
  blocks?: unknown;
  text?: unknown;
  note?: unknown;
}

/** Field shapes the vocabulary defines, so a stored block cannot be one the renderer ignores. */
function validateBlocks(value: unknown): { blocks: EmailBlock[]; error?: string } {
  if (!Array.isArray(value)) return { blocks: [], error: "blocks must be an array" };
  if (value.length > 200) return { blocks: [], error: "a message may hold at most 200 blocks" };
  const kinds = new Set([
    "heading", "paragraph", "button", "facts", "quote", "table", "image", "divider", "note", "attachment", "conditional", "signature", "footer",
  ]);
  const walk = (list: unknown[], depth: number): string | undefined => {
    if (depth > 5) return "conditionals may be nested five deep at most";
    for (const item of list) {
      if (!item || typeof item !== "object") return "every block must be an object";
      const block = item as Record<string, unknown>;
      if (typeof block.kind !== "string" || !kinds.has(block.kind)) return `${String(block.kind)} is not a kind of block`;
      if (block.kind === "conditional") {
        const nested = validateBlocksNested(block.blocks, depth + 1);
        if (nested) return nested;
      }
      if (block.kind === "facts" || block.kind === "table") {
        const listKey = block.kind === "facts" ? "items" : "rows";
        const value = block[listKey];
        if (value !== undefined && !Array.isArray(value)) return `a ${block.kind} block's ${listKey} must be a list`;
        if (Array.isArray(value) && value.length > 200) return `a ${block.kind} block may hold at most 200 ${listKey}`;
      }
    }
    return undefined;
  };
  const validateBlocksNested = (list: unknown, depth: number): string | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) return "a conditional's blocks must be a list";
    return walk(list, depth);
  };
  const error = walk(value, 0);
  return error ? { blocks: [], error } : { blocks: value as EmailBlock[] };
}

/** Every token a message uses, so the required ones can be checked across the subject and the body. */
function tokensUsed(subject: string, blocks: EmailBlock[]): Set<string> {
  const found = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(match[1]!);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }
    if (value && typeof value === "object") for (const item of Object.values(value)) scan(item);
  };
  scan(subject);
  scan(blocks);
  return found;
}

/**
 * Validate a draft — a save or a test send — and return the three fields a stored template holds.
 *
 * One function for both, so a message the Studio refuses to save cannot be a message it will happily
 * send: the required tokens a security message cannot lose are checked here rather than in the route.
 */
function prepareDraft(key: string, input: SaveTemplateInput): { subject: string; blocks: EmailBlock[]; text: string | null; note: string | null } {
  const entry = requireEmailMessage(key);
  const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 300) : "";
  if (!subject) throw new AppError("A subject line is required", 400);
  const { blocks, error } = validateBlocks(input.blocks);
  if (error) throw new AppError(error, 400);
  if (typeof input.text === "string" && input.text.length > 200_000) throw new AppError("The plain-text part is too long", 400);
  const text = typeof input.text === "string" ? input.text : null;
  if (entry.requiredTokens.length) {
    const used = tokensUsed(subject, blocks);
    const missing = entry.requiredTokens.filter((token) => !used.has(token));
    if (missing.length) {
      throw new AppError(
        `This message cannot be sent or saved without ${missing.map((token) => `{{${token}}}`).join(", ")} — it is the reason the message is sent.`,
        400,
      );
    }
  }
  return { subject, blocks, text, note: typeof input.note === "string" ? input.note.slice(0, 300) : null };
}

/**
 * Save a template: validate it, write the version row, then the template row.
 *
 * The version is written every time — that is what the history panel reads, and a change to words a
 * customer reads without a record of the previous ones would make "which words did they actually get"
 * unanswerable.
 */
export async function saveTemplate(key: string, input: SaveTemplateInput, userId: string): Promise<EmailTemplate> {
  requireEmailMessage(key);
  const draft = prepareDraft(key, input);
  const existing = (await prisma.emailTemplate.findUnique({ where: { key } })) as TemplateRow | null;
  const version = (existing?.version ?? 0) + 1;
  const row = await prisma.emailTemplate.upsert({
    where: { key },
    create: { key, subject: draft.subject, blocks: draft.blocks as never, text: draft.text, version, updatedById: userId },
    update: { subject: draft.subject, blocks: draft.blocks as never, text: draft.text, version, updatedById: userId },
  });
  await prisma.emailTemplateVersion.create({
    data: {
      templateId: row.id,
      version,
      subject: draft.subject,
      blocks: draft.blocks as never,
      text: draft.text,
      note: draft.note,
      savedById: userId,
    },
  });
  return templateDto(key);
}

/**
 * Reset to the code's version.
 *
 * The row stays and is overwritten with the default, because deleting it would cascade the version
 * history away — and the history is the thing that makes a reset safe to perform. `templateState()`
 * reads a row equal to the default as `default`, so the list still answers "which have we changed?".
 */
export async function resetTemplate(key: string, userId: string): Promise<EmailTemplate> {
  const entry = requireEmailMessage(key);
  const existing = (await prisma.emailTemplate.findUnique({ where: { key } })) as TemplateRow | null;
  if (!existing) return templateDto(key);
  return saveTemplate(
    key,
    {
      subject: entry.defaultSubject,
      blocks: entry.defaultBlocks,
      text: null,
      note: "Reset to the built-in default",
    },
    userId,
  );
}

export async function templateVersions(key: string): Promise<EmailTemplateVersion[]> {
  requireEmailMessage(key);
  const row = (await prisma.emailTemplate.findUnique({ where: { key }, select: { id: true } })) as { id: string } | null;
  if (!row) return [];
  const versions = await prisma.emailTemplateVersion.findMany({
    where: { templateId: row.id },
    orderBy: { version: "desc" },
    take: 50,
  });
  const names = await userNames(versions.map((version) => version.savedById));
  return versions.map((version) => ({
    version: version.version,
    subject: version.subject,
    blocks: blocksOf(version.blocks),
    text: version.text,
    savedAt: version.savedAt.toISOString(),
    savedByName: version.savedById ? names.get(version.savedById) ?? null : null,
    note: version.note,
  }));
}

// ── Context: a real record, in the vocabulary's own terms ───────────────────

export interface TicketEmailRecord {
  id: string;
  ticketNumber: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  updatedAt?: Date | null;
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  company?: { name?: string | null } | null;
  assignedTo?: { firstName?: string | null; lastName?: string | null } | null;
}

export interface InvoiceEmailRecord {
  id: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  status?: string | null;
  company?: { name?: string | null; email?: string | null } | null;
}

/** The words the caller knows and the record does not: the event, the note, the credential. */
export interface EmailFragments {
  eventLabel?: string;
  details?: string;
  /** The technician's typed message, for ticket.note. */
  composerHtml?: string;
  composerSubject?: string;
  code?: string;
  credential?: string;
  passwordMustChange?: boolean;
  portalUrl?: string;
  /** Who replied to a closing email, for the internal reopened notice. */
  reopenedBy?: string;
  idleDays?: number;
  overdueDays?: number;
  hasAttachments?: boolean;
  hasTimeEntries?: boolean;
  hasNote?: boolean;
}

function fullName(person: { firstName?: string | null; lastName?: string | null } | null | undefined): string | undefined {
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}

/** A ticket, as the merge fields see it. */
export function ticketEmailContext(ticket: TicketEmailRecord, fragments: EmailFragments = {}, brand?: EmailBrandValues): EmailRenderContext {
  const contact = ticket.contact ?? null;
  const clientName = ticket.company?.name ?? "";
  const fields: Record<string, string | null | undefined> = {
    "ticket.number": ticket.ticketNumber,
    "ticket.title": ticket.title,
    "ticket.status": ticket.status ? ticket.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
    "ticket.priority": ticket.priority ?? undefined,
    "ticket.updated": ticket.updatedAt ? formatDateTime(ticket.updatedAt) : undefined,
    "ticket.url": `${webOrigin()}/tickets/${ticket.id}`,
    "client.name": clientName,
    "contact.firstName": contact?.firstName ?? undefined,
    "contact.fullName": fullName(contact),
    "contact.email": contact?.email ?? undefined,
    "technician.fullName": fullName(ticket.assignedTo),
    "event.label": fragments.eventLabel,
    "note.body": fragments.details,
    // A sentence the message depends on, supplied whole: "Hi David," or nothing at all.
    "message.greeting": contact?.firstName ? `Hi ${contact.firstName},` : "",
    "message.clientLine": clientName,
    "message.subject": fragments.composerSubject,
    "message.reopenedBy": fragments.reopenedBy,
    "message.idleFor": fragments.idleDays === undefined ? undefined : fragments.idleDays === 1 ? "1 day" : `${fragments.idleDays} days`,
    "message.code": fragments.code,
  };
  const conditions: Partial<Record<EmailCondition, boolean>> = {};
  if (fragments.hasNote !== undefined) conditions["ticket.hasNote"] = fragments.hasNote;
  else if (fragments.details !== undefined) conditions["ticket.hasNote"] = Boolean(fragments.details.trim());
  if (fragments.hasTimeEntries !== undefined) conditions["ticket.hasTimeEntries"] = fragments.hasTimeEntries;
  if (fragments.hasAttachments !== undefined) {
    conditions["ticket.hasAttachments"] = fragments.hasAttachments;
    conditions["message.hasAttachments"] = fragments.hasAttachments;
  }
  if (ticket.status) conditions["ticket.isClosed"] = isSettledTicketStatus(ticket.status);
  return { fields, conditions, brand, composerHtml: fragments.composerHtml };
}

/** An invoice, as the merge fields see it. */
export function invoiceEmailContext(invoice: InvoiceEmailRecord, fragments: EmailFragments = {}, brand?: EmailBrandValues): EmailRenderContext {
  const daysOverdue = Math.max(0, Math.floor((Date.now() - invoice.dueDate.getTime()) / 86_400_000));
  const overdue = fragments.overdueDays ?? daysOverdue;
  const fields: Record<string, string | null | undefined> = {
    "invoice.number": invoice.invoiceNumber,
    "invoice.total": formatMoney(invoice.total),
    "invoice.dueDate": formatDateLong(invoice.dueDate),
    "invoice.daysOverdue": String(overdue),
    "invoice.url": `${webOrigin()}/billing?invoice=${invoice.id}`,
    "client.name": invoice.company?.name ?? "",
    "contact.email": invoice.company?.email ?? undefined,
    "message.overdueFor": overdue === 1 ? "1 day overdue" : `${overdue} days overdue`,
  };
  return {
    fields,
    conditions: { "invoice.isOverdue": overdue > 0 },
    brand,
  };
}

/** The sign-in and portal messages: a code, and where to use it. */
export function codeEmailContext(fragments: EmailFragments, brand?: EmailBrandValues, extra: Record<string, string | null | undefined> = {}): EmailRenderContext {
  const values = brand ?? DEFAULT_BRAND;
  const fields: Record<string, string | null | undefined> = {
    ...instanceFields(values),
    "message.code": fragments.code,
    "portal.code": fragments.code,
    "portal.url": fragments.portalUrl ?? "",
    // The sentence, supplied whole: with no portal address there is nothing to say, and the block is
    // omitted rather than sent as "Sign in at —".
    "message.portalLine": fragments.portalUrl ? `Sign in at ${fragments.portalUrl}.` : "",
    ...extra,
  };
  return { fields, conditions: {}, brand: values };
}

export function sampleContext(key: EmailMessageKey, brand: EmailBrandValues): EmailRenderContext {
  const entry = requireEmailMessage(key);
  return {
    fields: { ...instanceFields(brand), ...SAMPLE_FIELDS[key] },
    conditions: {},
    brand,
    composerHtml: entry.bodyFromComposer
      ? "<p>The replacement licence has been assigned to Sarah's mailbox and Outlook has been re-signed in on her laptop.</p>"
      : undefined,
  };
}

export type PreviewTarget = { kind: "ticket" | "invoice"; id: string } | { kind: "sample" };

/**
 * A context for a preview, or for a test send: `sample` uses the named records from the seed, and a
 * real target loads the record and merges it over the instance values. Deliberately the same builder
 * the live callers use, so a preview is the message rather than a likeness of it.
 */
export async function previewContext(key: EmailMessageKey, target: PreviewTarget, brand: EmailBrandValues): Promise<EmailRenderContext> {
  const entry = requireEmailMessage(key);
  const fragments: EmailFragments = {
    composerSubject: String(SAMPLE_FIELDS[key]?.["message.subject"] ?? "Replacement licence assigned"),
    eventLabel: "New note added",
  };
  if (target.kind === "sample") return sampleContext(key, brand);

  if (target.kind === "invoice") {
    const invoice = await prisma.invoice.findUnique({
      where: { id: target.id },
      select: { id: true, invoiceNumber: true, total: true, dueDate: true, status: true, company: { select: { name: true, email: true } } },
    });
    if (!invoice) throw new AppError("Invoice not found", 404);
    const context = invoiceEmailContext({ ...invoice, dueDate: new Date(invoice.dueDate) }, fragments, brand);
    return { ...context, fields: { ...instanceFields(brand), ...context.fields } };
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      priority: true,
      updatedAt: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      company: { select: { name: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
  });
  if (!ticket) throw new AppError("Ticket not found", 404);
  if (entry.bodyFromComposer) {
    fragments.composerHtml = "<p>This is a preview of the message that would go out under the footer below.</p>";
  }
  fragments.details = "The ticket was updated, and this is the text the client would read.";
  const context = ticketEmailContext(ticket, fragments, brand);
  return { ...context, fields: { ...instanceFields(brand), ...context.fields } };
}

// ── Preview and send ────────────────────────────────────────────────────────

export async function previewEmail(
  key: EmailMessageKey,
  target: PreviewTarget,
  draft?: { subject?: unknown; blocks?: unknown; text?: unknown },
): Promise<EmailRenderResult & { template: EmailTemplate; target: PreviewTarget }> {
  const { values } = await loadBrandKit();
  const resolved = await resolveTemplate(key);
  const { blocks, error } = draft?.blocks === undefined ? { blocks: resolved.blocks, error: undefined } : validateBlocks(draft.blocks);
  if (error) throw new AppError(error, 400);
  const template = {
    key: resolved.key,
    subject: typeof draft?.subject === "string" ? draft.subject : resolved.subject,
    blocks,
    text: draft?.text === null ? null : typeof draft?.text === "string" ? draft.text : resolved.text,
  };
  const context = await previewContext(key, target, values);
  const render = renderEmail(template, context);
  return { ...render, template: await templateDto(key), target };
}

export interface SendAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
  contentDisposition?: "inline" | "attachment";
}

export interface EmailSendInput {
  key: EmailMessageKey;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  /** The record, in the vocabulary's own terms. `brand` is filled in from the brand kit. */
  context: EmailRenderContext;
  /** An unsaved draft, so a test send is of what is on screen rather than of what is stored. */
  draft?: { subject?: unknown; blocks?: unknown; text?: unknown };
  attachments?: SendAttachment[];
  /** True for a Studio test send, so it is never mistaken for a message a customer received. */
  test?: boolean;
  sentById?: string;
}

export interface EmailSendOutcome {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  subject: string;
  html: string;
  text: string;
  warnings: string[];
  /** The version that went out. Null means the built-in default. */
  templateVersion: number | null;
}

function addresses(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map((value) => String(value).trim()).filter(Boolean);
}

/**
 * Resolve → render → send → log, and never throw.
 *
 * The caller decides what a failure means: the ticket notification paths log it and move on, and the
 * Studio's test send reports it back to the person who pressed the button.
 */
export async function sendEmailTemplate(input: EmailSendInput): Promise<EmailSendOutcome> {
  const brandKit = await loadBrandKit();
  const resolved = await resolveTemplate(input.key);
  // A test send of an unsaved draft is the case the Studio exists for: the person is looking at words
  // that are not stored yet, and the test has to be of those.
  const draft = input.draft ? prepareDraft(input.key, { ...input.draft, note: null }) : null;
  const template = draft
    ? { key: resolved.key, subject: draft.subject, blocks: draft.blocks, text: draft.text }
    : { key: resolved.key, subject: resolved.subject, blocks: resolved.blocks, text: resolved.text };
  // `instance.*` always resolves, from the brand kit, so a message that names the product cannot come
  // out saying "—" because the caller forgot a field it does not own.
  const fields = { ...instanceFields(brandKit.values), ...(input.context.fields ?? {}) };
  const context: EmailRenderContext = { ...input.context, fields, brand: input.context.brand ?? brandKit.values };
  const render = renderEmail(template, context);

  const to = addresses(input.to);
  const outcome: EmailSendOutcome = {
    ok: false,
    subject: render.subject,
    html: render.html,
    text: render.text,
    warnings: render.warnings,
    templateVersion: resolved.version,
  };
  if (!to.length) {
    outcome.error = "No recipient";
    await logSend(input, outcome, render, null);
    return outcome;
  }

  // Inline images travel as cid parts rather than data URIs: most mail clients refuse to render a
  // data: image at all, and Outlook renders none of them.
  const inlined = extractInlineImages(render.html);
  const carried: SendAttachment[] = [
    ...inlined.images.map((image: InlineImage) => ({ filename: image.filename, content: image.buffer, contentType: image.contentType, cid: image.cid, contentDisposition: "inline" as const })),
    ...(input.attachments ?? []),
  ];

  let providerMessageId: string | null = null;
  try {
    const sent = await emailService.send({
      to,
      cc: input.cc?.length ? input.cc : undefined,
      bcc: input.bcc?.length ? input.bcc : undefined,
      subject: render.subject,
      html: inlined.html,
      // Always sent: the message is multipart/alternative, and a mail system that strips HTML
      // still delivers these words.
      text: render.text,
      ...(brandKit.identity.from ? { from: brandKit.identity.from } : {}),
      ...(brandKit.identity.replyTo ? { replyTo: brandKit.identity.replyTo } : {}),
      ...(carried.length ? { attachments: carried } : {}),
    });
    providerMessageId = sent?.messageId ?? null;
    outcome.ok = true;
    outcome.providerMessageId = providerMessageId ?? undefined;
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : String(err);
    logger.warn("email.send", `Could not send ${input.key}`, { to: to.join(", "), error: outcome.error });
  }

  await logSend(input, outcome, render, providerMessageId);
  return outcome;
}

/**
 * Write the delivery log. The mail has already left (or already failed) by the time this runs, so a
 * log failure is warned about and swallowed rather than replacing a successful send with an error.
 */
async function logSend(input: EmailSendInput, outcome: EmailSendOutcome, render: EmailRenderResult, providerMessageId: string | null): Promise<void> {
  try {
    await prisma.emailMessageLog.create({
      data: {
        key: input.key,
        to: addresses(input.to).join(", "),
        cc: input.cc?.length ? input.cc.join(", ") : null,
        subject: render.subject,
        templateKey: input.key,
        templateVersion: outcome.templateVersion,
        providerMessageId,
        result: outcome.ok ? "sent" : "failed",
        error: outcome.error ?? null,
        test: Boolean(input.test),
        sentById: input.sentById ?? null,
      },
    });
  } catch (err) {
    logger.warn("email.log", "Could not write the delivery log", {
      key: input.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── The delivery log, as the API hands it out ───────────────────────────────

export interface DeliveryLogEntry {
  id: string;
  key: string;
  to: string;
  cc: string | null;
  subject: string;
  templateKey: string;
  templateVersion: number | null;
  providerMessageId: string | null;
  result: string;
  error: string | null;
  test: boolean;
  at: string;
  sentByName: string | null;
}

export async function deliveryLog(options: { key?: string; limit?: number; offset?: number } = {}): Promise<{ data: DeliveryLogEntry[]; total: number; counts: { sent: number; failed: number; test: number } }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.key ? { key: options.key } : {};
  const [rows, total, sent, failed, test] = await Promise.all([
    prisma.emailMessageLog.findMany({ where, orderBy: { at: "desc" }, take: limit, skip: offset }),
    prisma.emailMessageLog.count({ where }),
    prisma.emailMessageLog.count({ where: { ...where, result: "sent" } }),
    prisma.emailMessageLog.count({ where: { ...where, result: "failed" } }),
    prisma.emailMessageLog.count({ where: { ...where, test: true } }),
  ]);
  const names = await userNames(rows.map((row) => row.sentById));
  return {
    data: rows.map((row) => ({
      id: row.id,
      key: row.key,
      to: row.to,
      cc: row.cc,
      subject: row.subject,
      templateKey: row.templateKey,
      templateVersion: row.templateVersion,
      providerMessageId: row.providerMessageId,
      result: row.result,
      error: row.error,
      test: row.test,
      at: row.at.toISOString(),
      sentByName: row.sentById ? names.get(row.sentById) ?? null : null,
    })),
    total,
    counts: { sent, failed, test },
  };
}

/** Every key the registry knows, for the coverage probe and the messages list. */
export function registryKeys(): string[] {
  return [...EMAIL_MESSAGE_KEYS];
}

export function messageDefinition(key: string) {
  return emailMessage(key);
}
