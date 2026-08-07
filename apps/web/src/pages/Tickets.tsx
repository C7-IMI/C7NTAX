import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import { InferencePanel } from "../components/InferencePanel";
import { Plus, Search, Save, X, Clock, Edit3 } from "lucide-react";
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
  const [tickets, setTickets] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title:"", description:"", priority:"medium", boardId:"", companyId:"", startTime:"", endTime:"" });
  const [boards, setBoards] = useState<Array<{id:string;name:string}>>([]);
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const fetchTickets = () => { api.get("/tickets?limit=100").then(r=>setTickets(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false)); };
  useEffect(()=>{fetchTickets();},[]);
  const openNew = async () => {
    try { const [bR,cR]=await Promise.all([api.get("/boards"),api.get("/clients?limit=50")]); setBoards(bR.data||[]); setCompanies(cR.data?.data||[]); } catch {}
    setShowNew(true);
  };
  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/tickets",form); toast.success("Ticket created"); setShowNew(false); setForm({title:"",description:"",priority:"medium",boardId:"",companyId:"",startTime:"",endTime:""}); fetchTickets(); }
    catch { toast.error("Failed"); }
  };
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Tickets</h2><p className="text-sm text-gray-400">Manage service tickets</p></div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2 self-start"><Plus size={16}/>New Ticket</button>
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
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-400"><th className="px-4 py-3">Ticket</th><th className="px-4 py-3 hidden md:table-cell">Status</th><th className="px-4 py-3 hidden lg:table-cell">Client</th><th className="px-4 py-3 hidden sm:table-cell">Updated</th></tr></thead>
            <tbody>{(tickets as Array<Record<string,unknown>>).map(t=>(<tr key={t.id as string} className="border-b border-surface-border/50 hover:bg-surface-light/50"><td className="px-4 py-3"><Link to={`/tickets/${t.id}`} className="text-white hover:text-cyber-400 font-medium">{t.ticketNumber as string}</Link><p className="text-gray-500 text-xs mt-0.5 truncate max-w-xs">{(t.title as string)?.slice(0,60)}</p></td><td className="px-4 py-3 hidden md:table-cell"><span className={`badge ${STATUS_COLORS[t.status as string]||""}`}>{(t.status as string)?.replace(/_/g," ")}</span></td><td className="px-4 py-3 hidden lg:table-cell text-gray-400">{(t.company as {name?:string})?.name||"-"}</td><td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-xs">{t.updatedAt?new Date(t.updatedAt as string).toLocaleDateString():"-"}</td></tr>))}</tbody></table></div>)}
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
  const [companies, setCompanies] = useState<Array<{id:string;name:string}>>([]);
  const [contacts, setContacts] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);
  const [agreements, setAgreements] = useState<Array<{id:string;name:string;billingPeriod:string;billingAmount:number}>>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<Record<string,unknown>|null>(null);
  const [users, setUsers] = useState<Array<{id:string;firstName:string;lastName:string}>>([]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const data: Record<string,unknown> = {};
      for (const [k,v] of Object.entries(editForm)) {
        if (v === undefined || v === null) continue;
        if (v === "" && ["startTime","endTime","dueDate","contactId","serviceAgreementId","assignedToId"].includes(k)) {
          data[k] = null; // send null to clear optional fields
        } else if (k === "companyId" || k === "boardId") {
          // Required FK fields — skip if empty, don't send null
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
                <div><p className="text-xs text-gray-500">Description</p><p className="text-gray-300 text-sm whitespace-pre-wrap">{ticket.description||"—"}</p></div>
              </div>
            )}
          </div>

          {/* Classification Section */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Classification</h3>
            {editing ? (<div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Status</label><select className="input-field" value={editForm.status||"new"} onChange={e=>setEditForm({...editForm,status:e.target.value})}>{Object.keys(STATUS_COLORS).map(k=><option key={k} value={k}>{k.replace(/_/g," ")}</option>)}</select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Priority</label><select className="input-field" value={editForm.priority||"medium"} onChange={e=>setEditForm({...editForm,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>
              <div><label className="text-xs text-gray-500 block mb-1">Board / Queue</label><select className="input-field" value={editForm.boardId||""} onChange={e=>setEditForm({...editForm,boardId:e.target.value})}><option value="">Select...</option>{(ticket.board?[{id:(ticket.board as {id:string}).id,name:(ticket.board as {name:string}).name}]:[]).map((b:{id:string;name:string})=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            </div>) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Status</p><span className={`badge ${STATUS_COLORS[ticket.status as string]||""}`}>{(ticket.status as string)?.replace(/_/g," ")}</span></div>
                <div><p className="text-xs text-gray-500">Priority</p><span className={`badge ${PRIORITY_COLORS[ticket.priority as string]||""}`}>{ticket.priority as string}</span></div>
                <div><p className="text-xs text-gray-500">Board</p><p className="text-white font-medium">{ticket.board?(ticket.board as {name:string}).name:"—"}</p></div>
              </div>
            )}
          </div>

          {/* Dates & Times Section */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Dates & Times</h3>
            {editing ? (<div className="grid grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-500 block mb-1">Due Date</label><input className="input-field" type="datetime-local" value={editForm.dueDate||""} onChange={e=>setEditForm({...editForm,dueDate:e.target.value})}/></div>
              <div><label className="text-xs text-gray-500 flex items-center gap-1"><Clock size={11}/>Start Time</label><input className="input-field" type="datetime-local" value={editForm.startTime||""} onChange={e=>setEditForm({...editForm,startTime:e.target.value})}/></div>
              <div><label className="text-xs text-gray-500 flex items-center gap-1"><Clock size={11}/>End Time</label><input className="input-field" type="datetime-local" value={editForm.endTime||""} onChange={e=>setEditForm({...editForm,endTime:e.target.value})}/></div>
            </div>) : (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Due Date</p><p className="text-white">{ticket.dueDate?new Date(ticket.dueDate as string).toLocaleString():"—"}</p></div>
                <div><p className="text-xs text-gray-500">Start Time</p><p className="text-white">{ticket.startTime?new Date(ticket.startTime as string).toLocaleString():"—"}</p></div>
                <div><p className="text-xs text-gray-500">End Time</p><p className="text-white">{ticket.endTime?new Date(ticket.endTime as string).toLocaleString():"—"}</p></div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Company, Contact, Assignment, Agreement */}
        <div className="space-y-6">
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Details</h3>
            {editing ? (<>
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
                    {agreements.map(a=><option key={a.id} value={a.id}>{a.name} — ${a.billingAmount}</option>)}
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
              <div><p className="text-xs text-gray-500">Company</p><p className="text-white font-medium">{ticket.company?(ticket.company as {name:string}).name:"—"}</p></div>
              {ticket.serviceAgreement && (
                <div className="p-2 rounded-lg bg-cyber-600/10 border border-cyber-600/20">
                  <p className="text-xs text-gray-400">Service Agreement</p>
                  <p className="text-xs text-cyber-400"><strong>{(ticket.serviceAgreement as {name?:string}).name}</strong> · ${(ticket.serviceAgreement as {billingAmount?:number}).billingAmount} / {(ticket.serviceAgreement as {billingPeriod?:string}).billingPeriod?.replace(/_/g," ")}</p>
                </div>
              )}
              <div><p className="text-xs text-gray-500">Contact</p><p className="text-white">{ticket.contact?(ticket.contact as {firstName:string;lastName:string}).firstName+" "+(ticket.contact as {firstName:string;lastName:string}).lastName:"—"}</p></div>
              <div><p className="text-xs text-gray-500">Assigned To</p><p className="text-white">{ticket.assignedTo?`${(ticket.assignedTo as {firstName?:string}).firstName} ${(ticket.assignedTo as {lastName?:string}).lastName}`:"Unassigned"}</p></div>
              <div><p className="text-xs text-gray-500">Created</p><p className="text-white text-sm">{new Date(ticket.createdAt as string).toLocaleString()}</p></div>
              <div><p className="text-xs text-gray-500">Updated</p><p className="text-white text-sm">{new Date(ticket.updatedAt as string).toLocaleString()}</p></div>
            </>)}
          </div>
        </div>
      </div>

      {/* AI Inference */}
      <InferencePanel ticketId={ticket.id as string} ticketTitle={ticket.title as string} ticketDescription={ticket.description as string|undefined}/>

      {/* Comments / Notes */}
      <div className="card"><h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Notes & Activity</h3><div className="space-y-3">{(ticket.comments as Array<Record<string,unknown>>)?.map(n=>(<div key={n.id as string} className="border-l-2 border-surface-border pl-3 py-1"><p className="text-sm text-gray-300 whitespace-pre-wrap">{n.body as string}</p><p className="text-xs text-gray-500 mt-1">{(n.author as {firstName?:string;lastName?:string})?.firstName} · {new Date(n.createdAt as string).toLocaleString()}{(n as {isInternal?:boolean}).isInternal&&<span className="badge ml-2 bg-amber-600/20 text-amber-400">internal</span>}</p></div>))||<p className="text-gray-500 text-sm">No notes yet</p>}</div></div>
    </div>
  );
}
