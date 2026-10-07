#!/usr/bin/env node
/**
 * Route-guard lint.
 *
 * PLAN-018's root cause was not a missing permission — it was thirteen routers that
 * imported `requirePermission` and never called it, with nothing in the build to
 * notice. This walks every route declaration and fails when a route is reachable by
 * any signed-in account without a permission check, unless the route is on the
 * exemption list below with a reason.
 *
 * Run directly (`node scripts/check-route-guards.mjs`) or wire it into CI next to the
 * typecheck. Exits 1 on any violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_DIR = join(process.cwd(), "apps", "api", "src", "routes");

/**
 * Routes that are deliberately open, and why. Everything else must carry a
 * `requirePermission(...)`, which is what the check enforces.
 */
const EXEMPTIONS = [
  // Credential handling happens before a session exists.
  { file: "auth.ts", match: /.*/, reason: "sign-in, MFA, passkey and password routes run before a session exists" },
  { file: "webauthn.ts", match: /.*/, reason: "passkey registration and sign-in; registration still requires a session and identifies the user from the token" },
  { file: "ssoExchange.ts", match: /.*/, reason: "OIDC start/callback, validated with a single-use state" },
  // A user's own device subscriptions — no permission applies.
  { file: "push.ts", match: /.*/, reason: "per-device push subscriptions for the signed-in user" },
  {
    file: "dashboard.ts",
    match: /.*/,
    reason: "the signed-in user's own dashboard layout; there is no id in the path, the row is keyed to the caller, and the widget catalogue is filtered by their permissions",
  },
  { file: "users.ts", match: /GET \/me$/, reason: "a user reading their own record" },
  {
    file: "system.ts",
    match: /(GET|PATCH) \/config\/:key$|GET \/changelog$|GET \/audit-logs$/,
    reason: "self-service settings keys (guarded per key), What's New, and the audit trail the ticket view reads — see PLAN-018 Phase 0",
  },
  { file: "email-connectors.ts", match: /GET \/oauth\/callback$/, reason: "OAuth callback for the connector, validated with single-use state" },
  { file: "tenants.ts", match: /.*/, reason: "multi-tenant stubs — PLAN-003 is deferred by decision" },
];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(full);
  }
};
walk(ROUTES_DIR);

/** Middleware between the path and the handler: `router.get("/x", authenticate, handler)`. */
function middlewareFor(source, afterPath) {
  const handlerAt = source.slice(afterPath).search(/\basync\b|=>|\bfunction\b/);
  if (handlerAt === -1) return "";
  return source.slice(afterPath, afterPath + handlerAt);
}

const routePattern = /\b([A-Za-z]\w*)\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g;
const violations = [];
const publicRoutes = [];
let routes = 0;
let guarded = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const name = relative(ROUTES_DIR, file).replace(/\\/g, "/");
  const routerUsesAuth = /\.use\(authenticate\)|authenticate\s*,/.test(source);
  const routerUsesPermission = /requirePermission\(/.test(source);

  for (const match of source.matchAll(routePattern)) {
    const [, router, method, path] = match;
    // Only routers mounted with auth are in scope; helpers and unrelated calls are skipped.
    if (!router.endsWith("Router")) continue;
    routes++;
    const middleware = middlewareFor(source, match.index + match[0].length);
    const hasPermission = /requirePermission\(/.test(middleware);
    const hasAuth = /authenticate/.test(middleware) || routerUsesAuth;
    const label = `${method.toUpperCase()} ${path}`;
    if (hasPermission) { guarded++; continue; }
    const exempt = EXEMPTIONS.find(e => e.file === name && e.match.test(label));
    if (exempt) continue;
    if (!hasAuth && !routerUsesPermission) { publicRoutes.push(`${name} — ${label}`); continue; }
    violations.push(`${name} — ${label} is reachable by any signed-in account`);
  }
}

console.log(`route-guard check: ${routes} routes, ${guarded} carry a permission`);
if (publicRoutes.length) {
  console.log(`\n${publicRoutes.length} route(s) have neither auth nor a permission — confirm these are intentional:`);
  for (const r of publicRoutes) console.log(`  ? ${r}`);
}
if (violations.length) {
  console.error(`\n${violations.length} route(s) without a permission guard:`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error("\nAdd requirePermission(Permission.X), or add the route to EXEMPTIONS in this script with a reason.");
  process.exit(1);
}
console.log("every authenticated route has a permission guard (or a documented exemption)");
