import { Tabs } from "./ui";

/**
 * Board selection for the Tickets screen, as a tab strip with a band naming the board on screen.
 *
 * ── Reverting this ─────────────────────────────────────────────────────────────────────────────
 * This is a presentation experiment, so it is built to be thrown away in one step:
 *
 *   1. In `Tickets.tsx`, set `BOARD_TABS = false`. That is the whole revert — the previous board
 *      dropdown is still there in the other branch, the chip in the active-filters row comes back,
 *      and the page behaves exactly as it did before (the URL parameter was never touched, so
 *      bookmarks and links keep working either way).
 *   2. When the decision has been made, delete this file, delete the `const BOARD_TABS` and the
 *      branch it guards, and the dropdown becomes the only implementation again with no dead code
 *      left behind.
 *
 * Nothing else in the product depends on it: no API change, no schema change, and the board list it
 * reads (`GET /boards`) already carried the ticket counts it puts on the tabs.
 */
export interface TicketBoardOption {
  id: string;
  name: string;
  ticketCode?: string | null;
  description?: string | null;
  _count?: { tickets?: number } | null;
}

/** The id of the "everything" tab. A board id is never this, and it is not a URL value either. */
const ALL_BOARDS = "all-boards";

export function TicketBoardTabs({ boards, boardId, onSelect }: {
  boards: TicketBoardOption[];
  /** The board from the URL, or "" for every board. */
  boardId: string;
  /** Hands back the chosen board id, or "" for all boards. */
  onSelect: (boardId: string) => void;
}) {
  const boardTickets = (board: TicketBoardOption) => board._count?.tickets ?? 0;
  // Every ticket belongs to a board (`Ticket.boardId` is required), so the sum is the true total
  // rather than an estimate — which is what makes "All Boards" safe to count.
  const total = boards.reduce((sum, board) => sum + boardTickets(board), 0);
  const current = boards.find(board => board.id === boardId) ?? null;
  const shown = current ? boardTickets(current) : total;

  return (
    <div className="space-y-2">
      {/* Wide enough for every board on a normal workspace, and scrolls rather than squashing when
          it is not: a tab you cannot read is not a tab. */}
      <div className="-mx-1 px-1 overflow-x-auto">
        <Tabs
          items={[
            { id: ALL_BOARDS, label: "All Boards", count: total },
            ...boards.map(board => ({ id: board.id, label: board.name, count: board._count?.tickets })),
          ]}
          value={current ? current.id : ALL_BOARDS}
          onChange={id => onSelect(id === ALL_BOARDS ? "" : id)}
          label="Service Boards"
        />
      </div>

      {/* The notation: with the board chosen by a tab, the page has to say plainly which one is
          showing, because a tab strip becomes a row of buttons the moment nobody reads it. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-surface-border border-l-2 border-l-cyber-500 bg-surface-lighter px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Viewing</span>
        <span className="text-base font-semibold text-white">{current ? current.name : "All boards"}</span>
        {current?.ticketCode && (
          <span className="font-mono text-[11px] text-cyber-400">{current.ticketCode}</span>
        )}
        {current?.description && <span className="text-xs text-gray-400">{current.description}</span>}
        <span className="ml-auto text-xs text-gray-400 tabular-nums">
          {shown} {shown === 1 ? "ticket" : "tickets"}
          {current ? " on this board" : ` across ${boards.length} ${boards.length === 1 ? "board" : "boards"}`}
        </span>
      </div>
    </div>
  );
}
