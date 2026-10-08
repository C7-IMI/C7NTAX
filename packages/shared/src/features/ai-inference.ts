import { z } from "zod";

// ─── Providers a model can be connected through ─────────────────────
/**
 * The model providers this application can be pointed at, by the id stored in
 * `AiProviderConfig.provider`.
 *
 * The list lives here rather than in the API because three places have to agree on it and none of
 * them can see the others: the API builds requests from it, CloudConnect renders its connect dialog
 * from it, and the web app's provider pickers list it. A provider that exists in one and not the
 * others is a connection that can be saved and then never called.
 */
export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "deepseek",
  "xai",
  "google",
  "mistral",
  "openrouter",
  "groq",
  "azure_openai",
  "ollama",
  "custom",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

// ─── AI Provider Config ─────────────────────────────────────────────

export const aiProviderConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  provider: z.enum(["local", ...AI_PROVIDER_IDS]),
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

// ─── Provider catalogue ─────────────────────────────────────────────
/**
 * How a provider wants its key presented. Three of these are the same idea with a different header
 * name, which is exactly the sort of detail that gets copy-pasted wrong.
 */
export type AiAuthStyle = "bearer" | "x-api-key" | "api-key" | "x-goog-api-key" | "none";

/** The dialect a provider speaks: the shape of the request body and of the reply. */
export type AiRequestShape = "openai" | "anthropic" | "google";

export interface AiCredentialField {
  key: string;
  label: string;
  type?: "text" | "password" | "url" | "select";
  options?: string[];
  placeholder?: string;
  hint: string;
  /** Omitted means required. */
  optional?: boolean;
}

export interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  vendor: string;
  summary: string;
  shape: AiRequestShape;
  auth: AiAuthStyle;
  /** Base address, without the chat path. Empty when the operator has to supply the address. */
  baseUrl: string;
  /**
   * Appended to `baseUrl` for a chat completion. May contain `{model}`, `{deployment}` and
   * `{apiVersion}`, which the request builder fills from the model and the credentials.
   */
  chatPath: string;
  /** Appended to `baseUrl` to list the vendor's models. Empty when there is nothing to list. */
  modelsPath: string;
  /** The address cannot be guessed, so the dialog asks for it. */
  addressRequired?: boolean;
  credentials: AiCredentialField[];
  /** Used when the vendor cannot be asked for its list, or before it has been asked. */
  shortlist: string[];
  defaultModel: string;
  keyUrl: string;
  docs: { url: string; label: string };
  guidance: { tone?: "info" | "warn"; text: string };
  /** Whether the vendor's chat endpoint takes tool definitions at all. */
  toolCalling: boolean | "model-dependent";
}

/** The key field every provider needs, so its wording is decided once. */
function keyField(hint: string, optional = false): AiCredentialField {
  return { key: "apiKey", label: "API key", type: "password", hint, optional, placeholder: optional ? "not needed for a local model server" : "paste the key" };
}

/**
 * The catalogue.
 *
 * Every entry is written against the vendor's own API reference (linked in `docs`), because the
 * differences that matter are the ones nobody remembers: which header the key travels in, whether
 * the address is a base or a whole endpoint, whether an API version is part of the URL, and whether
 * the vendor will tell you which models the key can see.
 *
 * Addresses, paths, headers and model names were checked against those references on 2026-10-08. Model
 * names age faster than anything else here: they are a starting point for the picker, and the vendor's
 * own model list — which the picker asks for — is the authority.
 */
