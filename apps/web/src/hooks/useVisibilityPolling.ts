import { useEffect, useRef } from "react";

/**
 * TOKEN-SAVE-06: consolidated visibility-gated polling.
 *
 * Runs `callback` every `intervalMs`, but skips ticks while the tab is
 * hidden (document.hidden) and re-runs once when the tab becomes visible
 * again. Use this instead of ad-hoc setInterval calls in pages/components
 * to cut background polling (log spam + network/token churn).
 */
export function useVisibilityPolling(callback: () => void, intervalMs: number): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const run = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      cbRef.current();
    };
    const timer = window.setInterval(run, intervalMs);
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) cbRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
