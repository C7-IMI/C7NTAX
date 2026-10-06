import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
export const surveysRouter = Router(); surveysRouter.use(authenticate);

surveysRouter.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const surveys = await prisma.survey.findMany();
    const [questionCounts, responseCounts] = await Promise.all([
      prisma.surveyQuestion.groupBy({ by: ["surveyId"], _count: { _all: true } }),
      prisma.surveyResponse.groupBy({ by: ["surveyId"], _count: { _all: true } }),
    ]);
    const questionCount = new Map(questionCounts.map(c => [c.surveyId, c._count._all]));
    const responseCount = new Map(responseCounts.map(c => [c.surveyId, c._count._all]));
    res.json(surveys.map(s => ({ ...s, _count: { questions: questionCount.get(s.id) ?? 0, responses: responseCount.get(s.id) ?? 0 } })));
  }
  catch (e) { next(e); }
});

surveysRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const s = await prisma.survey.create({ data: { name: req.body.name, description: req.body.description || null, type: req.body.type || "csat", sendOnResolve: req.body.sendOnResolve || false, sendDelayHours: req.body.sendDelayHours || 1 } }); res.status(201).json(s); }
  catch (e) { next(e); }
});

surveysRouter.get("/:id", async (req: AuthRequest, res, next) => {
  try {
    const s = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!s) throw new AppError("Not found", 404);
    const [questions, responses] = await Promise.all([
      prisma.surveyQuestion.findMany({ where: { surveyId: s.id }, orderBy: { sortOrder: "asc" } }),
      prisma.surveyResponse.findMany({ where: { surveyId: s.id } }),
    ]);
    const answers = responses.length
      ? await prisma.surveyAnswer.findMany({ where: { responseId: { in: responses.map(r => r.id) } } })
      : [];
    const questionById = new Map(questions.map(q => [q.id, q]));
    res.json({
      ...s,
      questions,
      responses: responses.map(r => ({
        ...r,
        answers: answers.filter(a => a.responseId === r.id).map(a => ({ ...a, question: questionById.get(a.questionId) ?? null })),
      })),
    });
  }
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
      data: { surveyId: req.params.id, ticketId: ticketId || null, companyId: req.user!.companyId, userId: req.user!.userId, npsScore: npsScore || null },
    });
    const submitted: { questionId: string; value: string }[] = answers || [];
    if (submitted.length) {
      await prisma.surveyAnswer.createMany({ data: submitted.map(a => ({ responseId: resp.id, questionId: a.questionId, value: a.value })) });
    }
    res.status(201).json({ ...resp, answers: await prisma.surveyAnswer.findMany({ where: { responseId: resp.id } }) });
  } catch (e) { next(e); }
});

surveysRouter.get("/responses/:id", async (req: AuthRequest, res, next) => {
  try {
    const response = await prisma.surveyResponse.findUnique({ where: { id: req.params.id } });
    if (!response) { res.json(null); return; }
    const [answers, ticket] = await Promise.all([
      prisma.surveyAnswer.findMany({ where: { responseId: response.id } }),
      response.ticketId ? prisma.ticket.findUnique({ where: { id: response.ticketId }, select: { ticketNumber: true } }) : Promise.resolve(null),
    ]);
    const questions = answers.length
      ? await prisma.surveyQuestion.findMany({ where: { id: { in: answers.map(a => a.questionId) } } })
      : [];
    const questionById = new Map(questions.map(q => [q.id, q]));
    res.json({ ...response, answers: answers.map(a => ({ ...a, question: questionById.get(a.questionId) ?? null })), ticket });
  }
  catch (e) { next(e); }
});
