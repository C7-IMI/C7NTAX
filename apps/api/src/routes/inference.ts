import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AI_PROVIDER_SPECS, AI_RUNTIME_FIELDS, Permission, aiProviderSpec } from "@C7NTAX/shared";
import { inferenceEngine, type InferenceOutput } from "../services/inference";
import { listProviderModels, testProvider, type ProviderRecord } from "../services/inference";
import { AppError } from "../middleware/errorHandler";
import { EgressError, assertSafeUrlLiteral } from "../services/egress";
import { prisma } from "../index";

export const inferenceRouter = Router();
inferenceRouter.use(authenticate);

/** A provider address is called with the stored API key attached, so it is checked on save. */
function checkEndpoint(value: unknown, label = "Endpoint"): void {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    assertSafeUrlLiteral(value.trim());
  } catch (e) {
    if (e instanceof EgressError) throw new AppError(`${label} rejected: ${e.message}`, 400);
    throw e;
  }
}

/**
 * The stored row without its secret, plus the derived fact a screen needs: whether a key is held
 * (never the key itself) and, inside `config`, what the last test and model list observed.
 */
function toSafeProvider(provider: Record<string, unknown> & { apiKey?: string | null }) {
  const { apiKey, ...rest } = provider;
  return { ...rest, hasApiKey: !!apiKey };
}

/** The provider's config bag with an observation merged in, in the shape the column takes. */
function mergeConfig(existing: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  return { ...((existing as Record<string, unknown>) ?? {}), ...patch } as Prisma.InputJsonValue;
}

/** Unknown providers are refused: a stored provider that nothing can call is worse than a 400. */
function assertKnownProvider(provider: unknown): void {
  if (provider === undefined) return;
  if (typeof provider !== "string" || (provider !== "local" && !aiProviderSpec(provider))) {
    throw new AppError(`Unknown provider "${String(provider)}". Known providers: local, ${AI_PROVIDER_SPECS.map(s => s.id).join(", ")}`, 400);
  }
}

/** The catalogue in the shape the connect dialog renders. */
function providerTypes() {
  return {
    runtimeFields: AI_RUNTIME_FIELDS,
    types: AI_PROVIDER_SPECS.map(spec => ({
      id: spec.id,
      label: spec.label,
      vendor: spec.vendor,
      summary: spec.summary,
      shape: spec.shape,
      auth: spec.auth,
      baseUrl: spec.baseUrl,
      addressRequired: !!spec.addressRequired,
      credentials: spec.credentials.map(field => ({
        key: field.key,
        label: field.label,
        type: field.type ?? "text",
        required: !field.optional,
        hint: field.hint,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.options ? { options: field.options } : {}),
      })),
      shortlist: spec.shortlist,
      defaultModel: spec.defaultModel,
      keyUrl: spec.keyUrl,
      docs: spec.docs,
      guidance: spec.guidance,
      toolCalling: spec.toolCalling,
    })),
  };
}

// ── The provider catalogue, for CloudConnect's connect dialog ──────────────
inferenceRouter.get("/provider-types", requirePermission(Permission.InferenceView), (_req: AuthRequest, res) => {
  res.json(providerTypes());
});

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

// ── List configured models ──
inferenceRouter.get("/providers", requirePermission(Permission.InferenceView), async (_req: AuthRequest, res, next) => {
  try {
    const providers = await prisma.aiProviderConfig.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    res.json(providers.map(toSafeProvider));
  } catch (e) { next(e); }
});

// ── Create/update provider config ──
inferenceRouter.post("/providers", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, provider, model, apiKey, apiEndpoint, maxTokens, temperature, topP, isActive, isDefault, config, credentials, appFunctions } = req.body;
    if (!name || !provider) throw new AppError("name and provider required");
    assertKnownProvider(provider);
    checkEndpoint(apiEndpoint);
    checkEndpoint(req.body.credentials?.baseUrl, "Base URL");
    checkEndpoint(req.body.credentials?.endpoint, "Resource endpoint");

    const spec = aiProviderSpec(provider);

    // If setting as default, unset any existing default
    if (isDefault) {
      await prisma.aiProviderConfig.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const created = await prisma.aiProviderConfig.create({
      data: {
        name,
        provider,
        model: model || spec?.defaultModel || "gpt-4o-mini",
        apiKey: apiKey || null,
        apiEndpoint: apiEndpoint || null,
        maxTokens: maxTokens || 2000,
        temperature: temperature ?? 0.3,
        topP: topP ?? 1.0,
        isActive: isActive ?? false,
        isDefault: isDefault ?? false,
        config: { ...(config || {}), ...(credentials ? { credentials } : {}), ...(appFunctions !== undefined ? { appFunctions } : {}) },
      },
    });
    res.status(201).json(toSafeProvider(created));
  } catch (e) { next(e); }
});

