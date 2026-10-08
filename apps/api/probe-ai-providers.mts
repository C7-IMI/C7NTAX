/**
 * Model providers, against a stub of each vendor.
 *
 * Connecting a model is mostly a set of facts that are easy to get subtly wrong and impossible to
 * notice: which header the key travels in, whether the stored address is a base or a whole endpoint,
 * whether the API version is part of the URL, and how a tool call is spelled. Every assertion here
 * exists because the previous implementation hard-coded two of these vendors and the third one
 * silently posted to the wrong path.
 *
 * Nothing in this file touches a real vendor: `globalThis.fetch` is replaced, so the requests can be
 * read back and the replies can be shaped like each vendor's documentation says they are.
 *
 * Run from apps/api:  pnpm exec tsx probe-ai-providers.mts
 */
// The catalogue is imported by path rather than by package name: this probe runs as ESM, and the
// shared workspace package resolves to TypeScript source that an ESM named import cannot enumerate
// through its re-export chain. The API itself imports it as a package and works.
import { AI_PROVIDER_IDS, AI_PROVIDER_SPECS, AI_RUNTIME_FIELDS, aiProviderSpec } from "../../packages/shared/src/features/ai-inference";
import {
  authHeader,
  buildChatBody,
  chatUrl,
  chatWithProvider,
  credentialsOf,
  errorDetail,
  listProviderModels,
  modelsUrl,
  parseChatReply,
  requestHeaders,
  testProvider,
  type ProviderRecord,
} from "./src/services/inference/vendors";

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const eq = (actual: unknown, expected: unknown, label: string) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${label}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);

// ── The stub ────────────────────────────────────────────────────────────────────────────────
interface Call { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | null }
const calls: Call[] = [];
let responder: (call: Call) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input);
  const call: Call = {
    method: init.method ?? "GET",
    url,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: init.body ? JSON.parse(String(init.body)) : null,
  };
  calls.push(call);
  const { status, json } = responder(call);
  return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const reset = () => { calls.length = 0; };

const record = (provider: string, over: Partial<ProviderRecord> = {}): ProviderRecord => ({
  provider,
  apiKey: "test-key",
  apiEndpoint: null,
  model: aiProviderSpec(provider)?.defaultModel ?? "test-model",
  maxTokens: 256,
  temperature: 0.2,
  topP: 1,
  config: {},
  ...over,
});

const withCredentials = (provider: string, credentials: Record<string, string>, over: Partial<ProviderRecord> = {}) =>
  record(provider, { config: { credentials }, ...over });

// ── 1. The catalogue describes every provider ───────────────────────────────────────────────
console.log("\nThe catalogue describes every provider it offers");
check(AI_PROVIDER_SPECS.length === AI_PROVIDER_IDS.length, `${AI_PROVIDER_SPECS.length} specs for ${AI_PROVIDER_IDS.length} ids`);
check(AI_PROVIDER_IDS.every(id => !!aiProviderSpec(id)), "every id resolves to a spec");
check(aiProviderSpec("nope") === undefined, "an unknown id resolves to nothing");
check(new Set(AI_PROVIDER_IDS).size === AI_PROVIDER_IDS.length, "no duplicate ids");
check(AI_PROVIDER_IDS.includes("openai") && AI_PROVIDER_IDS.includes("anthropic") && AI_PROVIDER_IDS.includes("deepseek") && AI_PROVIDER_IDS.includes("xai") && AI_PROVIDER_IDS.includes("google"),
  "the providers the request named are all present (OpenAI, Claude, DeepSeek, Grok, Gemini)");

