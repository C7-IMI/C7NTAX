import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import { InferencePanel } from "../components/InferencePanel";
import { Plus, Search, Save, X, Clock, Edit3, Timer, Send, Home, ChevronRight, Filter, ChevronDown, CheckSquare, Square, RotateCw, MessageSquare, Mail, Paperclip, Printer, Bell, MoreHorizontal, Link2, Package, Wrench, History, Receipt, ShieldCheck, Download, Trash2, FileText, User, Columns3, GripVertical } from "lucide-react";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400", in_progress: "bg-cyber-600/20 text-cyber-400",
  waiting_on_client: "bg-amber-600/20 text-amber-400", on_hold: "bg-purple-600/20 text-purple-400",
  resolved: "bg-green-600/20 text-green-400", closed: "bg-gray-600/20 text-gray-400", cancelled: "bg-red-600/20 text-red-400",
  pending_approval: "bg-yellow-600/20 text-yellow-400",
};
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400", high: "bg-orange-600/20 text-orange-400",
  medium: "bg-amber-600/20 text-amber-400", low: "bg-gray-600/20 text-gray-400",
};

const BATCH_ACTIONS = [
  { value: "acknowledge", label: "Acknowledge", icon: CheckSquare },
  { value: "close", label: "Close", icon: X },
  { value: "status_in_progress", label: "Set Status → In Progress" },
  { value: "status_waiting_client", label: "Set Status → Waiting on Client" },
  { value: "status_on_hold", label: "Set Status → On Hold" },
  { value: "status_resolved", label: "Set Status → Resolved" },
  { value: "priority_high", label: "Set Priority → High" },
  { value: "priority_critical", label: "Set Priority → Critical" },
];

const TICKET_STATUSES = ["new","in_progress","waiting_on_client","on_hold","pending_approval","resolved","closed","cancelled"];
const TICKET_PRIORITIES = ["low","medium","high","critical"];

// ── Configurable ticket list columns (PSA-style: Autotask / ConnectWise / HaloPSA reference) ──
// Priority is available but unchecked by default.
type TicketColumnDef = { id: string; label: string; defaultVisible: boolean; sortField?: string };
const TICKET_COLUMNS: TicketColumnDef[] = [
  { id: "number", label: "Ticket #", defaultVisible: true, sortField: "ticketNumber" },
  { id: "title", label: "Summary", defaultVisible: true, sortField: "title" },
  { id: "status", label: "Status", defaultVisible: true, sortField: "status" },
  { id: "board", label: "Board", defaultVisible: true, sortField: "board.name" },
  { id: "client", label: "Client", defaultVisible: true, sortField: "company.name" },
  { id: "technician", label: "Technician", defaultVisible: true },
  { id: "priority", label: "Priority", defaultVisible: false },
  { id: "timestamp", label: "Timestamp", defaultVisible: true, sortField: "updatedAt" },
];

function loadTicketColumns(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("c7_ticket_columns") || "null");
    if (Array.isArray(v) && v.length > 0) return v.filter((id) => TICKET_COLUMNS.some((c) => c.id === id));
  } catch { /* ignore */ }
  return TICKET_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
}

