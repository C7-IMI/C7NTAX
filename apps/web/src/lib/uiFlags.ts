/**
 * UI modernization kill switches (see UI-P1-ROLLBACK.md).
 *
 * Instant rollback (no rebuild, no code changes) — browser console, then reload:
 *   localStorage.setItem("c7_ui_p1", "0"); location.reload()   // disable P1
 *   localStorage.setItem("c7_ui_p2", "0"); location.reload()   // disable P2
 *   localStorage.setItem("c7_ui_kumo_orgs", "0"); location.reload() // disable Kumo Organizations
 *   localStorage.setItem("c7_ui_kumo_types", "0"); location.reload() // disable the organization type rail
 *   localStorage.removeItem("c7_ui_p1");   location.reload()   // back to default
 * Or the window.c7UiP1 / window.c7UiP2 helpers, or the command palette actions.
 *
 * Deployment-wide rollback: set VITE_UI_P1=false / VITE_UI_P2=false (e.g. in
 * apps/web/.env.local) and restart the web server; or run
 * scripts/rollback-ui-p1.ps1 -Part P1|P2|All.
 */
type FlagStorageKey = "c7_ui_p1" | "c7_ui_p2" | "c7_ui_palette" | "c7_ui_kumo_orgs" | "c7_ui_kumo_types";

const UI_P1_STORAGE_KEY: FlagStorageKey = "c7_ui_p1";
const UI_P2_STORAGE_KEY: FlagStorageKey = "c7_ui_p2";
const UI_PALETTE_STORAGE_KEY: FlagStorageKey = "c7_ui_palette";
const UI_KUMO_ORGS_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_orgs";
const UI_KUMO_TYPES_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_types";

function readFlag(key: FlagStorageKey, envName: string): boolean {
  try {
    const override = localStorage.getItem(key);
    if (override === "0") return false;
    if (override === "1") return true;
  } catch {
    /* localStorage unavailable — fall through to the build default */
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[envName] !== "false";
}

function writeFlag(key: FlagStorageKey, enabled: boolean): void {
  try {
    localStorage.setItem(key, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** P1: command palette, density toggle, nav accents (default: on). */
export const UI_P1 = readFlag(UI_P1_STORAGE_KEY, "VITE_UI_P1");

/** P2: elevation, typography, sticky tables, content width (default: on). */
export const UI_P2 = readFlag(UI_P2_STORAGE_KEY, "VITE_UI_P2");

/** Colour schemes: the palette picker in the header toolbar (default: on). */
export const UI_PALETTE = readFlag(UI_PALETTE_STORAGE_KEY, "VITE_UI_PALETTE");

/** Kumo → Organizations: the client list with its Kumo documentation coverage (default: on). */
export const UI_KUMO_ORGS = readFlag(UI_KUMO_ORGS_STORAGE_KEY, "VITE_UI_KUMO_ORGS");

/**
 * Kumo → organization screen: the asset-type rail and its type views (default: on).
 * Off leaves the organization screen exactly as it was before the rail shipped.
 * The rail's standard asset types are separately reversible (db:types-off).
 */
export const UI_KUMO_TYPES = readFlag(UI_KUMO_TYPES_STORAGE_KEY, "VITE_UI_KUMO_TYPES");

export function setUiP1(enabled: boolean): void {
  writeFlag(UI_P1_STORAGE_KEY, enabled);
}

export function setUiP2(enabled: boolean): void {
  writeFlag(UI_P2_STORAGE_KEY, enabled);
}

export function setUiPalette(enabled: boolean): void {
  writeFlag(UI_PALETTE_STORAGE_KEY, enabled);
}

export function setUiKumoOrgs(enabled: boolean): void {
  writeFlag(UI_KUMO_ORGS_STORAGE_KEY, enabled);
}

export function setUiKumoTypes(enabled: boolean): void {
  writeFlag(UI_KUMO_TYPES_STORAGE_KEY, enabled);
}

export { UI_P1_STORAGE_KEY, UI_P2_STORAGE_KEY, UI_PALETTE_STORAGE_KEY, UI_KUMO_ORGS_STORAGE_KEY, UI_KUMO_TYPES_STORAGE_KEY };
