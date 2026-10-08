import { chatWithProvider, type ChatMessage, type ChatResult, type ChatOptions, type ProviderRecord } from "../inference/vendors";
import { canRun, type AssistantCaller, type AssistantDb, type AssistantTool, type ToolStep } from "./tools";
/**
 * The assistant: a prompt, the application's own functions, and a model that may call them.
 *
 * It is a loop rather than a call because a question like "what is going on with Contoso" needs more
 * than one step: find the client, read their tickets, look at the alerts, then answer. The model
 * decides the steps; this file decides what it is allowed to do while taking them.
 *
 * Three limits are load-bearing:
 *
 * - **The tools offered are the caller's, by permission**, and the permission is checked again when
 *   the model actually calls one. A model can ask for a function it was never given.
 * - **A fixed number of steps.** Without a ceiling, a model that keeps asking for functions is a
 *   bill and a hung request.
 * - **Failures go back to the model as text, not as exceptions.** "You may not view clients" is an
 *   answer the model can work with; a stack trace is not, and a caller who asked something harmless
 *   should not get a 500 because one function was refused.
 */

export interface AssistantStep extends ToolStep {
  /** Milliseconds the function itself took. */
  durationMs: number;
}

export interface AssistantResult {
  answer: string;
  steps: AssistantStep[];
  model: string;
  provider: string;
  tokensUsed: number;
  /** How many times the model was called — one more than the number of rounds of functions. */
  modelCalls: number;
  /** Set when the loop stopped for a reason other than the model finishing. */
  stoppedBecause: "answered" | "step-limit" | "not-configured" | "failed";
  detail?: string;
}

/** The seam that makes this testable: the probe supplies a scripted vendor instead of a network. */
export interface AssistantTransport {
  chat(record: ProviderRecord, options: ChatOptions): Promise<{ ok: boolean; data: ChatResult | null; detail: string | null }>;
}

const defaultTransport: AssistantTransport = { chat: chatWithProvider };

export const MAX_STEPS = 6;

const SYSTEM_PROMPT = `You are the assistant inside C7NTAX, a professional services automation platform used by an MSP.

How to work:
- Use the functions you are given to find facts. Never invent a client, a ticket, a number of anything, or a status: if you do not have it, call a function or say you could not find it.
- You act as the signed-in person, so you can only see what they can see. If a function tells you that you may not view something, say so plainly rather than guessing.
- Functions that would change data are proposals: they are queued for a person to approve. When you use one, say clearly that it is awaiting approval and that nothing has changed yet.
- Be brief and concrete. Lead with the answer, then the facts behind it. Do not describe the functions you called unless the user asks.
- Amounts, dates and statuses come from the functions. If two functions disagree, say so rather than choosing.`;

export interface RunAssistantInput {
  prompt: string;
  record: ProviderRecord;
  caller: AssistantCaller;
  /** The database client the functions run against — passed in, so this module starts no server. */
  db: AssistantDb;
  /** The whole registry of functions; the caller's permissions decide which are offered. */
  tools: AssistantTool[];
  /** Whether the connection is allowed to call application functions at all. */
  allowAppFunctions: boolean;
  /** Whether proposals are offered as well as reads. */
  allowProposals?: boolean;
  transport?: AssistantTransport;
  maxSteps?: number;
  /** Extra context prepended to the prompt, e.g. the ticket the question was asked from. */
  context?: string;
}

