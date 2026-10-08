import { prisma } from "../../index";
import { ASSISTANT_TOOLS, type AssistantCaller, type AssistantTool } from "./tools";

/**
 * The assistant's functions bound to the API's database client.
 *
 * It lives in its own module so that `tools.ts` — the definitions, and the file a test wants to
 * import — never pulls in the API's entry point, which starts a server and a set of workers as a
 * side effect of being imported.
 */

export const assistantTools: AssistantTool[] = ASSISTANT_TOOLS;

export function assistantToolsFor(caller: AssistantCaller, opts: { allowProposals?: boolean } = {}): AssistantTool[] {
  return ASSISTANT_TOOLS.filter(tool =>
    caller.permissions.includes(tool.permission) && (tool.kind === "read" || opts.allowProposals !== false),
  );
}

export function assistantToolCatalogue(): Array<{ name: string; permission: string; kind: string; description: string }> {
  return ASSISTANT_TOOLS.map(t => ({ name: t.name, permission: t.permission, kind: t.kind, description: t.description }));
}

export { prisma as assistantDb };
