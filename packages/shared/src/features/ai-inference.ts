import { z } from "zod";

// ─── AI Provider Config ─────────────────────────────────────────────

export const aiProviderConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.enum(["local","openai","anthropic","azure_openai","custom"]),
  isActive: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  apiKey: z.string().nullable(),
  apiEndpoint: z.string().url().nullable().or(z.literal("")),
  model: z.string().default("gpt-4o-mini"),
  maxTokens: z.number().int().positive().default(2000),
  temperature: z.number().min(0).max(2).default(0.3),
  topP: z.number().min(0).max(1).default(1.0),
  config: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── Inference Requests & Responses ─────────────────────────────────

export const inferenceRequestSchema = z.object({
  ticketId: z.string().uuid(),
  type: z.enum(["suggest_solutions","detect_patterns","analyze_ticket"]),
  providerId: z.string().uuid().optional(),
  forceRefresh: z.boolean().default(false),
});

export const solutionSuggestionSchema = z.object({
  id: z.string(),
  ticketId: z.string().uuid(),
  ticketNumber: z.string(),
  title: z.string(),
  relevanceScore: z.number(),
  resolution: z.string().nullable(),
  matchReason: z.string(),
  resolvedAt: z.string().datetime().nullable(),
});

export const detectedPatternSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.enum(["recurring_issue","emerging_trend","sla_risk","knowledge_gap"]),
  severity: z.enum(["low","medium","high","critical"]).default("medium"),
  entityType: z.enum(["ticket","client","board","category"]),
  entityIds: z.array(z.string()).default([]),
  metrics: z.record(z.unknown()).default({}),
  affectedTicketCount: z.number().int().optional(),
  timeframe: z.string().optional(), // e.g. "last 30 days"
});

export const inferenceResponseSchema = z.object({
  type: z.string(),
  ticketId: z.string().uuid(),
  suggestions: z.array(solutionSuggestionSchema).default([]),
  patterns: z.array(detectedPatternSchema).default([]),
  summary: z.string().nullable(),
  tokensUsed: z.number().int().default(0),
  costEstimate: z.number().default(0),
  latencyMs: z.number().int().default(0),
  cached: z.boolean().default(false),
  provider: z.string(),
  model: z.string(),
});

export const patternListQuery = z.object({
  category: z.enum(["recurring_issue","emerging_trend","sla_risk","knowledge_gap"]).optional(),
  severity: z.enum(["low","medium","high","critical"]).optional(),
  status: z.enum(["open","acknowledged","investigating","resolved","dismissed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type InferenceResponse = z.infer<typeof inferenceResponseSchema>;
export type SolutionSuggestion = z.infer<typeof solutionSuggestionSchema>;
export type DetectedPattern = z.infer<typeof detectedPatternSchema>;
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;
