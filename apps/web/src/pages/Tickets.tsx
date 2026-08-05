import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import { InferencePanel } from "../components/InferencePanel";
import { TicketStatus, TicketPriority } from "@c7-overwatch/shared";
import { Plus, Search, Filter, ArrowUpDown } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400", in_progress: "bg-cyber-600/20 text-cyber-400",
  waiting_on_client: "bg-amber-600/20 text-amber-400", resolved: "bg-green-600/20 text-green-400",
  closed: "bg-gray-600/20 text-gray-400", cancelled: "bg-red-600/20 text-red-400",
};
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400", high: "bg-orange-600/20 text-orange-400",
  medium: "bg-amber-600/20 text-amber-400", low: "bg-gray-600/20 text-gray-400",
};

export function TicketsPage() {
  const [tickets, setTickets] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/tickets?limit=100").then((r) => setTickets(r.data.data)).catch(() => toast.error("Failed to load tickets")).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Tickets</h2>
          <p className="text-sm text-gray-400">Manage service tickets and requests</p>
        </div>
        <button className="btn-primary flex items-center gap-2 self-start">
          <Plus size={16} /> New Ticket
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search tickets..." />
        </div>
        <button className="btn-secondary flex items-center gap-1.5"><Filter size={14} /> Filter</button>
        <button className="btn-secondary flex items-center gap-1.5"><ArrowUpDown size={14} /> Sort</button>
      </div>

      {/* Ticket table */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No tickets found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left text-gray-400">
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Status</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Priority</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Client</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Assigned</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(tickets as Array<Record<string, unknown>>).map((t) => (
                  <tr key={t.id as string} className="border-b border-surface-border/50 hover:bg-surface-light/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 transition-colors font-medium">
                        {t.ticketNumber as string}
                      </Link>
                      <p className="text-gray-500 text-xs mt-0.5 truncate max-w-xs">{(t.title as string)?.slice(0, 60)}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`badge ${STATUS_COLORS[t.status as string] || "bg-gray-600/20 text-gray-400"}`}>{(t.status as string)?.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className={`badge ${PRIORITY_COLORS[t.priority as string] || ""}`}>{t.priority as string}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{(t.company as { name?: string })?.name || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-400">
                      {t.assignedTo ? `${(t.assignedTo as { firstName?: string })?.firstName || ""} ${(t.assignedTo as { lastName?: string })?.lastName || ""}`.trim() || "-" : "-"}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">
                      {t.updatedAt ? new Date(t.updatedAt as string).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (id) api.get(`/tickets/${id}`).then((r) => setTicket(r.data)).catch(() => toast.error("Ticket not found"));
  }, [id]);

  if (!ticket) {
    return <div className="flex items-center justify-center py-20 text-gray-500">Loading ticket...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/tickets" className="text-sm text-cyber-400 hover:text-cyber-300">← Back to tickets</Link>
          <h2 className="text-xl font-bold text-white mt-1">{ticket.ticketNumber as string}</h2>
          <p className="text-white mt-1">{ticket.title as string}</p>
        </div>
        <div className="flex gap-2">
          <span className={`badge ${STATUS_COLORS[ticket.status as string] || ""}`}>{(ticket.status as string)?.replace(/_/g, " ")}</span>
          <span className={`badge ${PRIORITY_COLORS[ticket.priority as string] || ""}`}>{ticket.priority as string}</span>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card md:col-span-2">
          <h3 className="font-semibold text-white mb-2">Description</h3>
          <p className="text-gray-300 text-sm whitespace-pre-wrap">{ticket.description as string}</p>
        </div>
        <div className="card space-y-3">
          <div><p className="text-xs text-gray-500">Client</p><p className="text-sm text-white">{ticket.company ? (ticket.company as { name?: string }).name : "-"}</p></div>
          <div><p className="text-xs text-gray-500">Assigned To</p><p className="text-sm text-white">{ticket.assignedTo ? `${(ticket.assignedTo as { firstName?: string }).firstName} ${(ticket.assignedTo as { lastName?: string }).lastName}` : "Unassigned"}</p></div>
          <div><p className="text-xs text-gray-500">Created</p><p className="text-sm text-white">{new Date(ticket.createdAt as string).toLocaleString()}</p></div>
          <div><p className="text-xs text-gray-500">Updated</p><p className="text-sm text-white">{new Date(ticket.updatedAt as string).toLocaleString()}</p></div>
        </div>
      </div>

      {/* AI Inference Panel */}
      <InferencePanel
        ticketId={ticket.id as string}
        ticketTitle={ticket.title as string}
        ticketDescription={ticket.description as string | undefined}
      />

      {/* Notes */}
      <div className="card">
        <h3 className="font-semibold text-white mb-3">Notes & Activity</h3>
        <div className="space-y-3">
          {(ticket.notes as Array<Record<string, unknown>>)?.map((note) => (
            <div key={note.id as string} className="border-l-2 border-surface-border pl-3 py-1">
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{note.content as string}</p>
              <p className="text-xs text-gray-500 mt-1">
                {(note.author as { firstName?: string; lastName?: string })?.firstName} {(note.author as { firstName?: string; lastName?: string })?.lastName} · {new Date(note.createdAt as string).toLocaleString()}
                {(note as { isInternal?: boolean }).isInternal && <span className="badge ml-2 bg-amber-600/20 text-amber-400">internal</span>}
              </p>
            </div>
          ))}
          {(!ticket.notes || (ticket.notes as unknown[]).length === 0) && (
            <p className="text-gray-500 text-sm">No notes yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
