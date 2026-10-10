/**
 * The reminder for somebody inside the grace period.
 *
 * Enforcement gives an account a deadline rather than a cliff, and a deadline nobody is told about is
 * a cliff with paperwork. This is the telling: it sits above the page on every screen, says how long
 * is left in words, and goes to the wizard. It is dismissable — but **for the session only**, because
 * the point of the countdown is that it is not out of sight for a fortnight, and a permanent dismissal
 * is how a person arrives at the deadline having forgotten.
 *
 * Two designs, deliberately:
 *
 *  · **Modern** — a strip: the state in a pill you can read at a glance ("6 days left"), the sentence
 *    beside the control that acts on it, and two quiet actions.
 *  · **Classic** — a notice box with a sentence, a primary action and a secondary one, which is what
 *    every other classic alert in the application looks like.
 *
 * Not mounted at all when the requirement is being enforced now: the gate has taken the screen by
 * then, and a banner offering to remind you later behind it would be a lie.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, X } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { daysLeftInWords, graceReminderSentence } from "../../lib/mfa";

/** Session-scoped: closing it lasts until the tab does. */
const DISMISSED_KEY = "c7_mfa_banner_dismissed";

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage unavailable (private mode): show it rather than hide a deadline behind a failure.
    return false;
  }
}

export function MfaReminderBanner() {
  const modern = useModernInterface();
  const { mfaPolicy } = useAuth();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  if (!mfaPolicy || !mfaPolicy.enabled || !mfaPolicy.mustEnrol || mfaPolicy.mustEnrolNow) return null;
  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const sentence = graceReminderSentence(mfaPolicy);
  const countdown = daysLeftInWords(mfaPolicy.daysLeft);

  if (modern) {
    return (
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
          <ShieldAlert size={15} />
        </span>
        <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-gray-300">{sentence}</p>
        {countdown !== "before it becomes required" && (
          <span className="shrink-0 rounded-full border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-200">
            {countdown}
          </span>
        )}
        <button type="button" className="btn-primary shrink-0 text-xs" onClick={() => navigate("/mfa-setup")}>
          Set it up
        </button>
        <button
          type="button"
          className="shrink-0 rounded-lg p-1 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white"
          onClick={dismiss}
          aria-label="Hide this until the session ends"
          title="Hide this until the session ends"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <p className="text-sm text-amber-200">{sentence}</p>
      <p className="mt-0.5 text-xs text-gray-400">
        A second factor is a second proof of who you are: a code from an authenticator app, a code by
        email, or a passkey on your device.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn-primary text-xs" onClick={() => navigate("/mfa-setup")}>
          Set it up now
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={dismiss}>
          Remind me later
        </button>
      </div>
    </div>
  );
}
