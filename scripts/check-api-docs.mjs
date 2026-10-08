#!/usr/bin/env node
/**
 * API documentation guard.
 *
 * The specification is generated from the routes, so it cannot describe an endpoint that does not
 * exist. What it *can* still do is fall behind: a route added and the generator not run, or a curated
 * description left behind after the operation it described was renamed or removed. Both are how an
 * API document becomes a liability, and both are checked here.
 *
 * It fails when:
 *   1. `docs/openapi.yaml` differs from what the routes would generate (run the generator);
 *   2. an entry in `docs/api-operations.json` names an operation the API no longer has.
 *
 * Run it before committing anything that touches a route, a permission or a request shape.
 *
 *     node scripts/check-api-docs.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "./generate-openapi.mjs";

const ROOT = process.cwd();
const SPEC = join(ROOT, "docs", "openapi.yaml");
const CURATED = join(ROOT, "docs", "api-operations.json");

const failures = [];

// ── 1. Is the document what the routes say it is? ───────────────────────────
const { operations, unmounted, document, documented, shadowed } = generate();

let onDisk = "";
try { onDisk = readFileSync(SPEC, "utf8").replace(/\r\n/g, "\n"); } catch { failures.push("docs/openapi.yaml is missing — run: node scripts/generate-openapi.mjs"); }

if (onDisk && onDisk !== document) {
  /*
   * Say *what* moved rather than only that something did. The document is read back a path block at a
   * time rather than with one expression, because every method on a path has to come out: an earlier
   * version matched only the first method of each path and blamed 106 perfectly documented routes.
   */
  const declared = new Set(operations.map(operation => `${operation.method} ${operation.openapiPath}`));
  const inSpec = new Set();
  const from = onDisk.indexOf("\npaths:\n");
  const until = onDisk.indexOf("\ncomponents:\n", from);
  const pathSection = from === -1 ? "" : onDisk.slice(from, until === -1 ? undefined : until);
  for (const block of pathSection.split(/\n(?= {2}")/)) {
    const path = block.match(/^ {2}("[^"]+"):/);
    if (!path) continue;
    for (const method of block.matchAll(/^ {4}(get|post|put|patch|delete):$/gm)) {
      inSpec.add(`${method[1].toUpperCase()} ${JSON.parse(path[1])}`);
    }
  }
  const missing = [...declared].filter(key => !inSpec.has(key));
  const ghosts = [...inSpec].filter(key => !declared.has(key));
  if (missing.length) failures.push(`${missing.length} route(s) are not in the document: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? " …" : ""}`);
  if (ghosts.length) failures.push(`${ghosts.length} documented operation(s) have no route: ${ghosts.slice(0, 6).join(", ")}${ghosts.length > 6 ? " …" : ""}`);
  if (!missing.length && !ghosts.length) failures.push("docs/openapi.yaml differs from the routes in a way this check could not attribute — regenerate it");
}

// ── 2. Does a curated description still describe something? ────────────────
let curated = {};
try { curated = JSON.parse(readFileSync(CURATED, "utf8")); } catch { failures.push("docs/api-operations.json is missing or is not valid JSON"); }

const declaredKeys = new Set(operations.map(operation => `${operation.method} ${operation.path}`));
const stale = Object.keys(curated).filter(key => !key.startsWith("_") && !declaredKeys.has(key));

if (stale.length) failures.push(`${stale.length} curated description(s) name an operation that no longer exists: ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? " …" : ""}`);

// ── 3. Report ───────────────────────────────────────────────────────────────
const withPermission = operations.filter(operation => operation.permissions.length > 0).length;
console.log(`api docs: ${operations.length} operations · ${documented} with a curated summary · ${withPermission} naming a permission`);
console.log(`          ${new Set(operations.map(o => o.tag)).size} tags · ${Object.keys(curated).filter(k => !k.startsWith("_")).length} curated entries`);
// Not failures: an unmounted router is dead code, and a shadowed route is one Express never reaches.
// Neither belongs in a document of what the API serves, but both are worth saying out loud.
if (unmounted.length) console.log(`          note: declared but never mounted, so not documented: ${unmounted.join(", ")}`);
if (shadowed.length) console.log(`          note: second declaration of the same route, never reached: ${shadowed.join(", ")}`);

if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("\nAPI documentation and the application disagree. Run: node scripts/generate-openapi.mjs");
  process.exit(1);
}
console.log("the specification matches the routes, and every curated description still describes one");