for (const spec of AI_PROVIDER_SPECS) {
  const ok = !!spec.label && !!spec.vendor && !!spec.summary && !!spec.guidance.text && !!spec.docs.url && spec.credentials.length > 0
    && (!!spec.baseUrl || !!spec.addressRequired) && (!!spec.defaultModel || !!spec.addressRequired)
    && (!!spec.keyUrl || !spec.baseUrl);
  check(ok, `${spec.id}: labelled, documented, credentials asked for, address either known or required`);
  check(spec.credentials.every(field => !!field.key && !!field.label && !!field.hint), `${spec.id}: every credential field is labelled and explained`);
  check(!spec.baseUrl || spec.auth !== "none", `${spec.id}: a hosted provider authenticates`);
  check(spec.auth !== "bearer" || spec.credentials.some(f => f.key === "apiKey"), `${spec.id}: a key field exists for the auth style`);
}
check(AI_RUNTIME_FIELDS.some(f => f.key === "appFunctions"), "the runtime fields include the app-functions permission");
check(AI_RUNTIME_FIELDS.every(f => !!f.hint), "every runtime field explains itself");

// ── 2. Keys travel the way the vendor documents ─────────────────────────────────────────────
console.log("\nKeys travel in the header the vendor documents");
eq(authHeader("bearer", "abc"), { Authorization: "Bearer abc" }, "bearer → Authorization: Bearer");
eq(authHeader("x-api-key", "abc"), { "x-api-key": "abc" }, "x-api-key → x-api-key");
eq(authHeader("api-key", "abc"), { "api-key": "abc" }, "api-key → api-key (Azure)");
eq(authHeader("x-goog-api-key", "abc"), { "x-goog-api-key": "abc" }, "x-goog-api-key → x-goog-api-key (Gemini)");
eq(authHeader("none", "abc"), {}, "none → no header");
eq(authHeader("bearer", ""), {}, "an empty key sends nothing");
eq(authHeader("bearer", "   "), {}, "a blank key sends nothing");

check(requestHeaders(aiProviderSpec("anthropic")!, record("anthropic"))["anthropic-version"] === "2023-06-01", "Anthropic always carries its version header");
check(requestHeaders(aiProviderSpec("openai")!, withCredentials("openai", { organization: "org-1" }))["OpenAI-Organization"] === "org-1", "OpenAI sends the organisation when one is set");
check(!requestHeaders(aiProviderSpec("openai")!, record("openai"))["OpenAI-Organization"], "and sends nothing when it is not");
check(requestHeaders(aiProviderSpec("openrouter")!, withCredentials("openrouter", { siteUrl: "https://x.test", appName: "C7NTAX" }))["HTTP-Referer"] === "https://x.test", "OpenRouter attribution headers are sent when set");
check(requestHeaders(aiProviderSpec("openrouter")!, withCredentials("openrouter", { siteUrl: "https://x.test", appName: "C7NTAX" }))["X-Title"] === "C7NTAX", "OpenRouter app name is sent too");
eq(requestHeaders(aiProviderSpec("custom")!, withCredentials("custom", { authStyle: "api-key" })), { "Content-Type": "application/json", "api-key": "test-key" }, "a generic endpoint can override how the key is presented");
check(requestHeaders(aiProviderSpec("custom")!, withCredentials("custom", { headers: "{\"X-Project\":\"c7\"}" }))["X-Project"] === "c7", "extra headers as JSON are sent");
check(requestHeaders(aiProviderSpec("custom")!, withCredentials("custom", { headers: "not json" }))["X-Project"] === undefined, "unparseable extra headers are ignored rather than fatal");
eq(Object.keys(requestHeaders(aiProviderSpec("ollama")!, record("ollama", { apiKey: null }))), ["Content-Type"], "a local server with no key sends no auth header at all");

