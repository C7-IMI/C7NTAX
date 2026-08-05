import { prisma } from "../../index";
import crypto from "crypto";

export interface SuggestionResult {
  ticketId: string;
  ticketNumber: string;
  title: string;
  relevanceScore: number;
  resolution: string | null;
  matchReason: string;
  resolvedAt: string | null;
}

export interface PatternResult {
  name: string;
  description: string | null;
  category: "recurring_issue" | "emerging_trend" | "sla_risk" | "knowledge_gap";
  severity: "low" | "medium" | "high" | "critical";
  affectedTicketIds: string[];
  metrics: Record<string, unknown>;
  timeframe: string;
}

export interface InferenceOutput {
  suggestions: SuggestionResult[];
  patterns: PatternResult[];
  summary: string;
}

/** Build a cache hash from ticket ID + type */
export function cacheHash(ticketId: string, type: string): string {
  return crypto.createHash("sha256").update(`${ticketId}:${type}:v1`).digest("hex");
}

/** Check if a cached inference result exists and is fresh (<24h) */
export async function getCached(
  ticketId: string,
  requestType: string,
  providerId: string
): Promise<{ response: InferenceOutput; id: string } | null> {
  const hash = cacheHash(ticketId, requestType);
  const cached = await prisma.inferenceCache.findFirst({
    where: { requestHash: hash, providerId },
    orderBy: { createdAt: "desc" },
  });
  if (cached && cached.createdAt.getTime() > Date.now() - 24 * 3600_000) {
    await prisma.inferenceCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } });
    return { response: cached.response as unknown as InferenceOutput, id: cached.id };
  }
  return null;
}

/** Store inference result in cache */
export async function setCache(
  ticketId: string,
  requestType: string,
  providerId: string,
  response: InferenceOutput,
  tokensUsed = 0,
  latencyMs = 0
): Promise<void> {
  await prisma.inferenceCache.create({
    data: {
      ticketId, providerId, requestType,
      requestHash: cacheHash(ticketId, requestType),
      response: response as unknown as Record<string, unknown>,
      tokensUsed, latencyMs,
      costEstimate: (tokensUsed / 1000) * 0.002, // rough estimate
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
}
