import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useClientIp } from "../hooks/useClientIp";
import { usePasskey } from "../hooks/usePasskey";
import { ServiceHealthPanel } from "../components/ServiceHealthPanel";
import { AppFooter } from "../components/AppFooter";
import { BrandMark } from "../components/BrandMark";
import { Wordmark } from "../components/Wordmark";
import api from "../api";
import toast from "react-hot-toast";

export function LoginPage() {
  const { login, loginMfa, completeSignIn } = useAuth();
  const { registerPasskey, loginWithPasskey, isSupported: passkeySupported } = usePasskey();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const clientIp = useClientIp();

  // A session that ended server-side lands here with a reason so the sign-in page can say why.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("reason");
    if (!reason) return;
    const messages: Record<string, string> = {
      timeout: "You were signed out after a period of inactivity.",
      expired: "Your session ended. Sign in to continue.",
      logout: "You have been signed out.",
    };
    setNotice(messages[reason] ?? "Please sign in to continue.");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState({}, "", query ? `/login?${query}` : "/login");
  }, []);

  // SSO callback: the redirect carries a single-use code, which is exchanged for the
  // token in the body of a POST — the token itself never appears in a URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("sso_code");
    if (!code) return;
    window.history.replaceState({}, "", "/login");
    api.post("/auth/sso/exchange", { code })
      .then(r => completeSignIn(r.data.token))
      .then(() => navigate("/"))
      .catch(() => toast.error("That sign-in link has expired — start again"));
  }, [completeSignIn, navigate]);

  useEffect(() => {
    api.get("/auth/sso/status").then(r => setSsoEnabled(!!r.data?.enabled)).catch(() => {});
  }, []);

  // The button only appears where the browser can actually use a passkey; the API decides
  // separately whether the endpoints exist at all, and reports that as a normal error.
  const passkeyEnabled = passkeySupported;

  const handleSso = () => { window.location.href = "/api/auth/sso/oidc/start"; };

  const handlePasskeyLogin = async () => {
    if (!loginId) { toast.error("Enter your email first"); return; }
    setLoading(true);
    try {
      const issued = await loginWithPasskey(loginId);
      await completeSignIn(issued);
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Passkey login failed";
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const handlePasskeyRegister = async () => {
    setLoading(true);
    try {
      const created = await registerPasskey();
      toast.success(created?.deviceName ? `Passkey registered — ${created.deviceName}` : "Passkey registered for this device");
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
            <BrandMark size={48} className="mx-auto mb-4" />
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
    <div className="min-h-screen flex items-center justify-center bg-navy-950 px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <BrandMark size={56} className="mx-auto mb-4" />
          <h1 className="flex justify-center">
            <Wordmark height={40} className="text-white" />
          </h1>
          <p className="text-gray-400 text-sm mt-2">Sign in to your PSA dashboard</p>
        </div>
        {notice && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          >
            {notice}
          </div>
        )}
        <form onSubmit={handleLogin} className="card space-y-4">
          <input className="input-field" type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Email or username" autoComplete="username webauthn" required autoFocus />
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
        <div className="mt-4 pt-4 border-t border-surface-border/50">
          <ServiceHealthPanel />
          {/* The address the API sees this connection coming from — the one fact that explains a
              sign-in that behaves oddly from a VPN, a proxy or a client's network. */}
          {clientIp && (
            <p
              className="text-[11px] text-gray-500 text-center mt-3"
              title="The address this connection is arriving from"
            >
              Connecting from <span className="text-gray-400 font-mono">{clientIp}</span>
            </p>
          )}
          <AppFooter className="text-center mt-4" />
        </div>
      </div>
    </div>
  );
}
