#!/usr/bin/env node
/**
 * Runs this repository's workflow shell through a shell (PLAN-030 review, round 4).
 *
 * **Why this exists.** Round 4 found a blocker that every other check in this repository is blind to,
 * and the reason is worth stating because it is the reason this file does: a `#` comment written
 * *between* the backslash-continued arguments of an `az` command ends the chain. `bash` joins the next
 * line to the previous one, the comment swallows it, and the invocation arrives truncated — in that
 * case `az containerapp job create` was called with `--image` and nothing else: no `--command`, no
 * registry, no identity, no secrets — while the flag lines below ran as a command of their own
 * (`--command: command not found`).
 *
 * Nothing else here can see it. YAML parses. `az` parses, because the broken line is never an `az`
 * argument. `validate-bicep.mjs` compiles a different file. `bash -n` sees valid shell, because it is
 * valid shell. It would have failed once, in the environment being created, and a re-run would take
 * the other branch and never reach it.
 *
 * **The four checks, and what each one catches.**
 *
 *   1. **It is valid shell** — `bash -n` over every `run:` block. Catches a truncated brace or a bad
 *      `if`.
 *   2. **No comment inside a continuation group** — a line ending in `\` followed by a line whose
 *      first non-space character is `#`. That is the shape above, exactly, and it has no legitimate
 *      use: the comment ends the command at that point.
 *   3. **No orphaned flags** — a continuation group whose *first* token begins with `-`. Flags belong
 *      to a command; a group that starts with a flag has lost the command it was written for.
 *   4. **Nothing tries to execute a flag** — the block is run with a stub `az` and a stub `curl` on
 *      `PATH`, and a `command not found` naming a `-`-prefixed word is a failure. This is the runtime
 *      symptom of 2 and 3, and it needs no understanding of the block's branches.
 *
 * **What it does not prove**, and the same sentence the Bicep check carries: that `az` *accepts* the
 * arguments, or that the call succeeds against a resource group. That is a different question with a
 * different method — run the command and read which error comes back — and `validate-bicep.mjs` and
 * the review documents cover it. This file only proves the arguments reach `az` at all.
 *
 *   node scripts/azure/check-workflow-shell.mjs
 *   BASH_PATH=/usr/bin/bash node scripts/azure/check-workflow-shell.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowsDir = path.join(root, ".github", "workflows");

/** A shell, because the thing being checked is shell. */
function findBash() {
  if (process.env.BASH_PATH) return process.env.BASH_PATH;
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]
      : ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return "bash";
  } catch {
    return null;
  }
}

const bash = findBash();
if (!bash) {
  console.error("No bash was found, and the workflow shell cannot be checked without one.");
  console.error("Install Git for Windows, or point BASH_PATH at a shell, e.g.");
  console.error("  BASH_PATH=/usr/bin/bash node scripts/azure/check-workflow-shell.mjs");
  process.exit(1);
}

/**
 * Every `run:` block in every workflow, with the step name it belongs to.
 *
 * Deliberately not a YAML parse: a parser would need a dependency, and the shape being read — an
 * indented block under `run: |` — is unambiguous in these files.
 */
function readRunBlocks(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-?\s*run:\s*\|/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    let name = "(unnamed step)";
    for (let back = i; back > 0 && back > i - 12; back--) {
      const match = lines[back].match(/^\s*-?\s*name:\s*(.+?)\s*$/);
      if (match) { name = match[1]; break; }
    }
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === "") { body.push(""); continue; }
      if (lines[j].match(/^\s*/)[0].length <= indent) break;
      body.push(lines[j].slice(indent + 2));
    }
    blocks.push({ name, body: body.join("\n").replace(/\n+$/, "") + "\n" });
    i = j - 1;
  }
  return blocks;
}

/**
 * The groups bash actually sees, and the two static checks over them.
 *
 * A group is a maximal run of lines joined by a trailing backslash. `bash -n` is the parse; these two
 * read the same text for the two shapes that parse cleanly and still do the wrong thing.
 */
function inspectGroups(block) {
  const lines = block.split("\n");
  const problems = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0].trim();
    if (first.startsWith("-")) problems.push(`flags with no command: ${first.slice(0, 70)}`);
    // A `\`-continued line followed by a comment ends the command there, silently.
    group.forEach((line, index) => {
      if (index === 0) return;
      const previous = group[index - 1];
      if (/\\\s*$/.test(previous) && /^\s*#/.test(line)) {
        problems.push(`a comment inside a continued command (after "${previous.trim().slice(0, 60)}")`);
      }
    });
    group = [];
  };
  for (const line of lines) {
    group.push(line);
    if (!/\\\s*$/.test(line)) flush();
  }
  flush();
  return problems;
}

// ── The stub environment: enough for a workflow block to reach its `az` calls ──────────────────────
//
// The point is not to simulate Azure. It is that nothing in the block stops early for a reason that
// has nothing to do with the shell, so a `command not found` is the block's own fault. `sleep` is a
// no-op so a wait loop costs nothing.

const scratch = mkdtempSync(path.join(tmpdir(), "wf-shell-"));
mkdirSync(path.join(scratch, "bin"), { recursive: true });
const ARGV_LOG = path.join(scratch, "argv.log");
writeFileSync(ARGV_LOG, "");

