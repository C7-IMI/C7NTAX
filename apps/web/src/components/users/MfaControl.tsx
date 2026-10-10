/**
 * One account's second factor, as an administrator sees it.
 *
 * Two questions have to be kept apart, because the API keeps them apart: **what this account has
 * enrolled** (`mfaEnabled` / `mfaMethod` / `mfaEnrolledAt`) and **what the policy asks of it**
 * (`mfaState` / `mfaGraceUntil`). A deployment that requires everybody still has accounts that are
 * exempt, and accounts that hold a factor without being required to hold one — so a screen that shows
 * only one of the two answers is a screen that lies about the other.
 *
 * The consequence of a change is the server's to state. `PATCH /users/:id/mfa` is answered with the
 * resolved `MfaPolicy` for the account, and that object — not this file — is what says "required",
 * "stopped at the next request" or "six days left". On first render there is no policy to read, so the
 * panel shows the account's own facts plus `MFA_STATES`, which is an explanation of the three choices
 * rather than a resolved answer.
 *
 * The list badge (`mfaRowSummary`) reads the account's own columns and nothing else: its state, its
 * enrolment, and its deadline. The deadline is the deployment's own evidence that a requirement began
 * for the account — `startMfaGrace` stamps the accounts a new enforcement applies to, and a per-account
 * requirement writes one — so a past deadline with nothing enrolled is read the way the brief reads it:
 * reminded until the date, stopped after it. Resolving that again from the instance mode in the browser
 * is what would put the column and the door on two different answers; the column does not do it.
 *
 * Two designs, deliberately. **Modern** — the three states are pills you press, each with the sentence
 * that explains it revealed under the chosen one, the facts on a line above, and the reset opening in
 * place as a list of what goes and what happens next. **Classic** — a labelled `Status` field in a
 * grid with a Save beside it, the same choice staged and written once, the facts as read-only fields,
 * and a modal dialog with a heading for the reset. Neither is a restyle of the other.
 */
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-react";
import { MFA_STATES, isMfaState, mfaMethodLabel, type MfaPolicy, type MfaState } from "@C7NTAX/shared";
import api from "../../api";
import { apiErrorMessage } from "../../lib/apiError";
import { useModernInterface } from "../../hooks/useNavigationStyle";

const DAY_MS = 86_400_000;

/** The facts a row needs to say what an account has and what is asked of it. */
export interface MfaRowFacts {
  mfaEnabled?: boolean;
  mfaMethod?: string | null;
  mfaEnrolledAt?: string | null;
  mfaState?: string | null;
  mfaGraceUntil?: string | null;
}

export interface MfaAccount extends MfaRowFacts {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export type MfaTone = "good" | "warn" | "bad" | "muted";

/*
 * One tone, two sets of furniture. "good"/"warn"/"bad" already exist as state chips in the token
 * sheet and as the tinted badges the classic tables use; there is no "muted" chip, so a plain chip and
 * the grey badge stand in for it.
 */
const TONE: Record<MfaTone, { chip: string; badge: string }> = {
  good: { chip: "chip--good", badge: "bg-green-600/20 text-green-400" },
  warn: { chip: "chip--warn", badge: "bg-amber-600/20 text-amber-400" },
  bad: { chip: "chip--bad", badge: "bg-red-600/20 text-red-400" },
  muted: { chip: "", badge: "bg-gray-600/20 text-gray-400" },
};

/** The account's own answer, defaulting when the column holds something unrecognised. */
export function accountMfaState(account: MfaRowFacts): MfaState {
  return isMfaState(account.mfaState) ? account.mfaState : "default";
}

/** Has a second factor: the enrolment date, not `mfaEnabled`, which is false for a passkey. */
export function hasEnrolledSecondFactor(account: MfaRowFacts): boolean {
  return !!account.mfaEnrolledAt;
}

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleDateString();
}

/**
 * The deadline in words.
 *
 * `daysLeft` is passed in when the API resolved the policy for this account, so the number is the
 * server's; the arithmetic here is only the fallback for the first render, where all the page holds is
 * the date the account carries.
 */
function deadlineNote(graceUntil: string | null | undefined, daysLeft: number | null): { text: string; tone: MfaTone } | null {
  if (!graceUntil) return null;
  const at = new Date(graceUntil);
  if (Number.isNaN(at.getTime())) return null;
  const msLeft = at.getTime() - Date.now();
  if (msLeft <= 0) return { text: "Past its deadline", tone: "bad" };
  const days = daysLeft ?? Math.max(0, Math.ceil(msLeft / DAY_MS));
  return { text: days === 1 ? "1 day left" : `${days} days left`, tone: "warn" };
}

