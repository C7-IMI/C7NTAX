import { useEffect, useState } from "react";
import api from "../api";
import { PageHeader, StatCard } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

type AiAction = {
  id: string; entityType: string; title: string; summary: string; riskTier: string; status: string; createdAt: string;
  /** Present when the action was applied: the new ticket's id and number, a note's id. */
  result?: Record<string, unknown> | null;
  /** Why it failed, in the route's own words, when it did. */
  errorMessage?: string | null;
  appliedAt?: string | null;
  audit: Array<{ event: string; at: string }>;
};

/** What an applied action produced, in the terms the person reading the screen cares about. */
function appliedSummary(result: Record<string, unknown> | null | undefined): string | null {
  if (!result) return null;
  if (typeof result.ticketNumber === "string") return `Created ticket ${result.ticketNumber}`;
  if (typeof result.noteId === "string") return result.customerNotified ? "Added the note and emailed the customer" : "Added the note (internal — nobody was emailed)";
  return null;
}

export function AiActionsPage() {
  const redesign = useRedesign();
  const [actions, setActions] = useState<AiAction[]>([]);
  const [message, setMessage] = useState("");

  const load = () => api.get("/ai-actions").then(r => setActions(r.data.data || [])).catch(() => setActions([]));

  useEffect(() => { void load(); }, []);

  const decide = async (id: string, decision: "approve" | "reject") => {
    try {
      const { data } = await api.post(`/ai-actions/${id}/decide`, { decision });
      // Approving *applies* the action, so the message says what happened rather than what was clicked.
      if (decision === "reject") setMessage("Action rejected — nothing was changed");
      else if (data?.status === "executed") setMessage(`Applied: ${appliedSummary(data.result) ?? "done"}`);
      else setMessage(`Approved, but it could not be applied: ${data?.errorMessage ?? "no reason given"}`);
      void load();
    }
    catch (e: any) { setMessage(e?.response?.data?.error?.message || e?.message || "Decision failed"); }
  };

  const tierClass = (t: string) => ({ low: "text-green-400", medium: "text-yellow-400", high: "text-orange-400", critical: "text-red-400" }[t] || "text-gray-400");
  const statusClass = (s: string) => ({ executed: "text-green-400", failed: "text-red-400", rejected: "text-gray-400", blocked: "text-red-400", approved: "text-blue-300" }[s] || "text-gray-500");
  const tierChip = (t: string) => ({ low: "chip--good", medium: "chip--warn", high: "chip--warn", critical: "chip--bad" }[t] || "");
  const statusChip = (s: string) => ({ executed: "chip--good", failed: "chip--bad", blocked: "chip--bad" }[s] || "");
  const countOf = (status: string) => actions.filter(a => a.status === status).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader variant="section" title="AI Actions (risk-classified)" />
      <p className="text-sm text-gray-400 max-w-3xl">
        Critical actions are blocked automatically. <strong className="text-gray-300">Approving an action carries it out</strong> — through
        the same route the screen uses, as the person who raised it — and a failure is recorded here with its reason. Decisions are audited.
      </p>
      {redesign && actions.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Awaiting a decision" value={countOf("pending")} tone="amber" />
          <StatCard label="Applied" value={countOf("executed")} tone="green" />
          <StatCard label="Failed" value={countOf("failed")} tone="red" />
          <StatCard label="Rejected" value={countOf("rejected")} tone="neutral" />
        </div>
      )}
      {message && <p className="text-sm text-cyber-300">{message}</p>}
      {actions.map(a => {
        const applied = appliedSummary(a.result);
        return (
          <div key={a.id} className="card space-y-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              {redesign ? (
                <>
                  <span className={`chip text-[10px] uppercase ${tierChip(a.riskTier)}`}>{a.riskTier}</span>
                  <strong className="text-sm text-white">{a.title}</strong>
                  <span className={`chip text-[10px] ${statusChip(a.status)}`}>{a.status}</span>
                  <span className="text-[11px] text-gray-500">{a.entityType}</span>
                </>
              ) : (
                <>
                  <span className={`text-[11px] uppercase font-medium ${tierClass(a.riskTier)}`}>{a.riskTier}</span>
                  <strong className="text-sm text-white">{a.title}</strong>
                  <span className={`text-xs ${statusClass(a.status)}`}>{a.entityType} · {a.status}</span>
                </>
              )}
            </div>
            <p className="text-sm text-gray-400">{a.summary}</p>
            {applied && <p className="text-xs text-green-400">{applied}</p>}
            {a.errorMessage && (
              <p className="text-xs text-red-400 rounded-md bg-red-600/10 px-2 py-1.5">
                {a.errorMessage}
              </p>
            )}
            {a.status === "pending" && (
              <div className="flex gap-2">
                <button onClick={() => decide(a.id, "approve")} className="btn-primary text-sm">Approve &amp; apply</button>
                <button onClick={() => decide(a.id, "reject")} className="btn-danger text-sm">Reject</button>
              </div>
            )}
            {a.audit.length > 0 && <p className="text-[11px] text-gray-600">{(a.audit).map(x => x.event).join(" → ")}</p>}
          </div>
        );
      })}
      {actions.length === 0 && <p className="text-sm text-gray-500">No AI actions yet.</p>}
    </div>
  );
}
