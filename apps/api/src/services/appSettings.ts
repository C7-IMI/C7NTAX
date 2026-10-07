/**
 * Runtime application settings.
 *
 * Every configurable value in the product resolves the same way: the stored setting wins, then
 * the environment variable the setting stands in for, then the declared default. This service
 * owns that order.
 *
 * Why a cache rather than a query per read: the settings are consulted from hot paths — the
 * alert poll, the portal's sign-in, every middleware that gates a feature — and a flag that
 * costs a round trip is a flag that ends up read once at boot instead. So the whole set is held
 * in memory, refreshed on a timer, and refreshed immediately whenever an administrator saves.
 *
 * Why the environment still matters: before this existed, each feature was switched on by an
 * environment variable read at process start. Deployments that were configured that way must
 * keep behaving identically, so `resolveEnvironmentValue` reproduces each flag's original test
 * exactly — including whether it shipped on or off. The probe suite asserts that equivalence.
 *
 * A consequence worth stating plainly: while the snapshot is still loading (or if the database
 * is unreachable) every accessor answers with the environment-derived value, which is precisely
 * what the application did before. A failed refresh can never switch a feature off.
 */
import {
  CONFIG_SECTIONS,
  CONFIG_SECTION_BY_ID,
  CONFIG_STORE_KEYS,
  coerceConfigValue,
  configSectionKey,
  findConfigField,
  resolveEnvironmentValue,
  type ConfigFieldSpec,
  type ConfigSectionValue,
} from "@C7NTAX/shared";
import { logger } from "./logger";

type SettingValue = boolean | number | string;

/** Rows loaded from `SystemConfig`: `config:<section>` plus the three legacy keys. */
const storedSections = new Map<string, ConfigSectionValue>();
let loaded = false;
let loading: Promise<void> | null = null;
let lastLoadedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

/** How long a snapshot is trusted when nothing has written to it. */
const REFRESH_INTERVAL_MS = 30_000;

/** The legacy rows this registry also reads, so nothing had to be migrated. */
const LEGACY_KEYS = Object.values(CONFIG_STORE_KEYS);

function parseStoredValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Reads a dotted path out of a stored value, for the fields stored inside a shared row. */
function readPath(row: unknown, path: string): unknown {
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * The stored value for a field, or `undefined` when the setting has never been saved.
 *
 * A field may live in its section's own row (the normal case), or name an explicit address —
 * the idle timeout is the bare `session_timeout` row, and the right-click menu preference is
 * nested inside `app_settings`.
 */
function storedValueFor(field: ConfigFieldSpec, sectionId: string): unknown {
  const address = field.store;
  if (!address || !address.key) return storedSections.get(configSectionKey(sectionId))?.[field.id];

  const row = storedSections.get(address.key);
  if (row === undefined || row === null) return undefined;
  if (address.scalar) return row;
  return readPath(row, address.path ?? field.id);
}

/** Loads (or reloads) the snapshot. Safe to call concurrently; the extra callers join in. */
export async function refreshSettings(force = false): Promise<void> {
  if (loading) return loading;
  if (!force && loaded && Date.now() - lastLoadedAt < REFRESH_INTERVAL_MS) return;

  loading = (async () => {
    try {
      // Imported lazily: `index.ts` imports the routes, which import this module, so a
      // top-level import of `prisma` here would be read before it is assigned.
      const { prisma } = await import("../index");
      const keys = [...CONFIG_SECTIONS.map(s => configSectionKey(s.id)), ...LEGACY_KEYS];
      const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
      const next = new Map<string, ConfigSectionValue>();
      for (const row of rows) next.set(row.key, parseStoredValue(row.value) as ConfigSectionValue);
      storedSections.clear();
      for (const [key, value] of next) storedSections.set(key, value);
      loaded = true;
      lastLoadedAt = Date.now();
    } catch (error) {
      // Keep whatever was loaded before: a database blip must not silently switch features off.
      logger.warn("settings.refresh", "Could not refresh application settings; keeping the previous snapshot", {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Refreshes the snapshot on a timer, so a change made on another instance is picked up. */
export function startSettingsRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { void refreshSettings(true); }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

/** Drops the snapshot without reloading it — used by the probe suite between phases. */
export function resetSettingsCache(): void {
  storedSections.clear();
  loaded = false;
  lastLoadedAt = 0;
}

/**
 * Resolves one field. The synchrony is the point: call sites are guards and checks that cannot
 * await, and the answer has to be as cheap as the `process.env` read it replaced.
 */
export function configValue(sectionId: string, fieldId: string): SettingValue {
  const field = findConfigField(sectionId, fieldId);
  if (!field) return "";
  const stored = storedValueFor(field, sectionId);
  if (stored !== undefined && stored !== null && stored !== "") {
    const coerced = coerceConfigValue(field, stored);
    if (coerced.ok) return coerced.value;
  }
  return resolveEnvironmentValue(field, process.env as Record<string, string | undefined>);
}

/** A boolean setting, failing closed to the declared default if the field does not exist. */
export function configFlag(sectionId: string, fieldId: string): boolean {
  const value = configValue(sectionId, fieldId);
  if (typeof value === "boolean") return value;
  return value === "true" || value === 1;
}

/** A numeric setting, falling back to the declared default if the field does not exist. */
export function configNumber(sectionId: string, fieldId: string, fallback = 0): number {
  const value = configValue(sectionId, fieldId);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A text setting. */
export function configText(sectionId: string, fieldId: string): string {
  const value = configValue(sectionId, fieldId);
  return value === undefined || value === null ? "" : String(value);
}

/** The saved value for a field, or `undefined` when nothing has ever been saved. */
export function savedValue(sectionId: string, fieldId: string): unknown {
  const field = findConfigField(sectionId, fieldId);
  if (!field) return undefined;
  const value = storedValueFor(field, sectionId);
  return value === null ? undefined : value;
}

/** Everything stored for one section, for the configuration screen. */
export function storedSectionValues(sectionId: string): ConfigSectionValue {
  return { ...(storedSections.get(configSectionKey(sectionId)) ?? {}) };
}

/** Whether the snapshot has ever been loaded, so a screen can say "not yet read". */
export function settingsLoaded(): boolean {
  return loaded;
}

/**
 * The environment value for a field, whether or not a setting overrides it. The screen shows
 * this so an operator can see the deployment's own opinion behind the effective value.
 */
export function environmentValue(sectionId: string, fieldId: string): unknown {
  const field = findConfigField(sectionId, fieldId);
  if (!field) return undefined;
  if (field.secret) return undefined;
  const env = process.env as Record<string, string | undefined>;
  if (!field.env || env[field.env] === undefined || env[field.env] === "") return undefined;
  return resolveEnvironmentValue(field, env);
}

/** The value a field resolves to when nothing is stored — its environment or declared default. */
export function fallbackValue(sectionId: string, fieldId: string): SettingValue {
  const field = findConfigField(sectionId, fieldId);
  if (!field) return "";
  return resolveEnvironmentValue(field, process.env as Record<string, string | undefined>);
}

/** Whether the environment supplies this field (so the screen can explain where it comes from). */
export function environmentSupplied(field: ConfigFieldSpec): boolean {
  if (!field.env) return false;
  const value = (process.env as Record<string, string | undefined>)[field.env];
  return value !== undefined && value !== "";
}

/**
 * Writes one setting, validating it against the registry first.
 *
 * Writes are a read-modify-write so a field stored at a path inside a shared row keeps the
 * row's other contents — `app_settings` holds more than the one value this registry shows,
 * and `default_landing_page` holds a label beside the path.
 */
export async function writeConfigValue(
  sectionId: string,
  fieldId: string,
  input: unknown,
): Promise<{ ok: true; value: SettingValue } | { ok: false; message: string }> {
  const section = CONFIG_SECTION_BY_ID[sectionId];
  const field = findConfigField(sectionId, fieldId);
  if (!section || !field) return { ok: false, message: "Unknown setting" };

  const coerced = coerceConfigValue(field, input);
  if (!coerced.ok) return coerced;

  const { prisma } = await import("../index");
  const address = field.store;
  const key = address?.key ?? configSectionKey(sectionId);

  try {
    if (!address?.key) {
      const current = storedSectionValues(sectionId);
      current[field.id] = coerced.value;
      await prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: JSON.stringify(current) },
        update: { value: JSON.stringify(current) },
      });
    } else {
      const row = await prisma.systemConfig.findUnique({ where: { key } });
      const parsed = row ? parseStoredValue(row.value) : undefined;

      if (address.scalar) {
        const encoded = JSON.stringify(coerced.value);
        await prisma.systemConfig.upsert({
          where: { key },
          create: { key, value: encoded },
          update: { value: encoded },
        });
      } else {
        const path = (address.path ?? field.id).split(".");
        const leaf = path[path.length - 1];
        if (!leaf) return { ok: false, message: "That setting has no storage address" };
        const base: Record<string, unknown> =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
        let cursor: Record<string, unknown> = base;
        for (const part of path.slice(0, -1)) {
          const step = cursor[part];
          cursor[part] = step && typeof step === "object" && !Array.isArray(step) ? { ...(step as Record<string, unknown>) } : {};
          cursor = cursor[part] as Record<string, unknown>;
        }
        cursor[leaf] = coerced.value;
        const encoded = JSON.stringify(base);
        await prisma.systemConfig.upsert({
          where: { key },
          create: { key, value: encoded },
          update: { value: encoded },
        });
      }
    }
  } catch (error) {
    logger.error("settings.write", error instanceof Error ? error : new Error(String(error)), { sectionId, fieldId });
    return { ok: false, message: "The setting could not be saved" };
  }

  await refreshSettings(true);
  return { ok: true, value: coerced.value };
}

/**
 * Clears a stored setting, so the field falls back to the deployment's own value.
 *
 * The counterpart to saving, and the reason the UI can offer "use the deployment's value": a
 * setting that can only be overwritten can never be got back to what the deployment intended.
 * For a field stored at a path inside a shared row, only that path is removed — `app_settings`
 * holds more than the one value this registry shows.
 */
export async function clearConfigValue(
  sectionId: string,
  fieldId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const field = findConfigField(sectionId, fieldId);
  if (!field) return { ok: false, message: "Unknown setting" };
  if (field.source !== "setting" || field.locked) {
    return { ok: false, message: "That setting is managed by the deployment and cannot be changed here" };
  }

  const { prisma } = await import("../index");
  const address = field.store;
  const key = address?.key ?? configSectionKey(sectionId);

  try {
    if (!address?.key) {
      const current = storedSectionValues(sectionId);
      delete current[field.id];
      if (Object.keys(current).length === 0) {
        await prisma.systemConfig.deleteMany({ where: { key } });
      } else {
        await prisma.systemConfig.update({ where: { key }, data: { value: JSON.stringify(current) } });
      }
    } else if (address.scalar) {
      await prisma.systemConfig.deleteMany({ where: { key } });
    } else {
      const row = await prisma.systemConfig.findUnique({ where: { key } });
      const parsed = row ? parseStoredValue(row.value) : undefined;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const base = { ...(parsed as Record<string, unknown>) };
        const path = (address.path ?? field.id).split(".");
        let cursor: Record<string, unknown> | undefined = base;
        for (const part of path.slice(0, -1)) {
          const step = cursor?.[part];
          cursor = step && typeof step === "object" && !Array.isArray(step) ? (step as Record<string, unknown>) : undefined;
        }
        if (cursor) delete cursor[path[path.length - 1]];
        await prisma.systemConfig.update({ where: { key }, data: { value: JSON.stringify(base) } });
      }
    }
  } catch (error) {
    logger.error("settings.clear", error instanceof Error ? error : new Error(String(error)), { sectionId, fieldId });
    return { ok: false, message: "The setting could not be cleared" };
  }

  await refreshSettings(true);
  return { ok: true };
}

/**
 * Field ids the configuration route may write, so the router can reject an unknown key before
 * touching the database. Because a field names its own storage address, this list is also what
 * makes the shared configuration plausible: only addresses declared in the registry are
 * reachable, and no request can name an arbitrary `SystemConfig` key through it.
 */
export function isWritableConfigField(sectionId: string, fieldId: string): boolean {
  const field = findConfigField(sectionId, fieldId);
  return !!field && field.source === "setting" && !field.locked;
}
