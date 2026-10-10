/**
 * Enrolling a second factor: choosing how, proving it works, and keeping what you are given.
 *
 * This is the one component for both moments a second factor is set up — the **gate**, which holds the
 * whole application until it is done, and **My Account**, where somebody changes the method they
 * already have. It is written once because the steps, the calls and the words are the same in both;
 * what changes is where it is mounted and whether it may be put off.
 *
 * Two designs, deliberately, because the two interfaces read differently:
 *
 *  · **Modern** — a sheet whose top line is the question ("how would you like to prove it is you?"),
 *    with the three steps shown as a **track you step along** rather than a numbered list, methods as
 *    cards **you press** (a sentence about what each one is, and the reason beside the ones that
 *    cannot be chosen), and the acting control sitting next to the sentence that explains it: "Send me
 *    a code" beside the address it goes to, "Verify and continue" beside the field.
 *  · **Classic** — a form: a labelled Method select in a grid, the fields for the chosen method under
 *    it, a checkbox that has to be ticked before Save will do anything, and Save/Cancel. The methods
 *    that cannot be chosen stay in the select as disabled options, each naming the reason, because the
 *    question "why can I not use my passkey" is answered by seeing it refused beside the others.
 *
 * Neither is a restyle of the other. The shared part is the state, the API calls and the words.
 *
 * Three things about the sequence are decisions rather than consequences:
 *
 *  · **The methods are the server's.** The list comes from `policy.catalogue`, so a method switched
 *    off in configuration is shown refused (with the area that governs it) instead of vanishing, and
 *    a method this build has never heard of is still offered if the deployment says so.
 *  · **A passkey cannot be the first method.** Registering one needs a signed-in session, and a
 *    session needs a second factor once one is required — so it is listed with that reason and a
 *    pointer to My Account, which is where it can be added afterwards.
 *  · **The recovery codes are acknowledged, not just shown.** They are issued once and can never be
 *    fetched again, so the last step will not finish until the person says they have stored them; the
 *    policy is not refreshed (and the gate does not open) until that moment.
 */
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Download, Fingerprint,
  Image as ImageIcon, Key, Loader2, LogOut, Mail, ShieldCheck, Smartphone, X,
} from "lucide-react";
import api from "../../api";
import { apiErrorMessage } from "../../lib/apiError";
import { useAuth } from "../../hooks/useAuth";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { copyText } from "../../lib/menuActions";
import { readEnrolmentFromImage, formatSecret, type DecodedEnrolment } from "../../lib/qrEnrolment";
import { Permission, type MfaMethodId } from "@C7NTAX/shared";
import {
  daysLeftInWords, governedByHref, governedByLabel, mfaCatalogue, mfaMethodName,
  mfaMethodUnavailableReason, mfaMethodsForFirstEnrolment, recoveryCodesAsText,
  type MfaPolicyView,
} from "../../lib/mfa";

type Step = "choose" | "totp" | "email" | "codes" | "done";

const METHOD_ICON: Record<MfaMethodId, typeof Smartphone> = {
  totp: Smartphone,
  passkey: Fingerprint,
  email_code: Mail,
};

