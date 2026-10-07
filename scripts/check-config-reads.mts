/**
 * Every `configFlag("area", "field")` read must name a field the registry declares.
 *
 * A stale pair does not throw. `configValue` answers `""` for a field it cannot find, and every
 * reader treats that as "off" — so a feature whose field moved areas fails closed, silently, while
 * every screen still reports it as switched on. That happened: `outlookAddin` moved from
 * `integrations` to `apps`, `routes/outlookAddin.ts` kept reading the old area, and
 * `POST /api/outlook-addin/tickets` answered 404 "Outlook add-in disabled" for every request.
 *
 * The registry is the authority, and this is the only check that reads it rather than restating it,
 * which is why it runs through `tsx`: `packages/shared` is TypeScript source with extensionless
 * relative imports, so plain `node` cannot load it.
 *
 * Run with: node scripts/check-config-reads.mts  (or `pnpm guard:config`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FIELDS } from "../packages/shared/src/appConfiguration.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.ts` under a directory, skipping dependencies and build output. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "snapshots") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = [
  ...sourceFiles(path.join(root, "apps/api/src")),
  ...sourceFiles(path.join(root, "packages/shared/src")),
];

/** One entry per distinct pair, with the first file that reads it. */
const reads = new Map<string, string>();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/config(?:Flag|Text|Number)\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)) {
    const key = `${match[1]}.${match[2]}`;
    if (!reads.has(key)) reads.set(key, path.relative(root, file).replace(/\\/g, "/"));
  }
}

const stale = [...reads].filter(([key]) => !CONFIG_FIELDS[key]);

if (stale.length) {
  console.error("config-read check: a read names a field the registry does not declare.\n");
  for (const [key, file] of stale) {
    console.error(`  ${key}   read by ${file}`);
    // The near-miss is almost always the field having moved or been renamed in another area.
    const fieldId = key.split(".")[1];
    const elsewhere = Object.keys(CONFIG_FIELDS).filter((k) => k.endsWith(`.${fieldId}`));
    if (elsewhere.length) console.error(`    → declared as ${elsewhere.join(", ")}`);
  }
  console.error(
    `\n${reads.size} reads checked, ${stale.length} stale. ` +
      "A stale read returns \"\" and fails closed, so the feature it gates is off with no error."
  );
  process.exit(1);
}

console.log(
  `config-read check: ${reads.size} config reads across ${files.length} files, all naming a declared field`
);
