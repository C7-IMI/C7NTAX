import { useEffect, useState } from "react";
import api from "../api";
import { UI_NAV_MODERN, navModernOverride } from "../lib/uiFlags";

/**
 * Which navigation pane to draw, and whether the Assistant belongs in the rail.
 *
 * Both come from the same `app_settings` row (Administration → Configuration → Workspace), so they are
 * read in one request and primed together when the settings screen saves.
 *
 * Resolution order, narrowest last:
 *
 *   1. **The instance's setting** — `appearance.navigationStyle`, `appearance.assistantInRail`.
 *   2. **This browser's override** — the `c7_ui_nav` flag, which wins in *either* direction so somebody
 *      can try the modern pane on an instance that has not adopted it, or keep the classic one on an
 *      instance that has.
 *   3. **The build** — `VITE_UI_NAV=false` is a deployment-wide off and beats the setting, which is what
 *      makes it usable as a rollback rather than as a preference.
 *
 * Nothing here hides a working feature: an unreachable API and an unset value both mean "as it was
 * before this change arrived", which for the pane is the classic tree.
 */
const APP_SETTINGS_CONFIG_KEY = "app_settings";

export type NavStyle = "modern" | "classic";

export interface NavigationSettings {
  style: NavStyle;
  assistantInRail: boolean;
}

const DEFAULT_SETTING: NavigationSettings = { style: "modern", assistantInRail: false };

let cached: NavigationSettings | null = null;
let inflight: Promise<NavigationSettings> | null = null;
const subscribers = new Set<(value: NavigationSettings) => void>();

/** Reads `appearance` out of a stored app_settings value. */
export function parseNavigationSettings(value: unknown): NavigationSettings {
  let blob: unknown = value;
  if (typeof blob === "string") {
    try { blob = JSON.parse(blob); } catch { return DEFAULT_SETTING; }
  }
  const appearance = (blob as { appearance?: { navigationStyle?: unknown; assistantInRail?: unknown } } | null)?.appearance;
  return {
    // Only an explicit "classic" goes back; a typo or an older value keeps the modern pane rather
    // than silently reverting the interface for everybody.
    style: appearance?.navigationStyle === "classic" ? "classic" : "modern",
    assistantInRail: appearance?.assistantInRail === true,
  };
}

/** Applied on top of the instance's setting, so a single browser can disagree with it. */
export function applyLocalOverride(setting: NavigationSettings): NavigationSettings {
  if (!UI_NAV_MODERN) return { ...setting, style: "classic" };
  const override = navModernOverride();
  if (override === null) return setting;
  return { ...setting, style: override ? "modern" : "classic" };
}

/** Called by the settings screen after a save or a clear, so open screens follow without a reload. */
export function primeNavigationSettings(next: NavigationSettings): void {
  cached = next;
  inflight = null;
  subscribers.forEach((notify) => notify(next));
}

export function useNavigationSettings(): NavigationSettings {
  const [setting, setSetting] = useState<NavigationSettings>(() => cached ?? DEFAULT_SETTING);

  useEffect(() => {
    if (cached !== null) { setSetting(cached); return; }

    let active = true;
    const onChange = (value: NavigationSettings) => { if (active) setSetting(value); };
    subscribers.add(onChange);

    inflight ??= api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
      .then((r) => parseNavigationSettings(r.data?.value))
      .catch(() => DEFAULT_SETTING);
    inflight.then((value) => { cached ??= value; onChange(cached); });

    return () => { subscribers.delete(onChange); };
  }, []);

  return applyLocalOverride(setting);
}
