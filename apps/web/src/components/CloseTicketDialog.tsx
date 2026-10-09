/**
 * Closing a ticket: one decision, made once, with the client told or not told.
 *
 * Closing a ticket is not one action, it is two: the queue is updated, and somebody tells the client.
 * They are separate often enough — a ticket whose contact has left, a duplicate, one closed by
 * mistake — that the choice has to be visible rather than assumed, and it is the sort of thing that is
 * discovered *after* two hundred clients have been emailed. So the dialog asks, and it asks in the
 * vocabulary of the consequence rather than in the vocabulary of a flag: **Email the client** or
 * **Close silently**, with the sentence underneath saying what each one does.
 *
 * The closing note is the client's copy of "this is finished". It is written into the thread as a
 * customer-visible comment (so the portal and the timeline show it) and it is what the closing email
 * carries, which is why it is asked for as the reason rather than as an internal memo.
 *
 * Two designs, deliberately: the modern sheet is a set of decisions with their consequences beside
 * them, and the classic form is a labelled field list with a checkbox, which is what every other
 * classic dialog looks like. Neither is a restyle of the other.
 */
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Mail, MailX, X } from "lucide-react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { useRedesign } from "../hooks/useNavigationStyle";

/** Remembered per browser: most people close the same way every time, and the choice stays visible. */
const NOTIFY_PREFERENCE_KEY = "c7_close_notify_customer";

export interface CloseTicketTarget {
  id: string;
  ticketNumber?: string | null;
  title?: string | null;
}

type CloseStatus = "closed" | "resolved";

