#!/usr/bin/env node
/**
 * Generate `docs/openapi.yaml` from the routes the API actually declares.
 *
 * The specification this replaces described 25 operations while the application served 322, and it
 * had drifted in ways nobody could see: an endpoint renamed, a permission changed, a route added and
 * never documented. A hand-written catalogue of an API that changes weekly is wrong within a week.
 *
 * So the inventory is **read from the source**: every `<router>.<method>("path", requirePermission(…))`
 * in `apps/api/src/routes`, joined with the mount prefix in `index.ts` and the permission names in the
 * shared enums. What is written by hand is only what a parser cannot invent — the summary, the
 * description, the example — and that lives in `docs/api-operations.json`, keyed by `METHOD /path`.
 * An operation with no curated entry still appears, with a summary derived from its path, which is
 * what keeps the document complete: the guard (`check-api-docs.mjs`) fails the build when a route
 * exists in code and not here, or the other way round.
 *
 *     node scripts/generate-openapi.mjs          # write docs/openapi.yaml
 *     node scripts/generate-openapi.mjs --check  # report drift, change nothing
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, "apps", "api", "src", "routes");
const INDEX = join(ROOT, "apps", "api", "src", "index.ts");
const ENUMS = join(ROOT, "packages", "shared", "src", "enums.ts");
const CURATED = join(ROOT, "docs", "api-operations.json");
const OUT = join(ROOT, "docs", "openapi.yaml");

const read = path => readFileSync(path, "utf8");

// ── What the application actually serves ────────────────────────────────────

/** Permission name → wire value, so the spec carries "ticket:view" rather than "TicketView". */
function permissionValues() {
  const source = read(ENUMS);
  const block = source.slice(source.indexOf("enum Permission"), source.indexOf("}", source.indexOf("enum Permission")));
  const values = new Map();
  for (const match of block.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) values.set(match[1], match[2]);
  return values;
}

/**
 * Mount prefix per router, keyed by the file the router is declared in: `"users.ts::usersRouter"`.
 *
 * The key has to carry the file, because a name alone is ambiguous. `routes/users.ts` declares a
 * second `rolesRouter` that nothing imports, and `routes/roles.ts` declares the one that is mounted
 * — keyed by name, the dead copy inherited the live mount point, and six routes that do not exist
 * were documented while the five that do were reported as duplicates of them.
 *
 * Import specifiers are resolved the way Node resolves them: `./routes/tickets` may be
 * `routes/tickets.ts` or `routes/tickets/index.ts`.
 */
function mounts() {
  const source = read(INDEX);
  const files = new Set(routeFiles());
  const importedFrom = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
    const specifier = match[2].replace(/^\.\//, "").replace(/^routes\//, "");
    for (const name of match[1].split(",")) {
      const [original, alias] = name.trim().split(/\s+as\s+/);
      if (!original?.endsWith("Router")) continue;
      const candidates = [`${specifier}.ts`, `${specifier}/index.ts`];
      const file = candidates.find(candidate => files.has(candidate));
      if (file) importedFrom.set((alias || original).trim(), file);
    }
  }

  const map = new Map();
  for (const match of source.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*(\w+Router)\s*\)/g)) {
    const file = importedFrom.get(match[2]);
    if (file) map.set(`${file}::${match[2]}`, match[1].replace(/\/$/, ""));
  }
  return map;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const ROUTE_PATTERN = /(\w+Router)\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,\s*(requirePermission\(([^)]*)\))?/g;

/**
 * Every route declaration in every router file, with the permission it names.
 *
 * The routes directory is walked recursively: the tickets surface lives in `routes/tickets/index.ts`
 * and a non-recursive read missed it entirely — the application's core, absent from its own API
 * document, which is exactly the class of silent gap this generator exists to close.
 *
 * `authenticate` is applied to the router in this codebase (a `router.use(authenticate)` line), so a
 * route is authenticated unless its file says otherwise — which is what the `authenticated` flag here
 * records, honestly, rather than assuming.
 */
function routeFiles(dir = ROUTES_DIR, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...routeFiles(join(dir, entry.name), relative));
    else if (entry.name.endsWith(".ts")) found.push(relative);
  }
  return found;
}

