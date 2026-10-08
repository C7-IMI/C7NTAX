/**
 * The assistant: a scripted model, and the application's real functions.
 *
 * The point of this probe is the part that cannot be eyeballed. A model that asks for a function it
 * was not offered, a function that refuses because the caller may not see that data, a model that
 * keeps asking forever, a database that goes away mid-question, and — the one that matters most — a
 * *proposal* that must leave the ticket exactly as it was. All of those are asserted here against the
 * real database, with the model replaced by a script.
 *
 * It talks to Postgres directly rather than through the API, deliberately: importing the API's entry
 * point starts a server and a set of workers, so the tool definitions were written to take a client
 * instead of reaching for one.
 *
 * Run from apps/api:  pnpm exec tsx probe-ai-assistant.mts
 */
import { PrismaClient } from "@prisma/client";
import { runAssistant, stepsSummary, type AssistantTransport } from "./src/services/ai/assistant";
import { ASSISTANT_TOOLS, canRun, toolsFor, type AssistantCaller, type AssistantTool } from "./src/services/ai/tools";

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const eq = (actual: unknown, expected: unknown, label: string) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${label}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);

const db = new PrismaClient();

/** A model that answers from a script: the tool calls are the interesting part, not the words. */
interface ScriptedReply { text?: string; toolCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }> }

function scripted(replies: ScriptedReply[]) {
  const seen: Array<{ tools: string[]; messages: Array<{ role: string; content: string }> }> = [];
  const transport: AssistantTransport = {
    async chat(_record, options) {
      seen.push({
        tools: (options.tools ?? []).map(t => t.name),
        messages: options.messages.map(m => ({ role: m.role, content: m.content })),
      });
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
      return {
        ok: true,
        data: {
          text: reply.text ?? "",
          toolCalls: (reply.toolCalls ?? []).map((call, index) => ({ id: call.id ?? `call_${index}`, name: call.name, arguments: call.args ?? {} })),
          tokensUsed: 10,
          finishReason: null,
        },
        detail: null,
      };
    },
  };
  return { transport, seen };
}

const allPermissions = ["ticket:view", "ticket:edit", "ticket:create", "client:view", "contact:view", "asset:view", "kb:view", "servicealert:view", "integration:view"];
const callerWith = (permissions: string[]): AssistantCaller => ({ userId: "probe-user", permissions });

const record = {
  provider: "openai", apiKey: "probe", apiEndpoint: null, model: "probe-model",
  maxTokens: 500, temperature: 0.2, topP: 1, config: {},
};

// Real data to work with, so the functions are asked real questions.
const company = await db.company.findFirst({ select: { id: true, name: true } });
const ticket = await db.ticket.findFirst({ select: { id: true, ticketNumber: true, companyId: true, _count: { select: { comments: true } } } });
if (!company || !ticket) {
  console.log("the development database has no client or ticket to ask about — seed it first");
  await db.$disconnect();
  process.exit(1);
}
const searchTerm = company.name;
check(!!searchTerm, `the probe asks about a real client (${searchTerm})`);

// ── 1. The registry describes itself ────────────────────────────────────────────────────────
console.log("\nThe functions describe themselves");
check(ASSISTANT_TOOLS.length >= 8, `${ASSISTANT_TOOLS.length} functions registered`);
check(new Set(ASSISTANT_TOOLS.map(t => t.name)).size === ASSISTANT_TOOLS.length, "their names are unique");
check(ASSISTANT_TOOLS.every(t => t.description.length > 40), "every function explains itself to the model");
check(ASSISTANT_TOOLS.every(t => t.parameters?.type === "object"), "every function takes an object of arguments");
check(ASSISTANT_TOOLS.every(t => typeof t.permission === "string" && t.permission.includes(":")), "every function names the permission it needs");
check(ASSISTANT_TOOLS.every(t => t.kind === "read" || t.kind === "propose"), "every function is a read or a proposal");
check(ASSISTANT_TOOLS.some(t => t.kind === "read") && ASSISTANT_TOOLS.some(t => t.kind === "propose"), "both kinds exist");
check(ASSISTANT_TOOLS.filter(t => t.kind === "propose").length <= 2, "the write side is deliberately small");

// ── 2. What a caller is offered, and what they may run ──────────────────────────────────────
console.log("\nA caller is offered only what their permissions allow");
const ticketOnly = toolsFor(callerWith(["ticket:view"]));
eq(ticketOnly.map(t => t.name), ["list_boards", "find_tickets", "ticket_detail"], "a ticket-only caller sees the service-desk reads and nothing else");
check(toolsFor(callerWith([])).length === 0, "a caller with no permissions is offered nothing");
check(toolsFor(callerWith(allPermissions)).length === ASSISTANT_TOOLS.length, "a caller with every permission is offered everything");
check(!toolsFor(callerWith(allPermissions), { allowProposals: false }).some(t => t.kind === "propose"), "proposals can be withheld entirely");
check(!toolsFor(callerWith(["client:view"])).some(t => t.name === "find_tickets"), "a client-only caller is not offered tickets");
const assetTool = ASSISTANT_TOOLS.find(t => t.name === "list_assets") as AssistantTool;
check(canRun(assetTool, callerWith(["asset:view"])) && !canRun(assetTool, callerWith(["ticket:view"])), "running a function is a permission check, not a preference");

