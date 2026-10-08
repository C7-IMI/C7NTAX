import { useEffect, useReducer, useState } from "react";
import api from "../api";
import {
  UI_NAV_MODERN, UI_REDESIGN, navModernOverride, redesignOverride, setUiNavModern, setUiRedesign,
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
 *   2. **This browser's override** — the `c7_ui_nav` and `c7_ui_redesign` flags, which win in *either*
 *      direction so somebody can try the redesign on an instance that has not adopted it, or keep the
 *      classic screens on an instance that has.
 *   3. **The build** — `VITE_UI_NAV=false` / `VITE_UI_REDESIGN=false` are deployment-wide offs and beat
 *      the setting, which is what makes them usable as rollbacks rather than as preferences.
 *
 * The interface and the navigation pane are separate answers on purpose: "which screens" and "which
 * nav" are different questions, and a person who wants the rail with the classic screens (or the tree
 * with the redesigned ones) should be able to say so.
 *
 * Nothing here hides a working feature: an unreachable API and an unset value both mean "as it was
 * before this change arrived", which for the pane is the classic tree.
 */
const APP_SETTINGS_CONFIG_KEY = "app_settings";

export type NavStyle = "modern" | "classic";
export type InterfaceStyle = "redesign" | "classic";

export interface NavigationSettings {
  style: NavStyle;
  assistantInRail: boolean;
  /** Which screens: the redesigned ones, or the classic ones. */
  interfaceStyle: InterfaceStyle;
}

const DEFAULT_SETTING: NavigationSettings = { style: "modern", assistantInRail: false, interfaceStyle: "redesign" };

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
    // The redesign is the default; only an explicit "classic" reverts it.
    interfaceStyle: appearance?.interfaceStyle === "classic" ? "classic" : "redesign",
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
  if (!UI_REDESIGN) next = { ...next, interfaceStyle: "classic" };
  else {
    const redesign = redesignOverride();
    if (redesign !== null) next = { ...next, interfaceStyle: redesign ? "redesign" : "classic" };
  }
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
 * Switches this browser between the redesigned screens and the classic ones, from the My Account
 * menu.
 *
 * It writes the same `c7_ui_redesign` flag INTERFACE-ROLLBACK.md names, so the switch and the
 * documented override are one mechanism rather than two that can disagree, and it works in either
 * direction. A deployment-wide `VITE_UI_REDESIGN=false` is not a preference and still wins.
 */
export function setInterfacePreference(style: InterfaceStyle): void {
  setUiRedesign(style === "redesign");
  overrideSubscribers.forEach((notify) => notify());
}

/**
 * `true` while the redesigned screens are in use, resolved through all three layers.
 *
 * A screen that has a classic and a redesigned shape asks this rather than reading a flag directly,
 * so it honours the instance's setting, the browser's own choice and a deployment-wide off without
 * having to know about any of them.
 */
export function useRedesign(): boolean {
  return useNavigationSettings().interfaceStyle === "redesign";
}
