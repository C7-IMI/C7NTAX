import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../hooks/useAuth";
import { RefreshCw, Clock, AlertTriangle, Users, TrendingUp, Inbox, Pause, MessageSquare, Calendar, GripVertical, Pin, PinOff, ArrowUp, ArrowDown, Save, RotateCcw, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { PageHeader } from "../components/ui";

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

export function BoardsPage() {
  const { permissions } = useAuth();
  const canArrange = permissions.includes("board:manage");
  const [boards, setBoards] = useState<BoardMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [draft, setDraft] = useState<TileState[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const { data } = await api.get("/boards/metrics");
      setBoards(data);
      setLastUpdated(new Date());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  // Real-time polling every 15 seconds
  useEffect(() => {
    const interval = setInterval(fetchMetrics, 15000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

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
    const pinned = tile.pinned ? "ring-1 ring-orange-500/40" : "";
    switch (tile.id) {
      case "new": return <StatusBadge key={tile.id} to={`${boardUrl}&status=new`} icon={Inbox} label="New" value={m.new} color="text-blue-400" bg="bg-blue-600/15" border={pinned ? "border-orange-600" : "border-transparent"} hover="hover:border-orange-500" />;
      case "workable": return <StatusBadge key={tile.id} to={`${boardUrl}&status=in_progress`} icon={Clock} label="Workable" value={m.workable} color="text-cyber-400" border={pinned ? "border-orange-600" : "border-transparent"} hover="hover:border-orange-500" />;
      case "on_hold": return <StatusBadge key={tile.id} to={`${boardUrl}&status=on_hold`} icon={Pause} label="On Hold" value={m.onHold} color="text-purple-400" bg="bg-purple-600/15" border={pinned ? "border-orange-600" : "border-transparent"} />;
      case "waiting": return <StatusBadge key={tile.id} to={`${boardUrl}&status=waiting_on_client,waiting_on_third_party`} icon={MessageSquare} label="Waiting" value={m.waitingOnResponse} color="text-amber-400" bg="bg-amber-600/15" border={pinned ? "border-orange-600" : "border-transparent"} />;
      case "escalated": return <StatusBadge key={tile.id} to={`${boardUrl}&status=open&priority=critical`} icon={AlertTriangle} label="Escalated" value={m.escalations} color="text-red-400" bg="bg-red-600/15" border="border-orange-600" hover="hover:border-orange-500" />;
      case "avg_age": return <MetricBadge key={tile.id} icon={TrendingUp} label="Avg Age" value={`${m.averageAgeDays}d`} color={tone.color} bg={tone.bg} title={`Average age of open tickets on this board: ${m.averageAgeDays} day${m.averageAgeDays === 1 ? "" : "s"} (${tone.note})`} />;
      default: return null;
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-500">Loading boards...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <PageHeader variant="section" title="Service Boards" subtitle={<>{boards.length} board{boards.length !== 1 ? "s" : ""}
            {lastUpdated && <span className="text-gray-600 ml-2">· updated {lastUpdated.toLocaleTimeString()}</span>}</>} />
        <div className="flex items-center gap-2">
          <button onClick={fetchMetrics} className="btn-secondary text-sm flex items-center gap-1.5" title="Refresh metrics">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

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
    </div>
  );
}

// Clickable status metric — navigates to tickets filtered by that status for this board.
// `bg` is optional: a tile can be an outlined card instead of a filled one.
function StatusBadge({ to, icon: Icon, label, value, color, bg = "", border = "border-transparent", hover = "hover:border-cyber-600/50" }: { to: string; icon: LucideIcon; label: string; value: number | string; color: string; bg?: string; border?: string; hover?: string }) {
  return (
    <Link
      to={to}
      title={`View ${label} tickets on this board`}
      className={`${bg} rounded-lg px-2.5 py-2 flex flex-col gap-0.5 cursor-pointer transition-all border ${border} ${hover} hover:ring-1 hover:ring-cyber-500/30 group/badge`}
    >
      <div className="flex items-center gap-1">
        <Icon size={11} className={color} />
        <span className={`text-[10px] font-semibold ${color} group-hover/badge:underline underline-offset-2`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </Link>
  );
}

function MetricBadge({ icon: Icon, label, value, color, bg, title }: { icon: LucideIcon; label: string; value: number | string; color: string; bg: string; title?: string }) {
  return (
    <div title={title} className={`${bg} rounded-lg px-2.5 py-2 flex flex-col gap-0.5 border border-transparent`}>
      <div className="flex items-center gap-1">
        <Icon size={11} className={color} />
        <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
