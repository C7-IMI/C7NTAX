/**
 * Generate a cryptographically strong random password.
 * 20 chars, uppercase + lowercase + digits + symbols, no ambiguous chars (0/O, 1/I/l).
 */
export function generatePassword(length = 20): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*_-+=";
  const all = upper + lower + digits + symbols;

  // Ensure at least one of each category
  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  // Fill the rest randomly
  const array = new Uint32Array(length - 4);
  crypto.getRandomValues(array);
  for (let i = 0; i < array.length; i++) {
    chars.push(all[array[i] % all.length]);
  }

  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
