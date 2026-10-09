/**
 * Signing in — the one page in the application that is outside the shell.
 *
 * A sign-in page is not a dashboard. Its whole job is one question — who are you, and can you prove
 * it — so everything drawn on it either serves that or competes with two fields. The redesigned page
 * is therefore one path for the eye: the mark, one sentence, the way in, the field, the act. Nothing
 * moves, nothing advertises, and the backend's state is one sentence rather than a wall of tiles.
 *
 * **Two designs, deliberately.** This page sits outside the shell, so the switch that decides which
 * interface a person gets has to reach it as well:
 *
 *  · **Redesign** (`redesign`) — the page composed again. The way in is the first choice: a passkey
 *    where the browser has one, a password one press away, both on one shared account field so
 *    switching never loses what was typed. Fields carry real labels rather than placeholders, and a
 *    failure is stated at the field it belongs to instead of in a toast that can expire before it is
 *    read. The instance's state is one sentence derived from the probes that actually answer the
 *    question — `/api/ready` for the database, `/api/health` for the process, in
 *    `components/SignInStatus.tsx` — and the four steps sign-in can take (credentials, second factor,
 *    a password an administrator set, a new passkey) are cards on one surface rather than four screens
 *    on three backgrounds.
 *  · **Classic** (`!redesign`) — the page exactly as it was, kept below rather than rewritten, so
 *    switching the interface off really does give the previous page back: its own `ServiceHealthPanel`,
 *    its toasts, its separate second-factor screen, its placeholder-only fields. Nothing in those two
 *    returns should be tidied — their job is to be what was there before this change arrived.
 *
 * Reverting one browser is `localStorage.setItem("c7_ui_redesign", "0")` and a reload; see
 * INTERFACE-ROLLBACK.md and `lib/uiFlags.ts`. `useRedesign()` resolves on this page without a session:
 * its narrowest layers — the `c7_ui_redesign` flag and a deployment-wide `VITE_UI_REDESIGN=false` —
 * are read from storage and from the build, not from the API. The instance setting behind them
 * (`appearance.interfaceStyle`) is served by `/system/config/app_settings`, which **requires a
 * session**, so on this page that request answers 401 and the hook falls back to its own default,
 * which is the redesign. One browser, or one deployment, therefore reverts this page; an
 * instance-wide "Classic" does not reach a signed-out visitor.
 *
 * Nothing here changes what a sign-in *is*. The routes, the payloads, the lockout, the forced password
 * change, the emailed second-factor code, the session-expiry notice and the `?reason=` handling are the
 * ones that were already there; what changed is where the page says them.
 */
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useClientIp } from "../hooks/useClientIp";
import { usePasskey } from "../hooks/usePasskey";
import { useRedesign } from "../hooks/useNavigationStyle";
import { ServiceHealthPanel } from "../components/ServiceHealthPanel";
import { SignInStatus, type SignInSystem } from "../components/SignInStatus";
import { AppFooter } from "../components/AppFooter";
import { BrandMark } from "../components/BrandMark";
import { Wordmark } from "../components/Wordmark";
import { ChangePasswordForm } from "../components/users/ChangePasswordForm";
import { apiErrorMessage } from "../lib/apiError";
import api from "../api";
import toast from "react-hot-toast";
import {
  AlertTriangle, Check, Eye, EyeOff, Fingerprint, Loader2, Lock, ShieldCheck,
} from "lucide-react";

/**
 * Whether this browser has already been offered a passkey, and declined it.
 *
 * Browser-local on purpose: "not on this machine, thank you" is a fact about the machine, and it is
 * the same kind of preference as the close-ticket dialog's remembered choice. Offered once, after a
 * password sign-in, and never nagged.
 */
const PASSKEY_OFFER_KEY = "c7_passkey_offer";

function passkeyOfferDeclined(): boolean {
  try {
    return localStorage.getItem(PASSKEY_OFFER_KEY) === "1";
  } catch {
    // Storage unavailable (private mode, a hardened browser): treat it as declined rather than
    // offering the same thing on every single sign-in.
    return true;
  }
}

