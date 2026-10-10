/**
 * Signing in — the one page in the application that is outside the shell.
 *
 * A sign-in page is not a dashboard. Its whole job is one question — who are you, and can you prove
 * it — so everything drawn on it either serves that or competes with two fields. The Modern page
 * is therefore one path for the eye: the mark, one sentence, the way in, the field, the act. Nothing
 * moves, nothing advertises, and the backend's state is one sentence rather than a wall of tiles.
 *
 * **Two designs, deliberately.** This page sits outside the shell, so the switch that decides which
 * interface a person gets has to reach it as well:
 *
 *  · **Modern** (`modern`) — the page composed again. The way in is the first choice: a passkey
 *    where the browser has one, a password one press away, both on one shared account field so
 *    switching never loses what was typed. Fields carry real labels rather than placeholders, and a
 *    failure is stated at the field it belongs to instead of in a toast that can expire before it is
 *    read. The instance's state is one sentence derived from the probes that actually answer the
 *    question — `/api/ready` for the database, `/api/health` for the process, in
 *    `components/SignInStatus.tsx` — and the four steps sign-in can take (credentials, second factor,
 *    a password an administrator set, a new passkey) are cards on one surface rather than four screens
 *    on three backgrounds.
 *  · **Classic** (`!modern`) — the page exactly as it was, kept below rather than rewritten, so
 *    switching the interface off really does give the previous page back: its own `ServiceHealthPanel`,
 *    its toasts, its separate second-factor screen, its placeholder-only fields. Nothing in those two
 *    returns should be tidied — their job is to be what was there before this change arrived.
 *
 * Reverting one browser is `localStorage.setItem("c7_ui_modern", "0")` and a reload; see
 * INTERFACE-ROLLBACK.md and `lib/uiFlags.ts`. `useModernInterface()` resolves on this page without a session:
 * its narrowest layers — the `c7_ui_modern` flag and a deployment-wide `VITE_UI_MODERN_SCREENS=false` —
 * are read from storage and from the build, not from the API. The instance setting behind them
 * (`appearance.interfaceStyle`) is served by `/system/config/app_settings`, which **requires a
 * session**, so on this page that request answers 401 and the hook falls back to its own default,
 * which is the Modern interface. One browser, or one deployment, therefore reverts this page; an
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
import { useModernInterface } from "../hooks/useNavigationStyle";
import { ServiceHealthPanel } from "../components/ServiceHealthPanel";
import { SignInStatus, type SignInSystem } from "../components/SignInStatus";
import { AppFooter } from "../components/AppFooter";
import { BrandMark } from "../components/BrandMark";
import { Wordmark } from "../components/Wordmark";
import { ChangePasswordForm } from "../components/users/ChangePasswordForm";
import { apiErrorMessage } from "../lib/apiError";
import api from "../api";
import toast from "react-hot-toast";
import type { MfaMethodId } from "@C7NTAX/shared";
import {
  AlertTriangle, Check, Eye, EyeOff, Fingerprint, Loader2, Lock, Mail, ShieldCheck,
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

/** Which card the Modern page is showing. The second factor has its own state — `mfaToken`. */
type Stage = "credentials" | "password-change" | "passkey-offer";

/**
 * The second-factor field takes two kinds of answer, because the API accepts two.
 *
 * A six-digit authenticator code, and a single-use **recovery code** in the form `XXXXX-XXXXX` — which
 * is compared by the same endpoint and answers identically. A field that stripped anything but digits
 * could not express the second of them, which is how a person whose phone is in a drawer ends up
 * needing an administrator. The hyphen is optional on the way in (it is re-inserted before the call)
 * because it is punctuation, not a secret.
 */
function normaliseMfaCode(value: string): string {
  return value.replace(/[^0-9a-zA-Z-]/g, "").toUpperCase().slice(0, 11);
}

function isSixDigits(value: string): boolean {
  return /^\d{6}$/.test(value);
}