export function MfaEnrolWizard({
  policy: initialPolicy,
  mode = "gate",
  onEnrolled,
  onDismiss,
  onSignOut,
}: {
  /** The policy as the caller already knows it. The catalogue is fetched if it is not carried. */
  policy: MfaPolicyView | null;
  /** "gate" holds the whole application; "manage" is the same wizard from My Account. */
  mode?: "gate" | "manage";
  /** Called once the codes have been acknowledged and there is nothing left to do. */
  onEnrolled: () => void;
  /** Only offered inside the grace period — never from the gate, which is the point of a gate. */
  onDismiss?: () => void;
  onSignOut?: () => void;
}) {
  const modern = useModernInterface();
  const { permissions, refreshMfaPolicy } = useAuth();

  const [policy, setPolicy] = useState<MfaPolicyView | null>(initialPolicy);
  const [step, setStep] = useState<Step>("choose");
  const [chosen, setChosen] = useState<MfaMethodId | null>(null);
  const [pending, setPending] = useState<MfaMethodId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Authenticator enrolment.
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<{ matches: boolean; enrolment: DecodedEnrolment } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Emailed-code enrolment.
  const [emailSent, setEmailSent] = useState(false);
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [emailMinutes, setEmailMinutes] = useState(15);
  const [emailCode, setEmailCode] = useState("");

  // Recovery codes: shown once, and the acknowledgement is what unlocks the finish.
  const [codes, setCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  const catalogue = mfaCatalogue(policy);
  const choosable = mfaMethodsForFirstEnrolment(policy);
  const canReadConfig = permissions.includes(Permission.SystemConfig);
  const pendingMethod = pending ? catalogue.find((method) => method.id === pending) : undefined;
  const emailFlow = chosen === "email_code" || (chosen === null && pending === "email_code");
  const reasonsForRefusedMethods = catalogue.filter((method) => !(method.offered && method.standalone));

  /*
   * The catalogue arrives only with `GET /auth/mfa/policy`, while the gate is usually mounted from
   * the policy the sign-in response carried. Asking once is enough: the answer also refreshes the
   * deadline, which does not change because the wizard opened.
   */
  useEffect(() => {
    if (policy?.catalogue) return;
    void refreshMfaPolicy().then((next) => {
      if (next) setPolicy(next);
    });
  }, [policy?.catalogue, refreshMfaPolicy]);

  /** Start whichever flow was chosen, minting the authenticator seed or sending the code. */
  const chooseMethod = async (method: MfaMethodId) => {
    setChosen(method);
    setError(null);
    setBusy(true);
    try {
      if (method === "totp") {
        setStep("totp");
        const res = await api.post("/auth/mfa/setup");
        setQrCode(res.data.qrCode as string);
        setSecret(res.data.secret as string);
        setRead(null);
      } else if (method === "email_code") {
        setStep("email");
        await sendEmailCode();
      }
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "That method could not be started. Try another one."));
      setStep("choose");
      setChosen(null);
    } finally {
      setBusy(false);
    }
  };

  const sendEmailCode = async () => {
    setError(null);
    try {
      const res = await api.post("/auth/mfa/enrol/email/start");
      setEmailSent(true);
      setEmailAddress((res.data.email as string | undefined) ?? null);
      setEmailMinutes(Number(res.data.expiresInMinutes ?? 15));
    } catch (err: unknown) {
      /*
       * A refused relay is the interesting failure and it has its own answer: the API says the code
       * could not be sent, so the screen has to say that plainly rather than wait for a code that is
       * never coming, and point at the method that does not need it.
       */
      setEmailSent(false);
      setError(
        apiErrorMessage(
          err,
          "That code could not be sent — the mail server refused it. Use an authenticator app instead.",
        ),
      );
    }
  };

  const verifyTotp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/auth/mfa/verify-setup", { code: totpCode });
      const issued = Array.isArray(res.data.backupCodes) ? (res.data.backupCodes as string[]) : [];
      setCodes(issued);
      setStep("codes");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "That code did not work. Wait for the next one and try again."));
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/mfa/enrol/email/verify", { code: emailCode });
      setStep("done");
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "That code did not work. Ask for a new one and try again."));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The finish, and the only place the policy is refreshed.
   *
   * Deliberately not refreshed when the enrolment succeeded: the moment it is refreshed the gate sees
   * `mustEnrolNow` false and unmounts this wizard — which would throw away the recovery codes before
   * the person had written them down. The gate opens on acknowledgement instead.
   */
  const finish = async () => {
    setBusy(true);
    try {
      await refreshMfaPolicy();
    } finally {
      setBusy(false);
      onEnrolled();
    }
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
        setError(result.reason);
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

  const downloadCodes = () => {
    const blob = new Blob([recoveryCodesAsText(codes)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "c7ntax-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const dismissable = !policy?.mustEnrolNow && !!onDismiss;

  const backToChoose = () => {
    setStep("choose");
    setChosen(null);
    setError(null);
    setQrCode(null);
    setSecret("");
    setEmailSent(false);
    setEmailCode("");
    setTotpCode("");
  };

  const heading = policy?.mustEnrolNow
    ? "Set up a second factor to continue"
    : mode === "manage"
      ? "Your second factor"
      : "Set up a second factor";
  const intro = policy?.mustEnrolNow
    ? "Your account needs a second way to prove it is you, and this deployment is enforcing that now. Nothing else in the application opens until it is done."
    : policy?.mustEnrol
      ? `${daysLeftInWords(policy.daysLeft)} — set one up now, or come back before then.`
      : "A second factor is a second proof of who you are: a code from an app, a code by email, or a passkey on your device.";

  const stepIndex = step === "choose" ? 0 : step === "totp" || step === "email" ? 1 : 2;
  const track = ["Choose a method", "Prove it works", emailFlow ? "Finish" : "Save your recovery codes"];

  const errorPanel = error ? (
    <div role="alert" className="rounded-lg border border-alert-red/35 bg-alert-red/10 px-3 py-2 text-[12.5px] text-gray-300">
      <p className="flex items-start gap-2">
        <AlertTriangle size={13} className="mt-[2px] shrink-0 text-alert-red" />
        <span>{error}</span>
      </p>
    </div>
  ) : null;

  /** Why a method cannot be chosen, and where an administrator would change it. */
  const refusalNote = (method: (typeof catalogue)[number]) => (
    <>
      {mfaMethodUnavailableReason(method, policy)}
      {!method.offered && canReadConfig && (
        <>
          {" "}
          <a
            href={governedByHref(method.governedBy.sectionId)}
            className="underline underline-offset-2 hover:text-amber-200"
            title={`Open ${governedByLabel(method.governedBy.sectionId)}`}
          >
            Open it
          </a>
        </>
      )}
    </>
  );

  /** The authenticator pair: what to scan, and the key underneath for a hand-typed fallback. */
  const authenticatorPanel = (
    <>
      {qrCode ? (
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-xl bg-white p-3">
            <img src={qrCode} alt="Authenticator enrolment QR code" className="h-40 w-40" />
          </div>
          <div className="w-full">
            <p className="mb-1 text-center text-[11px] text-gray-500">Or enter this key by hand:</p>
            <div className="flex items-center gap-2 rounded-lg bg-surface-lighter px-3 py-2">
              <Key size={13} className="shrink-0 text-gray-500" />
              <code className="flex-1 break-all font-mono text-[11.5px] text-white">{formatSecret(secret)}</code>
              <button
                type="button"
                onClick={() => void copyText(formatSecret(secret), "Enrolment key")}
                className="shrink-0 text-gray-500 transition-colors hover:text-white"
                title="Copy the key"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
          {/* The screen that showed the QR is often gone by the time somebody needs the key, and a
              screenshot is the only copy left. */}
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void readScreenshot(file);
            }}
            className={`w-full rounded-lg border border-dashed p-2.5 text-center transition-colors ${dragging ? "border-cyber-500 bg-cyber-600/5" : "border-surface-border"}`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void readScreenshot(file); }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="inline-flex items-center gap-1.5 text-[11.5px] text-gray-400 hover:text-white"
            >
              <ImageIcon size={12} />
              {reading ? "Reading the image…" : "Drop a screenshot of the QR here, or choose a file"}
            </button>
            <p className="mt-1 text-[10px] text-gray-600">The image is read in this browser and is not uploaded.</p>

            {read && (
              <div className={`mt-2 rounded-lg p-2 text-left text-[11.5px] ${read.matches ? "bg-emerald-600/10 text-emerald-300" : "bg-red-600/10 text-red-300"}`}>
                {read.matches ? (
                  <p className="flex items-center gap-1.5"><Check size={12} /> This is the enrolment code for this account. The key above is the one to type.</p>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5"><X size={12} /> That QR belongs to a different enrolment, so it is not used here.</p>
                    <p className="mt-1 text-gray-400">
                      It carries {read.enrolment.issuer ? `the issuer “${read.enrolment.issuer}”` : "no issuer"}
                      {read.enrolment.label ? ` and the account “${read.enrolment.label}”` : ""}. Codes from it will not be accepted by this account.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[11.5px] text-gray-500">
          <Loader2 size={12} className="animate-spin" /> Preparing an enrolment code…
        </p>
      )}
    </>
  );

  /** The ten codes, and the acknowledgement that is the only way past them. */
  const codesPanel = (asTextarea: boolean) => (
    <>
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
        <p className="text-[11.5px] leading-relaxed text-amber-100/90">
          These {codes.length || "ten"} codes are shown <b className="font-semibold">once</b>. Each works
          once, and they are the only way in when your usual method is not with you. Store them somewhere
          that is not the device you sign in with.
        </p>
      </div>

      {asTextarea ? (
        <textarea
          readOnly
          rows={11}
          value={codes.join("\n")}
          className="input-field mt-3 font-mono text-[12px] tracking-wide"
          aria-label="Recovery codes"
        />
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg bg-surface-lighter p-3">
          {codes.map((code) => (
            <code key={code} className="font-mono text-[12.5px] tracking-wide text-white">{code}</code>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => void copyText(codes.join("\n"), "Recovery codes")}>
          <Copy size={12} /> Copy
        </button>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={downloadCodes}>
          <Download size={12} /> Download
        </button>
        <span className="text-[11px] text-gray-500">{codes.length} codes</span>
      </div>

      <label className="mt-3 flex items-start gap-2 text-[12px] text-gray-300">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyber-500"
        />
        I have stored these recovery codes somewhere safe.
      </label>
    </>
  );

  /** The six-digit field, with a real label rather than a placeholder. */
  const digitField = (value: string, onChange: (next: string) => void, id: string, label: string) => (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input-field text-center font-mono text-xl tracking-[0.28em]"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        placeholder="000000"
      />
    </div>
  );

  // ══ The modern interface: a sheet, a track to step along, methods you press ═══════════════════
  if (modern) {
    return (
      <section
        className={`w-full overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl ${mode === "gate" ? "max-w-xl" : ""}`}
        aria-labelledby="mfa-wizard-title"
      >
        <header className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/20 text-cyber-300">
            <ShieldCheck size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="mfa-wizard-title" className="font-semibold text-white">{heading}</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">{intro}</p>
          </div>
        </header>

        {/* The steps, as a track: reached, current, and the one that cannot be reached yet. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-border px-5 py-3">
          {track.map((label, index) => {
            const current = index === stepIndex;
            const reached = index <= stepIndex;
            return (
              <span
                key={label}
                aria-current={current ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
                  current
                    ? "border-cyber-500/60 bg-cyber-600/15 text-white"
                    : reached
                      ? "border-surface-border text-gray-300"
                      : "border-surface-border/60 text-gray-500"
                }`}
              >
                {index < stepIndex && <Check size={10} />}
                {label}
              </span>
            );
          })}
        </div>

        <div className="space-y-3.5 px-5 py-5">
          {errorPanel}

          {step === "choose" && (
            <>
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                How would you like to prove it is you, the next time you sign in?
              </p>
              <div className="space-y-2">
                {catalogue.length === 0 && (
                  <p className="rounded-lg border border-surface-border bg-surface-lighter px-3 py-2 text-xs text-gray-400">
                    This deployment has not listed any second-factor methods. Ask an administrator to
                    review Multi-factor authentication in Configuration.
                  </p>
                )}
                {catalogue.map((method) => {
                  const usable = method.offered && method.standalone;
                  const Icon = METHOD_ICON[method.id];
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => void chooseMethod(method.id)}
                      disabled={!usable || busy}
                      className={`flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors ${
                        usable
                          ? "border-surface-border bg-surface-lighter hover:border-cyber-500/60 hover:bg-cyber-600/10"
                          : "cursor-not-allowed border-surface-border/60 bg-surface-lighter/40"
                      }`}
                    >
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${usable ? "bg-cyber-600/20 text-cyber-300" : "bg-surface-border/60 text-gray-600"}`}>
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium ${usable ? "text-white" : "text-gray-500"}`}>{method.label}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-gray-500">{method.summary}</span>
                        {!usable && (
                          <span className="mt-1 block text-[11.5px] leading-relaxed text-amber-300/90">{refusalNote(method)}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === "totp" && (
            <>
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                Scan this with Microsoft Authenticator, 1Password, Authy or any other authenticator app,
                then type the six digits it shows.
              </p>
              {authenticatorPanel}
              <form onSubmit={verifyTotp} className="space-y-3.5">
                {digitField(totpCode, setTotpCode, "mfa-totp-code", "Six digits from the app")}
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5" onClick={backToChoose} disabled={busy}>
                    <ArrowLeft size={13} /> Another method
                  </button>
                  <button className="btn-primary flex flex-1 items-center justify-center gap-2" type="submit" disabled={busy || totpCode.length !== 6}>
                    {busy ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : <><Check size={15} /> Verify and continue</>}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === "email" && (
            <>
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                A six-digit code is sent to the address on your account
                {emailAddress ? <> — <b className="font-semibold text-gray-300">{emailAddress}</b></> : null}.
                Emailed codes are the one method that needs something outside the application to work, so
                if nothing arrives, an authenticator app needs no mail server at all.
              </p>
              <form onSubmit={verifyEmail} className="space-y-3.5">
                {emailSent ? (
                  <>
                    <p className="flex items-start gap-1.5 text-[11.5px] text-gray-500">
                      <Check size={12} className="mt-[3px] shrink-0 text-alert-green" />
                      A code is on its way; it expires in {emailMinutes} minutes.
                    </p>
                    {digitField(emailCode, setEmailCode, "mfa-email-code", "Six-digit code from the email")}
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5" onClick={backToChoose} disabled={busy}>
                        <ArrowLeft size={13} /> Another method
                      </button>
                      <button className="btn-primary flex flex-1 items-center justify-center gap-2" type="submit" disabled={busy || emailCode.length !== 6}>
                        {busy ? <><Loader2 size={15} className="animate-spin" /> Checking…</> : <><Check size={15} /> Verify and continue</>}
                      </button>
                    </div>
                    <button type="button" className="text-[11.5px] text-gray-400 underline underline-offset-2 hover:text-white" onClick={() => void sendEmailCode()} disabled={busy}>
                      Send me another code
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5" onClick={backToChoose} disabled={busy}>
                      <ArrowLeft size={13} /> Another method
                    </button>
                    <button type="button" className="btn-primary flex flex-1 items-center justify-center gap-2" onClick={() => void sendEmailCode()} disabled={busy}>
                      {busy ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Mail size={15} /> Send me a code</>}
                    </button>
                  </div>
                )}
              </form>
            </>
          )}

          {step === "codes" && (
            <>
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                Your authenticator is working. Before you finish, take the recovery codes — they are
                issued now and can never be shown again.
              </p>
              {codesPanel(false)}
              <div className="flex items-center gap-2">
                {dismissable && (
                  <button type="button" className="btn-secondary shrink-0" onClick={onDismiss} disabled={busy}>
                    Remind me later
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary flex flex-1 items-center justify-center gap-2"
                  onClick={() => void finish()}
                  disabled={busy || !acknowledged}
                >
                  {busy ? <><Loader2 size={15} className="animate-spin" /> Finishing…</> : <><Check size={15} /> Finish</>}
                </button>
              </div>
              {!acknowledged && (
                <p className="text-[11px] text-gray-500">
                  Tick the box once the codes are stored — this is the only chance to save them.
                </p>
              )}
            </>
          )}

          {step === "done" && (
            <>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-300">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">Code by email is now your second factor</h3>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                    Signing in will now ask for a code sent to your address. If you would rather use an
                    authenticator app, add one from My Account → Two-Factor Authentication — it takes
                    about a minute, and it then becomes the method you are asked for.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {dismissable && (
                  <button type="button" className="btn-secondary shrink-0" onClick={onDismiss} disabled={busy}>
                    Later
                  </button>
                )}
                <button type="button" className="btn-primary flex flex-1 items-center justify-center gap-2" onClick={() => void finish()} disabled={busy}>
                  {busy ? <><Loader2 size={15} className="animate-spin" /> Finishing…</> : <><Check size={15} /> Finish</>}
                </button>
              </div>
            </>
          )}
        </div>

        {(onSignOut || dismissable) && (
          <footer className="flex items-center justify-between gap-2 border-t border-surface-border px-5 py-3">
            <span className="text-[11px] text-gray-600">
              {policy?.mustEnrolNow ? "This step is required by your administrator." : `You can change this at any time. ${policy?.enrolled ? `Currently ${mfaMethodName(policy, policy.method)}.` : ""}`}
            </span>
            <span className="flex items-center gap-3">
              {dismissable && step === "choose" && (
                <button type="button" className="text-[11.5px] text-gray-400 underline underline-offset-2 hover:text-white" onClick={onDismiss}>
                  Remind me later
                </button>
              )}
              {onSignOut && (
                <button type="button" className="inline-flex items-center gap-1.5 text-[11.5px] text-gray-500 hover:text-white" onClick={onSignOut}>
                  <LogOut size={12} /> Sign out
                </button>
              )}
            </span>
          </footer>
        )}
      </section>
    );
  }

  // ══ The classic interface: a form — labelled fields, Save and Cancel ══════════════════════════
  return (
    <div className={`card space-y-4 ${mode === "gate" ? "w-full max-w-lg" : ""}`}>
      <div className="flex items-start gap-3">
        <ShieldCheck size={22} className="mt-0.5 shrink-0 text-cyber-400" />
        <div>
          <h2 className="font-semibold text-white">{heading}</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">{intro}</p>
        </div>
      </div>

      {errorPanel}

      {step === "choose" && (
        <div className="grid gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="mfa-method">Method</label>
            <select
              id="mfa-method"
              className="input-field"
              value={pending ?? ""}
              onChange={(event) => { setPending(event.target.value as MfaMethodId); setError(null); }}
              disabled={busy || choosable.length === 0}
            >
              <option value="">Choose a method…</option>
              {catalogue.map((method) => {
                const usable = method.offered && method.standalone;
                return (
                  <option key={method.id} value={method.id} disabled={!usable}>
                    {usable
                      ? method.label
                      : `${method.label} — ${method.offered ? "cannot be your first method" : "not offered"}`}
                  </option>
                );
              })}
            </select>
            {pendingMethod && <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">{pendingMethod.summary}</p>}
          </div>

          {reasonsForRefusedMethods.length > 0 && (
            <ul className="space-y-1 text-[11.5px] leading-relaxed text-gray-500">
              {reasonsForRefusedMethods.map((method) => (
                <li key={method.id}>
                  <span className="text-gray-400">{method.label}:</span> {refusalNote(method)}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            {dismissable && (
              <button type="button" className="btn-secondary" onClick={onDismiss}>Cancel</button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !pending || !choosable.some((method) => method.id === pending)}
              onClick={() => { if (pending) void chooseMethod(pending); }}
            >
              {busy ? "Starting…" : "Continue"}
            </button>
            {onSignOut && (
              <button type="button" className="ml-auto text-xs text-gray-500 hover:text-white" onClick={onSignOut}>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}

      {step === "totp" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">1. Scan the code with your authenticator app</p>
          {authenticatorPanel}

          <form onSubmit={verifyTotp} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="mfa-totp-classic">
                2. Code from the app
              </label>
              <input
                id="mfa-totp-classic"
                className="input-field text-center text-2xl tracking-widest"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary" onClick={backToChoose} disabled={busy}>Cancel</button>
              <button className="btn-primary" type="submit" disabled={busy || totpCode.length !== 6}>
                {busy ? "Verifying…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {step === "email" && (
        <form onSubmit={verifyEmail} className="space-y-4">
          <p className="text-xs leading-relaxed text-gray-400">
            A six-digit code is sent to the address on your account
            {emailAddress ? <> (<b className="font-semibold text-gray-300">{emailAddress}</b>)</> : null}.
            {emailSent ? ` It expires in ${emailMinutes} minutes.` : ""}
          </p>

          {emailSent && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="mfa-email-classic">Code from the email</label>
              <input
                id="mfa-email-classic"
                className="input-field text-center text-2xl tracking-widest"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={emailCode}
                onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                autoFocus
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" onClick={backToChoose} disabled={busy}>Cancel</button>
            {emailSent ? (
              <>
                <button className="btn-primary" type="submit" disabled={busy || emailCode.length !== 6}>
                  {busy ? "Verifying…" : "Save"}
                </button>
                <button type="button" className="text-xs text-gray-500 underline underline-offset-2 hover:text-white" onClick={() => void sendEmailCode()} disabled={busy}>
                  Send another
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary" onClick={() => void sendEmailCode()} disabled={busy}>
                {busy ? "Sending…" : "Send the code"}
              </button>
            )}
          </div>
        </form>
      )}

      {step === "codes" && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-gray-400">
            Your authenticator is working. Store these recovery codes now — they are shown once and
            cannot be retrieved later.
          </p>
          {codesPanel(true)}
          <div className="flex items-center gap-2">
            {dismissable && (
              <button type="button" className="btn-secondary" onClick={onDismiss} disabled={busy}>Cancel</button>
            )}
            <button type="button" className="btn-primary" onClick={() => void finish()} disabled={busy || !acknowledged}>
              {busy ? "Finishing…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-gray-400">
            <b className="font-semibold text-white">Code by email</b> is now your second factor. Signing in
            will ask for a code sent to your address. An authenticator app can be added later under
            Two-Factor Authentication, and becomes the method you are asked for.
          </p>
          <div className="flex items-center gap-2">
            {dismissable && (
              <button type="button" className="btn-secondary" onClick={onDismiss} disabled={busy}>Cancel</button>
            )}
            <button type="button" className="btn-primary" onClick={() => void finish()} disabled={busy}>
              {busy ? "Finishing…" : "Done"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