export const AI_PROVIDER_SPECS: AiProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI (GPT)",
    vendor: "OpenAI",
    summary: "GPT chat models through the OpenAI platform API.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://api.openai.com/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("platform.openai.com → API keys → Create new secret key. It is shown once. A key is scoped to a project, so the project's usage limits apply to everything C7NTAX does with it."),
      { key: "organization", label: "Organisation ID", placeholder: "org-…", hint: "Only needed when the key belongs to more than one organisation: it is sent as OpenAI-Organization. Leave it empty for a personal or single-organisation key.", optional: true },
    ],
    shortlist: ["gpt-6-luna", "gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-terra", "gpt-4o-mini"],
    defaultModel: "gpt-6-luna",
    keyUrl: "https://platform.openai.com/api-keys",
    docs: { url: "https://developers.openai.com/api/reference/resources/chat", label: "OpenAI chat completions reference" },
    guidance: { text: "The key is stored on this server and attached to every call from it — it is never sent to a browser. Prompts leave your network for OpenAI's API, so anything you ask the assistant to read is sent to them. C7NTAX calls /v1/chat/completions, the endpoint every OpenAI-compatible vendor copies; OpenAI now recommends its newer /v1/responses interface, which this build does not use." },
    toolCalling: true,
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    vendor: "Anthropic",
    summary: "Claude models through the Anthropic Messages API.",
    shape: "anthropic",
    auth: "x-api-key",
    baseUrl: "https://api.anthropic.com/v1",
    chatPath: "/messages",
    modelsPath: "/models",
    credentials: [
      keyField("console.anthropic.com → API keys. Claude keys start with sk-ant- and are shown once. The required anthropic-version header is added by C7NTAX; you do not have to send it."),
    ],
    shortlist: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    defaultModel: "claude-sonnet-5-5",
    keyUrl: "https://platform.claude.com/settings/keys",
    docs: { url: "https://platform.claude.com/docs/en/api/messages", label: "Anthropic Messages API reference" },
    guidance: { text: "Claude does not use the OpenAI request shape: the version is a required header, replies arrive as content blocks rather than choices, and a tool call is a block inside the reply rather than a field beside it. C7NTAX speaks both dialects, so the model is chosen here and nothing else has to change. Its key is sent as x-api-key, which Anthropic still supports alongside the newer Authorization header; a key that belongs to several workspaces also wants a workspace id, which this build does not send." },
    toolCalling: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    vendor: "DeepSeek",
    summary: "DeepSeek chat and reasoner models, OpenAI-compatible.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://api.deepseek.com",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("platform.deepseek.com → API keys. Top-ups are separate from the key: a valid key with no balance answers with an insufficient-balance error rather than a 401."),
    ],
    shortlist: ["deepseek-v4-pro", "deepseek-flash"],
    defaultModel: "deepseek-v4-pro",
    keyUrl: "https://platform.deepseek.com/api_keys",
    docs: { url: "https://api-docs.deepseek.com/api/create-chat-completion", label: "DeepSeek API reference" },
    guidance: { tone: "warn", text: "DeepSeek's base address is api.deepseek.com, and their own examples post to /chat/completions with no /v1 in front — the /v1 form is accepted as well, so it is left off here. Their API is OpenAI-shaped, which is why nothing else changes. DeepSeek also publishes an Anthropic-compatible endpoint under /anthropic; C7NTAX does not use it, because the OpenAI-shaped one is the one with tool calling." },
    toolCalling: true,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    vendor: "xAI",
    summary: "Grok models through the xAI API.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://api.x.ai/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("console.x.ai → API keys. Keys start with xai- and are scoped to a team, so the team's rate limits are what C7NTAX will hit."),
    ],
    shortlist: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-build-0.1"],
    defaultModel: "grok-4.7",
    keyUrl: "https://console.x.ai",
    docs: { url: "https://docs.x.ai/docs/api-reference", label: "xAI API reference" },
    guidance: { text: "xAI's API is OpenAI-shaped, including tool calling. The key is a bearer token and there is no per-model endpoint: the model name in the body decides. The newer Grok models reason before answering, which is why a short question can take noticeably longer than its length suggests." },
    toolCalling: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    vendor: "Google",
    summary: "Gemini models through the Google AI (Generative Language) API.",
    shape: "google",
    auth: "x-goog-api-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    chatPath: "/models/{model}:generateContent",
    modelsPath: "/models",
    credentials: [
      keyField("aistudio.google.com → Get API key. The key travels in the x-goog-api-key header rather than an Authorization header, and the model name is part of the URL path rather than the body."),
    ],
    shortlist: ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    defaultModel: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    docs: { url: "https://ai.google.dev/api/generate-content", label: "Gemini generateContent reference" },
    guidance: { tone: "warn", text: "Gemini takes the model in the address (/models/<model>:generateContent), a key header instead of a bearer token, and turns as `contents` with `parts`. Google is replacing standard API keys with authorization keys, so an older unrestricted key can be refused outright — the error names the key rather than the model. Google also now recommends its newer Interactions API; C7NTAX uses generateContent, which remains supported." },
    toolCalling: true,
  },
  {
    id: "mistral",
    label: "Mistral AI",
    vendor: "Mistral AI",
    summary: "Mistral and Codestral models through the Mistral API.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://api.mistral.ai/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("console.mistral.ai → API keys. Mistral bills per token against the plan on the workspace, so the workspace this key belongs to decides what it can call."),
    ],
    shortlist: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "ministral-3b-latest", "codestral-latest"],
    defaultModel: "mistral-large-latest",
    keyUrl: "https://console.mistral.ai",
    docs: { url: "https://docs.mistral.ai/api", label: "Mistral API reference" },
    guidance: { text: "Mistral's API is OpenAI-shaped, with `-latest` model aliases that follow the vendor's own releases — which is convenient, and means the model behind a name can change under you. Its model list arrives as a bare array rather than wrapped in `data`; C7NTAX reads either." },
    toolCalling: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    vendor: "OpenRouter",
    summary: "One key for many vendors' models, routed through OpenRouter.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://openrouter.ai/api/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("openrouter.ai → Keys. The key is a single credential for every vendor OpenRouter routes to, which is the point of it — and the reason its model names are namespaced (anthropic/claude-sonnet-4.5)."),
      { key: "siteUrl", label: "Site URL", type: "url", placeholder: "https://c7ntax.example", hint: "Sent as HTTP-Referer for attribution on OpenRouter's dashboard. Optional: OpenRouter only uses it for reporting.", optional: true },
      { key: "appName", label: "App name", placeholder: "C7NTAX", hint: "Sent as X-Title, for the same dashboard attribution. Optional.", optional: true },
    ],
    shortlist: ["openai/gpt-6-luna", "anthropic/claude-sonnet-5-5", "google/gemini-3.8-flash", "deepseek/deepseek-v4-pro"],
    defaultModel: "openai/gpt-6-luna",
    keyUrl: "https://openrouter.ai/keys",
    docs: { url: "https://openrouter.ai/docs/api-reference/overview", label: "OpenRouter API reference" },
    guidance: { tone: "warn", text: "OpenRouter is an aggregator: one key, many vendors, and model slugs that name the vendor first. Requests are OpenAI-shaped and are routed to whichever provider is currently serving that slug, so the same prompt can land on different hardware on different days, and a slug can be withdrawn by the vendor behind it without notice. OpenRouter's own model list — which the picker reads — is the authority on which slugs exist today." },
    toolCalling: true,
  },
  {
    id: "groq",
    label: "Groq",
    vendor: "Groq",
    summary: "Fast inference for open-weight models through Groq Cloud.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "https://api.groq.com/openai/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    credentials: [
      keyField("console.groq.com → API keys. Groq serves open-weight models (Llama, Qwen, Kimi) rather than a vendor's own frontier models."),
    ],
    shortlist: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b"],
    defaultModel: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
    docs: { url: "https://console.groq.com/docs/api-reference", label: "Groq API reference" },
    guidance: { text: "Groq's OpenAI-compatible endpoint lives under /openai/v1, so leaving that suffix off the address is the usual mistake. It is not a complete copy of the OpenAI API: logprobs, logit_bias and a per-message name are rejected with a 400, `n` must be 1, and a temperature of exactly 0 is nudged just above it. Which open-weight models support tool calling varies by model, so check the one you pick rather than assuming." },
    toolCalling: "model-dependent",
  },
  {
    id: "azure_openai",
    label: "Azure OpenAI",
    vendor: "Microsoft",
    summary: "Your own Azure OpenAI deployments, inside your tenant and region.",
    shape: "openai",
    auth: "api-key",
    baseUrl: "",
    chatPath: "/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}",
    modelsPath: "",
    addressRequired: true,
    credentials: [
      { key: "endpoint", label: "Resource endpoint", type: "url", placeholder: "https://contoso-openai.openai.azure.com", hint: "Azure portal → your Azure OpenAI resource → Keys and Endpoint. This is the resource endpoint, not the OpenAI one, and it carries your region: data stays in the region the resource was created in." },
      { key: "deployment", label: "Deployment name", placeholder: "gpt-4o-mini", hint: "The name you gave the deployment (Azure OpenAI Studio → Deployments), which is often but not always the model's own name." },
      { key: "apiKey", label: "API key", type: "password", hint: "Keys and Endpoint → KEY 1. It travels in an api-key header, not an Authorization header." },
      { key: "apiVersion", label: "API version", placeholder: "2024-10-21", hint: "The api-version query parameter: the deployment's *data plane* version, not the resource's API version. A version that is too new for the deployment fails with a 404 that names the deployment." },
    ],
    shortlist: [],
    defaultModel: "",
    keyUrl: "https://portal.azure.com",
    docs: { url: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference", label: "Azure OpenAI REST reference" },
    guidance: { tone: "warn", text: "Azure OpenAI is the same models behind a different address, and every part of the address matters: the resource, the deployment name and the api-version are all in the URL, and the key rides in an api-key header. It cannot be asked for a model list here, so the model is whatever the deployment was made from — set the model name to the deployment name so the record reads correctly. Azure also serves a newer v1 data plane at <endpoint>/openai/v1/chat/completions where the api-version is optional; if you prefer it, paste that whole address, and C7NTAX will use it exactly as given." },
    toolCalling: true,
  },
  {
    id: "ollama",
    label: "Ollama (local or self-hosted)",
    vendor: "Ollama",
    summary: "A model running on your own hardware, over Ollama's OpenAI-compatible API.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "http://localhost:11434/v1",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    addressRequired: true,
    credentials: [
      keyField("Ollama needs no key. If the server is behind a reverse proxy that wants one, put it here: it is sent as a bearer token and ignored by Ollama itself.", true),
      { key: "baseUrl", label: "Base URL", type: "url", placeholder: "http://localhost:11434/v1", hint: "Where the server is. localhost means the machine running this API — in a container that is the container, not your desk, so point it at a hostname that resolves from the server." },
    ],
    shortlist: ["gpt-oss:20b", "qwen3", "gemma4", "llama3.2"],
    defaultModel: "gpt-oss:20b",
    keyUrl: "https://ollama.com/settings/keys",
    docs: { url: "https://docs.ollama.com/api/openai-compatibility", label: "Ollama OpenAI compatibility" },
    guidance: { tone: "warn", text: "A local model keeps the prompts on your own hardware, which is the reason to choose it — and the reason it is smaller and slower than a hosted one. Ollama ignores the API key entirely, so the field is optional here; Ollama's own cloud at https://ollama.com/v1 does want one. C7NTAX refuses loopback and private addresses unless EGRESS_ALLOW_PRIVATE=true is set, which exists for exactly this: development. A hosted instance cannot reach a server on somebody's desk, so use a reachable address in production. Only some models support tool calling." },
    toolCalling: "model-dependent",
  },
  {
    id: "custom",
    label: "Any OpenAI-compatible endpoint",
    vendor: "Self-hosted or other",
    summary: "vLLM, LM Studio, a gateway, or any vendor that speaks the OpenAI API.",
    shape: "openai",
    auth: "bearer",
    baseUrl: "",
    chatPath: "/chat/completions",
    modelsPath: "/models",
    addressRequired: true,
    credentials: [
      { key: "baseUrl", label: "Base URL", type: "url", placeholder: "https://llm.internal.example/v1", hint: "The address up to and including the version prefix (usually /v1). C7NTAX appends /chat/completions to it — if you paste a whole endpoint here, the chat path gets added to it and the call will 404." },
      keyField("Whatever the endpoint expects. Leave it empty for a server that does not check.", true),
      { key: "authStyle", label: "Key header", type: "select", options: ["bearer", "api-key", "x-api-key"], hint: "How the key is presented: Authorization: Bearer (OpenAI and most gateways), api-key (Azure-style gateways), or x-api-key (Anthropic-style proxies).", optional: true },
      { key: "headers", label: "Extra headers", placeholder: "{\"X-Project\": \"c7ntax\"}", hint: "Any other header the endpoint requires, as JSON. Values are stored with the connection and sent on every call.", optional: true },
    ],
    shortlist: [],
    defaultModel: "",
    keyUrl: "",
    docs: { url: "https://developers.openai.com/api/reference/resources/chat", label: "The API shape it is expected to speak" },
    guidance: { tone: "warn", text: "This is the escape hatch: anything that implements the OpenAI chat API — vLLM on port 8000, LM Studio on 1234, a hosted service such as Together (api.together.ai, which moved from api.together.xyz) or Fireworks, or a gateway in front of several vendors. C7NTAX cannot know what it is talking to, so it will not guess a model list or an address: type the model name yourself, include the version prefix in the address, and use Test connection before anything depends on it. Tool calling only works if the endpoint implements it." },
    toolCalling: "model-dependent",
  },
];

