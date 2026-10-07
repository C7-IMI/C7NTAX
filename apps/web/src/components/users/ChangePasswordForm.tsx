import { useState } from "react";
import api from "../../api";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { validatePassword } from "@C7NTAX/shared";
import { PasswordInput } from "./PasswordFields";

/**
 * The one place a password is changed by its owner. Mounted by the sign-in
 * screen after a temporary password, and as the app-wide gate for anyone who
 * still owes a change (middleware rejects every other route until then).
 */
export function ChangePasswordForm({
  currentPassword,
  onChanged,
  onSignOut,
  firstName,
  email,
  compact,
}: {
  /** Known already when the sign-in form just collected it. */
  currentPassword?: string;
  onChanged: (token: string) => void;
  onSignOut?: () => void;
  firstName?: string | null;
  email?: string | null;
  compact?: boolean;
}) {
  const [current, setCurrent] = useState(currentPassword ?? "");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!current) { setError("Enter your current password"); return; }
    const problem = validatePassword(next, { email, firstName });
    if (problem) { setError(problem); return; }
    if (next !== confirm) { setError("The two passwords do not match"); return; }
    if (next === current) { setError("Choose a password you have not used here before"); return; }

    setBusy(true);
    try {
      const res = await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      localStorage.setItem("c7_token", res.data.token);
      onChanged(res.data.token);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || "Could not change your password");
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "space-y-4" : "card w-full max-w-md space-y-4"}>
      <div className="flex items-start gap-3">
        <ShieldCheck size={22} className="text-cyber-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-white font-semibold">
            {firstName ? `${firstName}, choose a new password` : "Choose a new password"}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Your current password was set by an administrator. Pick your own to continue — the
            temporary one stops working straight away.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <PasswordInput
          label="Current password"
          value={current}
          onChange={setCurrent}
          allowGenerate={false}
          showRules={false}
        />
        <PasswordInput label="New password" value={next} onChange={setNext} autoFocus={!!currentPassword} />
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-gray-400">Confirm new password</label>
          <input
            className="input-field"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          />
          {confirm.length > 0 && confirm !== next && <p className="text-xs text-red-400">The two passwords do not match</p>}
        </div>
      </div>

      {error && (
        <div className="bg-red-600/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {onSignOut ? (
          <button type="button" onClick={onSignOut} className="btn-secondary text-sm flex items-center gap-1.5">
            <LogOut size={14} /> Sign out
          </button>
        ) : <span />}
        <button type="button" onClick={submit} disabled={busy} className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50">
          <KeyRound size={14} /> {busy ? "Saving…" : "Set password"}
        </button>
      </div>
    </div>
  );
}