function inventory(permissions, mountPoints) {
  const operations = [];
  const unmounted = [];
  for (const file of routeFiles()) {
    const source = read(join(ROUTES_DIR, file));
    const routers = new Set([...source.matchAll(/(\w+Router)\s*=\s*Router\(\)/g)].map(match => match[1]));

    for (const match of source.matchAll(ROUTE_PATTERN)) {
      const [, routerName, method, routePath, , permissionArgs] = match;
      const mount = mountPoints.get(`${file}::${routerName}`);
      if (!mount) {
        // A router nothing imports. Reporting it beats documenting routes that answer nothing.
        if (routers.has(routerName)) unmounted.push(`${file}::${routerName}`);
        continue;
      }
      const authenticated = new RegExp(`${routerName}\\.use\\(authenticate\\)`).test(source);
      const required = [...(permissionArgs || "").matchAll(/Permission\.(\w+)/g)]
        .map(entry => permissions.get(entry[1]) || entry[1]);
      const full = `${mount}${routePath === "/" ? "" : routePath}`.replace(/\/+/g, "/");
      operations.push({
        method: method.toUpperCase(),
        path: full,
        openapiPath: full.replace(/:(\w+)/g, "{$1}"),
        permissions: required,
        authenticated,
        file,
        router: routerName,
        tag: tagFor(mount),
      });
    }
  }
  operations.sort((a, b) => a.path.localeCompare(b.path) || HTTP_METHODS.indexOf(a.method.toLowerCase()) - HTTP_METHODS.indexOf(b.method.toLowerCase()));
  return { operations, unmounted: [...new Set(unmounted)].sort() };
}

