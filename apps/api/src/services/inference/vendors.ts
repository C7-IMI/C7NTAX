import { aiProviderSpec, type AiProviderSpec, type AiAuthStyle } from "@C7NTAX/shared";
import { EgressError, safeFetch } from "../egress";

/**
 * The vendor side of inference: addresses, authentication, request shapes and reply parsing for
 * every provider in the catalogue.
 *
 * It exists because the differences between vendors are not in this application's logic — they are
 * in a header name, a path, whether the model goes in the URL or the body, and how a tool call is
 * spelled. Keeping those in one catalogue-driven place means "support DeepSeek as well" is a line in
 * the catalogue and not a branch in four functions, and it means the same code serves both the
 * ticket suggestions and the assistant.
 */

// ── The provider record, as the engine sees it ─────────────────────────────────────────────

/**
 * The parts of `AiProviderConfig` the transport needs. `config` carries the provider-specific
 * credentials (deployment, api-version, organisation, extra headers) as entered in CloudConnect,
 * so a new provider never needs a schema change.
 */
export interface ProviderRecord {
  provider: string;
  apiKey: string | null;
  apiEndpoint: string | null;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  config?: unknown;
}

export interface ProviderConfig {
  credentials?: Record<string, string>;
  [key: string]: unknown;
}

export function providerConfigOf(record: Pick<ProviderRecord, "config">): ProviderConfig {
  const config = record.config;
  if (config && typeof config === "object") return config as ProviderConfig;
  return {};
}

export function credentialsOf(record: Pick<ProviderRecord, "config">): Record<string, string> {
  const credentials = providerConfigOf(record).credentials;
  if (credentials && typeof credentials === "object") return credentials as Record<string, string>;
  return {};
}

/** The spec for a record, or undefined for `local` and anything unrecognised. */
export function specFor(provider: string): AiProviderSpec | undefined {
  return aiProviderSpec(provider);
}

// ── Authentication ─────────────────────────────────────────────────────────

/** The auth header a style produces. `none` produces nothing — a local server takes no key. */
export function authHeader(style: AiAuthStyle, apiKey: string | null | undefined): Record<string, string> {
  const key = (apiKey ?? "").trim();
  if (!key || style === "none") return {};
  switch (style) {
    case "bearer": return { Authorization: `Bearer ${key}` };
    case "x-api-key": return { "x-api-key": key };
    case "api-key": return { "api-key": key };
    case "x-goog-api-key": return { "x-goog-api-key": key };
    default: return {};
  }
}

/**
 * Every header a call needs, from the catalogue plus whatever the connection holds.
 *
 * The connection can override the auth style, which is what the generic OpenAI-compatible entry is
 * for: gateways exist that are OpenAI-shaped but want `api-key` or `x-api-key`.
 */
export function requestHeaders(spec: AiProviderSpec, record: ProviderRecord): Record<string, string> {
  const credentials = credentialsOf(record);
  const style = (credentials.authStyle as AiAuthStyle) || spec.auth;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeader(style, record.apiKey) };

  // Anthropic's version is not optional and not the operator's business to remember.
  if (spec.shape === "anthropic") headers["anthropic-version"] = "2023-06-01";
  if (credentials.organization) headers["OpenAI-Organization"] = credentials.organization;
  // OpenRouter's attribution headers are optional and only used for its own dashboard.
  if (credentials.siteUrl) headers["HTTP-Referer"] = credentials.siteUrl;
  if (credentials.appName) headers["X-Title"] = credentials.appName;

  if (credentials.headers) {
    try {
      const extra = JSON.parse(credentials.headers) as Record<string, unknown>;
      for (const [name, value] of Object.entries(extra)) {
        if (typeof value === "string" || typeof value === "number") headers[name] = String(value);
      }
    } catch { /* unparseable extra headers are ignored rather than failing the call */ }
  }
  return headers;
}

// ── Addresses ──────────────────────────────────────────────────────────────

export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  if (!path) return trimmedBase;
  return `${trimmedBase}${path.startsWith("/") || path.startsWith("?") ? path : `/${path}`}`;
}

/**
 * Where a chat call goes.
 *
 * An operator may enter either the base address or the whole endpoint — both are reasonable, and
 * the second one is what people paste — so a base that already ends in the path is left alone
 * instead of having the path appended twice. Azure's address carries the deployment and the API
 * version, which is why the path can be a template.
 */