export function CloseTicketDialog({
  tickets, onCancel, onClosed,
}: {
  /** One ticket from a record, or the whole selection from the list's bulk actions. */
  tickets: CloseTicketTarget[];
  onCancel: () => void;
  onClosed: (result: { status: CloseStatus; emailed: boolean; count: number }) => void;
}) {
  const redesign = useRedesign();
  const many = tickets.length > 1;
  const first = tickets[0];
  const [notify, setNotify] = useState(() => {
    try { return localStorage.getItem(NOTIFY_PREFERENCE_KEY) !== "0"; } catch { return true; }
  });
  const [status, setStatus] = useState<CloseStatus>("closed");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const rememberNotificationChoice = (next: boolean) => {
    setNotify(next);
    try { localStorage.setItem(NOTIFY_PREFERENCE_KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    notesRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    setSaving(true);
    try {
      const closeNotes = notes.trim() || undefined;
      if (many) {
        await api.post("/tickets/batch", {
          ticketIds: tickets.map((ticket) => ticket.id),
          status,
          closeNotes,
          notifyCustomer: notify,
        });
      } else {
        await api.patch(`/tickets/${first!.id}`, { status, closeNotes, notifyCustomer: notify });
      }
      onClosed({ status, emailed: notify, count: tickets.length });
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not close the ticket"));
    } finally {
      setSaving(false);
    }
  };

  const doneLabel = saving
    ? "Closing…"
    : notify ? "Close and email the client" : "Close silently";
  const clientWord = many ? "each ticket's client" : "the client";
  const noteWord = many ? "every selected ticket" : "the ticket";

  // ── Modern: the two decisions, each with what it does written beside it ──
  if (redesign) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
        onClick={onCancel}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-ticket-title"
          className="w-full max-w-xl overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/15 text-cyber-400">
              <X size={16} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {many ? (
                  <span className="chip text-gray-300">{tickets.length} tickets</span>
                ) : (
                  <span className="chip text-gray-300">{first?.ticketNumber || "Ticket"}</span>
                )}
                <h2 id="close-ticket-title" className="text-sm font-semibold text-white">
                  {many ? `Close ${tickets.length} tickets` : "Close this ticket"}
                </h2>
              </div>
              <p className="mt-1 truncate text-xs text-gray-500" title={many ? tickets.map((ticket) => ticket.ticketNumber).filter(Boolean).join(", ") : first?.title || undefined}>
                {many
                  ? tickets.map((ticket) => ticket.ticketNumber).filter(Boolean).slice(0, 4).join(" · ") + (tickets.length > 4 ? ` +${tickets.length - 4} more` : "")
                  : first?.title || "Untitled ticket"}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="ml-auto rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white"
              aria-label="Cancel"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-5 px-5 py-5">
            <div>
              <span className="block text-xs uppercase tracking-wider text-gray-500">The client</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={notify}
                  onClick={() => rememberNotificationChoice(true)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    notify ? "border-cyber-500/60 bg-cyber-600/10" : "border-surface-border hover:border-gray-600"
                  }`}
                >
                  <Mail size={16} className={notify ? "mt-0.5 text-cyber-400" : "mt-0.5 text-gray-500"} />
                  <span>
                    <span className="block text-sm font-medium text-white">Email {clientWord}</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      A closing email with your note. Replying to it reopens {many ? "each ticket" : "the ticket"}.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={!notify}
                  onClick={() => rememberNotificationChoice(false)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    !notify ? "border-surface-border bg-surface-lighter" : "border-surface-border hover:border-gray-600"
                  }`}
                >
                  <MailX size={16} className="mt-0.5 text-gray-500" />
                  <span>
                    <span className="block text-sm font-medium text-white">Close silently</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Nothing is sent. The note is still recorded on {noteWord}.
                    </span>
                  </span>
                </button>
              </div>
            </div>

            <div>
              <span className="block text-xs uppercase tracking-wider text-gray-500">Close as</span>
              <div className="mt-2 inline-flex rounded-lg border border-surface-border p-0.5">
                {([["closed", "Closed"], ["resolved", "Resolved"]] as Array<[CloseStatus, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      status === value ? "bg-cyber-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="close-ticket-notes" className="block text-xs uppercase tracking-wider text-gray-500">
                Closing note — why it is being closed
              </label>
              <textarea
                id="close-ticket-notes"
                ref={notesRef}
                rows={4}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Replaced the failing switch and confirmed the link is stable. No further action needed."
                className="input-field mt-2 resize-y text-sm"
              />
              <p className="mt-1.5 text-xs text-gray-600">
                {notify
                  ? `The note goes into the closing email and into the thread the client can see${many ? " on every selected ticket" : ""}.`
                  : `The note is recorded on ${noteWord}. Nothing is emailed.`}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-surface-border bg-surface-light/40 px-5 py-4">
            <span className="truncate text-xs text-gray-500">
              {notify
                ? many ? `${tickets.length} clients will be emailed` : "The client will be emailed"
                : "No email will be sent"}
            </span>
            <div className="flex items-center gap-2">
              <button className="btn-secondary text-sm" onClick={onCancel} disabled={saving}>Cancel</button>
              <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={submit} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                {doneLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Classic: the form it has always been, with the choice as a checkbox ──
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Close ticket"
        className="card w-full max-w-lg space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold text-white">
            {many ? `Close ${tickets.length} tickets` : `Close ticket ${first?.ticketNumber || ""}`}
          </h3>
          <p className="mt-1 text-sm text-gray-400">
            {many
              ? tickets.map((ticket) => ticket.ticketNumber).filter(Boolean).slice(0, 6).join(", ")
              : first?.title || "Untitled ticket"}
          </p>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1" htmlFor="close-ticket-status">Close as</label>
          <select
            id="close-ticket-status"
            className="input-field"
            value={status}
            onChange={(event) => setStatus(event.target.value as CloseStatus)}
          >
            <option value="closed">Closed</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            className="accent-cyber-500 mt-0.5"
            checked={notify}
            onChange={(event) => rememberNotificationChoice(event.target.checked)}
          />
          <span>
            Email {clientWord} that {many ? "these tickets are" : "this ticket is"} {status}
            <span className="block text-xs text-gray-500 mt-0.5">
              If the client replies to that email the ticket reopens as Customer reopened. Untick this to
              close without notifying anybody.
            </span>
          </span>
        </label>

        <div>
          <label className="text-xs text-gray-500 block mb-1" htmlFor="close-ticket-notes-classic">
            Closing notes / reason (optional)
          </label>
          <textarea
            id="close-ticket-notes-classic"
            ref={notesRef}
            rows={4}
            className="input-field"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Why this ticket is being closed — included in the email when the client is notified."
          />
          {many && (
            <p className="mt-1 text-xs text-gray-500">One note is recorded on every selected ticket.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary text-sm" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn-primary text-sm flex items-center gap-1.5" onClick={submit} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {doneLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