function isRecoveryCode(value: string): boolean {
  return /^[A-Z0-9]{5}-?[A-Z0-9]{5}$/.test(value);
}

/** What is sent: the recovery code in its stored shape, or the six digits untouched. */
function codeForApi(value: string): string {
  const upper = value.toUpperCase();
  return /^[A-Z0-9]{10}$/.test(upper) ? `${upper.slice(0, 5)}-${upper.slice(5)}` : upper;
}

function mfaCodeReady(delivery: "totp" | "email", value: string): boolean {
  if (delivery === "email") return isSixDigits(value);
  return isSixDigits(value) || isRecoveryCode(value);
}

export function LoginPage() {
  const {
    login, loginMfa, completeSignIn, markPasswordChanged, logout, user,
  } = useAuth();
  const { registerPasskey, loginWithPasskey, isSupported: passkeySupported } = usePasskey();
  const navigate = useNavigate();
  const modern = useModernInterface();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const clientIp = useClientIp();

  // ── The Modern page's own state ────────────────────────────────────────
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
  /**
   * Which method the challenge is for, as the sign-in said, so the page does not show an authenticator
   * field to somebody whose second factor is an emailed code. And whether emailed codes are available
   * at all: the deployment's own setting is not published to a signed-out visitor, so the option is
   * offered until the API refuses it — at which point it is withdrawn with the reason rather than
   * offered again.
   */
  const [challengeMethod, setChallengeMethod] = useState<MfaMethodId>("totp");
  const [emailUnavailable, setEmailUnavailable] = useState(false);
  /** Days a proved browser may skip the second factor; 0 means the deployment does not remember any. */
  const [rememberDays, setRememberDays] = useState(0);
  const [rememberMe, setRememberMe] = useState(true);
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
      if (modern) {
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
      if (modern) { setError({ message: msg, on: "account", offerPassword: true }); focusField("account"); }
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
   * the Modern one — so the classic branch's own expression is kept verbatim in the `else` below.
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await login(loginId, password);
      if (result.mfaRequired) {
        const token = result.mfaToken!;
        const method = result.mfaMethod ?? "totp";
        setMfaToken(token);
        setMfaError(null);
        setChallengeMethod(method);
        setRememberDays(result.rememberDays ?? 0);
        /*
         * The method decides the field. An account whose second factor is an emailed code gets the code
         * sent straight away, because the alternative is a card asking for six digits that no screen has
         * produced yet, with no way to ask for them.
         */
        setDelivery(method === "email_code" ? "email" : "totp");
        if (!modern) {
          toast(
            method === "email_code"
              ? "Enter the code we are emailing you"
              : "Enter the code from your authenticator app, or a recovery code",
          );
        }
        if (method === "email_code") await sendChallengeEmail(token);
        return;
      }
      const next = result.landingPage?.path || "/";
      setLandingPath(next);
      if (!modern) { navigate(next); return; }
      // The account owes a password change: sign-in succeeded, so the step that says why belongs here,
      // on the page that has just taken the temporary password, rather than on a screen that replaces
      // everything and explains nothing.
      if (result.mustChangePassword) setStage("password-change");
      // Otherwise offer the stronger credential, once, at the one moment it can actually be registered.
      else if (passkeyEnabled && !passkeyOfferDeclined()) setStage("passkey-offer");
      else navigate(next);
    } catch (err: unknown) {
      if (modern) {
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

  /**
   * Ask for the emailed half of the second factor.
   *
   * Takes the token explicitly because the credentials step calls it in the same tick it received the
   * token, before the state carrying it has rendered. A deployment that does not offer emailed codes
   * answers with a refusal — and *that* is what the screen uses to stop offering them, rather than a
   * guess about a setting a signed-out visitor cannot read.
   */
  const sendChallengeEmail = async (token: string, options?: { announceFailure?: boolean }) => {
    setMfaError(null);
    try {
      await api.post("/auth/send-mfa-email", { mfaToken: token });
      setEmailSent(true);
      return true;
    } catch (err: unknown) {
      setEmailSent(false);
      setEmailUnavailable(true);
      setMfaError(
        apiErrorMessage(err, "That code could not be sent — use your authenticator app instead."),
      );
      if (options?.announceFailure && challengeMethod !== "email_code") setDelivery("totp");
      return false;
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setMfaError(null);
    try {
      // A recovery code goes up the same endpoint as an authenticator code, and comes back identically.
      const lp = await loginMfa(mfaToken, codeForApi(mfaCode), {
        remember: rememberDays > 0 ? rememberMe : undefined,
      });
      /*
       * A second factor clears the password, and `loginMfa` cannot say whether a password change is
       * also owed — it returns the landing page, not the account. The app-wide gate still catches that
       * case, so this page does not guess.
       */
      navigate(lp?.path || "/");
    } catch (err: unknown) {
      if (modern) setMfaError(apiErrorMessage(err, "That code didn’t work. Check the six digits and try again."));
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
    // The field is shared between the two kinds of answer, and a recovery code is not a code for an
    // email: leaving it in the box would leave a form that cannot be submitted.
    setMfaCode("");
    setLoading(true);
    await sendChallengeEmail(mfaToken, { announceFailure: true });
    setLoading(false);
  };

  const handleEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    setMfaError(null);
    try {
      const res = await api.post("/auth/mfa/verify-email", {
        code: mfaCode,
        mfaToken,
        ...(rememberDays > 0 ? { remember: rememberMe } : {}),
      });
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

  // ══ The Modern page ═══════════════════════════════════════════════════════════════════════
  if (modern) {
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
                  {delivery === "email" ? <Mail size={16} /> : <ShieldCheck size={16} />}
                </span>
                <div>
                  <h2 className="font-semibold text-white">Two-Factor Authentication</h2>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                    {delivery === "email"
                      ? <>Enter the 6-digit code we sent to the address on your account</>
                      : <>Enter the 6-digit code from your authenticator app</>}
                    {loginId ? <> for <b className="font-semibold text-gray-300">{loginId}</b></> : null}.
                    {delivery === "totp" ? " A recovery code works in this field too." : null}
                  </p>
                </div>
              </div>

              {/* The other way to get a code — but not when the deployment has already refused it, and
                  not for an account whose second factor is the emailed code, where there is nothing to
                  choose between. */}
              {challengeMethod !== "email_code" && !emailUnavailable && (
                <div className="choice" role="radiogroup" aria-label="Where to get the code">
                  <label className={`choice__opt ${delivery === "totp" ? "choice__opt--on" : ""}`}>
                    <input
                      type="radio"
                      name="signin-code-source"
                      checked={delivery === "totp"}
                      onChange={() => { setDelivery("totp"); setMfaCode(""); setMfaError(null); }}
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
              )}

              {delivery === "email" && emailSent && (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-gray-500">
                  <Check size={12} className="mt-[3px] shrink-0 text-alert-green" />
                  A code is on its way. It is six digits and it expires in 15 minutes.
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="signin-code">
                  {delivery === "email" ? "6-digit code" : "Code, or a recovery code"}
                </label>
                <input
                  id="signin-code"
                  className="input-field text-center font-mono text-xl tracking-[0.28em]"
                  type="text"
                  inputMode={delivery === "email" ? "numeric" : "text"}
                  autoComplete="one-time-code"
                  maxLength={delivery === "email" ? 6 : 11}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(delivery === "email" ? e.target.value.replace(/\D/g, "").slice(0, 6) : normaliseMfaCode(e.target.value))}
                  placeholder={delivery === "email" ? "000000" : "000000 or XXXXX-XXXXX"}
                  autoFocus
                />
                {delivery === "totp" && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                    Lost your authenticator? One of the ten recovery codes you were given works here, once
                    each.
                  </p>
                )}
              </div>

              {/* Only where the deployment remembers browsers at all: a control that says it will not
                  ask again, on a deployment whose remember setting is zero, is a promise nobody keeps. */}
              {rememberDays > 0 && (
                <label className="flex items-start gap-2 text-[12px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyber-500"
                  />
                  Don’t ask for a code on this browser for {rememberDays} days
                </label>
              )}

              {mfaError && (
                <div role="alert" className="rounded-lg border border-alert-red/35 bg-alert-red/10 px-3 py-2 text-[12.5px] text-gray-300">
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={13} className="mt-[2px] shrink-0 text-alert-red" />
                    <span>{mfaError}</span>
                  </p>
                </div>
              )}

              <button className="btn-primary w-full" type="submit" disabled={loading || !mfaCodeReady(delivery, mfaCode)}>
                {loading ? "Verifying…" : "Verify"}
              </button>

              <p className="text-[11.5px] leading-relaxed text-gray-500">
                {delivery === "email" && emailSent
                  ? <>
                      Nothing after a minute?{" "}
                      <button type="button" className="text-gray-400 underline underline-offset-2 hover:text-white" onClick={() => void requestEmailCode()}>Send another code</button>
                      {" · "}
                      {/* A recovery code is verified by the authenticator route, so this switches back. */}
                      <button type="button" className="text-gray-400 underline underline-offset-2 hover:text-white" onClick={() => { setDelivery("totp"); setMfaCode(""); setMfaError(null); }}>Use a recovery code</button>
                    </>
                  : challengeMethod === "email_code"
                    ? <>Codes are sent to the address on your account. Nothing else is needed here.</>
                    : emailUnavailable
                      ? <>Emailing a code is not available on this deployment — use your authenticator app, or a recovery code.</>
                      : <>Prefer the code by email? Choose <b className="font-semibold text-gray-300">Email me a code</b>.</>}
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
  //
  // One exception, and it is a change of behaviour rather than of design: the second-factor screen now
  // carries what the API sends. The field accepts a recovery code as well as six digits, the method the
  // sign-in named decides which field is drawn, an emailed code can be asked for, and "don't ask again"
  // is offered only when the deployment remembers browsers. None of that is a restyle — the layout is
  // the one that was here.
  if (mfaToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-950 px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <BrandMark size={48} className="mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white">Two-Factor Authentication</h1>
            <p className="text-gray-400 text-sm mt-2">
              {delivery === "email"
                ? "Enter the 6-digit code we sent to the address on your account"
                : "Enter the code from your authenticator app, or a recovery code"}
            </p>
          </div>
          <form onSubmit={delivery === "email" ? handleEmailCode : handleMfa} className="card space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1" htmlFor="classic-mfa-code">
                {delivery === "email" ? "6-digit code" : "Code or recovery code"}
              </label>
              <input
                id="classic-mfa-code"
                className="input-field text-center text-2xl tracking-widest"
                type="text"
                inputMode={delivery === "email" ? "numeric" : "text"}
                maxLength={delivery === "email" ? 6 : 11}
                value={mfaCode}
                onChange={(e) => setMfaCode(delivery === "email" ? e.target.value.replace(/\D/g, "").slice(0, 6) : normaliseMfaCode(e.target.value))}
                placeholder={delivery === "email" ? "000000" : "000000"}
                autoFocus
              />
            </div>

            {rememberDays > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                Don’t ask again on this browser for {rememberDays} days
              </label>
            )}

            <button className="btn-primary w-full" type="submit" disabled={loading || !mfaCodeReady(delivery, mfaCode)}>
              {loading ? "Verifying..." : "Verify"}
            </button>

            {challengeMethod !== "email_code" && !emailUnavailable && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => { if (delivery === "email") void sendChallengeEmail(mfaToken, { announceFailure: true }); else void requestEmailCode(); }}
                disabled={loading}
              >
                {delivery === "email" && emailSent ? "Send another code by email" : "Email me a code instead"}
              </button>
            )}
            {delivery === "totp" && (
              <p className="text-xs text-gray-500">
                A recovery code can be typed into the same field; each one works once.
              </p>
            )}
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
