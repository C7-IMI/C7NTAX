/**
 * P1 UI modernization kill switch.
 *
 * Instant rollback (no rebuild, no code changes) — run in the browser console
 * or use window.c7UiP1 helpers, then reload:
 *   localStorage.setItem("c7_ui_p1", "0"); location.reload()   // disable P1
 *   localStorage.setItem("c7_ui_p1", "1"); location.reload()   // force-enable P1
 *   localStorage.removeItem("c7_ui_p1");   location.reload()   // back to default
 *
 * Deployment-wide rollback: set VITE_UI_P1=false (e.g. in apps/web/.env.local)
 * and restart the web server. See UI-P1-ROLLBACK.md.
 */
const UI_P1_KEY = "c7_ui_p1";

function readUiP1(): boolean {
  try {
    const override = localStorage.getItem(UI_P1_KEY);
    if (override === "0") return false;
    if (override === "1") return true;
  } catch {
    /* localStorage unavailable — fall through to the build default */
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_UI_P1 !== "false";
}

/** Whether the P1 modernization features are enabled (default: on). */
export const UI_P1 = readUiP1();

export const UI_P1_STORAGE_KEY = UI_P1_KEY;

export function setUiP1(enabled: boolean): void {
  try {
    localStorage.setItem(UI_P1_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
