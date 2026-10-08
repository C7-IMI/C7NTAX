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
  /** What it takes to get running with this provider: where the key comes from, and what to do next. */
  setup: AiProviderSetup;
}

export interface AiProviderSetup {
  /** Why somebody would choose this provider, including what it does with your prompts. */
  overview: string;
  /** The order to do things in, each with a link to the vendor's own page. */
  steps: Array<{ title: string; detail: string; link?: string }>;
  /** What to do the moment it is saved — usually "ask the vendor what models this key can see". */
  afterSaving: string;
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
    setup: {
      overview: "The reference implementation of this whole API: almost every other vendor on this list copies OpenAI's request shape, so it is the one that gets tested first when something is wrong. Prompts go to OpenAI, in the United States, under their terms.",
      steps: [
        { title: "Create a key", detail: "platform.openai.com → API keys → Create new secret key. It is shown once. Keys belong to a project, and the project's limits and billing are what C7NTAX will use.", link: "https://platform.openai.com/api-keys" },
        { title: "Check the project's limits", detail: "A key from a project with no spend limit configured can fail on a busy day with a quota error that looks like a broken key.", link: "https://platform.openai.com/settings/organization/limits" },
        { title: "Paste it here, then choose a model", detail: "The suggested names are a starting point; the model list the vendor returns is what this key can actually call." },
      ],
      afterSaving: "Press the model list button on the connection: it asks OpenAI what this key can see, which settles both the key and the model name in one call.",
    },
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
      keyField("platform.claude.com → Settings → API keys. Claude keys start with sk-ant- and are shown once. The required anthropic-version header is added by C7NTAX; you do not have to send it."),
    ],
    shortlist: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    defaultModel: "claude-sonnet-5-5",
    keyUrl: "https://platform.claude.com/settings/keys",
    setup: {
      overview: "Claude reads long documents well and is unusually good at following a format, which suits drafting a note or summarising a long ticket thread. Its API is not the OpenAI shape, but nothing about that shows here: C7NTAX speaks both.",
      steps: [
        { title: "Create a key", detail: "platform.claude.com → Settings → API keys. Keys start with sk-ant- and are shown once.", link: "https://platform.claude.com/settings/keys" },
        { title: "Check the workspace", detail: "Anthropic bills a workspace, and a key belongs to one. If your organisation has several, spend limits and rate limits are per workspace.", link: "https://platform.claude.com/settings/workspaces" },
        { title: "Paste it here, then choose a model", detail: "Sonnet is the balanced choice for app work; Haiku is the cheap one for high-volume functions." },
      ],
      afterSaving: "Press the model list button: Anthropic will list the models this key may call, which is also the quickest way to see whether a key is workspace-scoped in a way you did not expect.",
    },
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
    setup: {
      overview: "The cheapest way to put a capable model behind routine work, with an OpenAI-shaped API. DeepSeek's servers are in China, so the prompts — including whatever an app function returns — leave your region; that is a decision worth making deliberately rather than by default.",
      steps: [
        { title: "Create a key", detail: "platform.deepseek.com → API keys. The key is separate from the balance: a valid key with no credit answers with an insufficient-balance error, which is reported as such here.", link: "https://platform.deepseek.com/api_keys" },
        { title: "Top the balance up", detail: "DeepSeek is prepaid. A new account with no top-up tests as a working key and a failing call.", link: "https://platform.deepseek.com/top_up" },
        { title: "Paste it here, then choose a model", detail: "The reasoning model thinks before answering, which is better for analysis and noticeably slower for lookups." },
      ],
      afterSaving: "Press the model list button, then ask the assistant something that needs a lookup: this is the cheapest provider to leave switched on for app functions.",
    },
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
    setup: {
      overview: "Grok models, with a very large context window and OpenAI-shaped tool calling. The newer models reason before answering, so a short question can take noticeably longer than its length suggests — which matters on a screen somebody is waiting on.",
      steps: [
        { title: "Create a key", detail: "console.x.ai → API keys. Keys are scoped to a team, and the team's rate limits are what C7NTAX will hit.", link: "https://console.x.ai" },
        { title: "Check the team's spend", detail: "xAI bills the team the key belongs to; a team with no payment method configured fails at call time rather than at save time.", link: "https://console.x.ai/team/default/billing" },
        { title: "Paste it here, then choose a model", detail: "A model with a reasoning step is the wrong choice for a function-calling loop and the right one for analysing a long ticket." },
      ],
      afterSaving: "Press the model list button, then time one question: if the model reasons, the answer is worth the wait and a lookup is not.",
    },
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
    setup: {
      overview: "Gemini's cheap tier is the best price-to-capability on this list for routine lookups, and its context window is enormous. Google is in the middle of replacing ordinary API keys with authorization keys, so an older key you already have may be refused outright.",
      steps: [
        { title: "Create a key", detail: "Google AI Studio → Get API key. If your account has already moved to authorization keys, this creates one of those instead, and the wizard sends it the same way.", link: "https://aistudio.google.com/apikey" },
        { title: "Check the key is unrestricted or bound to this use", detail: "A key restricted to particular APIs or referrers works from a server; one restricted to browser referrers does not, and the error names the key rather than the restriction.", link: "https://ai.google.dev/gemini-api/docs/api-key" },
        { title: "Paste it here, then choose a model", detail: "The Flash tier is what app functions want; Pro is for reading something long." },
      ],
      afterSaving: "Press the model list button: Gemini returns its whole catalogue with display names, which makes picking a model here easier than anywhere else on this list.",
    },
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
    setup: {
      overview: "A European provider with a serious cheap tier and a good record on data handling, which is often the reason to choose it. Its model names are `-latest` aliases, so the model behind a name follows the vendor's releases rather than staying put.",
      steps: [
        { title: "Create a key", detail: "console.mistral.ai → API keys. Keys belong to a workspace, and the plan on that workspace decides the rate limits.", link: "https://console.mistral.ai" },
        { title: "Check the workspace's plan", detail: "A workspace on the free tier has tight limits that look like failures under any real load.", link: "https://console.mistral.ai/billing" },
        { title: "Paste it here, then choose a model", detail: "The large model is the safe default for drafting; small and the Ministral tiers are for functions." },
      ],
      afterSaving: "Press the model list button, then note that its `-latest` names move: a model that behaves differently next month is the alias following the vendor, not a fault here.",
    },
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
    setup: {
      overview: "One key and one bill for most of the vendors on this list, which makes it the cheapest way to find out which model suits a job before signing up to five of them. Requests are routed to whichever provider is currently serving the slug you name.",
      steps: [
        { title: "Create a key", detail: "openrouter.ai → Keys. Add credit too: OpenRouter bills per request against your balance.", link: "https://openrouter.ai/keys" },
        { title: "Add credit", detail: "A key with no balance returns a payment error at call time, which is easy to mistake for an invalid key.", link: "https://openrouter.ai/settings/credits" },
        { title: "Decide whether to be identified", detail: "The site URL and app name are optional attribution headers used only on OpenRouter's own dashboard." },
      ],
      afterSaving: "Press the model list button before choosing a model: OpenRouter's slugs change as vendors publish and withdraw models, so its own list is the authority and the suggestions here are only a starting point.",
    },
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
    setup: {
      overview: "Groq serves open-weight models on its own hardware, and the reason to use it is speed: a function-calling loop that looks up five things is noticeably quicker here than anywhere else. It is not a complete copy of the OpenAI API.",
      steps: [
        { title: "Create a key", detail: "console.groq.com → API keys → Create API key. It is shown once, and it belongs to your organisation rather than to a person.", link: "https://console.groq.com/keys" },
        { title: "Check the model supports tools", detail: "Groq serves Llama, Qwen and the gpt-oss family, and tool calling is per model — the connection test tells you the key works, not that the model can call functions.", link: "https://console.groq.com/docs/tool-use" },
        { title: "Paste it here, then choose a model", detail: "Its endpoint lives under /openai/v1, which the catalogue already knows." },
      ],
      afterSaving: "Press the model list button, then ask the assistant something that needs two lookups: speed is the whole point of this provider, and it shows in that round trip.",
    },
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
    setup: {
      overview: "The same models behind a different address, inside your own tenant and region and under your own agreement. It is the only provider here that cannot be reached with a key alone: the resource, the deployment and an API version are all part of the call, which is why this wizard asks for three things instead of one.",
      steps: [
        { title: "Create the resource", detail: "Azure portal → Create a resource → Azure OpenAI. The resource carries the region, so the data stays where you put it.", link: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource" },
        { title: "Deploy a model", detail: "Azure OpenAI Studio → Deployments → Deploy model. The deployment name is what every call uses, and it is not always the model's own name.", link: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource" },
        { title: "Copy the endpoint and a key", detail: "Keys and Endpoint → the resource endpoint and KEY 1. The endpoint is the resource's own address, not api.openai.com.", link: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference" },
        { title: "Note an API version", detail: "The deployment's data-plane version, such as 2024-10-21. A version that is too new for the deployment fails with a 404 that names the deployment.", link: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference" },
      ],
      afterSaving: "Set the model name to the deployment name, then press Test connection: Azure cannot list its models the way the platform API does, so the test is the only confirmation available — and it is a complete one.",
    },
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
    setup: {
      overview: "The only option here that keeps the prompts on hardware you control, which is usually the reason to choose it — and the reason the answers are smaller and slower than a hosted model's. Everything it reads stays inside your network.",
      steps: [
        { title: "Install Ollama and pull a model", detail: "On the machine that will serve it: install Ollama, then `ollama pull <model>`. A model with tool support is needed for app functions.", link: "https://docs.ollama.com/" },
        { title: "Check the address from the server, not your desk", detail: "localhost means the machine running the C7NTAX API. In a container that is the container. Use a hostname that resolves from there.", link: "https://docs.ollama.com/api/openai-compatibility" },
        { title: "Know the development-only allowance", detail: "C7NTAX refuses loopback and private addresses unless EGRESS_ALLOW_PRIVATE=true is set, which exists for local development. A hosted instance cannot reach a server on somebody's desk." },
        { title: "Leave the key empty unless a proxy wants one", detail: "Ollama itself ignores the API key. Ollama's own cloud at ollama.com/v1 does want one, and that is the case this field is for.", link: "https://ollama.com/settings/keys" },
      ],
      afterSaving: "Press the model list button: Ollama will list what you have pulled, which is the only model list that matters for this provider.",
    },
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
    setup: {
      overview: "The escape hatch: anything that speaks the OpenAI chat API — vLLM, LM Studio, a hosted service such as Together or Fireworks, or a gateway in front of several vendors. C7NTAX cannot know what it is talking to, so it will not guess an address or a model name.",
      steps: [
        { title: "Get the base address, including the version", detail: "vLLM serves on port 8000 and LM Studio on 1234, both with /v1. Paste the address up to the version prefix — C7NTAX appends /chat/completions to it.", link: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html" },
        { title: "Decide which header carries the key", detail: "Authorization: Bearer is the usual choice; gateways in front of Azure-style deployments often want api-key instead. A server that checks nothing needs no key at all." },
        { title: "Name the model yourself", detail: "The model list is only as good as the endpoint's implementation of it, so type the model name the server actually serves." },
        { title: "Add any extra headers", detail: "A gateway that routes by project or tenant usually needs one. They are stored with the connection and sent on every call." },
      ],
      afterSaving: "Press Test connection before anything depends on it: for a self-hosted endpoint it is the only thing that can tell a wrong address from a wrong key, and it reports exactly which of the two the vendor said.",
    },
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

/** How much of a setup plan is enough to be worth showing; the probe holds plans to this. */
export const AI_SETUP_MINIMUMS = {
  overview: 100,
  steps: 3,
  stepTitle: 6,
  stepDetail: 60,
  afterSaving: 60,
} as const;

/**
 * The settings every provider has, whatever the vendor calls them. Served to the dialog so the
 * screen that connects a model and the code that calls it cannot drift apart.
 */export const AI_RUNTIME_FIELDS = [
  { key: "model", label: "Model", type: "text" as const, hint: "The model name the vendor expects. Use the picker to ask the vendor what this key can see." },
  { key: "maxTokens", label: "Max tokens per reply", type: "number" as const, default: 2000, hint: "A ceiling on the answer's length. Long answers cost more and arrive more slowly." },
  { key: "temperature", label: "Temperature", type: "number" as const, default: 0.3, hint: "0 is the same answer every time; 1 is more varied. App work wants low." },
  { key: "topP", label: "Top P", type: "number" as const, default: 1, hint: "An alternative way to narrow the model's choices. Leave it at 1 unless you know why you are changing it." },
  { key: "appFunctions", label: "May perform app functions", type: "boolean" as const, default: false, hint: "Lets the model call this application's own functions when you ask it something (look up a client, find a ticket, read service alerts). Read functions run as you, so you can never see more through the model than you can see yourself; anything that would change data is proposed for approval instead of done." },
];
