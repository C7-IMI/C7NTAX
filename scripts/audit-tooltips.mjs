/**
 * Tooltip audit: what would the app label every icon-only control?
 *
 * The browser dump (`report.json`) lists every interactive element with no text of its own, per route,
 * as the running app renders it. This compares each one against the resolver's own tables, so the
 * answer is the label the user would actually see — including "none", which is a decision too.
 *
 * Run:  node scripts/audit-tooltips.mjs <browser-dump.json>
 */
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../apps/web/src/components/GlobalTooltip.tsx", import.meta.url), "utf8");

/** The action table, read out of the component so this audit cannot drift from it. */
const actions = {};
const table = source.slice(source.indexOf("const ICON_ACTIONS"), source.indexOf("const ICON_IS_AMBIGUOUS"));
for (const match of table.matchAll(/^\s{2}([a-z0-9]+):\s*"([^"]+)"/gm)) actions[match[1]] = match[2];

const ambiguousBlock = source.slice(source.indexOf("const ICON_IS_AMBIGUOUS"), source.indexOf("/** Where a link or button"));
const ambiguous = new Set([...ambiguousBlock.matchAll(/"([a-z0-9]+)"/g)].map(m => m[1]));

const humanize = word =>
  word.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/([a-z])(\d+)$/i, "$1 $2").trim();

/** Exactly what `iconActionLabel` will do, minus the parts that need the DOM. */
const resolve = control => {
  if (control.aria) return { label: control.aria, from: "aria-label" };
  if (control.dataTooltip) return { label: control.dataTooltip, from: "data-tooltip" };
  if (control.title) return { label: control.title, from: "title" };
  if (control.ariaExpanded !== null && /chevron|caret|plu|minu|triangle/.test(control.icon || "")) {
    return { label: control.ariaExpanded === "true" ? "Collapse" : "Expand", from: "aria-expanded" };
  }
  if (control.wrapperTitle) return { label: control.wrapperTitle, from: "wrapper" };
  if (!control.icon) return { label: null, from: "nothing" };
  if (ambiguous.has(control.icon)) return { label: null, from: "ambiguous icon, no context" };
  if (actions[control.icon]) return { label: actions[control.icon], from: "icon action" };
  if (/\d/.test(control.icon)) return { label: null, from: "glyph name refused" };
  const words = humanize(control.icon);
  if (words.length > 24 || words.split(" ").length > 2) return { label: null, from: "glyph name refused" };
  return { label: words, from: "icon name" };
};

const raw = readFileSync(process.argv[2], "utf8");

/**
 * The dump is a `Result:` line holding the returned JSON string, followed by the accessibility
 * snapshot. Peel however many layers of escaping the tool applied, then read the object itself.
 */
function extractReport(text) {
  const line = text.split(/\r?\n/).find(l => l.startsWith("Result: "));
  if (!line) throw new Error("no Result: line in the dump");
  let inner = line.slice("Result: ".length).trim();
  if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = inner.replace(/\\"/g, '"');
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* one more layer */ }
    }
    inner = candidate;
  }
  throw new Error("could not read the dump");
}

const report = extractReport(raw);

const pairs = new Map();
const silent = new Map();
const contexts = new Map();
let controls = 0;
for (const [route, items] of Object.entries(report)) {
  for (const control of items) {
    controls++;
    const { label, from } = resolve(control);
    if (label) {
      const key = `${control.icon} → "${label}"`;
      if (!pairs.has(key)) pairs.set(key, { from, routes: new Set() });
      pairs.get(key).routes.add(route);
    } else {
      const key = `${control.icon ?? control.tag} (${from})`;
      if (!silent.has(key)) silent.set(key, new Set());
      silent.get(key).add(route);
      if (!contexts.has(key)) contexts.set(key, control.cls);
    }
  }
}

console.log(`${controls} icon-only controls across ${Object.keys(report).length} routes\n`);
console.log("── Labelled ────────────────────────────────────────────────────────────");
for (const [key, value] of [...pairs].sort()) {
  console.log(`  ${key.padEnd(46)} ${value.from.padEnd(14)} ${[...value.routes].join(", ")}`);
}
console.log("\n── No tooltip ──────────────────────────────────────────────────────────");
for (const [key, routes] of [...silent].sort()) {
  console.log(`  ${key.padEnd(46)} ${[...routes].join(", ")}`);
}
