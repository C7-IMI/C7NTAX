import { useEffect, useReducer, useState } from "react";
import api from "../api";
import {
  UI_NAV_MODERN, UI_MODERN_SCREENS, navModernOverride, modernScreensOverride, setUiNavModern, setUiModernScreens,
} from "../lib/uiFlags";

/**
 * Which navigation pane to draw, whether the Assistant belongs in the rail, and which interface the
 * screens come from.
 *
 * All three come from the same `app_settings` row (Administration → Configuration → Workspace), so
 * they are read in one request and primed together when the settings screen saves.
 *
 * Resolution order, narrowest last:
 *
 *   1. **The instance's setting** — `appearance.navigationStyle`, `appearance.assistantInRail`,
 *      `appearance.interfaceStyle`.
 *   2. **This browser's override** — the `c7_ui_nav` and `c7_ui_modern` flags, which win in *either*
 *      direction so somebody can try the Modern interface on an instance that has not adopted it, or keep the
 *      classic screens on an instance that has.
 *   3. **The build** — `VITE_UI_NAV=false` / `VITE_UI_MODERN=false` are deployment-wide offs and beat
 *      the setting, which is what makes them usable as rollbacks rather than as preferences.
 *
 * The interface and the navigation pane are separate answers on purpose: "which screens" and "which
 * nav" are different questions, and a person who wants the rail with the classic screens (or the tree
 * with the Modern ones) should be able to say so.
 *
 * Nothing here hides a working feature: an unreachable API and an unset value both mean "as it was
 * before this change arrived", which for the pane is the classic tree.
 */
const APP_SETTINGS_CONFIG_KEY = "app_settings";

export type NavStyle = "modern" | "classic";
export type InterfaceStyle = "modern" | "classic";

export interface NavigationSettings {
  style: NavStyle;
  assistantInRail: boolean;
  /** Which screens: the Modern ones, or the classic ones. */
  interfaceStyle: InterfaceStyle;
  /**
   * Whether a record shows its **context column** — the client, the contact and the estate beside
   * the work. On by default, because that is the Modern record: those facts are what you read
   * *while* working, and a record that hides them behind a tab is the thing this replaces. It is a
   * personal preference rather than an instance setting: it is about how much room *you* want beside
   * a record, and it can be turned off from the account menu.
   */
  contextPane: boolean;
}

const DEFAULT_SETTING: NavigationSettings = { style: "modern", assistantInRail: false, interfaceStyle: "modern", contextPane: true };

/** The context column's own preference. Not a build flag and not a server setting — see above. */
const CONTEXT_PANE_STORAGE_KEY = "c7_ui_context";

/** `null` when this browser has never expressed a preference, so the default stands. */
export function contextPaneOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(CONTEXT_PANE_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
    return null;
  } catch {
    return null;
  }
}

