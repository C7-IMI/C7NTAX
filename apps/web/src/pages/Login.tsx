import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import toast from "react-hot-toast";

export function LoginPage() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken!);
        toast("Enter the code from your authenticator app or email");
      } else {
        navigate("/");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || "Login failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    try {
      await loginMfa(mfaToken, mfaCode);
      navigate("/");
    } catch {
      toast.error("Invalid MFA code");
    } finally {
      setLoading(false);
    }
  };

  if (mfaToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-950 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-cyber-600 flex items-center justify-center mx-auto mb-4">
              <span className="text-white font-bold text-lg">C7</span>
            </div>
            <h1 className="text-xl font-semibold text-white">Two-Factor Authentication</h1>
            <p className="text-gray-400 text-sm mt-2">Enter the 6-digit code from your authenticator app or email</p>
          </div>
          <form onSubmit={handleMfa} className="card space-y-4">
            <input className="input-field text-center text-2xl tracking-widest" type="text" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus />
            <button className="btn-primary w-full" type="submit" disabled={loading || mfaCode.length !== 6}>
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-cyber-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">C7</span>
          </div>
          <h1 className="text-2xl font-bold text-white">C7 Overwatch</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your PSA dashboard</p>
        </div>
        <form onSubmit={handleLogin} className="card space-y-4">
          <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required autoFocus />
          <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