function rememberPasskeyOffer(): void {
  try {
    localStorage.setItem(PASSKEY_OFFER_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Which card the redesigned page is showing. The second factor has its own state — `mfaToken`. */
type Stage = "credentials" | "password-change" | "passkey-offer";

export function LoginPage() {
  const {
    login, loginMfa, completeSignIn, markPasswordChanged, logout, user,
  } = useAuth();
  const { registerPasskey, loginWithPasskey, isSupported: passkeySupported } = usePasskey();
  const navigate = useNavigate();
  const redesign = useRedesign();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const clientIp = useClientIp();

  // ── The redesigned page's own state ────────────────────────────────────────
  /** Which credential is being offered. A passkey is the default where the browser has one. */
  const [method, setMethod] = useState<"passkey" | "password">("passkey");
  const [revealPassword, setRevealPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [stage, setStage] = useState<Stage>("credentials");
  /** Where a successful sign-in was going to land, so a step in between does not lose it. */
  const [landingPath, setLandingPath] = useState("/");
  /** The second factor: the authenticator app, or a code by email. */
  const [delivery, setDelivery] = useState<"totp" | "email">("totp");
  const [emailSent, setEmailSent] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  /** The instance's answer, held here because the form acts on it (see `SignInStatus`). */
  const [system, setSystem] = useState<SignInSystem | null>(null);
  /**
   * The last failure, stated where the person is looking.
   *
   * A node rather than a string, so the sentence can carry the account it is about, plus two things
   * the message alone cannot say: **which field the failure belongs to** (a wrong password marks the
   * password field, a passkey that is not registered marks the account field, and a locked account
   * marks neither — nothing in either field is wrong), and whether the way past it is the other
   * credential, because an account with no passkey yet is a path to change rather than a wall.
   */
  const [error, setError] = useState<{ message: React.ReactNode; on?: "account" | "password"; offerPassword?: boolean } | null>(null);

  /**
   * Where focus goes after a refusal: the field the person is about to change.
   *
   * A toast leaves focus wherever it was — often on a button that now does something else — which is
   * how somebody ends up typing into nothing. Called synchronously in the failure path: both fields
   * are already in the DOM and neither is remounted, so there is nothing to wait for, and deferring
   * would silently do nothing in a browser that is not painting.
   */
  const accountRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusField = (which: "account" | "password") => {
    (which === "password" ? passwordRef.current : accountRef.current)?.focus();
  };

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

  /** The instance cannot serve a sign-in at all, so the page does not pretend that it can. */
  const offline = system !== null && !(system.api && system.db);

  const handleSso = () => { window.location.href = "/api/auth/sso/oidc/start"; };

  const handlePasskeyLogin = async () => {
    if (!loginId) {
      if (redesign) {
        setError({ message: "Enter your email or username first — a passkey is looked up by the account it belongs to.", on: "account" });
        focusField("account");
        return;
      }
      toast.error("Enter your email first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const issued = await loginWithPasskey(loginId);
      await completeSignIn(issued);
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || "Passkey login failed";
      // A passkey that is not on this account, or a prompt that was dismissed, is a path to change
      // rather than a wall: the password is always still a way in.
      if (redesign) { setError({ message: msg, on: "account", offerPassword: true }); focusField("account"); }
      else toast.error(msg);
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

  /**
   * The credentials step, whichever interface is on.
   *
   * A failure goes to a toast on the classic page, because that is the page it is, and to the field on
   * the redesigned one — so the classic branch's own expression is kept verbatim in the `else` below.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(loginId, password);
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken!);
        setMfaError(null);
        if (!redesign) toast("Enter the code from your authenticator app or email");
        return;
      }
      const next = result.landingPage?.path || "/";
      setLandingPath(next);
      if (!redesign) { navigate(next); return; }
      // The account owes a password change: sign-in succeeded, so the step that says why belongs here,
      // on the page that has just taken the temporary password, rather than on a screen that replaces
      // everything and explains nothing.
      if (result.mustChangePassword) setStage("password-change");
      // Otherwise offer the stronger credential, once, at the one moment it can actually be registered.
      else if (passkeyEnabled && !passkeyOfferDeclined()) setStage("passkey-offer");
      else navigate(next);
    } catch (err: unknown) {
      if (redesign) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setError({
          message: status === 423
            ? <><b className="font-semibold text-white">This account is locked.</b> Too many wrong passwords were tried, and an administrator has to unlock it — nothing on this page can.</>
            : status === 401
              ? <>That password doesn’t match the one we hold for <b className="font-semibold text-white">{loginId}</b>.</>
              : apiErrorMessage(err, "Sign in failed"),
          // A locked account is neither field's fault, and a failure the API did not explain gets no
          // accusation at all.
          on: status === 401 ? "password" : undefined,
        });
        focusField(status === 401 ? "password" : "account");
      } else {
        const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || "Login failed";
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /** Enter submits the form the person is looking at: the passkey path has no submit button of its own. */
  const submitCredentials = (e: React.FormEvent) => {
    if (method === "passkey") { void handlePasskeyLogin(); return; }
    void handleLogin(e);
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setMfaError(null);
    try {
      const lp = await loginMfa(mfaToken, mfaCode);
      /*
       * A second factor clears the password, and `loginMfa` cannot say whether a password change is
       * also owed — it returns the landing page, not the account. The app-wide gate still catches that
       * case, so this page does not guess.
       */
      navigate(lp?.path || "/");
    } catch (err: unknown) {
      if (redesign) setMfaError(apiErrorMessage(err, "That code didn’t work. Check the six digits and try again."));
      else toast.error("Invalid MFA code");
    } finally {
      setLoading(false);
    }
  };

  /**
   * The emailed half of the second factor.
   *
   * `POST /auth/send-mfa-email` has been there all along, beside a screen that offered one
   * authenticator field with the word "email" in its caption and no way to use it.
   */
  const requestEmailCode = async () => {
    if (!mfaToken) return;
    setDelivery("email");
    setLoading(true);
    setMfaError(null);
    try {
      await api.post("/auth/send-mfa-email", { mfaToken });
      setEmailSent(true);
    } catch (err: unknown) {
      setMfaError(apiErrorMessage(err, "That code could not be sent — use your authenticator app instead."));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setMfaError(null);
    try {
      const res = await api.post("/auth/mfa/verify-email", { code: mfaCode, mfaToken });
      await completeSignIn(res.data.token);
      navigate(landingPath || "/");
    } catch (err: unknown) {
      setMfaError(apiErrorMessage(err, "That code didn’t work. Codes expire after a few minutes — send yourself a new one."));
    } finally {
      setLoading(false);
    }
  };

  const addPasskeyAndContinue = async () => {
    setLoading(true);
    try {
      const created = await registerPasskey();
      toast.success(created?.deviceName ? `Passkey registered — ${created.deviceName}` : "Passkey registered for this device");
      // Registered: the offer has been taken, so it is not made again in this browser.
      rememberPasskeyOffer();
    } catch (err: unknown) {
      // Left un-remembered on purpose — a prompt that timed out is worth offering again next time.
      toast.error((err as { message?: string })?.message || "Passkey registration failed");
    } finally {
      setLoading(false);
      navigate(landingPath || "/");
    }
  };

  const skipPasskeyOffer = () => {
    rememberPasskeyOffer();
    navigate(landingPath || "/");
  };

  // ══ The redesigned page ═══════════════════════════════════════════════════════════════════════
  if (redesign) {
    return (
      <div className="signin-surface min-h-[100dvh] flex items-center justify-center bg-navy-950 px-4 py-6">
        <div className="w-full max-w-sm">
          <div className="text-center">
            <BrandMark size={48} className="mx-auto mb-3" />
            <h1 className="flex justify-center">
              <Wordmark height={40} className="text-white" />
            </h1>
            <p className="text-gray-500 text-sm mt-2">Sign in to your PSA dashboard</p>
          </div>

          {/* Arrived from a session that ended. Polite, because it interrupts nobody mid-typing, and
              coloured by its edge and icon while the sentence stays a readable text token: on the light
              theme `--alert-amber` is 3.19:1 on white and is not a text colour. */}
          {notice && (
            <p
              role="status"
              className="mt-4 flex items-start gap-2 rounded-lg border border-alert-amber/35 bg-alert-amber/10 px-3 py-2 text-[12.5px] text-gray-300"
            >
              <AlertTriangle size={13} className="mt-[3px] shrink-0 text-alert-amber" />
              <span>{notice}</span>
            </p>
          )}

          {/* ── Credentials ───────────────────────────────────────────────────────────────────── */}
          {!mfaToken && stage === "credentials" && (
            <form onSubmit={submitCredentials} className="card mt-4 space-y-3.5">
              {/* The way in, before the field rather than after the act. Real radios, so the arrow keys
                  move between the two and a screen reader announces which is chosen and what it
                  changed — two divs with aria-pressed announce neither. */}
              {passkeyEnabled && (
                <div className="choice" role="radiogroup" aria-label="How to sign in">
                  <label className={`choice__opt ${method === "passkey" ? "choice__opt--on" : ""}`}>
                    <input
                      type="radio"
                      name="signin-method"
                      checked={method === "passkey"}
                      onChange={() => { setMethod("passkey"); setError(null); }}
                    />
                    <Fingerprint size={14} />
                    Passkey
                  </label>
                  <label className={`choice__opt ${method === "password" ? "choice__opt--on" : ""}`}>
                    <input
                      type="radio"
                      name="signin-method"
                      checked={method === "password"}
                      onChange={() => { setMethod("password"); setError(null); }}
                    />
                    <Lock size={14} />
                    Password
                  </label>
                </div>
              )}

              {/* One account field for both paths, so switching between them loses nothing. */}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-400">Email or username</span>
                {/* Enabled while the request is in flight, deliberately: a disabled input blurs, and
                    a blurred field is where a refusal cannot put the person back to fix it. The act is
                    what goes inert. */}
                <input
                  ref={accountRef}
                  className="input-field"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  autoComplete="username webauthn"
                  required
                  autoFocus
                  aria-invalid={error?.on === "account" ? true : undefined}
                  aria-describedby={error?.on === "account" ? "signin-error" : undefined}
                />
              </label>

              {method === "password" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="signin-password">Password</label>
                  <div className="relative">
                    <input
                      id="signin-password"
                      ref={passwordRef}
                      className="input-field pr-11"
                      type={revealPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      // The field had no autocomplete of its own before, which is why a password manager
                      // could fill the account and not this.
                      autoComplete="current-password"
                      required
                      aria-invalid={error?.on === "password" ? true : undefined}
                      aria-describedby={error ? "signin-error" : undefined}
                      onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                      onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                      onBlur={() => setCapsLock(false)}
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:bg-surface-lighter hover:text-white"
                      aria-pressed={revealPassword}
                      aria-label={revealPassword ? "Hide password" : "Show password"}
                      onClick={() => setRevealPassword((shown) => !shown)}
                    >
                      {revealPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {capsLock && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-gray-300">
                      <AlertTriangle size={12} className="text-alert-amber" />
                      Caps Lock is on.
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div
                  id="signin-error"
                  role="alert"
                  className="rounded-lg border border-alert-red/35 bg-alert-red/10 px-3 py-2 text-[12.5px] text-gray-300"
                >
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-[2px] shrink-0 text-alert-red" />
                    <span>{error.message}</span>
                  </p>
                  {error.offerPassword && (
                    <p className="mt-1.5 pl-[21px]">
                      <button
                        type="button"
                        className="text-gray-400 underline underline-offset-2 hover:text-white"
                        onClick={() => { setMethod("password"); setError(null); }}
                      >
                        Use my password instead
                      </button>
                    </p>
                  )}
                </div>
              )}

              {method === "passkey" ? (
                <button
                  type="button"
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  disabled={loading || offline}
                  onClick={() => void handlePasskeyLogin()}
                >
                  {loading ? (
                    <><Loader2 size={15} className="animate-spin" /> Waiting for passkey…</>
                  ) : (
                    <><Fingerprint size={15} /> Sign in with a passkey</>
                  )}
                </button>
              ) : (
                <button className="btn-primary w-full" type="submit" disabled={loading || offline}>
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              )}

              <p className="text-[11.5px] leading-relaxed text-gray-500">
                {method === "passkey"
                  ? <>Your device asks for your fingerprint, face or PIN, and the password it holds is never sent to C7NTAX. No passkey on this device? Choose <b className="font-semibold text-gray-300">Password</b>.</>
                  : "Trouble signing in? An administrator can unlock the account or reset the password."}
              </p>

              {/* The state below is not decoration: with the instance unable to serve a sign-in, the act
                  above is switched off rather than left to fail after a password has been typed. */}
              {offline && (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gray-300">
                  <AlertTriangle size={12} className="mt-[3px] shrink-0 text-alert-amber" />
                  This stays off until the API answers — with it down, nothing typed here could be checked.
                  The check below re-runs every three seconds, so it comes back by itself.
                </p>
              )}
            </form>
          )}

          {/* ── Second factor ─────────────────────────────────────────────────────────────────── */}
          {mfaToken && (
            <form onSubmit={delivery === "email" ? handleEmailCode : handleMfa} className="card mt-4 space-y-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/20 text-cyber-300">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <h2 className="font-semibold text-white">Two-Factor Authentication</h2>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                    Enter the 6-digit code from your authenticator app or email
                    {loginId ? <> for <b className="font-semibold text-gray-300">{loginId}</b></> : null}.
                  </p>
                </div>
              </div>

              <div className="choice" role="radiogroup" aria-label="Where to get the code">
                <label className={`choice__opt ${delivery === "totp" ? "choice__opt--on" : ""}`}>
                  <input
                    type="radio"
                    name="signin-code-source"
                    checked={delivery === "totp"}
                    onChange={() => { setDelivery("totp"); setMfaError(null); }}
                  />
                  Authenticator app
                </label>
                <label className={`choice__opt ${delivery === "email" ? "choice__opt--on" : ""}`}>
                  <input
                    type="radio"
                    name="signin-code-source"
                    checked={delivery === "email"}
                    onChange={() => { if (!emailSent) void requestEmailCode(); }}
                  />
                  Email me a code
                </label>
              </div>

              {delivery === "email" && emailSent && (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gray-500">
                  <Check size={12} className="mt-[3px] shrink-0 text-alert-green" />
                  A code is on its way. It is six digits and it expires in 15 minutes; a backup code works
                  in this field too.
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="signin-code">6-digit code</label>
                <input
                  id="signin-code"
                  className="input-field text-center font-mono text-xl tracking-[0.28em]"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoFocus
                />
              </div>

              {mfaError && (
                <div role="alert" className="rounded-lg border border-alert-red/35 bg-alert-red/10 px-3 py-2 text-[12.5px] text-gray-300">
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-[2px] shrink-0 text-alert-red" />
                    <span>{mfaError}</span>
                  </p>
                </div>
              )}

              <button className="btn-primary w-full" type="submit" disabled={loading || mfaCode.length !== 6}>
                {loading ? "Verifying…" : "Verify"}
              </button>

              <p className="text-[11.5px] leading-relaxed text-gray-500">
                {delivery === "email" && emailSent
                  ? <>
                      Nothing after a minute?{" "}
                      <button type="button" className="text-gray-400 underline underline-offset-2 hover:text-white" onClick={() => void requestEmailCode()}>Send another code</button>
                      {" · "}
                      {/* A backup code is verified by the authenticator route, so this switches back. */}
                      <button type="button" className="text-gray-400 underline underline-offset-2 hover:text-white" onClick={() => { setDelivery("totp"); setMfaError(null); }}>Use a backup code</button>
                    </>
                  : <>Prefer the code by email? Choose <b className="font-semibold text-gray-300">Email me a code</b>. A backup code works in this field too.</>}
              </p>
            </form>
          )}

          {/* ── A password an administrator set ───────────────────────────────────────────────── */}
          {!mfaToken && stage === "password-change" && (
            <div className="card mt-4">
              {/* The reason comes first, and the step is the card the temporary password was typed on.
                  The form already accepts the password it just collected, so it is not asked for twice. */}
              <ChangePasswordForm
                compact
                currentPassword={password}
                firstName={user?.firstName}
                email={user?.email}
                onChanged={(token) => { markPasswordChanged(token); navigate(landingPath || "/"); }}
                onSignOut={logout}
              />
            </div>
          )}

          {/* ── The stronger credential, offered where it can actually be registered ──────────── */}
          {!mfaToken && stage === "passkey-offer" && (
            <div className="card mt-4 space-y-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/20 text-cyber-300">
                  <Fingerprint size={16} />
                </span>
                <div>
                  <h2 className="font-semibold text-white">Add a passkey to this device?</h2>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                    Next time, signing in is your fingerprint, your face or your PIN instead of a password.
                    Your password keeps working either way, and you can remove a passkey at any time under
                    Settings → Passkeys.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary shrink-0" onClick={skipPasskeyOffer} disabled={loading}>
                  Not now
                </button>
                <button
                  type="button"
                  className="btn-primary flex flex-1 items-center justify-center gap-2"
                  onClick={() => void addPasskeyAndContinue()}
                  disabled={loading}
                >
                  {loading ? <><Loader2 size={15} className="animate-spin" /> Waiting for your device…</> : <><Fingerprint size={15} /> Add a passkey</>}
                </button>
              </div>
            </div>
          )}

          {/* ── The instance's state: one sentence, four services one press away ──────────────── */}
          <SignInStatus onChange={setSystem} />

          {/* The two facts a person can check, kept quiet at the bottom. The address line is absent when
              the API cannot be asked, which is itself the fastest way to see that it is down. */}
          <div className="mt-5 text-center">
            {clientIp && (
              <p className="text-[11px] text-gray-600" title="The address this connection is arriving from">
                Connecting from <span className="text-gray-500 font-mono">{clientIp}</span>
              </p>
            )}
            <AppFooter className="text-center mt-1.5" />
          </div>
        </div>
      </div>
    );
  }

  // ══ The classic interface — the page as it was, below this line, unchanged ════════════════════
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
