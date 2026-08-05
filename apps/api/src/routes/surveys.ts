import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
export const surveysRouter = Router(); surveysRouter.use(authenticate);

surveysRouter.get("/", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.survey.findMany({ include: { _count: { select: { questions: true, responses: true } } } })); }
  catch (e) { next(e); }
});

surveysRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const s = await prisma.survey.create({ data: { name: req.body.name, description: req.body.description || null, type: req.body.type || "csat", sendOnResolve: req.body.sendOnResolve || false, sendDelayHours: req.body.sendDelayHours || 1 } }); res.status(201).json(s); }
  catch (e) { next(e); }
});

surveysRouter.get("/:id", async (req: AuthRequest, res, next) => {
  try { const s = await prisma.survey.findUnique({ where: { id: req.params.id }, include: { questions: { orderBy: { sortOrder: "asc" } }, responses: { include: { answers: { include: { question: true } } } } } }); if (!s) throw new AppError("Not found", 404); res.json(s); }
  catch (e) { next(e); }
});

surveysRouter.post("/:id/questions", async (req: AuthRequest, res, next) => {
  try { const q = await prisma.surveyQuestion.create({ data: { surveyId: req.params.id, text: req.body.text, type: req.body.type || "rating", required: req.body.required ?? true, sortOrder: req.body.sortOrder || 0, choices: req.body.choices || [] } }); res.status(201).json(q); }
  catch (e) { next(e); }
});

surveysRouter.post("/:id/responses", async (req: AuthRequest, res, next) => {
  try {
    const { ticketId, answers, npsScore } = req.body;
    const resp = await prisma.surveyResponse.create({
      data: { surveyId: req.params.id, ticketId: ticketId || null, companyId: req.user!.companyId, userId: req.user!.userId, npsScore: npsScore || null,
        answers: { create: (answers || []).map((a: { questionId: string; value: string }) => ({ questionId: a.questionId, value: a.value })) }
      },
      include: { answers: true },
    });
    res.status(201).json(resp);
  } catch (e) { next(e); }
});

surveysRouter.get("/responses/:id", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.surveyResponse.findUnique({ where: { id: req.params.id }, include: { answers: { include: { question: true } }, ticket: { select: { ticketNumber: true } } } })); }
  catch (e) { next(e); }
});