// ── 3. Addresses are assembled the way the vendor documents ─────────────────────────────────
console.log("\nAddresses are assembled the way the vendor documents");
eq(chatUrl(aiProviderSpec("openai")!, record("openai")), "https://api.openai.com/v1/chat/completions", "OpenAI: base + /chat/completions");
eq(chatUrl(aiProviderSpec("anthropic")!, record("anthropic")), "https://api.anthropic.com/v1/messages", "Anthropic: /messages, not /chat/completions");
eq(chatUrl(aiProviderSpec("ollama")!, record("ollama")), "http://localhost:11434/v1/chat/completions", "Ollama: the OpenAI-compatible path under the local port");
eq(chatUrl(aiProviderSpec("groq")!, record("groq")), "https://api.groq.com/openai/v1/chat/completions", "Groq keeps its /openai/v1 prefix");
eq(chatUrl(aiProviderSpec("google")!, record("google", { model: "gemini-2.5-flash" })), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", "Gemini carries the model in the path");
eq(chatUrl(aiProviderSpec("azure_openai")!, withCredentials("azure_openai", { endpoint: "https://contoso.openai.azure.com", deployment: "gpt-4o-mini", apiVersion: "2024-10-21" })),
  "https://contoso.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21", "Azure: resource + deployment + api-version");
eq(chatUrl(aiProviderSpec("azure_openai")!, record("azure_openai")), null, "Azure with no address yields no URL at all, rather than a call to the wrong host");
eq(chatUrl(aiProviderSpec("custom")!, withCredentials("custom", { baseUrl: "https://llm.test/v1" })), "https://llm.test/v1/chat/completions", "a self-hosted endpoint gets the chat path appended");
eq(chatUrl(aiProviderSpec("openai")!, record("openai", { apiEndpoint: "https://api.openai.com/v1" })), "https://api.openai.com/v1/chat/completions", "a stored base address is not doubled");
eq(chatUrl(aiProviderSpec("openai")!, record("openai", { apiEndpoint: "https://api.openai.com/v1/chat/completions" })), "https://api.openai.com/v1/chat/completions", "a stored whole endpoint is left alone");
eq(chatUrl(aiProviderSpec("openai")!, record("openai", { apiEndpoint: "https://gateway.test/openai/v1/" })), "https://gateway.test/openai/v1/chat/completions", "a trailing slash does not double up");
eq(modelsUrl(aiProviderSpec("openai")!, record("openai")), "https://api.openai.com/v1/models", "the model list is read from /models");
eq(modelsUrl(aiProviderSpec("azure_openai")!, record("azure_openai")), null, "Azure cannot be asked for a model list");
check(chatUrl(aiProviderSpec("google")!, record("google", { model: "gemini/2.5 pro" }))!.includes("gemini%2F2.5%20pro"), "a model name is escaped into the path");

// ── 4. Request bodies per dialect ───────────────────────────────────────────────────────────
console.log("\nRequest bodies match the dialect the vendor speaks");
const tools = [{ name: "find_ticket", description: "Find a ticket", parameters: { type: "object", properties: { query: { type: "string" } } } }];

const openaiBody = buildChatBody(aiProviderSpec("openai")!, record("openai"), { messages: [{ role: "user", content: "hi" }], tools });
check(Array.isArray((openaiBody as any).tools) && (openaiBody as any).tools[0].function.name === "find_ticket", "OpenAI tools are wrapped in a function object");
check((openaiBody as any).tool_choice === "auto", "OpenAI is told it may choose a tool");
check(!(openaiBody as any).response_format, "JSON mode is not sent alongside tools");
check((buildChatBody(aiProviderSpec("openai")!, record("openai"), { messages: [{ role: "user", content: "hi" }], json: true }) as any).response_format.type === "json_object", "JSON mode is sent when asked for and there are no tools");
eq((buildChatBody(aiProviderSpec("openai")!, record("openai"), { messages: [{ role: "user", content: "hi" }] }) as any).messages, [{ role: "user", content: "hi" }], "plain messages pass through");

const openaiToolTurn = buildChatBody(aiProviderSpec("openai")!, record("openai"), {
  messages: [
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "find_ticket", arguments: { query: "vpn" } }] },
    { role: "tool", content: "{\"id\":\"t1\"}", toolCallId: "c1" },
  ],
});
check((openaiToolTurn as any).messages[0].tool_calls[0].function.arguments === "{\"query\":\"vpn\"}", "OpenAI tool-call arguments are serialised into the message");
check((openaiToolTurn as any).messages[1].tool_call_id === "c1", "OpenAI pairs the result with the call");

