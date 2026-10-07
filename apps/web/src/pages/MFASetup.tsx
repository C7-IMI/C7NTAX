import { useState, useEffect, useRef } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Shield, Key, Image as ImageIcon, Check, X, Copy } from "lucide-react";
import { readEnrolmentFromImage, formatSecret, type DecodedEnrolment } from "../lib/qrEnrolment";
import { copyText } from "../lib/menuActions";

export function MFASetupPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<{ matches: boolean; enrolment: DecodedEnrolment } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchMfaSetup();
  }, []);

  const fetchMfaSetup = async () => {
    try {
      const res = await api.post("/auth/mfa/setup");
      setQrCode(res.data.qrCode);
      setSecret(res.data.secret);
      setRead(null);
    } catch { toast.error("Failed to load MFA setup"); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/mfa/verify-setup", { code });
      toast.success("MFA enabled successfully");
    } catch { toast.error("Invalid code"); }
    finally { setLoading(false); }
  };

  /**
   * Reads the enrolment out of a QR screenshot so the key can be typed by hand. The image never
   * leaves the browser, and a QR that belongs to a different account is reported rather than used:
   * enrolling with a secret that is not this account's would produce an authenticator whose codes
   * the server rejects, with nothing on screen explaining why.
   */
  const readScreenshot = async (file: File) => {
    setReading(true);
    setRead(null);
    try {
      const result = await readEnrolmentFromImage(file);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      const matches = result.enrolment.secret === secret;
      setRead({ matches, enrolment: result.enrolment });
      if (matches) toast.success("That screenshot is this account's enrolment code");
      else toast.error("That screenshot is a QR for a different account or secret");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in pt-8">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-cyber-600/20 text-cyber-400 flex items-center justify-center mx-auto mb-3">
          <Shield size={24} />
        </div>
        <h2 className="text-lg font-semibold text-white">Two-Factor Authentication</h2>
        <p className="text-sm text-gray-400 mt-1">Scan the QR code with your authenticator app</p>
      </div>

      {qrCode && (
        <div className="card flex flex-col items-center space-y-4">
          <div className="bg-white p-4 rounded-xl">
            <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
          </div>
          <div className="w-full">
            <p className="text-xs text-gray-500 mb-1 text-center">Or enter this key manually:</p>
            <div className="flex items-center gap-2 bg-surface-lighter rounded-lg px-3 py-2">
              <Key size={14} className="text-gray-500 shrink-0" />
              <code className="text-xs font-mono text-white break-all flex-1">{formatSecret(secret)}</code>
              <button onClick={() => void copyText(formatSecret(secret), "Enrolment key")} className="text-gray-500 hover:text-white shrink-0" title="Copy the key">
                <Copy size={13} />
              </button>
            </div>
          </div>

          {/* The screen that showed the QR is often gone by the time somebody needs the key, and a
              screenshot is the only copy left. */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void readScreenshot(file);
            }}
            className={`w-full rounded-lg border border-dashed p-3 text-center transition-colors ${dragging ? "border-cyber-500 bg-cyber-600/5" : "border-surface-border"}`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) void readScreenshot(file); }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={reading} className="text-xs text-gray-400 hover:text-white inline-flex items-center gap-1.5">
              <ImageIcon size={13} />
              {reading ? "Reading the image…" : "Drop a screenshot of the QR here, or choose a file"}
            </button>
            <p className="text-[10px] text-gray-600 mt-1">The image is read in this browser and is not uploaded.</p>

            {read && (
              <div className={`mt-2 text-left rounded-lg p-2 text-xs ${read.matches ? "bg-emerald-600/10 text-emerald-300" : "bg-red-600/10 text-red-300"}`}>
                {read.matches ? (
                  <p className="flex items-center gap-1.5"><Check size={12} /> This is the enrolment code for this account. The key above is the one to type.</p>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5"><X size={12} /> That QR belongs to a different enrolment, so it is not used here.</p>
                    <p className="text-gray-400 mt-1">
                      It carries {read.enrolment.issuer ? `the issuer “${read.enrolment.issuer}”` : "no issuer"}
                      {read.enrolment.label ? ` and the account “${read.enrolment.label}”` : ""}. Codes from it will not be accepted by this account.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleVerify} className="space-y-3">
          <label className="block text-sm text-gray-400">Enter 6-digit verification code</label>
          <input className="input-field text-center text-2xl tracking-widest" type="text" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
          <button className="btn-primary w-full" type="submit" disabled={loading || code.length !== 6}>
            {loading ? "Verifying..." : "Enable MFA"}
          </button>
        </form>
      </div>
    </div>
  );
}