/** The tag an operation carries: the mount's own name, tidied. Exported for the guard. */
export function tagFor(mount) {
  const leaf = mount.replace(/^\/api\/?/, "") || "root";
  const known = {
    "api-keys": "API keys",
    "alert-webhooks": "Webhooks",
    "email-connectors": "Email connectors",
    "outlook-addin": "Outlook add-in",
    "service-alerts": "Service alerts",
    "ai-actions": "AI actions",
    "sso": "Single sign-on",
    "kb": "Knowledge base",
    "crm": "CRM",
  };
  if (known[leaf]) return known[leaf];
  return leaf.split(/[-_/]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function curated() {
  try { return JSON.parse(read(CURATED)); } catch { return {}; }
}

/** A summary for an operation nobody has written one for — honest, and better than nothing. */
function derivedSummary(operation) {
  const verb = { GET: "Read", POST: "Create or act on", PUT: "Replace", PATCH: "Update", DELETE: "Remove" }[operation.method];
  const tail = operation.openapiPath.replace(/^\/api\//, "").replace(/\{[^}]+\}/g, "the one named");
  return `${verb} ${tail}`.replace(/\s+/g, " ").trim();
}

// ── Emitting YAML ───────────────────────────────────────────────────────────
// Only scalars need care, and JSON strings are valid YAML double-quoted scalars, so every string
// goes through JSON.stringify and every small structure is emitted in flow style. That is a
// deliberate trade: a general YAML writer is a dependency and a source of bugs, and this document
// only ever contains maps, sequences and scalars.

const q = value => JSON.stringify(String(value));
const flow = value => JSON.stringify(value);

/**
 * One operation per method+path, with the ones that lose named.
 *
 * Two declarations of the same method on the same path means the second never runs — Express answers
 * with the first — so it is dropped rather than emitted twice: YAML keeps the last of two identical
 * keys, and the document would have described a route that answers nothing.
 */
function dedupe(operations) {
  const claimed = new Set();
  const unique = [];
  const shadowed = [];
  for (const operation of operations) {
    const key = `${operation.method} ${operation.openapiPath}`;
    if (claimed.has(key)) { shadowed.push(`${operation.method} ${operation.path} (${operation.file})`); continue; }
    claimed.add(key);
    unique.push(operation);
  }
  return { operations: unique, shadowed: [...new Set(shadowed)] };
}

function buildDocument(operations, curatedEntries, shadowed) {
  const lines = [];
  const push = (...text) => lines.push(...text);

  push(
    `# Generated by scripts/generate-openapi.mjs — do not edit.`,
    `# Curated summaries live in docs/api-operations.json; the prose guide is docs/API.md.`,
    `openapi: "3.1.0"`,
    `info:`,
    `  title: "C7NTAX API"`,
    `  version: "2.0.0"`,
    `  description: ${q("The C7NTAX API: tickets, clients, billing, the event gateway other systems send to, and the connectors this application reads from. Every operation here is generated from the routes the API declares, so the document and the application cannot disagree.")}`,
    `  contact: { name: "Cyber 7 Group", email: "support@cyber7group.com" }`,
    `  license: { name: "Proprietary" }`,
    `servers:`,
    `  - url: "https://your-c7ntax-host/api"`,
    `    description: "A deployment. Replace the host with the one you run."`,
    `  - url: "http://localhost:4000/api"`,
    `    description: "Local development"`,
    `security:`,
    `  - bearerAuth: []`,
    ``,
    `# Two credentials are accepted on the same header: a session token from POST /api/auth/login,`,
    `# and an API key (c7k_…) issued from POST /api/api-keys for a program. See docs/API.md.`,
    `tags:`,
  );

  const tags = [...new Set(operations.map(operation => operation.tag))].sort();
  for (const tag of tags) {
    const count = operations.filter(operation => operation.tag === tag).length;
    push(`  - name: ${q(tag)}`, `    description: ${q(`${count} operation${count === 1 ? "" : "s"}`)}`);
  }

  push(``, `paths:`);
  let documented = 0;
  /*
   * Grouped by path: a key may only appear once in a YAML map, so a path with both a GET and a POST
   * has to be written as one entry with two methods. Emitting it inside the per-operation loop wrote
   * the key twice and a parser silently kept the last one.
   */
  const byPath = new Map();
  for (const operation of operations) {
    byPath.set(operation.openapiPath, [...(byPath.get(operation.openapiPath) || []), operation]);
  }

  for (const [openapiPath, onPath] of byPath) {
    push(`  ${q(openapiPath)}:`);
    for (const operation of onPath) {
      const entry = curatedEntries[`${operation.method} ${operation.path}`] || {};
      if (entry.summary) documented++;
      push(`    ${operation.method.toLowerCase()}:`);
      push(`      tags: [${q(operation.tag)}]`);
      push(`      operationId: ${q(operationId(operation))}`);
      push(`      summary: ${q(entry.summary || derivedSummary(operation))}`);
      if (entry.description) push(`      description: ${q(entry.description)}`);
      if (entry.requestExample) {
        push(`      requestBody:`, `        content:`, `          application/json:`, `            example: ${flow(entry.requestExample)}`);
      }
      push(`      security: [{ "bearerAuth": [] }]`);
      if (operation.permissions.length === 0) {
        push(`      x-required-permissions: []`, `      x-permission-note: ${q(operation.authenticated ? "No permission is required beyond being signed in." : "Reachable before a session exists.")}`);
      } else {
        push(`      x-required-permissions: [${operation.permissions.map(q).join(", ")}]`);
      }
      push(`      x-source: ${q(`${operation.file} · ${operation.router}.${operation.method.toLowerCase()}`)}`);
      const parameters = [...operation.openapiPath.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      if (parameters.length > 0) {
        push(`      parameters:`);
        for (const name of parameters) {
          push(`        - name: ${q(name)}`, `          in: path`, `          required: true`, `          schema: { type: "string" }`);
        }
      }
      push(`      responses:`);
      if (entry.responseExample) {
        push(`        "200":`, `          description: "OK"`, `          content:`, `            application/json:`, `              example: ${flow(entry.responseExample)}`);
      } else {
        push(`        "200": { description: "OK" }`);
      }
      push(`        "400": { $ref: "#/components/responses/BadRequest" }`);
      push(`        "401": { $ref: "#/components/responses/Unauthorized" }`);
      push(`        "403": { $ref: "#/components/responses/Forbidden" }`);
      push(`        "429": { $ref: "#/components/responses/TooManyRequests" }`);
    }
  }

  push(
    ``,
    `components:`,
    `  securitySchemes:`,
    `    bearerAuth:`,
    `      type: http`,
    `      scheme: bearer`,
    `      description: ${q("A session token from POST /api/auth/login, or an API key (c7k_…) from POST /api/api-keys. Both are sent as `Authorization: Bearer …`; an API key is limited to the scopes it was issued with, intersected with the permissions of the account it acts as.")}`,
    `  responses:`,
    `    BadRequest:`,
    `      description: "The request was understood and refused."`,
    `      content:`,
    `        application/json:`,
    `          schema: { $ref: "#/components/schemas/Error" }`,
    `    Unauthorized:`,
    `      description: "No usable credential — missing, expired, revoked, or the account is deactivated."`,
    `      content:`,
    `        application/json:`,
    `          schema: { $ref: "#/components/schemas/Error" }`,
    `    Forbidden:`,
    `      description: "Authenticated, but the credential does not hold the permission this operation requires."`,
    `      content:`,
    `        application/json:`,
    `          schema: { $ref: "#/components/schemas/Error" }`,
    `    TooManyRequests:`,
    `      description: "Rate limited. Retry after the window; see docs/API.md."`,
    `  schemas:`,
    `    Error:`,
    `      type: object`,
    `      description: ${q("Errors are either a string or an object with message/code. Read `message` when it is present.")}`,
    `      properties:`,
    `        error:`,
    `          oneOf:`,
    `            - type: string`,
    `            - type: object`,
    `              properties:`,
    `                message: { type: string }`,
    `                code: { type: string }`,
    `    Event:`,
    `      type: object`,
    `      description: ${q("What POST /api/events accepts. Idempotent by (source, externalId).")}`,
    `      required: [source, externalId, title]`,
    `      properties:`,
    `        source: { type: string, description: "Who is sending: rmm, siem, monitoring, or any name of your own." }`,
    `        externalId: { type: string, description: "The sender's own id for this event. A repeat attaches to the ticket the first one opened." }`,
    `        kind: { type: string, default: alert, description: "alert, recovery, detection, or any word of your own. A recovery closes the ticket." }`,
    `        severity: { type: string, enum: [critical, high, medium, low, info], default: info, description: "Sets the ticket's priority." }`,
    `        title: { type: string }`,
    `        description: { type: string }`,
    `        client:`,
    `          type: object`,
    `          description: ${q("companyId, or name when exactly one client carries it.")}`,
    `          properties:`,
    `            companyId: { type: string }`,
    `            name: { type: string }`,
    `        boardId: { type: string, description: "Which board the ticket goes on. Defaults to the configured intake board." }`,
    `        ticketId: { type: string, description: "Append to this ticket instead of deciding from externalId." }`,
    `        occurredAt: { type: string, format: date-time }`,
    `        data: { type: object, description: "Kept as it arrived, on the ticket." }`,
    ``,
    `# ${documented} of ${operations.length} operations carry a curated summary from docs/api-operations.json;`,
    `# the rest are described from their own path, which is still enough to call them correctly.`,
  );

  return { document: lines.join("\n") + "\n", documented };
}

function operationId(operation) {
  const clean = operation.path
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean)
    .map(part => part.replace(/^:/, "by ").replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : "")))
    .join(" ");
  const verb = { GET: "get", POST: "post", PUT: "put", PATCH: "patch", DELETE: "delete" }[operation.method];
  return `${verb}${clean.replace(/^./, c => c.toUpperCase()).replace(/\s+/g, "")}`;
}

// ── Run ─────────────────────────────────────────────────────────────────────

export function generate() {
  const { operations, unmounted } = inventory(permissionValues(), mounts());
  const { operations: documentedOperations, shadowed } = dedupe(operations);
  const { document, documented } = buildDocument(documentedOperations, curated(), shadowed);
  return { operations: documentedOperations, unmounted, document, documented, emitted: documentedOperations.length, shadowed };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/generate-openapi.mjs");
if (isMain) {
  const check = process.argv.includes("--check");
  const { unmounted, document, documented, emitted, shadowed } = generate();
  const existing = (() => { try { return read(OUT); } catch { return ""; } })();
  const notes = [];
  if (unmounted.length) notes.push(`declared but never mounted (not documented): ${unmounted.join(", ")}`);
  if (shadowed.length) notes.push(`two routes claim the same method and path, so only the first one answers: ${shadowed.join(", ")}`);
  if (check) {
    if (existing !== document) {
      console.error("docs/openapi.yaml is out of date — run: node scripts/generate-openapi.mjs");
      process.exit(1);
    }
    console.log(`openapi: up to date — ${emitted} operations, ${documented} with curated summaries`);
  } else {
    writeFileSync(OUT, document);
    console.log(`openapi: wrote ${emitted} operations to docs/openapi.yaml (${documented} curated summaries)`);
  }
  for (const note of notes) console.log(`         note: ${note}`);
}