// ── Update provider config ──
inferenceRouter.patch("/providers/:id", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "provider", "model", "apiKey", "apiEndpoint", "maxTokens", "temperature", "topP", "isActive", "isDefault"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    assertKnownProvider(req.body.provider);
    checkEndpoint(updates.apiEndpoint);
    checkEndpoint(req.body.credentials?.baseUrl, "Base URL");
    checkEndpoint(req.body.credentials?.endpoint, "Resource endpoint");

    const existing = await prisma.aiProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError("Provider not found", 404);

    /*
     * The config bag holds both the vendor-specific fields the operator entered and what the last
     * test and model list observed. A change to one must not wipe the others, or saving a corrected
     * key would erase the evidence of the failure the operator is looking at while correcting it.
     */
    const existingConfig = (existing.config as Record<string, unknown>) ?? {};
    updates.config = mergeConfig(existingConfig, {
      ...(req.body.config ?? {}),
      ...(req.body.credentials ? { credentials: { ...((existingConfig.credentials as Record<string, unknown>) ?? {}), ...req.body.credentials } } : {}),
      ...(req.body.appFunctions !== undefined ? { appFunctions: req.body.appFunctions } : {}),
    });

    if (updates.isDefault) {
      await prisma.aiProviderConfig.updateMany({ where: { isDefault: true, id: { not: req.params.id } }, data: { isDefault: false } });
    }

    const updated = await prisma.aiProviderConfig.update({ where: { id: req.params.id }, data: updates });
    res.json(toSafeProvider(updated));
  } catch (e) { next(e); }
});

// ── Delete provider ──
inferenceRouter.delete("/providers/:id", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.aiProviderConfig.delete({ where: { id: req.params.id } });
    res.json({ message: "Provider removed" });
  } catch (e) { next(e); }
});

/** The stored row as the transport wants it, without the environment's model override. */
function transportRecord(provider: {
  provider: string; apiKey: string | null; apiEndpoint: string | null; model: string;
  maxTokens: number; temperature: number; topP: number; config: unknown;
}, model?: string): ProviderRecord {
  return {
    provider: provider.provider,
    apiKey: provider.apiKey,
    apiEndpoint: provider.apiEndpoint,
    model: model ?? provider.model,
    maxTokens: provider.maxTokens,
    temperature: provider.temperature,
    topP: provider.topP,
    config: provider.config,
  };
}

/**
 * Ask the vendor whether this key works, and remember what it said.
 *
 * The answer is stored on the provider rather than returned and forgotten: the state of a connection
 * is a fact about the connection, and the next reader of this screen — or the assistant's error
 * message — should not have to run the test again to know what the vendor said last time.
 */
inferenceRouter.post("/providers/:id/test", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const provider = await prisma.aiProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!provider) throw new AppError("Provider not found", 404);
    if (provider.provider === "local") {
      res.json({ success: true, detail: "The local keyword engine needs no connection", latencyMs: 0, models: [] });
      return;
    }

    const model = typeof req.body?.model === "string" && req.body.model ? req.body.model : undefined;
    const outcome = await testProvider(transportRecord(provider, model));
    const observed = outcome.data?.models ?? [];
    const lastTest = {
      ok: outcome.ok,
      detail: outcome.detail,
      at: new Date().toISOString(),
      latencyMs: outcome.latencyMs,
      model: model ?? provider.model,
    };

    const observedPatch: Record<string, unknown> = { lastTest };
    if (outcome.ok && observed.length) {
      observedPatch.models = observed;
      observedPatch.modelsFetchedAt = lastTest.at;
    }
    await prisma.aiProviderConfig.update({
      where: { id: provider.id },
      data: { config: mergeConfig(provider.config, observedPatch) },
    });

    res.json({ success: outcome.ok, detail: outcome.detail, latencyMs: outcome.latencyMs, models: observed, lastTest });
  } catch (e) { next(e); }
});

