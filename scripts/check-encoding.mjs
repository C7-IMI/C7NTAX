#!/usr/bin/env node
/**
 * Encoding guard: fails when a source file contains text that was round-tripped through the wrong
 * codepage.
 *
 * This repository has been bitten by it three times — an em dash read as `â€”`, an arrow as `â†’`, a
 * section sign as `Â§` — because Windows PowerShell 5.1 reads a BOM-less UTF-8 file as CP1252 and writes
 * it back as UTF-8, which turns one character into three. It is invisible in the console (PowerShell
 * prints UTF-8 as mojibake anyway), so it survives review; the first symptom is usually a broken
 * `[generate-buildnotes] parsed 1 versions`, long after the damage.
 *
 * **The test is the inverse conversion, not a list of suspicious characters.** A line is damaged if
 * CP1252-encoding it and decoding the result as UTF-8 succeeds *and* produces something different: that
 * is what double-encoding means, and a line that is correctly encoded cannot pass it.
 *
 * **A quotation has to declare itself.** The test cannot tell a specimen from wreckage — the same four
 * bytes are the same four bytes whether they are describing the trap or are an instance of it — and
 * `Retrace.md`, `BuildNotes.md` and `PLAN-029` quote the damage when they explain it. So a line that
 * round-trips *and* names the defect (`mojibake`, `double-encoded`) is reported as a quotation and left
 * alone; a line that names nothing is assumed to be wreckage. The hole is deliberate and small: prose
 * about this trap is exactly where the specimen belongs.
 *
 * Usage:
 *   node scripts/check-encoding.mjs           # fail if anything is repairable
 *   node scripts/check-encoding.mjs --list    # show what would be repaired, without failing
 *   node scripts/check-encoding.mjs --fix     # repair in place (UTF-8, no BOM, same line endings)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build output and vendored files are not ours to rewrite. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "dist-electron", "build", ".turbo", "coverage", "out", ".next", "vendor",
  "win-unpacked", "win-unpacked-old", "linux-unpacked", "mac", "playwright-report", "test-results",
]);
const SUFFIXES = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".ps1", ".py", ".sql",
  ".yml", ".yaml", ".txt",
]);
/** How many files the walk may look at, so a stray directory cannot turn this into a hang. */
const MAX_FILES = 20000;

/**
 * CP1252's 0x80–0x9F range, which is where it differs from Latin-1 — and that range is exactly what the
 * damage produces (€ for 0x80, “ ” for 0x93/0x94, — for 0x97).
 */
const CP1252_TO_BYTE = new Map(Object.entries({
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84, "\u2026": 0x85, "\u2020": 0x86,
  "\u2021": 0x87, "\u02c6": 0x88, "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95,
  "\u2013": 0x96, "\u2014": 0x97, "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b,
  "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f,
}));

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The shape damage makes: one of the mojibake lead characters followed by a CP1252 high byte. */
const LOOKS_DAMAGED = /[\u00c2\u00c3\u00e2][\u0080-\u00bf\u2013\u2014\u2018\u2019\u201c\u201d\u2020\u2022\u2026\u20ac\u2122]/;
/** A line that names the defect is a quotation of it, not an instance — see the note at the top. */
const NAMES_THE_DEFECT = /mojibake|double-encod/i;

/**
 * The line with its double-encoding undone, or null when it is not double-encoded.
 *
 * Returning null is the whole contract: a false positive here would rewrite correct text, so anything
 * that cannot be encoded to bytes (a character CP1252 has no byte for) or does not decode as UTF-8 is
 * left alone.
 */
function repaired(line) {
  const bytes = [];
  for (const character of line) {
    const mapped = CP1252_TO_BYTE.get(character);
    if (mapped !== undefined) { bytes.push(mapped); continue; }
    const code = character.codePointAt(0);
    if (code > 0xff) return null;
    bytes.push(code);
  }
  try {
    const fixed = decoder.decode(Uint8Array.from(bytes));
    return fixed === line ? null : fixed;
  } catch {
    return null;
  }
}

function* sourceFiles(dir = ROOT, seen = { count: 0 }) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* sourceFiles(full, seen);
      continue;
    }
    if (!SUFFIXES.has(path.extname(entry).toLowerCase())) continue;
    if (seen.count++ > MAX_FILES) return;
    yield full;
  }
}

const fix = process.argv.includes("--fix");
const list = process.argv.includes("--list");
const repairable = [];
const quoted = [];
let scanned = 0;

for (const file of sourceFiles()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // not UTF-8: not our business to guess at
  }
  scanned++;
  const endsWithCrLf = text.includes("\r\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fixes = new Map();
  const look = [];

  lines.forEach((line, index) => {
    const fixed = repaired(line);
    if (fixed !== null && !NAMES_THE_DEFECT.test(line)) {
      fixes.set(index, fixed);
      return;
    }
    // Reported, never repaired: the record of the trap, whether it quotes the damage or is prose about
    // the damage that happens to contain it.
    if (fixed !== null || LOOKS_DAMAGED.test(line)) look.push(index + 1);
  });

  if (fixes.size) {
    repairable.push({ file: path.relative(ROOT, file), lines: [...fixes.keys()].map((index) => index + 1) });
    if (fix) {
      for (const [index, fixed] of fixes) lines[index] = fixed;
      writeFileSync(file, Buffer.from(lines.join(endsWithCrLf ? "\r\n" : "\n"), "utf8"));
    }
  }
  if (look.length) quoted.push({ file: path.relative(ROOT, file), lines: look });
}

const repairedTotal = repairable.reduce((total, row) => total + row.lines.length, 0);
console.log(`encoding check: ${scanned} file(s) read, ${repairedTotal} line(s) with double-encoded text`);

for (const row of repairable) {
  console.log(`  ${fix ? "repaired" : "✗"} ${row.file}: line ${row.lines.join(", ")}`);
}
for (const row of quoted) {
  // The fix is to *not* touch these: they are the record of this trap, quoting it on purpose.
  console.log(`  · ${row.file}: line ${row.lines.join(", ")} quotes the damage (left alone)`);
}

if (repairedTotal && !fix) {
  console.error(
    "\nDouble-encoded text found. It is almost always a UTF-8 file read and written by Windows\n" +
    "PowerShell (which reads it as CP1252). Repair it with:\n  node scripts/check-encoding.mjs --fix\n" +
    "then check `git diff` — every changed line should be the character that was meant, and nothing else.",
  );
  process.exit(list ? 0 : 1);
}
console.log("no file contains double-encoded text");
