import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission } from "@C7NTAX/shared";
import crypto from "crypto";
import { configFlag } from "../services/appSettings";
import { EgressError, assertSafeUrlLiteral } from "../services/egress";
import { SUBSCRIBABLE_EVENTS, WEBHOOK_EVENTS, MAX_RETRIES, sendTestDelivery } from "../services/webhookDispatch";

// Backlog item 4 — alert webhook registration + delivery log (gated by ALERT_WEBHOOKS_ENABLED).
// Registration is half of the feature; `services/webhookDispatch.ts` is the half that sends, and
// the event catalogue is exported from there so a page can only subscribe to what can be delivered.
export const alertWebhooksRouter = Router();

alertWebhooksRouter.use((_req, res, next) => {
  if (!configFlag("monitoring", "alertWebhooks")) return res.status(404).json({ error: "Alert webhooks disabled" });
  next();
});
alertWebhooksRouter.use(authenticate);

/** Subscriptions are validated against the list the dispatcher delivers, never against a copy. */
function cleanEvents(input: unknown): string[] {
  if (input === undefined) return [...SUBSCRIBABLE_EVENTS];
  const wanted = Array.isArray(input) ? input.map(String) : [];
  const events = [...new Set(wanted.filter((e) => SUBSCRIBABLE_EVENTS.includes(e)))];
  if (events.length === 0) throw new AppError("Choose at least one event for this endpoint", 400);
  return events;
}

/**
 * Checked as literal text on save and again as a resolved address before every request, so a typo
 * is refused while the person is still looking at the field.
 */
function cleanUrl(input: unknown): string {
  const url = typeof input === "string" ? input.trim() : "";
  if (!url) throw new AppError("An endpoint URL is required", 400);
  try {
    assertSafeUrlLiteral(url);
  } catch (e) {
    if (e instanceof EgressError) throw new AppError(e.message, 400);
    throw e;
  }
  return url;
}

/** A name is optional; the host is a better default than "Alert webhook" in a list of several. */
const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** How many attempts an endpoint is worth before the delivery is logged as failed. */
function cleanRetries(input: unknown): number {
  if (input === undefined) return 3;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RETRIES) {
    throw new AppError(`Retries must be a whole number between 1 and ${MAX_RETRIES}`, 400);
  }
  return n;
}

// The signing secret stays server-side: it is what proves a delivery is ours. It is returned once,
// on the response that creates the endpoint, and never listed again.
alertWebhooksRouter.get("/", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.webhookConfig.findMany({ orderBy: { createdAt: "desc" } });
    res.json({
      data: configs.map(({ secret, ...rest }) => ({ ...rest, host: hostOf(rest.url) })),
      events: WEBHOOK_EVENTS,
    });
  } catch (e) { next(e); }
});

alertWebhooksRouter.post("/", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const { url, events, name, retryCount } = req.body || {};
    const endpoint = cleanUrl(url);
    const cfg = await prisma.webhookConfig.create({
      data: {
        name: (typeof name === "string" && name.trim()) || hostOf(endpoint),
        url: endpoint,
        secret: crypto.randomUUID(),
        events: cleanEvents(events),
        retryCount: cleanRetries(retryCount),
        isActive: true,
      },
    });
    res.status(201).json(cfg);
  } catch (e) { next(e); }
});

// ── Manage: edit one, including parking it without losing what it has already received ──
alertWebhooksRouter.patch("/:id", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const { name, url, events, isActive, retryCount } = req.body || {};
    const data: Record<string, unknown> = {};
    if (url !== undefined) data.url = cleanUrl(url);
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed) data.name = trimmed;
      else {
        const current = await prisma.webhookConfig.findUnique({ where: { id: req.params.id }, select: { url: true } });
        if (!current) throw new AppError("Webhook not found", 404);
        data.name = hostOf(String(data.url ?? current.url));
      }
    }
    if (events !== undefined) data.events = cleanEvents(events);
    if (retryCount !== undefined) data.retryCount = cleanRetries(retryCount);
    if (isActive !== undefined) data.isActive = !!isActive;
    if (Object.keys(data).length === 0) throw new AppError("Nothing to update", 400);

    const cfg = await prisma.webhookConfig.update({ where: { id: req.params.id }, data });
    const { secret: _secret, ...rest } = cfg;
    res.json({ ...rest, host: hostOf(rest.url) });
  } catch (e) { next(e); }
});

alertWebhooksRouter.delete("/:id", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    // Deliveries go with it: an endpoint that no longer exists cannot be fixed, so its log would
    // sit in the list for ever explaining a failure nobody can act on.
    await prisma.alertWebhookDelivery.deleteMany({ where: { webhookId: req.params.id } });
    await prisma.webhookConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Webhook removed" });
  } catch (e) { next(e); }
});

// ── Manage: one delivery, now — so an endpoint is proved before an incident needs it ──
alertWebhooksRouter.post("/:id/test", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const cfg = await prisma.webhookConfig.findUnique({ where: { id: req.params.id } });
    if (!cfg) throw new AppError("Webhook not found", 404);
    res.json(await sendTestDelivery(cfg));
  } catch (e) { next(e); }
});

alertWebhooksRouter.get("/deliveries", requirePermission(Permission.SystemConfig), async (_req: AuthRequest, res, next) => {
  try {
    const deliveries = await prisma.alertWebhookDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ data: deliveries });
  } catch (e) { next(e); }
});