// ── Ticket detail tabs (ConnectWise-style toolbar; Tasks/Open Tickets/Conversions/Surveys/RMA excluded) ──
const TICKET_DETAIL_TABS = [
  { id: "ticket", label: "Ticket" },
  { id: "configurations", label: "Configurations" },
  { id: "products", label: "Products" },
  { id: "activities", label: "Activities" },
  { id: "time", label: "Time" },
  { id: "links", label: "Links" },
  { id: "expenses", label: "Expenses" },
  { id: "schedule", label: "Schedule" },
  { id: "attachments", label: "Attachments" },
  { id: "history", label: "History" },
  { id: "finance", label: "Finance" },
  { id: "audittrail", label: "Audit Trail" },
];

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const boardId = searchParams.get("boardId") || "";
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", priority:"medium", boardId:"", companyId:"", contactId:"", contactName:"", contactEmail:"", startTime:"", endTime:"", status:"new" });
  const [sort, setSort] = useState<SortState | null>(null);
  const [boards, setBoards] = useState<Array<{id:string;name:string}>>([]);
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const [contacts, setContacts] = useState<Array<{id:string;firstName:string;lastName:string;email:string}>>([]);

  // ── Batch selection ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDropdown, setBatchDropdown] = useState(false);
  const [batchApplying, setBatchApplying] = useState(false);
  const [checkedActions, setCheckedActions] = useState<Set<string>>(new Set());
  const [quickOpen, setQuickOpen] = useState(false);

  // ── Filter dialog ──
  const [showFilter, setShowFilter] = useState(false);
  const [filterForm, setFilterForm] = useState<Record<string,string>>({ status: "", priority: "", assignedToId: "", dateFrom: "", dateTo: "" });
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);

  // ── Column display state (Choose Columns + drag reorder, persisted per user) ──
  const [visibleColumns, setVisibleColumns] = useState<string[]>(loadTicketColumns);
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);

  const saveColumns = (cols: string[]) => { setVisibleColumns(cols); localStorage.setItem("c7_ticket_columns", JSON.stringify(cols)); };
  const toggleColumn = (id: string) => { saveColumns(visibleColumns.includes(id) ? visibleColumns.filter((c) => c !== id) : [...visibleColumns, id]); };
  const moveColumn = (from: string, to: string) => {
    const a = [...visibleColumns]; const fi = a.indexOf(from); const ti = a.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    a.splice(fi, 1); a.splice(ti, 0, from); saveColumns(a);
  };

  const renderTicketCell = (t: any, colId: string) => {
    switch (colId) {
      case "number": return <td key={colId} className="px-2 py-3"><Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 font-medium">{t.ticketNumber}</Link></td>;
      case "title": return <td key={colId} className="px-3 py-3"><Link to={`/tickets/${t.id}`} className="text-gray-300 hover:text-white text-sm leading-snug">{t.title}</Link></td>;
      case "status": return <td key={colId} className="px-3 py-3"><span className={`badge ${STATUS_COLORS[t.status]||""}`}>{(t.status)?.replace(/_/g," ")}</span>{t.isOverdue ? <span className="badge bg-red-600/20 text-red-400 ml-1.5">OVERDUE</span> : null}</td>;
      case "board": return <td key={colId} className="px-3 py-3 text-gray-400 text-xs">{(t.board as {name?:string})?.name||"-"}</td>;
      case "client": return <td key={colId} className="px-3 py-3 text-gray-400">{(t.company as {name?:string})?.name||"-"}</td>;
      case "technician": return <td key={colId} className="px-3 py-3 text-gray-300 text-sm">{t.assignedTo ? `${(t.assignedTo as {firstName?:string;lastName?:string}).firstName||""} ${(t.assignedTo as {firstName?:string;lastName?:string}).lastName||""}`.trim() || "-" : "-"}</td>;
      case "priority": return <td key={colId} className="px-3 py-3"><span className="badge bg-surface-lighter text-gray-300 capitalize">{t.priority || "medium"}</span></td>;
      case "timestamp": {
        const created = t.createdAt ? new Date(t.createdAt) : null;
        const updated = t.updatedAt ? new Date(t.updatedAt) : null;
        const changed = created && updated && updated.getTime() > created.getTime();
        return (
          <td key={colId} className="px-3 py-3 text-gray-500 text-xs"
            title={changed ? `Created ${created!.toLocaleString()} · Last updated ${updated!.toLocaleString()}` : `Created ${created?.toLocaleString() || "-"}`}>
            {changed ? updated!.toLocaleString() : (created?.toLocaleString() || "-")}
          </td>
        );
      }
      default: return null;
    }
  };

  const fetchBoards = () => { api.get("/boards").then(r=>setBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{}); };

  const fetchTickets = () => {
    let url = "/tickets?limit=200";
    if (boardId) url += `&boardId=${boardId}`;
    // Apply active filters
    if (filterForm.status) url += `&status=${filterForm.status}`;
    if (filterForm.priority) url += `&priority=${filterForm.priority}`;
    if (filterForm.assignedToId) url += `&assignedToId=${filterForm.assignedToId}`;
    if (filterForm.dateFrom) url += `&dateFrom=${filterForm.dateFrom}`;
    if (filterForm.dateTo) url += `&dateTo=${filterForm.dateTo}`;
    api.get(url).then(r=>setTickets(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(()=>{fetchBoards();fetchTickets();},[boardId]);
  useEffect(()=>{api.get("/users?limit=200").then(r=>setUsers(r.data.data||[])).catch(()=>{});},[]);

  // Auto-open new ticket form when navigated from contact
  useEffect(() => {
    const isNew = searchParams.get("new") === "1";
    if (isNew) {
      const cId = searchParams.get("companyId") || "";
      const cName = searchParams.get("contactName") || "";
      const cEmail = searchParams.get("contactEmail") || "";
      setForm(prev => ({ ...prev, companyId: cId, contactName: cName, contactEmail: cEmail, title: cName ? `Ticket for ${cName}` : "", description: cEmail ? `Contact: ${cName} (${cEmail})` : "" }));
      api.get("/clients?limit=100").then(r => setCompanies(r.data?.data || [])).catch(() => {});
      if (cId) { api.get(`/clients/contacts?companyId=${cId}`).then(r => { const cons = r.data?.data || r.data || []; setContacts(cons); const match = cons.find((c: { email: string }) => c.email === cEmail); if (match) setForm(prev => ({ ...prev, contactId: match.id })); }).catch(() => {}); }
      setShowNew(true);
    }
  }, [searchParams]);

  const handleCompanyChange = (cId: string) => {
    setForm(prev => ({ ...prev, companyId: cId, contactName: "", contactEmail: "" }));
    if (cId) { api.get(`/clients/contacts?companyId=${cId}`).then(r => setContacts(r.data?.data || r.data || [])).catch(() => {}); }
    else { setContacts([]); }
  };

  const openNew = async () => {
    try { const cR=await api.get("/clients?limit=50"); setCompanies(cR.data?.data||[]); } catch {}
    setForm(prev=>({...prev, boardId: boardId || ""}));
    setShowNew(true);
  };
  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/tickets",form); toast.success("Ticket created"); setShowNew(false); setForm({title:"",description:"",priority:"medium",boardId:"",companyId:"",contactId:"",contactName:"",contactEmail:"",startTime:"",endTime:"",status:"new"}); fetchTickets(); }
    catch { toast.error("Failed"); }
  };

  // ── Batch actions ──
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.size === tickets.length ? new Set() : new Set(tickets.map(t => t.id)));
  };
  const applyBatchAction = async (action: string) => {
    if (selectedIds.size === 0) return false;
    try {
      const ids = [...selectedIds];
      let status: string | undefined;
      let priority: string | undefined;
      if (action === "acknowledge") status = "in_progress";
      else if (action === "close") status = "closed";
      else if (action.startsWith("status_")) status = action.replace("status_", "");
      else if (action.startsWith("priority_")) priority = action.replace("priority_", "");

      const payload: any = { ticketIds: ids };
      if (status) payload.status = status;
      if (priority) payload.priority = priority;

      await api.post("/tickets/batch", payload);
      return true;
    } catch { return false; }
  };

  const batchApplyChecked = async () => {
    if (selectedIds.size === 0 || checkedActions.size === 0) return;
    setBatchApplying(true);
    let success = 0;
    let fail = 0;
    for (const action of checkedActions) {
      const ok = await applyBatchAction(action);
      if (ok) success++; else fail++;
    }
    setBatchApplying(false);
    if (success > 0) toast.success(`Applied ${success} action${success!==1?"s":""} to ${selectedIds.size} ticket${selectedIds.size!==1?"s":""}`);
    if (fail > 0) toast.error(`${fail} action${fail!==1?"s":""} failed`);
    setSelectedIds(new Set());
    setCheckedActions(new Set());
    fetchTickets();
  };

  // ── Quick Actions: apply one action to all selected tickets ──
  const quickApply = async (action: string) => {
    if (selectedIds.size === 0) return;
    setQuickOpen(false);
    setBatchApplying(true);
    const ok = await applyBatchAction(action);
    setBatchApplying(false);
    if (ok) toast.success(`Applied to ${selectedIds.size} ticket${selectedIds.size !== 1 ? "s" : ""}`);
    else toast.error("Failed to apply action");
    setSelectedIds(new Set());
    fetchTickets();
  };

  // ── Individual ticket action ──
  const ticketAction = async (ticketId: string, action: string) => {
    try {
      if (action === "close") {
        await api.patch(`/tickets/${ticketId}`, { status: "closed" });
      } else if (action === "acknowledge") {
        await api.patch(`/tickets/${ticketId}`, { status: "in_progress" });
      } else if (action.startsWith("status_")) {
        await api.patch(`/tickets/${ticketId}`, { status: action.replace("status_", "") });
      } else if (action.startsWith("priority_")) {
        await api.patch(`/tickets/${ticketId}`, { priority: action.replace("priority_", "") });
      }
      toast.success("Updated");
      fetchTickets();
    } catch { toast.error("Failed"); }
  };

  // ── Filter ──
  const applyFilters = () => {
    fetchTickets();
    setShowFilter(false);
  };
  const clearFilters = () => {
    setFilterForm({ status: "", priority: "", assignedToId: "", dateFrom: "", dateTo: "" });
    setShowFilter(false);
    // re-fetch without filters
    setTimeout(() => fetchTickets(), 50);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Breadcrumb */}
      {boardId && (
        <div className="flex items-center gap-2 text-sm">
          <Link to="/boards" className="text-gray-500 hover:text-white flex items-center gap-1"><Home size={13}/></Link>
          <ChevronRight size={13} className="text-gray-600"/>
          <Link to="/boards" className="text-gray-500 hover:text-white">Service Boards</Link>
          <ChevronRight size={13} className="text-gray-600"/>
          <span className="text-white font-medium">{boards.find(b=>b.id===boardId)?.name||"Board"}</span>
        </div>
      )}
      <div>
        <h2 className="text-lg font-semibold text-white">Tickets</h2>
        <p className="text-sm text-gray-400">{boardId ? `Filtered by board` : "Manage service tickets"}</p>
      </div>

      {/* Toolbar: board selector + Create on the left, Filter + Choose Columns on the right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            className="input-field text-sm py-1.5"
            value={boardId}
            onChange={e=>{setSearchParams(e.target.value?{boardId:e.target.value}:{});}}
          >
            <option value="">All Boards</option>
            {boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={openNew} className="btn-primary flex items-center gap-2"><Plus size={16}/>Create</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => { if (selectedIds.size > 0) setQuickOpen(!quickOpen); }}
              disabled={selectedIds.size === 0}
              title={selectedIds.size === 0 ? "Select one or more tickets to enable" : "Quick Actions"}
              className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronDown size={14} /><Wrench size={14} /> Quick Actions
            </button>
            {quickOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setQuickOpen(false)} />
                <div className="absolute left-0 top-full mt-1 w-max bg-navy-800 border border-surface-border rounded-lg shadow-xl z-50 py-1">
                  <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase font-semibold">Quick Actions</div>
                  <button onClick={() => quickApply("acknowledge")} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Acknowledge</button>
                  <button onClick={() => quickApply("close")} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Close</button>
                  <div className="border-t border-surface-border my-1" />
                  {TICKET_STATUSES.filter(s => s !== "closed" && s !== "cancelled").slice(0,5).map(s => (
                    <button key={s} onClick={() => quickApply(`status_${s}`)} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Set Status → {s.replace(/_/g, " ")}</button>
                  ))}
                  <div className="border-t border-surface-border my-1" />
                  {TICKET_PRIORITIES.map(p => (
                    <button key={p} onClick={() => quickApply(`priority_${p}`)} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Priority → {p}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowFilter(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Filter size={14} /> Filter
          </button>
          <button onClick={() => setShowColumnModal(true)} className="btn-secondary text-xs flex items-center gap-1.5"><Columns3 size={14} /> Choose Columns</button>
        </div>
      </div>

      {/* ── Filter Dialog ── */}
      {showFilter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFilter(false)}>
          <div className="card w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Filter Tickets</h3>
              <button onClick={() => setShowFilter(false)} className="text-gray-500 hover:text-white"><X size={18}/></button>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <select className="input-field" value={filterForm.status} onChange={e => setFilterForm({...filterForm, status: e.target.value})}>
                <option value="">Any</option>
                {TICKET_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Priority</label>
              <select className="input-field" value={filterForm.priority} onChange={e => setFilterForm({...filterForm, priority: e.target.value})}>
                <option value="">Any</option>
                {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">Assigned Technician</label>
              <select className="input-field" value={filterForm.assignedToId} onChange={e => setFilterForm({...filterForm, assignedToId: e.target.value})}>
                <option value="">Any</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date From</label>
                <input className="input-field" type="date" value={filterForm.dateFrom} onChange={e => setFilterForm({...filterForm, dateFrom: e.target.value})} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Date To</label>
                <input className="input-field" type="date" value={filterForm.dateTo} onChange={e => setFilterForm({...filterForm, dateTo: e.target.value})} />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border">
              <button onClick={clearFilters} className="btn-secondary text-sm">Clear</button>
              <button onClick={applyFilters} className="btn-primary text-sm">Apply Filters</button>
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowNew(false)}>
          <form className="card w-full max-w-2xl mx-4 space-y-3 max-h-[92vh] overflow-y-auto" onClick={e=>e.stopPropagation()} onSubmit={handleCreate}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Ticket</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white"><X size={18}/></button></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Company <span className="text-red-400">*</span></label><select className="input-field" value={form.companyId} onChange={e=>handleCompanyChange(e.target.value)} required><option value="">Select company...</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact</label><select className="input-field" value={form.contactId || `${form.contactName}|${form.contactEmail}`} onChange={e=>{const v = e.target.value; if (v.includes("|")) { const [name,email] = v.split("|"); setForm({...form, contactId:"", contactName:name||"", contactEmail:email||""}); } else { const c = contacts.find(x=>x.id===v); setForm({...form, contactId:v, contactName:c?`${c.firstName} ${c.lastName}`:"", contactEmail:c?.email||""}); }}}><option value="">Select contact...</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}<option value={`${form.contactName}|${form.contactEmail}`}>{form.contactName && !contacts.length ? form.contactName : ""}</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Board / Queue <span className="text-red-400">*</span></label><select className="input-field" value={form.boardId} onChange={e=>setForm({...form,boardId:e.target.value})} required><option value="">Select board...</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="new">New</option><option value="in_progress">In Progress</option><option value="waiting_on_client">Waiting on Client</option><option value="on_hold">On Hold</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Start / End Time</label><div className="grid grid-cols-2 gap-1"><input className="input-field text-xs" type="datetime-local" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})} placeholder="Start"/><input className="input-field text-xs" type="datetime-local" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})} placeholder="End"/></div></div>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Summary <span className="text-red-400">*</span></label><input className="input-field" placeholder="Brief summary of the issue" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required/></div>
            <div><label className="text-xs text-gray-500 block mb-1">Description</label><textarea className="input-field" placeholder="Detailed description..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={4}/></div>
            <div className="flex gap-2 justify-end pt-2 border-t border-surface-border"><button type="button" className="btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button><button type="submit" className="btn-primary flex items-center gap-1.5"><Save size={14}/>Create Ticket</button></div>
          </form>
        </div>
      )}

      <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input className="input-field pl-9" placeholder="Search tickets..."/></div>
      {/* ── Batch actions bar ── */}
      {selectedIds.size > 0 && (
        <div className="card flex items-center gap-3 bg-cyber-600/5 border-cyber-500/30">
          <span className="text-sm text-white font-medium">{selectedIds.size} selected</span>
          <div className="relative">
            <button onClick={() => { setBatchDropdown(!batchDropdown); if (!batchDropdown) setCheckedActions(new Set()); }} className="btn-primary text-sm flex items-center gap-1.5">
              Modify Selected <ChevronDown size={14} />
            </button>
            {batchDropdown && (
              <div className="absolute top-full mt-1 left-0 bg-navy-800 border border-surface-border rounded-lg shadow-xl z-50 min-w-[240px] py-1">
                <div className="max-h-64 overflow-y-auto">
                  {BATCH_ACTIONS.map(a => {
                    const checked = checkedActions.has(a.value);
                    return (
                      <label key={a.value}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          setCheckedActions(prev => { const n = new Set(prev); checked ? n.delete(a.value) : n.add(a.value); return n; });
                        }} className="rounded accent-cyber-500" />
                        <span>{a.label}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="border-t border-surface-border mt-1 pt-1 px-2 pb-1 flex gap-2">
                  <button
                    onClick={() => { setBatchDropdown(false); setCheckedActions(new Set()); }}
                    className="flex-1 text-xs py-1.5 rounded text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors">Cancel</button>
                  <button
                    onClick={() => { batchApplyChecked(); setBatchDropdown(false); }}
                    disabled={checkedActions.size === 0 || batchApplying}
                    className="flex-1 text-xs py-1.5 rounded bg-cyber-600/30 text-cyber-400 hover:bg-cyber-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                    OK{batchApplying ? "..." : ""}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-500 hover:text-white">Clear selection</button>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : tickets.length===0 ? <div className="p-8 text-center text-gray-500">No tickets</div>:(
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="group"><tr className="border-b border-surface-border text-left text-gray-400">
            <th className="px-4 py-3 w-10"><button onClick={toggleSelectAll} className="text-gray-500 hover:text-white">{selectedIds.size === tickets.length ? <CheckSquare size={16} className="text-cyber-400"/> : <Square size={16}/>}</button></th>
            {visibleColumns.map((colId) => {
              const def = TICKET_COLUMNS.find((c) => c.id === colId);
              if (!def) return null;
              return (
                <th key={colId}
                  draggable
                  onDragStart={() => setDragCol(colId)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragCol && dragCol !== colId) moveColumn(dragCol, colId); setDragCol(null); }}
                  onDragEnd={() => setDragCol(null)}
                  onClick={() => { if (def.sortField) setSort(nextSort(sort, def.sortField)); }}
                  className={`px-3 py-3 select-none ${dragCol === colId ? "opacity-50" : ""} ${def.sortField ? "cursor-pointer hover:text-white" : ""}`}
                  title={def.sortField ? "Click to sort · drag to reorder" : "Drag to reorder"}
                >
                  <span className="inline-flex items-center gap-1.5 text-xs uppercase font-semibold">{def.label} <GripVertical size={12} className="text-gray-600 cursor-grab" /></span>
                </th>
              );
            })}
            <th className="px-4 py-3 w-10"></th>
          </tr></thead>
            <tbody>{sortData(tickets as Array<Record<string,unknown>>, sort?.field || "updatedAt", sort?.direction || "desc").map((t:any)=>(<tr key={t.id} className={`border-b border-surface-border/50 hover:bg-surface-light/50 ${selectedIds.has(t.id) ? "bg-cyber-600/10" : ""}`}>
              <td className="px-4 py-3"><button onClick={() => toggleSelect(t.id)} className="text-gray-500 hover:text-white">{selectedIds.has(t.id) ? <CheckSquare size={16} className="text-cyber-400"/> : <Square size={16}/>}</button></td>
              {visibleColumns.map((colId) => renderTicketCell(t, colId))}
              <td className="px-4 py-3">
                <TicketActionMenu ticketId={t.id} currentStatus={t.status} currentPriority={t.priority} onAction={ticketAction} />
              </td>
            </tr>))}</tbody></table></div>)}
      </div>

      {showColumnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowColumnModal(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Choose Columns</h3>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {TICKET_COLUMNS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer py-1">
                  <input type="checkbox" checked={visibleColumns.includes(c.id)} onChange={() => toggleColumn(c.id)} className="accent-cyber-500" />
                  {c.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">Drag column headers to reorder. Column visibility and order are saved per user.</p>
            <div className="flex justify-end mt-4"><button className="btn-primary text-sm px-3 py-1.5" onClick={() => setShowColumnModal(false)}>Done</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Individual ticket "Quick Actions" dropdown menu (portal + fixed at far left so it never clips) ──
function TicketActionMenu({ ticketId, currentStatus, currentPriority, onAction }: {
  ticketId: string; currentStatus: string; currentPriority: string;
  onAction: (id: string, action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 420) });
    }
    setOpen(o => !o);
  };
  return (
    <div className="relative">
      <button ref={btnRef} onClick={toggle} className="text-gray-500 hover:text-white p-1 rounded" title="Quick Actions">
        <ChevronDown size={14} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 py-1 min-w-[200px] bg-navy-800 border border-surface-border rounded-lg shadow-xl" style={{ top: pos?.top ?? 0, left: 8 }}>
            <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase font-semibold">Quick Actions</div>
            {currentStatus !== "in_progress" && (
              <button onClick={() => { onAction(ticketId, "acknowledge"); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Acknowledge</button>
            )}
            {currentStatus !== "closed" && (
              <button onClick={() => { onAction(ticketId, "close"); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Close</button>
            )}
            <div className="border-t border-surface-border my-1" />
            {TICKET_STATUSES.filter(s => s !== currentStatus && s !== "closed" && s !== "cancelled").slice(0,5).map(s => (
              <button key={s} onClick={() => { onAction(ticketId, `status_${s}`); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Set Status → {s.replace(/_/g, " ")}</button>
            ))}
            <div className="border-t border-surface-border my-1" />
            {TICKET_PRIORITIES.filter(p => p !== currentPriority).map(p => (
              <button key={p} onClick={() => { onAction(ticketId, `priority_${p}`); setOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-surface-lighter hover:text-white">Priority → {p}</button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<Record<string,unknown>|null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [posting, setPosting] = useState(false);
  const [showTimeEntry, setShowTimeEntry] = useState(false);
  const [timeForm, setTimeForm] = useState({ startTime: "", endTime: "", calculated: "", description: "", billable: true });
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const [contacts, setContacts] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);
  const [agreements, setAgreements] = useState<Array<{id:string;name:string;billingPeriod:string;billingAmount:number}>>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<Record<string,unknown>|null>(null);
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);
  const [allBoards, setAllBoards] = useState<Array<{id:string;name:string}>>([]);

  // ── Friendly display for machine-generated change-log comments ──
  // Legacy change comments contain raw UUIDs, ISO dates, and enum codes like
  // "Board: 81f12ded-... → 9e4422d8-..." or "Due Date: 2026-08-13T06:04 → ...".
  // Resolve them to friendly names using loaded lookups + ticket relations.
  const friendlyActivityBody = (body: string): string => {
    if (!body) return "";
    // Only transform machine-generated change-log lines ("Label: old → new")
    if (!/^[A-Z][A-Za-z ]+: .+ → .+/m.test(body)) return body;

    const uuidMap: Record<string, string> = {};
    for (const b of allBoards) uuidMap[b.id] = b.name;
    for (const u of users) uuidMap[u.id] = `${u.firstName||""} ${u.lastName||""}`.trim();
    for (const c of companies) uuidMap[c.id] = c.name;
    for (const c of contacts) uuidMap[c.id] = `${c.firstName||""} ${c.lastName||""}`.trim();
    for (const a of agreements) uuidMap[a.id] = a.name;
    const t = ticket as any;
    if (t?.board?.id && t?.board?.name) uuidMap[t.board.id] = t.board.name;
    if (t?.company?.id && t?.company?.name) uuidMap[t.company.id] = t.company.name;
    if (t?.assignedTo?.id) uuidMap[t.assignedTo.id] = `${t.assignedTo.firstName||""} ${t.assignedTo.lastName||""}`.trim();
    if (t?.contact?.id) uuidMap[t.contact.id] = `${t.contact.firstName||""} ${t.contact.lastName||""}`.trim();
    if (t?.serviceAgreement?.id && t?.serviceAgreement?.name) uuidMap[t.serviceAgreement.id] = t.serviceAgreement.name;

    return body
      // ISO timestamps → "Aug 13, 2026, 6:04 AM"
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?/g, m => {
        const d = new Date(m);
        return isNaN(d.getTime()) ? m : d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      })
      // UUIDs → resolved friendly names
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, m => uuidMap[m] || m)
      // snake_case enums → Title Case
      .replace(/\b(in_progress|waiting_on_client|on_hold|pending_approval)\b/g, m => m.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
  };

  // ── Tabbed toolbar state ──
  const [activeTab, setActiveTab] = useState("ticket");
  const [cf, setCf] = useState<Record<string, any>>({});
  const [expenses, setExpenses] = useState<any[]>([]);
  const [schedEntries, setSchedEntries] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [assetResults, setAssetResults] = useState<any[]>([]);
  const [kumoConfigResults, setKumoConfigResults] = useState<any[]>([]);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configDialogQuery, setConfigDialogQuery] = useState("");
  const [incomingLinks, setIncomingLinks] = useState<any[]>([]);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [productForm, setProductForm] = useState({ name: "", qty: 1, unitCost: 0 });
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkRel, setLinkRel] = useState("related");
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ description: "", amount: "", category: "other", expenseDate: "" });
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ title: "", startTime: "", endTime: "", location: "" });
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [attachForm, setAttachForm] = useState<{ file: File | null }>({ file: null });
  const [showTimeTabAdd, setShowTimeTabAdd] = useState(false);

  const cfArr = (key: string): any[] => Array.isArray(cf[key]) ? cf[key] : [];
  const persistCF = async (key: string, value: any[]) => {
    const next = { ...cf, [key]: value };
    setCf(next);
    try { await api.patch(`/tickets/${id}`, { customFields: next }); }
    catch { toast.error("Save failed"); }
  };
  const uuidish = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  useEffect(() => {
    if (activeTab === "expenses") api.get("/billing/expenses").then(r => setExpenses((r.data?.data || r.data || []).filter((e: any) => e.ticketId === id))).catch(() => {});
    if (activeTab === "schedule") api.get("/schedule?limit=200").then(r => setSchedEntries((Array.isArray(r.data) ? r.data : (r.data?.data || [])).filter((e: any) => e.ticketId === id))).catch(() => {});
    if (activeTab === "audittrail") api.get("/system/audit-logs").then(r => setAuditEntries((r.data?.data || []).filter((a: any) => a.entity === "ticket" && a.entityId === id))).catch(() => {});
    if (activeTab === "configurations") { api.get("/kumo/assets?limit=50").then(r => setAssetResults(r.data?.data || r.data || [])).catch(() => {}); api.get("/kumo/configs/servers").then(r => setKumoConfigResults(r.data?.data || r.data || [])).catch(() => {}); }
    if (activeTab === "links") { api.get("/tickets?limit=200").then(r => { const all = r.data?.data || []; setIncomingLinks(all.filter((t: any) => t.id !== id && Array.isArray(t.customFields?.ticketLinks) && t.customFields.ticketLinks.some((l: any) => l.ticketId === id)).map((t: any) => ({ ticketId: t.id, ticketNumber: t.ticketNumber, title: t.title }))); }).catch(() => {}); }
  }, [activeTab, id]);

  const load = () => {
    if(!id) return;
    api.get(`/tickets/${id}`).then(r=>{
      const t = r.data;
      setTicket(t);
      setCf(t.customFields && typeof t.customFields === "object" && !Array.isArray(t.customFields) ? t.customFields : {});
      setEditForm({
        title: t.title||"", description: t.description||"", status: t.status||"new", priority: t.priority||"medium",
        dueDate: t.dueDate?new Date(t.dueDate).toISOString().slice(0,16):"",
        startTime: t.startTime?new Date(t.startTime).toISOString().slice(0,16):"",
        endTime: t.endTime?new Date(t.endTime).toISOString().slice(0,16):"",
        companyId: t.companyId||"", contactId: t.contactId||"", assignedToId: t.assignedToId||"",
        serviceAgreementId: t.serviceAgreementId||"", boardId: t.boardId||"",
      });
      setSelectedAgreement(t.serviceAgreement||null);
      if(t.companyId){api.get(`/clients/contacts?companyId=${t.companyId}`).then(r=>setContacts(r.data?.data||r.data||[])).catch(()=>{});api.get(`/clients/${t.companyId}/agreements`).then(r=>setAgreements(r.data?.data||r.data||[])).catch(()=>{});}
    }).catch(()=>toast.error("Ticket not found"));
  };

  useEffect(()=>{load();api.get("/clients?limit=100").then(r=>setCompanies(r.data?.data||r.data||[])).catch(()=>{});api.get("/users?limit=100").then(r=>setUsers(r.data?.data||r.data||[])).catch(()=>{});api.get("/boards").then(r=>setAllBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{});},[id]);

  const handleCompanyChange = (cId: string) => {
    setEditForm(prev=>({...prev,companyId:cId,contactId:""}));
    if(cId){api.get(`/clients/contacts?companyId=${cId}`).then(r=>setContacts(r.data?.data||r.data||[])).catch(()=>{});api.get(`/clients/${cId}/agreements`).then(r=>setAgreements(r.data?.data||r.data||[])).catch(()=>{});}
    else{setContacts([]);setAgreements([]);}
  };

  const handleSave = async () => {
    setSaving(true);
    try{await api.patch(`/tickets/${id}`,editForm);setEditing(false);load();toast.success("Saved");}
    catch{toast.error("Save failed");}
    finally{setSaving(false);}
  };

  const handlePostNote = async (e?: React.FormEvent) => {
    if(e)e.preventDefault();
    if(!noteText.trim())return;
    setPosting(true);
    try{await api.post(`/tickets/${id}/comments`,{body:noteText});setNoteText("");load();toast.success("Posted");}
    catch{toast.error("Failed");}
    finally{setPosting(false);}
  };

  const handleTimeEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    let mins = 0;
    if (timeForm.startTime && timeForm.endTime) {
      mins = Math.round((new Date(timeForm.endTime).getTime() - new Date(timeForm.startTime).getTime()) / 60000);
    }
    try{await api.post(`/tickets/${id}/time`, { ...timeForm, minutes: mins || undefined, date: new Date().toISOString().slice(0,10) });
      toast.success("Time logged"); setShowTimeEntry(false);
      setTimeForm({ startTime: "", endTime: "", calculated: "", description: "", billable: true });
      load();
    } catch { toast.error("Failed"); }
  };

  const calcDuration = () => {
    if (timeForm.startTime && timeForm.endTime) {
      const mins = Math.round((new Date(timeForm.endTime).getTime() - new Date(timeForm.startTime).getTime()) / 60000);
      const h = Math.floor(mins / 60), m = mins % 60;
      setTimeForm(prev => ({ ...prev, calculated: `${h}h ${m}m` }));
    }
  };

  if(!ticket) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/tickets" className="text-sm text-gray-500 hover:text-white">Tickets</Link>
            <ChevronRight size={14} className="text-gray-600"/>
            <h2 className="text-lg font-semibold text-white">{(ticket.ticketNumber as string) || `Ticket #${id}`}</h2>
          </div>
          <p className="text-sm text-gray-400 mt-0.5">{(ticket.title as string)?.slice(0, 80)}</p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (<>
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">{saving?"Saving...":"Save"}</button>
          </>) : (
            <button onClick={() => setEditing(true)} className="btn-secondary text-sm flex items-center gap-1"><Edit3 size={14}/>Edit</button>
          )}
        </div>
      </div>

      {/* ── Full-width toolbar card: tabs + icon actions (ConnectWise-style) ── */}
      <div className="card p-3 space-y-2">
        {/* Tab strip */}
        <div className="flex items-center gap-0 overflow-x-auto whitespace-nowrap border-b border-surface-border pb-1.5">
          {TICKET_DETAIL_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`shrink-0 px-2 py-1 text-xs font-medium rounded-t border-b-2 -mb-px transition-colors ${
                activeTab === t.id
                  ? "border-cyber-500 text-cyber-400 bg-surface-lighter"
                  : "border-transparent text-gray-400 hover:text-white hover:bg-surface-lighter"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Icon toolbar */}
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => load()} title="Refresh" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><RotateCw size={16} /></button>
          <button onClick={() => setActiveTab("ticket")} title="Add Note" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><MessageSquare size={16} /></button>
          <button onClick={() => { setActiveTab("time"); setShowTimeTabAdd(true); }} title="Log Time" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Timer size={16} /></button>
          <button onClick={() => { setActiveTab("attachments"); setShowAttachDialog(true); }} title="Attach File" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Paperclip size={16} /></button>
          <button onClick={() => toast("Email integration coming soon")} title="Email Contact (placeholder)" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Mail size={16} /></button>
          <button onClick={() => toast("Print coming soon")} title="Print (placeholder)" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Printer size={16} /></button>
          <button onClick={() => toast("Follow-up coming soon")} title="Follow Up (placeholder)" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><Bell size={16} /></button>
          <button onClick={() => toast("More actions coming soon")} title="More Actions (placeholder)" className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"><MoreHorizontal size={16} /></button>
        </div>
      </div>

      {activeTab === "ticket" && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* General */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">General</h3>
            <div className="grid grid-cols-2 gap-3">
              {editing ? (<>
                <div><label className="text-xs text-gray-500 block mb-1">Summary</label><input className="input-field text-sm" value={editForm.title||""} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">Description</label><textarea className="input-field text-sm" rows={3} value={editForm.description||""} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></div>
              </>) : (<>
                <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Summary</label><p className="text-white text-sm">{ticket.title as string||"-"}</p></div>
                {ticket.description ? <div className="col-span-2"><label className="text-xs text-gray-500 block mb-1">Description</label><p className="text-gray-300 text-sm whitespace-pre-wrap">{(ticket.description as string)}</p></div> : null}
              </>)}
            </div>
          </div>

          {/* Dates & Times */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Dates & Times</h3>
              <button onClick={() => setShowTimeTabAdd(true)} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Timer size={12}/> Add Time Entry</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {editing ? (<>
                <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><input className="input-field text-xs" type="datetime-local" value={editForm.startTime||""} onChange={e=>setEditForm({...editForm,startTime:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">End Time</label><input className="input-field text-xs" type="datetime-local" value={editForm.endTime||""} onChange={e=>setEditForm({...editForm,endTime:e.target.value})}/></div>
                <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><input className="input-field text-xs" type="datetime-local" value={editForm.dueDate||""} onChange={e=>setEditForm({...editForm,dueDate:e.target.value})}/></div>
              </>) : (<>
                <div><label className="text-xs text-gray-500 block mb-1">Created</label><p className="text-white text-xs">{ticket.createdAt?new Date(ticket.createdAt as string).toLocaleString():"-"}</p></div>
                <div><label className="text-xs text-gray-500 block mb-1">Updated</label><p className="text-white text-xs">{ticket.updatedAt?new Date(ticket.updatedAt as string).toLocaleString():"-"}</p></div>
                <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><p className="text-white text-xs">{ticket.dueDate?new Date(ticket.dueDate as string).toLocaleDateString():"-"}</p></div>
                {ticket.startTime && <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><p className="text-white text-xs">{new Date(ticket.startTime as string).toLocaleString()}</p></div>}
                {ticket.endTime && <div><label className="text-xs text-gray-500 block mb-1">End Time</label><p className="text-white text-xs">{new Date(ticket.endTime as string).toLocaleString()}</p></div>}
              </>)}
            </div>
          </div>

          {/* Notes & Activity */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Notes & Activity</h3>
            <form onSubmit={handlePostNote} className="flex gap-2">
              <input className="input-field flex-1 text-sm" placeholder="Add a note... (Enter to submit)" value={noteText} onChange={e=>setNoteText(e.target.value)} />
              <button type="submit" disabled={posting || !noteText.trim()} className="btn-primary text-sm">{posting?"...":"Post"}</button>
            </form>
            <button onClick={() => setShowTimeEntry(!showTimeEntry)} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Timer size={12}/> Add Time Entry</button>
            {showTimeEntry && (
              <form onSubmit={handleTimeEntry} className="bg-surface-lighter rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input className="input-field text-xs" type="datetime-local" value={timeForm.startTime} onChange={e=>{setTimeForm({...timeForm,startTime:e.target.value});setTimeout(calcDuration,0);}} placeholder="Start"/>
                  <input className="input-field text-xs" type="datetime-local" value={timeForm.endTime} onChange={e=>{setTimeForm({...timeForm,endTime:e.target.value});setTimeout(calcDuration,0);}} placeholder="End"/>
                  <input className="input-field text-xs" readOnly value={timeForm.calculated} placeholder="Duration"/>
                </div>
                <div className="flex gap-2">
                  <input className="input-field flex-1 text-xs" placeholder="Description" value={timeForm.description} onChange={e=>setTimeForm({...timeForm,description:e.target.value})}/>
                  <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={timeForm.billable} onChange={e=>setTimeForm({...timeForm,billable:e.target.checked})} /> Billable</label>
                  <button type="submit" className="btn-primary text-xs">Save</button>
                </div>
              </form>
            )}
            <div className="space-y-3">
              {(ticket.comments as Array<Record<string,unknown>>)?.map((c:any,i:number)=>(
                <div key={c.id||i} className="flex gap-2 text-xs">
                  <span className={`badge shrink-0 mt-0.5 ${c.isEmail?"bg-purple-600/20 text-purple-400":c.isInternal?"bg-amber-600/20 text-amber-400":"bg-blue-600/20 text-blue-400"}`}>{c.isEmail?"Email":c.isInternal?"Internal":"Note"}</span>
                  <div className="min-w-0"><p className="text-gray-300 whitespace-pre-wrap">{friendlyActivityBody(c.body||c.content)}</p><p className="text-gray-600 mt-0.5">{(c.author?.firstName||c.author?.lastName) ? `${c.author.firstName||""} ${c.author.lastName||""}`.trim() : (c.fromEmail||"System")} · {c.createdAt?new Date(c.createdAt).toLocaleString():""}</p></div>
                </div>
              ))||null}
              {(ticket.timeEntries as Array<Record<string,unknown>>)?.map((te:any,i:number)=>(
                <div key={te.id||i} className="flex gap-2 text-xs">
                  <span className="badge bg-green-600/20 text-green-400 shrink-0 mt-0.5">Time</span>
                  <div className="min-w-0"><p className="text-gray-300">{te.description}{te.minutes ? ` (${Math.floor(te.minutes/60)}h ${te.minutes%60}m)` : ""} {te.billable?"· Billable":"· Non-billable"}</p><p className="text-gray-600 mt-0.5">{(te.user?.firstName||te.user?.lastName) ? `${te.user.firstName||""} ${te.user.lastName||""}`.trim() : "System"} · {(te.date||te.createdAt)?new Date((te.date||te.createdAt) as string).toLocaleString():""}</p></div>
                </div>
              ))||null}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Classification & Details</h3>
            {editing ? (<div className="space-y-2">
              <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={editForm.status||""} onChange={e=>setEditForm({...editForm,status:e.target.value})}>{TICKET_STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={editForm.priority||""} onChange={e=>setEditForm({...editForm,priority:e.target.value})}>{TICKET_PRIORITIES.map(p=><option key={p} value={p}>{p}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Board</label><select className="input-field" value={editForm.boardId||""} onChange={e=>setEditForm({...editForm,boardId:e.target.value})}><option value="">-</option>{allBoards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            </div>) : (<div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Status</span><span className={`badge ${STATUS_COLORS[ticket.status as string]||""}`}>{(ticket.status as string)?.replace(/_/g," ")}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Priority</span><span className={`badge ${PRIORITY_COLORS[ticket.priority as string]||""}`}>{ticket.priority as string}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Board</span><span className="text-white text-xs">{(ticket.board as {name?:string})?.name||"-"}</span></div>
            </div>)}
          </div>

          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Client Info</h3>
            {editing ? (<div className="space-y-2">
              <div><label className="text-xs text-gray-500 block mb-1">Company</label><select className="input-field" value={editForm.companyId||""} onChange={e=>handleCompanyChange(e.target.value)}><option value="">-</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Contact</label><select className="input-field" value={editForm.contactId||""} onChange={e=>setEditForm({...editForm,contactId:e.target.value})}><option value="">-</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Assigned To</label><select className="input-field" value={editForm.assignedToId||""} onChange={e=>setEditForm({...editForm,assignedToId:e.target.value})}><option value="">-</option>{users.map(u=><option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></div>
            </div>) : (<div className="space-y-2">
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Company</span><span className="text-white text-xs">{(ticket.company as {name?:string})?.name||"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Contact</span><span className="text-white text-xs">{ticket.contact?`${(ticket.contact as any).firstName} ${(ticket.contact as any).lastName}`:"-"}</span></div>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-500">Assigned To</span><span className="text-white text-xs">{ticket.assignedTo?`${(ticket.assignedTo as any).firstName} ${(ticket.assignedTo as any).lastName}`:"-"}</span></div>
            </div>)}
          </div>
        </div>
      </div>)}

      {/* ── Configurations tab ── */}
      {activeTab === "configurations" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Configurations</h3>
            <button onClick={() => setShowConfigDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Link Configuration</button>
          </div>
          {cfArr("ticketConfigurations").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No configurations linked to this ticket.</p>
          ) : (
            <div className="space-y-2">
              {cfArr("ticketConfigurations").map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Wrench size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{c.name}</p>
                    <p className="text-gray-500 text-[10px]">{c.type} · linked {c.linkedAt ? new Date(c.linkedAt).toLocaleString() : ""}</p>
                  </div>
                  {c.refId && <Link to={c.kind === "kumoServer" ? "/kumo/configs" : c.kind === "kumoAsset" ? `/kumo/assets/${c.refId}` : `/assets/${c.refId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>}
                  <button onClick={() => persistCF("ticketConfigurations", cfArr("ticketConfigurations").filter((x: any) => x.id !== c.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Products tab ── */}
      {activeTab === "products" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Products</h3>
            <button onClick={() => setShowProductDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Product</button>
          </div>
          {cfArr("ticketProducts").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No products on this ticket.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-2 py-2">Item</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Unit Cost</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 w-8"></th></tr></thead>
                <tbody>{cfArr("ticketProducts").map((p: any) => (
                  <tr key={p.id} className="border-b border-surface-border/50">
                    <td className="px-2 py-2 text-white text-xs">{p.name}</td>
                    <td className="px-2 py-2 text-gray-400 text-xs">{p.qty}</td>
                    <td className="px-2 py-2 text-gray-400 text-xs">${(p.unitCost || 0).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-cyber-400 text-xs font-medium">${((p.qty || 0) * (p.unitCost || 0)).toFixed(2)}</td>
                    <td className="px-2 py-2"><button onClick={() => persistCF("ticketProducts", cfArr("ticketProducts").filter((x: any) => x.id !== p.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-right text-xs text-gray-400">Total: <span className="text-white font-medium">${cfArr("ticketProducts").reduce((s: number, p: any) => s + (p.qty || 0) * (p.unitCost || 0), 0).toFixed(2)}</span></p>
            </>
          )}
        </div>
      )}

      {/* ── Activities tab ── */}
      {activeTab === "activities" && (() => {
        const acts = [
          ...((ticket.comments as any[]) || []).map((c: any) => ({ kind: c.isEmail ? "Email" : c.isInternal ? "Internal" : "Note", time: c.createdAt, text: friendlyActivityBody(c.body || c.content), by: (c.author?.firstName || c.author?.lastName) ? `${c.author.firstName || ""} ${c.author.lastName || ""}`.trim() : (c.fromEmail || "System") })),
          ...((ticket.timeEntries as any[]) || []).map((te: any) => ({ kind: "Time", time: te.date || te.createdAt, text: `${te.description || ""}${te.minutes ? ` (${Math.floor(te.minutes / 60)}h ${te.minutes % 60}m)` : ""} ${te.billable ? "· Billable" : "· Non-billable"}`, by: (te.user?.firstName || te.user?.lastName) ? `${te.user.firstName || ""} ${te.user.lastName || ""}`.trim() : "System" })),
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        return (
          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Activities</h3>
            {acts.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No activity recorded yet.</p> : (
              <div className="space-y-1.5">
                {acts.map((a, i) => (
                  <div key={i} className="flex gap-2 text-xs items-start">
                    <span className={`badge shrink-0 mt-0.5 ${a.kind === "Email" ? "bg-purple-600/20 text-purple-400" : a.kind === "Internal" ? "bg-amber-600/20 text-amber-400" : a.kind === "Time" ? "bg-green-600/20 text-green-400" : "bg-blue-600/20 text-blue-400"}`}>{a.kind}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-300 whitespace-pre-wrap">{a.text}</p>
                      <p className="text-gray-600 mt-0.5">{a.by} · {a.time ? new Date(a.time).toLocaleString() : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Time tab ── */}
      {activeTab === "time" && (() => {
        const tes = (ticket.timeEntries as any[]) || [];
        const bill = tes.filter(t => t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const non = tes.filter(t => !t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        return (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Time</h3>
              <button onClick={() => setShowTimeTabAdd(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Time Entry</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Billable</p><p className="text-white font-semibold">{Math.floor(bill / 60)}h {bill % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Non-billable</p><p className="text-white font-semibold">{Math.floor(non / 60)}h {non % 60}m</p></div>
            </div>
            {tes.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No time entries yet.</p> : (
              <div className="space-y-2">
                {tes.map((te: any) => (
                  <div key={te.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                    <Clock size={14} className="text-green-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs">{te.description}{te.minutes ? ` (${Math.floor(te.minutes / 60)}h ${te.minutes % 60}m)` : ""}</p>
                      <p className="text-gray-500 text-[10px]">{(te.user?.firstName || te.user?.lastName) ? `${te.user.firstName || ""} ${te.user.lastName || ""}`.trim() : "System"} · {(te.date || te.createdAt) ? new Date((te.date || te.createdAt) as string).toLocaleString() : ""}</p>
                    </div>
                    <span className={`badge text-[10px] ${te.billable ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{te.billable ? "Billable" : "Non-billable"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Links tab ── */}
      {activeTab === "links" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Links</h3>
            <button onClick={() => { setShowLinkDialog(true); setLinkQuery(""); setLinkResults([]); api.get("/tickets?limit=200").then(r => setLinkResults((r.data?.data || []).filter((t: any) => t.id !== id))).catch(() => {}); }} className="btn-primary text-xs flex items-center gap-1"><Link2 size={12} /> Link Ticket</button>
          </div>
          {cfArr("ticketLinks").length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No linked tickets.</p>
          ) : (
            <div className="space-y-2">
              {cfArr("ticketLinks").map((l: any) => (
                <div key={l.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Link2 size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{l.ticketNumber} — {l.title}</p>
                    <p className="text-gray-500 text-[10px] capitalize">{l.rel}</p>
                  </div>
                  <Link to={`/tickets/${l.ticketId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>
                  <button onClick={() => persistCF("ticketLinks", cfArr("ticketLinks").filter((x: any) => x.id !== l.id))} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {incomingLinks.length > 0 && (
            <>
              <p className="text-xs text-gray-500 pt-2 border-t border-surface-border">Incoming links — tickets that link to this one</p>
              <div className="space-y-2">
                {incomingLinks.map((l: any) => (
                  <div key={`in-${l.ticketId}`} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                    <Link2 size={14} className="text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{l.ticketNumber} — {l.title}</p>
                      <p className="text-gray-500 text-[10px]">links to this ticket</p>
                    </div>
                    <Link to={`/tickets/${l.ticketId}`} className="text-xs text-cyber-400 hover:text-cyber-300 shrink-0">Open</Link>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Expenses tab ── */}
      {activeTab === "expenses" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Expenses</h3>
            <button onClick={() => setShowExpenseDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Add Expense</button>
          </div>
          {expenses.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No expenses on this ticket.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-2 py-2">Description</th><th className="px-2 py-2">Category</th><th className="px-2 py-2">Date</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 w-8"></th></tr></thead>
              <tbody>{expenses.map((e: any) => (
                <tr key={e.id} className="border-b border-surface-border/50">
                  <td className="px-2 py-2 text-white text-xs">{e.description}</td>
                  <td className="px-2 py-2 text-gray-400 text-xs capitalize">{e.category}</td>
                  <td className="px-2 py-2 text-gray-400 text-xs">{new Date(e.expenseDate).toLocaleDateString()}</td>
                  <td className="px-2 py-2 text-right text-cyber-400 text-xs font-medium">${(e.amount || 0).toFixed(2)}</td>
                  <td className="px-2 py-2"><button onClick={async () => { try { await api.delete(`/billing/expenses/${e.id}`); toast.success("Deleted"); api.get("/billing/expenses").then(r => setExpenses((r.data?.data || r.data || []).filter((x: any) => x.ticketId === id))).catch(() => {}); } catch { toast.error("Failed"); } }} className="text-gray-500 hover:text-red-400"><Trash2 size={12} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Schedule tab ── */}
      {activeTab === "schedule" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Schedule</h3>
            <button onClick={() => setShowScheduleDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Plus size={12} /> Schedule Entry</button>
          </div>
          {schedEntries.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No scheduled entries for this ticket.</p> : (
            <div className="space-y-2">
              {schedEntries.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <Clock size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium">{s.title}</p>
                    <p className="text-gray-500 text-[10px]">{new Date(s.startTime).toLocaleString()} — {new Date(s.endTime).toLocaleString()}{s.location ? ` · ${s.location}` : ""}</p>
                  </div>
                  <span className="badge text-[10px] bg-cyber-600/20 text-cyber-400 capitalize">{s.status || "scheduled"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Attachments tab ── */}
      {activeTab === "attachments" && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Attachments</h3>
            <button onClick={() => setShowAttachDialog(true)} className="btn-primary text-xs flex items-center gap-1"><Paperclip size={12} /> Attach File</button>
          </div>
          {((ticket.attachments as any[]) || []).length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No attachments on this ticket.</p>
          ) : (
            <div className="space-y-2">
              {((ticket.attachments as any[]) || []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <FileText size={14} className="text-cyber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{a.filename}</p>
                    <p className="text-gray-500 text-[10px]">{a.size ? (a.size < 1024 ? `${a.size} B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1048576).toFixed(1)} MB`) : "—"} · {a.mimeType} · {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}</p>
                  </div>
                  <button onClick={() => toast("Download coming soon")} className="text-gray-500 hover:text-white"><Download size={14} /></button>
                  <button onClick={async () => { try { await api.delete(`/tickets/${id}/attachments/${a.id}`); toast.success("Deleted"); load(); } catch { toast.error("Failed"); } }} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab (field change log) ── */}
      {activeTab === "history" && (() => {
        const changes = ((ticket.comments as any[]) || []).filter((c: any) => (c.body || "").includes(" → "));
        return (
          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">History</h3>
            {changes.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No field changes recorded yet.</p> : (
              <div className="space-y-2">
                {changes.map((c: any) => (
                  <div key={c.id} className="p-2 rounded-lg bg-surface-lighter">
                    <p className="text-gray-300 text-xs whitespace-pre-wrap">{friendlyActivityBody(c.body)}</p>
                    <p className="text-gray-600 text-[10px] mt-1">{(c.author?.firstName || c.author?.lastName) ? `${c.author.firstName || ""} ${c.author.lastName || ""}`.trim() : "System"} · {c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Finance tab ── */}
      {activeTab === "finance" && (() => {
        const tes = (ticket.timeEntries as any[]) || [];
        const bill = tes.filter(t => t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const non = tes.filter(t => !t.billable).reduce((s, t) => s + (t.minutes || 0), 0);
        const expTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const prodTotal = cfArr("ticketProducts").reduce((s: number, p: any) => s + (p.qty || 0) * (p.unitCost || 0), 0);
        const sa = ticket.serviceAgreement as any;
        return (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Finance</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Billable Time</p><p className="text-white font-semibold">{Math.floor(bill / 60)}h {bill % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Non-billable</p><p className="text-white font-semibold">{Math.floor(non / 60)}h {non % 60}m</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Expenses</p><p className="text-white font-semibold">${expTotal.toFixed(2)}</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Products</p><p className="text-white font-semibold">${prodTotal.toFixed(2)}</p></div>
              <div className="bg-surface-lighter rounded-lg p-3"><p className="text-gray-500 text-xs">Agreement</p><p className="text-white font-semibold text-xs truncate">{sa?.name || "None"}</p></div>
            </div>
            {sa && <div className="flex items-center justify-between text-xs"><span className="text-gray-500">Agreement amount</span><span className="text-white">${(sa.billingAmount || 0).toFixed(2)} / {sa.billingPeriod || "period"}</span></div>}
            <div className="flex gap-2 pt-1 border-t border-surface-border">
              <Link to="/billing" className="btn-secondary text-xs">View Invoices</Link>
              <Link to={`/billing/time`} className="btn-secondary text-xs">Time & Expenses</Link>
            </div>
          </div>
        );
      })()}

      {/* ── Audit Trail tab ── */}
      {activeTab === "audittrail" && (
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Audit Trail</h3>
          {auditEntries.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">No audit records for this ticket.</p> : (
            <div className="space-y-1.5">
              {auditEntries.map((a: any) => {
                const fields = Object.keys(a.changes || {}).map(k => k.replace(/([A-Z])/g, " $1").toLowerCase().trim()).join(", ");
                return (
                  <div key={a.id} className="flex items-start gap-3 py-1 text-xs">
                    <div className="shrink-0 text-gray-600 font-mono w-20">{new Date(a.createdAt).toLocaleTimeString()}</div>
                    <span className="badge bg-cyber-600/20 text-cyber-400 shrink-0">{(a.action || "").replace(/:/g, " → ")}</span>
                    <span className="text-gray-400 truncate flex-1">{fields ? `Changed: ${fields}` : "Operation recorded"}</span>
                    <span className="text-gray-600 shrink-0 ml-auto"><User size={10} className="inline mr-1" />{a.userName || "System"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Dialogs ── */}
      {showConfigDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfigDialog(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Link Configuration</h3>
            <input className="input-field" placeholder="Search assets and Kumo configurations..." onChange={e => { setConfigDialogQuery(e.target.value); }} />
            <p className="text-xs text-gray-500">Assets</p>
            {assetResults.filter((a: any) => !configDialogQuery || (a.name || a.tag || "").toLowerCase().includes(configDialogQuery.toLowerCase())).slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                <Wrench size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{a.name || a.tag || a.id}</p><p className="text-gray-500 text-[10px]">Asset</p></div>
                <button onClick={() => { persistCF("ticketConfigurations", [...cfArr("ticketConfigurations"), { id: uuidish(), name: a.name || a.tag || a.id, type: "Asset", kind: "asset", refId: a.id, linkedAt: new Date().toISOString() }]); setShowConfigDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
              </div>
            ))}
            <p className="text-xs text-gray-500">Kumo Configurations</p>
            {kumoConfigResults.filter((c: any) => !configDialogQuery || (c.kumoAsset?.name || c.hostname || "").toLowerCase().includes(configDialogQuery.toLowerCase())).slice(0, 8).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                <Wrench size={14} className="text-cyber-400 shrink-0" />
                <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{c.kumoAsset?.name || c.hostname || c.id}</p><p className="text-gray-500 text-[10px]">Kumo Config</p></div>
                <button onClick={() => { persistCF("ticketConfigurations", [...cfArr("ticketConfigurations"), { id: uuidish(), name: c.kumoAsset?.name || c.hostname || c.id, type: "Kumo Server", kind: "kumoServer", refId: c.id, linkedAt: new Date().toISOString() }]); setShowConfigDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
              </div>
            ))}
            <div className="flex justify-end"><button onClick={() => setShowConfigDialog(false)} className="btn-secondary text-sm">Close</button></div>
          </div>
        </div>
      )}

      {showProductDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowProductDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (!productForm.name.trim()) return; persistCF("ticketProducts", [...cfArr("ticketProducts"), { id: uuidish(), ...productForm }]); setProductForm({ name: "", qty: 1, unitCost: 0 }); setShowProductDialog(false); toast.success("Added"); }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Package size={16} /> Add Product</h3>
            <input className="input-field" placeholder="Product name *" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2"><input className="input-field" type="number" placeholder="Qty" min={1} value={productForm.qty} onChange={e => setProductForm({ ...productForm, qty: Number(e.target.value) })} /><input className="input-field" type="number" placeholder="Unit cost" step="0.01" min={0} value={productForm.unitCost} onChange={e => setProductForm({ ...productForm, unitCost: Number(e.target.value) })} /></div>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowProductDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Add</button></div>
          </form>
        </div>
      )}

      {showLinkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLinkDialog(false)}>
          <div className="card w-full max-w-md mx-4 space-y-3 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Link2 size={16} /> Link Ticket</h3>
            <input className="input-field" placeholder="Search tickets..." value={linkQuery} onChange={e => setLinkQuery(e.target.value)} />
            <select className="input-field" value={linkRel} onChange={e => setLinkRel(e.target.value)}>
              <option value="related">Related</option><option value="parent">Parent</option><option value="child">Child</option><option value="duplicate">Duplicate</option>
            </select>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {linkResults.filter((t: any) => !linkQuery || `${t.ticketNumber} ${t.title}`.toLowerCase().includes(linkQuery.toLowerCase())).slice(0, 12).map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-lighter">
                  <div className="flex-1 min-w-0"><p className="text-white text-xs font-medium truncate">{t.ticketNumber}</p><p className="text-gray-500 text-[10px] truncate">{t.title}</p></div>
                  <button onClick={() => { persistCF("ticketLinks", [...cfArr("ticketLinks"), { id: uuidish(), ticketId: t.id, ticketNumber: t.ticketNumber, title: t.title, rel: linkRel, linkedAt: new Date().toISOString() }]); setShowLinkDialog(false); toast.success("Linked"); }} className="btn-secondary text-xs">Link</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end"><button onClick={() => setShowLinkDialog(false)} className="btn-secondary text-sm">Close</button></div>
          </div>
        </div>
      )}

      {showExpenseDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowExpenseDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); try { await api.post("/billing/expenses", { ...expenseForm, amount: Number(expenseForm.amount), ticketId: id, expenseDate: expenseForm.expenseDate || new Date().toISOString() }); toast.success("Expense added"); setShowExpenseDialog(false); setExpenseForm({ description: "", amount: "", category: "other", expenseDate: "" }); api.get("/billing/expenses").then(r => setExpenses((r.data?.data || r.data || []).filter((x: any) => x.ticketId === id))).catch(() => {}); } catch { toast.error("Failed"); } }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Receipt size={16} /> Add Expense</h3>
            <input className="input-field" placeholder="Description *" value={expenseForm.description} onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" type="number" placeholder="Amount *" step="0.01" min={0} value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} required />
              <select className="input-field" value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                <option value="other">Other</option><option value="travel">Travel</option><option value="hardware">Hardware</option><option value="software">Software</option><option value="parts">Parts</option><option value="labor">Labor</option>
              </select>
            </div>
            <input className="input-field" type="date" value={expenseForm.expenseDate} onChange={e => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowExpenseDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Add</button></div>
          </form>
        </div>
      )}

      {showScheduleDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowScheduleDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); if (!scheduleForm.title || !scheduleForm.startTime || !scheduleForm.endTime) return; try { await api.post("/schedule", { ...scheduleForm, ticketId: id }); toast.success("Scheduled"); setShowScheduleDialog(false); setScheduleForm({ title: "", startTime: "", endTime: "", location: "" }); api.get("/schedule?limit=200").then(r => setSchedEntries((Array.isArray(r.data) ? r.data : (r.data?.data || [])).filter((x: any) => x.ticketId === id))).catch(() => {}); } catch { toast.error("Failed"); } }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Clock size={16} /> Schedule Entry</h3>
            <input className="input-field" placeholder="Title *" value={scheduleForm.title} onChange={e => setScheduleForm({ ...scheduleForm, title: e.target.value })} required />
            <div className="grid grid-cols-2 gap-2"><input className="input-field text-xs" type="datetime-local" value={scheduleForm.startTime} onChange={e => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} required /><input className="input-field text-xs" type="datetime-local" value={scheduleForm.endTime} onChange={e => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} required /></div>
            <input className="input-field" placeholder="Location (optional)" value={scheduleForm.location} onChange={e => setScheduleForm({ ...scheduleForm, location: e.target.value })} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowScheduleDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Schedule</button></div>
          </form>
        </div>
      )}

      {showAttachDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAttachDialog(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); const f = attachForm.file; if (!f) return; try { await api.post(`/tickets/${id}/attachments`, { filename: f.name, mimeType: f.type || "application/octet-stream", size: f.size, storagePath: "pending-upload" }); toast.success("Attached"); setShowAttachDialog(false); setAttachForm({ file: null }); load(); } catch { toast.error("Failed"); } }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Paperclip size={16} /> Attach File</h3>
            <p className="text-xs text-gray-500">The attachment record is stored with the ticket and synced app-wide; file content storage remains a placeholder.</p>
            <input type="file" className="input-field" onChange={e => setAttachForm({ file: e.target.files?.[0] || null })} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowAttachDialog(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" disabled={!attachForm.file} className="btn-primary text-sm">Attach</button></div>
          </form>
        </div>
      )}

      {showTimeTabAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTimeTabAdd(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={async e => { e.preventDefault(); await handleTimeEntry(e); setShowTimeTabAdd(false); }}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Timer size={16} /> Add Time Entry</h3>
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field text-xs" type="datetime-local" value={timeForm.startTime} onChange={e => { setTimeForm({ ...timeForm, startTime: e.target.value }); setTimeout(calcDuration, 0); }} required />
              <input className="input-field text-xs" type="datetime-local" value={timeForm.endTime} onChange={e => { setTimeForm({ ...timeForm, endTime: e.target.value }); setTimeout(calcDuration, 0); }} required />
            </div>
            <input className="input-field text-xs" readOnly value={timeForm.calculated} placeholder="Duration" />
            <input className="input-field" placeholder="Description" value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} />
            <label className="flex items-center gap-1 text-xs text-gray-400"><input type="checkbox" checked={timeForm.billable} onChange={e => setTimeForm({ ...timeForm, billable: e.target.checked })} /> Billable</label>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowTimeTabAdd(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Save</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
