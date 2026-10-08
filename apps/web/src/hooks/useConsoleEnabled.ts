import { useEffect, useState } from "react";
import api from "../api";
import { UI_CONSOLE } from "../lib/uiFlags";

/**
 * The console is switched on and off from Workspace → Command console. The setting lives in the
 * shared `app_settings` row, so it applies to the whole deployment rather than to one browser, and the
 * API reads the same field (`CONSOLE_ENABLED` in the environment does the same job) to decide whether
 * to serve the command catalogue at all.
 *
 * `c7_ui_console` (`UI_CONSOLE`) stays the per-browser kill switch, and a `VITE_UI_CONSOLE=false`
 * build removes the icon and the panel outright — the rollback PLAN-028 promises: nothing else in the
 * application changes when the console is off, because the console owns no other surface.
 */
const APP_SETTINGS_CONFIG_KEY = "app_settings";

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const subscribers = new Set<(enabled: boolean) => void>();

/** Reads `general.console` out of a stored app_settings value. Missing = on. */
export function parseConsoleSetting(value: unknown): boolean {
  let blob: unknown = value;
  if (typeof blob === "string") {
    try { blob = JSON.parse(blob); } catch { return true; }
  }
  const general = (blob as { general?: { console?: unknown } } | null)?.general;
  return general?.console !== false;
}

/** Called by System Settings after a save so open screens react without a reload. */
export function primeConsoleSetting(enabled: boolean): void {
  cached = enabled;
  inflight = null;
  subscribers.forEach((notify) => notify(enabled));
}

/**
 * Resolves to the system setting, defaulting to on when it has never been set or the API cannot be
 * reached. The fallback never hides a working feature: a console that is unreachable will say so when
 * a command runs, which is a better failure than an icon that disappears.
 */
export function useConsoleEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => UI_CONSOLE && (cached ?? true));

  useEffect(() => {
    if (!UI_CONSOLE) { setEnabled(false); return; }
    if (cached !== null) { setEnabled(cached); return; }

    let active = true;
    const onChange = (value: boolean) => { if (active) setEnabled(value); };
    subscribers.add(onChange);

    inflight ??= api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
      .then((r) => parseConsoleSetting(r.data?.value))
      .catch(() => true);
    inflight.then((value) => { cached ??= value; onChange(cached); });

    return () => { subscribers.delete(onChange); };
  }, []);

  return enabled;
}