export function chatUrl(spec: AiProviderSpec, record: ProviderRecord): string | null {
  const credentials = credentialsOf(record);
  const base = resolveBase(spec, record, credentials);
  if (!base) return null;

  const literalSuffix = spec.chatPath.split("{")[0];
  if (literalSuffix && base.includes(literalSuffix.replace(/\/$/, ""))) return base;
  if (spec.chatPath.includes("?") && base.includes("?")) return base;

  const path = fillPath(spec.chatPath, record, credentials);
  return joinUrl(base, path);
}

/** The address a model list is read from, or null when the vendor cannot be asked. */
export function modelsUrl(spec: AiProviderSpec, record: ProviderRecord): string | null {
  if (!spec.modelsPath) return null;
  const base = resolveBase(spec, record, credentialsOf(record));
  if (!base) return null;
  return joinUrl(base, spec.modelsPath);
}

/**
 * The address the connection points at: what the operator entered, or the vendor's own default.
 *
 * `apiEndpoint` is the stored address; `credentials.baseUrl`/`credentials.endpoint` are what the
 * connect dialog asks for on the providers whose address cannot be guessed (Azure, a local server,
 * any self-hosted endpoint).
 */
export function resolveBase(spec: AiProviderSpec, record: ProviderRecord, credentials: Record<string, string>): string {
  const entered = (record.apiEndpoint || credentials.baseUrl || credentials.endpoint || "").trim();
  if (entered) return entered;
  return spec.baseUrl;
}

function fillPath(path: string, record: ProviderRecord, credentials: Record<string, string>): string {
  return path
    .replace("{model}", encodeURIComponent(record.model || credentials.model || ""))
    .replace("{deployment}", encodeURIComponent(credentials.deployment || record.model || ""))
    .replace("{apiVersion}", encodeURIComponent(credentials.apiVersion || ""));
}

// ── Messages and tools ─────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set on a tool result so the vendor can match it to the call it answers. */
  toolCallId?: string;
  /** Set on an assistant turn that asked for tools. */
  toolCalls?: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  tokensUsed: number;
  /** The vendor's own reason for stopping, kept for the trace. */
  finishReason: string | null;
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Ask for a JSON object as the reply. Not every provider honours it, and JSON mode with tools is not a thing. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

function safeJsonParse(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    // A model that answers with prose where an argument object was expected still gets the text.
    return { _raw: value };
  }
}

export function buildChatBody(spec: AiProviderSpec, record: ProviderRecord, options: ChatOptions): Record<string, unknown> {
  const maxTokens = options.maxTokens ?? record.maxTokens ?? 2000;
  const temperature = options.temperature ?? record.temperature ?? 0.3;
  const toolUse = (options.tools?.length ?? 0) > 0;

  if (spec.shape === "anthropic") {
    const system = options.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const turns = options.messages.filter(m => m.role !== "system").map(message => {
      if (message.role === "tool") {
        return {
          role: "user" as const,
          content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.toolCalls.map(call => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments })),
          ],
        };
      }
      return { role: message.role as "user" | "assistant", content: [{ type: "text", text: message.content }] };
    });
    return {
      model: record.model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: turns,
      ...(toolUse ? { tools: options.tools!.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
    };
  }

  if (spec.shape === "google") {
    const system = options.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const contents = options.messages.filter(m => m.role !== "system").map(message => {
      if (message.role === "tool") {
        return {
          role: "user" as const,
          parts: [{ functionResponse: { name: message.toolCallId ?? "function", response: safeJsonParse(message.content) } }],
        };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "model" as const,
          parts: [
            ...(message.content ? [{ text: message.content }] : []),
            ...message.toolCalls.map(call => ({ functionCall: { name: call.name, args: call.arguments } })),
          ],
        };
      }
      return { role: message.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: message.content }] };
    });
    return {
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        topP: record.topP,
        ...(options.json && !toolUse ? { responseMimeType: "application/json" } : {}),
      },
      ...(toolUse ? { tools: [{ functionDeclarations: options.tools!.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : {}),
    };
  }

  // OpenAI and everything that copies it.
  const messages = options.messages.map(message => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });

  return {
    model: record.model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: record.topP,
    // Tool use and JSON mode are mutually exclusive on most of these endpoints: JSON mode constrains
    // the whole reply to an object, which leaves no room for a tool call.
    ...(toolUse
      ? { tools: options.tools!.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" }
      : options.json ? { response_format: { type: "json_object" } } : {}),
  };
}

