#!/usr/bin/env node
/**
 * Computes the next BuildNotes version from the ACTUAL current date.
 *
 * Version scheme: Year.Month.Day.Build — the date octets are always the
 * current system date (derived, never typed); the build number starts at
 * 001 each day and increments sequentially for same-day entries.
 *
 * Usage: node scripts/next-version.mjs
 * Prints e.g. "2026.8.19.003"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mdPath = path.resolve(__dirname, "..", "BuildNotes.md");

const now = new Date();
const dateOctets = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;

let highest = 0;
const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf-8") : "";
const versionRe = /^## (\d{4}\.\d{1,2}\.\d{1,2}\.\d{3}) — /;
for (const line of md.split(/\r?\n/)) {
  const m = line.match(versionRe);
  if (!m) continue;
  const [y, mo, d, build] = m[1].split(".").map(Number);
  if (y === now.getFullYear() && mo === now.getMonth() + 1 && d === now.getDate() && build > highest) {
    highest = build;
  }
}

console.log(`${dateOctets}.${String(highest + 1).padStart(3, "0")}`);
