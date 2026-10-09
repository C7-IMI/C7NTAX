import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import { useRedesign } from "../hooks/useNavigationStyle";
import { RefreshCw, Clock, AlertTriangle, Users, TrendingUp, Inbox, Pause, MessageSquare, Calendar, GripVertical, Pin, PinOff, ArrowUp, ArrowDown, Save, RotateCcw, SlidersHorizontal, Mail, MailX, Shield, ArrowRight, type LucideIcon } from "lucide-react";
import { PageHeader, StatCard } from "../components/ui";
import { hoursInWords, minutesInWords } from "../components/boards/boardPolicy";

interface BoardMetrics {
  boardId: string; boardName: string; boardDescription: string | null;
  tiles: { id: string; pinned: boolean }[];
  layoutPersonalised: boolean;
  metrics: {
    open: number; workable: number; new: number; onHold: number;
    waitingOnResponse: number; stale3Days: number; stale7Days: number; stale30Days: number;
    escalations: number; averageAgeDays: number;
    mostActiveClient: { id: string; name: string; count: number } | null;
  };
}

/**
 * A board's policy record, as `GET /api/boards` returns it. The board's own page needs it because the
 * figures a technician is judged by — the promise, the code, what a close does — live on the board
 * record and not on the metrics call, and the two screens that show them must not disagree.
 */
interface BoardPolicy {
  id: string;
  name: string;
  description: string | null;
  ticketCode: string | null;
  isActive: boolean;
  slaResponseMinutes: number;
  slaResolutionMinutes: number;
  autoCloseEnabled: boolean;
  autoCloseDays: number;
  followUpEnabled: boolean;
  followUpIntervalHours: number;
  notifyCustomerOnClose: boolean;
  /** Every ticket ever raised on the board, which is what makes "21 of 23 raised" a count. */
  _count?: { tickets: number; emailConnectors: number };
}

type TileState = { id: string; pinned: boolean };

/** Labels for the editor, where the tiles are shown as names rather than live numbers. */
const BOARD_TILE_LABELS: Record<string, string> = {
  new: "New",
  workable: "Workable",
  on_hold: "On Hold",
  waiting: "Waiting",
  escalated: "Escalated",
  avg_age: "Avg Age",
};

/**
 * The redesigned tiles' words. The classic arrangement keeps `BOARD_TILE_LABELS` above: the two
 * interfaces are two designs of the same screen, so their labels may differ where the new one reads
 * better ("On hold", "Average age") without the old one moving.
 */
const MODERN_TILE_LABELS: Record<string, string> = {
  new: "New",
  workable: "Workable",
  on_hold: "On hold",
  waiting: "Waiting",
  escalated: "Escalated",
  avg_age: "Average age",
};


