/**
 * The web's reading of the second-factor policy.
 *
 * The **policy itself** is the server's answer and is never recomputed here: `services/mfaPolicy.ts`
 * resolves "does this account have to have a second factor, and is it about to be stopped without
 * one" once, and the sign-in, the gate, the wizard and the banner all read that same answer. If this
 * file decided for itself, a banner could say "six days left" on the morning the gate had already
 * closed, which is the failure the server-side resolution exists to prevent.
 *
 * What lives here is the two things the policy endpoint adds to it — the **catalogue** of methods and
 * whether enforcement is possible at all — plus the words. A method list hard-coded in the wizard
 * would be a second list to keep in step with the settings that govern each method, and it would hide
 * the one question this screen exists to answer: *why can I not use my passkey*.
 *
 * `catalogue` is optional because the policy arrives two ways: the endpoint that exists to describe it
 * (`GET /auth/mfa/policy`, which carries the catalogue) and every sign-in response and `/auth/me`
 * (which carry the policy alone, so the gate can open without a second round trip). A caller that
 * needs the catalogue asks for the full payload.
 */
import type { MfaMethodId, MfaPolicy } from "@C7NTAX/shared";

/** One method as the deployment describes it, rather than as the client assumes. */
export interface MfaMethodOption {
  id: MfaMethodId;
  label: string;
  summary: string;
  /** False when this deployment does not allow it — shown greyed with the reason, never hidden. */
  offered: boolean;
  /** False for a passkey: it is registered from a signed-in session, so it cannot be the first one. */
  standalone: boolean;
  /** The config section and field that decide whether it is offered, for a truthful "change this" link. */
  governedBy: { sectionId: string; fieldId: string };
}

/** The policy, plus what only the policy endpoint carries. */
export interface MfaPolicyView extends MfaPolicy {
  catalogue?: MfaMethodOption[];
  enforcementPossible?: { ok: boolean; reason: string | null };
}

/** The whole catalogue, offered or not — the wizard shows the refused ones with their reason. */
export function mfaCatalogue(policy: MfaPolicyView | null | undefined): MfaMethodOption[] {
  return policy?.catalogue ?? [];
}

/**
 * The methods a *first* enrolment may choose.
 *
 * `offered` is the deployment's answer; `standalone` is the method's own — a passkey cannot be the
 * method that gets somebody in the door for the first time, because registering one needs a session
 * and a session needs a second factor once one is required.
 */
export function mfaMethodsForFirstEnrolment(policy: MfaPolicyView | null | undefined): MfaMethodOption[] {
  return mfaCatalogue(policy).filter((method) => method.offered && method.standalone);
}

/** Why a method cannot be chosen, in the person's words. */
export function mfaMethodUnavailableReason(method: MfaMethodOption, policy?: MfaPolicyView | null): string {
  /*
   * The master switch is checked **first**, and that order is the fix rather than a preference.
   *
   * With multi-factor authentication switched off, every method resolves to `offered: false` — so the
   * message below used to blame each individual method's own setting and send somebody to change a
   * switch that was not the cause. Worse, it pointed at the *per-method* setting for a method whose
   * setting was already on, which reads as "this screen is wrong". The instance switch is the one
   * question above all the others, so it is answered before any of them.
   */
  if (policy && !policy.enabled) {
    return "Multi-factor authentication is switched off for this whole instance, so no method can be enrolled. An administrator turns it on under Administration → Configuration → Multi-factor authentication.";
  }
  if (!method.offered) {
    return `This deployment does not offer ${method.label.toLowerCase()}. An administrator turns it on under ${governedByLabel(method.governedBy.sectionId)}.`;
  }
  return "A passkey is registered from inside the application, so it cannot be your first second factor. Enrol another method now, then add a passkey from My Account.";
}

/** The configured name of a method, for anywhere that has to name one back to a person. */
export function mfaMethodName(policy: MfaPolicyView | null | undefined, id: MfaMethodId | string | null | undefined): string {
  if (!id) return "Not set up";
  return mfaCatalogue(policy).find((method) => method.id === id)?.label ?? id;
}

/** The configuration area that governs a method, named as the Configuration hub names it. */
export function governedByLabel(sectionId: string): string {
  if (sectionId === "sessions") return "Administration → Configuration → Sessions & Security";
  if (sectionId === "mfa") return "Administration → Configuration → Multi-factor authentication";
  return `Administration → Configuration → ${sectionId}`;
}

/** Where a person would change it, for the link beside a method that is not offered. */
export function governedByHref(sectionId: string): string {
  return `/admin/configuration/${sectionId}`;
}

/**
 * The countdown in words.
 *
 * `daysLeft` is the server's whole days remaining, so it is said as such rather than rounded here —
 * two places computing "six days" from one deadline is how the two end up a day apart.
 */
export function daysLeftInWords(days: number | null | undefined): string {
  if (days === null || days === undefined) return "before it becomes required";
  if (days <= 0) return "today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/** The one sentence the reminder banner says, so the two arrangements cannot describe it differently. */
export function graceReminderSentence(policy: MfaPolicyView): string {
  const countdown = daysLeftInWords(policy.daysLeft);
  return countdown === "today"
    ? "You need a second factor from today."
    : `Set up a second factor — ${countdown} before it is required.`;
}

/** The ten recovery codes as one block, for the clipboard and the download. */
export function recoveryCodesAsText(codes: string[]): string {
  return [
    "C7NTAX recovery codes",
    "",
    "Each code works once. Keep them somewhere that is not the device you sign in with.",
    "",
    ...codes,
    "",
  ].join("\n");
}