/**
 * What the list column says about one account, from the account's own columns.
 *
 * The order matters. What the account *has* is reported first, because an enrolled account satisfies a
 * requirement either way. Then an explicit requirement, then an explicit exemption — `disabled` beats
 * an enforced instance, which is the whole point of the state. What is left is an account that follows
 * the deployment, and its deadline is the answer: one exists only because a requirement was applied to
 * it, so it is reminded until the date and stopped after it.
 */
export function mfaRowSummary(row: MfaRowFacts): { label: string; tone: MfaTone; detail: string } {
  const enrolled = hasEnrolledSecondFactor(row);
  const state = accountMfaState(row);
  if (enrolled) {
    return {
      label: mfaMethodLabel(row.mfaMethod),
      tone: "good",
      detail: state === "disabled" ? "Has a second factor; exempt from the requirement" : "Has a second factor",
    };
  }
  const note = deadlineNote(row.mfaGraceUntil, null);
  if (state === "enforced") {
    if (note?.tone === "bad") {
      return { label: "Required — overdue", tone: "bad", detail: "Required and past its deadline: stopped at its next request" };
    }
    if (note) return { label: `Required — ${note.text}`, tone: "warn", detail: "Required, and reminded until the deadline" };
    return { label: "Required", tone: "warn", detail: "Required, with no deadline on record" };
  }
  if (state === "disabled") {
    return { label: "Exempt", tone: "muted", detail: "Exempt from the requirement" };
  }
  if (note?.tone === "bad") {
    return { label: "Overdue", tone: "bad", detail: "A deadline has passed with nothing enrolled: stopped at its next request" };
  }
  if (note) return { label: note.text, tone: "warn", detail: "Not enrolled, with a deadline counting down" };
  return { label: "Not set up", tone: "muted", detail: "No second factor, and no requirement on record" };
}

/** The list column, in the chip the Modern list uses and the badge the classic one does. */
export function MfaBadge({ row }: { row: MfaRowFacts }) {
  const modern = useModernInterface();
  const summary = mfaRowSummary(row);
  const tone = TONE[summary.tone];
  if (modern) return <span className={`chip ${tone.chip}`} title={summary.detail}>{summary.label}</span>;
  return <span className={`badge text-xs ${tone.badge}`} title={summary.detail}>{summary.label}</span>;
}

/**
 * What the resolved policy means for this account, in one sentence.
 *
 * Read from the `policy` the API answered with, so the screen cannot disagree with the door about
 * whether somebody is stopped, merely reminded, or required at all.
 */
function consequence(policy: MfaPolicy | null): string | null {
  if (!policy) return null;
  if (!policy.enabled) return "Two-factor sign-in is switched off for this instance, so nothing is required of this account.";
  if (policy.mustEnrolNow) return "Required and not enrolled: stopped at the next request until a second factor is set up.";
  if (policy.mustEnrol) {
    if (policy.daysLeft != null) return `Required, with ${policy.daysLeft === 1 ? "1 day" : `${policy.daysLeft} days`} left to set one up.`;
    return "Required, with no deadline on record yet — a reminder until one is given.";
  }
  if (policy.required && policy.enrolled) return "Required, and satisfied by the second factor this account has enrolled.";
  if (policy.required && policy.methods.length === 0) return "Required, but this instance offers no method to enrol — nothing can be asked for until one is switched on.";
  if (policy.enrolled) return "Not required, but the account keeps its second factor and is still asked for it.";
  return "No second factor is required of this account.";
}

