/**
 * A board's tile arrangement (PLAN-015 Phase B #5).
 *
 * A board card shows six metric tiles. Which of them matter depends on the desk — an escalation
 * queue wants Escalated first, a MACD desk wants New — and before this the order was whatever the
 * page happened to hardcode. The arrangement is stored per board and validated here, exactly like
 * the dashboard's catalogue: a saved layout is input, so unknown tile ids are dropped, duplicates
 * collapsed, and a tile added later appears rather than going missing.
 */

export interface BoardTile {
  id: string;
  label: string;
  description: string;
}

export const BOARD_TILES: BoardTile[] = [
  { id: "new", label: "New", description: "Unworked tickets on this board" },
  { id: "workable", label: "Workable", description: "Tickets currently in progress" },
  { id: "on_hold", label: "On Hold", description: "Tickets parked deliberately" },
  { id: "waiting", label: "Waiting", description: "Waiting on the client or a third party" },
  { id: "escalated", label: "Escalated", description: "Open critical-priority tickets" },
  { id: "avg_age", label: "Avg Age", description: "Average age of the open tickets" },
];

export interface BoardTileState {
  id: string;
  pinned: boolean;
}

const known = new Set(BOARD_TILES.map(t => t.id));

/**
 * The saved arrangement reconciled against the catalogue, with pinned tiles moved to the front —
 * a pin is a statement about importance, so it has to survive whatever order was dragged, and the
 * stored order remains the order the user chose among the unpinned tiles.
 */
export function normaliseBoardTiles(saved: unknown): BoardTileState[] {
  const seen = new Set<string>();
  const arranged: BoardTileState[] = [];

  for (const raw of Array.isArray(saved) ? saved : []) {
    const entry = raw as Record<string, unknown>;
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    arranged.push({ id, pinned: entry.pinned === true });
  }
  for (const tile of BOARD_TILES) {
    if (!seen.has(tile.id)) arranged.push({ id: tile.id, pinned: false });
  }

  return [...arranged.filter(t => t.pinned), ...arranged.filter(t => !t.pinned)];
}
