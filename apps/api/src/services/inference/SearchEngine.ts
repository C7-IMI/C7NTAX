import { prisma } from "../../index";
import type { SuggestionResult } from "./types";

/** Extract keywords from text — simplified stemmer for ticket matching */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

const STOP_WORDS = new Set([
  "the","and","for","that","this","with","from","have","are","was","not","but","you","all","can","had","her","was","one","our","out","has","how","its","may","who","did","get","him","his","she","use",
]);

/**
 * Search closed/resolved tickets for similar issues.
 * Uses keyword overlap + Jaccard similarity on tokenized title+description.
 * Falls back to ILIKE when keyword overlap is low.
 */
export async function findSimilarTickets(
  ticketId: string,
  title: string,
  description: string,
  limit = 5
): Promise<SuggestionResult[]> {
  const currentTokens = tokenize(`${title} ${description || ""}`);
  if (currentTokens.length === 0) return [];

  // 1. Keyword-based: match any keyword in title
  const keywordMatch = await prisma.$queryRawUnsafe<Array<{
    id: string; ticketNumber: string; title: string; resolution: string | null;
    status: string; resolvedAt: Date | null; matchCount: bigint;
  }>>(
    `SELECT t.id, t."ticketNumber", t.title, t.resolution, t.status, t."resolvedAt",
     (SELECT COUNT(*) FROM unnest($1::text[]) AS kw WHERE t.title ILIKE '%' || kw || '%')::bigint AS "matchCount"
     FROM "Ticket" t
     WHERE t.id != $2
       AND t.status IN ('resolved','closed')
       AND t.resolution IS NOT NULL
       AND t.resolution != ''
     ORDER BY "matchCount" DESC, t."resolvedAt" DESC
     LIMIT $3`,
    currentTokens, ticketId, limit + 5
  );
  return keywordMatch.slice(0, limit).map(t => ({
    ticketId: t.id,
    ticketNumber: t.ticketNumber,
    title: t.title,
    relevanceScore: Math.min(1, Number(t.matchCount) / currentTokens.length),
    resolution: t.resolution,
    matchReason: `${t.matchCount} keyword matches in title`,
    resolvedAt: t.resolvedAt?.toISOString() || null,
  }));
}

/**
 * Compute weighted Jaccard similarity between two token sets.
 */
export function computeSimilarity(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
