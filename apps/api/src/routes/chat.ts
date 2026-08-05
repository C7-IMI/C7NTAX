import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { notifyUser } from "../ws";
export const chatRouter = Router(); chatRouter.use(authenticate);

chatRouter.get("/sessions", async (req: AuthRequest, res, next) => {
  try { const { status } = req.query as Record<string, string>; const where: Record<string, unknown> = {};
    if (status) where.status = status; else where.status = { in: ["active","waiting"] };
    res.json(await prisma.chatSession.findMany({ where, orderBy: { startedAt: "desc" }, include: { company: { select: { name: true } }, assignedTo: { select: { firstName: true, lastName: true } }, _count: { select: { messages: true } } } })); }
  catch (e) { next(e); }
});

chatRouter.post("/sessions", async (req: AuthRequest, res, next) => {
  try { const session = await prisma.chatSession.create({ data: { companyId: req.user!.companyId || req.body.companyId, userId: req.user!.userId, guestName: req.body.guestName || null, guestEmail: req.body.guestEmail || null } });
    prisma.chatMessage.create({ data: { sessionId: session.id, senderType: "user", senderId: req.user!.userId, content: req.body.message || "Chat started", contentType: "system" } });
    res.status(201).json(session); }
  catch (e) { next(e); }
});

chatRouter.get("/sessions/:id/messages", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.chatMessage.findMany({ where: { sessionId: req.params.id }, orderBy: { createdAt: "asc" }, include: { sender: { select: { firstName: true, lastName: true } } } })); }
  catch (e) { next(e); }
});

chatRouter.post("/sessions/:id/messages", async (req: AuthRequest, res, next) => {
  try { const msg = await prisma.chatMessage.create({ data: { sessionId: req.params.id, senderType: "technician", senderId: req.user!.userId, content: req.body.content } });
    const session = await prisma.chatSession.findUnique({ where: { id: req.params.id }, select: { userId: true } });
    if (session?.userId) notifyUser(session.userId, { type: "chat_message", payload: { sessionId: req.params.id, message: msg } });
    res.status(201).json(msg); }
  catch (e) { next(e); }
});

chatRouter.patch("/sessions/:id", async (req: AuthRequest, res, next) => {
  try { const updates: Record<string, unknown> = {};
    if (req.body.status) { updates.status = req.body.status; if (req.body.status === "closed") updates.closedAt = new Date(); }
    if (req.body.assignedToId !== undefined) updates.assignedToId = req.body.assignedToId;
    if (req.body.ticketId) updates.ticketId = req.body.ticketId;
    res.json(await prisma.chatSession.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});