const anthropicBody = buildChatBody(aiProviderSpec("anthropic")!, record("anthropic"), {
  messages: [{ role: "system", content: "You are helpful" }, { role: "user", content: "hi" }],
  tools,
});
check((anthropicBody as any).system === "You are helpful", "Anthropic's system prompt is hoisted out of the messages");
eq((anthropicBody as any).messages, [{ role: "user", content: [{ type: "text", text: "hi" }] }], "Anthropic messages are content blocks");
check((anthropicBody as any).tools[0].input_schema.type === "object", "Anthropic tools use input_schema, not parameters");
check(!(anthropicBody as any).max_tokens === false, "Anthropic is sent max_tokens");

const anthropicToolTurn = buildChatBody(aiProviderSpec("anthropic")!, record("anthropic"), {
  messages: [
    { role: "assistant", content: "looking", toolCalls: [{ id: "c9", name: "find_ticket", arguments: { query: "vpn" } }] },
    { role: "tool", content: "{\"ok\":true}", toolCallId: "c9" },
  ],
});
check((anthropicToolTurn as any).messages[0].content[1].type === "tool_use", "Anthropic tool calls are tool_use blocks");
check((anthropicToolTurn as any).messages[1].content[0].type === "tool_result" && (anthropicToolTurn as any).messages[1].content[0].tool_use_id === "c9", "Anthropic tool results are tool_result blocks carrying the id");

const googleBody = buildChatBody(aiProviderSpec("google")!, record("google"), {
  messages: [{ role: "system", content: "Be brief" }, { role: "user", content: "hi" }],
  tools,
});
eq((googleBody as any).contents, [{ role: "user", parts: [{ text: "hi" }] }], "Gemini's turn is a content with parts");
check((googleBody as any).systemInstruction.parts[0].text === "Be brief", "Gemini's system prompt is a systemInstruction");
check((googleBody as any).tools[0].functionDeclarations[0].name === "find_ticket", "Gemini tools are functionDeclarations");
check((googleBody as any).generationConfig.maxOutputTokens === 256, "Gemini's limits live in generationConfig");
check(!(googleBody as any).generationConfig.responseMimeType, "Gemini is not asked for JSON when tools are in play");

const googleToolTurn = buildChatBody(aiProviderSpec("google")!, record("google"), {
  messages: [
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "find_ticket", arguments: { query: "vpn" } }] },
    { role: "tool", content: "{\"ok\":true}", toolCallId: "find_ticket" },
  ],
});
check((googleToolTurn as any).contents[0].parts[0].functionCall.name === "find_ticket", "Gemini tool calls are functionCall parts");
check((googleToolTurn as any).contents[0].role === "model", "Gemini calls the assistant turn model");
check((googleToolTurn as any).contents[1].parts[0].functionResponse.response.ok === true, "Gemini tool results are functionResponse parts with parsed JSON");

// ── 5. Replies are read back into one shape ─────────────────────────────────────────────────
console.log("\nReplies from every dialect become one shape");
const openaiReply = parseChatReply(aiProviderSpec("openai")!, {
  choices: [{ message: { content: "hello", tool_calls: [{ id: "c1", function: { name: "find_ticket", arguments: "{\"query\":\"vpn\"}" } }] }, finish_reason: "tool_calls" }],
  usage: { total_tokens: 42 },
});
eq(openaiReply.text, "hello", "OpenAI reply text");
eq(openaiReply.toolCalls, [{ id: "c1", name: "find_ticket", arguments: { query: "vpn" } }], "OpenAI tool call arguments are parsed");
eq(openaiReply.tokensUsed, 42, "OpenAI token count");

