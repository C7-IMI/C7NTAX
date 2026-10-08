/**
 * probe-cli â€” the `c7ntax` CLI, driven as a program against the running API.
 *
 * This runs the CLI **as a subprocess**, with an API key it issues and revokes itself, because the two
 * things worth proving here cannot be proved in-process:
 *
 * 1. **It is a second front end on one grammar.** `c7ntax _complete` must offer the same candidates the
 *    in-app console offers, for the same line â€” which is only meaningful when the CLI is a real process
 *    reading the real catalogue from the real API with a real key.
 * 2. **Its exit codes are a contract.** A script branches on 0/1/2/3/5/6, so each one is provoked: an
 *    unknown noun, an unknown flag, a command this key's scopes exclude, a subject that does not exist,
 *    and a write â€” which is refused by policy until PLAN-026's action manifest exists.
 *
 * The key is created with a *narrow* scope set on purpose: the refusal case has to be a real refusal by
 * the API rather than a message the CLI printed from its own assumptions (it has none â€” Â§6).
 *
 * Requires the API running (default http://localhost:4000) with the seeded administrator.
 * Run with: pnpm --filter @C7NTAX/cli exec tsx probe-cli.mts
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = process.env.C7NTAX_SERVER ?? "http://localhost:4000";
const EMAIL = process.env.C7NTAX_EMAIL ?? "admin@C7NTAX.com";
const PASSWORD = process.env.C7NTAX_PASSWORD ?? "admin";
const CLI = fileURLToPath(new URL("./src/index.ts", import.meta.url));

let passed = 0;
const failures: string[] = [];
const check = (name: string, condition: boolean, detail = ""): void => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` â€” ${detail}` : ""}`);
};

/** Run the CLI with a scratch HOME so the probe never touches the operator's real profile. */
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const home = mkdtempSync(join(tmpdir(), "c7ntax-probe-"));

function cli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", CLI, ...args],
      {
        env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: "1", ...env },
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = typeof (error as { code?: number } | null)?.code === "number" ? (error as { code: number }).code : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

// â”€â”€ Issue a key for the probe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const login = await fetch(`${SERVER}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const session = await login.json();
if (!session.token) {
  console.error(`probe-cli: could not sign in (${login.status}) â€” is the API running?`);
  process.exit(1);
}
const auth = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };

// A read-only key that can see tickets but not users: enough for the commands below, and short of what
// the administrator holds, which is what makes the permission-refusal case real.
const issued = await fetch(`${SERVER}/api/api-keys`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    name: `Probe CLI key ${Date.now()}`,
    sourceKind: "other",
    description: "Issued by probe-cli, revoked by the same run",
    permissions: ["ticket:view", "client:view", "report:view"],
  }),
});
const key = await issued.json();
if (!key.key) {
  console.error(`probe-cli: could not issue a key (${issued.status}) ${JSON.stringify(key)}`);
  process.exit(1);
}

const cleanup = async (): Promise<void> => {
  await fetch(`${SERVER}/api/api-keys/${key.id}`, {
    method: "DELETE",
    headers: auth,
    body: JSON.stringify({ reason: "probe-cli finished" }),
  }).catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
};

