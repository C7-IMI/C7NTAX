/**
 * The Email Studio's API: the messages this instance can send, the words it sends, and the record of
 * what left the building.
 *
 * Two permissions, split the way the rest of the application splits reading from changing: `email:view`
 * opens the list, a template, the brand kit and the delivery log — a person who handles a customer
 * asking "did the invoice actually go out" needs the log without being able to rewrite the invoice.
 * `email:manage` changes a template, resets one, saves the brand kit and sends a test.
 *
 * `POST /preview` deliberately needs only `email:view`. It renders against a real record and returns
 * both parts of the message without storing anything, which makes it the honest answer to "what would
 * this look like" for somebody who may not change a word — and because the renderer is the same one
 * `POST /templates/:key/test` and every live send use, the preview is the message rather than a
 * likeness of it.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { EMAIL_CONDITIONS, Permission, type EmailMessageKey } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { isEmailAddress } from "../services/ticketContacts";
import { EMAIL_MESSAGES, emailMessage, emailMessageGroups } from "../services/emailMessages";
import { brandKitDto, loadBrandKit, saveBrandKit } from "../services/brand";
import {
  allTemplateDtos,
  deliveryLog,
  previewContext,
  previewEmail,
  resetTemplate,
  saveTemplate,
  sendEmailTemplate,
  templateDto,
  templateVersions,
  type PreviewTarget,
} from "../services/emailTemplateSend";

export const emailRouter = Router();
emailRouter.use(authenticate);

/** The definition, or a 404 naming the key that is not one of ours. */
function definition(key: string) {
  const entry = emailMessage(key);
  if (!entry) throw new AppError(`Unknown message: ${key}`, 404);
  return entry;
}

/**
 * A preview target from a request body, defaulting to the sample records.
 *
 * Accepts `{ target: { kind, id } }` and also a `kind`/`id` at the top level, because the shape an
 * integrator reaches for first — "render this against ticket X" — is the flat one, and refusing it
 * teaches nothing.
 */
function targetOf(body: unknown, key = "target"): PreviewTarget {
  const root = (body ?? {}) as Record<string, unknown>;
  const value = root[key] ?? (root.kind ? root : undefined);
  if (!value || typeof value !== "object") return { kind: "sample" };
  const target = value as { kind?: unknown; id?: unknown };
  if (target.kind === "ticket" || target.kind === "invoice") {
    if (typeof target.id !== "string" || !target.id) throw new AppError(`${target.kind} needs the id of the record to preview against`, 400);
    return { kind: target.kind, id: target.id };
  }
  if (target.kind === "sample" || target.kind === undefined) return { kind: "sample" };
  throw new AppError("A preview is against a ticket, an invoice or the sample records", 400);
}

// ── The list ────────────────────────────────────────────────────────────────

/**
 * Every message, with what fires it, who reads it and the template in force.
 *
 * The registry is the source for the trigger, the recipients and the fields, because those are facts
 * about the code rather than words somebody edits — the Studio shows them so the person editing can see
 * who will read what they are writing. `counts` is the question the list exists to answer: which of
 * these have we changed?
 */
emailRouter.get("/messages", requirePermission(Permission.EmailView), async (_req, res, next) => {
  try {
    const templates = await allTemplateDtos();
    const byKey = new Map(templates.map((template) => [template.key, template]));
    res.json({
      groups: emailMessageGroups(),
      counts: {
        messages: EMAIL_MESSAGES.length,
        live: EMAIL_MESSAGES.filter((message) => message.live).length,
        neverSent: EMAIL_MESSAGES.filter((message) => !message.live).length,
        customised: templates.filter((template) => template.state !== "default").length,
      },
      conditions: EMAIL_CONDITIONS,
      messages: EMAIL_MESSAGES.map((message) => ({
        key: message.key,
        name: message.name,
        group: message.group,
        audience: message.audience,
        editingClass: message.editingClass,
        live: message.live,
        trigger: message.trigger,
        recipients: message.recipients,
        from: message.from,
        replyTo: message.replyTo,
        attachments: message.attachments,
        fields: message.fields,
        requiredTokens: message.requiredTokens,
        bodyFromComposer: Boolean(message.bodyFromComposer),
        sender: message.sender,
        template: byKey.get(message.key),
      })),
    });
  } catch (e) { next(e); }
});

// ── One template ────────────────────────────────────────────────────────────

emailRouter.get("/templates/:key", requirePermission(Permission.EmailView), async (req: AuthRequest, res, next) => {
  try {
    definition(req.params.key!);
    res.json(await templateDto(req.params.key!));
  } catch (e) { next(e); }
});

/** Saving a template writes a version row first, so history is the record of what was sent. */
emailRouter.put("/templates/:key", requirePermission(Permission.EmailManage), async (req: AuthRequest, res, next) => {
  try {
    const key = req.params.key!;
    definition(key);
    const before = await templateDto(key);
    const after = await saveTemplate(
      key,
      { subject: req.body?.subject, blocks: req.body?.blocks, text: req.body?.text, note: req.body?.note },
      req.user!.userId,
    );
    await record(req, after.version > before.version ? "email_template.updated" : "email_template.saved", key, {
      from: before.version,
      to: after.version,
      state: after.state,
      note: typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : null,
    });
    res.json(after);
  } catch (e) { next(e); }
});

