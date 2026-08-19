import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ServiceHealthPanel } from "../components/ServiceHealthPanel";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import api from "../api";
import toast from "react-hot-toast";

export function LoginPage() {
  const { login, loginMfa } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);

  // SSO callback: accept ?token= from the OIDC exchange and store it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      localStorage.setItem("c7_token", token);
      window.history.replaceState({}, "", "/login");
      navigate("/");
    }
  }, [navigate]);

  useEffect(() => {
    api.get("/auth/sso/status").then(r => setSsoEnabled(!!r.data?.enabled)).catch(() => {});
    setPasskeyEnabled(true); // backend gates the endpoints; button shows and errors cleanly if disabled
  }, []);

  const handleSso = () => { window.location.href = "/api/auth/sso/oidc/start"; };

  const handlePasskeyLogin = async () => {
    if (!loginId) { toast.error("Enter your email first"); return; }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/webauthn/login/options", { email: loginId });
      const auth = await startAuthentication(data.options);
      const verify = await api.post("/auth/webauthn/login/verify", { userId: data.userId, response: auth });
      localStorage.setItem("c7_token", verify.data.token);
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Passkey login failed";
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const handlePasskeyRegister = async () => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/webauthn/register/options");
      const reg = await startRegistration(data);
      await api.post("/auth/webauthn/register/verify", reg);
      toast.success("Passkey registered for this device");
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Passkey registration failed (sign in with password first)";
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(loginId, password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken!);
        toast("Enter the code from your authenticator app or email");
      } else {
        navigate(result.landingPage?.path || "/");
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
      const lp = await loginMfa(mfaToken, mfaCode);
      navigate(lp?.path || "/");
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
    <div className="min-h-screen flex items-center justify-center bg-navy-950 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-cyber-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">C7</span>
          </div>
          <h1 className="text-2xl font-bold text-white">C7NTAX</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your PSA dashboard</p>
        </div>
        <form onSubmit={handleLogin} className="card space-y-4">
          <input className="input-field" type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Email or username" required autoFocus />
          <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {(ssoEnabled || passkeyEnabled) && (
          <div className="mt-4 space-y-2">
            {ssoEnabled && (
              <button className="btn-secondary w-full" type="button" onClick={handleSso} disabled={loading}>
                Sign in with SSO (OIDC)
              </button>
            )}
            {passkeyEnabled && (
              <>
                <button className="btn-secondary w-full" type="button" onClick={handlePasskeyLogin} disabled={loading}>
                  {loading ? "Waiting for passkey..." : "Sign in with passkey"}
                </button>
                <button className="btn-secondary w-full" type="button" onClick={handlePasskeyRegister} disabled={loading}>
                  Register passkey on this device
                </button>
              </>
            )}
          </div>
        )}

        {/* Service health status */}
        <div className="mt-6 pt-4 border-t border-surface-border/50">
          <ServiceHealthPanel />
        </div>
      </div>
    </div>
  );
}
