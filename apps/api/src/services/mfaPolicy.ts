/**
 * The one answer to "does this account have to have a second factor, and is it about to be stopped
 * without one".
 *
 * There are four places that need that answer and they must not each reach their own conclusion:
 * the sign-in (will it hand back a challenge), the middleware gate (is it about to refuse the
 * request), the enrolment wizard (what is left to do), and the administrator's screens (who is
 * overdue). If the gate and the wizard disagree by one day, a person is stopped on the day the
 * wizard still tells them they have time — so the deadline is computed here, once, and everything
 * else asks.
 *
 * Resolution is synchronised because two of its callers are guards that cannot await — the same
 * reason `configValue` is. The settings snapshot it reads is refreshed every thirty seconds and on
 * every save, so a change takes effect without a restart and without a database round trip per
 * request.
 */
import { configFlag, configNumber, configText } from "./appSettings";
import { isBypassAccount } from "./testBypass";
import {
  MFA_METHODS,
  isMfaMethodId,
  isMfaState,
  type MfaMethodId,
  type MfaMode,
  type MfaPolicy,
  type MfaState,
} from "@C7NTAX/shared";

/**
 * Prisma is imported at the point of use rather than at the top of the file.
 *
 * `middleware/auth.ts` reads this module on every request and is itself loaded while `index.ts` is
 * still assembling its exports, so a static `import { prisma } from "../index"` here would be a
 * cycle reaching back into the module that is mid-load. The two functions that need the database are
 * the ones that await this, and the two that decide the policy (`offeredMfaMethods`, `mfaPolicyFor`)
 * touch no database at all — which is also what lets the gate call them synchronously.
 */
async function db() {
  const { prisma } = await import("../index");
  return prisma;
}

