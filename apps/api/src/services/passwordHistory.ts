/**
 * Password history — the rule that an account may not go back to a password it has recently used.
 *
 * A minimum length and a complexity floor stop a password being *guessable*; they do nothing about a
 * password being *reused*, and reuse is what actually defeats a policy that wants passwords changed. An
 * account that alternates between two favourites satisfies every complexity rule forever while never
 * really changing anything, so the history is the half of the policy that makes the other half mean
 * something.
 *
 * **Why this is a service rather than part of `validatePassword`.** The shared policy's checks are pure
 * functions of the candidate password, which is what lets the interface draw them as a live checklist as
 * somebody types. Answering "is this one of your last five" needs bcrypt and the account's row, so it
 * cannot live there — but its *depth* does (`PASSWORD_HISTORY_DEPTH`), so the number an administrator
 * reads in the Help and the number this file enforces are the same number.
 *
 * **Hashed.** The list holds hashes for the same reason the current password does: it is a list of
 * credentials that used to work. bcrypt can answer "is this one of them" without the plaintext ever
 * being stored, and no route returns the list.
 */
import bcrypt from "bcryptjs";
import { PASSWORD_HISTORY_DEPTH } from "@C7NTAX/shared";

/**
 * Whether the candidate matches the current password or any password in the history.
 *
 * The current hash is normally passed in as well, because "may not reuse a recent password" and "must be
 * different from the one you have" are the same rule with the same remedy — and one comparison list, one
 * refusal and one sentence is better than two of each.
 *
 * Every hash is tried because they are individually salted, so there is nothing to look up by value. Five
 * comparisons is a rounding error beside the cost of hashing the new password a moment later.
 */
export async function passwordWasUsedRecently(
  history: readonly string[] | null | undefined,
  candidate: string,
  currentHash?: string | null,
): Promise<boolean> {
  const list = [...(history ?? []), ...(currentHash ? [currentHash] : [])];
  for (const hash of list) {
    if (hash && (await bcrypt.compare(candidate, hash))) return true;
  }
  return false;
}

/**
 * The history after a change, with the password being replaced pushed to the front.
 *
 * The **old** hash goes in, not the new one: the new password is the one now held in `passwordHash`, so
 * putting it in both places would spend one of the five slots on a password that is already accounted
 * for, and the account would effectively only remember four.
 *
 * Truncation to the newest `PASSWORD_HISTORY_DEPTH` is here rather than in the database so the rule and
 * the number that describes it are read together.
 */
export function historyAfterChange(
  history: readonly string[] | null | undefined,
  replacedHash: string,
): string[] {
  return [replacedHash, ...(history ?? [])].slice(0, PASSWORD_HISTORY_DEPTH);
}

/**
 * The sentence a refusal uses, kept here so the API and the Help cannot describe the rule differently.
 */
export function passwordReuseMessage(): string {
  return `Password cannot be one you have used before — the last ${PASSWORD_HISTORY_DEPTH} are remembered. Choose one you have not used recently.`;
}
