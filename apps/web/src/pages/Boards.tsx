import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, RefreshCw, Trash2, Power } from "lucide-react";

interface Board { id: string; name: string; description: string; enabled: boolean; _count?: { tickets: number; emailConnectors: number }; }
interface Connector { id: string; email: string; host: string; port: number; secure: boolean; folder: string; pollIntervalSeconds: number; enabled: boolean; lastCheckedAt: string | null; }

export function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [selected, setSelected] = useState<Board | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateConnector, setShowCreateConnector] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: "", description: "" });
  const [newConnector, setNewConnector] = useState({ email: "", host: "", port: 993, secure: true, folder: "INBOX", user: "", password: "", pollIntervalSeconds: 60 });

  const fetchBoards = async () => {
    const { data } = await api.get("/boards");
    setBoards(data);
  };

  useEffect(() => { fetchBoards(); }, []);

  const fetchConnectors = async (boardId: string) => {
    const { data } = await api.get(`/boards/${boardId}/connectors`);
    setConnectors(data);
  };

  const selectBoard = (board: Board) => {
    setSelected(board);
    fetchConnectors(board.id);
  };

  const createBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/boards", newBoard);
      setNewBoard({ name: "", description: "" });
      setShowCreate(false);
      fetchBoards();
      toast.success("Board created");
    } catch { toast.error("Failed to create board"); }
  };

  const createConnector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    try {
      await api.post(`/boards/${selected.id}/connectors`, newConnector);
      setNewConnector({ email: "", host: "", port: 993, secure: true, folder: "INBOX", user: "", password: "", pollIntervalSeconds: 60 });
      setShowCreateConnector(false);
      fetchConnectors(selected.id);
      toast.success("Email connector added");
    } catch { toast.error("Failed to add connector"); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Boards</h2>
          <p className="text-sm text-gray-400">Manage service boards and email connectors</p>
        </div>
        <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New Board
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Board list */}
        <div className="card space-y-1">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Boards</h3>
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => selectBoard(b)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                selected?.id === b.id ? "bg-cyber-600/15 text-cyber-400" : "text-gray-300 hover:bg-surface-lighter"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{b.name}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${b.enabled ? "bg-green-400" : "bg-gray-600"}`} />
              </div>
              <span className="text-xs text-gray-500">{b._count?.tickets ?? 0} tickets</span>
            </button>
          ))}
        </div>

        {/* Board details */}
        <div className="card lg:col-span-2">
          {selected ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{selected.name}</h3>
                <p className="text-sm text-gray-400">{selected.description || "No description"}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-gray-400">Email Connectors</h4>
                  <button className="btn-secondary text-xs flex items-center gap-1 px-3 py-1.5" onClick={() => setShowCreateConnector(true)}>
                    <Plus size={12} /> Add Connector
                  </button>
                </div>
                {connectors.length === 0 ? (
                  <p className="text-sm text-gray-600">No email connectors configured</p>
                ) : (
                  <div className="space-y-2">
                    {connectors.map((c) => (
                      <div key={c.id} className="bg-surface-lighter rounded-lg px-3 py-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-white font-medium">{c.email}</p>
                          <p className="text-xs text-gray-500">{c.host}:{c.port} — {c.folder} — poll every {c.pollIntervalSeconds}s</p>
                        </div>
                        <span className={`badge ${c.enabled ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                          {c.enabled ? "Active" : "Paused"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Select a board to view details</p>
          )}
        </div>
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

      {/* Create Connector Modal */}
      {showCreateConnector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateConnector(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} onSubmit={createConnector}>
            <h3 className="text-lg font-semibold text-white">Add Email Connector</h3>
            <input className="input-field" placeholder="Email address" value={newConnector.email} onChange={(e) => setNewConnector({ ...newConnector, email: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field" placeholder="IMAP Host" value={newConnector.host} onChange={(e) => setNewConnector({ ...newConnector, host: e.target.value })} required />
              <input className="input-field" type="number" placeholder="Port" value={newConnector.port} onChange={(e) => setNewConnector({ ...newConnector, port: Number(e.target.value) })} />
            </div>
            <input className="input-field" placeholder="Username" value={newConnector.user} onChange={(e) => setNewConnector({ ...newConnector, user: e.target.value })} required />
            <input className="input-field" type="password" placeholder="Password" value={newConnector.password} onChange={(e) => setNewConnector({ ...newConnector, password: e.target.value })} required />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateConnector(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Add</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