/** The account fields the policy is decided from. Deliberately narrow: these are all it may use. */
export interface MfaSubject {
  email?: string | null;
  mfaEnabled?: boolean | null;
  mfaMethod?: string | null;
  mfaState?: string | null;
  mfaEnrolledAt?: Date | string | null;
  mfaGraceUntil?: Date | string | null;
  /**
   * Whether this account holds `instance:security` — the permission that can change the enrolment
   * policy itself. See the note on `mfaPolicyFor`: it decides who may be *blocked*, and the answer has
   * to be no for the people who could otherwise be locked out of fixing it.
   */
  holdsInstanceSecurity?: boolean | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The methods this deployment currently offers.
 *
 * Read from the settings that govern each method rather than from a list of its own — passkeys are
 * governed by the Sessions & Security switch that already exists, and a second switch for the same
 * behaviour would be two places to change and one place to forget. A method whose section or field
 * has been renamed away reads as off, which is the safe direction to fail in.
 */
export function offeredMfaMethods(): MfaMethodId[] {
  return MFA_METHODS.filter(method => configFlag(method.governedBy.sectionId, method.governedBy.fieldId)).map(
    method => method.id,
  );
}

/** Whether the instance switch is on at all. */
export function mfaEnabled(): boolean {
  return configFlag("mfa", "enabled");
}

/**
 * The methods that could be somebody's **first** second factor.
 *
 * A passkey is excluded, and that exclusion is the whole point of this function. A passkey is
 * registered from an already-signed-in session, so it can replace a second factor but cannot be the
 * one that gets somebody in the door for the first time. Anywhere the question is "can this account
 * satisfy a requirement", the answer has to be measured against *these* methods — otherwise a
 * deployment offering passkeys alone would be told enforcement is possible, would demand a second
 * factor of everybody, and would then offer a wizard whose only option cannot be completed: a
 * lockout with no exit, which is exactly the state the guard exists to prevent.
 */
export function standaloneMfaMethods(): MfaMethodId[] {
  return offeredMfaMethods().filter(id => MFA_METHODS.find(method => method.id === id)?.standalone);
}

/** Optional or enforced, as set on the instance. Anything unrecognised reads as optional. */
export function mfaMode(): MfaMode {
  return configText("mfa", "mode") === "enforced" ? "enforced" : "optional";
}

/** Days an account is given to enrol when enforcement starts. */
export function mfaGraceDays(): number {
  return Math.max(0, configNumber("mfa", "graceDays", 7));
}

/** Days a proved browser may skip the second factor. Zero means never. */
export function mfaRememberDays(): number {
  return Math.max(0, configNumber("mfa", "rememberBrowser", 30));
}

/** The account's own state, defaulting when the column holds something unrecognised. */
export function mfaAccountState(subject: MfaSubject): MfaState {
  return isMfaState(subject.mfaState) ? subject.mfaState : "default";
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve the policy for one account.
 *
 * Three rules are worth stating, because each one is a decision rather than a consequence:
 *
 * **A method switch governs enrolment, not existing enrolments.** Turning "Authenticator app" off
 * stops it being offered to accounts that have not enrolled; it does not evict the accounts that
 * already have. The alternative — deciding at sign-in that their method is no longer acceptable —
 * locks people out of their accounts the instant an administrator narrows the list, which is
 * indistinguishable from an incident and is not what the switch says it does. Revoking one account
 * is an explicit reset, and that is on the account's own screen.
 *
 * **`disabled` beats an enforced instance.** That is the whole point of the state: an exemption for
 * a service account, a shared terminal, or a person whose phone is in a drawer. An administrator who
 * needs everybody covered should not be handing out exemptions.
 *
 * **Nobody is stopped from enrolling by having been stopped.** `mustEnrolNow` is true at most until
 * they finish the wizard, and the wizard's own endpoints are exempt from the gate, so the state is
 * "blocked until you set one up" rather than "locked out". That is also why a required account with
 * **no method left to choose** is never stopped: demanding something that cannot be done would be a
 * lockout with no exit, so the requirement lapses and the configuration screen reports it.
 *
 * **The deployment's exempt test account is exempt here too.** The middleware has always let it through
 * — that is what `AUTH_TEST_BYPASS` is for — but the exemption has to live *here* as well, or the two
 * disagree: the server would serve every request while `/me` told the client `mustEnrolNow: true`, and a
 * client gate that believes the policy would show a wizard the server was never going to enforce. An
 * exemption that only one of the two ends knows about is a bug with a delay on it.
 *
 * **Whoever can change this policy is never blocked by it.** An account holding `instance:security` can
 * still *owe* an enrolment — `required` and `mustEnrol` stay true, so the reminder stands — but
 * `mustEnrolNow` is false, so the gate does not shut on it. This is not a courtesy, it is the way out:
 * the switches that could turn enforcement off are behind that permission, and once the grace periods
 * have run out the person who could fix a mistake would otherwise be the one person unable to reach the
 * screen. That is the same shape of unrecoverable state that a refused save, a retired deadline and a
 * passkey-only instance each turned out to be, so it is closed the same way — by deciding it in the one
 * place the gate, the wizard, the banner and the administrator's screen all read from. Administrators
 * are exempt from the session timeout for the same reason and by the same precedent.
 */
export function mfaPolicyFor(subject: MfaSubject): MfaPolicy {
  const enabled = mfaEnabled();
  const mode = mfaMode();
  const state = mfaAccountState(subject);
  const offered = enabled ? offeredMfaMethods() : [];
  const method = isMfaMethodId(subject.mfaMethod) ? subject.mfaMethod : null;
  const exemptByDeployment = isBypassAccount(subject.email);
  const cannotBeBlocked = exemptByDeployment || !!subject.holdsInstanceSecurity;

  // "Has a second factor" is the enrolment date, and only that.
  //
  // It is deliberately *not* `mfaEnabled`, which answers a different question — "should the sign-in
  // ask for a code" — and which is false for a passkey, because a passkey is the sign-in rather than
  // a step after it. An account with `mfaEnrolledAt` set has proved something it can be asked for
  // again: a code, an emailed secret, or the credential itself. Making the policy depend on the
  // enrolment date rather than on the challenge means a passkey satisfies a requirement without
  // inventing a second prompt for a credential that has already replaced the first one.
  const enrolled = enabled && !!asDate(subject.mfaEnrolledAt);

  const required = enabled && !exemptByDeployment && (state === "enforced" || (state === "default" && mode === "enforced"));

  const graceUntil = asDate(subject.mfaGraceUntil);
  // Measured against the methods that could actually *be* a first factor — see `standaloneMfaMethods`.
  // An account with only passkeys on offer is never stopped, because stopping it would leave it with
  // nothing it could complete.
  const enforceable = required && !enrolled && standaloneMfaMethods().length > 0;
  const expired = !!graceUntil && graceUntil.getTime() <= Date.now();
  const mustEnrolNow = enforceable && !cannotBeBlocked && (!!graceUntil ? expired : mfaGraceDays() === 0);

  let daysLeft: number | null = null;
  if (enforceable && graceUntil && !expired) {
    daysLeft = Math.max(0, Math.ceil((graceUntil.getTime() - Date.now()) / DAY_MS));
  }

  return {
    enabled,
    mode,
    methods: offered,
    method,
    enrolled,
    required,
    mustEnrolNow,
    mustEnrol: enforceable,
    graceUntil: graceUntil ? graceUntil.toISOString() : null,
    daysLeft,
    state,
  };
}

/** The same answer, for the account behind a signed-in session. */
export async function mfaPolicyForUser(userId: string): Promise<MfaPolicy> {
  const prisma = await db();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true, mfaEnabled: true, mfaMethod: true, mfaState: true, mfaEnrolledAt: true, mfaGraceUntil: true,
      // Read here because the policy has to know whether this account can change the policy: see the
      // note on `mfaPolicyFor`. An override is included for the same reason the effective set includes
      // one — the question is what the person actually holds.
      permissions: true,
    },
  });
  if (!user) return mfaPolicyFor({});
  return mfaPolicyFor({ ...user, holdsInstanceSecurity: permissionsIncludeInstanceSecurity(user.permissions) });
}