// ── 3. A question that needs the application ───────────────────────────────────────────────
console.log("\nA question is answered using the application's own data");
const first = scripted([
  { toolCalls: [{ name: "find_clients", args: { query: searchTerm } }] },
  { text: `Found them: ${company.name}.` },
]);
const answered = await runAssistant({
  prompt: `What do you know about ${searchTerm}?`,
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: first.transport,
});
eq(answered.stoppedBecause, "answered", "the loop finishes when the model answers");
eq(answered.modelCalls, 2, "the model was called twice: once to ask, once to answer");
eq(answered.steps.length, 1, "one function was called");
check(answered.steps[0].ok, "and it succeeded");
check(answered.steps[0].content.includes(company.name), "the function's answer contains the client's real name");
check(answered.steps[0].durationMs >= 0, "the step records how long it took");
check(answered.tokensUsed === 20, "token use is added up across the calls");
check(first.seen[0].messages[0].role === "system", "the model is given a system prompt first");
check(first.seen[0].tools.includes("find_clients"), "and the functions it may call");
check(first.seen[1].messages.some(m => m.role === "tool"), "the function's answer is fed back to the model");

// ── 4. The model asks for things it may not have ────────────────────────────────────────────
console.log("\nA model that overreaches is refused, not obeyed");
const overreach = scripted([
  { toolCalls: [{ name: "connection_health", args: {} }] },
  { text: "I am not allowed to look at connections." },
]);
const refused = await runAssistant({
  prompt: "Which connections are broken?",
  record, caller: callerWith(["ticket:view"]), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: overreach.transport,
});
eq(refused.stoppedBecause, "answered", "the caller still gets an answer");
check(!refused.steps[0].ok, "the function did not run");
check(refused.steps[0].summary.includes("Not permitted"), `the trace says why (${refused.steps[0].summary})`);
check(!overreach.seen[0].tools.includes("connection_health"), "and it was never offered the function in the first place");

const invented = scripted([
  { toolCalls: [{ name: "delete_everything", args: {} }] },
  { text: "That function does not exist." },
]);
const unknown = await runAssistant({
  prompt: "Do something that does not exist",
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: invented.transport,
});
check(!unknown.steps[0].ok && unknown.steps[0].summary.includes("No function"), "a function that does not exist is refused");

const badArguments = scripted([
  { toolCalls: [{ name: "client_overview", args: { clientId: "not-a-real-id" } }] },
  { text: "No such client." },
]);
const missing = await runAssistant({
  prompt: "Tell me about not-a-real-id",
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: badArguments.transport,
});
check(!missing.steps[0].ok && missing.steps[0].summary.includes("No client exists"), "an argument that matches nothing is reported, not invented around");

// ── 5. Limits, failures and the off switch ─────────────────────────────────────────────────
console.log("\nThe loop has limits, and says when it stops");
const loop = scripted([{ toolCalls: [{ name: "find_clients", args: { query: searchTerm } }] }]);
const capped = await runAssistant({
  prompt: "Keep looking",
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: loop.transport, maxSteps: 2,
});
eq(capped.stoppedBecause, "step-limit", "a model that keeps calling functions is stopped");
eq(capped.modelCalls, 3, "at one call more than the limit");
check(/Stopped after 2 rounds/.test(capped.detail ?? ""), "and the reason says how many rounds it allowed");
check(capped.steps.length <= 3, "only the rounds that were allowed actually ran");

const broken: AssistantTransport = { async chat() { return { ok: false, data: null, detail: "503 — upstream is down" }; } };
const failed = await runAssistant({
  prompt: "Anything", record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true, transport: broken,
});
eq(failed.stoppedBecause, "failed", "a model that cannot answer is reported as failed");
check(failed.detail?.includes("503") === true, "with the vendor's words");
eq(failed.steps.length, 0, "and no functions were called");

const noTools = scripted([{ toolCalls: [{ name: "find_clients", args: { query: searchTerm } }] }, { text: "I cannot look that up." }]);
const offSwitched = await runAssistant({
  prompt: "What do you know?",
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: false,
  transport: noTools.transport,
});
eq(noTools.seen[0].tools, [], "a connection with app functions switched off is offered none");
eq(offSwitched.steps.length, 1, "and a function it asks for anyway is refused");
check(!offSwitched.steps[0].ok, "with a refusal in the trace");

const noModel = await runAssistant({
  prompt: "Anything", record: { ...record, model: "" }, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true, transport: noTools.transport,
});
eq(noModel.stoppedBecause, "not-configured", "a connection with no model is refused before anything is called");

