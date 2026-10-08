/**
 * UI modernization kill switches (see UI-P1-ROLLBACK.md).
 *
 * Instant rollback (no rebuild, no code changes) — browser console, then reload:
 *   localStorage.setItem("c7_ui_p1", "0"); location.reload()   // disable P1
 *   localStorage.setItem("c7_ui_p2", "0"); location.reload()   // disable P2
 *   localStorage.setItem("c7_ui_kumo_orgs", "0"); location.reload() // disable Kumo Organizations
 *   localStorage.setItem("c7_ui_kumo_types", "0"); location.reload() // disable the organization type rail
 *   localStorage.setItem("c7_ui_kumo_crumbs", "0"); location.reload() // disable the Kumo breadcrumb trail
 *   localStorage.setItem("c7_ui_context_menus", "0"); location.reload() // disable the app right-click menus
 *   localStorage.setItem("c7_ui_console", "0"); location.reload() // hide the console
 *   localStorage.setItem("c7_ui_nav", "0"); location.reload() // the classic navigation pane
 *   localStorage.removeItem("c7_ui_p1");   location.reload()   // back to default
 * Or the window.c7UiP1 / window.c7UiP2 helpers, or the command palette actions.
 *
 * The right-click menus are also a system setting (Administration → System
 * Settings → General → "Application right-click menus"), which applies to every
 * user; see CONTEXT-MENUS-ROLLBACK.md.
 *
 * The navigation pane is likewise a system setting (Administration → Configuration
 * → Workspace → "Navigation pane", `appearance.navigationStyle`), and the
 * `c7_ui_nav` flag overrides it for one browser in either direction; see
 * NAV-PANE-ROLLBACK.md.
 *
 * Deployment-wide rollback: set VITE_UI_P1=false / VITE_UI_P2=false (e.g. in
 * apps/web/.env.local) and restart the web server; or run
 * scripts/rollback-ui-p1.ps1 -Part P1|P2|All.
 */
type FlagStorageKey = "c7_ui_p1" | "c7_ui_p2" | "c7_ui_palette" | "c7_ui_kumo_orgs" | "c7_ui_kumo_types" | "c7_ui_kumo_crumbs" | "c7_ui_context_menus" | "c7_ui_console" | "c7_ui_nav";

const UI_P1_STORAGE_KEY: FlagStorageKey = "c7_ui_p1";
const UI_P2_STORAGE_KEY: FlagStorageKey = "c7_ui_p2";
const UI_PALETTE_STORAGE_KEY: FlagStorageKey = "c7_ui_palette";
const UI_KUMO_ORGS_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_orgs";
const UI_KUMO_TYPES_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_types";
const UI_KUMO_BREADCRUMBS_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_crumbs";
const UI_CONTEXT_MENUS_STORAGE_KEY: FlagStorageKey = "c7_ui_context_menus";
const UI_CONSOLE_STORAGE_KEY: FlagStorageKey = "c7_ui_console";
const UI_NAV_STORAGE_KEY: FlagStorageKey = "c7_ui_nav";

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

/**
 * Kumo → the breadcrumb trail and its back button. Shown on Kumo screens only
 * (default: on); off hides both, leaving the rest of the app's header untouched.
 */
export const UI_KUMO_BREADCRUMBS = readFlag(UI_KUMO_BREADCRUMBS_STORAGE_KEY, "VITE_UI_KUMO_BREADCRUMBS");

/**
 * The application-style right-click menu, currently on the Tickets section
 * (default: on). Off restores the browser's own menu everywhere.
 */
export const UI_CONTEXT_MENUS = readFlag(UI_CONTEXT_MENUS_STORAGE_KEY, "VITE_UI_CONTEXT_MENUS");

/**
 * The command console — the header icon and the panel behind it (default: on).
 * Off hides the icon and the panel entirely; the console adds no route of its own
 * to the write surface, so nothing else changes. The deployment-wide switch is
 * Workspace → Command console (`CONSOLE_ENABLED`), which also stops the API
 * serving the catalogue; this flag is the per-browser override.
 */
export const UI_CONSOLE = readFlag(UI_CONSOLE_STORAGE_KEY, "VITE_UI_CONSOLE");

/**
 * The modern navigation pane — the rail of domains with a column of destinations (default: on).
 *
 * Off is the classic single tree. The system setting
 * (Administration → Configuration → Workspace → "Navigation pane") decides the
 * default for everyone; `c7_ui_nav` overrides it for one browser in either
 * direction, and `VITE_UI_NAV=false` turns the modern pane off for a deployment,
 * whatever the setting says. See NAV-PANE-ROLLBACK.md.
 */
export const UI_NAV_MODERN = readFlag(UI_NAV_STORAGE_KEY, "VITE_UI_NAV");

/**
 * The browser's own answer, or `null` when it has never expressed one.
 *
 * `UI_NAV_MODERN` cannot serve here: it reports the build flag when the browser is silent, and the
 * pane has to be able to tell "this browser asked for the classic pane" apart from "this browser has
 * no opinion" — the second is what lets the instance's setting apply.
 */
export function navModernOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(UI_NAV_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* localStorage unavailable — no opinion */
  }
  return null;
}

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

export function setUiKumoBreadcrumbs(enabled: boolean): void {
  writeFlag(UI_KUMO_BREADCRUMBS_STORAGE_KEY, enabled);
}

export function setUiContextMenus(enabled: boolean): void {
  writeFlag(UI_CONTEXT_MENUS_STORAGE_KEY, enabled);
}

export function setUiConsole(enabled: boolean): void {
  writeFlag(UI_CONSOLE_STORAGE_KEY, enabled);
}

/** `true` for the modern pane, `false` for the classic one, for this browser only. */
export function setUiNavModern(enabled: boolean): void {
  writeFlag(UI_NAV_STORAGE_KEY, enabled);
}

export {
  UI_P1_STORAGE_KEY, UI_P2_STORAGE_KEY, UI_PALETTE_STORAGE_KEY,
  UI_KUMO_ORGS_STORAGE_KEY, UI_KUMO_TYPES_STORAGE_KEY, UI_KUMO_BREADCRUMBS_STORAGE_KEY,
  UI_CONTEXT_MENUS_STORAGE_KEY, UI_CONSOLE_STORAGE_KEY, UI_NAV_STORAGE_KEY,
};