/** The model's view of a function. */
function toolDefinition(tool: AssistantTool) {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

export async function runAssistant(input: RunAssistantInput): Promise<AssistantResult> {
  const transport = input.transport ?? defaultTransport;
  const maxSteps = Math.max(1, input.maxSteps ?? MAX_STEPS);
  const base = { model: input.record.model, provider: input.record.provider };

  if (!input.record.model) {
    return { answer: "", steps: [], ...base, tokensUsed: 0, modelCalls: 0, stoppedBecause: "not-configured", detail: "The connection has no model set." };
  }

  /**
   * What the model is offered: the caller's functions, filtered by permission.
   *
   * `input.tools` is the whole registry, not the caller's slice of it, because the two questions are
   * different ones — "may this model call this?" and "does this function exist at all?" — and the
   * answers read very differently in a trace. A refusal that says a real function was not permitted
   * is a security fact worth seeing; "no function is called that" is a model inventing things.
   */
  const offered = input.allowAppFunctions
    ? input.tools.filter(tool => canRun(tool, input.caller) && (tool.kind === "read" || input.allowProposals !== false))
    : [];
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (input.context) messages.push({ role: "system", content: input.context });
  messages.push({ role: "user", content: input.prompt });

  const steps: AssistantStep[] = [];
  let tokensUsed = 0;
  let modelCalls = 0;

  for (let round = 0; round <= maxSteps; round++) {
    const options: ChatOptions = { messages, ...(offered.length ? { tools: offered.map(toolDefinition) } : {}) };
    modelCalls++;
    const reply = await transport.chat(input.record, options);
    if (!reply.ok || !reply.data) {
      return {
        answer: "",
        steps,
        ...base,
        tokensUsed,
        modelCalls,
        stoppedBecause: "failed",
        detail: reply.detail ?? "The model did not answer.",
      };
    }
    tokensUsed += reply.data.tokensUsed;

    // No function calls: this is the answer.
    if (!reply.data.toolCalls.length) {
      return { answer: reply.data.text, steps, ...base, tokensUsed, modelCalls, stoppedBecause: "answered" };
    }

    // The ceiling is checked before running the round, so a model that keeps asking for functions
    // gets stopped between rounds rather than halfway through one.
    if (round === maxSteps) {
      return {
        answer: reply.data.text,
        steps,
        ...base,
        tokensUsed,
        modelCalls,
        stoppedBecause: "step-limit",
        detail: `Stopped after ${maxSteps} rounds of function calls.`,
      };
    }

    messages.push({ role: "assistant", content: reply.data.text, toolCalls: reply.data.toolCalls });

    for (const call of reply.data.toolCalls) {
      const started = Date.now();
      const tool = offered.find(t => t.name === call.name);
      let step: ToolStep;
      if (!tool) {
        const known = input.tools.find(t => t.name === call.name);
        step = {
          tool: call.name,
          arguments: call.arguments,
          ok: false,
          // Two different refusals, and the difference matters to whoever reads the trace: a function
          // that does not exist, and one that exists but is not this caller's to use.
          summary: known ? `Not permitted: ${known.name} needs ${known.permission}.` : `No function is called ${call.name}.`,
          content: known ? `You are not permitted to use "${known.name}" as this user.` : `There is no function called "${call.name}".`,
        };
      } else {
        try {
          step = await tool.run(call.arguments, input.caller, input.db);
        } catch (e) {
          const detail = (e as Error).message;
          step = { tool: tool.name, arguments: call.arguments, ok: false, summary: `${tool.name} failed: ${detail}`, content: `The function "${tool.name}" failed: ${detail}` };
        }
      }
      steps.push({ ...step, durationMs: Date.now() - started });
      messages.push({ role: "tool", content: step.content, toolCallId: call.id });
    }
  }

  // Unreachable: the loop returns on the last round.
  return { answer: "", steps, ...base, tokensUsed, modelCalls, stoppedBecause: "step-limit", detail: `Stopped after ${maxSteps} rounds.` };
}

/**
 * A short, factual account of what the assistant did, for the audit trail.
 *
 * It records which functions ran, not what they returned: an audit entry that copies client data
 * into a log table is a second copy of the data with weaker rules.
 */
export function stepsSummary(steps: AssistantStep[]): string {
  if (!steps.length) return "no application functions were called";
  const counts = new Map<string, { calls: number; refused: number }>();
  for (const step of steps) {
    const entry = counts.get(step.tool) ?? { calls: 0, refused: 0 };
    entry.calls++;
    if (!step.ok) entry.refused++;
    counts.set(step.tool, entry);
  }
  return [...counts.entries()]
    .map(([tool, entry]) => `${tool}×${entry.calls}${entry.refused ? ` (${entry.refused} refused)` : ""}`)
    .join(", ");
}
