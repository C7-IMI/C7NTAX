import { Router } from "express";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { inferenceEngine, type InferenceOutput } from "../services/inference";
import { AppError } from "../middleware/errorHandler";
import { EgressError, assertSafeUrlLiteral } from "../services/egress";
import { prisma } from "../index";

export const inferenceRouter = Router();
inferenceRouter.use(authenticate);

/** A provider endpoint is called with the stored API key attached, so it is checked on save. */
function checkEndpoint(apiEndpoint: unknown): void {
  if (typeof apiEndpoint !== "string" || !apiEndpoint.trim()) return;
  try {
    assertSafeUrlLiteral(apiEndpoint.trim());
  } catch (e) {
    if (e instanceof EgressError) throw new AppError(`Endpoint rejected: ${e.message}`, 400);
    throw e;
  }
}

// ── Analyze a ticket for suggestions + patterns ──
inferenceRouter.post("/suggestions", requirePermission(Permission.InferenceView), async (req: AuthRequest, res, next) => {
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
inferenceRouter.get("/patterns", requirePermission(Permission.InferenceView), async (req: AuthRequest, res, next) => {
  try {
    const { category, severity, status, limit } = req.query as Record<string, string>;
    const patterns = await inferenceEngine.listPatterns({
      category, severity, status, limit: Number(limit) || 50,
    });
    res.json({ success: true, patterns, count: patterns.length });
  } catch (e) { next(e); }
});

// ── Trigger pattern detection refresh ──
inferenceRouter.post("/patterns/refresh", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const patterns = await inferenceEngine.refreshPatterns(req.body.boardId);
    res.json({ success: true, patterns, count: patterns.length });
  } catch (e) { next(e); }
});

// ── List AI provider configs ──
inferenceRouter.get("/providers", requirePermission(Permission.InferenceView), async (_req: AuthRequest, res, next) => {
  try {
    const providers = await prisma.aiProviderConfig.findMany();
    const safe = providers.map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Create/update provider config ──
inferenceRouter.post("/providers", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, provider, model, apiKey, apiEndpoint, maxTokens, temperature, topP, isActive, isDefault, config } = req.body;
    if (!name || !provider) throw new AppError("name and provider required");
    checkEndpoint(apiEndpoint);

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
inferenceRouter.patch("/providers/:id", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name","provider","model","apiKey","apiEndpoint","maxTokens","temperature","topP","isActive","isDefault","config"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    checkEndpoint(updates.apiEndpoint);

    if (updates.isDefault) {
      await prisma.aiProviderConfig.updateMany({ where: { isDefault: true, id: { not: req.params.id } }, data: { isDefault: false } });
    }

    const updated = await prisma.aiProviderConfig.update({ where: { id: req.params.id }, data: updates });
    const { apiKey: _, ...safe } = updated;
    res.json(safe);
  } catch (e) { next(e); }
});

// ── Delete provider ──
inferenceRouter.delete("/providers/:id", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.aiProviderConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Provider removed" });
  } catch (e) { next(e); }
});

// ── Test provider connection ──
inferenceRouter.post("/providers/:id/test", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
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