const stubs = {
  az: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AZ_STUB_LOG"
case "$*" in
  *"job show"*) exit 1 ;;
  *"revision show"*"--query properties.healthState"*) echo "Healthy" ;;
  *"revision list"*) echo "c7ntax-probe--substituted" ;;
  *"keyvault list"*) echo "kv-c7ntax-probe" ;;
  *"keyvault show"*) echo "https://kv-c7ntax-probe.vault.azure.net/" ;;
  *"acr list"*) echo "c7ntaxprobe.azurecr.io" ;;
  *"job start"*) echo "c7ntax-probe-migrate-exec1" ;;
esac
exit 0
`,
  curl: '#!/usr/bin/env bash\necho "200"\nexit 0\n',
  sleep: "#!/usr/bin/env bash\nexit 0\n",
  docker: "#!/usr/bin/env bash\nexit 0\n",
};
for (const [name, body] of Object.entries(stubs)) writeFileSync(path.join(scratch, "bin", name), body, "utf8");
execFileSync(bash, ["-c", `chmod +x ${path.join(scratch, "bin", "*").replace(/\\/g, "/")}`]);

const githubEnv = path.join(scratch, "github-output.txt");
writeFileSync(githubEnv, "");
const env = {
  ...process.env,
  AZ_STUB_LOG: ARGV_LOG,
  GITHUB_OUTPUT: githubEnv,
  GITHUB_ENV: githubEnv,
  GITHUB_STEP_SUMMARY: githubEnv,
};

/**
 * The stubs go on `PATH` from *inside* the shell, and that is not incidental.
 *
 * Git for Windows' bash rebuilds `PATH` with its own `/mingw64/bin` first, ahead of anything the
 * parent process set — so a `curl` or a `sleep` on the inherited path is the real one, and a stub
 * prepared outside the shell is shadowed. (It cost a 30-second hang to find: the health-gate block
 * polled a real `curl` twelve times and a real `sleep` in between.)
 *
 * `cygpath` is what makes the directory addressable at all from the shell on Windows — a Windows
 * path handed to bash literally, `C:/Users/STEPHE~1/…`, is not something bash will resolve.
 */
const stubBin = path.join(scratch, "bin").replace(/\\/g, "/");
const PRELUDE = `STUB_BIN='${stubBin}'; if command -v cygpath >/dev/null 2>&1; then STUB_BIN=$(cygpath -u "$STUB_BIN"); fi; export PATH="$STUB_BIN:$PATH"`;

const workflowFiles = readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f)).sort();
let checks = 0;
let blocks = 0;
let failures = 0;
const problems = [];
const report = (ok, message) => {
  checks++;
  if (ok) return;
  failures++;
  problems.push(message);
};

console.log(`bash: ${bash}`);
for (const file of workflowFiles) {
  const rel = path.relative(root, path.join(workflowsDir, file));
  for (const { name, body } of readRunBlocks(path.join(workflowsDir, file))) {
    const where = `${rel} · ${name}`;
    const script = path.join(scratch, `${file}-${checks}.sh`);
    // GitHub expressions are not shell; a placeholder keeps the block runnable without pretending
    // to know what the runner will substitute.
    writeFileSync(script, body.replace(/\$\{\{[^}]*\}\}/g, "SUBSTITUTED"), "utf8");
    const run = () => {
      try {
        return {
          code: 0,
          out: execFileSync(bash, ["-c", `${PRELUDE}; '${script.replace(/\\/g, "/")}' 2>&1`], {
            encoding: "utf8",
            env,
            stdio: ["ignore", "pipe", "pipe"],
            // A block that waits — on a port, a revision, a job — must not be able to hang the
            // check. The stubs remove the real waits; this is the backstop for the one nobody
            // thought of.
            timeout: 30_000,
          }),
        };
      } catch (error) {
        const timedOut = error.signal === "SIGTERM" || error.code === "ETIMEDOUT";
        return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}`, timedOut };
      }
    };

    problems.length = 0;
    try {
      execFileSync(bash, ["-n", script.replace(/\\/g, "/")], { stdio: "ignore" });
    } catch (error) {
      report(false, `not valid shell: ${String(error.stderr ?? error.message).split("\n")[0]}`);
    }
    for (const problem of inspectGroups(body)) report(false, problem);

    if (/\baz\s/.test(body)) {
      const result = run();
      if (result.timedOut) {
        const tail = result.out.trim().split("\n").slice(-3).join(" | ") || "(no output)";
        report(false, `the block did not finish in 30 s with the stubs in place — last output: ${tail}`);
      } else if (/command not found/.test(result.out)) {
        const line = result.out.split("\n").find((l) => /command not found/.test(l)) ?? "";
        report(false, `a line tried to execute a flag or an unknown command — ${line.trim()}`);
      }
    }

    if (problems.length === 0) console.log(`  ok    ${where}`);
    else {
      console.log(`  FAIL  ${where}`);
      for (const problem of problems) console.log(`        ${problem}`);
    }
    blocks++;
  }
}

rmSync(scratch, { recursive: true, force: true });
console.log(
  failures === 0
    ? `\nworkflow shell: ${blocks} block(s) over ${workflowFiles.length} file(s) — every block parses, and nothing is orphaned from its command`
    : `\n${failures} failure(s) in the workflow shell`,
);
process.exit(failures === 0 ? 0 : 1);
