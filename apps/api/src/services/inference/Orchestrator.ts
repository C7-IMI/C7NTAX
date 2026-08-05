import { prisma } from "../../index";
import { findSimilarTickets } from "./SearchEngine";
import { detectPatterns } from "./PatternDetector";
import { llmSuggestSolutions } from "./LlmProvider";
import { getCached, setCache } from "./types";
import type { InferenceOutput, SuggestionResult, PatternResult } from "./types";

/**
 * InferenceEngine — orchestrates solution suggestions and pattern detection.
 * Uses a layered approach:
 * 1. Local keyword search (fast, always available)
 * 2. LLM-enriched suggestions (when provider is configured)
 * 3. Pattern detection across ticket corpus
 * Results are cached per ticket for 24h.
 */
export class InferenceEngine {
  /**
   * Analyze a ticket and return suggestions + patterns.
   */
  async analyze(ticketId: string, forceRefresh = false): Promise<InferenceOutput> {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, ticketNumber: true, title: true, description: true, boardId: true, categoryId: true, status: true },
    });
    if (!ticket) throw new Error("Ticket not found");

    // Find default provider
    const defaultProvider = await prisma.aiProviderConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });

    // Check cache
    if (!forceRefresh && defaultProvider) {
      const cached = await getCached(ticketId, "suggest_solutions", defaultProvider.id);
      if (cached) {
        // Still run pattern detection fresh (it's fast)
        const patterns = await detectPatterns(ticket.boardId);
        return { ...cached.response, patterns };
      }
    }

    const startTime = Date.now();

    // Layer 1: Keyword search (fast, always runs)
    const keywordSuggestions = await findSimilarTickets(
      ticketId,
      ticket.title,
      ticket.description || "",
      5
    );

    // Layer 2: LLM enrichment (if provider configured)
    let llmSuggestions: SuggestionResult[] = [];
    let summary = "";
    let tokensUsed = 0;

    if (defaultProvider && defaultProvider.provider !== "local") {
      const llmResult = await llmSuggestSolutions(
        ticketId,
        ticket.title,
        ticket.description || "",
        defaultProvider.id
      );
      llmSuggestions = llmResult.suggestions;
      summary = llmResult.summary;
      tokensUsed = llmResult.tokensUsed;
    }

    // Layer 3: Pattern detection
    const patterns = await detectPatterns(ticket.boardId);

    // Merge suggestions: keyword first, then LLM
    const allSuggestions = [...llmSuggestions, ...keywordSuggestions].slice(0, 8);

    // Deduplicate by resolution text
    const seen = new Set<string>();
    const uniqueSuggestions: SuggestionResult[] = [];
    for (const s of allSuggestions) {
      const key = (s.resolution || s.title).slice(0, 80);
      if (!seen.has(key)) { seen.add(key); uniqueSuggestions.push(s); }
    }

    const output: InferenceOutput = {
      suggestions: uniqueSuggestions,
      patterns,
      summary: summary || generateLocalSummary(keywordSuggestions, patterns),
    };

    // Cache if provider exists
    if (defaultProvider) {
      await setCache(ticketId, "suggest_solutions", defaultProvider.id, output, tokensUsed, Date.now() - startTime);
    }

    // Store similarity links
    for (const s of keywordSuggestions) {
      await prisma.ticketSimilarity.upsert({
        where: { ticketId_similarTicketId: { ticketId, similarTicketId: s.ticketId } },
        create: { ticketId, similarTicketId: s.ticketId, score: s.relevanceScore, method: "keyword" },
        update: { score: s.relevanceScore },
      });
    }

    return output;
  }

  /**
   * Run pattern detection standalone and persist results.
   */
  async refreshPatterns(boardId?: string): Promise<PatternResult[]> {
    const patterns = await detectPatterns(boardId);
    // Persist new patterns
    for (const p of patterns) {
      await prisma.detectedPattern.create({
        data: {
          name: p.name,
          description: p.description,
          category: p.category,
          severity: p.severity,
          entityType: "ticket",
          entityIds: p.affectedTicketIds,
          metrics: p.metrics as Record<string, unknown>,
        },
      });
    }
    return patterns;
  }

  /**
   * Get persisted patterns with filtering.
   */
  async listPatterns(filters?: {
    category?: string;
    severity?: string;
    status?: string;
    limit?: number;
  }): Promise<PatternResult[]> {
    const where: Record<string, unknown> = {};
    if (filters?.category) where.category = filters.category;
    if (filters?.severity) where.severity = filters.severity;
    if (filters?.status) where.status = filters.status;
    const rows = await prisma.detectedPattern.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: filters?.limit || 50,
    });
    return rows.map(r => ({
      name: r.name,
      description: r.description,
      category: r.category as PatternResult["category"],
      severity: r.severity as PatternResult["severity"],
      affectedTicketIds: r.entityIds,
      metrics: r.metrics as Record<string, unknown>,
      timeframe: "",
    }));
  }
}

function generateLocalSummary(
  suggestions: SuggestionResult[],
  patterns: PatternResult[]
): string {
  const parts: string[] = [];
  if (suggestions.length > 0) {
    parts.push(`${suggestions.length} similar resolved tickets found.`);
  }
  if (patterns.length > 0) {
    const categories = [...new Set(patterns.map(p => p.category))];
    parts.push(`${patterns.length} patterns detected across categories: ${categories.join(", ")}.`);
  }
  return parts.join(" ") || "No similar tickets or patterns found. Consider checking the knowledge base.";
}

export const inferenceEngine = new InferenceEngine();