/** The catalogue by id, for the request builder and the routes. */
export const AI_PROVIDER_INDEX: Record<string, AiProviderSpec> = Object.fromEntries(
  AI_PROVIDER_SPECS.map(spec => [spec.id, spec]),
);

/** The spec for a provider id, or undefined for anything this build does not know. */
export function aiProviderSpec(id: string): AiProviderSpec | undefined {
  return AI_PROVIDER_INDEX[id];
}

/**
 * The settings every provider has, whatever the vendor calls them. Served to the dialog so the
 * screen that connects a model and the code that calls it cannot drift apart.
 */
export const AI_RUNTIME_FIELDS = [
  { key: "model", label: "Model", type: "text" as const, hint: "The model name the vendor expects. Use the picker to ask the vendor what this key can see." },
  { key: "maxTokens", label: "Max tokens per reply", type: "number" as const, default: 2000, hint: "A ceiling on the answer's length. Long answers cost more and arrive more slowly." },
  { key: "temperature", label: "Temperature", type: "number" as const, default: 0.3, hint: "0 is the same answer every time; 1 is more varied. App work wants low." },
  { key: "topP", label: "Top P", type: "number" as const, default: 1, hint: "An alternative way to narrow the model's choices. Leave it at 1 unless you know why you are changing it." },
  { key: "appFunctions", label: "May perform app functions", type: "boolean" as const, default: false, hint: "Lets the model call this application's own functions when you ask it something (look up a client, find a ticket, read service alerts). Read functions run as you, so you can never see more through the model than you can see yourself; anything that would change data is proposed for approval instead of done." },
];