emailRouter.get("/templates/:key/versions", requirePermission(Permission.EmailView), async (req: AuthRequest, res, next) => {
  try {
    definition(req.params.key!);
    res.json({ data: await templateVersions(req.params.key!) });
  } catch (e) { next(e); }
});

/** Back to the code's version. A reset is savable, so the way back is itself on the record. */
emailRouter.post("/templates/:key/reset", requirePermission(Permission.EmailManage), async (req: AuthRequest, res, next) => {
  try {
    const key = req.params.key!;
    definition(key);
    const after = await resetTemplate(key, req.user!.userId);
    await record(req, "email_template.reset", key, { state: after.state, version: after.version });
    res.json(after);
  } catch (e) { next(e); }
});

// ── Preview and test ────────────────────────────────────────────────────────

/**
 * Render a message against a real record, without storing it.
 *
 * The body may carry the blocks as they are in the editor, so an unsaved change can be seen before it
 * is kept; the record decides the merge values. Both parts come back — the HTML and the text derived
 * from it — because the owner asked for a message that is still readable when a mail system strips the
 * markup, and the only way to be sure of that is to look at the text part.
 */
emailRouter.post("/preview", requirePermission(Permission.EmailView), async (req: AuthRequest, res, next) => {
  try {
    const key = String(req.body?.key ?? "");
    definition(key);
    const result = await previewEmail(key as EmailMessageKey, targetOf(req.body), {
      subject: req.body?.subject,
      blocks: req.body?.blocks,
      text: req.body?.text,
    });
    res.json({ subject: result.subject, html: result.html, text: result.text, derivedText: result.derivedText, warnings: result.warnings });
  } catch (e) { next(e); }
});

/**
 * Send a real message to a named address and log it.
 *
 * The outcome is reported rather than thrown away — this is the one place where "it did not go" is
 * something somebody is standing in front of and needs to read — but the log row is written either way,
 * and the send itself never throws out of the service.
 */
emailRouter.post("/templates/:key/test", requirePermission(Permission.EmailManage), async (req: AuthRequest, res, next) => {
  try {
    const key = req.params.key!;
    definition(key);
    const to = String(req.body?.to ?? "").trim();
    if (!to || !isEmailAddress(to)) throw new AppError("A test send needs one valid address to send to", 400);
    const { values } = await loadBrandKit();
    const context = await previewContext(key as EmailMessageKey, targetOf(req.body), values);
    const draft = req.body?.blocks === undefined && req.body?.subject === undefined && req.body?.text === undefined ? undefined : {
      subject: req.body?.subject,
      blocks: req.body?.blocks,
      text: req.body?.text,
    };
    const outcome = await sendEmailTemplate({
      key: key as EmailMessageKey,
      to,
      context,
      draft,
      test: true,
      sentById: req.user!.userId,
    });
    await record(req, "email_template.test_sent", key, { to, sent: outcome.ok, error: outcome.error ?? null });
    if (!outcome.ok) throw new AppError(`The test message could not be sent: ${outcome.error ?? "unknown error"}`, 502);
    res.json({ sent: true, to, subject: outcome.subject, text: outcome.text, warnings: outcome.warnings, providerMessageId: outcome.providerMessageId });
  } catch (e) { next(e); }
});

// ── The brand kit ───────────────────────────────────────────────────────────

emailRouter.get("/brand", requirePermission(Permission.EmailView), async (_req, res, next) => {
  try {
    res.json(await brandKitDto());
  } catch (e) { next(e); }
});

emailRouter.put("/brand", requirePermission(Permission.EmailManage), async (req: AuthRequest, res, next) => {
  try {
    const before = await brandKitDto();
    const after = await saveBrandKit((req.body ?? {}) as Record<string, unknown>, req.user!.userId);
    await record(req, "email_brand.updated", "brand", {
      primaryColor: [before.primaryColor, after.primaryColor],
      companyName: [before.companyName, after.companyName],
      fromEmail: [before.fromEmail, after.fromEmail],
    });
    res.json(after);
  } catch (e) { next(e); }
});

// ── The delivery log ────────────────────────────────────────────────────────

/** What left the building, what failed and why, and which version of the words was used. */
emailRouter.get("/log", requirePermission(Permission.EmailView), async (req: AuthRequest, res, next) => {
  try {
    const query = req.query as Record<string, string>;
    if (query.key) definition(query.key);
    res.json(await deliveryLog({
      key: query.key,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    }));
  } catch (e) { next(e); }
});

/** Template and brand changes are words a customer reads: they belong in the audit trail. */
async function record(req: AuthRequest, action: string, entityId: string, changes: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity: "email",
        entityId: entityId.slice(0, 200),
        changes: changes as never,
        userId: req.user!.userId,
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      },
    });
  } catch { /* the change was made either way; an audit write must not fail the action it records */ }
}
