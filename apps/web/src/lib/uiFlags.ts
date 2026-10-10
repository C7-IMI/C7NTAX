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
 *   localStorage.setItem("c7_ui_modern", "0"); location.reload() // the classic interface
 *   localStorage.removeItem("c7_ui_p1");   location.reload()   // back to default
 * Or the window.c7UiP1 / window.c7UiP2 helpers, or the command palette actions.
 *
 * The right-click menus are also a system setting (Administration → System
 * Settings → General → "Application right-click menus"), which applies to every
 * user; see CONTEXT-MENUS-ROLLBACK.md.
 *
 * The navigation pane is likewise a system setting (Administration → Configuration
 * → Workspace → "Navigation pane", `appearance.navigationStyle`), and the
 * `c7_ui_nav` flag overrides it for one browser in either direction. Everyone can
 * set that override for themselves from the header's **My Account → Appearance →
 * Interface** switch, which is the same flag this file names; see
 * NAV-PANE-ROLLBACK.md.
 *
 * The interface itself — the Modern screens rather than the classic ones — is a
 * system setting too (Workspace → "Interface", `appearance.interfaceStyle`), and
 * `c7_ui_modern` overrides it for one browser. See INTERFACE-ROLLBACK.md.
 *
 * Deployment-wide rollback: set VITE_UI_P1=false / VITE_UI_P2=false (e.g. in
 * apps/web/.env.local) and restart the web server; or run
 * scripts/rollback-ui-p1.ps1 -Part P1|P2|All.
 */
type FlagStorageKey = "c7_ui_p1" | "c7_ui_p2" | "c7_ui_palette" | "c7_ui_kumo_orgs" | "c7_ui_kumo_types" | "c7_ui_kumo_crumbs" | "c7_ui_context_menus" | "c7_ui_console" | "c7_ui_nav" | "c7_ui_modern";

/**
 * A flag's name before the interface was renamed Modern (it was "Redesign"). A browser that chose an
 * interface under the old name still holds it, and a deployment that built with the old variable
 * still constrains the build, so both are read — never written — as a fallback. Retire them in a
 * later release, once no browser and no build can be carrying them.
 */
interface FlagAliases {
  key: string;
  envName: string;
}

const UI_P1_STORAGE_KEY: FlagStorageKey = "c7_ui_p1";
const UI_P2_STORAGE_KEY: FlagStorageKey = "c7_ui_p2";
const UI_PALETTE_STORAGE_KEY: FlagStorageKey = "c7_ui_palette";
const UI_KUMO_ORGS_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_orgs";
const UI_KUMO_TYPES_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_types";
const UI_KUMO_BREADCRUMBS_STORAGE_KEY: FlagStorageKey = "c7_ui_kumo_crumbs";
const UI_CONTEXT_MENUS_STORAGE_KEY: FlagStorageKey = "c7_ui_context_menus";
const UI_CONSOLE_STORAGE_KEY: FlagStorageKey = "c7_ui_console";
const UI_NAV_STORAGE_KEY: FlagStorageKey = "c7_ui_nav";
const UI_MODERN_SCREENS_STORAGE_KEY: FlagStorageKey = "c7_ui_modern";

/** The Modern-screens flag's old name — read as a fallback, never written. See {@link FlagAliases}. */
const UI_MODERN_SCREENS_LEGACY: FlagAliases = { key: "c7_ui_redesign", envName: "VITE_UI_REDESIGN" };

function readBuildFlag(envName: string): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[envName] !== "false";
}

function readFlag(key: FlagStorageKey, envName: string, legacy?: FlagAliases): boolean {
  try {
    // The current name wins; the old one is only a fallback, so a browser that chose before the
    // rename keeps its choice.
    const override = localStorage.getItem(key) ?? (legacy ? localStorage.getItem(legacy.key) : null);
    if (override === "0") return false;
    if (override === "1") return true;
  } catch {
    /* localStorage unavailable — fall through to the build default */
  }
  return readBuildFlag(envName) && (legacy ? readBuildFlag(legacy.envName) : true);
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
 * Whether this *build* has the modern pane at all, ignoring what the browser asked for.
 *
 * A control that offers the modern pane has to stay reachable to the people who have switched away
 * from it, and `UI_NAV_MODERN` cannot answer that question: it reports the browser's `c7_ui_nav`
 * override, so it is false for exactly the person who chose the classic pane and would hide the one
 * control that could take them back. Only a `VITE_UI_NAV=false` deployment — a rollback, not a
 * preference — takes the choice away, and that is what this reports.
 */
export const UI_NAV_AVAILABLE = readBuildFlag("VITE_UI_NAV");

/**
 * The Modern interface — the restructured screens rather than the classic ones (default: on).
 *
 * This is the switch that takes somebody back to the interface the application had before the
 * Modern screens, and it is deliberately separate from the navigation pane's: the two are different
 * questions ("which screens" and "which nav"), and a person who wants the rail with the classic
 * screens, or the tree with the Modern ones, should be able to say so. See
 * INTERFACE-ROLLBACK.md.
 */
export const UI_MODERN_SCREENS = readFlag(UI_MODERN_SCREENS_STORAGE_KEY, "VITE_UI_MODERN", UI_MODERN_SCREENS_LEGACY);

/** Whether this build has the Modern screens at all, ignoring what the browser asked for. */
export const UI_MODERN_SCREENS_AVAILABLE = readBuildFlag("VITE_UI_MODERN") && readBuildFlag(UI_MODERN_SCREENS_LEGACY.envName);

/** The browser's own answer for the interface, or `null` when it has never expressed one. */
export function modernScreensOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(UI_MODERN_SCREENS_STORAGE_KEY) ?? localStorage.getItem(UI_MODERN_SCREENS_LEGACY.key);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* localStorage unavailable — no opinion */
  }
  return null;
}

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

/** `true` for the Modern screens, `false` for the classic ones, for this browser only. */
export function setUiModernScreens(enabled: boolean): void {
  writeFlag(UI_MODERN_SCREENS_STORAGE_KEY, enabled);
}

export {
  UI_P1_STORAGE_KEY, UI_P2_STORAGE_KEY, UI_PALETTE_STORAGE_KEY,
  UI_KUMO_ORGS_STORAGE_KEY, UI_KUMO_TYPES_STORAGE_KEY, UI_KUMO_BREADCRUMBS_STORAGE_KEY,
  UI_CONTEXT_MENUS_STORAGE_KEY, UI_CONSOLE_STORAGE_KEY, UI_NAV_STORAGE_KEY, UI_MODERN_SCREENS_STORAGE_KEY,
};
