/**
 * Passkeys card (PLAN-002 §6.2): what is registered on this account, with rename and remove.
 *
 * Deliberately user-facing rather than an administrator tool — a passkey belongs to the person
 * holding the device. Removing one never removes the last way in, because the password stays.
 */
import { useState } from "react";
import toast from "react-hot-toast";
import { KeyRound, Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import { usePasskey, type PasskeyInfo } from "../hooks/usePasskey";

const TRANSPORT_LABEL: Record<string, string> = {
  internal: "This device",
  hybrid: "Phone or tablet",
  usb: "Security key",
  nfc: "NFC key",
  ble: "Bluetooth key",
};

function when(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}

export function PasskeyManager() {
  const { passkeys, loading, isSupported, registerPasskey, renamePasskey, removePasskey } = usePasskey({ autoLoad: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const add = async () => {
    try {
      const created = await registerPasskey();
      toast.success(`Passkey registered${created?.deviceName ? ` — ${created.deviceName}` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Passkey registration failed");
    }
  };

  const saveName = async (passkey: PasskeyInfo) => {
    try {
      await renamePasskey(passkey.id, draftName.trim());
      toast.success("Passkey renamed");
      setEditingId(null);
    } catch {
      toast.error("That name could not be saved");
    }
  };

  const remove = async (passkey: PasskeyInfo) => {
    try {
      await removePasskey(passkey.id);
      toast.success("Passkey removed");
      setConfirmId(null);
    } catch {
      toast.error("That passkey could not be removed");
    }
  };

  return (
    <div className="card scroll-mt-6" id="passkeys">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-cyber-400" />
          <h3 className="font-semibold text-white">Passkeys</h3>
        </div>
        <button className="btn-primary text-xs py-1.5 px-3" onClick={add} disabled={loading || !isSupported}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : "Add passkey"}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password. Your password keeps working as a fallback.
      </p>

      {!isSupported && (
        <p className="text-xs text-amber-300/80 mb-3">This browser cannot use passkeys. Use a current browser over HTTPS to register one.</p>
      )}

      {passkeys.length === 0 ? (
        <p className="text-sm text-gray-500">No passkeys registered yet.</p>
      ) : (
        <div className="divide-y divide-surface-border/60">
          {passkeys.map(passkey => (
            <div key={passkey.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                {editingId === passkey.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="input-field text-sm py-1"
                      value={draftName}
                      autoFocus
                      maxLength={60}
                      onChange={e => setDraftName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") void saveName(passkey); if (e.key === "Escape") setEditingId(null); }}
                      aria-label={`Name for ${passkey.deviceName || "passkey"}`}
                    />
                    <button className="text-green-400 hover:text-green-300" onClick={() => void saveName(passkey)} aria-label="Save name"><Check size={16} /></button>
                    <button className="text-gray-500 hover:text-gray-300" onClick={() => setEditingId(null)} aria-label="Cancel rename"><X size={16} /></button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-white truncate">{passkey.deviceName || "Unnamed device"}</p>
                    <p className="text-xs text-gray-500">
                      Added {when(passkey.createdAt)} · Last used {when(passkey.lastUsedAt)}
                      {passkey.transports.length > 0 && <> · {passkey.transports.map(t => TRANSPORT_LABEL[t] ?? t).join(", ")}</>}
                    </p>
                  </>
                )}
              </div>
              {editingId !== passkey.id && (
                <div className="flex items-center gap-2 shrink-0">
                  {confirmId === passkey.id ? (
                    <>
                      <span className="text-xs text-gray-400">Remove?</span>
                      <button className="text-rose-400 hover:text-rose-300 text-xs font-medium" onClick={() => void remove(passkey)}>Yes</button>
                      <button className="text-gray-500 hover:text-gray-300 text-xs" onClick={() => setConfirmId(null)}>No</button>
                    </>
                  ) : (
                    <>
                      <button
                        className="text-gray-500 hover:text-white"
                        onClick={() => { setEditingId(passkey.id); setDraftName(passkey.deviceName || ""); }}
                        aria-label={`Rename ${passkey.deviceName || "passkey"}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="text-gray-500 hover:text-rose-400"
                        onClick={() => setConfirmId(passkey.id)}
                        aria-label={`Remove ${passkey.deviceName || "passkey"}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