try {
  // â”€â”€ login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const refusable = await cli(["login", "--server", SERVER, "--key", "not-a-key"]);
  check("login refuses a value that is not a key", refusable.code === 1, `exit ${refusable.code}`);

  const signedIn = await cli(["login", "--server", SERVER, "--key", key.key]);
  check("login succeeds with a real key", signedIn.code === 0, `exit ${signedIn.code}: ${signedIn.stderr.slice(0, 160)}`);
  check("login names the account", signedIn.stdout.includes(EMAIL.split("@")[0] ?? ""), signedIn.stdout.slice(0, 120));

  // â”€â”€ context, version, help â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const context = await cli(["context"]);
  check("context runs", context.code === 0, `exit ${context.code}: ${context.stderr.slice(0, 160)}`);
  check("context reports the server", context.stdout.includes(SERVER.replace(/^https?:\/\//, "")), context.stdout.slice(0, 160));
  check("context counts the commands this key may run", /Commands\s+\d+ available of \d+/.test(context.stdout), context.stdout.slice(0, 200));

  const version = await cli(["version"]);
  check("version runs", version.code === 0, `exit ${version.code}`);
  check("version reports the application build", /application\s+2026\./.test(version.stdout), version.stdout.slice(0, 160));

  const help = await cli(["help"]);
  check("help lists groups", help.code === 0 && /Tickets/.test(help.stdout), help.stdout.slice(0, 120));

  const nounHelp = await cli(["help", "ticket"]);
  check("help <noun> lists verbs", nounHelp.code === 0 && /list/.test(nounHelp.stdout) && /show/.test(nounHelp.stdout), nounHelp.stdout.slice(0, 160));

  const verbHelp = await cli(["help", "ticket", "list"]);
  check("help <noun> <verb> prints the flags", /--status/.test(verbHelp.stdout), verbHelp.stdout.slice(0, 200));
  check("help <noun> <verb> names the route and the permission", /GET \/tickets/.test(verbHelp.stdout) && /ticket:view/.test(verbHelp.stdout), verbHelp.stdout.slice(0, 200));

  // â”€â”€ Reads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const list = await cli(["ticket", "list", "--limit", "2"]);
  check("ticket list runs", list.code === 0, `exit ${list.code}: ${list.stderr.slice(0, 200)}`);
  check("ticket list prints a table with headings", /NUMBER/.test(list.stdout) && /SUBJECT/.test(list.stdout), list.stdout.slice(0, 200));
  check("ticket list reports its row count", /row/.test(list.stdout), list.stdout.slice(-80));

  const asJson = await cli(["ticket", "list", "--limit", "1", "--json"]);
  check("--json prints parseable JSON", (() => { try { JSON.parse(asJson.stdout); return true; } catch { return false; } })(), asJson.stdout.slice(0, 120));

  const quiet = await cli(["ticket", "list", "--limit", "3", "--quiet"]);
  const quietLines = quiet.stdout.trim().split("\n").filter(Boolean);
  check("--quiet prints identifiers only", quietLines.length > 0 && quietLines.length <= 3 && !/SUBJECT/.test(quiet.stdout), quiet.stdout.slice(0, 120));

  const verbose = await cli(["ticket", "list", "--limit", "1", "--verbose"]);
  check("--verbose names the route and the permission", /GET \/tickets/.test(verbose.stderr) && /ticket:view/.test(verbose.stderr), verbose.stderr.slice(0, 200));

  const complex = await cli(["client", "show", "acme"]);
  check("a subject resolves through the list route", complex.code === 0, `exit ${complex.code}: ${complex.stderr.slice(0, 200)}`);

  // â”€â”€ Exit codes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const unknown = await cli(["widget", "list"]);
  check("an unknown noun exits 1", unknown.code === 1, `exit ${unknown.code}`);

  const badFlag = await cli(["ticket", "list", "--nonsense"]);
  check("an unknown flag exits 1", badFlag.code === 1, `exit ${badFlag.code}`);

  const notFound = await cli(["client", "show", "no-such-client-anywhere"]);
  check("a subject that does not exist exits 3", notFound.code === 3, `exit ${notFound.code}: ${notFound.stderr.slice(0, 160)}`);

  const refused = await cli(["user", "list"]);
  check("a command this key may not run exits 2", refused.code === 2, `exit ${refused.code}: ${refused.stderr.slice(0, 160)}`);

  const write = await cli(["ticket", "create", "--client", "acme"]);
  check("a write is refused by policy, exit 5", write.code === 5, `exit ${write.code}: ${write.stderr.slice(0, 200)}`);

  // â”€â”€ Completion: one engine, two front ends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const completeNoun = await cli(["_complete", "tick"]);
  check("_complete offers nouns", completeNoun.stdout.split("\n").map((l) => l.split("\t")[0]).includes("ticket"), completeNoun.stdout.slice(0, 120));

  const completeVerb = await cli(["_complete", "ticket "]);
  const verbs = completeVerb.stdout.split("\n").map((line) => line.split("\t")[0]);
  check("_complete offers the noun's verbs", verbs.includes("list") && verbs.includes("show"), verbs.join(","));

  const completePartial = await cli(["_complete", "ticket l"]);
  const partial = completePartial.stdout.split("\n").map((line) => line.split("\t")[0]).filter(Boolean);
  check("_complete narrows a partial verb", partial.length === 1 && partial[0] === "list", partial.join(","));
  check("_complete carries descriptions for a menu", completePartial.stdout.includes("\t"), completePartial.stdout.slice(0, 120));

  const completeEnum = await cli(["_complete", "ticket list --status "]);
  check("_complete offers a flag's real values", /in_progress/.test(completeEnum.stdout), completeEnum.stdout.slice(0, 160));

  const refusedNouns = await cli(["_complete", "us"]);
  check("_complete offers nothing this key may not run", !/^user$/m.test(refusedNouns.stdout), refusedNouns.stdout.slice(0, 120));

  // â”€â”€ Completion scripts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const shell of ["bash", "zsh", "pwsh"]) {
    const script = await cli(["completion", shell]);
    check(`completion ${shell} is generated`, script.code === 0 && script.stdout.includes("_complete"), script.stdout.slice(0, 80));
  }
  const badShell = await cli(["completion", "fish"]);
  check("an unknown shell exits 1", badShell.code === 1, `exit ${badShell.code}`);

  // â”€â”€ The environment beats the file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const viaEnv = await cli(["context"], { C7NTAX_KEY: key.key, C7NTAX_SERVER: SERVER });
  check("C7NTAX_SERVER and C7NTAX_KEY work without a stored profile", viaEnv.code === 0 && /from the environment/.test(viaEnv.stdout), viaEnv.stdout.slice(0, 200));

  // â”€â”€ logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loggedOut = await cli(["logout"]);
  check("logout succeeds", loggedOut.code === 0, `exit ${loggedOut.code}`);
  const after = await cli(["context"], { C7NTAX_KEY: "", C7NTAX_SERVER: "" });
  check("after logout the CLI is not signed in", after.code === 2 && /Not signed in/.test(after.stderr), `exit ${after.code}: ${after.stderr.slice(0, 160)}`);
} finally {
  await cleanup();
}

console.log(`probe-cli: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  âœ— ${failure}`);
  process.exit(1);
}
