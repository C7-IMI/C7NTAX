import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Plus, RefreshCw, Send } from "lucide-react";
import portalApi, { portalErrorMessage } from "../../portalApi";
import { ON_ACCENT_COLOUR } from "../../lib/colourTokens";
import { portalAccent, usePortalAuth } from "./PortalApp";

interface PortalTicket {
  id: string;
  ticketNumber: string;
  title: string;
  status: string;
  statusLabel: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CLASSES: Record<string, string> = {
  new: "bg-cyber-600/20 text-cyber-400",
  open: "bg-blue-600/20 text-blue-400",
  in_progress: "bg-amber-600/20 text-amber-400",
  waiting_on_client: "bg-purple-600/20 text-purple-400",
  waiting_on_vendor: "bg-indigo-600/20 text-indigo-400",
  resolved: "bg-green-600/20 text-green-400",
  closed: "bg-gray-600/20 text-gray-400",
};

export function PortalTickets() {
  const { me, refresh, policy } = usePortalAuth();
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [showNew, setShowNew] = useState(false);
  const accent = portalAccent(me?.company);
  // A provider who has switched raising tickets off gets a portal without the button, and the
  // API refuses the call too — a hidden button is not a permission.
  const canRaise = policy?.allowTicketCreation !== false;

  const load = () => {
    setLoading(true);
    portalApi.get("/tickets?limit=100")
      .then(r => setTickets(r.data?.data ?? []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const visible = filter === "open"
    ? tickets.filter(t => !["resolved", "closed"].includes(t.status))
    : tickets;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-base font-semibold">My tickets</h2>
          <p className="text-xs text-gray-400">{me?.openTickets ?? 0} open · {tickets.length} in total</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded border border-surface-border overflow-hidden text-xs">
            <button onClick={() => setFilter("open")} className={`px-3 py-1.5 ${filter === "open" ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white"}`}>Open</button>
            <button onClick={() => setFilter("all")} className={`px-3 py-1.5 ${filter === "all" ? "bg-surface-lighter text-white" : "text-gray-400 hover:text-white"}`}>All</button>
          </div>
          <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5" title="Refresh"><RefreshCw size={14} /> Refresh</button>
          {canRaise && (
            <button onClick={() => setShowNew(v => !v)} className="btn-primary text-xs flex items-center gap-1.5" style={{ backgroundColor: accent, color: ON_ACCENT_COLOUR }}>
              <Plus size={14} /> New ticket
            </button>
          )}
        </div>
      </div>

      {showNew && canRaise && <NewTicketForm onCreated={() => { setShowNew(false); setFilter("all"); load(); void refresh(); }} onCancel={() => setShowNew(false)} />}

      {loading ? (
        <div className="card p-8 text-center text-sm text-gray-500">Loading your tickets…</div>
      ) : visible.length === 0 ? (
        <div className="card p-8 text-center space-y-2">
          <p className="text-sm text-gray-400">{filter === "open" ? "You have no open tickets." : "You have not raised any tickets yet."}</p>
          {canRaise
            ? <p className="text-xs text-gray-600">Use “New ticket” to tell your provider what you need.</p>
            : <p className="text-xs text-gray-600">Contact your provider directly to have something added.</p>}
        </div>
      ) : (
        <div className="card divide-y divide-surface-border/60 p-0">
          {visible.map(t => (
            <Link key={t.id} to={`/portal/tickets/${t.id}`} className="block px-4 py-3 hover:bg-surface-lighter/40">
              <div className="flex items-center gap-2">
                <span className={`badge text-xs ${STATUS_CLASSES[t.status] || "bg-gray-600/20 text-gray-400"}`}>{t.statusLabel}</span>
                <span className="text-xs text-gray-500">{t.ticketNumber}</span>
                {t.priority === "high" && <span className="badge text-xs bg-red-600/20 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> High</span>}
                <span className="ml-auto text-xs text-gray-500">updated {new Date(t.updatedAt).toLocaleDateString()}</span>
              </div>
              <p className="text-sm text-white mt-1 truncate">{t.title}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTicketForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { me } = usePortalAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accent = portalAccent(me?.company);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await portalApi.post("/tickets", { title, description, priority });
      setTitle(""); setDescription(""); setPriority("medium");
      onCreated();
    } catch (err: unknown) {
      setError(portalErrorMessage(err, "Could not raise that ticket — please try again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h3 className="text-sm font-semibold">Tell us what you need</h3>
      <div>
        <label className="text-xs text-gray-500 block mb-1" htmlFor="new-title">Summary</label>
        <input id="new-title" className="input-field" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Printer in the front office will not print" required />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1" htmlFor="new-description">Details</label>
        <textarea id="new-description" className="input-field text-sm" rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="What happened, when it started, and anything you have already tried." required />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500" htmlFor="new-priority">Priority</label>
          <select id="new-priority" className="input-field py-1.5 w-auto text-sm" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Normal</option>
            <option value="high">High — work is stopped</option>
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary text-sm flex items-center gap-1.5" style={{ backgroundColor: accent, color: ON_ACCENT_COLOUR }} disabled={busy || !title.trim() || !description.trim()}>
            <Send size={14} /> {busy ? "Sending…" : "Submit ticket"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
    </form>
  );
}
