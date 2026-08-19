import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Backlog item 10 — mobile backend enablement: push device registration + sync markers.
export const pushRouter = Router();

pushRouter.use((_req, res, next) => {
  if (process.env.PUSH_ENABLED === "false") return res.status(404).json({ error: "Push disabled" });
  next();
});
pushRouter.use(authenticate);

pushRouter.post("/devices", async (req: AuthRequest, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token) throw new AppError("token required");
    const device = await prisma.pushDevice.upsert({
      where: { token }, update: { lastSeenAt: new Date(), platform: platform || "web", userId: req.user!.userId },
      create: { token, platform: platform || "web", userId: req.user!.userId },
    });
    res.status(201).json(device);
  } catch (e) { next(e); }
});

pushRouter.delete("/devices/:token", async (req: AuthRequest, res, next) => {
  try {
    await prisma.pushDevice.deleteMany({ where: { token: req.params.token, userId: req.user!.userId } });
    res.json({ message: "Device unregistered" });
  } catch (e) { next(e); }
});

// Sync markers: cursor endpoints returning updatedAt maxima — additive, response shapes unchanged elsewhere.
pushRouter.get("/sync-markers", async (_req: AuthRequest, res, next) => {
  try {
    const [tickets, clients, kb] = await Promise.all([
      prisma.ticket.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.company.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.knowledgeBaseArticle.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    ]);
    res.json({ markers: { tickets: tickets?.updatedAt ?? null, clients: clients?.updatedAt ?? null, kb: kb?.updatedAt ?? null } });
  } catch (e) { next(e); }
});
