import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  FileText, Clock, ChevronDown, Shield, Columns3, Plug, Settings,
  Users, Activity, Plus, Trash2, Save, X
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────
//  Admin Logs Page
// ────────────────────────────────────────────────────────────────────

interface LogEntry { id: string; date: string; entries: Array<{ time: string; user: string; action: string; detail: string }>; }

export function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get("/tickets?limit=200"),
      api.get("/billing/invoices?limit=100"),
    ]).then(([tRes, iRes]) => {
      const tickets = tRes.data?.data || [];
      const invoices = iRes.data?.data || [];
      const entries: Array<{ date: string; time: string; user: string; action: string; detail: string }> = [];

      for (const t of tickets) {
        if (t.createdAt) entries.push({ date: new Date(t.createdAt).toLocaleDateString(), time: new Date(t.createdAt).toLocaleTimeString(), user: (t.createdBy as {firstName?:string})?.firstName || "System", action: "Ticket Created", detail: `${t.ticketNumber}: ${t.title}` });
        if (t.updatedAt && t.updatedAt !== t.createdAt) entries.push({ date: new Date(t.updatedAt).toLocaleDateString(), time: new Date(t.updatedAt).toLocaleTimeString(), user: (t.assignedTo as {firstName?:string})?.firstName || "System", action: "Ticket Updated", detail: `${t.ticketNumber}: status → ${t.status}` });
      }
      for (const inv of invoices) {
        if (inv.createdAt) entries.push({ date: new Date(inv.createdAt).toLocaleDateString(), time: new Date(inv.createdAt).toLocaleTimeString(), user: "System", action: "Invoice Created", detail: `${inv.invoiceNumber}: $${inv.total}` });
        if (inv.sentAt) entries.push({ date: new Date(inv.sentAt).toLocaleDateString(), time: new Date(inv.sentAt).toLocaleTimeString(), user: "System", action: "Invoice Sent", detail: inv.invoiceNumber });
        if (inv.paidAt) entries.push({ date: new Date(inv.paidAt).toLocaleDateString(), time: new Date(inv.paidAt).toLocaleTimeString(), user: "System", action: "Payment Received", detail: `${inv.invoiceNumber}: $${inv.total}` });
      }

      const grouped: Record<string, LogEntry> = {};
      for (const e of entries) {
        const bucket = grouped[e.date];
        if (!bucket) grouped[e.date] = { id: e.date, date: e.date, entries: [e] };
        else bucket.entries.push(e);
      }
      setLogs(Object.values(grouped).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div><h2 className="text-lg font-semibold text-white">Audit Logs</h2><p className="text-sm text-gray-400 mt-0.5">Cumulative changes across the application</p></div>
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : logs.length === 0 ? <div className="card text-center py-8 text-gray-500">No log entries yet</div> : (
        <div className="space-y-3">
          {logs.map(day => (
            <div key={day.id} className="card">
              <button onClick={() => setExpanded(expanded === day.id ? null : day.id)} className="w-full flex items-center justify-between text-left">
                <div className="flex items-center gap-3"><FileText size={16} className="text-cyber-400"/><h3 className="font-semibold text-white text-sm">{day.date}</h3><span className="badge bg-surface-border text-gray-400 text-xs">{day.entries.length} events</span></div>
                <ChevronDown size={16} className={`text-gray-500 transition-transform ${expanded===day.id?"rotate-180":""}`}/>
              </button>
              {expanded === day.id && (
                <div className="mt-3 space-y-1.5 animate-fade-in">
                  {day.entries.sort((a,b)=>b.time.localeCompare(a.time)).map((e,i) => (
                    <div key={i} className="flex items-start gap-3 py-2 px-3 rounded-lg bg-surface-lighter text-sm">
                      <Clock size={12} className="text-gray-500 mt-0.5 shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2"><span className="text-white font-medium">{e.action}</span><span className="text-gray-500 text-xs">{e.time}</span></div>
                        <p className="text-gray-400 text-xs mt-0.5 truncate">{e.detail}</p>
                      </div>
                      <span className="text-gray-600 text-xs shrink-0">{e.user}</span>
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

// ────────────────────────────────────────────────────────────────────
//  Service Boards Settings (under Administration)
// ────────────────────────────────────────────────────────────────────

export function AdminServiceBoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<Array<{id:string;name:string;description:string|null;isActive:boolean;slaResponseMinutes:number;slaResolutionMinutes:number;autoCloseEnabled:boolean;autoCloseDays:number;followUpEnabled:boolean;followUpIntervalHours:number}>>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string,string|number|boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newBoard, setNewBoard] = useState({ name: "", description: "" });

  const fetchBoards = () => {
    api.get("/boards").then(r => setBoards(Array.isArray(r.data) ? r.data : (r.data?.data || r.data || []))).catch(() => {});
  };
  useEffect(() => { fetchBoards(); }, []);

  const startEdit = (b: typeof boards[0]) => {
    setEditing(b.id);
    setEditForm({
      name: b.name, description: b.description || "",
      slaResponseMinutes: b.slaResponseMinutes, slaResolutionMinutes: b.slaResolutionMinutes,
      autoCloseEnabled: b.autoCloseEnabled, autoCloseDays: b.autoCloseDays,
      followUpEnabled: b.followUpEnabled, followUpIntervalHours: b.followUpIntervalHours,
    });
  };

  const saveEdit = async (id: string) => {
    try {
      await api.patch(`/boards/${id}`, editForm);
      toast.success("Board updated");
      setEditing(null);
      fetchBoards();
    } catch { toast.error("Failed to update"); }
  };

  const createBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/boards", newBoard);
      toast.success("Board created");
      setNewBoard({ name: "", description: "" });
      setShowCreate(false);
      fetchBoards();
    } catch { toast.error("Failed to create board"); }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Boards</h2>
          <p className="text-sm text-gray-400 mt-0.5">Configure service board settings, SLA policies, and automations</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> New Board</button>
      </div>

      <div className="space-y-3">
        {boards.map(b => (
          <div key={b.id} className="card space-y-3">
            {editing === b.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-500">Name</label><input className="input-field" value={String(editForm.name||"")} onChange={e=>setEditForm({...editForm,name:e.target.value})} /></div>
                  <div><label className="text-xs text-gray-500">Description</label><input className="input-field" value={String(editForm.description||"")} onChange={e=>setEditForm({...editForm,description:e.target.value})} /></div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div><label className="text-xs text-gray-500">SLA Response (min)</label><input className="input-field" type="number" value={Number(editForm.slaResponseMinutes)} onChange={e=>setEditForm({...editForm,slaResponseMinutes:Number(e.target.value)})} /></div>
                  <div><label className="text-xs text-gray-500">SLA Resolution (min)</label><input className="input-field" type="number" value={Number(editForm.slaResolutionMinutes)} onChange={e=>setEditForm({...editForm,slaResolutionMinutes:Number(e.target.value)})} /></div>
                  <div><label className="text-xs text-gray-500">Auto-Close Days</label><input className="input-field" type="number" value={Number(editForm.autoCloseDays)} onChange={e=>setEditForm({...editForm,autoCloseDays:Number(e.target.value)})} /></div>
                  <div><label className="text-xs text-gray-500">Follow-Up (hrs)</label><input className="input-field" type="number" value={Number(editForm.followUpIntervalHours)} onChange={e=>setEditForm({...editForm,followUpIntervalHours:Number(e.target.value)})} /></div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.autoCloseEnabled)} onChange={e=>setEditForm({...editForm,autoCloseEnabled:e.target.checked})} />Auto-close</label>
                  <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={Boolean(editForm.followUpEnabled)} onChange={e=>setEditForm({...editForm,followUpEnabled:e.target.checked})} />Follow-up emails</label>
                </div>
                <div className="flex gap-2"><button onClick={()=>saveEdit(b.id)} className="btn-primary text-sm flex items-center gap-1.5"><Save size={14}/>Save</button><button onClick={()=>setEditing(null)} className="btn-secondary text-sm flex items-center gap-1.5"><X size={14}/>Cancel</button></div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-white">{b.name}</h3>
                    {b.description && <p className="text-sm text-gray-500 mt-0.5">{b.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${b.isActive ? "bg-green-400" : "bg-gray-600"}`} />
                    <button onClick={() => startEdit(b)} className="text-xs text-cyber-400 hover:text-cyber-300">Edit</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-400">
                  <div><span className="text-gray-600">SLA Response:</span> {b.slaResponseMinutes}m</div>
                  <div><span className="text-gray-600">SLA Resolution:</span> {b.slaResolutionMinutes}m</div>
                  <div><span className="text-gray-600">Auto-Close:</span> {b.autoCloseEnabled ? `${b.autoCloseDays}d` : "Off"}</div>
                  <div><span className="text-gray-600">Follow-Up:</span> {b.followUpEnabled ? `Every ${b.followUpIntervalHours}h` : "Off"}</div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()} onSubmit={createBoard}>
            <h3 className="text-lg font-semibold text-white">Create Service Board</h3>
            <input className="input-field" placeholder="Board name" value={newBoard.name} onChange={e => setNewBoard({ ...newBoard, name: e.target.value })} required autoFocus />
            <textarea className="input-field" placeholder="Description (optional)" value={newBoard.description} onChange={e => setNewBoard({ ...newBoard, description: e.target.value })} rows={2} />
            <div className="flex gap-2 justify-end"><button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="btn-primary">Create</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Administration Landing Page
// ────────────────────────────────────────────────────────────────────

export function AdministrationPage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Administration</h2>
        <p className="text-sm text-gray-400 mt-0.5">System configuration, service boards, and monitoring</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/admin/boards" className="card hover:border-cyber-500/30 transition-colors group">
          <Columns3 size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Service Boards</h3>
          <p className="text-sm text-gray-500 mt-1">Configure boards, SLA policies, email connectors, and automations</p>
        </Link>
        <Link to="/integrations" className="card hover:border-cyber-500/30 transition-colors group">
          <Plug size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Integrations</h3>
          <p className="text-sm text-gray-500 mt-1">Manage third-party service connections and API keys</p>
        </Link>
        <Link to="/users" className="card hover:border-cyber-500/30 transition-colors group">
          <Users size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Users & Roles</h3>
          <p className="text-sm text-gray-500 mt-1">Manage users, assign roles, and configure permissions</p>
        </Link>
        <Link to="/admin/logs" className="card hover:border-cyber-500/30 transition-colors group">
          <FileText size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">Audit Logs</h3>
          <p className="text-sm text-gray-500 mt-1">View all cumulative changes, edits, and system updates</p>
        </Link>
        <Link to="/settings" className="card hover:border-cyber-500/30 transition-colors group">
          <Settings size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">System Settings</h3>
          <p className="text-sm text-gray-500 mt-1">General application settings, locale, and currency configuration</p>
        </Link>
        <Link to="/settings/ai" className="card hover:border-cyber-500/30 transition-colors group">
          <Activity size={22} className="text-cyber-400 mb-2" />
          <h3 className="font-semibold text-white group-hover:text-cyber-400 transition-colors">AI Engine</h3>
          <p className="text-sm text-gray-500 mt-1">Configure AI providers for ticket suggestions and pattern detection</p>
        </Link>
      </div>
    </div>
  );
}
