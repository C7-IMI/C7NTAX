import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, FolderKanban, Calendar, DollarSign, CheckCircle, Clock } from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { PageHeader, ListViews } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

interface Project{id:string;name:string;description?:string;companyId?:string;status:string;priority:string;startDate?:string;endDate?:string;budget:number;budgetSpent?:number;}

export function ProjectsPage(){
  const [projects,setProjects]=useState<Project[]>([]);
  const [loading,setLoading]=useState(true);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({name:"",companyId:"",description:"",budget:0,startDate:"",endDate:"",priority:"medium"});
  const [companies,setCompanies]=useState<Array<{id:string;name:string}>>([]);
  const modern = useModernInterface();
  const [view,setView]=useState("all");

  const fetch=()=>{api.get("/projects?limit=50").then(r=>setProjects(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false))};
  useEffect(()=>{fetch();api.get("/clients?limit=100").then(r=>setCompanies(r.data.data||[])).catch(()=>{})},[]);

  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();try{await api.post("/projects",form);toast.success("Project created");setShowNew(false);fetch()}catch{toast.error("Failed")}};
  const SC:Record<string,string>={planning:"bg-blue-600/20 text-blue-400",in_progress:"bg-cyber-600/20 text-cyber-400",completed:"bg-green-600/20 text-green-400",on_hold:"bg-amber-600/20 text-amber-400"};
  const STATUSES = ["planning","in_progress","completed","on_hold"] as const;
  const projectViews = [
    { id:"all", label:"All", count: projects.length },
    ...STATUSES.map(status=>({ id:status, label: status.replace(/_/g," "), count: projects.filter(p=>p.status===status).length })),
  ];
  const shown = projects.filter(p=>view==="all"||p.status===view);
  const budget = projects.reduce((n,p)=>n+(Number(p.budget)||0),0);
  const spent = projects.reduce((n,p)=>n+(Number(p.budgetSpent)||0),0);

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <PageHeader variant="section" title="Projects" subtitle={<>{projects.length} projects · ${budget.toLocaleString()} budgeted · ${spent.toLocaleString()} spent</>} />
      <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>New Project</button>
    </div>

    {modern && projects.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <ListViews views={projectViews} value={view} onChange={setView} label="Project views" />
        <span className="text-xs text-gray-500">{shown.length} shown · {budget > 0 ? `${Math.round((spent / budget) * 100)}% of budget spent` : "no budget set"}</span>
      </div>
    )}

    {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Project</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white">x</button></div>
      <input className="input-field" placeholder="Project name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>
      <textarea className="input-field" placeholder="Description" rows={2} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/>
      <div className="grid grid-cols-3 gap-3">
        <select className="input-field" value={form.companyId} onChange={e=>setForm({...form,companyId:e.target.value})}><option value="">Client (optional)</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="input-field" type="number" placeholder="Budget" value={form.budget} onChange={e=>setForm({...form,budget:Number(e.target.value)})}/>
        <select className="input-field" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select>
      </div>
      <div className="grid grid-cols-2 gap-3"><div><label className="text-xs text-gray-500">Start</label><input className="input-field" type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></div><div><label className="text-xs text-gray-500">End</label><input className="input-field" type="date" value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></div></div>
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    {loading?<TableSkeleton />:projects.length===0?<div className="text-center py-12 card"><FolderKanban size={40} className="text-gray-600 mx-auto mb-3"/><p className="text-gray-500">No projects</p></div>:(
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {shown.length===0?<p className="text-sm text-gray-500">Nothing in this view.</p>:shown.map(p=>(<div key={p.id} className="card hover:border-cyber-500/30 transition-colors group">
          <div className="flex items-start justify-between"><div><h3 className="font-semibold text-white text-sm">{p.name}</h3>{p.description&&<p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.description}</p>}</div><span className={"badge text-xs "+(SC[p.status]||"")}>{p.status.replace(/_/g," ")}</span></div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            <div className="bg-surface-lighter rounded px-2 py-1.5"><p className="text-gray-500">Budget</p><p className="text-white font-medium">${p.budget.toLocaleString()}</p></div>
            <div className="bg-surface-lighter rounded px-2 py-1.5"><p className="text-gray-500">Spent</p><p className="text-cyber-400 font-medium">${(p.budgetSpent||0).toLocaleString()}</p></div>
            <div className="bg-surface-lighter rounded px-2 py-1.5"><p className="text-gray-500">Start</p><p className="text-white">{p.startDate?new Date(p.startDate).toLocaleDateString():"—"}</p></div>
            <div className="bg-surface-lighter rounded px-2 py-1.5"><p className="text-gray-500">End</p><p className="text-white">{p.endDate?new Date(p.endDate).toLocaleDateString():"—"}</p></div>
          </div>
          {/* The budget as a proportion, so an overspent project is visible without dividing two figures. */}
          {modern && (
            <div className="mt-2.5">
              <span className="relative block h-1.5 overflow-hidden rounded-full bg-surface-lighter">
                <i className={`absolute inset-y-0 left-0 rounded-full ${(p.budgetSpent||0) > p.budget ? "bg-alert-red" : "bg-cyber-500"}`} style={{ width: `${p.budget > 0 ? Math.min(100, Math.round(((p.budgetSpent||0) / p.budget) * 100)) : 0}%` }} />
              </span>
              <p className="mt-1 text-[11px] text-gray-600">{p.budget > 0 ? `${Math.round(((p.budgetSpent||0) / p.budget) * 100)}% of budget` : "No budget set"}</p>
            </div>
          )}
        </div>))}
      </div>)}
  </div>);
}
