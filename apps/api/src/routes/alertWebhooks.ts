import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission } from "@C7NTAX/shared";
import crypto from "crypto";

// Backlog item 4 — alert webhook registration + delivery log (gated by ALERT_WEBHOOKS_ENABLED).
export const alertWebhooksRouter = Router();

alertWebhooksRouter.use((_req, res, next) => {
  if (process.env.ALERT_WEBHOOKS_ENABLED === "false") return res.status(404).json({ error: "Alert webhooks disabled" });
  next();
});
alertWebhooksRouter.use(authenticate);

alertWebhooksRouter.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const configs = await prisma.webhookConfig.findMany();
    res.json({ data: configs });
  } catch (e) { next(e); }
});

alertWebhooksRouter.post("/", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    const { url, events, name } = req.body;
    if (!url) throw new AppError("url required");
    const cfg = await prisma.webhookConfig.create({ data: { name: name || "Alert webhook", url, secret: crypto.randomUUID(), events: events || ["alert.opened", "alert.resolved"], isActive: true } });
    res.status(201).json(cfg);
  } catch (e) { next(e); }
});

alertWebhooksRouter.delete("/:id", requirePermission(Permission.SystemConfig), async (req: AuthRequest, res, next) => {
  try {
    await prisma.webhookConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Webhook removed" });
  } catch (e) { next(e); }
});

alertWebhooksRouter.get("/deliveries", async (_req: AuthRequest, res, next) => {
  try {
    const deliveries = await prisma.alertWebhookDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ data: deliveries });
  } catch (e) { next(e); }
});
