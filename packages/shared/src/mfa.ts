/**
 * Multi-factor authentication, as a policy rather than a per-account fact.
 *
 * Before this file, an account either had MFA or did not: `User.mfaEnabled` was set the moment
 * somebody verified their first authenticator code, and the sign-in asked for a second factor from
 * those accounts and nobody else. There was no way to require one, no way to exempt an account from
 * a requirement, and no way to say which of the three supported methods a deployment accepts.
 *
 * The vocabulary below is deliberately Entra's — `default` / `disabled` / `enforced`, and a required
 * versus optional mode — because an administrator who has used Entra already knows what those words
 * mean, and a second set of words for the same three ideas is a translation cost with no benefit.
 *
 * The three methods are declared **with the setting that governs each one**, rather than with a
 * switch of their own. Passkeys are governed by the Sessions & Security switch that already exists
 * — a second switch for the same behaviour would be two places to change and one place to forget —
 * so the enrolment wizard and the policy screens ask this catalogue which methods are available
 * instead of deciding for themselves. `governedBy` names a section and a field, which is all
 * `configValue` needs to answer.
 */

/** How a person proves a second factor. Persisted on `User.mfaMethod`. */
export type MfaMethodId = "totp" | "passkey" | "email_code";

/** What the policy says about one account. Persisted on `User.mfaState`. */
export type MfaState = "default" | "disabled" | "enforced";

/** What the instance setting says about everyone. Persisted in the `mfa` config section. */
export type MfaMode = "optional" | "enforced";

export interface MfaMethodSpec {
  id: MfaMethodId;
  /** What the method is called on screen. */
  label: string;
  /** One line, in the person's words — this is what the wizard offers. */
  summary: string;
  /** The configuration field that decides whether this method is offered at all. */
  governedBy: { sectionId: string; fieldId: string };
  /**
   * Whether the method can be used as a *standalone* second factor, with no other method already
   * enrolled. False for passkeys: a passkey is registered from a signed-in session, and a session
   * cannot be obtained without a second factor once one is required — so a passkey can replace a
   * method but cannot be the method that gets somebody in the door for the first time.
   */
  standalone: boolean;
}

/**
 * The methods, in the order they are offered.
 *
 * Authenticator first because it is the only one with no dependency on the deployment and none on a
 * second device being reachable. Emailed codes last for the same reason they are off by default:
 * they move the second factor onto the same channel as a password reset.
 */
export const MFA_METHODS: readonly MfaMethodSpec[] = [
  {
    id: "totp",
    label: "Authenticator app",
    summary: "A six-digit code from an app such as Microsoft Authenticator, 1Password or Authy.",
    governedBy: { sectionId: "mfa", fieldId: "allowAuthenticator" },
    standalone: true,
  },
  {
    id: "passkey",
    label: "Passkey",
    summary: "Windows Hello, Touch ID, or a security key — proved by the device itself.",
    governedBy: { sectionId: "sessions", fieldId: "passkeys" },
    standalone: false,
  },
  {
    id: "email_code",
    label: "Code by email",
    summary: "A short-lived code sent to the address on your account.",
    governedBy: { sectionId: "mfa", fieldId: "allowEmailCode" },
    standalone: true,
  },
];

export function mfaMethod(id: string | null | undefined): MfaMethodSpec | null {
  if (!id) return null;
  return MFA_METHODS.find(method => method.id === id) ?? null;
}

/** The label for a stored method id, for anywhere that has to name one back to a person. */
export function mfaMethodLabel(id: string | null | undefined): string {
  return mfaMethod(id)?.label ?? "Not set up";
}

export const MFA_STATES: readonly { value: MfaState; label: string; summary: string }[] = [
  {
    value: "default",
    label: "Follow the instance setting",
    summary: "Required only if the instance requires everyone to have a second factor.",
  },
  {
    value: "disabled",
    label: "Not required",
    summary: "Exempt from the requirement. An account that has enrolled keeps being asked for its second factor.",
  },
  {
    value: "enforced",
    label: "Required",
    summary: "Must have a second factor, whichever way the instance setting is set.",
  },
];

export function isMfaState(value: unknown): value is MfaState {
  return value === "default" || value === "disabled" || value === "enforced";
}

export function isMfaMethodId(value: unknown): value is MfaMethodId {
  return value === "totp" || value === "passkey" || value === "email_code";
}

/**
 * What the sign-in and the enrolment gate need to know about one account, in one shape.
 *
 * Resolved on the server and handed to the client whole, rather than each of them reading the
 * settings and reaching its own conclusion. The two questions that matter — "will I be asked for a
 * second factor" and "will I be stopped from getting in if I do not set one up" — are answered in
 * exactly one place (`services/mfaPolicy.ts`), so the wizard, the banner and the door cannot
 * disagree about the deadline.
 */
export interface MfaPolicy {
  /** The instance switch. Off means no second factor is asked for and none may be enrolled. */
  enabled: boolean;
  /** Optional or enforced, as set on the instance. */
  mode: MfaMode;
  /** Methods this deployment offers, resolved from the settings that govern each one. */
  methods: MfaMethodId[];
  /** The method this account enrolled, if any. */
  method: MfaMethodId | null;
  /** True when the account has a usable second factor — enrolled, and the method still offered. */
  enrolled: boolean;
  /** True when the account is required to have one, after its own state and the instance mode. */
  required: boolean;
  /** True when the requirement is being enforced at sign-in now. */
  mustEnrolNow: boolean;
  /** True when they are inside a grace period, or required but not yet given one. */
  mustEnrol: boolean;
  /** The deadline being counted down, when there is one. */
  graceUntil: string | null;
  /** Whole days left before `mustEnrolNow` turns true. Null when no deadline applies. */
  daysLeft: number | null;
  /** Convenience for the client: which of the three states this account is in. */
  state: MfaState;
}

/** A policy for an instance that has not switched MFA on, used when nothing can be read. */
export function mfaPolicyOff(): MfaPolicy {
  return {
    enabled: false,
    mode: "optional",
    methods: [],
    method: null,
    enrolled: false,
    required: false,
    mustEnrolNow: false,
    mustEnrol: false,
    graceUntil: null,
    daysLeft: null,
    state: "default",
  };
}
