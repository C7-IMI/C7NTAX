/**
 * The MFA setup simulator — the rehearsal a support person drives while somebody on the phone cannot
 * get their second factor working.
 *
 * ── Two halves, and why they are different kinds of truth ──────────────────────────────────────────
 *
 * The screen has a **live half** and a **script half**, and they must not be confused with each other:
 *
 *   · **The live half is read, not drawn.** It calls `GET /api/auth/mfa/policy` and prints what came
 *     back: whether a second factor is available at all, whether it is required, the deadline the
 *     account is counting down, which methods this deployment offers, and — for the methods it does
 *     not — the configuration section that governs each one. That is the half that answers *"why is
 *     this person being asked, or not being asked?"*, and an answer to that has to be the real one.
 *     Nothing in this file recomputes it: the policy is resolved once on the server
 *     (`services/mfaPolicy.ts`) and the gate, the wizard, the banner and this screen all read the same
 *     answer, so a simulator that reached its own conclusion would be the fifth place to disagree.
 *   · **The script half is a rehearsal.** A scenario picker over the states that actually differ, and
 *     for each one a numbered script the support person walks in time with the person on the phone:
 *     what they are doing, what they should be seeing, what to check when they are not seeing it, and
 *     the one thing to say.
 *
 * ── This is a rehearsal, and the real screens are the authority ────────────────────────────────────
 *
 * The frames below are **a drawing of what the person sees**, not the components that draw it. This
 * file deliberately does not import the enrolment wizard: a rehearsal is a second drawing, it exists
 * to carry the troubleshooting notes that the real component has no business holding, and it must be
 * able to describe a state (a stopped account, a spent recovery code, an administrator's reset) that
 * the real component only ever renders in the moment. **If the rehearsal and the real screen ever
 * differ, the real screen is right.** A support person who sees a mismatch has found a bug in this
 * file, not in the feature.
 *
 * ── Nothing is written ────────────────────────────────────────────────────────────────────────────
 *
 * The simulator is **read-only**. It never enrols anything, mints no secret, shows no real recovery
 * code, saves no setting and changes nobody's account: the one call it makes is the policy read. A
 * rehearsal that could alter the instance is a footgun, and it would be aimed at the person most
 * likely to press the wrong thing while distracted on a call.
 *
 * ── Both widths, because "it looked fine on my desktop" is half the support calls ──────────────────
 *
 * Desktop and phone are drawn side by side, in frames of a fixed width (1024 px and 375 px), for the
 * same reason the email simulation draws them: the question is *"does it still read on a phone"*, and
 * answering it by scrolling is answering it twice. The frames are their own scroll regions, so a
 * frame that is wider than this window scrolls inside it rather than shrinking.
 *
 * ── A blocked window is not a dead end ────────────────────────────────────────────────────────────
 *
 * `window.open` may return `null`. When it does, the same content is drawn in an overlay inside the
 * app — a **sheet** over the panel in the modern interface, a **dialog** with a heading and a Close
 * button in the classic one — and nothing is said about pop-ups: the reader asked to see the
 * rehearsal and the answer to that is the same either way. A failed read is never a blank frame: it
 * prints the read's own sentence and a retry.
 *
 * ── Two interfaces, two designs ───────────────────────────────────────────────────────────────────
 *
 * There are **three surfaces** here and every one of them has a modern arrangement and a classic one,
 * designed individually rather than restyled: **the action** on the configuration section (a strip
 * with the sentence beside the control that acts, against a headed card with a control row), **the
 * fallback overlay** (a sheet, against a dialog), and **the content itself** (a scenario rail of pills
 * and a step track you step along, against a labelled `select` and a numbered list of fields read top
 * to bottom, with the two widths stacked instead of side by side). What the arrangements share is the
 * state, the one API call and the words — never the layout. The pieces that *are* the same in both are
 * named where they appear, with the reason: the frames and the fact rows are the thing being
 * rehearsed, not the furniture around it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, KeyRound, Lock, Mail, Monitor, MonitorSmartphone,
  RefreshCw, ShieldCheck, Smartphone, X,
} from "lucide-react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { MFA_METHODS, MFA_STATES, mfaMethodLabel, type MfaMethodId, type MfaPolicy } from "@C7NTAX/shared";

// ── The live half: exactly the shape the endpoint answers with ────────────────────────────────────

/**
 * One method as this deployment describes it.
 *
 * Declared here rather than imported from the wizard's own reading of the policy, for the reason in
 * the header: this file must not depend on the enrolment work, in either direction. The *labels* come
 * from `MFA_METHODS` in `@C7NTAX/shared`, which is what stops the simulator and the product from
 * disagreeing about what a method is called; only the envelope is declared twice.
 */
interface MfaCatalogueEntry {
  id: MfaMethodId;
  label: string;
  summary: string;
  /** False when this deployment does not allow it — shown refused with the reason, never hidden. */
  offered: boolean;
  /** False for a passkey: it is registered from a signed-in session, so it cannot be the first one. */
  standalone: boolean;
  /** The configuration section and field that decide whether it is offered. */
  governedBy: { sectionId: string; fieldId: string };
}

/** `GET /api/auth/mfa/policy`, whole. */
interface MfaPolicyRead extends MfaPolicy {
  catalogue: MfaCatalogueEntry[];
  enforcementPossible: { ok: boolean; reason: string | null };
}

const POLICY_ENDPOINT = "/api/auth/mfa/policy";
/**
 * The path as the axios instance wants it.
 *
 * `api` carries `/api` as its base URL, so the route is reached by the path without the prefix — and a
 * doubled prefix is a 404 that looks exactly like a missing feature.
 */
const POLICY_PATH = POLICY_ENDPOINT.replace(/^\/api/, "");

/** The configuration area a method is switched on in, as the Configuration rail names it. */
function areaLabel(sectionId: string): string {
  if (sectionId === "sessions") return "Sessions & Security";
  if (sectionId === "mfa") return "Multi-factor authentication";
  return sectionId;
}

/** Why a method cannot be chosen, in the person's words. */
function unavailableReason(method: MfaCatalogueEntry): string {
  if (!method.offered) {
    return `This deployment does not offer ${method.label.toLowerCase()}. It is switched on under Administration → Configuration → ${areaLabel(method.governedBy.sectionId)}.`;
  }
  return "A passkey is registered from inside the application, so it cannot be your first second factor. Enrol another method now, then add a passkey from My Account.";
}