const throwingDb = new Proxy(db, {
  get(target, prop, receiver) {
    // The function under test reads `company`, so that is the call that has to fail.
    if (prop === "company") throw new Error("connection reset by peer");
    return Reflect.get(target, prop, receiver);
  },
});
const withBrokenDb = scripted([{ toolCalls: [{ name: "find_clients", args: { query: searchTerm } }] }, { text: "The database went away." }]);
const dbFailure = await runAssistant({
  prompt: "Anything", record, caller: callerWith(allPermissions), db: throwingDb as unknown as PrismaClient,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true, transport: withBrokenDb.transport,
});
check(dbFailure.stoppedBecause === "answered", "a database failure inside a function does not end the question");
check(!dbFailure.steps[0].ok && dbFailure.steps[0].summary.includes("failed"), "it is recorded as a failed step");
check(withBrokenDb.seen[1].messages.some(m => m.content.includes("failed")), "and the model is told, so it can answer honestly");

// ── 6. Proposals propose; they do not write ─────────────────────────────────────────────────
console.log("\nA proposal changes nothing until somebody approves it");
const before = await db.aiAction.count();
const commentsBefore = await db.ticketComment.count({ where: { ticketId: ticket.id } });

const proposing = scripted([
  { toolCalls: [{ name: "propose_ticket_note", args: { ticketId: ticket.id, note: "Probe: a note that must not be written yet." } }] },
  { text: "I have proposed a note for approval." },
]);
const proposed = await runAssistant({
  prompt: `Add a note to ${ticket.ticketNumber}`,
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: proposing.transport,
});
check(proposed.steps[0].ok, "the proposal was raised");
check(proposed.steps[0].content.includes("awaiting"), "and the model is told it is awaiting approval");
const commentsAfter = await db.ticketComment.count({ where: { ticketId: ticket.id } });
eq(commentsAfter, commentsBefore, "the ticket has exactly as many notes as it did before");
const raised = await db.aiAction.findMany({ where: { createdAt: { gt: new Date(Date.now() - 60_000) } }, select: { id: true, title: true, riskTier: true, status: true, entityId: true, payload: true } });
check(raised.length >= 1, "a proposal row exists");
const noteProposal = raised.find(a => (a.payload as Record<string, unknown>)?.kind === "ticket_note");
check(!!noteProposal, "and it is the note");
eq(noteProposal?.riskTier, "low", "an internal note is proposed at the lowest tier it can be");
eq(noteProposal?.status, "pending", "and it is pending, not executed");
eq(noteProposal?.entityId, ticket.id, "it points at the ticket it is about");

const proposingTicket = scripted([
  { toolCalls: [{ name: "propose_ticket", args: { clientId: company.id, title: "Probe: something for a person to decide", description: "Raised by a probe." } }] },
  { text: "I have proposed a ticket." },
]);
await runAssistant({
  prompt: "Raise a ticket",
  record, caller: callerWith(allPermissions), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: proposingTicket.transport,
});
const ticketProposal = await db.aiAction.findFirst({ where: { entityType: "ticket", entityId: null, createdAt: { gt: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: "desc" } });
check(!!ticketProposal, "a new ticket is proposed rather than created");
eq(ticketProposal?.riskTier, "medium", "at a tier that needs a decision");

// The proposal is the caller's, so a caller who cannot edit tickets cannot raise one.
const cannotPropose = scripted([{ toolCalls: [{ name: "propose_ticket_note", args: { ticketId: ticket.id, note: "should never happen" } }] }, { text: "Not allowed." }]);
const denied = await runAssistant({
  prompt: "Add a note",
  record, caller: callerWith(["ticket:view"]), db,
  tools: ASSISTANT_TOOLS, allowAppFunctions: true,
  transport: cannotPropose.transport,
});
check(!denied.steps[0].ok && denied.steps[0].summary.includes("Not permitted"), "a caller without ticket:edit cannot propose a note");

// ── 7. The audit line, and cleaning up ─────────────────────────────────────────────────────
console.log("\nThe trace summarises what happened, and the probe cleans up");
check(stepsSummary([]) === "no application functions were called", "an empty trace says so");
check(stepsSummary(proposed.steps).startsWith("propose_ticket_note×1"), `the summary names the functions (${stepsSummary(proposed.steps)})`);
const mixedSummary = stepsSummary([...answered.steps, ...refused.steps]);
check(mixedSummary.includes("find_clients×1") && mixedSummary.includes("refused"), "refusals are counted separately");

const cleaned = await db.aiAction.deleteMany({ where: { id: { in: raised.map(a => a.id).concat(ticketProposal ? [ticketProposal.id] : []) } } });
check(cleaned.count >= 2, `${cleaned.count} probe proposals removed`);
const remaining = await db.aiAction.count();
check(remaining === before, "the proposal count is back where it started");

await db.$disconnect();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
