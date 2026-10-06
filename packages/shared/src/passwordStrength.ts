/**
 * Password strength scoring, shared by the password vault (which scores on
 * reveal) and the organization dashboard (which scores the whole vault).
 * One implementation so the two views can never disagree on a label.
 */

export const PASSWORD_STRENGTH_LEVELS = [
  "Very Weak",
  "Weak",
  "Fair",
  "Good",
  "Strong",
  "Very Strong",
] as const;

export type PasswordStrengthLevel = (typeof PASSWORD_STRENGTH_LEVELS)[number];

/** Raw test count: length tiers plus the four character classes (0–6). */
export function scorePassword(password: string): number {
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

export function passwordStrengthLevel(password: string): PasswordStrengthLevel {
  const index = Math.min(scorePassword(password), PASSWORD_STRENGTH_LEVELS.length - 1);
  return PASSWORD_STRENGTH_LEVELS[index] ?? "Very Weak";
}
