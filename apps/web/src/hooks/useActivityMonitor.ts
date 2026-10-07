/**
 * Idle-timeout monitor (PLAN-001 §3.2).
 *
 * The server is the authority — it answers 440 when a session has gone idle — but a user
 * who is about to lose unsaved work deserves a warning rather than a sudden sign-out, so
 * this mirrors the same clock in the browser and warns a minute before it runs out.
 *
 * Activity is browser-wide (mouse, keys, scroll, touch, and tab focus) and resetting is
 * cheap: it only compares timestamps until the warning threshold is crossed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** Idle timeout in milliseconds, from the session endpoint. */
  timeoutMs: number;
  /** How long before the deadline to warn. */
  warningBeforeMs?: number;
  /** Called when the deadline passes with no activity. */
  onTimeout: () => void;
  /** Set false for clients whose credential does not idle (a bearer token). */
  enabled?: boolean;
}

const ACTIVITY_EVENTS = ["mousedown", "keydown", "wheel", "touchstart", "focus"] as const;

export function useActivityMonitor({ timeoutMs, warningBeforeMs = 60_000, onTimeout, enabled = true }: Options) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(Math.round(warningBeforeMs / 1000));
  const lastActivityRef = useRef(Date.now());
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(current => (current ? false : current));
  }, []);

  useEffect(() => {
    if (!enabled) {
      setShowWarning(false);
      return;
    }
    const handler = () => recordActivity();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, handler, { passive: true });
    return () => { for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, handler); };
  }, [enabled, recordActivity]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= timeoutMs) {
        setShowWarning(false);
        timeoutRef.current();
      } else if (idle >= timeoutMs - warningBeforeMs) {
        setShowWarning(true);
        setSecondsRemaining(Math.max(0, Math.round((timeoutMs - idle) / 1000)));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, timeoutMs, warningBeforeMs]);

  return { showWarning, secondsRemaining, recordActivity, dismissWarning: () => setShowWarning(false) };
}