const anthropicReply = parseChatReply(aiProviderSpec("anthropic")!, {
  content: [{ type: "text", text: "hello " }, { type: "text", text: "there" }, { type: "tool_use", id: "t1", name: "find_ticket", input: { query: "vpn" } }],
  usage: { input_tokens: 10, output_tokens: 5 },
  stop_reason: "tool_use",
});
eq(anthropicReply.text, "hello there", "Anthropic text blocks are joined");
eq(anthropicReply.toolCalls[0].arguments, { query: "vpn" }, "Anthropic tool input is already an object");
eq(anthropicReply.tokensUsed, 15, "Anthropic counts input plus output");

const googleReply = parseChatReply(aiProviderSpec("google")!, {
  candidates: [{ content: { parts: [{ text: "hello" }, { functionCall: { name: "find_ticket", args: { query: "vpn" } } }] }, finishReason: "STOP" }],
  usageMetadata: { totalTokenCount: 33 },
});
eq(googleReply.text, "hello", "Gemini reply text");
eq(googleReply.toolCalls[0].name, "find_ticket", "Gemini function calls are read");
check(googleReply.toolCalls[0].id.startsWith("call_"), "Gemini calls are given a stable id because it returns none");
eq(googleReply.tokensUsed, 33, "Gemini token count");

eq(parseChatReply(aiProviderSpec("openai")!, {}).text, "", "an empty reply is empty, not a crash");
eq(parseChatReply(aiProviderSpec("anthropic")!, {}).toolCalls, [], "a reply with no content has no calls");

// ── 6. Failures say what the vendor said ────────────────────────────────────────────────────
console.log("\nFailures carry the vendor's own words");
eq(errorDetail(401, { error: { message: "Incorrect API key provided" } }), "401 — Incorrect API key provided", "OpenAI/Anthropic-style error.message");
eq(errorDetail(400, { error: "invalid_request" }), "400 — invalid_request", "a bare string error");
eq(errorDetail(403, { message: "quota exceeded" }), "403 — quota exceeded", "a top-level message");
eq(errorDetail(500, {}), "500", "a body with nothing in it still reports the status");

// ── 7. A whole round trip, with the network stubbed ─────────────────────────────────────────
console.log("\nA call is made and its answer read");
reset();
responder = () => ({ status: 200, json: { choices: [{ message: { content: "ok" } }], usage: { total_tokens: 3 } } });
const okCall = await chatWithProvider(record("openai"), { messages: [{ role: "user", content: "hi" }] });
check(okCall.ok && okCall.data?.text === "ok", "a 200 is parsed");
check(calls[0].url === "https://api.openai.com/v1/chat/completions", "the call went to the vendor's chat endpoint");
check(calls[0].headers.Authorization === "Bearer test-key", "with the key attached");

reset();
responder = () => ({ status: 401, json: { error: { message: "Incorrect API key provided" } } });
const unauthorised = await chatWithProvider(record("openai"), { messages: [{ role: "user", content: "hi" }] });
check(!unauthorised.ok && unauthorised.detail?.includes("Incorrect API key") === true, "a rejected key is reported with the vendor's message");
check(unauthorised.status === 401, "and the status is kept");

reset();
const noModel = await chatWithProvider(record("openai", { model: "" }), { messages: [{ role: "user", content: "hi" }] });
check(!noModel.ok && calls.length === 0, "a connection with no model is refused before the network");

reset();
const noAddress = await chatWithProvider(record("azure_openai", { apiKey: "k", apiEndpoint: null, config: {} }), { messages: [{ role: "user", content: "hi" }] });
check(!noAddress.ok && noAddress.detail === "The connection has no address", "Azure without an address is refused before the network");

reset();
const unknown = await chatWithProvider(record("not-a-provider"), { messages: [{ role: "user", content: "hi" }] });
check(!unknown.ok && unknown.detail?.includes("catalogue") === true, "an unknown provider is refused with a reason");

reset();
const loopback = await chatWithProvider(record("ollama"), { messages: [{ role: "user", content: "hi" }] });
check(!loopback.ok && loopback.detail?.includes("egress policy") === true, "a loopback endpoint is refused by the egress policy by default");
check(calls.length === 0, "and no request is attempted when the policy refuses");