export function MfaControl({
  account,
  instancePolicy,
  canEnforce,
  canReset,
  onAccountChanged,
  onResetDone,
}: {
  account: MfaAccount;
  /** The instance's own answer, read once by the page: which mode and which methods everyone shares. */
  instancePolicy: MfaPolicy | null;
  /** `mfa:enforce` — may change the requirement. */
  canEnforce: boolean;
  /** `security:manage` — may take the second factor away. */
  canReset: boolean;
  /** Hand the changed fields back, so the slide-over and the list show them without a second read. */
  onAccountChanged: (fields: Partial<MfaRowFacts>) => void;
  /** Called after a reset: the API answers with no fields, so the page re-reads the record. */
  onResetDone: () => void;
}) {
  const modern = useModernInterface();
  const current = accountMfaState(account);
  /** The staged choice. `null` means "whatever the record says", which is how a new account resets it. */
  const [draft, setDraft] = useState<MfaState | null>(null);
  const [saving, setSaving] = useState<MfaState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  /*
   * What the API resolved, kept with the account and the state it describes. The panel prints it only
   * while it still answers for what is on screen, so a resolution that has been overtaken — by another
   * window, or by the next edit — is never shown as if it were current.
   */
  const [resolved, setResolved] = useState<{ accountId: string; state: MfaState; policy: MfaPolicy } | null>(null);
  /** The same keying for the sentence a reset leaves behind: it belongs to the state it was done in. */
  const [resetDone, setResetDone] = useState<{ accountId: string; state: MfaState; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = draft ?? current;
  const policy = resolved && resolved.accountId === account.id && resolved.state === current ? resolved.policy : null;
  const resetNote = resetDone && resetDone.accountId === account.id && resetDone.state === current ? resetDone.note : null;

  // A different account is a different set of answers; nothing staged or explained carries over.
  useEffect(() => {
    setDraft(null);
    setConfirming(false);
    setError(null);
  }, [account.id]);

  const name = `${account.firstName ?? ""} ${account.lastName ?? ""}`.trim() || account.email;
  const enrolled = hasEnrolledSecondFactor(account);
  const methodLabel = mfaMethodLabel(account.mfaMethod);
  // The server's count when the policy is about this account's current deadline, the date otherwise.
  const graceDaysLeft = policy && policy.graceUntil === account.mfaGraceUntil ? policy.daysLeft : null;
  const deadline = deadlineNote(account.mfaGraceUntil, graceDaysLeft);
  const chosen = MFA_STATES.find(state => state.value === shown) ?? MFA_STATES[0];
  const staged = shown !== current;
  const choose = (next: MfaState) => {
    if (!canEnforce || saving) return;
    if (modern) void saveState(next);
    else setDraft(next);
  };

  const saveState = async (next: MfaState) => {
    if (next === current) return;
    setSaving(next);
    setError(null);
    try {
      const res = await api.patch(`/users/${account.id}/mfa`, { state: next });
      const { policy: answer, ...fields } = res.data ?? {};
      setDraft(null);
      setResetDone(null);
      if (answer) setResolved({ accountId: account.id, state: next, policy: answer });
      onAccountChanged(fields);
      const label = MFA_STATES.find(state => state.value === next)?.label ?? next;
      toast.success(`Two-factor: ${label.toLowerCase()}`);
    } catch (e) {
      setDraft(null);
      setError(apiErrorMessage(e, "Could not change the requirement"));
    } finally {
      setSaving(null);
    }
  };

  const doReset = async () => {
    setResetting(true);
    setError(null);
    try {
      await api.post(`/users/${account.id}/reset-mfa`);
      /*
       * A reset is answered with a message and no fields, and the resolved policy for *another*
       * account cannot be read back — so the dropped policy is replaced by the account's own, freshly
       * re-read deadline rather than by a locally invented one.
       */
      setResolved(null);
      setResetDone({
        accountId: account.id,
        state: current,
        note: `${name} is asked to set a second factor up again at the next sign-in, and the fresh deadline above applies — the grace period, rather than an immediate stop.`,
      });
      setConfirming(false);
      onResetDone();
      toast.success("Second factor reset");
    } catch (e) {
      setError(apiErrorMessage(e, "Could not reset the second factor"));
    } finally {
      setResetting(false);
    }
  };

  const facts = (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-gray-600">Enrolled</dt>
      <dd className="text-gray-300">
        {enrolled ? <>{methodLabel}{day(account.mfaEnrolledAt) ? <> · since {day(account.mfaEnrolledAt)}</> : null}</> : "Nothing enrolled"}
      </dd>
      <dt className="text-gray-600">Requirement deadline</dt>
      <dd>
        {deadline
          ? <span className={`font-medium ${deadline.tone === "bad" ? "text-red-400" : "text-amber-400"}`}>{deadline.text}</span>
          : <span className="text-gray-500">None</span>}
      </dd>
    </dl>
  );

  const consequenceLine = consequence(policy);
  /* ── Modern: pills you press, with the sentence beside the choice that causes it ── */
  if (modern) {
    return (
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Second factor</h3>
            <p className="mt-1 text-xs text-gray-500">What this account has enrolled, and what the policy asks of it.</p>
          </div>
          <span className={`chip ${enrolled ? "chip--good" : ""}`}>{enrolled ? methodLabel : "Not enrolled"}</span>
        </div>

        <div role="radiogroup" aria-label="Second factor requirement" className="space-y-1.5">
          {MFA_STATES.map(state => {
            const selected = shown === state.value;
            const busy = saving === state.value;
            return (
              <button
                key={state.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!canEnforce || saving !== null}
                onClick={() => choose(state.value)}
                className={`chip w-full items-start justify-start gap-2 py-2 text-left disabled:opacity-60 ${selected ? "chip--on" : ""}`}
              >
                <span className="mt-0.5 flex w-4 shrink-0 justify-center">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : selected ? <Check size={13} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{state.label}</span>
                  {selected && <span className="mt-0.5 block whitespace-normal text-xs opacity-80">{state.summary}</span>}
                  {selected && state.value === "default" && instancePolicy && (
                    <span className="mt-0.5 block whitespace-normal text-xs opacity-80">
                      {instancePolicy.mode === "enforced"
                        ? "This instance currently requires one of everybody."
                        : "This instance does not currently require one of anybody."}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {!canEnforce && (
          <p className="text-xs text-amber-300">Changing the requirement needs the mfa:enforce permission.</p>
        )}

        {facts}
        {resetNote && <p className="text-xs text-green-400">{resetNote}</p>}
        {consequenceLine && <p className="text-xs text-gray-500">{consequenceLine}</p>}

        {/*
         * The reset opens in place, as a list of what goes and what happens next, because the decision
         * is about consequences rather than about a yes/no — the modern screen's habit of putting the
         * sentence beside the control instead of behind a dialog.
         */}
        <div className="border-t border-surface-border/60 pt-3">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">Resetting {name}&apos;s second factor:</p>
              <ul className="space-y-1 text-xs text-gray-300">
                <li className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" /> Their authenticator, passkey or emailed code stops working.</li>
                <li className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" /> Their recovery codes are discarded.</li>
                <li className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-green-400" /> They are asked to set one up again at the next sign-in.</li>
                <li className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-green-400" /> They get the grace period, so the reset is not a lockout.</li>
              </ul>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void doReset()}
                  disabled={resetting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-600/30 disabled:opacity-50"
                >
                  {resetting ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Reset it
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="chip">Keep it</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-md text-xs text-gray-500">
                Reset removes the authenticator and the recovery codes, and asks them to set a second factor up
                again — with the grace period rather than an immediate stop.
              </p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!canReset}
                title={canReset ? undefined : "Resetting needs the security:manage permission"}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-600/20 disabled:opacity-50"
              >
                <ShieldCheck size={13} /> Reset second factor
              </button>
            </div>
          )}
          {!canReset && <p className="mt-1.5 text-xs text-amber-300">Resetting needs the security:manage permission.</p>}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  /* ── Classic: a labelled field in a grid, written once with a Save ── */
  return (
    <div className="card space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Second factor</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Status</p>
          <select
            className="input-field text-sm py-1.5"
            value={shown}
            disabled={!canEnforce || saving !== null}
            onChange={e => choose(e.target.value as MfaState)}
          >
            {MFA_STATES.map(state => <option key={state.value} value={state.value}>{state.label}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-gray-500">{chosen?.summary}</p>
          {draft === "default" && instancePolicy && (
            <p className="mt-1 text-xs text-gray-500">
              {instancePolicy.mode === "enforced"
                ? "This instance currently requires one of everybody."
                : "This instance does not currently require one of anybody."}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Enrolled method</p>
          <p className="text-sm text-white">{enrolled ? methodLabel : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Enrolled on</p>
          <p className="text-sm text-white">{day(account.mfaEnrolledAt) ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Requirement deadline</p>
          <p className={`text-sm ${deadline ? (deadline.tone === "bad" ? "text-red-400" : "text-amber-400") : "text-white"}`}>
            {deadline ? deadline.text : "—"}
          </p>
        </div>
      </div>

      {resetNote && <p className="text-xs text-green-400">{resetNote}</p>}
      {consequenceLine && <p className="text-xs text-gray-500">{consequenceLine}</p>}
      {!canEnforce && <p className="text-xs text-amber-300">Changing the requirement needs the mfa:enforce permission.</p>}

      {staged && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDraft(null)} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={() => void saveState(shown)} disabled={saving !== null} className="btn-primary text-sm">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      <div className="border-t border-surface-border/60 pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Reset removes the authenticator and the recovery codes, and asks them to set a second factor up again
            — with the grace period rather than an immediate stop.
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canReset}
            title={canReset ? undefined : "Resetting needs the security:manage permission"}
            className="bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <ShieldCheck size={13} /> Reset second factor
          </button>
        </div>
        {!canReset && <p className="mt-1.5 text-xs text-amber-300">Resetting needs the security:manage permission.</p>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* The classic confirmation: a dialog with a heading and Save/Cancel. */}
      {confirming && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Reset second factor for ${name}`}
            className="card w-full max-w-md space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <ShieldCheck size={22} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-white font-semibold">Reset second factor?</h3>
                <p className="text-xs text-gray-400 mt-1">{name} · {account.email}</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">
              The second factor this account has enrolled — the authenticator, the passkey or the emailed code —
              is removed, and its recovery codes are discarded. {name.split(" ")[0]} is asked to set one up again
              at the next sign-in, and is given the grace period rather than being stopped immediately.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setConfirming(false)} className="btn-secondary text-sm">Cancel</button>
              <button
                type="button"
                onClick={() => void doReset()}
                disabled={resetting}
                className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {resetting ? "Resetting…" : "Reset second factor"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
