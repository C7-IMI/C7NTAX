import { useState } from "react";
import { Headset, MailCheck, ShieldCheck } from "lucide-react";
import portalApi, { portalErrorMessage, setPortalToken } from "../../portalApi";
import { ON_ACCENT_COLOUR } from "../../lib/colourTokens";
import { AppFooter } from "../../components/AppFooter";
import { usePortalAuth, portalAccent } from "./PortalApp";

/**
 * Two steps, one screen: an address, then the code that proves the mailbox.
 * The code is never typed into a URL, and the address is never confirmed as existing —
 * the API answers the same way whether or not the address belongs to a portal account.
 */
export function PortalLogin() {
  const { refresh, signedOut, branding, policy } = usePortalAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const accent = portalAccent(branding);
  const title = branding?.name || "Customer portal";

  const sendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await portalApi.post("/auth/request", { email });
      setStep("code");
    } catch (err: unknown) {
      // A 404 means this deployment has not switched the portal on: that is worth saying plainly.
      if ((err as { response?: { status?: number } })?.response?.status === 404) setUnavailable(true);
      else setError(portalErrorMessage(err, "Could not send a code — try again in a moment"));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = (e: React.FormEvent) => { e.preventDefault(); void sendCode(); };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await portalApi.post("/auth/verify", { email, code });
      // The cookie is the real credential; the token is kept for shells that cannot hold one.
      setPortalToken(res.data?.token ?? null);
      await refresh();
    } catch (err: unknown) {
      setError(portalErrorMessage(err, "That code is not valid"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-center gap-3">
          {branding?.logoUrl
            ? <img src={branding.logoUrl} alt={title} className="h-10 w-10 rounded object-contain bg-navy-900" />
            : (
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${accent}1a` }}>
                <Headset size={20} style={{ color: accent }} />
              </div>
            )}
          <div>
            <h1 className="text-lg font-semibold text-white">{title}</h1>
            <p className="text-xs text-gray-400">{policy?.welcomeText || "Sign in to raise and follow your tickets"}</p>
          </div>
        </div>

        {unavailable ? (
          <p className="text-sm text-amber-400">Your provider has not enabled the portal on this deployment. Please contact them by email or phone.</p>
        ) : signedOut && step === "email" && !error ? (
          <p className="text-xs text-gray-500" role="status">Sign in with your email address to continue.</p>
        ) : null}

        {step === "email" ? (
          <form onSubmit={requestCode} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="portal-email">Your email address</label>
              <input
                id="portal-email"
                className="input-field"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
            <button type="submit" className="btn-primary w-full" style={{ backgroundColor: accent, color: ON_ACCENT_COLOUR }} disabled={busy || !email}>
              {busy ? "Sending…" : "Email me a sign-in code"}
            </button>
            <p className="text-xs text-gray-500 flex items-start gap-1.5">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-gray-500" />
              We will email a six-digit code. It works once and expires shortly.
            </p>
            {policy?.supportEmail && (
              <p className="text-xs text-gray-500">
                Trouble signing in? Email{" "}
                <a href={`mailto:${policy.supportEmail}`} className="text-gray-400 hover:text-gray-300">{policy.supportEmail}</a>.
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm text-gray-400 flex items-center gap-1.5"><MailCheck size={14} /> If <span className="text-white">{email}</span> has a portal account, a code is on its way.</p>
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="portal-code">Six-digit code</label>
              <input
                id="portal-code"
                className="input-field tracking-[0.3em] text-center text-lg"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" className="text-gray-500 hover:text-white" onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use a different address</button>
              <button type="button" className="text-gray-500 hover:text-white" onClick={() => void sendCode()}>Send a new code</button>
            </div>
          </form>
        )}
      </div>
      <AppFooter className="mt-4 text-center" />
    </div>
  );
}
