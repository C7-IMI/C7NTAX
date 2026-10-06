import { useEffect, useState } from "react";
import api from "../api";
import { UI_CONTEXT_MENUS } from "../lib/uiFlags";

/**
 * Application right-click menus are switched on and off from
 * Administration → System Settings → General ("Application right-click menus").
 * The setting lives in the shared `app_settings` system config, so it applies to
 * every user rather than to one browser.
 *
 * The `c7_ui_context_menus` browser flag (`UI_CONTEXT_MENUS`) still acts as a
 * local kill switch, and a `VITE_UI_CONTEXT_MENUS=false` build disables the
 * feature outright.
 */
const APP_SETTINGS_CONFIG_KEY = "app_settings";

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const subscribers = new Set<(enabled: boolean) => void>();

/** Reads `general.contextMenus` out of a stored app_settings value. Missing = on. */
export function parseContextMenusSetting(value: unknown): boolean {
  let blob: unknown = value;
  if (typeof blob === "string") {
    try { blob = JSON.parse(blob); } catch { return true; }
  }
  const general = (blob as { general?: { contextMenus?: unknown } } | null)?.general;
  return general?.contextMenus !== false;
}

/** Called by System Settings after a save so open screens react without a reload. */
export function primeContextMenusSetting(enabled: boolean): void {
  cached = enabled;
  inflight = null;
  subscribers.forEach((notify) => notify(enabled));
}

/**
 * Resolves to the system setting, defaulting to on when it has never been set
 * or the API cannot be reached — the fallback must never hide a working feature.
 */
export function useContextMenusEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => UI_CONTEXT_MENUS && (cached ?? true));

  useEffect(() => {
    if (!UI_CONTEXT_MENUS) { setEnabled(false); return; }
    if (cached !== null) { setEnabled(cached); return; }

    let active = true;
    const onChange = (value: boolean) => { if (active) setEnabled(value); };
    subscribers.add(onChange);

    inflight ??= api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
      .then((r) => parseContextMenusSetting(r.data?.value))
      .catch(() => true);
    inflight.then((value) => { cached ??= value; onChange(cached); });

    return () => { subscribers.delete(onChange); };
  }, []);

  return enabled;
}
