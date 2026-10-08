/**
 * The customer portal, simulated.
 *
 * Not a screenshot and not a description: the ticket list is the list the portal's own scoping
 * query returns for the chosen person, the ticket detail carries the notes the portal would show
 * (never the internal ones), and the buttons that are missing are missing because the policy in
 * force would refuse them. Nothing here is real — no session, no sign-in code, no ticket created —
 * which is the point: an administrator can look at what a customer gets before anybody gets it.
 *
 * Four steps, in the order a customer meets them: the sign-in page, the ticket list, one ticket
 * with its conversation, and raising a new one.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Bell, CircleAlert, Globe, Loader2, Mail, Plus, RotateCcw, Send, ShieldCheck, X,
} from "lucide-react";
import api from "../api";
import { DEFAULT_ACCENT_COLOUR, HEX_COLOUR_PATTERN, ON_ACCENT_COLOUR } from "../lib/colourTokens";
import { ticketStatusBadge, ticketStatusLabel } from "../lib/ticketStatus";
import { Chip } from "../pages/Configuration";

type Visibility = "contact" | "company";
type Source = "contact" | "client" | "instance" | "default";

interface PreviewPolicy {
  visibility: Visibility;
  allowTicketCreation: boolean;
  allowReplies: boolean;
  boardId: string | null;
  sources: { visibility: Source; allowTicketCreation: Source; allowReplies: Source; boardId: Source };
}

interface PreviewContact {
  id: string; name: string; firstName?: string; email: string; isPrimary: boolean; allowed: boolean;
}

interface PreviewTicket {
  id: string; ticketNumber: string; title: string; status: string; statusLabel: string;
  priority: string; createdAt: string; updatedAt: string;
}

interface PreviewTicketDetail extends PreviewTicket {
  description: string | null;
  assignedToName: string | null;
  comments: Array<{ id: string; fromCustomer: boolean; body: string; createdAt: string; authorName: string }>;
}

interface PreviewData {
  client: { id: string; name: string; portalEnabled: boolean };
  branding: { name: string; accentColor: string | null; logoUrl: string | null; welcomeText: string; supportEmail: string };
  policy: PreviewPolicy;
  board: { id: string; name: string } | null;
  contact: PreviewContact | null;
  contacts: Array<PreviewContact & { visibility: Visibility }>;
  tickets: PreviewTicket[];
  ticketTotal: number;
  clientTicketTotal: number;
}

const SOURCE_LABEL: Record<Source, string> = {
  contact: "this person",
  client: "this client",
  instance: "the deployment",
  default: "the default",
};

type Step = "sign-in" | "tickets" | "detail" | "new";

export function PortalPreviewDialog({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [contactId, setContactId] = useState("");
  const [step, setStep] = useState<Step>("sign-in");
  const [detail, setDetail] = useState<PreviewTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  // Notes and tickets "raised" in the preview live here and nowhere else.
  const [draftNotes, setDraftNotes] = useState<Record<string, string[]>>({});
  const [draftTickets, setDraftTickets] = useState<PreviewTicket[]>([]);
  const [reply, setReply] = useState("");
  const [newTicket, setNewTicket] = useState({ title: "", description: "", priority: "medium" });

  const load = useCallback(async (forContact?: string) => {
    setLoading(true);
    try {
      const query = forContact ? `?contactId=${forContact}` : "";
      const res = await api.get<PreviewData>(`/configuration/portal/clients/${clientId}/preview${query}`);
      setData(res.data);
      setContactId(res.data.contact?.id ?? "");
      setDetail(null);
      setDraftNotes({});
      setDraftTickets([]);
      setReply("");
      setNewTicket({ title: "", description: "", priority: "medium" });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const openTicket = async (ticketId: string) => {
    setStep("detail");
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.get<PreviewTicketDetail>(`/configuration/portal/clients/${clientId}/preview/tickets/${ticketId}?contactId=${contactId}`);
      setDetail(res.data);
    } catch {
      // The portal itself answers 404 for a ticket outside the scope in force, and so does this.
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const accent = (() => {
    const value = data?.branding.accentColor ?? "";
    return HEX_COLOUR_PATTERN.test(value) ? value : DEFAULT_ACCENT_COLOUR;
  })();

  const policy = data?.policy;
  const contact = data?.contact;
  const tickets = [...draftTickets, ...(data?.tickets ?? [])].filter(t => !statusFilter || t.status === statusFilter);
  const hidden = Math.max(0, (data?.clientTicketTotal ?? 0) - (data?.ticketTotal ?? 0));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="card w-full max-w-4xl my-8 space-y-4"
        role="dialog"
        aria-label={`Customer portal preview for ${data?.client.name ?? "this client"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg grid place-items-center bg-surface-lighter shrink-0">
            <Globe size={17} className="text-cyber-400" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white truncate">
              Portal preview — {data?.client.name ?? "…"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Everything below is simulated. No session is created, no code is sent, and nothing you
              do here is saved.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white shrink-0">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 py-10 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Building the customer's view…
          </p>
        ) : !data || !policy ? (
          <p className="text-sm text-gray-500 py-10 text-center">This client could not be previewed.</p>
        ) : (
          <>
            {/* ── Who is being simulated ── */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-gray-500">Signed in as</span>
                <select
                  className="input-field text-xs py-1 max-w-[18rem]"
                  aria-label="Contact to preview as"
                  value={contactId}
                  onChange={(e) => { void load(e.target.value); setStep("sign-in"); }}
                >
                  {data.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.allowed ? c.visibility === "company" ? "sees every ticket at the client" : "sees their own tickets" : "no portal access"}
                    </option>
                  ))}
                  {data.contacts.length === 0 && <option value="">This client has no contacts</option>}
                </select>
              </label>
              <div className="flex items-center gap-1.5 ml-auto">
                {(["sign-in", "tickets"] as Step[]).map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => { setStep(target); setDetail(null); }}
                    className={`px-2.5 py-1 rounded-lg border text-[11px] transition-colors ${
                      step === target || (target === "tickets" && (step === "detail" || step === "new"))
                        ? "border-cyber-500/60 text-cyber-300 bg-cyber-600/10"
                        : "border-surface-border text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {target === "sign-in" ? "Sign-in page" : "The portal"}
                  </button>
                ))}
                <button
                  type="button"
                  className="px-2.5 py-1 rounded-lg border border-surface-border text-[11px] text-gray-400 hover:text-gray-200 inline-flex items-center gap-1"
                  onClick={() => void load(contactId)}
                >
                  <RotateCcw size={11} /> Reset
                </button>
              </div>
            </div>

            {!contact ? (
              <p className="text-sm text-amber-200 border border-amber-500/30 rounded-lg px-3 py-2">
                This client has no active contacts, so there is nobody to sign in and nothing to show.
              </p>
            ) : !contact.allowed ? (
              <p className="text-sm text-amber-200 border border-amber-500/30 rounded-lg px-3 py-2 flex items-start gap-2">
                <CircleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  {contact.name} would not get into the portal at all
                  {!data.client.portalEnabled ? " — portal access is switched off for this client" : " — this person is refused the portal individually"}.
                  The sign-in page below is what anybody would still see.
                </span>
              </p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
              {/* ── The simulated browser ── */}
              <div className="rounded-xl border border-surface-border overflow-hidden bg-navy-900">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-border bg-navy-950">
                  <span className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-surface-lighter" />
                    <span className="w-2.5 h-2.5 rounded-full bg-surface-lighter" />
                    <span className="w-2.5 h-2.5 rounded-full bg-surface-lighter" />
                  </span>
                  <span className="text-[11px] text-gray-500 font-mono ml-1">/portal{step === "detail" && detail ? `/tickets/${detail.ticketNumber}` : step === "tickets" ? "/tickets" : ""}</span>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-surface-border text-gray-500">simulated</span>
                </div>

                <div className="min-h-[26rem]">
                  {step === "sign-in" ? (
                    <div className="p-6 flex flex-col items-center justify-center min-h-[26rem] text-center">
                      <div className="w-12 h-12 rounded-xl grid place-items-center mb-3" style={{ backgroundColor: `${accent}22` }}>
                        {data.branding.logoUrl
                          ? <img src={data.branding.logoUrl} alt="" className="h-8 w-8 object-contain" />
                          : <Globe size={22} style={{ color: accent }} />}
                      </div>
                      <p className="text-base font-semibold text-white">{data.branding.name}</p>
                      <p className="text-xs text-gray-500 mt-1 max-w-sm">
                        {data.branding.welcomeText || "Sign in to raise and follow your tickets."}
                      </p>
                      <div className="w-full max-w-xs mt-5 space-y-2 text-left">
                        <span className="block text-[11px] text-gray-500">Your email address</span>
                        <div className="input-field text-sm text-gray-400 flex items-center gap-2">
                          <Mail size={13} className="text-gray-500" /> {contact?.email ?? "—"}
                        </div>
                        <button
                          type="button"
                          disabled={!contact?.allowed}
                          onClick={() => setStep("tickets")}
                          className="w-full rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
                          style={{ backgroundColor: accent, color: ON_ACCENT_COLOUR }}
                        >
                          Email me a sign-in code
                        </button>
                        <p className="text-[11px] text-gray-500 text-center">
                          {contact?.allowed
                            ? "A simulated button: no code is sent. Press it to carry on as this customer."
                            : "This address would be told a code is on its way, and none would come."}
                        </p>
                        {data.branding.supportEmail && (
                          <p className="text-[11px] text-gray-600 text-center">Problems signing in? {data.branding.supportEmail}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col min-h-[26rem]">
                      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-border" style={{ backgroundColor: `${accent}14` }}>
                        {data.branding.logoUrl
                          ? <img src={data.branding.logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
                          : <span className="h-7 w-7 rounded grid place-items-center" style={{ backgroundColor: `${accent}22` }}><Globe size={15} style={{ color: accent }} /></span>}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white truncate">{data.branding.name}</p>
                          <p className="text-[11px] text-gray-500 truncate">{data.client.name}</p>
                        </div>
                        <span className="text-[11px] text-gray-400 truncate hidden sm:block">{contact?.firstName || contact?.name}</span>
                      </div>

                      {step === "tickets" && (
                        <div className="p-4 space-y-3 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold text-white">Your tickets</h4>
                            <Chip tone="muted">{data.ticketTotal}</Chip>
                            <div className="flex flex-wrap items-center gap-1 ml-auto">
                              {["", "open", "in_progress", "waiting_on_client", "resolved", "closed"].map((value) => (
                                <button
                                  key={value || "all"}
                                  type="button"
                                  onClick={() => setStatusFilter(value)}
                                  className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                                    statusFilter === value ? "border-cyber-500/60 text-cyber-300 bg-cyber-600/10" : "border-surface-border text-gray-500 hover:text-gray-300"
                                  }`}
                                >
                                  {value ? value.replace(/_/g, " ") : "all"}
                                </button>
                              ))}
                            </div>
                          </div>

                          {tickets.length === 0 ? (
                            <p className="text-sm text-gray-500 py-8 text-center">
                              {data.ticketTotal === 0 ? "Nothing has been raised here yet." : "No tickets with that status."}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {tickets.map((ticket) => (
                                <button
                                  key={ticket.id}
                                  type="button"
                                  onClick={() => void openTicket(ticket.id)}
                                  className="w-full text-left rounded-lg border border-surface-border hover:border-cyber-500/40 transition-colors px-3 py-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] text-gray-500">{ticket.ticketNumber}</span>
                                    <span className="text-sm text-gray-200 truncate flex-1">{ticket.title}</span>
                                    <span className={`badge text-[11px] ${ticketStatusBadge(ticket.status)}`}>{ticketStatusLabel(ticket.status)}</span>
                                  </div>
                                  <p className="text-[11px] text-gray-600 mt-0.5">
                                    Updated {new Date(ticket.updatedAt).toLocaleString()}
                                    {ticket.id.startsWith("preview-") ? " · not saved" : ""}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="pt-1">
                            {policy.allowTicketCreation ? (
                              <button type="button" className="btn-primary text-xs inline-flex items-center gap-1.5" onClick={() => setStep("new")}>
                                <Plus size={13} /> Raise a ticket
                              </button>
                            ) : (
                              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                                <CircleAlert size={12} /> No button to raise a ticket: raising is not allowed for this customer.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {step === "detail" && (
                        <div className="p-4 space-y-3 flex-1">
                          <button type="button" className="text-[11px] text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1" onClick={() => setStep("tickets")}>
                            <ArrowLeft size={12} /> All your tickets
                          </button>
                          {detailLoading ? (
                            <p className="text-sm text-gray-500 py-8 text-center flex items-center justify-center gap-2">
                              <Loader2 size={13} className="animate-spin" /> Loading the ticket…
                            </p>
                          ) : !detail ? (
                            <p className="text-sm text-amber-200 py-8 text-center">
                              This ticket would not be visible to {contact?.name} at all — the portal
                              answers exactly as if it did not exist.
                            </p>
                          ) : (
                            <>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-gray-500">{detail.ticketNumber}</span>
                                  <span className={`badge text-[11px] ${ticketStatusBadge(detail.status)}`}>{ticketStatusLabel(detail.status)}</span>
                                </div>
                                <h4 className="text-sm font-semibold text-white mt-1">{detail.title}</h4>
                                {detail.assignedToName && (
                                  <p className="text-[11px] text-gray-500 mt-0.5">Handled by {detail.assignedToName}</p>
                                )}
                              </div>
                              {detail.description && (
                                <p className="text-xs text-gray-300 whitespace-pre-wrap rounded-lg border border-surface-border p-3">{detail.description}</p>
                              )}
                              <div className="space-y-2">
                                <p className="text-[11px] text-gray-500">Conversation</p>
                                {detail.comments.length === 0 && <p className="text-xs text-gray-500">Nothing has been said yet.</p>}
                                {detail.comments.map((comment) => (
                                  <div key={comment.id} className={`rounded-lg border p-3 ${comment.fromCustomer ? "border-surface-border bg-surface-lighter" : "border-surface-border"}`}>
                                    <p className="text-[11px] text-gray-500 mb-1">{comment.authorName || "Support"} · {new Date(comment.createdAt).toLocaleString()}</p>
                                    <p className="text-xs text-gray-300 whitespace-pre-wrap">{comment.body}</p>
                                  </div>
                                ))}
                                {(draftNotes[detail.id] ?? []).map((body, index) => (
                                  <div key={`draft-${index}`} className="rounded-lg border border-surface-border bg-surface-lighter p-3">
                                    <p className="text-[11px] text-gray-500 mb-1">{contact?.name} · just now · not saved</p>
                                    <p className="text-xs text-gray-300 whitespace-pre-wrap">{body}</p>
                                  </div>
                                ))}
                              </div>
                              <div>
                                {policy.allowReplies ? (
                                  <div className="space-y-2">
                                    <textarea
                                      className="input-field text-sm"
                                      rows={2}
                                      placeholder="Reply to this ticket…"
                                      value={reply}
                                      onChange={(e) => setReply(e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className="btn-primary text-xs inline-flex items-center gap-1.5"
                                      disabled={!reply.trim()}
                                      onClick={() => {
                                        const body = reply.trim();
                                        if (!body) return;
                                        setDraftNotes((prev) => ({ ...prev, [detail.id]: [...(prev[detail.id] ?? []), body] }));
                                        setReply("");
                                      }}
                                    >
                                      <Send size={12} /> Send reply
                                    </button>
                                    <p className="text-[11px] text-gray-500">Simulated: the note appears above and is never written to the ticket.</p>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                                    <CircleAlert size={12} /> No reply box: replying is not allowed for this customer.
                                  </p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {step === "new" && (
                        <div className="p-4 space-y-3 flex-1">
                          <button type="button" className="text-[11px] text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1" onClick={() => setStep("tickets")}>
                            <ArrowLeft size={12} /> All your tickets
                          </button>
                          <h4 className="text-sm font-semibold text-white">Raise a ticket</h4>
                          <div className="space-y-2">
                            <input
                              className="input-field text-sm"
                              placeholder="What do you need help with?"
                              value={newTicket.title}
                              onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
                            />
                            <textarea
                              className="input-field text-sm"
                              rows={3}
                              placeholder="Tell us what is happening…"
                              value={newTicket.description}
                              onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                            />
                            <select
                              className="input-field text-sm max-w-[10rem]"
                              aria-label="Priority"
                              value={newTicket.priority}
                              onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Normal</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            disabled={!newTicket.title.trim() || !newTicket.description.trim()}
                            onClick={() => {
                              const title = newTicket.title.trim();
                              setDraftTickets((prev) => [{
                                id: `preview-${Date.now()}`,
                                ticketNumber: "would be assigned",
                                title,
                                status: "new",
                                statusLabel: "New",
                                priority: newTicket.priority,
                                createdAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                              }, ...prev]);
                              setNewTicket({ title: "", description: "", priority: "medium" });
                              setStep("tickets");
                            }}
                          >
                            Submit
                          </button>
                          <p className="text-[11px] text-gray-500">
                            Simulated: nothing is created. A real submission is raised by the portal's
                            own system user on {data.board?.name ?? "the oldest active board"}, so it
                            never appears to come from a member of staff.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Why this is what they see ── */}
              <div className="space-y-3">
                <div className="card space-y-2.5">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-cyber-400" /> What decided this
                  </h4>
                  <dl className="space-y-2 text-xs">
                    <div>
                      <dt className="text-gray-500">Tickets they see</dt>
                      <dd className="text-gray-200">
                        {policy.visibility === "company" ? "Every ticket at this client" : "Only their own"}
                        <span className="text-gray-500"> — decided by {SOURCE_LABEL[policy.sources.visibility]}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Raising tickets</dt>
                      <dd className="text-gray-200">
                        {policy.allowTicketCreation ? "Allowed" : "Not allowed"}
                        <span className="text-gray-500"> — decided by {SOURCE_LABEL[policy.sources.allowTicketCreation]}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Replying</dt>
                      <dd className="text-gray-200">
                        {policy.allowReplies ? "Allowed" : "Not allowed"}
                        <span className="text-gray-500"> — decided by {SOURCE_LABEL[policy.sources.allowReplies]}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">New tickets land on</dt>
                      <dd className="text-gray-200">
                        {data.board?.name ?? "the oldest active board"}
                        <span className="text-gray-500"> — decided by {SOURCE_LABEL[policy.sources.boardId]}</span>
                      </dd>
                    </div>
                  </dl>
                  {policy.visibility === "contact" && hidden > 0 && (
                    <p className="text-[11px] text-gray-500 border-t border-surface-border pt-2">
                      {hidden} other ticket{hidden === 1 ? "" : "s"} at {data.client.name} exist and are
                      not in this list.
                    </p>
                  )}
                </div>

                <div className="card space-y-2">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <Bell size={14} className="text-cyber-400" /> Worth checking
                  </h4>
                  <ul className="text-[11px] text-gray-500 space-y-1.5 list-disc pl-4">
                    <li>Only public notes appear above. Internal notes are filtered by the portal's own query, not by this screen.</li>
                    <li>The sign-in page wears the client's colour and logo when they have them, and the deployment's otherwise.</li>
                    <li>Tickets here are real and read-only; the preview never signs in as anybody.</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