export function setContextPane(enabled: boolean): void {
  try {
    localStorage.setItem(CONTEXT_PANE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  overrideSubscribers.forEach((notify) => notify());
}

let cached: NavigationSettings | null = null;
let inflight: Promise<NavigationSettings> | null = null;
const subscribers = new Set<(value: NavigationSettings) => void>();

/**
 * Panes waiting to hear that *this browser* changed its mind.
 *
 * The override is in localStorage, so writing it re-renders nothing by itself: without this the
 * switch in the account menu would look broken until the next navigation. The setting is not
 * re-read from the API for it — nothing about the instance changed.
 */
const overrideSubscribers = new Set<() => void>();

/** Reads `appearance` out of a stored app_settings value. */
export function parseNavigationSettings(value: unknown): NavigationSettings {
  let blob: unknown = value;
  if (typeof blob === "string") {
    try { blob = JSON.parse(blob); } catch { return DEFAULT_SETTING; }
  }
  const appearance = (blob as {
    appearance?: { navigationStyle?: unknown; assistantInRail?: unknown; interfaceStyle?: unknown };
  } | null)?.appearance;
  return {
    // Only an explicit "classic" goes back; a typo or an older value keeps the modern pane rather
    // than silently reverting the interface for everybody.
    style: appearance?.navigationStyle === "classic" ? "classic" : "modern",
    assistantInRail: appearance?.assistantInRail === true,
    // The Modern interface is the default; only an explicit "classic" reverts it. A stored
    // "redesign" — the value this setting used before the rename — is therefore still Modern.
    interfaceStyle: appearance?.interfaceStyle === "classic" ? "classic" : "modern",
    // Not from the server: the context column is a personal preference, and the default is on.
    contextPane: true,
  };
}

/** Applied on top of the instance's setting, so a single browser can disagree with it. */
export function applyLocalOverride(setting: NavigationSettings): NavigationSettings {
  let next = setting;
  if (!UI_NAV_MODERN) next = { ...next, style: "classic" };
  else {
    const nav = navModernOverride();
    if (nav !== null) next = { ...next, style: nav ? "modern" : "classic" };
  }
  if (!UI_MODERN_SCREENS) next = { ...next, interfaceStyle: "classic" };
  else {
    const modern = modernScreensOverride();
    if (modern !== null) next = { ...next, interfaceStyle: modern ? "modern" : "classic" };
  }
  const contextPane = contextPaneOverride();
  if (contextPane !== null) next = { ...next, contextPane };
  return next;
}

/** Called by the settings screen after a save or a clear, so open screens follow without a reload. */
export function primeNavigationSettings(next: NavigationSettings): void {
  cached = next;
  inflight = null;
  subscribers.forEach((notify) => notify(next));
}

/**
 * Re-reads the setting and pushes it to every mounted pane.
 *
 * The settings screen calls this rather than computing the new value: whether a save, a clear or a
 * deployment fallback produced what the API now reports is the API's business, and reconstructing it
 * here is how the screen and the pane would eventually disagree.
 */
export function refreshNavigationSettings(): void {
  cached = null;
  inflight = api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
    .then((r) => parseNavigationSettings(r.data?.value))
    .catch(() => DEFAULT_SETTING)
    .then((value) => {
      cached = value;
      subscribers.forEach((notify) => notify(value));
      return value;
    });
}

export function useNavigationSettings(): NavigationSettings {
  const [setting, setSetting] = useState<NavigationSettings>(() => cached ?? DEFAULT_SETTING);
  const [, bumpOverride] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let active = true;
    const onChange = (value: NavigationSettings) => { if (active) setSetting(value); };
    const onOverrideChange = () => { if (active) bumpOverride(); };

    overrideSubscribers.add(onOverrideChange);

    if (cached !== null) {
      setSetting(cached);
    } else {
      subscribers.add(onChange);

      inflight ??= api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
        .then((r) => parseNavigationSettings(r.data?.value))
        .catch(() => DEFAULT_SETTING);
      inflight.then((value) => { cached ??= value; onChange(cached); });
    }

    return () => {
      active = false;
      subscribers.delete(onChange);
      overrideSubscribers.delete(onOverrideChange);
    };
  }, []);

  return applyLocalOverride(setting);
}

/**
 * Switches this browser to the named pane, from the My Account menu.
 *
 * It writes the same `c7_ui_nav` flag the console instructions use, so the switch and the documented
 * override are one mechanism rather than two that can disagree, and it works in either direction —
 * a person can choose the modern pane on an instance that has not adopted it, or keep the classic one
 * on an instance that has. A deployment-wide `VITE_UI_NAV=false` is not a preference and still wins.
 */
export function setNavigationPreference(style: NavStyle): void {
  setUiNavModern(style === "modern");
  overrideSubscribers.forEach((notify) => notify());
}

/**
 * Switches this browser between the Modern screens and the classic ones, from the My Account
 * menu.
 *
 * It writes the same `c7_ui_modern` flag INTERFACE-ROLLBACK.md names, so the switch and the
 * documented override are one mechanism rather than two that can disagree, and it works in either
 * direction. A deployment-wide `VITE_UI_MODERN=false` is not a preference and still wins.
 */
export function setInterfacePreference(style: InterfaceStyle): void {
  setUiModernScreens(style === "modern");
  overrideSubscribers.forEach((notify) => notify());
}

/**
 * `true` while the Modern screens are in use, resolved through all three layers.
 *
 * A screen that has a classic and a Modern shape asks this rather than reading a flag directly,
 * so it honours the instance's setting, the browser's own choice and a deployment-wide off without
 * having to know about any of them.
 */
export function useModernInterface(): boolean {
  return useNavigationSettings().interfaceStyle === "modern";
}

/**
 * Whether a record should show its context column.
 *
 * A screen asks this rather than reading the preference, so the account menu's choice reaches every
 * record that has one, and the default — shown — is in one place.
 */
export function useContextPane(): boolean {
  return useNavigationSettings().contextPane;
}
