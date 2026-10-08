import { useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "./useAuth";
import { Permission } from "@C7NTAX/shared";
import { UI_CONSOLE } from "../lib/uiFlags";

/**
 * May this person use the console?
 *
 * Three gates, each answering a different question, and all three have to be open:
 *
 * 1. **`console:use`** — is this *person* allowed to? The permission, so it is granted per role and can be
 *    added or removed for one individual in Users & Roles. The icon is not drawn without it: a control
 *    somebody may not use is not a control to show them greyed out, and the API refuses the catalogue on
 *    the same permission, so a hidden icon and a refused request are the same answer.
 * 2. **The deployment switch** (Workspace → Command console, `CONSOLE_ENABLED`) — is it switched on
 *    *here*? The API answers 404 when it is off, so the icon would open a panel that fails.
 * 3. **`c7_ui_console`** (`VITE_UI_CONSOLE`) — the per-browser kill switch for someone whose account is
 *    fine but who wants it gone, and the way a build can ship without it.
 *
 * A fourth gate exists on the server and not here: a **client** with the console turned off
 * (`Company.consoleEnabled = false`) is answered by the API — the effective permission the session
 * carries has `console:use` removed before `GET /users/me` returns it, so this hook sees a person who
 * simply does not hold it. That keeps one rule in one place: the client's setting is applied where
 * permissions are computed, not re-checked in the interface.
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
 * Resolves to whether the console should be offered, defaulting the *deployment* switch to on when it
 * has never been set or the API cannot be reached. The permission is never defaulted: a session that
 * cannot tell us what it holds is a session that does not get a command surface.
 */
export function useConsoleEnabled(): boolean {
  const { permissions } = useAuth();
  const allowed = permissions.includes(Permission.ConsoleUse);
  const [enabled, setEnabled] = useState(() => UI_CONSOLE && allowed && (cached ?? true));

  useEffect(() => {
    if (!UI_CONSOLE || !allowed) { setEnabled(false); return; }
    if (cached !== null) { setEnabled(cached); return; }

    let active = true;
    const onChange = (value: boolean) => { if (active) setEnabled(value); };
    subscribers.add(onChange);

    inflight ??= api.get(`/system/config/${APP_SETTINGS_CONFIG_KEY}`)
      .then((r) => parseConsoleSetting(r.data?.value))
      .catch(() => true);
    inflight.then((value) => { cached ??= value; onChange(cached); });

    return () => { subscribers.delete(onChange); };
  }, [allowed]);

  return enabled;
}
