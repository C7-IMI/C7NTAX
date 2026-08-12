import { useState, useEffect } from "react";
import api from "../api";
import { FileText, ChevronDown, ChevronRight, Shield, Clock, User, Plus } from "lucide-react";
import toast from "react-hot-toast";

interface LogEntry {
  id: string; date: string;
  entries: Array<{ date: string; time: string; user: string; action: string; detail: string }>;
}

// ── Human-readable audit formatting ──

const ENTITY_LABELS: Record<string, string> = {
  ticket: "ticket", user: "user", company: "company", contact: "contact",
  board: "service board", invoice: "invoice", project: "project",
  report: "report", role: "role", opportunity: "opportunity",
  kumo_passwords: "Kumo password", kumo_assets: "Kumo asset",
  kumo_config: "Kumo configuration", kumo_doc: "Kumo document",
  kumo_link: "Kumo link", system_config: "system configuration",
  service_agreement: "service agreement", schedule: "schedule entry",
  locale: "locale", translation: "translation",
};

function friendlyEntity(entity: string): string {
  return ENTITY_LABELS[entity] || entity.replace(/_/g, " ");
}

function friendlyField(key: string): string {
  const FIELDS: Record<string, string> = {
    firstName: "first name", lastName: "last name", phone: "phone",
    mobile: "mobile", title: "job title", isActive: "active status",
    isLocked: "locked status", mfaEnabled: "MFA", startTime: "start time",
    endTime: "end time", dueDate: "due date", assignedToId: "assignee",
    companyId: "company", contactId: "contact", boardId: "board",
    ticketId: "ticket", userId: "user", priority: "priority",
    description: "description", status: "status", name: "name",
    email: "email", role: "role", permissions: "permissions",
    budget: "budget", serviceAgreementId: "service agreement",
    slaResponseMinutes: "SLA response", slaResolutionMinutes: "SLA resolution",
    autoCloseEnabled: "auto-close", autoCloseDays: "auto-close days",
    followUpEnabled: "follow-up", followUpIntervalMinutes: "follow-up interval",
    ticketCode: "ticket code", location: "location", color: "color",
    password: "password", passwordHash: "password", ipAddress: "IP address",
    sessionLockoutMinutes: "session lockout", requireMfa: "require MFA",
    ipWhitelist: "IP whitelist", auditRetentionDays: "audit retention",
    timezone: "timezone", dateFormat: "date format", companyName: "company name",
  };
  return FIELDS[key] || key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  if (v === "***") return "(redacted)";
  if (typeof v === "boolean") return v ? "enabled" : "disabled";
  if (Array.isArray(v)) return v.length === 0 ? "(none)" : `${v.length} item(s)`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return "(none)";
    return entries.map(([k, val]) => `${friendlyField(k)}: ${formatValue(val)}`).join(", ");
  }
  return String(v);
}

function buildAuditSentence(log: any): string {
  const [entity, verb] = (log.action || "").split(":");
  const entLabel = friendlyEntity(entity || log.entity || "");
  const VERBS: Record<string, string> = { create: "created", update: "updated", delete: "deleted" };
  const actionWord = VERBS[verb] || verb || "modified";

  let sentence = `${actionWord} ${entLabel}`;

  // Add entity ID context for identification
  if (log.entityId && verb !== "create") {
    const idShort = log.entityId.slice(0, 8);
    if (entity === "ticket" || entity === "invoice" || entity === "project") {
      sentence += ` #${idShort}`;
    }
  }

  // Format changes into a description
  const changes = log.changes;
  if (changes && typeof changes === "object" && Object.keys(changes).length > 0) {
    // Handle special case: delete (just a note)
    if (changes.note === "delete") {
      return `deleted ${entLabel}`;
    }
    const parts: string[] = [];
    for (const [key, val] of Object.entries(changes as Record<string, unknown>)) {
      if (key === "note") continue;
      const field = friendlyField(key);
      const fval = formatValue(val);
      if (verb === "create") {
        parts.push(`${field} to ${fval}`);
      } else {
        parts.push(`${field} to ${fval}`);
      }
    }
    if (parts.length > 0) {
      sentence += ` — ${parts.join(", ")}`;
    }
  }

  return sentence;
}

