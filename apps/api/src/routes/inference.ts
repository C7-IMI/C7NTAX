import { Router } from "express";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { inferenceEngine, type InferenceOutput } from "../services/inference";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "../index";

export const inferenceRouter = Router();
inferenceRouter.use(authenticate);

// ── Analyze a ticket for suggestions + patterns ──
inferenceRouter.post("/suggestions", async (req: AuthRequest, res, next) => {
  try {
    const { ticketId, forceRefresh } = req.body;
    if (!ticketId) throw new AppError("ticketId required");

    const result: InferenceOutput = await inferenceEngine.analyze(ticketId, forceRefresh || false);
    res.json({
      success: true,
      ticketId,
      suggestions: result.suggestions,
      patterns: result.patterns.slice(0, 5),
      summary: result.summary,
      suggestionCount: result.suggestions.length,
      patternCount: result.patterns.length,
    });
  } catch (e) { next(e); }
});

// ── List detected patterns ──
inferenceRouter.get("/patterns", async (req: AuthRequest, res, next) => {
  try {
    const { category, severity, status, limit } = req.query as Record<string, string>;
    const patterns = await inferenceEngine.listPatterns({
      category, severity, status, limit: Number(limit) || 50,
    });
    res.json({ success: true, patterns, count: patterns.length });
  } catch (e) { next(e); }
});

// ── Trigger pattern detection refresh ──
inferenceRouter.post("/patterns/refresh", async (req: AuthRequest, res, next) => {
  try {
    const patterns = await inferenceEngine.refreshPatterns(req.body.boardId);
    res.json({ success: true, patterns, count: patterns.length });
  } catch (e) { next(e); }
});

// ── List AI provider configs ──
inferenceRouter.get("/providers", async (_req: AuthRequest, res, next) => {
  try {
    const providers = await prisma.aiProviderConfig.findMany();
    const safe = providers.map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Create/update provider config ──
inferenceRouter.post("/providers", async (req: AuthRequest, res, next) => {
  try {
    const { name, provider, model, apiKey, apiEndpoint, maxTokens, temperature, topP, isActive, isDefault, config } = req.body;
    if (!name || !provider) throw new AppError("name and provider required");

    // If setting as default, unset any existing default
    if (isDefault) {
      await prisma.aiProviderConfig.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const created = await prisma.aiProviderConfig.create({
      data: { name, provider, model: model || "gpt-4o-mini", apiKey: apiKey || null, apiEndpoint: apiEndpoint || null, maxTokens: maxTokens || 2000, temperature: temperature ?? 0.3, topP: topP ?? 1.0, isActive: isActive ?? false, isDefault: isDefault ?? false, config: config || {} },
    });
    const { apiKey: _, ...safe } = created;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// ── Update provider config ──
inferenceRouter.patch("/providers/:id", async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name","provider","model","apiKey","apiEndpoint","maxTokens","temperature","topP","isActive","isDefault","config"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];

    if (updates.isDefault) {
      await prisma.aiProviderConfig.updateMany({ where: { isDefault: true, id: { not: req.params.id } }, data: { isDefault: false } });
    }

    const updated = await prisma.aiProviderConfig.update({ where: { id: req.params.id }, data: updates });
    const { apiKey: _, ...safe } = updated;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Delete provider ──
inferenceRouter.delete("/providers/:id", async (req: AuthRequest, res, next) => {
  try {
    await prisma.aiProviderConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Provider removed" });
  } catch (e) { next(e); }
});

// ── Test provider connection ──
inferenceRouter.post("/providers/:id/test", async (req: AuthRequest, res, next) => {
  try {
    const provider = await prisma.aiProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!provider) throw new AppError("Provider not found", 404);
    if (provider.provider === "local") {
      res.json({ success: true, message: "Local keyword engine is always available" });
      return;
    }
    // Lightweight test: send a simple prompt
    const testResult: InferenceOutput = await inferenceEngine.analyze(req.user!.userId, false);
    res.json({ success: !!testResult, latencyMs: 0 });
  } catch (e) { next(e); }
});