/** Whether a permission list contains the instance-security permission. */
export function permissionsIncludeInstanceSecurity(permissions: readonly string[] | null | undefined): boolean {
  return (permissions ?? []).includes("instance:security");
}

/**
 * Give every account that has not enrolled a deadline.
 *
 * Called when enforcement is switched on, and only then — this is the moment the grace period is meant
 * to start, and the one moment the deployment knows a requirement has just begun. Doing it here rather
 * than deriving a deadline from "when the setting was last saved" means editing an unrelated field on
 * the same screen (an allowed method, say) does not silently extend everybody's deadline, which would
 * make the countdown untrustworthy.
 *
 * Two rules about which accounts are stamped, and the second one is the important one:
 *
 * **A live countdown is not restarted.** An account whose deadline is still in the future keeps it, so
 * switching enforcement off and on again cannot be used to postpone a date somebody is already working
 * towards — and an unrelated save on the same screen does not move it either.
 *
 * **A deadline that has passed, or that was never given, is replaced.** This is the rule that was
 * missing, and its absence was a lockout: retiring outstanding deadlines when enforcement was switched
 * off left them in the past, and an "only stamp accounts with no deadline" test then never stamped
 * those accounts again — so the *second* time enforcement was turned on, every unenrolled account was
 * past its deadline and was stopped at its next request with no warning at all. Enforcement gets
 * switched off and on again constantly while an administrator is deciding, so this was not an edge
 * case; it was the ordinary path.
 *
 * `restamp` overrides the first rule, and only one caller uses it: a change to the **grace period
 * itself**. "A live countdown is not restarted" is there so that an unrelated save cannot move a date
 * somebody is working towards, but shortening or lengthening the grace period is not an unrelated save
 * — it is an administrator answering the question the countdown is counting down to, and leaving
 * existing deadlines at their old length would mean the setting appeared to do nothing for exactly the
 * accounts it is about.
 *
 * `disabled` accounts are skipped: they are exempt by name, and stamping them would make the
 * administrator's exemption look like an oversight.
 */
export async function startMfaGrace(actorId: string | null, options?: { restamp?: boolean }): Promise<number> {
  const prisma = await db();
  const days = mfaGraceDays();
  const now = new Date();
  const until = new Date(now.getTime() + days * DAY_MS);

  const result = await prisma.user.updateMany({
    where: {
      isActive: true,
      mfaEnrolledAt: null,
      mfaState: { not: "disabled" },
      // Only the accounts that are not already counting down, unless the caller is changing how long
      // the count is allowed to be.
      ...(options?.restamp ? {} : { OR: [{ mfaGraceUntil: null }, { mfaGraceUntil: { lte: now } }] }),
    },
    data: { mfaGraceUntil: until },
  });

  if (result.count > 0) {
    try {
      await prisma.auditLog.create({
        data: {
          action: "mfa.grace_started",
          entity: "user",
          entityId: actorId ?? "system",
          changes: { accounts: result.count, days, until: until.toISOString() } as never,
          userId: actorId ?? "system",
          ipAddress: null,
        },
      });
    } catch {
      /* The deadlines are stamped either way. An audit history missing one entry is a smaller
         problem than a requirement with no deadline, so the record must not fail the action. */
    }
  }

  return result.count;
}