export function AuditLogsSection() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.get("/system/audit-logs").then(r => {
      const raw = r.data?.data || [];
      const grouped: Record<string, LogEntry> = {};
      for (const log of raw) {
        const dt = new Date(log.createdAt).toLocaleDateString();
        if (!grouped[dt]) grouped[dt] = { id: dt, date: dt, entries: [] };
        grouped[dt].entries.push({
          date: dt,
          time: new Date(log.createdAt).toLocaleTimeString(),
          user: log.userName || log.userId?.slice(0, 8) || "System",
          action: (log.action || "").replace(/:/g, " → "),
          detail: buildAuditSentence(log),
        });
      }
      setLogs(Object.values(grouped).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div><h2 className="text-lg font-semibold text-white">Audit Logs</h2><p className="text-sm text-gray-400 mt-0.5">Every change across the entire application — creation, updates, deletions, settings, and permissions</p></div>
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : logs.length === 0 ? <div className="card text-center py-8 text-gray-500">No audit log entries yet</div> : (
        <div className="space-y-3">
          {logs.map(day => (
            <div key={day.id} className="card">
              <button onClick={() => setExpanded(expanded === day.id ? null : day.id)} className="w-full flex items-center justify-between text-left">
                <div className="flex items-center gap-3"><FileText size={16} className="text-cyber-400"/><h3 className="font-semibold text-white text-sm">{day.date}</h3><span className="badge bg-surface-border text-gray-400 text-xs">{day.entries.length} events</span></div>
                {expanded === day.id ? <ChevronDown size={16} className="text-gray-500"/> : <ChevronRight size={16} className="text-gray-500"/>}
              </button>
              {expanded === day.id && (
                <div className="mt-3 space-y-1 border-t border-surface-border pt-3">
                  {day.entries.map((e, i) => (
                    <div key={i} className="flex items-start gap-3 py-1 text-xs">
                      <div className="shrink-0 text-gray-600 font-mono w-20">{e.time}</div>
                      <span className="badge bg-cyber-600/20 text-cyber-400 shrink-0">{e.action}</span>
                      <span className="text-gray-400 truncate">{e.detail}</span>
                      <span className="text-gray-600 shrink-0 ml-auto flex items-center gap-1"><User size={10}/>{e.user}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Service Boards Management ──
export function ServiceBoardsSection() {
  const [boards, setBoards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: "", description: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const fetch = () => {
    api.get("/boards").then(r => {
      const data = Array.isArray(r.data) ? r.data : (r.data?.data || r.data || []);
      setBoards(data);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/boards", newBoard); toast.success("Board created"); setShowCreate(false); setNewBoard({ name: "", description: "" }); fetch(); }
    catch { toast.error("Failed"); }
  };

  const startEdit = (b: any) => { setEditingId(b.id); setEditForm({ name: b.name, description: b.description, ticketCode: b.ticketCode, slaResponseMinutes: b.slaResponseMinutes, slaResolutionMinutes: b.slaResolutionMinutes, autoCloseEnabled: b.autoCloseEnabled, autoCloseDays: b.autoCloseDays, followUpEnabled: b.followUpEnabled, followUpIntervalMinutes: b.followUpIntervalMinutes }); };
  const saveEdit = async (id: string) => {
    try { await api.patch(`/boards/${id}`, editForm); toast.success("Updated"); setEditingId(null); fetch(); }
    catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Service Boards</h2><p className="text-sm text-gray-400 mt-0.5">Manage board SLAs, auto-close, and follow-up settings</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> New Board</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">Create Service Board</h3>
            <input className="input-field" placeholder="Board name" value={newBoard.name} onChange={e => setNewBoard({ ...newBoard, name: e.target.value })} required autoFocus />
            <textarea className="input-field" placeholder="Description (optional)" value={newBoard.description} onChange={e => setNewBoard({ ...newBoard, description: e.target.value })} rows={2} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Create</button></div>
          </form>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : boards.length === 0 ? <div className="card text-center py-8 text-gray-500">No boards configured</div> : (
        <div className="space-y-3">
          {boards.map((b: any) => (
            <div key={b.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield size={18} className="text-cyber-400" />
                  {editingId === b.id ? (
                    <input className="input-field text-sm" value={editForm.name || ""} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                  ) : (
                    <h3 className="text-white font-semibold">{b.name}</h3>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingId === b.id ? (
                    <>
                      <button onClick={() => setEditingId(null)} className="btn-secondary text-xs">Cancel</button>
                      <button onClick={() => saveEdit(b.id)} className="btn-primary text-xs">Save</button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(b)} className="btn-secondary text-xs">Edit</button>
                  )}
                </div>
              </div>
              {editingId === b.id && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-surface-border">
                  <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Description</label><input className="input-field" value={String(editForm.description || "")} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">Ticket Code</label><input className="input-field" placeholder="e.g. MSP" value={String(editForm.ticketCode || "")} onChange={e => setEditForm({ ...editForm, ticketCode: e.target.value })} /><p className="text-[10px] text-gray-600 mt-0.5">Filters tickets by prefix (e.g., "MSP-1005-1002")</p></div>
                  <div><label className="text-xs text-gray-500 block mb-1">SLA Response (min)</label><input className="input-field" type="number" value={String(editForm.slaResponseMinutes || "")} onChange={e => setEditForm({ ...editForm, slaResponseMinutes: Number(e.target.value) })} /></div>
                  <div><label className="text-xs text-gray-500 block mb-1">SLA Resolution (min)</label><input className="input-field" type="number" value={String(editForm.slaResolutionMinutes || "")} onChange={e => setEditForm({ ...editForm, slaResolutionMinutes: Number(e.target.value) })} /></div>
                  <div className="flex items-center gap-2"><input type="checkbox" checked={!!editForm.autoCloseEnabled} onChange={e => setEditForm({ ...editForm, autoCloseEnabled: e.target.checked })} /><label className="text-xs text-gray-400">Auto-close</label></div>
                  {editForm.autoCloseEnabled && <div><label className="text-xs text-gray-500 block mb-1">Auto-close Days</label><input className="input-field" type="number" value={String(editForm.autoCloseDays || 14)} onChange={e => setEditForm({ ...editForm, autoCloseDays: Number(e.target.value) })} /></div>}
                  <div className="flex items-center gap-2"><input type="checkbox" checked={!!editForm.followUpEnabled} onChange={e => setEditForm({ ...editForm, followUpEnabled: e.target.checked })} /><label className="text-xs text-gray-400">Follow-up</label></div>
                  {editForm.followUpEnabled && <div><label className="text-xs text-gray-500 block mb-1">Follow-up Interval (min)</label><input className="input-field" type="number" value={String(editForm.followUpIntervalMinutes || 120)} onChange={e => setEditForm({ ...editForm, followUpIntervalMinutes: Number(e.target.value) })} /></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
