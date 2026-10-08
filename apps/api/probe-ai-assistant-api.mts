/**
 * The assistant route, over HTTP: gates, refusals, and the audit line it leaves.
 *
 * The loop itself is covered by probe-ai-assistant.mts with a scripted model. What can only be
 * checked here is the route: who may ask, what happens when nothing is connected, that the answer
 * carries the vendor's own failure rather than a 500, and that the prompt and the functions that ran
 * end up in the audit trail.
 *
 * It uses Prisma directly for teardown only — the audit entries it causes are removed again, because
 * a probe should not leave facts in the trail that nobody asked for.
 *
 * Run from apps/api:  pnpm exec tsx probe-ai-assistant-api.mts   (the API must be running on 4000)
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const db = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function signIn(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  return body.token ?? null;
}

const token = await signIn("persona.admin@c7ntax.local");
if (!token) { console.log("could not sign in — is the API running on 4000?"); await db.$disconnect(); process.exit(1); }
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const get = async (path: string) => {
  const res = await fetch(`${BASE}/api${path}`, { headers: auth });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const post = async (path: string, body?: unknown) => {
  const res = await fetch(`${BASE}/api${path}`, { method: "POST", headers: auth, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

// ── 1. Who may ask at all ───────────────────────────────────────────────────────────────────
console.log("\nThe assistant is behind the inference gate");
check((await fetch(`${BASE}/api/inference/tools`)).status === 401, "an anonymous read of the function list is refused");
check((await fetch(`${BASE}/api/inference/assist`, { method: "POST" })).status === 401, "an anonymous prompt is refused");
const readonly = await signIn("persona.readonly@c7ntax.local");
if (readonly) {
  const res = await fetch(`${BASE}/api/inference/assist`, {
    method: "POST", headers: { authorization: `Bearer ${readonly}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: "hello" }),
  });
  check(res.status === 403, "a persona without inference:view cannot prompt the model");
}

// ── 2. The function list the screen builds itself from ──────────────────────────────────────
console.log("\nThe function list is served with what each one needs");
const tools = await get("/inference/tools");
check(tools.status === 200, "the function list answers 200");
check(Array.isArray(tools.body.all) && tools.body.all.length >= 8, `${tools.body.all?.length} functions in the catalogue`);
check(Array.isArray(tools.body.tools) && tools.body.tools.length > 0, "and the caller's own slice is returned");
check(tools.body.all.every((t: any) => t.name && t.permission && t.kind && t.description), "every function names itself, its permission and its kind");
check(tools.body.all.every((t: any) => t.kind === "read" || t.kind === "propose"), "and is either a read or a proposal");
check(tools.body.all.filter((t: any) => t.kind === "propose").every((t: any) => t.permission.startsWith("ticket:")), "proposals need a write permission on tickets");
check(tools.body.tools.every((t: any) => tools.body.all.some((a: any) => a.name === t.name)), "the caller's slice is drawn from the catalogue");
check(typeof tools.body.maxSteps === "number" && tools.body.maxSteps >= 1, `the step ceiling is published (${tools.body.maxSteps})`);

// ── 3. Refusals before anything is called ───────────────────────────────────────────────────
console.log("\nA prompt that cannot be answered says so");
const empty = await post("/inference/assist", { prompt: "   " });
check(empty.status === 400, "an empty prompt is a 400");
const huge = await post("/inference/assist", { prompt: "x".repeat(4100) });
check(huge.status === 400, "an enormous prompt is a 400 rather than a bill");

const status = await get("/inference/status");
const previousDefault: string | null = status.body.connected ? (await get("/inference/providers")).body.find((p: any) => p.isActive && p.isDefault)?.id ?? null : null;
if (previousDefault) await post(`/inference/providers/${previousDefault}/deactivate`);
const nothingConnected = await post("/inference/assist", { prompt: "How many clients do we have?" });
check(nothingConnected.status === 409, "with no model connected, a prompt is a 409");
check(String(nothingConnected.body?.error?.message ?? "").includes("CloudConnect"), "and the message says where to connect one");
if (previousDefault) await post(`/inference/providers/${previousDefault}/activate`);

// ── 4. A prompt with a model that cannot answer ─────────────────────────────────────────────
/*
 * This uses a real provider with a key that is not a key. The vendor's refusal is the point: the
 * route must report what the vendor said, as a 200 with a failed outcome, rather than turning an
 * expired key into a 500 the operator has to read a log to understand.
 */
console.log("\nA vendor refusal is reported, not thrown");
const created = await post("/inference/providers", {
  name: `Probe assistant ${Date.now()}`,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-probe-not-a-real-key",
  appFunctions: true,
});
check(created.status === 201, "a probe model is connected");
const providerId = created.body.id as string;
await post(`/inference/providers/${providerId}/activate`);

const started = Date.now();
const assisted = await post("/inference/assist", { prompt: "How many clients do we have?" });
check(assisted.status === 200, "the prompt answers 200 even though the model could not");
check(assisted.body.stoppedBecause === "failed", "the outcome says the model failed");
check(assisted.body.answer === "", "and there is no invented answer");
check(String(assisted.body.detail ?? "").includes("401"), `the vendor's own status is carried through (${String(assisted.body.detail).slice(0, 40)})`);
check(assisted.body.functionsOffered === true, "the answer says the connection was allowed to use functions");
check(assisted.body.provider === "deepseek" && assisted.body.model === "deepseek-v4-pro", "and which model was asked");
check(assisted.body.steps.length === 0, "no function ran, because the model never got to ask for one");

// ── 5. The audit trail ──────────────────────────────────────────────────────────────────────
console.log("\nWho asked the model what is in the audit trail");
const logs = await get(`/system/audit-logs?entity=ai_provider&entityId=${providerId}`);
const mine = (logs.body.data ?? []).filter((l: any) => l.action === "ai_assist" && new Date(l.createdAt).getTime() >= started - 2000);
check(mine.length === 1, `exactly one audit entry was written (${mine.length})`);
const entry = mine[0] ?? {};
check(entry.changes?.model === "deepseek/deepseek-v4-pro", "it names the model");
check(entry.changes?.appFunctions === true, "it records whether functions were permitted");
check(typeof entry.changes?.functions === "string", `it records which functions ran (${entry.changes?.functions})`);
check(String(entry.changes?.prompt ?? "").includes("How many clients"), "it keeps the prompt");
check(entry.changes?.stoppedBecause === "failed", "and how the run ended");

// ── 6. Cleaning up ──────────────────────────────────────────────────────────────────────────
console.log("\nThe probe takes its own facts back out");
const removedAudit = await db.auditLog.deleteMany({ where: { id: { in: mine.map((l: any) => l.id) } } });
check(removedAudit.count === mine.length, "the audit entries it caused are removed");
await post(`/inference/providers/${providerId}/deactivate`);
const removed = await fetch(`${BASE}/api/inference/providers/${providerId}`, { method: "DELETE", headers: auth });
check(removed.status === 200, "the probe's model is removed");
if (previousDefault) await post(`/inference/providers/${previousDefault}/activate`);
const after = await get("/inference/status");
check(!previousDefault || after.body.connected === true, "the model that was in use before the probe is in use again");

await db.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
