import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, RefreshCw, Clock, AlertTriangle, Users, TrendingUp, Inbox, Pause, MessageSquare, Calendar } from "lucide-react";

interface BoardMetrics {
  boardId: string; boardName: string; boardDescription: string | null;
  metrics: {
    open: number; workable: number; new: number; onHold: number;
    waitingOnResponse: number; stale3Days: number; stale7Days: number; stale30Days: number;
    escalations: number; averageAgeDays: number;
    mostActiveClient: { id: string; name: string; count: number } | null;
  };
}

export function BoardsPage() {
  const [boards, setBoards] = useState<BoardMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: "", description: "" });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

  const createBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/boards", newBoard);
      setNewBoard({ name: "", description: "" });
      setShowCreate(false);
      fetchMetrics();
      toast.success("Board created");
    } catch { toast.error("Failed to create board"); }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-500">Loading boards...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Boards</h2>
          <p className="text-sm text-gray-400">
            {boards.length} board{boards.length !== 1 ? "s" : ""}
            {lastUpdated && <span className="text-gray-600 ml-2">· updated {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchMetrics} className="btn-secondary text-sm flex items-center gap-1.5" title="Refresh metrics">
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Board
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {boards.map((board) => {
          const m = board.metrics;
          return (
            <Link
              key={board.boardId}
              to={`/tickets?boardId=${board.boardId}`}
              className="card hover:border-cyber-600/30 transition-colors group cursor-pointer space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white group-hover:text-cyber-400 transition-colors">
                    {board.boardName}
                  </h3>
                  {board.boardDescription && (
                    <p className="text-xs text-gray-500 mt-0.5">{board.boardDescription}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-600 font-mono">{m.open} open</span>
              </div>

              {/* Primary metrics row */}
              <div className="grid grid-cols-3 gap-2">
                <MetricBadge icon={Inbox} label="New" value={m.new} color="text-blue-400" bg="bg-blue-600/15" />
                <MetricBadge icon={Clock} label="Workable" value={m.workable} color="text-cyber-400" bg="bg-cyber-600/15" />
                <MetricBadge icon={Pause} label="On Hold" value={m.onHold} color="text-purple-400" bg="bg-purple-600/15" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MetricBadge icon={MessageSquare} label="Waiting" value={m.waitingOnResponse} color="text-amber-400" bg="bg-amber-600/15" />
                <MetricBadge icon={AlertTriangle} label="Escalated" value={m.escalations} color="text-red-400" bg="bg-red-600/15" />
                <MetricBadge icon={TrendingUp} label="Avg Age" value={`${m.averageAgeDays}d`} color="text-gray-400" bg="bg-gray-600/15" />
              </div>

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
                <span className="text-xs text-cyber-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  View tickets →
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Create Board Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-4" onClick={(e) => e.stopPropagation()} onSubmit={createBoard}>
            <h3 className="text-lg font-semibold text-white">Create Service Board</h3>
            <input className="input-field" placeholder="Board name" value={newBoard.name} onChange={(e) => setNewBoard({ ...newBoard, name: e.target.value })} required autoFocus />
            <textarea className="input-field" placeholder="Description (optional)" value={newBoard.description} onChange={(e) => setNewBoard({ ...newBoard, description: e.target.value })} rows={2} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function MetricBadge({ icon: Icon, label, value, color, bg }: { icon: React.ComponentType<{size?:number;className?:string}>; label: string; value: number | string; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-lg px-2.5 py-2 flex flex-col gap-0.5`}>
      <div className="flex items-center gap-1">
        <Icon size={11} className={color} />
        <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
