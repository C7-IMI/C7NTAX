import { prisma } from "../../index";
import { EgressError, safeFetch } from "../egress";
import type { SuggestionResult } from "./types";
import { configText } from "../appSettings";

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
  // Every provider endpoint is validated and fetched through the egress policy: an admin
  // can point this at an internal address, and the stored API key travels with the call.
  // A blocked endpoint behaves like an unreachable one: log and let the keyword layer answer.
  let res: Response;
  try {
    res = await safeFetch(endpoint, { purpose: "inference", method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    const detail = e instanceof EgressError ? e.message : (e as Error).message;
    console.error(`[LLM] endpoint ${endpoint} blocked or unreachable: ${detail}`);
    return { suggestions: [], summary: "", tokensUsed: 0 };
  }
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

/**
 * A plain JSON completion against the configured provider, for callers that need their own prompt
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
  // Several providers can carry the default flag, so the most recently updated one wins: whoever
  // just configured a model expects it to be the one that answers.
  const provider = await prisma.aiProviderConfig.findFirst({ where: { isActive: true, isDefault: true }, orderBy: { updatedAt: "desc" } });
  if (!provider || provider.provider === "local") return null;

  const endpoint = provider.apiEndpoint || getDefaultEndpoint(provider.provider);
  if (!endpoint) return null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.provider === "openai" || provider.provider === "custom") headers["Authorization"] = `Bearer ${provider.apiKey}`;
  else if (provider.provider === "anthropic") { headers["x-api-key"] = provider.apiKey!; headers["anthropic-version"] = "2023-06-01"; }
  else if (provider.provider === "azure_openai") headers["api-key"] = provider.apiKey!;

  const model = options.model || configText("knowledge", "draftModel") || process.env.INFERENCE_MODEL || provider.model;
  const body = buildRequestBody(
    { provider: provider.provider, model, maxTokens: options.maxTokens ?? provider.maxTokens, temperature: options.temperature ?? provider.temperature, topP: provider.topP },
    prompt,
  );

  try {
    const res = await safeFetch(endpoint, { purpose: "inference", method: "POST", headers, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error(`[LLM] JSON completion HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
      return null;
    }
    let content = provider.provider === "anthropic"
      ? ((json as { content?: Array<{ text: string }> }).content?.[0]?.text) || ""
      : ((json as { choices?: Array<{ message: { content: string } }> }).choices?.[0]?.message?.content) || "";
    content = content.replace(/```json\n?|```/g, "").trim();
    if (!content) return null;
    const data = JSON.parse(content) as T;
    return { data, tokensUsed: estimateTokens(provider.provider, json) };
  } catch (e) {
    const detail = e instanceof EgressError ? e.message : (e as Error).message;
    console.error(`[LLM] JSON completion failed: ${detail}`);
    return null;
  }
}
