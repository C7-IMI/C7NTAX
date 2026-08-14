import { prisma } from "../../index";
import type { SuggestionResult } from "./types";

/**
 * LLM-based inference provider.
 * Sends ticket data to configured AI provider (OpenAI, Anthropic, Azure, custom).
 * Falls back to local keyword search when no LLM provider is active.
 */
export async function llmSuggestSolutions(
  ticketId: string,
  title: string,
  description: string,
  providerId?: string
): Promise<{ suggestions: SuggestionResult[]; summary: string; tokensUsed: number }> {
  // Find the active provider
  const provider = providerId
    ? await prisma.aiProviderConfig.findUnique({ where: { id: providerId } })
    : await prisma.aiProviderConfig.findFirst({ where: { isActive: true, isDefault: true } });

  if (!provider || provider.provider === "local") {
    // Local mode: return empty — suggestions come from SearchEngine
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }

  try {
    const prompt = buildPrompt(title, description);
    const result = await callProvider(provider, prompt);
    return { ...result, tokensUsed: result.tokensUsed || 0 };
  } catch (err) {
    console.error(`[LLM] Provider ${provider.provider} failed:`, err);
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }
}

// TOKEN-SAVE-08: memoized static prompt prefix (no rebuild per call) +
// excerpt cap for long ticket descriptions + env override for cheap models
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

async function callProvider(
  provider: { provider: string; apiEndpoint: string | null; apiKey: string | null; model: string; maxTokens: number; temperature: number; topP: number },
  prompt: string
): Promise<{ suggestions: SuggestionResult[]; summary: string; tokensUsed: number }> {
  const endpoint = provider.apiEndpoint || getDefaultEndpoint(provider.provider);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (provider.provider === "openai" || provider.provider === "custom") {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  } else if (provider.provider === "anthropic") {
    headers["x-api-key"] = provider.apiKey!;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider.provider === "azure_openai") {
    headers["api-key"] = provider.apiKey!;
  }

  // TOKEN-SAVE-08: INFERENCE_MODEL env override routes AI calls to a cheaper model
  const effectiveProvider = { ...provider, model: process.env.INFERENCE_MODEL || provider.model };
  const body = buildRequestBody(effectiveProvider, prompt);
  const start = Date.now();
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json()) as Record<string, unknown>;
  const latencyMs = Date.now() - start;

  if (!res.ok) {
    console.error(`[LLM] HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }

  // Parse response based on provider format
  const parsed = parseResponse(provider.provider, json);
  return { ...parsed, tokensUsed: estimateTokens(provider.provider, json) };
}

function getDefaultEndpoint(provider: string): string {
  switch (provider) {
    case "openai": return "https://api.openai.com/v1/chat/completions";
    case "anthropic": return "https://api.anthropic.com/v1/messages";
    case "azure_openai": return ""; // must be configured
    default: return "";
  }
}

function buildRequestBody(provider: { provider: string; model: string; maxTokens: number; temperature: number; topP: number }, prompt: string): unknown {
  if (provider.provider === "anthropic") {
    return { model: provider.model, max_tokens: provider.maxTokens, temperature: provider.temperature, messages: [{ role: "user", content: prompt }] };
  }
  // OpenAI / Azure / custom format
  return { model: provider.model, max_tokens: provider.maxTokens, temperature: provider.temperature, top_p: provider.topP, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } };
}

function parseResponse(provider: string, json: Record<string, unknown>): { suggestions: SuggestionResult[]; summary: string } {
  try {
    let content = "";
    if (provider === "anthropic") {
      content = ((json as { content?: Array<{ text: string }> }).content?.[0]?.text) || "";
    } else {
      content = ((json as { choices?: Array<{ message: { content: string } }> }).choices?.[0]?.message?.content) || "";
    }
    // Strip markdown code fences
    content = content.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(content) as { summary?: string; suggestions?: Array<{ approach: string; steps: string[]; estimatedTime: string; confidence: number }> };
    return {
      summary: parsed.summary || "",
      suggestions: (parsed.suggestions || []).map(s => ({
        ticketId: "", ticketNumber: "", title: s.approach, relevanceScore: s.confidence / 100, resolution: s.steps?.join("\n") || "", matchReason: `AI confidence: ${s.confidence}% — estimated ${s.estimatedTime}`, resolvedAt: null,
      })),
    };
  } catch {
    return { suggestions: [], summary: String((json as { choices?: Array<{ message: { content: string } }> }).choices?.[0]?.message?.content || "").slice(0, 500) };
  }
}

function estimateTokens(_provider: string, json: Record<string, unknown>): number {
  const usage = json.usage as { total_tokens?: number } | undefined;
  if (usage?.total_tokens) return usage.total_tokens;
  // Rough estimate: 1 token ≈ 0.75 words
  const text = ((json as { choices?: Array<{ message: { content: string } }> }).choices?.[0]?.message?.content) || "";
  return Math.ceil(text.split(/\s+/).length / 0.75);
}