/** The methods this deployment offers, named in one sentence — for the scripts to read out. */
function offeredNames(methods: MfaCatalogueEntry[]): string {
  const offered = methods.filter(method => method.offered);
  if (offered.length === 0) return "nothing";
  const labels = offered.map(method => method.label);
  if (labels.length === 1) return labels[0] ?? "nothing";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The label for the account's own state.
 *
 * `MFA_STATES` is the product's own vocabulary for the three account states, so the sentence this
 * screen prints is the sentence the Users screen prints rather than a paraphrase of it.
 */
function stateLabel(read: MfaPolicyRead): string {
  return MFA_STATES.find(state => state.value === read.state)?.label ?? read.state;
}

/** A date and time, in the reader's own locale — the deadline is a moment, not a number. */
function moment(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

// ── The two widths ───────────────────────────────────────────────────────────────────────────────

type Device = "desktop" | "phone";

/**
 * A frame is a **viewport**, not a setting: it is a fixed width so the rehearsal cannot pretend the
 * phone is as roomy as the desktop. The heights are the height of the window the frames sit in, which
 * is why they are equal at both widths — the phone is not a smaller copy, it is the same screen with
 * less room, and the content scrolls inside it.
 *
 * The desktop number is the viewport a 1366-wide laptop leaves the application once the browser's own
 * furniture and the rail are taken out, and the pair is sized so that the two still fit beside each
 * other — a support person should not have to scroll to compare them.
 */
const DEVICES: Record<Device, { label: string; width: number; height: number; note: string }> = {
  desktop: {
    label: "Desktop — 900 px",
    width: 900,
    height: 640,
    note: "The application as a laptop's browser leaves it: the rail is there, and the wizard is a panel over the page. This is the screen the person will say looks fine.",
  },
  phone: {
    label: "Phone — 375 px",
    width: 375,
    height: 640,
    note: "The same screen at 375 px — an iPhone SE/13 mini class viewport. The rail is gone, the method cards and the code field are one column, and this is where “it looked fine on my desktop” usually breaks.",
  },
};

const DEVICE_ORDER: Device[] = ["desktop", "phone"];

// ── The rehearsal's vocabulary: what each screen looks like, as values ─────────────────────────────

/**
 * One drawn screen. A value rather than a component so a scenario can name the screen it wants and
 * the two arrangements can render the same step in their own layout.
 */
type Screen =
  | { kind: "signin" }
  | { kind: "app"; banner?: string; note?: string }
  | { kind: "account" }
  | { kind: "wizard"; stage: "choose" | "totp" | "email" | "codes" | "done"; gate?: boolean }
  | { kind: "challenge"; delivery: "totp" | "email"; sent?: boolean; remember?: boolean; hint?: string }
  | { kind: "trusted" };

/** One step of a script: the action, the screens, the checks and the one line to say. */
interface RehearsalStep {
  /** What the person does — the support person reads this out, so it is an instruction, not a noun. */
  does: string;
  screen: Screen;
  /** What they should be seeing. */
  sees: string;
  /** What to check when that is not what they are seeing. */
  check: string;
  /** The one thing to say, in the person's own words. */
  say: string;
}

type ScenarioId =
  | "off" | "optional" | "grace" | "stopped"
  | "signin-totp" | "signin-email" | "recovery" | "remember";

interface RehearsalScenario {
  id: ScenarioId;
  title: string;
  /** When this is the state the person is in. */
  when: string;
  steps: RehearsalStep[];
}

/**
 * Where the person actually is, read from the live half rather than guessed.
 *
 * The order matters: being stopped beats being reminded, an enrolment beats both because an enrolled
 * account is asked for a code rather than for a setup, and the instance switch beats everything,
 * because with it off nothing below applies to anybody.
 */
function scenarioForRead(read: MfaPolicyRead): ScenarioId {
  if (!read.enabled) return "off";
  if (read.mustEnrolNow) return "stopped";
  if (read.enrolled) return read.method === "email_code" ? "signin-email" : "signin-totp";
  if (read.mustEnrol) return "grace";
  return "optional";
}

/**
 * The eight scripts.
 *
 * The method names come from the deployment's own catalogue, so a method switched off in
 * configuration is named in the script with the reason beside it instead of vanishing — the question
 * *"why can I not use my passkey"* is one of the questions this screen exists to answer. The account
 * states are named from `MFA_STATES` for the same reason.
 */
function scenariosFor(methods: MfaCatalogueEntry[], methodsKnown: boolean): RehearsalScenario[] {
  const offered = offeredNames(methods);
  const notRead = methodsKnown
    ? ""
    : " This instance has not been read, so the rehearsal cannot say which methods it offers — that is the live half's answer, and it has not arrived.";
  const rememberDaysNote =
    "The checkbox is only drawn when the deployment remembers browsers at all (Remember a browser is above zero). A control that promises not to ask again, on a deployment whose setting is zero, is a promise nobody keeps.";

  return [
    {
      id: "off",
      title: "Second factor switched off",
      when: "The Multi-factor authentication switch is off. Nothing is asked of anybody and nothing may be enrolled.",
      steps: [
        {
          does: "Sign in with the password alone.",
          screen: { kind: "signin" },
          sees: "The password is accepted and the next screen is the application. No code is asked for, on any account — including one that enrolled a factor before the switch was turned off.",
          check:
            "If a code is being asked for with this switch off, they are not signing in here: check the address in their browser against this instance, and whether the desktop app or an integration is pointed at another host. An enrolled account whose second factor is not asked for is correct behaviour for this state, not a fault.",
          say: "Nothing on this instance is asking you for a code, so nothing you are doing is wrong — I am going to check the setting at my end.",
        },
        {
          does: "Try to set one up from My Account → Two-Factor Authentication.",
          screen: { kind: "account" },
          sees: "The screen says the account has no second factor, and the wizard offers nothing that can be completed: the three methods are all shown refused.",
          check:
            "The refusal sentence names the method's own setting, but with the master switch off every method reads as refused — the switch, not the method, is what has to change. That is on this very screen, as Multi-factor authentication.",
          say: "You cannot set one up because the feature is off for the whole instance — that is a switch here at my end, not anything on your account.",
        },
      ],
    },
    {
      id: "optional",
      title: "Optional — somebody enrols on purpose",
      when: "The switch is on and the mode is Optional. Nobody is required to have a second factor, so this is somebody choosing to.",
      steps: [
        {
          does: "Sign in. The password alone is enough.",
          screen: { kind: "app" },
          sees: "Today opens straight away. No reminder strip, no code, nothing waiting.",
          check:
            "If a strip is on screen counting days down, this account is required after all — either the instance is enforced, or this account is set to Required on the Users screen. Both are named on the live half of this window.",
          say: "You are not being made to set anything up — it is optional. If you would like it, we can do it now in two minutes.",
        },
        {
          does: "Open My Account → Two-Factor Authentication.",
          screen: { kind: "account" },
          sees: "“Not set up”, with the sentence that explains what a second factor buys them, and the control to start the wizard.",
          check:
            "If this screen is not reachable at all, they are signed in as a contact or a portal user — the portal has no second factor, so there is nothing to set up there.",
          say: "This is your account screen. The second factor is the code that proves it is you even if somebody has your password.",
        },
        {
          does: "Press the button that starts the wizard, and choose how.",
          screen: { kind: "wizard", stage: "choose" },
          sees: `The methods this instance offers: ${offered}. Anything not offered is still listed, with the reason and the configuration area that governs it.${notRead}`,
          check:
            "A passkey refused with “cannot be the first method” is the product's rule rather than their device: registering one needs an already-signed-in session, so it is added afterwards from My Account. A method refused as “not offered” is a switch on this Configuration screen.",
          say: "Pick the authenticator app — it works with no phone signal and nothing has to be configured for it to reach you.",
        },
        {
          does: "Scan the code with the authenticator app, or type the key by hand.",
          screen: { kind: "wizard", stage: "totp" },
          sees: "A QR code and the enrolment key beside it in text, for anybody whose camera will not cooperare.",
          check:
            "If the QR code will not scan, they can type the key instead — it is the same secret, and the field accepts it either way. Nothing is scanned into this instance; the key never leaves their screen.",
          say: "Open the app, add an account, and point the camera at this square. If it does not read, type the letters underneath instead.",
        },
        {
          does: "Type the six digits the app is showing.",
          screen: { kind: "wizard", stage: "totp" },
          sees: "The code field, and a Verify button that only does something once six digits are in.",
          check:
            "The code is time-based: a code that is refused is almost always a device clock that is not on automatic time, and a code typed as it rotates expires before it is sent. Ask for the *current* digits rather than the ones they read out a minute ago.",
          say: "Read me the six digits that are on screen right now — the app changes them every thirty seconds, so we have to be quick.",
        },
        {
          does: "Read the ten recovery codes aloud to themselves and write them down, then tick the box.",
          screen: { kind: "wizard", stage: "codes" },
          sees: "The ten codes, shown once and never again, and an acknowledgement that has to be ticked before the wizard will finish.",
          check:
            "The codes cannot be fetched again after this screen is closed — the only way back is an administrator resetting the account's second factor, which issues a new set. So this is the moment to be slow on the phone, not the moment to be quick.",
          say: "Before we finish, write these ten codes down somewhere that is not the phone. You will not see them again, and they are how you get in when the phone is lost.",
        },
        {
          does: "Sign out and sign in again, to see it being asked for.",
          screen: { kind: "challenge", delivery: "totp" },
          sees: "The password is accepted and then a second card asks for a code — the app's six digits, or one of the recovery codes.",
          check:
            "If the second card never appears, the second factor was not recorded: check the method shown on this window's live half, and whether the enrolment timed out before it was verified.",
          say: "That is it working: your password and then a code. From now on it asks for both.",
        },
      ],
    },
    {
      id: "grace",
      title: "Required, inside the grace period",
      when: "A second factor is required of this account and the deadline has not passed. They are reminded, and they can carry on working.",
      steps: [
        {
          does: "Carry on working. The deadline is a countdown, not a cliff.",
          screen: {
            kind: "app",
            banner: "Set up a second factor — 6 days left before it is required.",
          },
          sees: "A strip above every page saying how long is left, with the control to start the wizard beside it. Underneath it, the screens they were already using.",
          check:
            "If there is no strip at all, the account is exempt — Not required on the Users screen — or the deadline has already gone and the gate has the screen instead. If the number looks wrong, remember the deadline was stamped when the requirement started, not when the account was created.",
          say: "You have six days, and nothing is blocked. Let us set it up now so it is not a problem on the day.",
        },
        {
          does: "Press the strip.",
          screen: { kind: "wizard", stage: "choose" },
          sees: "The wizard opens over the page they were on — the same wizard, at the same steps, as the version that stops somebody at the door.",
          check:
            "Dismissing the strip hides it for the session only, so it is allowed to come back. If somebody says it will not go away, they are seeing the next page's strip rather than the same one returning.",
          say: "This is the setup itself. Nothing on your other screens has changed.",
        },
        {
          does: "Finish the wizard, and watch the countdown stop.",
          screen: { kind: "app", note: "No reminder strip on this screen any more." },
          sees: "The application, without the strip: the requirement is satisfied the moment the enrolment is verified.",
          check:
            "The policy is re-read when the enrolment is acknowledged rather than when the code is submitted, so a strip that survives the last step means the acknowledgement was not given.",
          say: "The strip is gone and the deadline is behind you.",
        },
        {
          does: "Know what happens on the day it runs out.",
          screen: { kind: "wizard", stage: "choose", gate: true },
          sees: "The gate: the whole application replaced by the enrolment, with no way past it and nothing lost.",
          check:
            "Nothing is deleted and no data is unreachable — the gate is a client state over a server that refuses every route except the enrolment and the sign-out. The same wizard is on the other side of it.",
          say: "If it does expire, nothing is lost. The setup appears on its own and the door opens the moment you finish it.",
        },
      ],
    },
    {
      id: "stopped",
      title: "Required, grace expired — they are stopped",
      when: "A second factor is required, the grace period is over (or was never given), and this account has none. Every screen is replaced by the enrolment; only the enrolment works.",
      steps: [
        {
          does: "Sign in with the password.",
          screen: { kind: "signin" },
          sees: "The password is accepted. Nothing about the sign-in itself refuses them.",
          check:
            "A wrong-password message is a different problem and it stops here: the gate only ever appears after the password was right. Locked accounts, expired passwords and password-change gates all look different from this.",
          say: "Your password was fine — it is the next step that is waiting for you.",
        },
        {
          does: "Look for any screen at all.",
          screen: { kind: "wizard", stage: "choose", gate: true },
          sees: "The whole application replaced by the enrolment. No navigation, no Today, no way round it — and a sign-out, which is the only other thing that works.",
          check:
            "Every other API call is refused while this is on screen, so a screen that half-loads or a page that reports a failed read is the gate doing its job rather than a second fault. If the application appears at all, they have a session from before the requirement started: a reload is what brings the gate.",
          say: "You are not locked out of your account — you are stopped in front of the one screen that fixes it. Let us do it now, and I will stay on the line.",
        },
        {
          does: "Work through the wizard and finish it.",
          screen: { kind: "wizard", stage: "codes", gate: true },
          sees: "The same steps everybody else gets: choose a method, prove it works, then keep the ten recovery codes.",
          check:
            "The door opens on the *acknowledgement* of the recovery codes, not on the code being verified — so a person who closes the window before ticking the box will be back at the gate and will have to run the wizard again.",
          say: "One more screen and you are in — tick the box to say you have written the codes down.",
        },
        {
          does: "Confirm afterwards that it has opened everywhere.",
          screen: { kind: "app", note: "Signed in, with the second factor recorded." },
          sees: "The application, with the requirement satisfied and no strip.",
          check:
            "The gate follows the *session*, not the browser: one tab that works and another that still shows the gate means the second tab has no session, not that the gate is stuck. Signing in again in that tab is the fix, and a hard reload is the way to ask for it.",
          say: "Try the other tab now — if it still shows the setup screen, sign in there again and it will follow.",
        },
      ],
    },
    {
      id: "signin-totp",
      title: "Signing in with an authenticator code",
      when: "The account has an authenticator enrolled, and this browser is not one that has already been trusted.",
      steps: [
        {
          does: "Sign in with the password.",
          screen: { kind: "challenge", delivery: "totp" },
          sees: "The password is accepted and a second card appears: “Two-Factor Authentication — Enter the 6-digit code from your authenticator app”, with the account named under it.",
          check:
            "If the card offers the wrong method, the account's enrolled method is the one shown on the live half. If no card appears at all, this browser was already proved for this enrolment — see the last scenario.",
          say: "You will get a second box now. That is the code from the app, not your password.",
        },
        {
          does: "Open the authenticator app and read the current six digits.",
          screen: {
            kind: "challenge",
            delivery: "totp",
            hint: "The code field accepts six digits, or a recovery code in the form XXXXX-XXXXX.",
          },
          sees: "The six-digit field, and the line under it saying that a recovery code works in the same field.",
          check:
            "A wrong code is almost always a **device clock** that is not on automatic time — a time-based code is computed from the clock, so a phone five minutes out computes a code the server will never accept. The second cause is simply the code rotating while it is typed: thirty seconds is shorter than a sentence on the phone.",
          say: "Type the digits as they appear, and if it refuses, tell me whether the time on your phone is set automatically — that is the usual reason.",
        },
        {
          does: "Sign in and watch what happens to the app.",
          screen: { kind: "app", note: "Signed in, second factor proved." },
          sees: "The application opens, and the sign-in log records a second factor rather than a password alone.",
          check:
            "The code is checked against the enrolment the account holds now. If its second factor was reset by an administrator since the app was set up, every code from the app is refused until the account enrols again — the app entry has to be removed and the QR scanned afresh.",
          say: "You are in, and both steps were recorded.",
        },
      ],
    },
    {
      id: "signin-email",
      title: "Signing in with an emailed code",
      when: "The account's second factor is a code sent to its own address. Offered only where the deployment turns Emailed code on, and it needs a working mail relay.",
      steps: [
        {
          does: "Sign in with the password.",
          screen: { kind: "challenge", delivery: "email", sent: true },
          sees: "The second card, asking for the six-digit code sent to the address on the account, and a line saying a code is on its way and expires in fifteen minutes.",
          check:
            "This method only exists where Emailed code is switched on this Configuration section. If the card offers an authenticator code instead, the account's enrolled method is the other one — the live half names it.",
          say: "The code is coming to your email address, not your phone. It is six digits and it lasts fifteen minutes.",
        },
        {
          does: "Wait for the email, check the spam folder, and type the code.",
          screen: { kind: "challenge", delivery: "email", sent: true },
          sees: "The six-digit field. The code works once, from any device, and only until it expires.",
          check:
            "If nothing arrives, the mail relay is the thing to check: an emailed code that cannot be delivered is refused by the API with its own sentence rather than left to time out, and this section's own requirement banner reports whether an outbound mail server is configured. An address that was changed on the account after the code was requested will not receive it.",
          say: "If it has not come through in a minute, check your junk folder — and if it is still not there, I will check the mail settings at my end.",
        },
        {
          does: "Sign in.",
          screen: { kind: "app", note: "Signed in with an emailed code." },
          sees: "The application opens, and the sign-in log records the method that was used.",
          check:
            "An emailed code is the weakest of the three methods because it puts the second factor on the same channel as a password reset — worth saying out loud to somebody who could use an app instead.",
          say: "You are in. If you can install an authenticator app later, that is a stronger method and you can switch from your account screen.",
        },
      ],
    },
    {
      id: "recovery",
      title: "A lost phone — a recovery code",
      when: "The account has a second factor, the device or app holding it is gone, and one of the ten recovery codes was kept.",
      steps: [
        {
          does: "Sign in with the password, and stop at the code card.",
          screen: { kind: "challenge", delivery: "totp", hint: "A recovery code works in the same field." },
          sees: "The ordinary code card — a recovery code goes in the same field as the six digits, so there is nothing separate to find.",
          check:
            "Nobody should be told to look for a “recovery” link: the card says the field takes one, and that line is the whole of the discovery. If a person has no codes and no device, the way back is an administrator resetting the account's second factor — and that is a change to their account, which this rehearsal will not make.",
          say: "Get the list of ten codes you wrote down — one of them goes in the same box as the six digits.",
        },
        {
          does: "Type one recovery code, in the form it was written.",
          screen: { kind: "challenge", delivery: "totp", hint: "Accepted once — the code is spent as it is used." },
          sees: "The application opens. The code that was used is spent.",
          check:
            "A recovery code is **single use**: ten codes, ten sign-ins, and the one just used cannot be used again. If it is refused, either it has already been spent or the account's second factor has been reset since the codes were issued — a reset replaces all ten, and the old ones stop working.",
          say: "That code is now used up — cross it off the list, because it will not work a second time.",
        },
        {
          does: "Set the account up again, with the new device.",
          screen: { kind: "wizard", stage: "totp" },
          sees: "The wizard, from the account screen: a new QR code, and a new set of ten codes at the end.",
          check:
            "Setting the method up again replaces the enrolment, so the old app entry stops working — and a new set of recovery codes is issued, which makes the remaining nine old ones worthless. That is the moment to say so, while somebody is holding both lists.",
          say: "Set it up on the new phone now, and throw the old list away when the new codes arrive — this starts a fresh set.",
        },
      ],
    },
    {
      id: "remember",
      title: "“Don't ask me again on this browser”",
      when: "The deployment remembers trusted browsers (Remember a browser is above zero). The choice is offered on the second factor itself, never before it is proved.",
      steps: [
        {
          does: "Sign in and prove the second factor, watching for the checkbox.",
          screen: { kind: "challenge", delivery: "totp", remember: true },
          sees: "The code card with a checkbox under the field: “Don't ask for a code on this browser for N days”.",
          check: rememberDaysNote,
          say: "If you leave that box ticked, this computer will not ask you again for a while. Leave it unticked on a shared machine.",
        },
        {
          does: "Sign out, then sign in again on the same browser.",
          screen: { kind: "trusted" },
          sees: "The password alone is enough, and the application opens: the second factor is skipped because this browser was proved for this enrolment, not because it has been switched off.",
          check:
            "The trust is a cookie for that browser and that enrolment only. A different browser, a private window, or the same browser after its cookies were cleared is asked again, which is why “it asked me yesterday and not today” is usually a different browser rather than a change of policy.",
          say: "Your password was enough on this machine because you proved the code here before — another browser will still ask.",
        },
        {
          does: "Ask an administrator to reset the account's second factor.",
          screen: { kind: "challenge", delivery: "totp" },
          sees: "The next sign-in asks for a code again, even on the browser that was trusted.",
          check:
            "The trusted cookie carries no password, and a reset retires it — so the reset takes effect at the next sign-in rather than in a month. Nothing else about the account changes; the sign-in log records the reset and the person who made it.",
          say: "I have reset it, so it will ask you for a code on every device from your next sign-in.",
        },
      ],
    },
  ];
}

// ── Small pieces, token-based, shared by both arrangements ────────────────────────────────────────

/**
 * The four facts and the two notices, drawn once for both interfaces on purpose.
 *
 * These are *statements about the read* — a chip, a key/value line, a notice, the panel a failed read
 * draws — not layouts, so an arrangement for each would be the same component written twice. The
 * layouts around them are what the two interfaces disagree about, and that is where the branch is.
 * All of it is token-based, so both themes and all eight colour schemes move it.
 */
type Tone = "info" | "good" | "warn" | "bad";

const TONES: Record<Tone, string> = {
  info: "border-cyber-600/30 bg-cyber-600/10 text-cyber-300",
  good: "border-alert-green/30 bg-alert-green/10 text-gray-300",
  warn: "border-alert-amber/35 bg-alert-amber/10 text-gray-300",
  bad: "border-alert-red/35 bg-alert-red/10 text-gray-300",
};

function Pill({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${TONES[tone]}`}>
      {title ? <p className="text-xs font-semibold text-white">{title}</p> : null}
      {children ? <div className="mt-0.5 text-[11.5px] leading-relaxed text-gray-400">{children}</div> : null}
    </div>
  );
}

/**
 * One labelled fact in the live half. The label never carries the sentence.
 *
 * `stacked` is for the narrow rail the modern sheet keeps its facts in: at 300 px a 176 px label and
 * its sentence cannot share a line without the sentence becoming a column of three words, so the
 * label goes above the value there and beside it everywhere else.
 */
function Fact({ label, children, stacked = false }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div
      className={
        stacked
          ? "border-b border-surface-border/60 py-1.5 last:border-b-0"
          : "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-surface-border/60 py-1.5 last:border-b-0"
      }
    >
      <span className={`block text-[11px] font-medium uppercase tracking-wide text-gray-500 ${stacked ? "" : "w-44 shrink-0"}`}>
        {label}
      </span>
      <span className="mt-0.5 block min-w-0 flex-1 text-xs text-gray-300">{children}</span>
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[11px] text-gray-300">{children}</code>;
}

/** The panel a read that did not arrive draws. Never a blank frame, and never an invented answer. */
function Unavailable({ message, endpoint, onRetry }: { message: string; endpoint?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-alert-amber/40 bg-alert-amber/10 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alert-amber" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">This could not be read</p>
          <p className="mt-1 text-xs text-gray-400">{message}</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
            The live half is the one part of this screen that cannot be a rehearsal — what this instance
            does has to be what it does.{" "}
            {endpoint ? <>The call is <Mono>{endpoint}</Mono>.</> : null} The scripts below still work:
            they are a rehearsal and do not depend on the read.
          </p>
        </div>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-secondary flex shrink-0 items-center gap-1.5 !px-2.5 !py-1.5 text-xs">
            <RefreshCw size={12} />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Reading({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <RefreshCw size={12} className="animate-spin" />
        Reading {label}…
      </div>
    </div>
  );
}

// ── The live half ─────────────────────────────────────────────────────────────────────────────────

/**
 * What this instance currently does, from the read's own fields.
 *
 * There is no arithmetic here and no second opinion: every line is a field of the policy, or a
 * catalogue row as the deployment described it. The one thing it cannot show is the *length* of the
 * grace period — the endpoint carries the deadline and the whole days left, not the setting that
 * produced them — so the deadline is printed and the setting is named, rather than a number being
 * derived from a date.
 */
function LiveHalf({ read, loading, failure, onRetry, stacked = false }: {
  read: MfaPolicyRead | null;
  loading: boolean;
  failure: string;
  onRetry: () => void;
  /** True in the modern sheet's narrow rail; see `Fact`. */
  stacked?: boolean;
}) {
  if (loading && !read) return <Reading label="what this instance does" />;
  if (!read) {
    return <Unavailable message={failure || "The policy did not arrive."} endpoint={POLICY_ENDPOINT} onRetry={onRetry} />;
  }

  const required = read.mustEnrolNow
    ? "Yes — and they are stopped until they set one up."
    : read.mustEnrol
      ? "Yes, from a deadline they are counting down."
      : read.required
        ? "Yes, but they already have one."
        : "No — this account is not required to have one.";

  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={read.enabled ? "good" : "warn"}>{read.enabled ? "A second factor is available" : "Switched off"}</Pill>
        <Pill tone={read.mode === "enforced" ? "warn" : "info"}>Instance mode: {read.mode === "enforced" ? "Enforced" : "Optional"}</Pill>
        <Pill tone={read.enrolled ? "good" : "info"}>{read.enrolled ? `Enrolled: ${mfaMethodLabel(read.method)}` : "Nothing enrolled"}</Pill>
        <Pill>State: {stateLabel(read)}</Pill>
        <button type="button" onClick={onRetry} className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white">
          <RefreshCw size={11} /> Read again
        </button>
      </div>

      <div className="mt-3">
        <Fact label="Second factor available" stacked={stacked}>
          {read.enabled
            ? `Yes. This deployment offers ${offeredNames(read.catalogue)}.`
            : "No. The instance switch is off, so nothing is asked of anybody and nothing may be enrolled — including on an account that already enrolled one."}
        </Fact>
        <Fact label="Required of this account" stacked={stacked}>{required}</Fact>
        <Fact label="Deadline" stacked={stacked}>
          {read.graceUntil ? (
            <>
              {moment(read.graceUntil)}
              {read.daysLeft !== null ? <> — {read.daysLeft === 1 ? "1 whole day left" : `${read.daysLeft} whole days left`}.</> : <> — this deadline has passed.</>}
            </>
          ) : (
            <>No deadline applies to this account. The length of a grace period is the Grace period setting on this screen; the endpoint carries the deadline, not the setting.</>
          )}
        </Fact>
        <Fact label="Account state" stacked={stacked}>
          {stateLabel(read)} — {MFA_STATES.find(state => state.value === read.state)?.summary ?? ""}
        </Fact>
        <Fact label="Methods" stacked={stacked}>
          {read.catalogue.map(method => (
            <span key={method.id} className="mr-2 inline-flex items-center gap-1">
              <span className={method.offered ? "text-gray-300" : "text-gray-500 line-through"}>{method.label}</span>
              <span className="text-gray-600">
                ({method.offered ? "offered" : `off — set under ${areaLabel(method.governedBy.sectionId)}`})
              </span>
            </span>
          ))}
        </Fact>
      </div>

      {!read.enforcementPossible.ok && read.enforcementPossible.reason ? (
        <div className="mt-3">
          <Notice tone="warn" title="Enforcement is not possible as the settings stand">
            {read.enforcementPossible.reason}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

// ── The rehearsal frames ──────────────────────────────────────────────────────────────────────────

/** The window chrome above a frame, so a screenshot says which screen and which host it is. */
function FrameChrome({ device, path, host }: { device: Device; path: string; host: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-surface-border bg-surface-light px-2.5 py-1.5">
      {device === "desktop" ? (
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-alert-red/60" />
          <span className="h-2 w-2 rounded-full bg-alert-amber/60" />
          <span className="h-2 w-2 rounded-full bg-alert-green/60" />
        </span>
      ) : (
        <span className="h-1.5 w-10 rounded-full bg-surface-border" />
      )}
      <span className="ml-1 min-w-0 flex-1 truncate rounded-md border border-surface-border bg-navy-950 px-2 py-0.5 font-mono text-[10px] text-gray-500">
        {host}
        {path}
      </span>
      <span className="shrink-0 text-[10px] text-gray-600">{device === "desktop" ? <Monitor size={11} /> : <Smartphone size={11} />}</span>
    </div>
  );
}

/** The rail and the top bar of the application, as much of it as a rehearsal needs. */
function AppShell({ device, children }: { device: Device; children: ReactNode }) {
  const items = ["Today", "Tickets", "Clients", "Kumo", "Reports"];
  return (
    <div className="flex min-h-full flex-col bg-navy-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-border bg-surface px-3 py-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-cyber-600/20 text-cyber-400">
          <ShieldCheck size={12} />
        </span>
        <span className="text-[11px] font-semibold text-white">C7NTAX</span>
        {device === "desktop" ? (
          <span className="ml-4 flex items-center gap-3 text-[10.5px] text-gray-500">
            {items.slice(0, 4).map(item => (
              <span key={item} className={item === "Today" ? "text-gray-300" : ""}>{item}</span>
            ))}
          </span>
        ) : null}
        <span className="ml-auto text-[10.5px] text-gray-500">Admin User</span>
      </div>
      <div className="flex min-h-0 flex-1">
        {device === "desktop" ? (
          <div className="w-[136px] shrink-0 space-y-1 border-r border-surface-border bg-navy-950 p-2">
            {items.map(item => (
              <span
                key={item}
                className={`block rounded-md px-2 py-1 text-[10.5px] ${
                  item === "Today" ? "bg-cyber-600/15 text-cyber-300" : "text-gray-500"
                }`}
              >
                {item}
              </span>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 p-3">{children}</div>
      </div>
    </div>
  );
}

/** A placeholder panel, so the rehearsal shows an application rather than an empty page. */
function PanelPlaceholder({ lines = 3, title }: { lines?: number; title: string }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface p-2.5">
      <p className="text-[11px] font-semibold text-gray-300">{title}</p>
      <div className="mt-2 space-y-1.5">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="h-1.5 rounded-full bg-surface-lighter" />
        ))}
      </div>
    </div>
  );
}

/** The reminder strip, worded as the product words it: the deadline in words, beside the way out. */
function ReminderStrip({ sentence }: { sentence: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyber-600/30 bg-cyber-600/10 px-2.5 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-cyber-600/20 text-cyber-300">
        <Lock size={11} />
      </span>
      <span className="min-w-0 flex-1 text-[11px] text-gray-300">{sentence}</span>
      <span className="rounded-md bg-cyber-600 px-2 py-0.5 text-[10.5px] font-medium text-white">Set up now</span>
      <span className="text-[10.5px] text-gray-500">Later</span>
    </div>
  );
}

/**
 * The method chooser, from the deployment's catalogue.
 *
 * Nothing here is a hard-coded method list: what is drawn is what the endpoint said, in the order it
 * said it, with the refused ones kept and given the reason. That is the same rule the real wizard
 * follows, which is what makes the rehearsal worth reading.
 */
function MethodChooser({ methods, methodsKnown, narrow }: { methods: MfaCatalogueEntry[]; methodsKnown: boolean; narrow: boolean }) {
  return (
    <div className={`grid gap-2 ${narrow ? "grid-cols-1" : "grid-cols-3"}`}>
      {methods.map((method, index) => {
        const chosen = index === 0 && method.offered && method.standalone;
        return (
          <div
            key={method.id}
            className={`rounded-lg border p-2.5 ${chosen ? "border-cyber-500/60 bg-cyber-600/10" : "border-surface-border"}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] font-semibold ${method.offered ? "text-white" : "text-gray-500"}`}>{method.label}</span>
              {chosen ? <span className="ml-auto text-cyber-300">•</span> : null}
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">{method.summary}</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-gray-600">
              {methodsKnown
                ? method.offered && method.standalone
                  ? "Offered by this deployment."
                  : unavailableReason(method)
                : "This instance has not been read, so this frame cannot say whether it is offered."}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** The ten recovery codes as the wizard shows them: once, and as a shape rather than as codes. */
function RecoveryCodes() {
  return (
    <div className="rounded-lg border border-surface-border bg-navy-950 p-2.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {Array.from({ length: 10 }).map((_, index) => (
          <span key={index} className="font-mono text-[10.5px] tracking-wide text-gray-400">•••••-•••••</span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-gray-600">
        The rehearsal draws the shape rather than the codes: real ones are issued once, at enrolment, and
        are never fetched again.
      </p>
    </div>
  );
}

/** The enrolment wizard, as the four moments a person meets it. */
function WizardFrame({ screen, methods, methodsKnown, narrow }: {
  screen: Extract<Screen, { kind: "wizard" }>;
  methods: MfaCatalogueEntry[];
  methodsKnown: boolean;
  narrow: boolean;
}) {
  const stages = ["Choose a method", "Prove it works", "Save your recovery codes"];
  const at = screen.stage === "choose" ? 0 : screen.stage === "codes" || screen.stage === "done" ? 2 : 1;

  const track = (
    <div className="flex flex-wrap items-center gap-1.5">
      {stages.map((stage, index) => (
        <span key={stage} className="flex items-center gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
              index === at
                ? "border-cyber-600/40 bg-cyber-600/15 text-cyber-300"
                : index < at
                  ? "border-alert-green/30 text-gray-400"
                  : "border-surface-border text-gray-600"
            }`}
          >
            {index < at ? <Check size={9} className="mr-1 inline" /> : null}
            {stage}
          </span>
          {index < stages.length - 1 ? <ChevronRight size={11} className="text-gray-700" /> : null}
        </span>
      ))}
    </div>
  );

  const body = (
    <div className="space-y-3">
      {track}
      {screen.stage === "choose" ? (
        <>
          <p className="text-[11px] text-gray-400">How would you like to prove it is you?</p>
          <MethodChooser methods={methods} methodsKnown={methodsKnown} narrow={narrow} />
          <div className="flex justify-end">
            <span className="rounded-md bg-cyber-600 px-2.5 py-1 text-[10.5px] font-medium text-white">Continue</span>
          </div>
        </>
      ) : null}

      {screen.stage === "totp" ? (
        <>
          <p className="text-[11px] text-gray-400">Scan this with your authenticator app, or type the key.</p>
          <div className="flex flex-wrap items-start gap-3">
            <div className={`flex shrink-0 items-center justify-center rounded-lg border border-surface-border bg-white/5 ${narrow ? "h-28 w-28" : "h-32 w-32"}`}>
              <span className="text-center text-[9.5px] leading-tight text-gray-500">
                QR code
                <br />
                (drawn as a placeholder)
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-1.5 rounded-md border border-surface-border bg-navy-950 px-2 py-1.5">
                <KeyRound size={11} className="shrink-0 text-gray-500" />
                <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-gray-300">JBSW Y3DP EHPK 3PXP</code>
                <span className="shrink-0 text-[10px] text-gray-600">Copy</span>
              </div>
              <div className="rounded-md border border-surface-border bg-navy-950 px-2 py-1.5 text-center font-mono text-[13px] tracking-[0.28em] text-gray-500">
                000000
              </div>
              <div className="flex justify-end">
                <span className="rounded-md bg-cyber-600 px-2.5 py-1 text-[10.5px] font-medium text-white">Verify and continue</span>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {screen.stage === "email" ? (
        <>
          <p className="text-[11px] text-gray-400">We will send a six-digit code to the address on your account.</p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-surface-border bg-navy-950 px-2 py-1.5 text-[11px] text-gray-400">
              the address on the account
            </span>
            <span className="shrink-0 rounded-md bg-cyber-600 px-2.5 py-1 text-[10.5px] font-medium text-white">Send me a code</span>
          </div>
        </>
      ) : null}

      {screen.stage === "codes" ? (
        <>
          <p className="text-[11px] text-gray-400">
            Your authenticator is working. Before you finish, take the recovery codes — they are how you get
            in when the phone is lost, and they are shown once.
          </p>
          <RecoveryCodes />
          <span className="flex items-start gap-1.5 text-[10.5px] text-gray-400">
            <span className="mt-0.5 h-3 w-3 shrink-0 rounded border border-surface-border" />
            I have stored these recovery codes somewhere safe.
          </span>
          <div className="flex justify-end">
            <span className="rounded-md bg-cyber-600 px-2.5 py-1 text-[10.5px] font-medium text-white">Finish</span>
          </div>
        </>
      ) : null}

      {screen.stage === "done" ? (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-300">
          <Check size={12} className="text-alert-green" /> Your second factor is set up.
        </p>
      ) : null}
    </div>
  );

  if (screen.gate) {
    return (
      <div className="flex min-h-full items-center justify-center bg-navy-950 p-4">
        <div className="w-full max-w-xl">
          <p className="text-[11px] text-gray-500">C7NTAX — every screen is replaced until this is done</p>
          <div className="mt-2 rounded-xl border border-surface-border bg-surface p-4">
            <p className="text-xs font-semibold text-white">You must set up a second factor before using C7NTAX.</p>
            <div className="mt-3">{body}</div>
          </div>
          <p className="mt-2 text-[10.5px] text-gray-600">Sign out</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      <AppShell device={narrow ? "phone" : "desktop"}>
        <PanelPlaceholder title="Today" lines={3} />
      </AppShell>
      {/* The wizard as a sheet over the page it was opened from — the same wizard the gate uses. */}
      <div className="absolute inset-0 flex items-end justify-center bg-black/50 p-2 sm:items-center">
        <div className="max-h-full w-full max-w-2xl overflow-auto rounded-xl border border-surface-border bg-surface p-4">
          {body}
        </div>
      </div>
    </div>
  );
}

/** The sign-in page, with or without the second factor — the two screens a person meets first. */
function SignInFrame({ screen, narrow }: { screen: Extract<Screen, { kind: "signin" }> | Extract<Screen, { kind: "challenge" }>; narrow: boolean }) {
  const challenge = screen.kind === "challenge";
  return (
    <div className="flex min-h-full items-start justify-center bg-navy-950 p-4">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyber-600/20 text-cyber-400">
            <ShieldCheck size={13} />
          </span>
          <span className="text-sm font-semibold text-white">C7NTAX</span>
        </div>

        <div className="card space-y-2.5">
          <p className="text-[11px] text-gray-400">Sign in to your account</p>
          <div className="space-y-1.5">
            <span className="block text-[10px] uppercase tracking-wide text-gray-600">Email</span>
            <div className="rounded-md border border-surface-border bg-navy-950 px-2 py-1.5 text-[11px] text-gray-500">
              admin@example.com
            </div>
            <span className="block text-[10px] uppercase tracking-wide text-gray-600">Password</span>
            <div className="rounded-md border border-surface-border bg-navy-950 px-2 py-1.5 text-[11px] text-gray-500">
              ••••••••••
            </div>
          </div>
          <div className="rounded-md bg-cyber-600 px-2 py-1.5 text-center text-[11px] font-medium text-white">Sign in</div>
        </div>

        {challenge ? (
          <div className="card space-y-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cyber-600/20 text-cyber-300">
                {screen.delivery === "email" ? <Mail size={13} /> : <ShieldCheck size={13} />}
              </span>
              <div>
                <p className="text-[12px] font-semibold text-white">Two-Factor Authentication</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-gray-500">
                  {screen.delivery === "email"
                    ? "Enter the 6-digit code we sent to the address on your account"
                    : "Enter the 6-digit code from your authenticator app"}
                  {" for "}
                  <b className="font-semibold text-gray-300">admin@example.com</b>.
                  {screen.delivery === "totp" ? " A recovery code works in this field too." : null}
                </p>
              </div>
            </div>

            {screen.delivery === "email" && screen.sent ? (
              <p className="flex items-start gap-1.5 text-[10.5px] text-gray-500">
                <Check size={11} className="mt-[2px] shrink-0 text-alert-green" />
                A code is on its way. It is six digits and it expires in 15 minutes.
              </p>
            ) : null}

            {screen.delivery === "totp" && !narrow ? (
              <div className="flex gap-1.5">
                <span className="rounded-full border border-cyber-600/40 bg-cyber-600/15 px-2 py-0.5 text-[10.5px] text-cyber-300">
                  Authenticator app
                </span>
                <span className="rounded-full border border-surface-border px-2 py-0.5 text-[10.5px] text-gray-500">
                  Email me a code
                </span>
              </div>
            ) : null}

            <span className="block text-[10px] uppercase tracking-wide text-gray-600">
              {screen.delivery === "email" ? "6-digit code" : "Code, or a recovery code"}
            </span>
            <div className="rounded-md border border-surface-border bg-navy-950 px-2 py-1.5 text-center font-mono text-[13px] tracking-[0.28em] text-gray-600">
              {screen.delivery === "email" ? "000000" : "000000 or XXXXX-XXXXX"}
            </div>
            {screen.hint ? <p className="text-[10px] leading-relaxed text-gray-600">{screen.hint}</p> : null}
            {screen.remember ? (
              <span className="flex items-start gap-1.5 text-[10.5px] text-gray-400">
                <span className="mt-0.5 h-3 w-3 shrink-0 rounded border border-surface-border bg-cyber-600" />
                Don’t ask for a code on this browser for 30 days
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** My Account → Two-Factor Authentication, which is where somebody enrols on purpose. */
function AccountFrame({ read, narrow }: { read: MfaPolicyRead | null; narrow: boolean }) {
  const enrolled = !!read?.enrolled;
  return (
    <div className={narrow ? "space-y-3" : "mx-auto max-w-2xl space-y-3"}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-cyber-600/20 text-cyber-400">
          <ShieldCheck size={15} />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-white">Two-Factor Authentication</p>
          <p className="mt-0.5 text-[10.5px] text-gray-500">My Account</p>
        </div>
      </div>
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-white">
            {enrolled ? mfaMethodLabel(read?.method) : "Not set up"}
          </span>
          <Pill tone={enrolled ? "good" : "info"}>{enrolled ? "Signing in asks for this" : "Nothing is asked for yet"}</Pill>
        </div>
        <p className="text-[10.5px] leading-relaxed text-gray-500">
          {enrolled
            ? "Signing in asks for this second factor. Changing it here replaces the method you are asked for."
            : read?.mustEnrolNow
              ? "This account has to have a second factor before it can be used."
              : read?.mustEnrol
                ? "The requirement is counting down — set one up now, or come back before the deadline."
                : "Nothing asks you for a second factor yet. Setting one up means a stolen password is not enough to get into your account."}
        </p>
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-cyber-600 px-2.5 py-1 text-[10.5px] font-medium text-white">
            {enrolled ? "Change the method" : "Set up a second factor"}
          </span>
          <span className="text-[10.5px] text-gray-600">Recovery codes are replaced when the method changes.</span>
        </div>
      </div>
    </div>
  );
}

/** The application with nothing to do, used for the steps where the point is that it is undisturbed. */
function AppContent({ screen, read, narrow }: { screen: Extract<Screen, { kind: "app" } | { kind: "trusted" }>; read: MfaPolicyRead | null; narrow: boolean }) {
  const banner = screen.kind === "app" ? screen.banner : undefined;
  const note = screen.kind === "app" ? screen.note : "This browser is trusted for this enrolment.";
  return (
    <div className="space-y-3">
      {banner ? <ReminderStrip sentence={banner} /> : null}
      <div className={narrow ? "space-y-2" : "grid grid-cols-3 gap-2"}>
        <PanelPlaceholder title="Today" lines={3} />
        <PanelPlaceholder title="My tickets" lines={3} />
        <PanelPlaceholder title="Recent activity" lines={3} />
      </div>
      {note ? <p className="text-[10px] text-gray-600">{note}</p> : null}
      {screen.kind === "trusted" && read ? (
        <p className="text-[10px] text-gray-600">Signed in as the account the live half describes; no code was asked for.</p>
      ) : null}
    </div>
  );
}

/**
 * One frame: the chrome, then the screen the step names.
 *
 * `device` is passed rather than measured. A frame is a fixed-width box inside a window that is
 * wider than it, so a media query would answer for the *window* and draw a phone-width layout in the
 * desktop frame — the one thing these frames exist to distinguish.
 */
function Frame({ device, screen, read, methods, methodsKnown, host, caption = true }: {
  device: Device;
  screen: Screen;
  read: MfaPolicyRead | null;
  methods: MfaCatalogueEntry[];
  methodsKnown: boolean;
  host: string;
  /** False when the arrangement around it already names the width, as the classic fieldset does. */
  caption?: boolean;
}) {
  const narrow = device === "phone";
  const body = (() => {
    switch (screen.kind) {
      case "signin":
      case "challenge":
        return <SignInFrame screen={screen} narrow={narrow} />;
      case "account":
        return (
          <AppShell device={device}>
            <AccountFrame read={read} narrow={narrow} />
          </AppShell>
        );
      case "wizard":
        return <WizardFrame screen={screen} methods={methods} methodsKnown={methodsKnown} narrow={narrow} />;
      case "trusted":
        return (
          <AppShell device={device}>
            <AppContent screen={screen} read={read} narrow={narrow} />
          </AppShell>
        );
      case "app":
        return (
          <AppShell device={device}>
            <AppContent screen={screen} read={read} narrow={narrow} />
          </AppShell>
        );
    }
  })();

  const path =
    screen.kind === "signin" || screen.kind === "challenge"
      ? "/login"
      : screen.kind === "account"
        ? "/account/two-factor"
        : "/";

  return (
    <figure className="min-w-0 shrink-0" style={{ width: DEVICES[device].width }}>
      {caption ? <figcaption className="text-xs font-semibold text-white">{DEVICES[device].label}</figcaption> : null}
      <div
        className={`flex flex-col overflow-hidden rounded-xl border border-surface-border bg-navy-900 ${caption ? "mt-2" : ""}`}
        style={{ width: DEVICES[device].width, height: DEVICES[device].height }}
      >
        <FrameChrome device={device} path={path} host={host} />
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{DEVICES[device].note}</p>
    </figure>
  );
}

// ── The surfaces' shared content ──────────────────────────────────────────────────────────────────

interface SurfaceProps {
  read: MfaPolicyRead | null;
  methods: MfaCatalogueEntry[];
  methodsKnown: boolean;
  loading: boolean;
  failure: string;
  onRetry: () => void;
  scenarios: RehearsalScenario[];
  scenario: RehearsalScenario;
  /** The step being rehearsed, resolved once so no surface can resolve it differently. */
  step: RehearsalStep;
  stepIndex: number;
  onScenario: (id: ScenarioId) => void;
  onStep: (index: number) => void;
  host: string;
}

/**
 * The scenario picker: pills you press in the modern interface, a labelled `select` in the classic one.
 *
 * This is furniture, so it is the one piece of the content that really is two designs — the same
 * state, the same list, in the two idioms the repository asks for.
 */
function ScenarioPicker({ scenarios, scenario, onScenario }: {
  scenarios: RehearsalScenario[];
  scenario: RehearsalScenario;
  onScenario: (id: ScenarioId) => void;
}) {
  const modern = useModernInterface();
  if (modern) {
    return (
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Scenario">
        {scenarios.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === scenario.id}
            onClick={() => onScenario(item.id)}
            className={`rounded-full border px-3 py-1.5 text-left text-[11px] font-medium transition-colors ${
              item.id === scenario.id
                ? "border-cyber-600/40 bg-cyber-600/15 text-cyber-300"
                : "border-surface-border text-gray-400 hover:border-gray-600 hover:text-white"
            }`}
          >
            {item.title}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500" htmlFor="mfa-sim-scenario">
        Scenario
      </label>
      <select
        id="mfa-sim-scenario"
        className="input-field"
        value={scenario.id}
        onChange={event => onScenario(event.target.value as ScenarioId)}
      >
        {scenarios.map(item => (
          <option key={item.id} value={item.id}>{item.title}</option>
        ))}
      </select>
    </div>
  );
}

/** The step track: a track you step along in the modern interface, numbered controls in the classic. */
function StepControls({ scenario, stepIndex, onStep }: {
  scenario: RehearsalScenario;
  stepIndex: number;
  onStep: (index: number) => void;
}) {
  const modern = useModernInterface();
  const at = Math.min(stepIndex, scenario.steps.length - 1);
  const back = () => onStep(Math.max(0, at - 1));
  const forward = () => onStep(Math.min(scenario.steps.length - 1, at + 1));

  if (modern) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {scenario.steps.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Step ${index + 1}`}
              aria-current={index === at ? "step" : undefined}
              onClick={() => onStep(index)}
              className={`h-6 w-6 rounded-full border text-[10.5px] font-medium transition-colors ${
                index === at
                  ? "border-cyber-600/40 bg-cyber-600/20 text-cyber-300"
                  : index < at
                    ? "border-alert-green/30 text-gray-400"
                    : "border-surface-border text-gray-600 hover:text-gray-300"
              }`}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-500">
          Step {at + 1} of {scenario.steps.length}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={back} disabled={at === 0} className="btn-secondary flex items-center gap-1.5 text-xs disabled:opacity-40">
            <ChevronLeft size={12} /> Back
          </button>
          <button type="button" onClick={forward} disabled={at >= scenario.steps.length - 1} className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-40">
            Next <ChevronRight size={12} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-gray-400">
        Step <span className="font-medium text-gray-300">{at + 1}</span> of {scenario.steps.length}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <button type="button" onClick={back} disabled={at === 0} className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-40">
          <ChevronLeft size={13} /> Previous
        </button>
        <button type="button" onClick={forward} disabled={at >= scenario.steps.length - 1} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-40">
          Next step <ChevronRight size={13} />
        </button>
      </span>
    </div>
  );
}

/**
 * The per-step notes — the point of the whole screen.
 *
 * Three labelled rows in both arrangements (what they see, what to check, what to say), because they
 * are three facts about one step rather than three layouts. The modern arrangement puts the sentence
 * to say beside the control that carries on to the next step; the classic one labels all three in
 * order, which is what a form does.
 */
function StepNotes({ step }: { step: RehearsalStep }) {
  return (
    <>
      <Fact label="What they see">{step.sees}</Fact>
      <Fact label="If it is not that">{step.check}</Fact>
      <Fact label="Say this">{step.say}</Fact>
    </>
  );
}

/** The step, in the modern arrangement: the sentence to say beside the control that moves on. */
function StepHeadline({ step }: { step: RehearsalStep }) {
  return (
    <div className="rounded-xl border border-cyber-600/30 bg-cyber-600/10 px-3.5 py-3">
      <p className="text-[10.5px] uppercase tracking-wide text-gray-500">The step</p>
      <p className="mt-0.5 text-sm font-medium text-white">{step.does}</p>
    </div>
  );
}

/** The two widths. Side by side in the modern interface, stacked in the classic one. */
function Frames({ props, arrangement }: { props: SurfaceProps; arrangement: "row" | "column" }) {
  return (
    <div className={arrangement === "row" ? "flex flex-wrap items-start gap-4" : "space-y-5"}>
      {DEVICE_ORDER.map(device =>
        arrangement === "row" ? (
          <div key={device} className="max-w-full overflow-x-auto pb-1">
            <Frame
              device={device}
              screen={props.step.screen}
              read={props.read}
              methods={props.methods}
              methodsKnown={props.methodsKnown}
              host={props.host}
            />
          </div>
        ) : (
          <fieldset key={device} className="min-w-0 rounded-lg border border-surface-border p-3">
            <legend className="px-1 text-xs font-semibold text-white">{DEVICES[device].label}</legend>
            <div className="max-w-full overflow-x-auto">
              <Frame
                device={device}
                screen={props.step.screen}
                read={props.read}
                methods={props.methods}
                methodsKnown={props.methodsKnown}
                host={props.host}
                caption={false}
              />
            </div>
          </fieldset>
        ),
      )}
    </div>
  );
}

/** The read-only promise, said in the interface rather than only in a comment. */
function ReadOnlyNote() {
  return (
    <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-gray-500">
      <Lock size={12} className="mt-0.5 shrink-0 text-cyber-400" />
      Nothing is written from here: no enrolment, no secret, no setting, no change to anybody's account.
      The only call this screen makes is the policy read. The frames are a rehearsal of what the person
      sees — the real screens are the authority if the two ever differ.
    </p>
  );
}

// ── The three surfaces ────────────────────────────────────────────────────────────────────────────

/** The window's own name, so a second press raises the window that is already open. */
const POPUP_NAME = "c7ntax-mfa-simulation";
const POPUP_FEATURES = "popup=yes,width=1540,height=940,left=40,top=30";

/**
 * The window's document: the same content, arranged by whichever interface is in use.
 *
 * Unlike the email simulation — whose window is one arrangement because its two designs are the
 * *app's* surfaces — this window is the surface an administrator opens and screenshots, so it wears
 * the interface it was opened from: a rail of scenario pills with the widths side by side, against a
 * labelled `select` with the widths stacked. Same state and same words either way.
 */
function WindowDocument(props: SurfaceProps) {
  const modern = useModernInterface();
  return (
    <div className="min-h-screen bg-navy-950 px-6 py-6">
      <div className="mx-auto max-w-[1440px]">
        <header>
          <span className="chip chip--on">Rehearsal</span>
          <h1 className="mt-3 text-lg font-semibold text-white">A second factor, being set up — step by step</h1>
          <p className="mt-1.5 max-w-[80ch] text-xs leading-relaxed text-gray-400">
            The top half is what this instance actually does, read from the API. The half below it is a
            rehearsal: pick the state the person on the phone is in, and walk the steps in time with them.
          </p>
          <div className="mt-3">
            <ReadOnlyNote />
          </div>
        </header>

        <section aria-labelledby="mfa-sim-live" className="mt-6">
          <h2 id="mfa-sim-live" className="text-sm font-semibold text-white">What this instance currently does</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Read from <Mono>GET {POLICY_ENDPOINT}</Mono> just now — this is the answer the sign-in, the
            gate, the wizard and the banner all use, not a mock of it.
          </p>
          <div className="mt-3">
            <LiveHalf read={props.read} loading={props.loading} failure={props.failure} onRetry={props.onRetry} />
          </div>
        </section>

        {modern ? (
          <section aria-labelledby="mfa-sim-script" className="mt-6 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="min-w-0">
              <h2 id="mfa-sim-script" className="text-sm font-semibold text-white">The scenarios</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">The states that differ.</p>
              <div className="mt-3">
                <ScenarioPicker scenarios={props.scenarios} scenario={props.scenario} onScenario={props.onScenario} />
              </div>
            </div>
            <div className="min-w-0 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-white">{props.scenario.title}</h2>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">{props.scenario.when}</p>
              </div>
              <Frames props={props} arrangement="row" />
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface p-3.5">
                <StepHeadline step={props.step} />
                <div className="ml-auto">
                  <StepControls scenario={props.scenario} stepIndex={props.stepIndex} onStep={props.onStep} />
                </div>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface p-3.5">
                <StepNotes step={props.step} />
              </div>
            </div>
          </section>
        ) : (
          <section aria-labelledby="mfa-sim-script-classic" className="mt-6 space-y-4">
            <h2 id="mfa-sim-script-classic" className="text-sm font-semibold text-white">The script</h2>
            <div className="rounded-xl border border-surface-border bg-surface p-4">
              <ScenarioPicker scenarios={props.scenarios} scenario={props.scenario} onScenario={props.onScenario} />
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">{props.scenario.when}</p>
            </div>
            <fieldset className="rounded-lg border border-surface-border p-4">
              <legend className="px-1 text-xs font-semibold text-white">{props.scenario.title}</legend>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-border/60 pb-2">
                <span className="w-44 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500">What they do</span>
                <span className="min-w-0 flex-1 text-xs text-gray-300">{props.step.does}</span>
              </div>
              <StepNotes step={props.step} />
              <div className="mt-3">
                <StepControls scenario={props.scenario} stepIndex={props.stepIndex} onStep={props.onStep} />
              </div>
            </fieldset>
            <Frames props={props} arrangement="column" />
          </section>
        )}
      </div>
    </div>
  );
}

/** Escape closes the overlay, and the close control takes the focus, so it is not a trap. */
function useDismissible(onClose: () => void) {
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    close.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return close;
}

/** The modern fallback: a sheet over the panel, with the scenario rail beside the step. */
function SimulatorSheet({ props, onClose }: { props: SurfaceProps; onClose: () => void }) {
  const close = useDismissible(onClose);
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/60 animate-fade-in" role="dialog" aria-modal="true" aria-label="MFA setup simulator">
      <div className="flex h-full w-full max-w-[1460px] animate-slide-in-right flex-col border-l border-surface-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-5 py-3">
          <span className="chip chip--on">Rehearsal</span>
          <span className="text-sm font-semibold text-white">Simulate a setup</span>
          <span className="text-[11px] text-gray-500">Nothing is written</span>
          <button ref={close} type="button" onClick={onClose} className="btn-secondary ml-auto text-xs">
            <X size={13} aria-hidden />
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {/*
            * The facts rail and the step notes are two columns — a rail of scenarios, and the step
            * beside it — but the frames are *not*: they need the whole sheet's width to stand side by
            * side, and a desktop frame squeezed into a column would be a rehearsal of a narrower
            * screen than anybody uses.
            */}
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <div className="min-w-0 space-y-3">
              <div>
                <p className="text-xs font-semibold text-white">What this instance does</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  The live answer, read just now. The scenarios beside it are the rehearsal.
                </p>
              </div>
              <LiveHalf read={props.read} loading={props.loading} failure={props.failure} onRetry={props.onRetry} stacked />
              <div>
                <p className="text-xs font-semibold text-white">The scenarios</p>
                <div className="mt-2 flex flex-col items-stretch gap-1.5">
                  <ScenarioPicker scenarios={props.scenarios} scenario={props.scenario} onScenario={props.onScenario} />
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-3">
              <div>
                <p className="text-sm font-semibold text-white">{props.scenario.title}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">{props.scenario.when}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface-lighter p-3.5">
                <StepHeadline step={props.step} />
                <div className="ml-auto">
                  <StepControls scenario={props.scenario} stepIndex={props.stepIndex} onStep={props.onStep} />
                </div>
              </div>
              <div className="rounded-xl border border-surface-border bg-surface-lighter p-3.5">
                <StepNotes step={props.step} />
              </div>
            </div>
          </div>

          <Frames props={props} arrangement="row" />
          <ReadOnlyNote />
        </div>
      </div>
    </div>
  );
}

/**
 * The classic fallback: a dialog with a heading and a Close button, the scenario as a labelled
 * `select`, the steps numbered and read top to bottom, and the two widths stacked — a form.
 */
function SimulatorDialog({ props, onClose }: { props: SurfaceProps; onClose: () => void }) {
  const close = useDismissible(onClose);
  const at = Math.min(props.stepIndex, props.scenario.steps.length - 1);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="MFA setup simulator">
      <div className="card max-h-[92vh] w-full max-w-6xl overflow-auto !p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
          <h2 className="text-sm font-semibold text-white">MFA setup simulator</h2>
          <span className="text-xs text-gray-500">A rehearsal — nothing is written.</span>
          <button ref={close} type="button" onClick={onClose} className="btn-secondary ml-auto text-xs">
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What this instance does</h3>            <div className="mt-2">
              <LiveHalf read={props.read} loading={props.loading} failure={props.failure} onRetry={props.onRetry} />
            </div>
          </div>

          <fieldset className="rounded-lg border border-surface-border p-3">
            <legend className="px-1 text-xs font-semibold text-white">The scenario</legend>
            <ScenarioPicker scenarios={props.scenarios} scenario={props.scenario} onScenario={props.onScenario} />
            <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">{props.scenario.when}</p>
          </fieldset>

          <fieldset className="rounded-lg border border-surface-border p-3">
            <legend className="px-1 text-xs font-semibold text-white">
              {props.scenario.title} — step {at + 1} of {props.scenario.steps.length}
            </legend>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-surface-border/60 pb-2">
              <span className="w-40 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500">The step</span>
              <span className="min-w-0 flex-1 text-xs text-gray-300">{props.step.does}</span>
            </div>
            <StepNotes step={props.step} />
            <div className="mt-3">
              <StepControls scenario={props.scenario} stepIndex={props.stepIndex} onStep={props.onStep} />
            </div>
          </fieldset>

          <Frames props={props} arrangement="column" />
          <ReadOnlyNote />
        </div>
      </div>
    </div>
  );
}

/**
 * A window holding the rehearsal, with the app's own skin written into it.
 *
 * The stylesheets are **cloned**, and the theme attributes copied, at the moment the window opens: a
 * separate document resolves no variable and loads no rule of its own, and re-typing the palette here
 * would be the same colour in a second place, drifting from the first.
 */
function openSimulatorWindow(title: string): { win: Window; host: HTMLElement } | null {
  const win = window.open("", POPUP_NAME, POPUP_FEATURES);
  if (!win) return null;
  // The window keeps a reference to this one otherwise, which lets the document it lands on navigate it.
  win.opener = null;

  const doc = win.document;
  doc.open();
  doc.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "</head><body></body></html>",
  );
  doc.close();

  const root = document.documentElement;
  for (const name of ["data-theme", "data-palette-dark", "data-palette-light", "data-density"]) {
    const value = root.getAttribute(name);
    if (value) doc.documentElement.setAttribute(name, value);
  }
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    doc.head.appendChild(node.cloneNode(true));
  }
  doc.title = title;

  const host = doc.createElement("div");
  doc.body.appendChild(host);
  return { win, host };
}

// ── The action, and both of its arrangements ──────────────────────────────────────────────────────

/**
 * The action on the Multi-factor authentication section.
 *
 * Two designs, deliberately, because the repository asks for two rather than for one restyled:
 *
 *   · **Modern** — a strip inside the settings panel: the icon in a tile, the sentence about what this
 *     is, and the pill that acts, on one line, which is how the Modern interface puts an action beside the
 *     sentence that explains it.
 *   · **Classic** — a card with a heading, a paragraph and a control row underneath, which is what
 *     every other classic screen offering a simulator looks like (see the add-in simulator).
 */
export function MfaSetupSimulator() {
  const modern = useModernInterface();
  const [read, setRead] = useState<MfaPolicyRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("optional");
  const [stepIndex, setStepIndex] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [popupLive, setPopupLive] = useState(false);
  const popup = useRef<{ win: Window; root: Root } | null>(null);
  /** Until the reader picks a scenario themselves, the picker follows the live read. */
  const following = useRef(true);

  /**
   * The one call this screen makes.
   *
   * Read, never derived: the numbers a support person quotes have to be the numbers the gate is using.
   * A failure is kept as a sentence rather than as a null, because an empty panel is what makes
   * somebody conclude the feature is broken.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<MfaPolicyRead>(POLICY_PATH);
      setRead(res.data);
      setFailure("");
      if (following.current) {
        setScenarioId(scenarioForRead(res.data));
        setStepIndex(0);
      }
    } catch (error) {
      setRead(null);
      setFailure(apiErrorMessage(error, "The policy could not be read, so what this instance does is unknown."));
    } finally {
      setLoading(false);
    }
  }, []);

  const methods: MfaCatalogueEntry[] = read
    ? read.catalogue
    : MFA_METHODS.map(method => ({ ...method, offered: false }));
  const methodsKnown = read !== null;
  const scenarios = scenariosFor(methods, methodsKnown);
  const scenario = scenarios.find(item => item.id === scenarioId) ?? scenarios[0]!;
  const step = scenario.steps[Math.min(stepIndex, scenario.steps.length - 1)]!;

  const props: SurfaceProps = {
    read,
    methods,
    methodsKnown,
    loading,
    failure,
    onRetry: () => void load(),
    scenarios,
    scenario,
    step,
    stepIndex,
    onScenario: id => {
      following.current = false;
      setScenarioId(id);
      setStepIndex(0);
    },
    onStep: setStepIndex,
    host: window.location.host,
  };

  // The content is pushed into the window on every render rather than only when it opens: the read
  // answers after the press, and a window that showed "reading…" and then never changed would be
  // worse than no window at all.
  useEffect(() => {
    const current = popup.current;
    if (!current || current.win.closed) return;
    current.root.render(<WindowDocument {...props} />);
  });

  /** The window belongs to the surface that opened it: when that goes, the window goes with it. */
  useEffect(
    () => () => {
      const current = popup.current;
      popup.current = null;
      if (!current) return;
      try {
        current.root.unmount();
      } catch {
        // The document it was mounted into is already gone.
      }
      if (!current.win.closed) {
        try {
          current.win.close();
        } catch {
          // A browser may refuse a script's attempt to close a window; there is nothing to do about it.
        }
      }
    },
    [],
  );

  /** The reader may close the window themselves; noticing is what lets the next press open a new one. */
  useEffect(() => {
    if (!popupLive) return;
    const timer = window.setInterval(() => {
      const current = popup.current;
      if (!current || !current.win.closed) return;
      popup.current = null;
      try {
        current.root.unmount();
      } catch {
        // The document it was mounted into is already gone.
      }
      setPopupLive(false);
    }, 700);
    return () => window.clearInterval(timer);
  }, [popupLive]);

  /**
   * Opening the window, and re-pressing to raise it.
   *
   * A plain function rather than a `useCallback`: it reads the props of the render it was created in,
   * which is exactly what the initial paint of the window needs, and memoising a closure over every
   * scenario would be a cache with one reader.
   */
  const simulate = () => {
    const current = popup.current;
    if (current && !current.win.closed) {
      current.win.focus();
      if (!read && !loading) void load();
      return;
    }
    /*
     * Opened synchronously, before anything could be awaited: a window raised after an `await` has lost
     * the press's activation and is blocked. The read follows, and the content follows the read.
     */
    let opened: { win: Window; host: HTMLElement } | null = null;
    try {
      opened = openSimulatorWindow("MFA setup simulator");
    } catch {
      opened = null;
    }
    if (!opened) {
      setFallback(true);
      if (!read) void load();
      return;
    }
    popup.current = { win: opened.win, root: createRoot(opened.host) };
    popup.current.root.render(<WindowDocument {...props} />);
    setPopupLive(true);
    if (!read) void load();
  };

  const button = (
    <button
      type="button"
      onClick={simulate}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${modern ? "btn-secondary text-xs" : "btn-secondary text-sm"}`}
      title="Walk the set-up and sign-in steps at both widths"
    >
      <MonitorSmartphone size={13} aria-hidden />
      Simulate a setup
    </button>
  );

  return (
    <>
      {modern ? (
        <section className="card">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/15 text-cyber-400">
              <MonitorSmartphone size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">Simulate a setup</p>
              <p className="text-[11.5px] leading-relaxed text-gray-400">
                Follow along while somebody sets a second factor up or signs in with one: what this
                instance does right now, the state they are in, and what to say at each step. Read-only.
              </p>
            </div>
            {button}
          </div>
        </section>
      ) : (
        <div className="card">
          <div className="mb-1 flex items-center gap-2">
            <MonitorSmartphone size={16} className="text-cyber-400" />
            <h3 className="text-sm font-semibold text-white">MFA setup simulator</h3>
            <Pill>nothing is written</Pill>
          </div>
          <p className="text-xs leading-relaxed text-gray-400">
            Follow along while somebody sets a second factor up, signs in with one, or cannot: what this
            instance does right now, the state they are in, and what to say at each step — with the
            desktop and phone screens side by side. It never enrols anything, mints no secret and changes
            nobody's account; the one call it makes reads the policy.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {button}
            <span className="text-[11px] text-gray-500">
              Opens in a separate window, sized for both widths. If the window is blocked, the same
              rehearsal opens here.
            </span>
          </div>
        </div>
      )}

      {fallback ? (
        modern ? (
          <SimulatorSheet props={props} onClose={() => setFallback(false)} />
        ) : (
          <SimulatorDialog props={props} onClose={() => setFallback(false)} />
        )
      ) : null}
    </>
  );
}