export function BoardsPage() {
  const { permissions } = useAuth();
  const canArrange = permissions.includes("board:manage");
  const redesign = useRedesign();
  const [boards, setBoards] = useState<BoardMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [draft, setDraft] = useState<TileState[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // The boards' policies, keyed by board id. Read once rather than on the 15-second poll: a policy is
  // edited on the Service Boards settings screen, not while somebody is watching this page.
  const [policies, setPolicies] = useState<Record<string, BoardPolicy>>({});
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const { data } = await api.get("/boards/metrics");
      setBoards(data);
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  useEffect(() => {
    api.get("/boards")
      .then(({ data }) => {
        const list: BoardPolicy[] = Array.isArray(data) ? data : (data?.data ?? []);
        setPolicies(Object.fromEntries(list.map(b => [b.id, b])));
      })
      // A board whose policy could not be read still has its own page: the metrics say how much is on
      // it, and the policy cards that would need the record are left out rather than guessed at.
      .catch(() => { /* the page falls back to the figures the metrics already carry */ });
  }, []);

  // Real-time polling every 15 seconds
  useEffect(() => {
    const interval = setInterval(fetchMetrics, 15000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // The stat band and the count line are sums of the figures the cards already show, so nothing on
  // this page needs a second read of /boards/metrics.
  const totalOpen = boards.reduce((n, b) => n + b.metrics.open, 0);
  const totalStale = boards.reduce((n, b) => n + b.metrics.stale3Days, 0);
  const totalEscalations = boards.reduce((n, b) => n + b.metrics.escalations, 0);
  // Summed over the boards the rail shows, so "98 open across 4 boards · 104 raised in all" is one
  // sentence about one list rather than two lists that happen to look alike.
  const totalRaised = boards.reduce((n, b) => n + (policies[b.boardId]?._count?.tickets ?? 0), 0);
  // The boards that close silently. The sentence that uses this counts them rather than assuming one,
  // because "off on exactly one board" stops being true the moment somebody creates another.
  const silentBoards = boards.filter(b => policies[b.boardId]?.notifyCustomerOnClose === false).length;

  const selected = boards.find(b => b.boardId === selectedBoardId) ?? boards[0] ?? null;
  const selectedPolicy = selected ? policies[selected.boardId] : undefined;
  const selectedRaised = selectedPolicy?._count?.tickets;
  const resolutionWords = selectedPolicy ? minutesInWords(selectedPolicy.slaResolutionMinutes) : null;
  const pinnedTiles = (selected?.tiles ?? []).filter(t => t.pinned).length;

  /**
   * The promise as the four things that happen to a ticket, in order. Minutes are read out in hours and
   * a switched-off step says so rather than showing a zero: a board with follow-ups off has no follow-up
   * interval, and printing the column's default anyway would describe a board that does not exist.
   */
  const promiseSteps = (policy: BoardPolicy) => {
    const silent = policy.notifyCustomerOnClose === false;
    const response = minutesInWords(policy.slaResponseMinutes);
    const resolution = minutesInWords(policy.slaResolutionMinutes);
    const followUp = hoursInWords(policy.followUpIntervalHours);
    const steps: { label: string; value: string; say: string }[] = [
      {
        label: "First response",
        value: response ?? "Not set",
        say: "The clock starts when the ticket is raised. This is how long the board says it will be before somebody picks it up.",
      },
      {
        label: "Resolved",
        value: resolution ?? "Not set",
        say: "A resolution does not close the ticket: it waits for the client's word, and until that word arrives the ticket is still open on this page.",
      },
      {
        label: "Follow-up mail",
        value: policy.followUpEnabled ? (followUp ? `every ${followUp}` : "On") : "Not sent",
        say: policy.followUpEnabled
          ? "While a ticket waits, a reminder goes out rather than piling up unremarked."
          : "Follow-ups are switched off on this board: a ticket that waits does so quietly.",
      },
      {
        label: "Closed by itself",
        value: policy.autoCloseEnabled ? `${policy.autoCloseDays} day${policy.autoCloseDays === 1 ? "" : "s"}` : "Never",
        say: policy.autoCloseEnabled
          ? `${policy.autoCloseDays} days without a reply and it closes — ${silent
            ? "and on this board it closes without emailing anybody, which is the decision above"
            : "and the client is emailed as it closes"}.`
          : "Auto-close is switched off on this board: nothing ends a ticket by itself, so it waits until somebody ends it.",
      },
    ];
    return steps;
  };

  const startArranging = (board: BoardMetrics) => {
    setEditingBoard(board.boardId);
    setDraft((board.tiles || []).map(t => ({ ...t })));
  };

  const moveTile = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    setDraft(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  const saveArrangement = async (boardId: string) => {
    setSaving(true);
    try {
      await api.put(`/boards/${boardId}/layout`, { tiles: draft });
      toast.success("Arrangement saved");
      setEditingBoard(null);
      await fetchMetrics();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || "Could not save the arrangement");
    } finally { setSaving(false); }
  };

  const resetArrangement = async (boardId: string) => {
    try {
      const r = await api.delete(`/boards/${boardId}/layout`);
      setDraft((r.data.tiles || []).map((t: TileState) => ({ ...t })));
      toast.success("Arrangement reset");
      setEditingBoard(null);
      await fetchMetrics();
    } catch { toast.error("Could not reset the arrangement"); }
  };

  /** A pinned tile leads the card, so the arrangement only has to be re-sorted after a pin. */
  const togglePin = (id: string) => {
    setDraft(prev => {
      const next = prev.map(t => (t.id === id ? { ...t, pinned: !t.pinned } : t));
      return [...next.filter(t => t.pinned), ...next.filter(t => !t.pinned)];
    });
  };

  const renderTile = (tile: TileState, board: BoardMetrics) => {
    const m = board.metrics;
    const boardUrl = `/tickets?boardId=${board.boardId}`;
    const avgAge = m.averageAgeDays;
    const tone = avgAge <= 7
      ? { color: "text-emerald-400", bg: "bg-emerald-600/15", note: "under a week" }
      : avgAge <= 14
        ? { color: "text-amber-300", bg: "bg-amber-500/15", note: "one to two weeks" }
        : { color: "text-red-300", bg: "bg-red-600/15", note: "over two weeks" };
    /*
     * Two different statements, two different signals.
     *
     * The **border** says what the tile means: an urgent queue is outlined in orange (Workable and
     * Escalated, which is what this page looked like before the arrangement feature existed). The
     * **ring** says the tile is *yours*: you pinned it so it leads the card.
     *
     * They used to be the same thing — the arrangement work changed Workable's border to
     * `pinned ? orange : transparent`, which silently removed the outline from every board that had not
     * pinned it, which is every board, because a pin has to be saved before it exists. The ring was
     * written for the pin at the time and then never used, so this wires it up and hands the border back
     * to the meaning it had.
     */
    const pinRing = tile.pinned ? "ring-1 ring-orange-500/40" : "";
    switch (tile.id) {
      case "new": return <StatusBadge key={tile.id} to={`${boardUrl}&status=new`} icon={Inbox} label="New" value={m.new} color="text-blue-400" bg="bg-blue-600/15" hover="hover:border-orange-500" ring={pinRing} />;
      case "workable": return <StatusBadge key={tile.id} to={`${boardUrl}&status=in_progress`} icon={Clock} label="Workable" value={m.workable} color="text-cyber-400" border="border-orange-600" hover="hover:border-orange-500" ring={pinRing} />;
      case "on_hold": return <StatusBadge key={tile.id} to={`${boardUrl}&status=on_hold`} icon={Pause} label="On Hold" value={m.onHold} color="text-purple-400" bg="bg-purple-600/15" ring={pinRing} />;
      case "waiting": return <StatusBadge key={tile.id} to={`${boardUrl}&status=waiting_on_client,waiting_on_third_party`} icon={MessageSquare} label="Waiting" value={m.waitingOnResponse} color="text-amber-400" bg="bg-amber-600/15" ring={pinRing} />;
      case "escalated": return <StatusBadge key={tile.id} to={`${boardUrl}&status=open&priority=critical`} icon={AlertTriangle} label="Escalated" value={m.escalations} color="text-red-400" bg="bg-red-600/15" border="border-orange-600" hover="hover:border-orange-500" ring={pinRing} />;
      case "avg_age": return <MetricBadge key={tile.id} icon={TrendingUp} label="Avg Age" value={`${m.averageAgeDays}d`} color={tone.color} bg={tone.bg} ring={pinRing} title={`Average age of open tickets on this board: ${m.averageAgeDays} day${m.averageAgeDays === 1 ? "" : "s"} (${tone.note})`} />;
      default: return null;
    }
  };

  /**
   * The redesigned tile. Same six figures as the classic badge and the same place to go when you press
   * one, drawn with the redesign's StatCard: the figure leads, the glyph labels it from the corner, and
   * the tile's subject is said underneath only where a reader would ask it ("on the client or a third
   * party"). The pin still shows — an outlined ring, as in the classic arrangement — because the
   * arrangement is shared with the desk that owns the board.
   */
  const renderModernTile = (tile: TileState, board: BoardMetrics) => {
    const m = board.metrics;
    const base = `/tickets?boardId=${board.boardId}`;
    const label = MODERN_TILE_LABELS[tile.id] ?? tile.id;
    let value: number | string = 0;
    let icon: React.ReactNode;
    let tone: "cyber" | "red" | "amber" | "green" | "neutral" = "cyber";
    let foot: React.ReactNode;
    let to: string | null = null;
    let title = "";

    switch (tile.id) {
      case "new": value = m.new; icon = <Inbox size={12} />; foot = "nobody has picked up"; to = `${base}&status=new`; break;
      case "workable": value = m.workable; icon = <Clock size={12} />; to = `${base}&status=in_progress`; break;
      case "on_hold": value = m.onHold; icon = <Pause size={12} />; tone = "neutral"; to = `${base}&status=on_hold`; break;
      case "waiting": value = m.waitingOnResponse; icon = <MessageSquare size={12} />; tone = "amber"; foot = "on the client or a third party"; to = `${base}&status=waiting_on_client,waiting_on_third_party`; break;
      case "escalated": value = m.escalations; icon = <AlertTriangle size={12} />; tone = "red"; foot = "critical priority"; to = `${base}&status=open&priority=critical`; break;
      case "avg_age": {
        const days = m.averageAgeDays;
        const band = days <= 7 ? "under a week" : days <= 14 ? "one to two weeks" : "over two weeks";
        value = `${days}d`; icon = <TrendingUp size={12} />;
        tone = days <= 7 ? "green" : days <= 14 ? "amber" : "red";
        foot = band;
        title = `Average age of open tickets on this board: ${days} day${days === 1 ? "" : "s"} (${band})`;
        break;
      }
      default: return null;
    }

    const card = <StatCard label={label} value={value} icon={icon} tone={tone} foot={foot} />;
    return (
      <div key={tile.id} className={tile.pinned ? "rounded-xl ring-1 ring-orange-500/40" : ""}>
        {to
          ? <Link to={to} title={title || `View ${label} tickets on this board`} className="block">{card}</Link>
          : card}
      </div>
    );
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-500">Loading boards...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <PageHeader variant="section" title="Service Boards" subtitle={<>{boards.length} board{boards.length !== 1 ? "s" : ""}
            {lastUpdated && <span className="text-gray-600 ml-2">· updated {lastUpdated.toLocaleTimeString()}</span>}</>} />
        <div className="flex items-center gap-2">
          {redesign && (
            <span className="text-xs text-gray-500 tabular-nums">
              {totalOpen} open · {totalStale} stale · {totalEscalations} escalated
            </span>
          )}
          <button onClick={fetchMetrics} className="btn-secondary text-sm flex items-center gap-1.5" title="Refresh metrics">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/*
        Two designs of one screen, not one screen with a class on it (see INTERFACE-ROLLBACK.md).
        The redesign's arrangement is a rail of the four boards beside the selected board's own page,
        because the board page is where a board's promise belongs; the classic arrangement stays the
        grid of cards below, exactly as it renders today.
      */}
      {redesign ? (
        <div className="grid grid-cols-1 lg:grid-cols-[252px_minmax(0,1fr)] gap-3.5 items-start">

          {/* ── The rail: the four boards, as things you press ─────────────────────────────── */}
          <aside className="card p-3 lg:sticky lg:top-4" aria-label="Service boards">
            <p className="text-[10.5px] font-semibold uppercase tracking-[.07em] text-gray-600 mb-1.5 mx-0.5">
              Boards · {boards.length}
            </p>
            {/*
              Each card is a column with a single 4px gap rather than a stack of blocks. As blocks, the
              card's rhythm came from line boxes, so the one card whose sentence wrapped — NOC Alerts,
              the board whose answer is the interesting one — sat at different distances from its
              neighbours and read as though it belonged to no list.
            */}
            <div className="space-y-1">
              {boards.map((b) => {
                const p = policies[b.boardId];
                const active = selected?.boardId === b.boardId;
                const raised = p?._count?.tickets;
                const meta = [
                  p?.ticketCode || null,
                  raised == null ? `${b.metrics.open} open` : `${b.metrics.open} of ${raised} raised`,
                ].filter(Boolean).join(" · ");
                return (
                  <button
                    key={b.boardId}
                    type="button"
                    onClick={() => setSelectedBoardId(b.boardId)}
                    aria-pressed={active}
                    title={`Show ${b.boardName}`}
                    className={`flex w-full flex-col gap-1 rounded-[10px] border px-[9px] py-[7px] text-left transition-colors ${
                      active
                        ? "border-cyber-500/40 bg-cyber-600/[.14] text-gray-200"
                        : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2.5">
                      {/* `min-w-0` so a long name cannot shove the count off the row. */}
                      <span className="min-w-0 text-[13px] font-medium">{b.boardName}</span>
                      {/* The count is two words and must never be split across the line it labels. */}
                      <span className={`shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums ${active ? "text-cyber-300" : "text-gray-500"}`}>
                        {b.metrics.open} open
                      </span>
                    </span>
                    {/* `text-pretty` keeps a wrapped sentence from leaving one word on its own line. */}
                    <span className="text-[10.5px] leading-[1.45] text-gray-600 text-pretty">{meta}</span>
                    {/*
                      What the board does when a ticket closes is a *policy*, not another count, so it
                      gets its own line in every card and a dot that says which way it goes: appended to
                      the counts it wrapped on the one board whose answer matters most. The line has no
                      leading of its own — it takes the base 1.6, as the mockup's does.
                    */}
                    {p && (
                      <span className={`flex items-center gap-[5px] text-[10.5px] ${active ? "text-gray-400" : "text-gray-600"}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.notifyCustomerOnClose === false ? "bg-gray-600" : "bg-alert-green"}`} />
                        {p.notifyCustomerOnClose === false ? "closes without emailing the client" : "emails the client on close"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/*
              The sums are the boards' own figures added up, which is the point the rail makes when it
              prints them: every ticket belongs to exactly one board, so "98 open" is a count and not an
              estimate. `raised` comes from the board record's ticket total, so that clause is dropped
              while the record is unread rather than printed as a guess.
            */}
            <p className="mt-3 border-t border-surface-border pt-2.5 text-[11px] leading-relaxed text-gray-600">
              {totalOpen} open across {boards.length} board{boards.length === 1 ? "" : "s"}
              {totalRaised > 0 ? ` · ${totalRaised} raised in all` : ""}. Every ticket belongs to a board,
              so the sum is a count rather than an estimate — which is what makes it safe to print.
            </p>
          </aside>

          {selected ? (
            <div className="space-y-3">

              {/* ── The board's own page ───────────────────────────────────────────────────── */}
              <div className="card flex flex-wrap items-center gap-3">
                <Shield size={18} className="text-cyber-400 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-white">{selected.boardName}</p>
                  {selected.boardDescription && (
                    <p className="truncate text-[11.5px] text-gray-500">{selected.boardDescription}</p>
                  )}
                </div>
                {selectedPolicy?.ticketCode && (
                  <span className="chip font-mono text-[11px] text-cyber-300">{selectedPolicy.ticketCode}</span>
                )}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <span className="whitespace-nowrap text-[11px] text-gray-600">
                    refreshed every 15 s{lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString()}` : ""}
                  </span>
                  {canArrange && (
                    <Link
                      to={`/admin/boards?board=${selected.boardId}`}
                      className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                      title="Open this board's policy on Service Boards settings"
                    >
                      <SlidersHorizontal size={13} /> Edit this board
                    </Link>
                  )}
                </div>
              </div>

              {/* ── What is on it ──────────────────────────────────────────────────────────── */}
              <div className="card">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h3 className="text-[13.5px] font-semibold text-white">What is on it</h3>
                  <span className="text-[17px] font-semibold text-white tabular-nums">{selected.metrics.open} open</span>
                  {selectedRaised != null && (
                    <span className="text-[11px] text-gray-600">of the {selectedRaised} raised here</span>
                  )}
                  <span
                    className={`chip text-[11px] ${selected.metrics.stale3Days > 0 ? "chip--warn" : ""}`}
                    title="Open tickets nobody has touched for more than three days"
                  >
                    {selected.metrics.stale3Days} stale · over 3 days
                  </span>
                  <span className="chip text-[11px]">
                    {selected.metrics.escalations} escalation{selected.metrics.escalations === 1 ? "" : "s"} · critical, still open
                  </span>
                  {selected.metrics.mostActiveClient && (
                    <span className="chip text-[11px]" title="Most tickets raised by one client in the last 30 days">
                      <Users size={11} className="text-gray-500" />
                      {selected.metrics.mostActiveClient.name} · {selected.metrics.mostActiveClient.count} raised
                    </span>
                  )}
                </div>

                {/* The tiles keep the board's saved order; the sentence says so only when it is true. */}
                <p className="mt-1.5 text-[11px] text-gray-600">
                  {pinnedTiles > 0
                    ? "Pinned tiles lead; the rest are in the order this board saved them."
                    : "In the order this board saved them — nothing pinned to the front yet."}
                </p>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
                  {(selected.tiles || []).map(tile => renderModernTile(tile, selected))}
                </div>

                {/*
                  The practice beside the promise. Both figures come from the same poll, and a page that
                  prints only the promise is a page that has stopped watching — which is why the average
                  age and the untouched count are said here, next to the tiles that carry them.
                */}
                <p className="mt-3 text-[11.5px] leading-relaxed text-gray-500">
                  The tickets open here average{" "}
                  <span className="font-medium text-white tabular-nums">
                    {selected.metrics.averageAgeDays} day{selected.metrics.averageAgeDays === 1 ? "" : "s"}
                  </span>{" "}
                  old{resolutionWords ? ", against a board that promises a resolution in " : ""}
                  {resolutionWords ? <span className="font-medium text-white">{resolutionWords}</span> : null}.
                  {" "}Both figures come from the same call; printing only the promise is how a page flatters a board.{" "}
                  {selected.metrics.stale3Days === 0
                    ? "Nothing has gone more than three days untouched, which is the one number on this screen that says the desk is keeping up."
                    : `${selected.metrics.stale3Days} open ticket${selected.metrics.stale3Days === 1 ? "" : "s"} ${selected.metrics.stale3Days === 1 ? "has" : "have"} gone more than three days untouched.`}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={`/tickets?boardId=${selected.boardId}`}
                    className="btn-primary text-xs py-1.5 flex items-center gap-1.5"
                    title={`View all tickets on ${selected.boardName}`}
                  >
                    Open the {selected.metrics.open} ticket{selected.metrics.open === 1 ? "" : "s"} on this board
                    <ArrowRight size={13} />
                  </Link>
                  {canArrange && editingBoard !== selected.boardId && (
                    <button
                      type="button"
                      onClick={() => startArranging(selected)}
                      className="btn-secondary text-xs py-1.5 flex items-center gap-1.5"
                      title="Arrange the tiles on this board"
                    >
                      <SlidersHorizontal size={13} /> Arrange these tiles
                    </button>
                  )}
                </div>

                {/* The arrangement editor, unchanged in what it does — only its furniture is the redesign's. */}
                {editingBoard === selected.boardId && (
                  <div className="mt-3 space-y-2.5 border-t border-surface-border pt-3">
                    <p className="text-[11px] text-gray-500">
                      Drag a tile by its handle, or use the arrows. A pin moves a tile to the front — the desk that owns this board sees the same arrangement.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {draft.map((tile, index) => (
                        <div
                          key={tile.id}
                          draggable
                          onDragStart={() => setDragIndex(index)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => { if (dragIndex !== null) moveTile(dragIndex, index); setDragIndex(null); }}
                          onDragEnd={() => setDragIndex(null)}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 ${tile.pinned ? "border-orange-600 bg-orange-600/10" : "border-surface-border"} ${dragIndex === index ? "opacity-60" : ""}`}
                        >
                          <GripVertical size={12} className="text-gray-600 cursor-grab shrink-0" />
                          <span className="truncate text-[11px] font-semibold text-gray-300">{MODERN_TILE_LABELS[tile.id] ?? tile.id}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => moveTile(index, index - 1)} disabled={index === 0} className="text-gray-500 hover:text-white disabled:opacity-30" title="Move earlier"><ArrowUp size={11} /></button>
                            <button onClick={() => moveTile(index, index + 1)} disabled={index === draft.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30" title="Move later"><ArrowDown size={11} /></button>
                            <button onClick={() => togglePin(tile.id)} className={tile.pinned ? "text-orange-400" : "text-gray-500 hover:text-white"} title={tile.pinned ? "Unpin" : "Pin to the front"}>
                              {tile.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button onClick={() => resetArrangement(selected.boardId)} className="btn-secondary text-xs flex items-center gap-1"><RotateCcw size={12} /> Reset</button>
                      <button onClick={() => setEditingBoard(null)} className="btn-secondary text-xs">Cancel</button>
                      <button onClick={() => saveArrangement(selected.boardId)} disabled={saving} className="btn-primary text-xs flex items-center gap-1"><Save size={12} /> {saving ? "Saving…" : "Save"}</button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── How it closes, and how a board is made ─────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="card">
                  <h3 className="text-[13.5px] font-semibold text-white">How a ticket on this board ends</h3>
                  {selectedPolicy ? (
                    <>
                      <p className="mt-2 text-[13px] text-white">
                        {selectedPolicy.notifyCustomerOnClose === false
                          ? `${selected.boardName} closes a ticket without emailing the client.`
                          : `${selected.boardName} emails the client when a ticket on it closes.`}
                      </p>
                      {/*
                        The setting's own answer, drawn as the switch it is rather than as a caption under a
                        title — a caption is what the settings screen already does. It is a *display* here and
                        not a control: the answer is edited on Service Boards settings, and a control that
                        changes nothing when pressed is worse than none. The words are the close dialog's.
                      */}
                      <div
                        role="group"
                        aria-label="Closing policy, set on Service Boards settings"
                        className="mt-2.5 inline-flex gap-[3px] rounded-xl bg-surface-lighter p-[3px]"
                      >
                        <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${selectedPolicy.notifyCustomerOnClose === false ? "bg-cyber-600 font-semibold text-white" : "text-gray-400"}`}>
                          <MailX size={13} /> Close silently
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${selectedPolicy.notifyCustomerOnClose === false ? "text-gray-400" : "bg-cyber-600 font-semibold text-white"}`}>
                          <Mail size={13} /> Email the client
                        </span>
                      </div>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                        {selectedPolicy.notifyCustomerOnClose === false
                          ? "Nothing is sent. The note is still recorded on the ticket."
                          : "A closing email with your note. Replying to it reopens the ticket."}
                      </p>
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
                        This is the answer the close dialog starts from, so nobody has to remember it at the
                        moment they close something.
                        {selectedPolicy.notifyCustomerOnClose === false
                          ? " It is left off for a board whose tickets arrive from monitoring systems: their addresses are no-reply, so the closure email reaches nobody. Closing a single ticket can still send one."
                          : ""}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-gray-500">
                      The board record could not be read, so nothing about how it closes is shown here.
                    </p>
                  )}
                </div>

                <div className="card">
                  <h3 className="text-[13.5px] font-semibold text-white">Making a board</h3>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
                    Two fields and one decision: what it is called, what it is for, and whether closing one of
                    its tickets emails the client. Everything else — SLA response and resolution, the code its
                    numbers carry, auto-close days, the follow-up interval — is a later decision, made by
                    editing the board rather than from the form that creates it.
                  </p>
                  <div className="mt-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-white">Email the client when a ticket on this board is closed</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
                        Turn this off for a board whose tickets arrive from monitoring systems: their addresses are
                        no-reply, so the closure email reaches nobody. Closing a single ticket can still send one.
                      </p>
                    </div>
                    {/* The create form's own default, shown rather than described: boards are made with it on. */}
                    <span
                      role="img"
                      aria-label="On by default"
                      title="A new board is created with this on"
                      className="mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-cyber-600 px-[3px]"
                    >
                      <span className="h-3.5 w-3.5 translate-x-4 rounded-full bg-white" />
                    </span>
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-gray-600">
                    On by default, and off on{" "}
                    {silentBoards === 0 ? "no board" : `${silentBoards} board${silentBoards === 1 ? "" : "s"}`} here.
                    The dialog that creates a board already asks this question; the gap is the other direction —
                    the board's own page says the answer, so the two never disagree.
                  </p>
                </div>
              </div>

              {/* ── The promise, on a track a person can read ──────────────────────────────── */}
              <div className="card">
                <h3 className="text-[13.5px] font-semibold text-white">What this board promises, in the order it happens</h3>
                {selectedPolicy ? (
                  <>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                      {promiseSteps(selectedPolicy).map((step) => (
                        <div key={step.label} className="rounded-xl border border-surface-border bg-surface-light p-3">
                          <span className="block h-2 w-2 rounded-full bg-cyber-500" />
                          <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-gray-600">{step.label}</p>
                          <p className="mt-0.5 text-base font-semibold text-white tabular-nums">{step.value}</p>
                          <p className="mt-1 text-[11px] leading-snug text-gray-500">{step.say}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="chip text-[11px]">
                        Auto-close {selectedPolicy.autoCloseEnabled ? `after ${selectedPolicy.autoCloseDays} days` : "off"}
                        {" · "}
                        follow-up {selectedPolicy.followUpEnabled
                          ? hoursInWords(selectedPolicy.followUpIntervalHours)
                            ? `every ${hoursInWords(selectedPolicy.followUpIntervalHours)}`
                            : "on"
                          : "off"}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-[11.5px] text-gray-500">
                    The board record could not be read, so its SLA and automation are not shown here.
                  </p>
                )}
              </div>

              {/* ── The whole policy, set against the other three boards ───────────────────── */}
              <div className="card">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h3 className="text-[13.5px] font-semibold text-white">What each board does</h3>
                  <span className="text-[11px] text-gray-600">one table, {boards.length} board{boards.length === 1 ? "" : "s"}, nothing averaged</span>
                </div>
                <div className="mt-2.5 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-[10.5px] uppercase tracking-[.06em] text-gray-600">
                        <th className="w-[28%] py-2 pr-2.5 font-semibold">Board</th>
                        <th className="w-[11%] py-2 pr-2.5 font-semibold">Respond in</th>
                        <th className="w-[11%] py-2 pr-2.5 font-semibold">Resolve in</th>
                        <th className="w-[13%] py-2 pr-2.5 font-semibold">Auto-close</th>
                        <th className="w-[15%] py-2 pr-2.5 font-semibold">Follow-up mail</th>
                        <th className="w-[22%] py-2 pr-2.5 font-semibold">Closing email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boards.map((b) => {
                        const p = policies[b.boardId];
                        const raised = p?._count?.tickets;
                        const on = b.boardId === selected.boardId;
                        return (
                          <tr
                            key={b.boardId}
                            onClick={() => setSelectedBoardId(b.boardId)}
                            title={`Show ${b.boardName}`}
                            className={`cursor-pointer border-t border-surface-border align-top ${on ? "bg-cyber-600/[.09]" : "hover:bg-surface-lighter"}`}
                          >
                            <td className="py-2 pr-2.5 align-top">
                              <span className="block truncate font-medium text-white">
                                {b.boardName}
                                {p?.ticketCode && <span className="ml-1.5 font-mono text-[10px] text-cyber-300">{p.ticketCode}</span>}
                              </span>
                              <span className="block text-[11px] text-gray-500">
                                {[
                                  b.boardDescription,
                                  raised == null ? `${b.metrics.open} open` : `${b.metrics.open} open of ${raised} raised`,
                                  `avg age ${b.metrics.averageAgeDays} days`,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            </td>
                            <td className="py-2 pr-2.5 align-top tabular-nums">{p ? minutesInWords(p.slaResponseMinutes) ?? "—" : "—"}</td>
                            <td className="py-2 pr-2.5 align-top tabular-nums">{p ? minutesInWords(p.slaResolutionMinutes) ?? "—" : "—"}</td>
                            <td className="py-2 pr-2.5 align-top">
                              {!p ? "—" : p.autoCloseEnabled
                                ? <>After <span className="tabular-nums">{p.autoCloseDays}</span> days</>
                                : "Never"}
                            </td>
                            <td className="py-2 pr-2.5 align-top">
                              {!p ? "—" : p.followUpEnabled
                                ? <>Every <span className="tabular-nums">{p.followUpIntervalHours}</span> hour{p.followUpIntervalHours === 1 ? "" : "s"}</>
                                : "Not sent"}
                            </td>
                            <td className="py-2 pr-2.5 align-top">
                              {!p ? "—" : p.notifyCustomerOnClose === false
                                ? <span className="font-medium text-white">Closes without emailing the client</span>
                                : "Emails the client"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── The way into editing it ───────────────────────────────────────────────── */}
              <div className="card flex flex-wrap items-center gap-3">
                <SlidersHorizontal size={18} className="text-gray-500 shrink-0" />
                <div className="min-w-[220px] flex-1">
                  <p className="text-[12.5px] text-white">Everything on this page is set on Administration → Service Boards</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
                    The SLA minutes, the code its ticket numbers carry, auto-close days, the follow-up interval
                    and the closing policy are edited there, one board at a time. This page shows the answers
                    and hands you over; what it does not do is ask you to remember which screen knows them.
                  </p>
                </div>
                {canArrange && (
                  <Link to="/admin/boards" className="btn-secondary text-xs py-1.5 flex items-center gap-1.5 shrink-0">
                    Open Service Boards settings <ArrowRight size={13} />
                  </Link>
                )}
              </div>

            </div>
          ) : (
            <div className="card text-sm text-gray-500">No boards configured</div>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {boards.map((board) => {
          const m = board.metrics;
          const boardUrl = `/tickets?boardId=${board.boardId}`;
          const editing = editingBoard === board.boardId;
          return (
            <div
              key={board.boardId}
              className="card hover:border-cyber-600/30 transition-colors group cursor-pointer space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <Link to={boardUrl} title={`View all tickets on ${board.boardName}`}>
                    <h3 className="text-base font-semibold text-white group-hover:text-cyber-400 transition-colors hover:underline">
                      {board.boardName}
                    </h3>
                  </Link>
                  {board.boardDescription && (
                    <p className="text-xs text-gray-500 mt-0.5">{board.boardDescription}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canArrange && !editing && (
                    <button onClick={() => startArranging(board)} className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" title="Arrange the tiles on this board">
                      <SlidersHorizontal size={11} /> Arrange
                    </button>
                  )}
                  <span className="text-[10px] text-gray-600 font-mono">{m.open} open</span>
                  {redesign && (
                    <span
                      className={`chip text-[10px] ${m.stale3Days > 0 ? "chip--warn" : ""}`}
                      title={`${m.stale3Days} open ticket${m.stale3Days === 1 ? "" : "s"} nobody has touched for more than three days`}
                    >
                      {m.stale3Days} stale
                    </span>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500">
                    Drag a tile by its handle, or use the arrows. A pin moves a tile to the front — the desk that owns this board sees the same arrangement.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {draft.map((tile, index) => (
                      <div
                        key={tile.id}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => { if (dragIndex !== null) moveTile(dragIndex, index); setDragIndex(null); }}
                        onDragEnd={() => setDragIndex(null)}
                        className={`rounded-lg border px-2.5 py-2 flex flex-col gap-1 ${tile.pinned ? "border-orange-600 bg-orange-600/10" : "border-surface-border"} ${dragIndex === index ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-center gap-1">
                          <GripVertical size={11} className="text-gray-600 cursor-grab shrink-0" />
                          <span className="text-[10px] font-semibold text-gray-300 truncate">{BOARD_TILE_LABELS[tile.id] ?? tile.id}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => moveTile(index, index - 1)} disabled={index === 0} className="text-gray-500 hover:text-white disabled:opacity-30" title="Move earlier"><ArrowUp size={11} /></button>
                          <button onClick={() => moveTile(index, index + 1)} disabled={index === draft.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30" title="Move later"><ArrowDown size={11} /></button>
                          <button onClick={() => togglePin(tile.id)} className={`ml-auto ${tile.pinned ? "text-orange-400" : "text-gray-500 hover:text-white"}`} title={tile.pinned ? "Unpin" : "Pin to the front"}>
                            {tile.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => resetArrangement(board.boardId)} className="btn-secondary text-xs flex items-center gap-1"><RotateCcw size={12} /> Reset</button>
                    <button onClick={() => setEditingBoard(null)} className="btn-secondary text-xs">Cancel</button>
                    <button onClick={() => saveArrangement(board.boardId)} disabled={saving} className="btn-primary text-xs flex items-center gap-1"><Save size={12} /> {saving ? "Saving…" : "Save"}</button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(board.tiles || []).map(tile => renderTile(tile, board))}
                </div>
              )}

              {/* Stale ticket warnings */}
              {(m.stale3Days > 0 || m.stale7Days > 0 || m.stale30Days > 0) && (
                <div className="border-t border-surface-border pt-3 space-y-1.5">
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold mb-1">Stale Tickets</p>
                  <div className="flex items-center gap-3 text-xs">
                    {m.stale3Days > 0 && <span className="text-amber-400">{m.stale3Days}<span className="text-gray-600 ml-0.5">&gt;3d</span></span>}
                    {m.stale7Days > 0 && <span className="text-orange-400">{m.stale7Days}<span className="text-gray-600 ml-0.5">&gt;7d</span></span>}
                    {m.stale30Days > 0 && <span className="text-red-400">{m.stale30Days}<span className="text-gray-600 ml-0.5">&gt;30d</span></span>}
                  </div>
                </div>
              )}

              {/* Most active client */}
              {m.mostActiveClient && (
                <div className="border-t border-surface-border pt-3 flex items-center gap-2 text-xs">
                  <Users size={12} className="text-gray-500" />
                  <span className="text-gray-500">Most active:</span>
                  <span className="text-white font-medium">{m.mostActiveClient.name}</span>
                  <span className="text-gray-600">({m.mostActiveClient.count} tickets)</span>
                </div>
              )}

              <div className="text-right">
                <Link to={boardUrl} className="text-xs text-cyber-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  View tickets →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// Clickable status metric — navigates to tickets filtered by status for this board.
// `bg` is optional: a tile can be an outlined card instead of a filled one.
// `ring` is the pinned marker, kept separate from `border` — see the note in renderTile.
function StatusBadge({ to, icon: Icon, label, value, color, bg = "", border = "border-transparent", hover = "hover:border-cyber-600/50", ring = "" }: { to: string; icon: LucideIcon; label: string; value: number | string; color: string; bg?: string; border?: string; hover?: string; ring?: string }) {
  return (
    <Link
      to={to}
      title={`View ${label} tickets on this board`}
      className={`${bg} rounded-lg px-2.5 py-2 flex flex-col gap-0.5 cursor-pointer transition-all border ${border} ${ring} ${hover} hover:ring-1 hover:ring-cyber-500/30 group/badge`}
    >
      <div className="flex items-center gap-1">
        <Icon size={11} className={color} />
        <span className={`text-[10px] font-semibold ${color} group-hover/badge:underline underline-offset-2`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </Link>
  );
}

function MetricBadge({ icon: Icon, label, value, color, bg, title, ring = "" }: { icon: LucideIcon; label: string; value: number | string; color: string; bg: string; title?: string; ring?: string }) {
  return (
    <div title={title} className={`${bg} rounded-lg px-2.5 py-2 flex flex-col gap-0.5 border border-transparent ${ring}`}>
      <div className="flex items-center gap-1">
        <Icon size={11} className={color} />
        <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