// ── What this key can see ──
/**
 * The vendor's own model list, with the catalogue's shortlist as the fallback.
 *
 * The fallback is labelled as such in the reply. A screen that showed the shortlist as though the
 * key had been asked would be inventing a fact — and the difference matters exactly when a key is
 * scoped to one project and cannot see the model somebody typed.
 */
inferenceRouter.get("/providers/:id/models", requirePermission(Permission.InferenceView), async (req: AuthRequest, res, next) => {
  try {
    const provider = await prisma.aiProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!provider) throw new AppError("Provider not found", 404);

    const spec = aiProviderSpec(provider.provider);
    if (!spec) {
      res.json({ models: [], source: "none", detail: "This provider has no model list", shortlist: [] });
      return;
    }

    if (req.query.cached === "true") {
      const config = (provider.config as Record<string, unknown>) ?? {};
      const cached = (config.models as Array<{ id: string }> | undefined) ?? [];
      res.json({ models: cached, source: cached.length ? "cached" : "shortlist", shortlist: spec.shortlist, fetchedAt: config.modelsFetchedAt ?? null });
      return;
    }

    const outcome = await listProviderModels(transportRecord(provider));
    if (!outcome.ok || !outcome.data) {
      res.json({ models: [], source: "unavailable", detail: outcome.detail, shortlist: spec.shortlist });
      return;
    }

    const models = outcome.data.models;
    await prisma.aiProviderConfig.update({
      where: { id: provider.id },
      data: { config: mergeConfig(provider.config, { models, modelsFetchedAt: new Date().toISOString() }) },
    });
    res.json({
      models,
      source: "provider",
      detail: models.length ? null : "The key was accepted, but the vendor listed no models",
      shortlist: spec.shortlist,
      latencyMs: outcome.latencyMs,
    });
  } catch (e) { next(e); }
});

// ── Use this model for the application ──
/**
 * Nominate the model the application — and the assistant — use.
 *
 * Both flags move together: "active" without "default" leaves a connection that can be tested and
 * never called, which is a state nobody asks for and everybody then has to debug.
 */
inferenceRouter.post("/providers/:id/activate", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const provider = await prisma.aiProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!provider) throw new AppError("Provider not found", 404);
    if (provider.provider !== "local" && !provider.apiKey) {
      throw new AppError("This connection has no API key yet — save one before making it the model the application uses", 400);
    }

    await prisma.aiProviderConfig.updateMany({
      where: { id: { not: provider.id }, isDefault: true },
      data: { isDefault: false },
    });
    const updated = await prisma.aiProviderConfig.update({
      where: { id: provider.id },
      data: { isActive: true, isDefault: true },
    });
    res.json({ success: true, provider: toSafeProvider(updated) });
  } catch (e) { next(e); }
});

inferenceRouter.post("/providers/:id/deactivate", requirePermission(Permission.InferenceManage), async (req: AuthRequest, res, next) => {
  try {
    const updated = await prisma.aiProviderConfig.update({
      where: { id: req.params.id },
      data: { isActive: false, isDefault: false },
    });
    res.json({ success: true, provider: toSafeProvider(updated) });
  } catch (e) { next(e); }
});

// ── Which model is in use, for the screens that have to say so ──
inferenceRouter.get("/status", requirePermission(Permission.InferenceView), async (_req: AuthRequest, res, next) => {
  try {
    const providers = await prisma.aiProviderConfig.findMany({
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    const active = providers.find(p => p.isActive && p.isDefault) ?? null;
    const spec = active ? aiProviderSpec(active.provider) : undefined;
    const config = (active?.config as Record<string, unknown>) ?? {};
    res.json({
      connected: !!active,
      provider: active?.provider ?? null,
      providerLabel: spec?.label ?? (active?.provider === "local" ? "Local keyword engine" : null),
      model: active?.model ?? null,
      name: active?.name ?? null,
      appFunctions: config.appFunctions === true,
      toolCalling: spec?.toolCalling ?? false,
      lastTest: config.lastTest ?? null,
      counts: { total: providers.length, active: providers.filter(p => p.isActive).length },
    });
  } catch (e) { next(e); }
});
