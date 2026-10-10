#!/usr/bin/env node
/**
 * Design-token guard.
 *
 * Flags raw hex colors in `.tsx` files — they bypass the CSS-variable theme
 * (see apps/web/src/index.css + tailwind.config.js) and break dark/light
 * switching and the eight colour schemes. See DESIGN.md §2 and §9.
 *
 * Usage: node scripts/lint-design-tokens.mjs
 *
 * Two lists, and they mean different things:
 *
 * - `LEGACY_ALLOWLIST` is **debt** (measured 2026-10-05). Shrink it; never add to it.
 * - `STRUCTURAL_EXEMPT` is **not** debt: these files legitimately contain literal colours, because
 *   the thing they render has no CSS to reach. A printed report must not follow the user's dark
 *   theme, and a client's own portal accent is a colour the user owns. Each entry carries its reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN_DIR = join(ROOT, "apps", "web", "src");

// Pre-existing files that still contain raw hex. Shrink this list over time;
// do not add to it — use the design tokens instead.
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

/**
 * Files whose literal colours are deliberate, with the reason each one is here.
 *
 * The test for an addition is: **is this a colour the theme could reach but the author did not
 * bother to use, or is there genuinely no theme here?** Anything rendered into a document (a print
 * window, a PDF, a canvas) has no CSS variables to resolve, so a token would produce a black page.
 * A value the user sets is theirs, not the scheme's. Anything else belongs in the tokens.
 */
const STRUCTURAL_EXEMPT = {
  "apps/web/src/components/reports/reportKit.tsx":
    "Renders a self-contained print/PDF document: its own <style> block, no access to the app's CSS variables. A printed report must not follow the user's dark theme.",
  "apps/web/src/components/reports/designer/PageRenderer.tsx":
    "The report page itself — paper defaults for a band background and a border colour, which are the document's, not the interface's.",
  "apps/web/src/components/reports/designer/Inspector.tsx":
    "Default values for the document's own style fields (the text colour a report uses), which are document properties a person edits, not interface chrome.",
  "apps/web/src/pages/ClientDetail.tsx":
    "A client's own portal accent colour, which the user sets and the product must not re-theme, plus the example of it in the help text beside the field.",
  "apps/web/src/components/email/EmailSample.tsx":
    "Draws the customer-facing email itself — a document that leaves the building, wearing the kit's own colours from lib/documentBrand.ts and the template's existing palette. An email must look the same to the client whatever theme the person who sent it prefers, exactly as a printed report must, so a token here would produce the wrong message.",
  "apps/web/src/pages/HelpDoc.tsx":
    "Documentation prose that quotes a colour value in order to teach it: the hex somebody types into a branding field appears in the words of a walkthrough, as it already does in ClientDetail's help text. A quoted example is not a colour this file draws — the help draws none of its own, so a token here would be a token in a sentence.",
};

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
let structuralCount = 0;

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const matches = readFileSync(file, "utf8").match(HEX);
  if (!matches) continue;
  if (LEGACY_ALLOWLIST.has(rel)) {
    legacyCount += matches.length;
  } else if (STRUCTURAL_EXEMPT[rel]) {
    structuralCount += matches.length;
  } else {
    violations.push({ file: rel, count: matches.length });
  }
}

if (violations.length > 0) {
  console.error("[design-tokens] Raw hex colors found outside the legacy allowlist:");
  for (const v of violations) console.error(`  ${v.file} (${v.count})`);
  console.error("\nUse design tokens instead: text-white, text-gray-*, text-cyber-*, bg-surface-*, etc.");
  console.error("If the colour genuinely has no theme to reach — a printed document, or a value the");
  console.error("user owns — add the file to STRUCTURAL_EXEMPT in this script with its reason, in the");
  console.error("same commit, rather than leaving the guard failing. See DESIGN.md §2.");
  process.exit(1);
}

console.log(
  `[design-tokens] OK — no new raw hex. ` +
    `${legacyCount} legacy occurrence(s) in ${LEGACY_ALLOWLIST.size} file(s) awaiting migration, ` +
    `${structuralCount} deliberate literal(s) in ${Object.keys(STRUCTURAL_EXEMPT).length} exempt file(s).`
);
