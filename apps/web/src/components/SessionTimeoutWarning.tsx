/**
 * "Session expiring" warning (PLAN-001 §3.3).
 *
 * Shown a minute before the server's idle timeout. Staying logged in resets the server's
 * clock, not just this one — otherwise the modal would dismiss and the next request would
 * still be refused.
 */
import { useState } from "react";
import { Clock } from "lucide-react";
import { Modal } from "./Modal";

export function SessionTimeoutWarning({ visible, secondsRemaining, onExtend, onLogout }: {
  visible: boolean;
  secondsRemaining: number;
  onExtend: () => Promise<boolean> | void;
  onLogout: () => void;
}) {
  const [extending, setExtending] = useState(false);

  if (!visible) return null;

  const stay = async () => {
    setExtending(true);
    try {
      // A failed extend means the session is already gone; the caller's catch signs out.
      const ok = await onExtend();
      if (ok === false) onLogout();
    } finally {
      setExtending(false);
    }
  };

  return (
    <Modal onClose={() => { /* the warning is not dismissable without a decision */ }}>
      <div className="space-y-4" role="alertdialog" aria-labelledby="session-timeout-title">
        <div className="flex items-center gap-3">
          <Clock size={22} className="text-amber-400" />
          <h2 id="session-timeout-title" className="text-lg font-semibold text-white">Session expiring</h2>
        </div>
        <p className="text-sm text-gray-400">
          You will be signed out in{" "}
          <span className="font-semibold text-amber-400">{secondsRemaining}s</span>{" "}
          because there has been no activity. Choose <span className="text-white">Stay signed in</span> to continue where you left off.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onLogout} className="btn-secondary">Sign out now</button>
          <button onClick={stay} disabled={extending} className="btn-primary">
            {extending ? "Extending…" : "Stay signed in"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
