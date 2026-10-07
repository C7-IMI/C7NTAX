/**
 * One password policy for every place a password is set — the New User dialog,
 * an administrator's reset, and a user changing their own password — so the
 * rules and the message somebody sees can never disagree with what the API
 * enforces.
 */

import { passwordStrengthLevel } from "./passwordStrength";

/** Shortest password accepted anywhere. */
export const MIN_PASSWORD_LENGTH = 12;

/** Passwords that show up first in every credential-stuffing list. */
const COMMON_PASSWORDS = [
  "password", "passw0rd", "letmein", "welcome", "qwerty", "qwerty123",
  "admin", "administrator", "changeme", "iloveyou", "monkey", "dragon",
  "cyber7", "c7ntax", "c7ntax2024", "c7ntax2025", "c7ntax2026",
];

export interface PasswordContext {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** The individual rules, in the order they are shown as a checklist. */
export function passwordPolicyChecks(password: string): { label: string; ok: boolean }[] {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  return [
    { label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: password.length >= MIN_PASSWORD_LENGTH },
    { label: "Three of: lowercase, uppercase, numbers, symbols", ok: classes >= 3 },
    { label: "Not a common password", ok: !COMMON_PASSWORDS.some(c => password.toLowerCase().includes(c)) },
  ];
}

/**
 * Returns the first problem found with the password, or null when it is
 * acceptable. Callers show the returned message verbatim.
 */
export function validatePassword(password: string, context: PasswordContext = {}): string | null {
  if (!password) return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  if (classes < 3) {
    return "Password must include at least three of: lowercase, uppercase, numbers, symbols";
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.some(c => lower.includes(c))) {
    return "Password contains a common word or phrase";
  }

  const personal = [context.email?.split("@")[0], context.firstName, context.lastName]
    .filter((v): v is string => !!v && v.trim().length >= 3)
    .map(v => v.toLowerCase());
  if (personal.some(v => lower.includes(v))) {
    return "Password must not contain the user's name or email address";
  }

  if (/^(.)\1+$/.test(password)) {
    return "Password must not be a single repeated character";
  }

  // Defence in depth: the checks above already imply a floor, but keep the
  // strength label honest — "Very Weak" must never pass.
  if (passwordStrengthLevel(password) === "Very Weak") {
    return "Password is too weak";
  }

  return null;
}
