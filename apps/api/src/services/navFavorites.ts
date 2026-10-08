/**
 * The navigation pins a user has saved (Favorites).
 *
 * A pin is a section id the client's own navigation tree uses, so this is input and is cleaned
 * before it is stored: an id that is not shaped like one of ours is dropped, duplicates collapse
 * to the first mention, and the list is capped. It cannot be validated against a catalogue the way
 * the dashboard's widgets are — the tree is drawn by the client — so an id that names a section
 * the tree no longer has is kept and simply not drawn, which is what makes a renamed section's pin
 * survive a rebuild rather than vanish quietly.
 */

/** How many pins one account may keep. Far more than anybody pins, and a bound all the same. */
export const MAX_FAVORITES = 40;

/** Section ids are slugs: `billing`, `admin-boards`, `favorites:administration`. */
const SECTION_ID = /^[a-z0-9][a-z0-9:_-]{0,63}$/i;

export function normaliseFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!SECTION_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}
