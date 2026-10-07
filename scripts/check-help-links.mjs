/**
 * Help documentation guards.
 *
 * The in-app Help section (apps/web/src/pages/HelpDoc.tsx) is written by hand, so it can rot in two
 * ways that nothing else catches:
 *
 *   1. **A link to a page that no longer exists.** A feature is renamed, a route moves, and a help
 *      link quietly becomes a dead end — the kind of thing nobody notices until a user reports it.
 *   2. **A walkthrough nobody can find.** A section that is not listed in the Index is reachable by
 *      URL and by nothing else, which is the same as not being written.
 *
 * This runs both checks. It reads the source rather than a build, so it is fast enough to be part of
 * any change that touches Help — and it fails the build when documentation and the application
 * disagree, which is the only way the maintenance rule in HelpDoc.tsx stays true.
 *
 *     node scripts/check-help-links.mjs
 */
import { readFileSync } from "node:fs";

const HELP_DOC = "apps/web/src/pages/HelpDoc.tsx";
const HELP_HOME = "apps/web/src/pages/Help.tsx";
const APP = "apps/web/src/App.tsx";

const read = path => readFileSync(path, "utf8");
const helpSource = read(HELP_DOC);
const homeSource = read(HELP_HOME);
const appSource = read(APP);

/** Every route the SPA can serve, straight from the router. */
const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]);
const routeSet = new Set(routes);

/** The walkthrough sections the help file actually defines. */
const walkthroughPaths = [...helpSource.matchAll(/path:\s*"(\/help\/walkthroughs\/[^"]+)"/g)].map(m => m[1]);

/** Every internal link either help file points at. */
const links = [...(helpSource + homeSource).matchAll(/to:\s*"([^"]+)"/g)]
  .map(m => m[1])
  .filter(target => target.startsWith("/"));

// A route may be declared with a parameter (`/tickets/:id`); a link to `/tickets/:id` is what a
// reader should never see, so a link resolves when it matches a declared route or when the declared
// route's shape matches it once the link's own segments are substituted for the placeholders.
const matchesRoute = link => {
  if (routeSet.has(link)) return true;
  const segments = link.split("/");
  return routes.some(route => {
    const parts = route.split("/");
    if (parts.length !== segments.length) return false;
    return parts.every((part, index) => part.startsWith(":") || part === segments[index] || part === "*");
  });
};

const failures = [];
for (const link of new Set(links)) {
  if (matchesRoute(link)) continue;
  failures.push(`dead link: ${link} — no route in ${APP} and no walkthrough section in ${HELP_DOC}`);
}

// Every walkthrough must appear in the "index" section, which is the last core section. The Index
// lists topics as table rows, so a walkthrough is named there by its own path.
const indexStart = helpSource.indexOf('id: "index"');
const walkthroughStart = helpSource.indexOf("WALKTHROUGHS");
const indexSection = walkthroughStart > indexStart && indexStart !== -1
  ? helpSource.slice(indexStart, walkthroughStart)
  : helpSource.slice(indexStart);
for (const path of walkthroughPaths) {
  if (indexSection.includes(path)) continue;
  failures.push(`unlisted walkthrough: ${path} is not in the Index section — a reader cannot find it`);
}

// The help home page is a list of every walkthrough, so a section that is not on it is one nobody
// meets by browsing. It is rendered from the array, so this can only fail if the array is
// restructured — which is exactly when it is worth being told.
if (!/HELP_SECTIONS\.filter\(\(s\) => s\.group === "walkthroughs"\)/.test(homeSource)) {
  failures.push(`the help home page no longer lists every walkthrough — ${HELP_HOME} renders its own list`);
}

console.log(`help-link check: ${routes.length} routes, ${walkthroughPaths.length} walkthroughs, ${new Set(links).size} internal links`);

if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${failures.length} problem(s): documentation and the application disagree.`);
  process.exit(1);
}

console.log("every help link resolves to a real route, and every walkthrough is listed in the Index and on the help home page");
