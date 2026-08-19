import { useEffect, useState } from "react";
import api from "../api";

type AiAction = { id: string; entityType: string; title: string; summary: string; riskTier: string; status: string; createdAt: string; audit: Array<{ event: string; at: string }> };

export function AiActionsPage() {
  const [actions, setActions] = useState<AiAction[]>([]);
  const [message, setMessage] = useState("");

  const load = () => api.get("/ai-actions").then(r => setActions(r.data.data || [])).catch(() => setActions([]));

  useEffect(() => { void load(); }, []);

  const decide = async (id: string, decision: "approve" | "reject") => {
    try { await api.post(`/ai-actions/${id}/decide`, { decision }); setMessage(`Action ${decision === "approve" ? "approved" : "rejected"}`); void load(); }
    catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Decision failed"); }
  };

  const tierColor = (t: string) => ({ low: "#22c55e", medium: "#eab308", high: "#f97316", critical: "#ef4444" }[t] || "#94a3b8");

  return (
    <div style={{ padding: 24, color: "#cbd5e1" }}>
      <h1 style={{ color: "#e2e8f0", fontSize: 22 }}>AI Actions (risk-classified)</h1>
      <p style={{ color: "#94a3b8" }}>Critical actions are blocked automatically. Approve or reject pending actions below; decisions are audited.</p>
      {message && <p style={{ color: "#93c5fd" }}>{message}</p>}
      {actions.map(a => (
        <div key={a.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 12, margin: "8px 0", background: "#0f172a" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: tierColor(a.riskTier), textTransform: "uppercase", fontSize: 12 }}>{a.riskTier}</span>
            <strong>{a.title}</strong>
            <span style={{ color: "#64748b", fontSize: 12 }}>{a.entityType} · {a.status}</span>
          </div>
          <p style={{ margin: "6px 0", color: "#94a3b8" }}>{a.summary}</p>
          {a.status === "pending" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => decide(a.id, "approve")} style={{ padding: "6px 12px", background: "#16a34a", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Approve</button>
              <button onClick={() => decide(a.id, "reject")} style={{ padding: "6px 12px", background: "#b91c1c", border: "none", color: "#fff", borderRadius: 6, cursor: "pointer" }}>Reject</button>
            </div>
          )}
          {a.audit.length > 0 && <p style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>{(a.audit).map(x => x.event).join(" → ")}</p>}
        </div>
      ))}
      {actions.length === 0 && <p style={{ color: "#64748b" }}>No AI actions yet.</p>}
    </div>
  );
}
