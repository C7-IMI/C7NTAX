import { useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { AlertTriangle, Check, Copy, KeyRound, Mail, X, Unlock } from "lucide-react";
import { copyText } from "../../lib/menuActions";
import { PasswordInput } from "./PasswordFields";

export interface ResettableUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isLocked: boolean;
  mfaEnabled: boolean;
}

interface ResetResult {
  temporaryPassword: string;
  mustChangePassword: boolean;
  unlocked: boolean;
  emailed: boolean;
  emailError?: string;
}

/**
 * The administrator's password reset. The temporary password is shown once so
 * it can be handed over, and the account is unlocked in the same step — the two
 * things a "I can't get in" call always needs together.
 */
export function ResetPasswordDialog({ user, onClose, onDone }: {
  user: ResettableUser | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState("");
  const [requireChange, setRequireChange] = useState(true);
  const [unlock, setUnlock] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);

  if (!user) return null;
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email;

  const close = () => {
    setMode("generate");
    setPassword("");
    setRequireChange(true);
    setUnlock(true);
    setSendEmail(false);
    setError(null);
    setResult(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (mode === "manual" && !password) { setError("Enter the password to set"); return; }
    setBusy(true);
    try {
      const res = await api.post(`/users/${user.id}/reset-password`, {
        mode, password: mode === "manual" ? password : undefined, requireChange, unlock, sendEmail,
      });
      setResult(res.data);
      onDone?.();
      toast.success("Password reset");
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || "Could not reset the password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Reset password" className="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <KeyRound size={20} className="text-cyber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-white">Reset password</h3>
              <p className="text-xs text-gray-400">{name} · {user.email}</p>
            </div>
          </div>
          <button onClick={close} className="text-gray-500 hover:text-white"><X size={18} /></button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="bg-green-600/10 border border-green-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <Check size={15} /> Password reset
              </div>
              <p className="text-xs text-gray-400">
                Give this temporary password to {name}. It is shown once and cannot be retrieved later.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/40 border border-surface-border rounded px-3 py-2 text-sm text-cyber-300 font-mono break-all">{result.temporaryPassword}</code>
                <button onClick={() => void copyText(result.temporaryPassword, "Password")}
                  className="btn-secondary text-xs py-1.5 px-2 flex items-center gap-1 shrink-0">
                  <Copy size={12} /> Copy
                </button>
              </div>
            </div>
            <ul className="text-xs text-gray-400 space-y-1">
              {result.unlocked && <li className="flex items-center gap-1.5"><Unlock size={12} className="text-green-400" /> Account unlocked and failed sign-in attempts cleared</li>}
              {result.mustChangePassword && <li className="flex items-center gap-1.5"><Check size={12} className="text-green-400" /> {name.split(" ")[0]} must choose a new password at the next sign-in</li>}
              {result.emailed && <li className="flex items-center gap-1.5"><Mail size={12} className="text-green-400" /> Emailed to {user.email}</li>}
              {result.emailError && <li className="flex items-start gap-1.5 text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> Email not sent ({result.emailError}) — hand over the password above</li>}
              <li>Any session signed in with the old password has to sign in again.</li>
            </ul>
            <div className="flex justify-end pt-1">
              <button onClick={close} className="btn-primary text-sm">Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1.5">New password</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setMode("generate")}
                    className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${mode === "generate" ? "border-cyber-500/50 bg-cyber-600/15 text-white" : "border-surface-border text-gray-400 hover:text-white"}`}>
                    Generate one
                  </button>
                  <button type="button" onClick={() => setMode("manual")}
                    className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${mode === "manual" ? "border-cyber-500/50 bg-cyber-600/15 text-white" : "border-surface-border text-gray-400 hover:text-white"}`}>
                    Set one myself
                  </button>
                </div>
              </div>

              {mode === "manual" ? (
                <PasswordInput label="Temporary password" value={password} onChange={setPassword} autoFocus />
              ) : (
                <p className="text-xs text-gray-500">
                  A 20-character password will be created and shown to you once, after the reset.
                </p>
              )}

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={requireChange} onChange={e => setRequireChange(e.target.checked)} className="mt-0.5 rounded accent-cyber-500" />
                  <span>Require a new password at the next sign-in</span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={unlock} onChange={e => setUnlock(e.target.checked)} className="mt-0.5 rounded accent-cyber-500" />
                  <span>
                    Unlock the account and clear failed sign-in attempts
                    {user.isLocked && <span className="text-amber-400"> — currently locked</span>}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="mt-0.5 rounded accent-cyber-500" />
                  <span>Email the new password to {user.email}</span>
                </label>
              </div>

              {user.mfaEnabled && (
                <div className="bg-amber-600/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>MFA is enabled for this account, so they will still need their authenticator after signing in. Reset MFA separately if they have lost it.</span>
                </div>
              )}

              {error && <div className="bg-red-600/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-300">{error}</div>}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={close} className="btn-secondary text-sm">Cancel</button>
              <button onClick={submit} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
                {busy ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