/**
 * There is deliberately no function that retires outstanding deadlines.
 *
 * One existed, and it was the cause of a lockout: switching enforcement off moved every future deadline
 * into the past, and a rule that only stamped accounts with *no* deadline then never stamped those
 * accounts again — so the next time enforcement was switched on, every unenrolled account was already
 * past its deadline and was stopped at its next request with no warning. Deleting the retire step and
 * letting `startMfaGrace` replace any deadline that is not in the future is both simpler and correct:
 * nothing consults a deadline while enforcement is off, so leaving one in place costs nothing.
 */

/** How many accounts the deployment would stop if enforcement started now. */
export async function mfaCoverage(): Promise<{
  total: number;
  enrolled: number;
  exempt: number;
  required: number;
  overdue: number;
  dueSoon: number;
}> {
  const prisma = await db();
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true, mfaEnabled: true, mfaState: true, mfaGraceUntil: true },
  });

  const enabled = mfaEnabled();
  const enforced = enabled && mfaMode() === "enforced";
  const soon = Date.now() + 7 * DAY_MS;
  let enrolled = 0;
  let exempt = 0;
  let required = 0;
  let overdue = 0;
  let dueSoon = 0;

  for (const user of users) {
    const state = mfaAccountState(user);
    if (user.mfaEnabled) enrolled += 1;
    // The deployment's exempt test account is not required of anything, so counting it as overdue would
    // report a person who is about to be stopped when nobody is.
    if (isBypassAccount(user.email)) continue;
    if (state === "disabled") {
      exempt += 1;
      continue;
    }
    if (!enabled) continue;
    if (!(state === "enforced" || (state === "default" && enforced))) continue;
    required += 1;
    if (user.mfaEnabled) continue;
    const until = asDate(user.mfaGraceUntil);
    if (until && until.getTime() <= Date.now()) overdue += 1;
    else if (until && until.getTime() <= soon) dueSoon += 1;
  }

  return { total: users.length, enrolled, exempt, required, overdue, dueSoon };
}

/**
 * Would this write leave enforcement with nothing to offer?
 *
 * The one configuration change that can stop every account from signing in is not "turn MFA on" — it
 * is turning it on while there is no method left to choose, because the enrolment wizard would have
 * nothing to draw and the gate would be a door with no handle. So the check is made against the state
 * the save is *about to* produce rather than the state it is in: the field being written is overridden
 * and every other field is read as it stands.
 *
 * `sectionId` and `fieldId` are null when there is no write in progress, which is how the policy
 * endpoint asks the same question about the stored answer.
 *
 * A select is compared by value because "enforced" is a string, and a boolean is compared strictly, so
 * a stray `1` does not read as `true` and quietly pass a save it should have refused.
 */
export function enforcementAfterWrite(
  sectionId: string | null,
  fieldId: string | null,
  value: unknown,
): { ok: boolean; reason: string | null } {
  const isWriting = (section: string, field: string) => sectionId === section && fieldId === field;
  const readFlag = (section: string, field: string): boolean =>
    isWriting(section, field) ? value === true : configFlag(section, field);

  const enabled = readFlag("mfa", "enabled");
  const enforced = isWriting("mfa", "mode") ? value === "enforced" : configText("mfa", "mode") === "enforced";

  // Nothing is required unless both are true, so anything else is safe to save.
  if (!enabled || !enforced) return { ok: true, reason: null };

  const anyMethod = MFA_METHODS.some(
    method => method.standalone && readFlag(method.governedBy.sectionId, method.governedBy.fieldId),
  );
  if (anyMethod) return { ok: true, reason: null };

  return {
    ok: false,
    reason:
      "That would require a second factor while offering none that can be set up first, which would stop every account from signing in. Turn on the authenticator app or an emailed code — a passkey on its own cannot be a first method, because it is registered from a session that a second factor is needed to reach.",
  };
}

/** The same question about the settings as they stand. */
export function enforcementPossible(): { ok: boolean; reason: string | null } {
  return enforcementAfterWrite(null, null, undefined);
}
