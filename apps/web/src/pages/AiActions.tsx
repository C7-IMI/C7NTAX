import { useEffect, useState } from "react";
import api from "../api";

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

  const tierColor = (t: string) => ({ low: "#22c55e", medium: "#eab308", high: "#f97316", critical: "#ef4444" }[t] || "#94a3b8");
  const statusColor = (s: string) => ({ executed: "#22c55e", failed: "#f87171", rejected: "#94a3b8", blocked: "#ef4444", approved: "#93c5fd" }[s] || "#64748b");

  return (
    <div style={{ padding: 24, color: "#cbd5e1" }}>
      <h1 style={{ color: "#e2e8f0", fontSize: 22 }}>AI Actions (risk-classified)</h1>
      <p style={{ color: "#94a3b8" }}>
        Critical actions are blocked automatically. <strong style={{ color: "#cbd5e1" }}>Approving an action carries it out</strong> — through
        the same route the screen uses, as the person who raised it — and a failure is recorded here with its reason. Decisions are audited.
      </p>
      {message && <p style={{ color: "#93c5fd" }}>{message}</p>}
      {actions.map(a => {
        const applied = appliedSummary(a.result);
        return (
          <div key={a.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 12, margin: "8px 0", background: "#0f172a" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: tierColor(a.riskTier), textTransform: "uppercase", fontSize: 12 }}>{a.riskTier}</span>
              <strong>{a.title}</strong>
              <span style={{ color: statusColor(a.status), fontSize: 12 }}>{a.entityType} · {a.status}</span>
            </div>
            <p style={{ margin: "6px 0", color: "#94a3b8" }}>{a.summary}</p>
            {applied && <p style={{ margin: "6px 0", color: "#86efac", fontSize: 13 }}>{applied}</p>}
            {a.errorMessage && (
              <p style={{ margin: "6px 0", color: "#fca5a5", fontSize: 13, background: "rgba(220,38,38,.12)", borderRadius: 6, padding: "6px 8px" }}>
                {a.errorMessage}
              </p>
            )}
            {a.status === "pending" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decide(a.id, "approve")} style={{ padding: "6px 12px", background: "#16a34a", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Approve &amp; apply</button>
                <button onClick={() => decide(a.id, "reject")} style={{ padding: "6px 12px", background: "#b91c1c", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Reject</button>
              </div>
            )}
            {a.audit.length > 0 && <p style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>{(a.audit).map(x => x.event).join(" → ")}</p>}
          </div>
        );
      })}
      {actions.length === 0 && <p style={{ color: "#64748b" }}>No AI actions yet.</p>}
    </div>
  );
}
