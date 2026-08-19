import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission } from "@C7NTAX/shared";

// Backlog item 5 — AI risk-classified actions (provider-agnostic; gated by AI_ACTIONS_ENABLED).
// Critical actions are never executable; high actions require approval; low/medium execute on approval.
export const aiActionsRouter = Router();

aiActionsRouter.use((_req, res, next) => {
  if (process.env.AI_ACTIONS_ENABLED === "false") return res.status(404).json({ error: "AI actions disabled" });
  next();
});
aiActionsRouter.use(authenticate);

aiActionsRouter.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const actions = await prisma.aiAction.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { audit: { orderBy: { at: "desc" }, take: 10 } } });
    res.json({ data: actions });
  } catch (e) { next(e); }
});

aiActionsRouter.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { entityType, entityId, title, summary, riskTier = "low", payload } = req.body;
    if (!entityType || !title) throw new AppError("entityType and title required");
    if (!["low", "medium", "high", "critical"].includes(riskTier)) throw new AppError("invalid riskTier");
    const action = await prisma.aiAction.create({
      data: {
        entityType, entityId: entityId || null, title, summary: summary || "", riskTier,
        payload: payload || {}, status: riskTier === "critical" ? "blocked" : "pending",
        requestedById: req.user!.userId,
        audit: { create: { event: riskTier === "critical" ? "blocked" : "proposed", userId: req.user!.userId, detail: `Risk tier: ${riskTier}` } },
      },
    });
    res.status(201).json(action);
  } catch (e) { next(e); }
});

aiActionsRouter.post("/:id/decide", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const decision = String(req.body.decision || "");
    if (!["approve", "reject"].includes(decision)) throw new AppError("decision must be approve or reject");
    const action = await prisma.aiAction.findUnique({ where: { id: req.params.id } });
    if (!action) throw new AppError("Action not found", 404);
    if (action.status !== "pending") throw new AppError("Action already decided");
    if (action.riskTier === "critical") throw new AppError("Critical actions are blocked and cannot be approved");
    const status = decision === "approve" ? (action.riskTier === "high" ? "approved" : "executed") : "rejected";
    const updated = await prisma.aiAction.update({
      where: { id: action.id },
      data: {
        status, decidedById: req.user!.userId, decidedAt: new Date(),
        audit: { create: { event: decision === "approve" ? (status === "executed" ? "executed" : "approved") : "rejected", userId: req.user!.userId, detail: `Decision: ${decision}` } },
      },
      include: { audit: { orderBy: { at: "desc" }, take: 5 } },
    });
    res.json(updated);
  } catch (e) { next(e); }
});
