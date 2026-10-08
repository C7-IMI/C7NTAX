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
 * A guard written the other way — `const MANAGE = requirePermission(Permission.X)` and
 * `router.get("/x", MANAGE, handler)` — is the same protection stated once, and is recognised
 * here by *resolving the name to its declaration* rather than by trusting it (§`permissionNames`).
 * Reading only for an inline call made this check wrong about four guarded routes in `sso.ts`.
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
  {
    file: "nav.ts",
    match: /.*/,
    reason: "the signed-in user's own navigation pins — the dashboard's decision applied to the sidebar; there is no id in the path, every row is keyed to the caller, and the list is normalised rather than trusted",
  },
  { file: "users.ts", match: /GET \/me$/, reason: "a user reading their own record" },
  {
    file: "system.ts",
    match: /(GET|PATCH) \/config\/:key$|GET \/changelog$|GET \/audit-logs$/,
    reason: "self-service settings keys (guarded per key), What's New, and the audit trail the ticket view reads — see PLAN-018 Phase 0",
  },
  { file: "email-connectors.ts", match: /GET \/oauth\/callback$/, reason: "OAuth callback for the connector, validated with single-use state" },
  {
    file: "portal.ts",
    match: /.*/,
    reason: "the customer portal signs in a Contact with an emailed one-time code and its own cookie; a Contact is not a staff User and holds no permissions, so every route carries `requirePortalSession`/`requirePortalWrite` and scopes reads to the contact's own tickets",
  },
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

/**
 * Names in this file that are a permission guard, provably.
 *
 * A route file that guards a family of routes with one line —
 * `const MANAGE = requirePermission(Permission.SecurityManage)` — is stating the permission once
 * rather than fifteen times, and this check has to follow it or it reports a guarded route as
 * unguarded. Only a **provable** resolution counts:
 *
 *   · the name is declared in the same file, assigned an expression containing `requirePermission(`;
 *   · and nothing else in the file reassigns it (a `let` that is reassigned is not a guarantee);
 *   · and it is used as a whole argument, not as part of a longer identifier.
 *
 * A name that cannot be resolved is *not* proof and the route keeps failing — accepting a middleware
 * on trust is the one thing this check must never do, since it is the check that notices a router
 * with no guard at all. The limit worth knowing: a name shadowed inside a nested scope would be
 * accepted, because this reads the flat source the routes are declared in, as the routes are.
 */
function permissionNames(source) {
  const names = new Set();
  const declarations = /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=;\n]+)?=[ \t]*([^;]*);/g;
  for (const match of source.matchAll(declarations)) {
    if (/requirePermission\s*\(/.test(match[2])) names.add(match[1]);
  }
  // One assignment is the declaration; anything more means the name is not a constant guarantee.
  for (const name of [...names]) {
    const assignments = source.match(new RegExp(`(?:^|[^\\w$.])${name}[ \\t]*=(?!=)`, "g"));
    if (!assignments || assignments.length > 1) names.delete(name);
  }
  return names;
}

/** Which of those names appear in this text — as a whole argument, not as part of a longer name. */
function namedPermissionsIn(text, names) {
  const found = [];
  for (const name of names) {
    if (new RegExp(`(?:^|[^\\w$.])${name}(?![\\w$])`).test(text)) found.push(name);
  }
  return found;
}

const routePattern = /\b([A-Za-z]\w*)\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g;
/** Every `router.use(...)` argument list, for the file-wide guard check below. */
const usePattern = /\.use\(([^)]*)\)/g;
const violations = [];
const publicRoutes = [];
const namedGuards = new Set();
const namedConstantNames = new Set();
let routes = 0;
let guarded = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const name = relative(ROUTES_DIR, file).replace(/\\/g, "/");
  const permissionNamesInFile = permissionNames(source);
  const routerUsesAuth = /\.use\(authenticate\)|authenticate\s*,/.test(source);
  const mountedMiddleware = [...source.matchAll(usePattern)].map(m => m[1]).join(",");
  const routerUsesPermission =
    /requirePermission\(/.test(source) || namedPermissionsIn(mountedMiddleware, permissionNamesInFile).length > 0;

  for (const match of source.matchAll(routePattern)) {
    const [, router, method, path] = match;
    // Only routers mounted with auth are in scope; helpers and unrelated calls are skipped.
    if (!router.endsWith("Router")) continue;
    routes++;
    const middleware = middlewareFor(source, match.index + match[0].length);
    const inline = /requirePermission\(/.test(middleware);
    const named = inline ? [] : namedPermissionsIn(middleware, permissionNamesInFile);
    const label = `${method.toUpperCase()} ${path}`;
    if (inline || named.length) {
      guarded++;
      if (named.length) {
        for (const constant of named) {
          namedGuards.add(`${name} — ${constant} guards ${label}`);
          namedConstantNames.add(constant);
        }
      }
      continue;
    }
    const hasAuth = /authenticate/.test(middleware) || routerUsesAuth;
    const exempt = EXEMPTIONS.find(e => e.file === name && e.match.test(label));
    if (exempt) continue;
    if (!hasAuth && !routerUsesPermission) { publicRoutes.push(`${name} — ${label}`); continue; }
    violations.push(`${name} — ${label} is reachable by any signed-in account`);
  }
}

const namedSummary = namedGuards.size
  ? ` (${namedGuards.size} through a named constant: ${[...namedConstantNames].join(", ")})`
  : "";
console.log(`route-guard check: ${routes} routes, ${guarded} carry a permission${namedSummary}`);
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
