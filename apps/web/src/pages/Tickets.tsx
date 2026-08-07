import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import api from "../api";
import { InferencePanel } from "../components/InferencePanel";
import { Plus, Search, Save, X, Clock, Edit3, Timer, Send, Home, ChevronRight, Filter } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-600/20 text-blue-400", in_progress: "bg-cyber-600/20 text-cyber-400",
  waiting_on_client: "bg-amber-600/20 text-amber-400", on_hold: "bg-purple-600/20 text-purple-400",
  resolved: "bg-green-600/20 text-green-400", closed: "bg-gray-600/20 text-gray-400", cancelled: "bg-red-600/20 text-red-400",
};
const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400", high: "bg-orange-600/20 text-orange-400",
  medium: "bg-amber-600/20 text-amber-400", low: "bg-gray-600/20 text-gray-400",
};

export function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const boardId = searchParams.get("boardId") || "";
  const [tickets, setTickets] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", priority:"medium", boardId:"", companyId:"", startTime:"", endTime:"" });
  const [boards, setBoards] = useState<Array<{id:string;name:string}>>([]);
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);

  const fetchBoards = () => { api.get("/boards").then(r=>setBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{}); };

  const fetchTickets = () => {
    let url = "/tickets?limit=100";
    if (boardId) url += `&boardId=${boardId}`;
    api.get(url).then(r=>setTickets(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(()=>{fetchBoards();fetchTickets();},[boardId]);

  const openNew = async () => {
    try { const cR=await api.get("/clients?limit=50"); setCompanies(cR.data?.data||[]); } catch {}
    setForm(prev=>({...prev, boardId: boardId || ""}));
    setShowNew(true);
  };
  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/tickets",form); toast.success("Ticket created"); setShowNew(false); setForm({title:"",description:"",priority:"medium",boardId:"",companyId:"",startTime:"",endTime:""}); fetchTickets(); }
    catch { toast.error("Failed"); }
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
          <button onClick={openNew} className="btn-primary flex items-center gap-2 self-start"><Plus size={16}/>Create</button>
        </div>
      </div>
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowNew(false)}>
          <form className="card w-full max-w-lg mx-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">Create Ticket</h3>
            <input className="input-field" placeholder="Title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required autoFocus/>
            <textarea className="input-field" placeholder="Description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={3}/>
            <div className="grid grid-cols-2 gap-3">
              <select className="input-field" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
              <select className="input-field" value={form.boardId} onChange={e=>setForm({...form,boardId:e.target.value})} required><option value="">Board...</option>{boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </div>
            <select className="input-field" value={form.companyId} onChange={e=>setForm({...form,companyId:e.target.value})}><option value="">Client (optional)</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="grid grid-cols-2 gap-3"><input className="input-field" type="datetime-local" value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/><input className="input-field" type="datetime-local" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></div>
            <div className="flex gap-2 justify-end"><button type="button" className="btn-secondary" onClick={()=>setShowNew(false)}>Cancel</button><button type="submit" className="btn-primary">Create</button></div>
          </form>
        </div>
      )}
      <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input className="input-field pl-9" placeholder="Search tickets..."/></div>
      <div className="card overflow-hidden p-0">
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : tickets.length===0 ? <div className="p-8 text-center text-gray-500">No tickets</div>:(
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-400"><th className="px-4 py-3 w-36">Ticket #</th><th className="px-4 py-3 hidden md:table-cell">Status</th><th className="px-4 py-3 hidden lg:table-cell">Board</th><th className="px-4 py-3 hidden lg:table-cell">Client</th><th className="px-4 py-3 hidden sm:table-cell">Updated</th></tr></thead>
            <tbody>{(tickets as Array<Record<string,unknown>>).map(t=>(<tr key={t.id as string} className="border-b border-surface-border/50 hover:bg-surface-light/50"><td className="px-4 py-3"><Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 font-medium">{t.ticketNumber as string}</Link><p className="text-gray-500 text-xs mt-0.5 truncate max-w-xs">{(t.title as string)?.slice(0,60)}</p></td><td className="px-4 py-3 hidden md:table-cell"><span className={`badge ${STATUS_COLORS[t.status as string]||""}`}>{(t.status as string)?.replace(/_/g," ")}</span></td><td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">{(t.board as {name?:string})?.name||"—"}</td><td className="px-4 py-3 hidden lg:table-cell text-gray-400">{(t.company as {name?:string})?.name||"—"}</td><td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">{t.updatedAt?new Date(t.updatedAt as string).toLocaleDateString():"—"}</td></tr>))}</tbody></table></div>)}
      </div>
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
    }).catch(()=>toast.error("Ticket not found"));
  };
  useEffect(()=>{
    load();
    api.get("/clients?limit=50").then(r=>setCompanies(r.data.data||[])).catch(()=>{});
    api.get("/users?limit=50").then(r=>setUsers(r.data.data||[])).catch(()=>{});
    api.get("/boards").then(r=>setAllBoards(Array.isArray(r.data)?r.data:(r.data?.data||r.data||[]))).catch(()=>{});
  },[id]);

  const handleCompanyChange = async (companyId: string) => {
    setEditForm(prev=>({...prev, companyId, contactId: "", serviceAgreementId: ""}));
    setSelectedAgreement(null); setContacts([]);
    if (!companyId) { setAgreements([]); return; }
    try {
      const [cRes, aRes] = await Promise.all([
        api.get(`/clients?companyId=${companyId}`),
        api.get(`/billing/agreements?companyId=${companyId}`)
      ]);
      const clientContacts = (cRes.data?.data||[]).filter((c:Record<string,unknown>)=>c.companyId===companyId);
      if (clientContacts.length===0) {
        const allContacts = await api.get(`/clients/${companyId}`);
        const compContacts = allContacts.data?.contacts || [];
        setContacts(compContacts);
      } else {
        setContacts(clientContacts);
      }
      const ags = (aRes.data||[]).filter((a:Record<string,unknown>)=>a.companyId===companyId);
      setAgreements(ags as Array<{id:string;name:string;billingPeriod:string;billingAmount:number}>);
      if (ags.length===1) { setEditForm(prev=>({...prev,serviceAgreementId:ags[0].id})); setSelectedAgreement(ags[0]); }
    } catch { setAgreements([]); setContacts([]); }
  };

  // Auto-load agreements/contacts when company is already set on first load
  useEffect(()=>{
    if (ticket?.companyId && editing) handleCompanyChange(ticket.companyId as string);
  },[editing]);

  const handlePostNote = async () => {
    if (!noteText.trim()) return;
    setPosting(true);
    try {
      await api.post(`/tickets/${id}/notes`, { content: noteText, isInternal: false });
      toast.success("Note posted");
      setNoteText("");
      load();
    } catch { toast.error("Failed"); }
    finally { setPosting(false); }
  };

  const handleLogTime = async (e: React.FormEvent) => {
    e.preventDefault();
    const start = new Date(timeForm.startTime);
    const end = new Date(timeForm.endTime);
    const mins = Math.round((end.getTime() - start.getTime()) / 60000);
    if (mins <= 0) { toast.error("End time must be after start time"); return; }
    try {
      await api.post(`/tickets/${id}/time`, {
        minutes: mins,
        description: timeForm.description,
        billable: timeForm.billable,
        date: start.toISOString(),
      });
      toast.success("Time logged");
      setShowTimeEntry(false);
      setTimeForm({ startTime: "", endTime: "", calculated: "", description: "", billable: true });
      load();
    } catch { toast.error("Failed"); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: Record<string,unknown> = {};
      for (const [k,v] of Object.entries(editForm)) {
        if (v === undefined || v === null) continue;
        if (v === "" && ["startTime","endTime","dueDate","contactId","serviceAgreementId","assignedToId"].includes(k)) {
          data[k] = null; // send null to clear optional fields
        } else if (k === "companyId" || k === "boardId") {
          // Required FK fields - skip if empty, don't send null
          if (v !== "") data[k] = v;
        } else if (v !== "") {
          data[k] = v;
        }
      }
      // Convert datetime strings to ISO
      for (const f of ["startTime","endTime","dueDate"]) {
        if (data[f] && typeof data[f] === "string" && (data[f] as string).trim() !== "") {
          data[f] = new Date(data[f] as string).toISOString();
        }
      }
      await api.patch(`/tickets/${id}`, data);
      toast.success("Ticket updated");
      setEditing(false);
      load();
    } catch (e: unknown) {
      const msg = (e as {response?:{data?:{error?:{message?:string}}}})?.response?.data?.error?.message || "Failed to save";
      toast.error(msg);
    }
    finally { setSaving(false); }
  };

  if (!ticket) return <div className="flex items-center justify-center py-20 text-gray-500">Loading ticket...</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/tickets" className="text-sm text-cyber-400 hover:text-cyber-300">← Back to tickets</Link>
          <h2 className="text-xl font-bold text-white mt-1">{ticket.ticketNumber as string}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${STATUS_COLORS[ticket.status as string]||""}`}>{(ticket.status as string)?.replace(/_/g," ")}</span>
          <span className={`badge ${PRIORITY_COLORS[ticket.priority as string]||""}`}>{ticket.priority as string}</span>
          {!editing
            ? <button onClick={()=>setEditing(true)} className="btn-primary text-sm flex items-center gap-1.5"><Edit3 size={14}/>Edit Ticket</button>
            : <><button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5"><Save size={14}/>{saving?"Saving...":"Save Changes"}</button><button onClick={()=>setEditing(false)} className="btn-secondary text-sm flex items-center gap-1.5"><X size={14}/>Cancel</button></>
          }
        </div>
      </div>

      {/* Main layout - 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - General & Classification */}
        <div className="lg:col-span-2 space-y-6">
          {/* General Section */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">General</h3>
            {editing ? (<div className="space-y-3">
              <div><label className="text-xs text-gray-500 block mb-1">Title</label><input className="input-field" value={editForm.title||""} onChange={e=>setEditForm({...editForm,title:e.target.value})}/></div>
              <div><label className="text-xs text-gray-500 block mb-1">Description</label><textarea className="input-field" rows={5} value={editForm.description||""} onChange={e=>setEditForm({...editForm,description:e.target.value})}/></div>
            </div>) : (
              <div className="space-y-3">
                <div><p className="text-xs text-gray-500">Title</p><p className="text-white font-medium">{ticket.title as string}</p></div>
                <div><p className="text-xs text-gray-500">Description</p><p className="text-gray-300 text-sm whitespace-pre-wrap">{ticket.description||"-"}</p></div>
              </div>
            )}
          </div>

          {/* Dates & Times Section */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Dates & Times</h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">Total: <strong className="text-cyber-400">{(ticket.timeEntries as Array<{minutes:number}>||[]).reduce((s,t)=>s+(t.minutes||0),0)}m</strong></span>
                <button onClick={()=>setShowTimeEntry(true)} className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"><Timer size={12}/>Log Time</button>
              </div>
            </div>
            {editing ? (<div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><input className="input-field" type="datetime-local" value={editForm.dueDate||""} onChange={e=>setEditForm({...editForm,dueDate:e.target.value})}/></div>
              <div><label className="text-xs text-gray-500 flex items-center gap-1"><Clock size={11}/>Start Time</label><input className="input-field" type="datetime-local" value={editForm.startTime||""} onChange={e=>setEditForm({...editForm,startTime:e.target.value})}/></div>
              <div><label className="text-xs text-gray-500 flex items-center gap-1"><Clock size={11}/>End Time</label><input className="input-field" type="datetime-local" value={editForm.endTime||""} onChange={e=>setEditForm({...editForm,endTime:e.target.value})}/></div>
            </div>) : (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Due Date</p><p className="text-white">{ticket.dueDate?new Date(ticket.dueDate as string).toLocaleString():"-"}</p></div>
                <div><p className="text-xs text-gray-500">Start Time</p><p className="text-white">{ticket.startTime?new Date(ticket.startTime as string).toLocaleString():"-"}</p></div>
                <div><p className="text-xs text-gray-500">End Time</p><p className="text-white">{ticket.endTime?new Date(ticket.endTime as string).toLocaleString():"-"}</p></div>
              </div>
            )}
            {/* Time Entries List */}
            {(ticket.timeEntries as Array<Record<string,unknown>>||[]).length > 0 && (
              <div className="mt-4 pt-4 border-t border-surface-border">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Logged Time</h4>
                <div className="space-y-2">
                  {(ticket.timeEntries as Array<Record<string,unknown>>||[]).sort((a,b)=>new Date(b.date as string).getTime()-new Date(a.date as string).getTime()).map((te,i)=>(
                    <div key={te.id as string||i} className="bg-surface-lighter rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="badge bg-green-600/20 text-green-400 text-[10px]">Time Entry</span>
                        <span className="text-cyber-400 font-mono font-medium">{te.minutes as number}m</span>
                        {te.billable ? <span className="badge bg-green-600/20 text-green-400 text-[10px]">billable</span> : <span className="badge bg-gray-600/20 text-gray-400 text-[10px]">non-billable</span>}
                      </div>
                      {te.description && <p className="text-gray-300 mt-0.5">{te.description as string}</p>}
                      <p className="text-xs text-gray-600 mt-0.5">{(te.user as {firstName?:string;lastName?:string})?.firstName} {(te.user as {lastName?:string})?.lastName} · {te.date?new Date(te.date as string).toLocaleString():"-"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Classification + Details merged */}
        <div className="space-y-6">
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Classification & Details</h3>
            {editing ? (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={editForm.status||"new"} onChange={e=>setEditForm({...editForm,status:e.target.value})}>{Object.keys(STATUS_COLORS).map(k=><option key={k} value={k}>{k.replace(/_/g," ")}</option>)}</select></div>
                <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={editForm.priority||"medium"} onChange={e=>setEditForm({...editForm,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
              </div>
              <div><label className="text-xs text-gray-500 block mb-1">Board / Queue</label><select className="input-field" value={editForm.boardId||""} onChange={e=>setEditForm({...editForm,boardId:e.target.value})}><option value="">Select...</option>{allBoards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <hr className="border-surface-border"/>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Company</label>
                <select className="input-field" value={editForm.companyId||""} onChange={e=>handleCompanyChange(e.target.value)}>
                  <option value="">None</option>
                  {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {agreements.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Service Agreement</label>
                  <select className="input-field" value={editForm.serviceAgreementId||""} onChange={e=>{setEditForm({...editForm,serviceAgreementId:e.target.value}); setSelectedAgreement(agreements.find(a=>a.id===e.target.value)||null);}}>
                    <option value="">None</option>
                    {agreements.map(a=><option key={a.id} value={a.id}>{a.name} - ${a.billingAmount}</option>)}
                  </select>
                  {selectedAgreement && (agreements.length>0 || ticket?.serviceAgreement) && (
                    <div className="mt-2 p-2 rounded-lg bg-cyber-600/10 border border-cyber-600/20 text-xs text-cyber-400">
                      {selectedAgreement
                        ? <><strong>{selectedAgreement.name as string}</strong> · ${selectedAgreement.billingAmount as number} / {(selectedAgreement.billingPeriod as string||"monthly").replace(/_/g," ")}</>
                        : ticket?.serviceAgreement && <><strong>{(ticket.serviceAgreement as {name?:string}).name}</strong> · ${(ticket.serviceAgreement as {billingAmount?:number}).billingAmount} / {(ticket.serviceAgreement as {billingPeriod?:string}).billingPeriod?.replace(/_/g," ")}</>
                      }
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Contact</label>
                <select className="input-field" value={editForm.contactId||""} onChange={e=>setEditForm({...editForm,contactId:e.target.value})}>
                  <option value="">None</option>
                  {contacts.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Assigned To</label>
                <select className="input-field" value={editForm.assignedToId||""} onChange={e=>setEditForm({...editForm,assignedToId:e.target.value})}>
                  <option value="">Unassigned</option>
                  {users.map(u=><option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </div>
            </>) : (<>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Status</p><span className={`badge ${STATUS_COLORS[ticket.status as string]||""}`}>{(ticket.status as string)?.replace(/_/g," ")}</span></div>
                <div><p className="text-xs text-gray-500">Priority</p><span className={`badge ${PRIORITY_COLORS[ticket.priority as string]||""}`}>{ticket.priority as string}</span></div>
              </div>
              <div><p className="text-xs text-gray-500">Board</p><p className="text-white font-medium">{ticket.board?(ticket.board as {name:string}).name:"-"}</p></div>
              <hr className="border-surface-border"/>
              <div>
                <p className="text-xs text-gray-500">Company</p>
                <p className="text-white font-medium">{ticket.company?(ticket.company as {name:string;clientType?:string}).name:"-"}</p>
                {(ticket.company as {clientType?:string})?.clientType && <span className="badge bg-cyber-600/20 text-cyber-400 text-[10px] mt-0.5">{(ticket.company as {clientType:string}).clientType}</span>}
              </div>
              {ticket.serviceAgreement && (
                <div className="p-2 rounded-lg bg-cyber-600/10 border border-cyber-600/20">
                  <p className="text-xs text-gray-400">Service Agreement</p>
                  <p className="text-xs text-cyber-400"><strong>{(ticket.serviceAgreement as {name?:string}).name}</strong> · ${(ticket.serviceAgreement as {billingAmount?:number}).billingAmount} / {(ticket.serviceAgreement as {billingPeriod?:string}).billingPeriod?.replace(/_/g," ")}</p>
                </div>
              )}
              <div><p className="text-xs text-gray-500">Contact</p><p className="text-white">{ticket.contact?(ticket.contact as {firstName:string;lastName:string}).firstName+" "+(ticket.contact as {firstName:string;lastName:string}).lastName:"-"}</p></div>
              <div><p className="text-xs text-gray-500">Assigned To</p><p className="text-white">{ticket.assignedTo?`${(ticket.assignedTo as {firstName?:string}).firstName} ${(ticket.assignedTo as {lastName?:string}).lastName}`:"Unassigned"}</p></div>
              <hr className="border-surface-border"/>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Created</p><p className="text-white text-sm">{new Date(ticket.createdAt as string).toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Updated</p><p className="text-white text-sm">{new Date(ticket.updatedAt as string).toLocaleString()}</p></div>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {/* AI Inference */}
      <InferencePanel ticketId={ticket.id as string} ticketTitle={ticket.title as string} ticketDescription={ticket.description as string|undefined}/>

      {/* Notes & Activity - unified feed: comments + time entries */}
      <div className="card"><h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Notes & Activity</h3>
        {/* Inline note posting */}
        <div className="flex gap-2 mb-4">
          <input className="input-field flex-1" placeholder="Add a note..." value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handlePostNote();}}} />
          <button onClick={handlePostNote} disabled={posting||!noteText.trim()} className="btn-primary flex items-center gap-1.5 text-sm shrink-0"><Send size={14}/>{posting?"Posting...":"Post"}</button>
        </div>
        <div className="space-y-3">
          {(() => {
            const items: Array<{type: string; id: string; body?: string; author?: {firstName?:string;lastName?:string}; createdAt: string; isInternal?: boolean; isEmail?: boolean; fromEmail?: string; minutes?: number; description?: string; billable?: boolean; date?: string }> = [];
            // Add comments
            ((ticket.comments as Array<Record<string,unknown>>)||[]).forEach((n: Record<string,unknown>) => items.push({
              type: (n.isEmail as boolean) ? "Email Note" : ((n.isInternal as boolean) ? "Internal Note" : "Note"),
              id: n.id as string, body: n.body as string,
              author: n.author as {firstName?:string;lastName?:string} | undefined,
              createdAt: n.createdAt as string,
              isInternal: n.isInternal as boolean | undefined,
              isEmail: n.isEmail as boolean | undefined,
              fromEmail: n.fromEmail as string | undefined,
            }));
            // Add time entries
            ((ticket.timeEntries as Array<Record<string,unknown>>)||[]).forEach((te: Record<string,unknown>) => items.push({
              type: "Time Entry",
              id: `te-${te.id as string}`, createdAt: te.date as string || te.createdAt as string,
              author: te.user as {firstName?:string;lastName?:string} | undefined,
              minutes: te.minutes as number | undefined,
              description: te.description as string | undefined,
              billable: te.billable as boolean | undefined,
              date: te.date as string | undefined,
            }));
            items.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            if (items.length === 0) return <p className="text-gray-500 text-sm">No notes yet</p>;
            return items.map(item => {
              const typeColors: Record<string,string> = { "Note": "bg-blue-600/20 text-blue-400", "Internal Note": "bg-amber-600/20 text-amber-400", "Email Note": "bg-purple-600/20 text-purple-400", "Time Entry": "bg-green-600/20 text-green-400" };
              const authorName = item.author?.firstName && item.author?.lastName ? `${item.author.firstName} ${item.author.lastName}` : (item.author?.firstName || item.fromEmail || "System");
              return (
                <div key={item.id} className="border-l-2 border-surface-border pl-3 py-1">
                  {item.type === "Time Entry" ? (
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`badge text-[10px] ${typeColors[item.type]||"bg-gray-600/20 text-gray-400"}`}><Clock size={10} className="inline mr-0.5"/>{item.type}</span>
                        <span className="text-cyber-400 font-mono text-sm font-medium">{item.minutes}m</span>
                        {item.billable !== undefined && (item.billable ? <span className="badge bg-green-600/20 text-green-400 text-[10px]">billable</span> : <span className="badge bg-gray-600/20 text-gray-400 text-[10px]">non-billable</span>)}
                      </div>
                      {item.description && <p className="text-sm text-gray-300 whitespace-pre-wrap">{item.description}</p>}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`badge text-[10px] ${typeColors[item.type]||"bg-gray-600/20 text-gray-400"}`}>{item.type}</span>
                      </div>
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{item.body}</p>
                    </>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{authorName} · {new Date(item.createdAt).toLocaleString()}</p>
                </div>
              );
            });
          })()}
        </div></div>

      {/* Time Entry Modal */}
      {showTimeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowTimeEntry(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e=>e.stopPropagation()} onSubmit={handleLogTime}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2"><Timer size={16}/>Log Time</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Start Time</label><input className="input-field" type="datetime-local" value={timeForm.startTime} onChange={e=>{setTimeForm({...timeForm,startTime:e.target.value}); if(e.target.value&&timeForm.endTime){const d=(new Date(timeForm.endTime).getTime()-new Date(e.target.value).getTime())/3600000;setTimeForm(p=>({...p,startTime:e.target.value,calculated:d>0?d.toFixed(2)+'h':''}));}}} required/></div>
              <div><label className="text-xs text-gray-500 block mb-1">End Time</label><input className="input-field" type="datetime-local" value={timeForm.endTime} onChange={e=>{setTimeForm({...timeForm,endTime:e.target.value}); if(timeForm.startTime&&e.target.value){const d=(new Date(e.target.value).getTime()-new Date(timeForm.startTime).getTime())/3600000;setTimeForm(p=>({...p,endTime:e.target.value,calculated:d>0?d.toFixed(2)+'h':''}));}}} required/></div>
            </div>
            {timeForm.calculated && <p className="text-sm text-cyber-400">Time spent: <strong>{timeForm.calculated}</strong></p>}
            <div><label className="text-xs text-gray-500 block mb-1">Description</label><input className="input-field" placeholder="What did you work on?" value={timeForm.description} onChange={e=>setTimeForm({...timeForm,description:e.target.value})} required/></div>
            <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={timeForm.billable} onChange={e=>setTimeForm({...timeForm,billable:e.target.checked})}/>Billable</label>
            <div className="flex gap-2 justify-end"><button type="button" className="btn-secondary text-sm" onClick={()=>setShowTimeEntry(false)}>Cancel</button><button type="submit" className="btn-primary text-sm">Log Time</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
