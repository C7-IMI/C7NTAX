#!/usr/bin/env node
/**
 * Design-token guard.
 *
 * Flags raw hex colors in `.tsx` files — they bypass the CSS-variable theme
 * (see apps/web/src/index.css + tailwind.config.js) and break dark/light
 * switching. New violations fail the check; files listed in LEGACY_ALLOWLIST
 * are known pre-existing offenders awaiting migration.
 *
 * Usage: node scripts/lint-design-tokens.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "apps", "web", "src");

// Pre-existing files that still contain raw hex (measured 2026-10-05). Shrink
// this list over time; do not add to it — use the design tokens instead.
const LEGACY_ALLOWLIST = new Set([
  "apps/web/src/main.tsx",
  "apps/web/src/components/Layout.tsx",
  "apps/web/src/pages/AiActions.tsx",
  "apps/web/src/pages/Calendar.tsx",
  "apps/web/src/pages/Monitors.tsx",
  "apps/web/src/pages/PTO.tsx",
  "apps/web/src/pages/Quotes.tsx",
  "apps/web/src/pages/Reports.tsx",
]);

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const violations = [];
let legacyCount = 0;

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const matches = readFileSync(file, "utf8").match(HEX);
  if (!matches) continue;
  if (LEGACY_ALLOWLIST.has(rel)) {
    legacyCount += matches.length;
  } else {
    violations.push({ file: rel, count: matches.length });
  }
}

if (violations.length > 0) {
  console.error("[design-tokens] Raw hex colors found outside the legacy allowlist:");
  for (const v of violations) console.error(`  ${v.file} (${v.count})`);
  console.error("\nUse design tokens instead: text-white, text-gray-*, text-cyber-*, bg-surface-*, etc.");
  process.exit(1);
}

console.log(
  `[design-tokens] OK — no new raw hex. ${legacyCount} legacy occurrence(s) remain in ${LEGACY_ALLOWLIST.size} allowlisted file(s).`
);