reset();
responder = () => ({ status: 500, json: { error: { message: "upstream exploded" } } });
const failed = await chatWithProvider(record("deepseek"), { messages: [{ role: "user", content: "hi" }] });
check(!failed.ok && failed.detail?.includes("upstream exploded") === true, "a vendor 500 is reported, not thrown");

// ── 8. Model lists, in every vendor's shape ─────────────────────────────────────────────────
console.log("\nModel lists are read in every vendor's shape");
reset();
responder = () => ({ status: 200, json: { data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] } });
const openaiModels = await listProviderModels(record("openai"));
check(openaiModels.ok && openaiModels.data?.models.length === 2, "OpenAI's data array is read");
check(calls[0].method === "GET" && calls[0].url === "https://api.openai.com/v1/models", "the model list is a GET to /models");

reset();
responder = () => ({ status: 200, json: { models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }] } });
const googleModels = await listProviderModels(record("google"));
eq(googleModels.data?.models[0], { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }, "Gemini's models/ prefix is stripped and its label kept");

reset();
responder = () => ({ status: 200, json: { data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] } });
const anthropicModels = await listProviderModels(record("anthropic"));
eq(anthropicModels.data?.models[0], { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }, "Anthropic's display_name is read");

reset();
responder = () => ({ status: 401, json: { error: { message: "invalid x-api-key" } } });
const badKey = await listProviderModels(record("anthropic"));
check(!badKey.ok && badKey.detail?.includes("invalid x-api-key") === true, "a rejected key on the model list is reported");

reset();
const noList = await listProviderModels(record("azure_openai", { config: { credentials: { endpoint: "https://contoso.openai.azure.com" } } }));
check(!noList.ok && noList.detail?.includes("cannot be asked") === true, "a provider with no model list says so instead of calling something");

// ── 9. Testing a connection ─────────────────────────────────────────────────────────────────
console.log("\nTesting a connection uses the cheapest call that proves it works");
reset();
responder = () => ({ status: 200, json: { data: [{ id: "deepseek-chat" }] } });
const tested = await testProvider(record("deepseek"));
check(tested.ok && tested.detail?.includes("1 model") === true, "a listed model proves the key works");
check(calls.length === 1 && calls[0].method === "GET", "and it costs one GET rather than a completion");

reset();
responder = call => call.method === "GET" ? { status: 404, json: { error: { message: "not found" } } } : { status: 200, json: { choices: [{ message: { content: "ok" } }] } };
const fellBack = await testProvider(record("groq"));
check(fellBack.ok, "a vendor that will not list models is tested with a call instead");
check(calls.length === 2 && calls[1].method === "POST", "the second attempt is a completion");

reset();
responder = () => ({ status: 200, json: { data: [] } });
const noModels = await testProvider(record("openai"));
check(noModels.ok && noModels.detail?.includes("listed no models") === true, "an empty model list still counts as a working key, and says so");

reset();
const noKey = await testProvider(record("openai", { apiKey: null }));
check(!noKey.ok && noKey.detail?.includes("No API key") === true && calls.length === 0, "a missing key is caught before the network");

reset();
responder = () => ({ status: 200, json: { choices: [{ message: { content: "ok" } }] } });
// The host is a real one on purpose: the point of this check is that a provider whose key is
// optional is not refused for want of one, and the egress policy resolves addresses before a
// connection is attempted — a made-up hostname would fail for the wrong reason.
const localNoKey = await testProvider(record("ollama", { apiKey: null, apiEndpoint: "https://api.deepseek.com" }));
check(localNoKey.ok, "a provider whose key is optional is tested without one");

reset();
responder = () => ({ status: 200, json: { error: { message: "Incorrect API key provided" }, data: null } });
const notAList = await testProvider(record("openai"));
check(notAList.ok && notAList.detail?.includes("no models") === true, "a 200 that lists nothing is a key that was accepted, and says exactly that");

globalThis.fetch = realFetch;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
