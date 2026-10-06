/** Small display helpers shared by the Kumo organization screens. */

/** Two-letter monogram for an organization or person name. */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const second = words[1];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-cyber-600/15 text-cyber-300",
  "bg-amber-600/15 text-amber-300",
  "bg-green-600/15 text-green-300",
  "bg-purple-600/15 text-purple-300",
  "bg-blue-600/15 text-blue-300",
];

/** Stable tint per name, so an avatar keeps its colour between renders. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 9973;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "bg-cyber-600/15 text-cyber-300";
}

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "in 12 days" / "3 days ago" for expiry dates. */
export function daysUntil(dateStr: string): { days: number; label: string; overdue: boolean } {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { days, label: `${Math.abs(days)} days overdue`, overdue: true };
  if (days === 0) return { days, label: "today", overdue: false };
  return { days, label: days === 1 ? "tomorrow" : `in ${days} days`, overdue: false };
}
