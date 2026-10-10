/**
 * My Account → Two-Factor Authentication: the second factor you have, and the wizard that changes it.
 *
 * This is the *manage* half of the feature. The gate in `App.tsx` uses the same wizard (`MfaEnrolWizard`)
 * for somebody who owes a second factor and cannot get past it; here it is opened on purpose by
 * somebody who already signed in, so the same steps may be put off, and the screen leads with what the
 * account has now rather than with the demand.
 *
 * The screen is thin on purpose: everything about *how* a second factor is set up — the methods this
 * deployment offers, the QR code, the emailed code, the ten recovery codes and the acknowledgement
 * they need — belongs to the wizard, and a second copy of it here is how the two would drift. What
 * lives here is the answer to "what do I have?" and the two ways to change it.
 *
 * Two designs, deliberately:
 *
 *  · **Modern** — a sheet: the current method as the largest thing on the screen, a state pill beside
 *    it, the sentence that explains the state, and the acting control next to the sentence.
 *  · **Classic** — a card of labelled rows above a form-style screen: method, status, and a button
 *    that opens the wizard, which is itself a labelled form in this interface.
 */
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { MfaEnrolWizard } from "../components/mfa/MfaEnrolWizard";
import { daysLeftInWords, mfaMethodName } from "../lib/mfa";

export function MFASetupPage() {
  const modern = useModernInterface();
  const { mfaPolicy, refreshMfaPolicy, user } = useAuth();
  const [open, setOpen] = useState(false);
  /** Once the person has opened or closed it themselves, the screen stops deciding for them. */
  const [touched, setTouched] = useState(false);

  // The policy endpoint is the one that carries the method catalogue, so the name of the enrolled
  // method resolves here rather than falling back to its id.
  useEffect(() => {
    void refreshMfaPolicy();
  }, [refreshMfaPolicy]);

  // First touch on this screen for somebody who has nothing enrolled: the wizard is the point of the
  // page, so it is open rather than behind a button.
  useEffect(() => {
    if (!touched && mfaPolicy && !mfaPolicy.enrolled) setOpen(true);
  }, [mfaPolicy, touched]);

  const enrolled = !!mfaPolicy?.enrolled;
  const methodName = enrolled ? mfaMethodName(mfaPolicy, mfaPolicy?.method) : "Not set up";
  const optional = mfaPolicy?.mode === "optional" && !mfaPolicy.required;

  const stateSentence = enrolled
    ? "Signing in asks for this second factor. Changing it here replaces the method you are asked for; anything already trusted keeps working until it expires."
    : mfaPolicy?.mustEnrolNow
      ? "This account has to have a second factor before it can be used."
      : mfaPolicy?.mustEnrol
        ? `${daysLeftInWords(mfaPolicy.daysLeft)} — set one up now, or come back before then.`
        : optional
          ? "Nothing asks you for a second factor yet. Setting one up means a stolen password is not enough to get into your account."
          : "A second factor is a second proof of who you are: a code from an app, a code by email, or a passkey on your device.";

  const wizard = open ? (
    <MfaEnrolWizard
      mode="manage"
      policy={mfaPolicy}
      onEnrolled={() => { setTouched(true); setOpen(false); }}
      onDismiss={() => { setTouched(true); setOpen(false); }}
    />
  ) : null;

  const openWizard = () => { setTouched(true); setOpen(true); };

  if (modern) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 pt-6 animate-fade-in">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyber-600/20 text-cyber-400">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">Two-Factor Authentication</h1>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
              How you prove it is you, after your password.
            </p>
          </div>
        </header>

        <section className="rounded-xl border border-surface-border bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wider text-gray-500">Current method</p>
              <p className="mt-1 text-lg font-semibold text-white">{methodName}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">{stateSentence}</p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                enrolled ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-200"
              }`}
            >
              {enrolled ? "Active" : "Not set up"}
            </span>
            {!open && (
              <button type="button" className="btn-primary shrink-0 text-xs" onClick={openWizard}>
                {enrolled ? "Change method" : "Set it up"}
              </button>
            )}
          </div>
          {enrolled && (
            <p className="mt-3 border-t border-surface-border pt-3 text-[11px] text-gray-600">
              Signed in as {user?.email}. A passkey can also be added from here on a device that supports
              one; it then replaces the code you are asked for on that device.
            </p>
          )}
        </section>

        {wizard}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pt-6 animate-fade-in">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-cyber-600/20 text-cyber-400">
          <ShieldCheck size={24} />
        </div>
        <h1 className="text-lg font-semibold text-white">Two-Factor Authentication</h1>
        <p className="mt-1 text-sm text-gray-400">How you prove it is you, after your password.</p>
      </div>

      <div className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Current method</p>
            <p className="mt-0.5 text-sm text-white">{methodName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Status</p>
            <p className="mt-0.5 text-sm text-white">{enrolled ? "Active" : "Not set up"}</p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">{stateSentence}</p>
        {!open && (
          <button type="button" className="btn-primary" onClick={openWizard}>
            {enrolled ? "Change method" : "Set up two-factor authentication"}
          </button>
        )}
      </div>

      {wizard}
    </div>
  );
}
