#!/usr/bin/env node
/**
 * TOKEN-SAVE-05: BuildNotes single-source generation.
 *
 * Root BuildNotes.md is the single source of truth. This script:
 *   1. copies it to apps/web/public/BuildNotes.md (What's New page)
 *   2. generates apps/api/src/BuildNotes.json by parsing the MD
 *      (the JSON has no runtime consumer, but keeping it generated
 *      removes the triple-editing cost)
 *
 * Usage: node scripts/generate-buildnotes.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const mdPath = path.join(root, "BuildNotes.md");
const webMdPath = path.join(root, "apps", "web", "public", "BuildNotes.md");
const jsonPath = path.join(root, "apps", "api", "src", "BuildNotes.json");

const md = fs.readFileSync(mdPath, "utf-8");

// ── Copy MD → web public ────────────────────────────────────────────
fs.mkdirSync(path.dirname(webMdPath), { recursive: true });
fs.writeFileSync(webMdPath, md);
console.log("[generate-buildnotes] BuildNotes.md -> apps/web/public/");

// ── Parse MD → JSON ─────────────────────────────────────────────────
const entries = [];
const versionRe = /^## (\d{4}\.\d{1,2}\.\d{1,2}\.\d{3}) — (.+)$/;
const changeRe = /^- \*\*\[(New|Update|Fix|Audit|Improved)\]\*\* (.*)$/;

let current = null;
for (const rawLine of md.split(/\r?\n/)) {
  const vMatch = rawLine.match(versionRe);
  if (vMatch) {
    if (current) entries.push(current);
    const [ , version, title ] = vMatch;
    const [ y, m, d ] = version.split(".").slice(0, 3).map(Number);
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    current = { version, date, title, changes: [] };
    continue;
  }
  if (!current) continue;
  const cMatch = rawLine.match(changeRe);
  if (cMatch) {
    const [ , type, text ] = cMatch;
    const typeMap = {
      "New": "New Feature",
      "Update": "Update",
      "Fix": "Fix",
      "Audit": "Audit",
      "Improved": "Improvement",
    };
    current.changes.push({ text, type: typeMap[type] || type });
  }
}
if (current) entries.push(current);

if (entries.length === 0) {
  console.error("[generate-buildnotes] ERROR: no version entries parsed from BuildNotes.md");
  process.exit(1);
}

fs.writeFileSync(jsonPath, JSON.stringify(entries, null, 2) + "\n");
console.log(`[generate-buildnotes] parsed ${entries.length} versions -> apps/api/src/BuildNotes.json`);
