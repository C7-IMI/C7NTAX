import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import { InferencePanel } from "../components/InferencePanel";
import { Plus, Search, Save, X, Clock, Edit3, Timer, Send, Home, ChevronRight, Filter, ChevronDown, CheckSquare, Square } from "lucide-react";
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

  // ── Filter dialog ──
  const [showFilter, setShowFilter] = useState(false);
  const [filterForm, setFilterForm] = useState<Record<string,string>>({ status: "", priority: "", assignedToId: "", dateFrom: "", dateTo: "" });
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Tickets</h2><p className="text-sm text-gray-400">{boardId ? `Filtered by board` : "Manage service tickets"}</p></div>
        <div className="flex items-center gap-2">
          <select
            className="input-field text-sm py-1.5"
            value={boardId}
            onChange={e=>{setSearchParams(e.target.value?{boardId:e.target.value}:{});}}
          >
            <option value="">All Boards</option>
            {boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={() => setShowFilter(true)} className="btn-secondary text-sm flex items-center gap-1.5">
            <Filter size={14} /> Filter
          </button>
          <button onClick={openNew} className="btn-primary flex items-center gap-2 self-start"><Plus size={16}/>Create</button>
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
            <SortableHeader field="ticketNumber" label="Ticket #" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-2 py-3 w-32" />
            <SortableHeader field="status" label="Status" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden md:table-cell" />
            <SortableHeader field="board.name" label="Board" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />
            <SortableHeader field="company.name" label="Client" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />
            <SortableHeader field="updatedAt" label="Updated" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden sm:table-cell" />
            <th className="px-4 py-3 w-10"></th>
          </tr></thead>
            <tbody>{sortData(tickets as Array<Record<string,unknown>>, sort?.field || "updatedAt", sort?.direction || "desc").map((t:any)=>(<tr key={t.id} className={`border-b border-surface-border/50 hover:bg-surface-light/50 ${selectedIds.has(t.id) ? "bg-cyber-600/10" : ""}`}>
              <td className="px-4 py-3"><button onClick={() => toggleSelect(t.id)} className="text-gray-500 hover:text-white">{selectedIds.has(t.id) ? <CheckSquare size={16} className="text-cyber-400"/> : <Square size={16}/>}</button></td>
              <td className="px-2 py-3"><Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 font-medium">{t.ticketNumber}</Link><p className="text-gray-500 text-xs mt-0.5 truncate max-w-xs">{(t.title)?.slice(0,60)}</p></td>
              <td className="px-4 py-3 hidden md:table-cell"><span className={`badge ${STATUS_COLORS[t.status]||""}`}>{(t.status)?.replace(/_/g," ")}</span>{t.isOverdue ? <span className="badge bg-red-600/20 text-red-400 ml-1.5">OVERDUE</span> : null}</td>
              <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">{(t.board as {name?:string})?.name||"-"}</td>
              <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{(t.company as {name?:string})?.name||"-"}</td>
              <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">{t.updatedAt?new Date(t.updatedAt).toLocaleDateString():"-"}</td>
              <td className="px-4 py-3">
                <TicketActionMenu ticketId={t.id} currentStatus={t.status} currentPriority={t.priority} onAction={ticketAction} />
              </td>
            </tr>))}</tbody></table></div>)}
      </div>
    </div>
  );
}

// ── Individual ticket "Modify Selected" dropdown menu ──
function TicketActionMenu({ ticketId, currentStatus, currentPriority, onAction }: {
  ticketId: string; currentStatus: string; currentPriority: string;
  onAction: (id: string, action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-gray-500 hover:text-white p-1 rounded" title="Modify">
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-navy-800 border border-surface-border rounded-lg shadow-xl z-50 py-1 min-w-[180px]">
            <div className="px-3 py-1.5 text-[10px] text-gray-600 uppercase font-semibold">Modify Ticket</div>
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
        </>
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

  const load = () => {
    if(!id) return;
    api.get(`/tickets/${id}`).then(r=>{
      const t = r.data;
      setTicket(t);
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
    try {
      await api.post(`/tickets/${id}/time-entries`, { ...timeForm, minutes: mins || undefined, date: new Date().toISOString().slice(0,10) });
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
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Dates & Times</h3>
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
            <button onClick={() => setShowTimeEntry(!showTimeEntry)} className="text-xs text-cyber-400 hover:text-cyber-300 flex items-center gap-1"><Timer size={12}/> Log Time</button>
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
      </div>
    </div>
  );
}