// ── Replies ────────────────────────────────────────────────────────────────

export function parseChatReply(spec: AiProviderSpec, json: Record<string, unknown>): ChatResult {
  if (spec.shape === "anthropic") {
    const content = (json.content as Array<Record<string, unknown>> | undefined) ?? [];
    const text = content.filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
    const toolCalls: ToolCall[] = content
      .filter(block => block.type === "tool_use")
      .map(block => ({
        id: String(block.id ?? ""),
        name: String(block.name ?? ""),
        arguments: (block.input as Record<string, unknown>) ?? {},
      }));
    const usage = (json.usage as { input_tokens?: number; output_tokens?: number } | undefined) ?? {};
    return { text, toolCalls, tokensUsed: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0), finishReason: (json.stop_reason as string) ?? null };
  }

  if (spec.shape === "google") {
    const candidates = (json.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    const parts = ((candidates[0]?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts) ?? [];
    const text = parts.filter(part => typeof part.text === "string").map(part => String(part.text)).join("");
    const toolCalls: ToolCall[] = parts
      .filter(part => part.functionCall)
      .map((part, index) => {
        const call = part.functionCall as { name?: string; args?: Record<string, unknown> };
        // Gemini does not return ids for function calls, so one is made up: the loop only needs
        // something stable to pair the result with.
        return { id: `call_${index}_${call.name ?? "function"}`, name: String(call.name ?? ""), arguments: call.args ?? {} };
      });
    const usage = (json.usageMetadata as { totalTokenCount?: number } | undefined) ?? {};
    return { text, toolCalls, tokensUsed: usage.totalTokenCount ?? 0, finishReason: (candidates[0]?.finishReason as string) ?? null };
  }

  const choice = ((json.choices as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {};
  const message = (choice.message as Record<string, unknown> | undefined) ?? {};
  const toolCalls: ToolCall[] = ((message.tool_calls as Array<Record<string, unknown>> | undefined) ?? []).map((call, index) => {
    const fn = (call.function as { name?: string; arguments?: unknown } | undefined) ?? {};
    return { id: String(call.id ?? `call_${index}`), name: String(fn.name ?? ""), arguments: safeJsonParse(fn.arguments) };
  });
  const usage = (json.usage as { total_tokens?: number } | undefined) ?? {};
  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls,
    tokensUsed: usage.total_tokens ?? 0,
    finishReason: (choice.finish_reason as string) ?? null,
  };
}

/** The vendor's own words about what went wrong, which is the only useful part of a 401. */
export function errorDetail(status: number, json: unknown): string {
  const body = (json ?? {}) as Record<string, unknown>;
  const error = body.error as Record<string, unknown> | string | undefined;
  const message = typeof error === "string"
    ? error
    : (error?.message as string | undefined) ?? (body.message as string | undefined) ?? (body.detail as string | undefined);
  return `${status}${message ? ` — ${message}` : ""}`;
}

// ── Calls ──────────────────────────────────────────────────────────────────

export interface CallOutcome<T> {
  ok: boolean;
  data: T | null;
  detail: string | null;
  latencyMs: number;
  status?: number;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown }> {
  const response = await safeFetch(url, { purpose: "inference", method: "POST", headers, body: JSON.stringify(body), timeoutMs });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/** One round of a conversation: the model either answers or asks for tools. */
export async function chatWithProvider(record: ProviderRecord, options: ChatOptions): Promise<CallOutcome<ChatResult>> {
  const spec = specFor(record.provider);
  const started = Date.now();
  if (!spec) return { ok: false, data: null, detail: `Provider ${record.provider} is not in this build's catalogue`, latencyMs: 0 };

  const url = chatUrl(spec, record);
  if (!url) return { ok: false, data: null, detail: "The connection has no address", latencyMs: 0 };
  if (!record.model) return { ok: false, data: null, detail: "No model is set on this connection", latencyMs: 0 };

  try {
    const { status, json } = await postJson(url, requestHeaders(spec, record), buildChatBody(spec, record, options), options.timeoutMs ?? 60000);
    const latencyMs = Date.now() - started;
    if (status >= 400) {
      return { ok: false, data: null, detail: errorDetail(status, json), latencyMs, status };
    }
    return { ok: true, data: parseChatReply(spec, json as Record<string, unknown>), detail: null, latencyMs, status };
  } catch (e) {
    const detail = e instanceof EgressError ? `blocked by the egress policy: ${e.message}` : (e as Error).message;
    return { ok: false, data: null, detail, latencyMs: Date.now() - started };
  }
}

export interface ModelListResult {
  models: Array<{ id: string; label?: string }>;
  detail: string | null;
}

/** The vendor's list of models this key can see, in one shape. */
export async function listProviderModels(record: ProviderRecord, timeoutMs = 20000): Promise<CallOutcome<ModelListResult>> {
  const spec = specFor(record.provider);
  const started = Date.now();
  if (!spec) return { ok: false, data: null, detail: `Provider ${record.provider} is not in this build's catalogue`, latencyMs: 0 };

  const url = modelsUrl(spec, record);
  if (!url) return { ok: false, data: null, detail: "This provider cannot be asked for its model list", latencyMs: 0 };

  try {
    const headers = requestHeaders(spec, record);
    const response = await safeFetch(url, { purpose: "inference", method: "GET", headers, timeoutMs });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ok: false, data: null, detail: errorDetail(response.status, json), latencyMs, status: response.status };

    // Mistral answers with a bare array; OpenAI, Anthropic, Grok, Groq and OpenRouter wrap it in
    // `data`; Gemini uses `models`. Reading all three here is cheaper than a per-vendor branch.
    const raw = (Array.isArray(json) ? json : (json.data ?? json.models ?? [])) as Array<Record<string, unknown>>;
    const models = raw.map(entry => {
      const id = String(entry.id ?? entry.name ?? "").replace(/^models\//, "");
      const label = entry.display_name ?? entry.displayName ?? entry.name;
      return { id, ...(label && label !== id ? { label: String(label) } : {}) };
    }).filter(model => model.id);
    return { ok: true, data: { models, detail: null }, detail: null, latencyMs, status: response.status };
  } catch (e) {
    const detail = e instanceof EgressError ? `blocked by the egress policy: ${e.message}` : (e as Error).message;
    return { ok: false, data: null, detail, latencyMs: Date.now() - started };
  }
}

/**
 * Whether a connection works, in the vendor's own terms.
 *
 * Reading the model list proves the key is accepted, and is cheaper and more informative than a
 * completion: it fails with the vendor's message rather than an empty answer. Providers that cannot
 * be listed are tested with the smallest possible call instead.
 */
export async function testProvider(record: ProviderRecord): Promise<CallOutcome<ModelListResult>> {
  const spec = specFor(record.provider);
  const started = Date.now();
  if (!spec) return { ok: false, data: null, detail: `Provider ${record.provider} is not in this build's catalogue`, latencyMs: 0 };
  if (!record.apiKey && spec.auth !== "none" && !spec.credentials.find(field => field.key === "apiKey")?.optional) {
    return { ok: false, data: null, detail: "No API key is stored on this connection", latencyMs: 0 };
  }
  if (!resolveBase(spec, record, credentialsOf(record)).trim()) {
    return { ok: false, data: null, detail: "This provider needs an address before it can be called", latencyMs: 0 };
  }

  if (spec.modelsPath) {
    const listed = await listProviderModels(record);
    if (listed.ok) {
      const models = listed.data?.models ?? [];
      return { ok: true, data: listed.data, detail: models.length ? `${models.length} model${models.length === 1 ? "" : "s"} visible to this key` : "The key was accepted, but the vendor listed no models", latencyMs: listed.latencyMs, status: listed.status };
    }
    // A vendor that answers 404 for its own model list is not a broken key: fall through to a call.
    if (listed.status !== 404 && listed.status !== 405) return { ok: false, data: null, detail: listed.detail, latencyMs: listed.latencyMs, status: listed.status };
  }

  const chat = await chatWithProvider(record, {
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    maxTokens: 16,
    temperature: 0,
    timeoutMs: 30000,
  });
  if (!chat.ok) return { ok: false, data: null, detail: chat.detail, latencyMs: Date.now() - started, status: chat.status };
  return { ok: true, data: { models: [], detail: null }, detail: `Answered in ${chat.latencyMs}ms`, latencyMs: Date.now() - started };
}
