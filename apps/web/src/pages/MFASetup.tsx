import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Shield, QrCode, Key } from "lucide-react";

export function MFASetupPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMfaSetup();
  }, []);

  const fetchMfaSetup = async () => {
    try {
      const res = await api.post("/auth/setup-mfa");
      setQrCode(res.data.qrCode);
      setSecret(res.data.secret);
    } catch { toast.error("Failed to load MFA setup"); }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/verify-mfa-setup", { code });
      toast.success("MFA enabled successfully");
    } catch { toast.error("Invalid code"); }
    finally { setLoading(false); }
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
              <code className="text-xs font-mono text-white break-all">{secret}</code>
            </div>
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
