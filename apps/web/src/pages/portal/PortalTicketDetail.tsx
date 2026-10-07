import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, Clock, Send, User } from "lucide-react";
import portalApi, { portalErrorMessage } from "../../portalApi";
import { ON_ACCENT_COLOUR } from "../../lib/colourTokens";
import { portalAccent, usePortalAuth } from "./PortalApp";

interface PortalComment {
  id: string;
  fromCustomer: boolean;
  body: string;
  createdAt: string;
  authorName: string;
}

interface PortalTicketDetailData {
  id: string;
  ticketNumber: string;
  title: string;
  description: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  assignedToName: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: PortalComment[];
}

export function PortalTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { me, policy } = usePortalAuth();
  const [ticket, setTicket] = useState<PortalTicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accent = portalAccent(me?.company);

  const load = () => {
    setLoading(true);
    portalApi.get(`/tickets/${id}`)
      .then(r => setTicket(r.data))
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [id]);

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await portalApi.post(`/tickets/${id}/reply`, { body: reply });
      setReply("");
      load();
    } catch (err: unknown) {
      setError(portalErrorMessage(err, "Could not send that reply — please try again"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="card p-8 text-center text-sm text-gray-500">Loading the ticket…</div>;
  if (missing || !ticket) {
    return (
      <div className="card p-8 text-center space-y-2">
        <p className="text-sm text-gray-400">That ticket is not available on your account.</p>
        <Link to="/portal/tickets" className="text-xs" style={{ color: accent }}>Back to my tickets</Link>
      </div>
    );
  }

  const closed = ["resolved", "closed"].includes(ticket.status);

  return (
    <div className="space-y-4">
      <Link to="/portal/tickets" className="text-xs text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft size={14} /> My tickets</Link>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{ticket.ticketNumber}</span>
          <span className="badge text-xs bg-surface-lighter text-gray-300">{ticket.statusLabel}</span>
          {ticket.priority === "high" && <span className="badge text-xs bg-red-600/20 text-red-400 flex items-center gap-1"><AlertTriangle size={10} /> High priority</span>}
          <span className="ml-auto text-xs text-gray-500 flex items-center gap-1"><Clock size={12} /> opened {new Date(ticket.createdAt).toLocaleDateString()}</span>
        </div>
        <h2 className="text-base font-semibold">{ticket.title}</h2>
        {ticket.description && <p className="text-sm text-gray-300 whitespace-pre-wrap">{ticket.description}</p>}
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <User size={12} />
          {ticket.assignedToName ? `Being handled by ${ticket.assignedToName}` : "Waiting to be assigned to an engineer"}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400">Conversation</h3>
        {ticket.comments.length === 0 && <p className="text-xs text-gray-600">No messages yet.</p>}
        {ticket.comments.map(c => (
          <div key={c.id} className={`card ${c.fromCustomer ? "border-l-2" : ""}`} style={c.fromCustomer ? { borderLeftColor: accent } : undefined}>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="text-gray-300">{c.fromCustomer ? "You" : c.authorName || "Your provider"}</span>
              <span className="ml-auto">{new Date(c.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap mt-2">{c.body}</p>
          </div>
        ))}
      </div>

      {policy?.allowReplies === false ? (
        <div className="card">
          <p className="text-sm text-gray-400">
            Replying through the portal is switched off for this deployment. Please contact your
            provider{policy?.supportEmail ? <> at <a href={`mailto:${policy.supportEmail}`} className="text-gray-300 hover:text-white">{policy.supportEmail}</a></> : null} to add anything to this ticket.
          </p>
        </div>
      ) : (
        <form onSubmit={submitReply} className="card space-y-3">
          <h3 className="text-sm font-semibold">{closed ? "Reply and reopen" : "Add a message"}</h3>
          {closed && <p className="text-xs text-gray-400">This ticket was closed. Replying will reopen it so your provider sees it in their queue.</p>}
          <textarea
            className="input-field text-sm"
            rows={4}
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder="Add anything that will help, such as what changed or what you have tried."
            required
          />
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary text-sm flex items-center gap-1.5" style={{ backgroundColor: accent, color: ON_ACCENT_COLOUR }} disabled={busy || !reply.trim()}>
              <Send size={14} /> {busy ? "Sending…" : closed ? "Reply and reopen" : "Send reply"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
