import { prisma } from "../../index";
import type { SuggestionResult } from "./types";
import { configText } from "../appSettings";
import { chatWithProvider, type ProviderRecord } from "./vendors";

/**
 * LLM-based inference provider.
 *
 * Sends ticket data to whichever model is connected, and falls back to the local keyword search when
 * none is. The vendor side — addresses, headers, request shape, reply parsing, tool calling — lives
 * in ./vendors, driven by the provider catalogue, so this file is about the ticket-suggestion prompt
 * rather than about who answers it.
 */

/**
 * The provider the application should use: the active default, most recently configured first.
 *
 * Several providers can carry the default flag (the fixtures do), so the most recently updated one
 * wins — whoever just configured a model expects that model to answer.
 */
export async function activeProviderRecord() {
  return prisma.aiProviderConfig.findFirst({
    where: { isActive: true, isDefault: true },
    orderBy: { updatedAt: "desc" },
  });
}

type StoredProvider = {
  provider: string;
  apiKey: string | null;
  apiEndpoint: string | null;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  config?: unknown;
};

/**
 * A stored provider in the shape the transport wants, with the cheap-model override applied.
 *
 * TOKEN-SAVE-08: INFERENCE_MODEL routes AI calls to a cheaper model without editing stored settings.
 */
export function providerRecordOf(provider: StoredProvider): ProviderRecord {
  return {
    provider: provider.provider,
    apiKey: provider.apiKey,
    apiEndpoint: provider.apiEndpoint,
    model: process.env.INFERENCE_MODEL || provider.model,
    maxTokens: provider.maxTokens,
    temperature: provider.temperature,
    topP: provider.topP,
    config: provider.config,
  };
}

export async function llmSuggestSolutions(
  ticketId: string,
  title: string,
  description: string,
  providerId?: string
): Promise<{ suggestions: SuggestionResult[]; summary: string; tokensUsed: number }> {
  const provider = providerId
    ? await prisma.aiProviderConfig.findUnique({ where: { id: providerId } })
    : await activeProviderRecord();

  if (!provider || provider.provider === "local") {
    // Local mode: return empty — suggestions come from SearchEngine
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }

  const prompt = buildPrompt(title, description);
  // A provider that is unreachable, not permitted by the egress policy, or simply out of quota must
  // not break the ticket screen: the keyword layer has already answered, so this stays silent and
  // logs what the vendor said.
  const result = await chatWithProvider(providerRecordOf(provider), {
    messages: [{ role: "user", content: prompt }],
    json: true,
  });
  if (!result.ok || !result.data) {
    console.error(`[LLM] ${provider.provider} failed: ${result.detail}`);
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }

  const parsed = parseSuggestions(result.data.text);
  return { ...parsed, tokensUsed: result.data.tokensUsed || estimateTokens(result.data.text) };
}

// TOKEN-SAVE-08: memoized static prompt prefix (no rebuild per call) +
// excerpt cap for long ticket descriptions
const PROMPT_PREFIX = `You are a technical support assistant for an MSP (Managed Service Provider). Analyze this ticket and respond with:

TICKET:
`;
const PROMPT_SUFFIX = `
Respond with a JSON object containing:
1. "summary": A 1-2 sentence analysis of the issue
2. "suggestions": An array of 1-3 suggested solution approaches, each with:
   - "approach": The solution approach name
   - "steps": Array of action steps
   - "estimatedTime": Estimated resolution time
   - "confidence": 0-100 how likely this is the right solution
3. "rootCauseHint": The most likely root cause

Return ONLY valid JSON, no other text.`;
const MAX_DESCRIPTION_CHARS = 6000;

function buildPrompt(title: string, description: string): string {
  const desc = (description || "No description provided").slice(0, MAX_DESCRIPTION_CHARS);
  return `${PROMPT_PREFIX}Title: ${title}\nDescription: ${desc}${PROMPT_SUFFIX}`;
}

/** Models answer with fenced code more often than the documentation suggests. */
export function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\n?|```/g, "").trim();
}

function parseSuggestions(content: string): { suggestions: SuggestionResult[]; summary: string } {
  const cleaned = stripCodeFences(content);
  try {
    const parsed = JSON.parse(cleaned) as { summary?: string; suggestions?: Array<{ approach: string; steps: string[]; estimatedTime: string; confidence: number }> };
    return {
      summary: parsed.summary || "",
      suggestions: (parsed.suggestions || []).map(s => ({
        ticketId: "", ticketNumber: "", title: s.approach, relevanceScore: s.confidence / 100,
        resolution: s.steps?.join("\n") || "", matchReason: `AI confidence: ${s.confidence}% — estimated ${s.estimatedTime}`, resolvedAt: null,
      })),
    };
  } catch {
    // Not JSON: the raw words are still worth showing as a summary rather than discarding the call.
    return { suggestions: [], summary: cleaned.slice(0, 500) };
  }
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: 1 token ≈ 0.75 words
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

/**
 * A plain JSON completion against the configured model, for callers that need their own prompt
 * rather than a solution suggestion (PLAN-015 Phase B #11 drafts KB articles this way).
 *
 * It returns `null` instead of throwing when there is no provider, the endpoint is blocked, or the
 * model answers with something that is not JSON: a caller that wants a draft must be able to tell
 * "the model said nothing usable" from "the model said something wrong", and neither is a crash.
 */
export async function llmJsonCompletion<T = Record<string, unknown>>(
  prompt: string,
  options: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<{ data: T; tokensUsed: number } | null> {
  const provider = await activeProviderRecord();
  if (!provider || provider.provider === "local") return null;

  const model = options.model || configText("knowledge", "draftModel") || process.env.INFERENCE_MODEL || provider.model;
  const result = await chatWithProvider(
    { ...providerRecordOf(provider), model },
    {
      messages: [{ role: "user", content: prompt }],
      json: true,
      maxTokens: options.maxTokens ?? provider.maxTokens,
      temperature: options.temperature ?? provider.temperature,
    },
  );
  if (!result.ok || !result.data) {
    console.error(`[LLM] JSON completion failed: ${result.detail}`);
    return null;
  }

  const content = stripCodeFences(result.data.text);
  if (!content) return null;
  try {
    return { data: JSON.parse(content) as T, tokensUsed: result.data.tokensUsed };
  } catch {
    console.error("[LLM] JSON completion returned something that is not JSON");
    return null;
  }
}
