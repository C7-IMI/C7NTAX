import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { Plus, Target, TrendingUp, DollarSign, ChevronRight, ArrowRight, Building2 } from "lucide-react";

const STAGES: Record<string,string>={prospect:"bg-blue-600/20 text-blue-400",qualified:"bg-cyber-600/20 text-cyber-400",proposal:"bg-amber-600/20 text-amber-400",negotiation:"bg-purple-600/20 text-purple-400",won:"bg-green-600/20 text-green-400",lost:"bg-red-600/20 text-red-400"};
const STAGE_ORDER=["prospect","qualified","proposal","negotiation","won","lost"];
interface Opp{id:string;name:string;stage:string;amount:number;probability:number;companyId?:string;expectedCloseDate?:string;notes?:string;}

export function OpportunitiesPage(){
  const [opps,setOpps]=useState<Opp[]>([]);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState<"kanban"|"table">("kanban");
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({name:"",companyId:"",amount:0,probability:50,stage:"prospect",expectedCloseDate:"",notes:""});
  const [companies,setCompanies]=useState<Array<{id:string;name:string}>>([]);

  const fetch=async()=>{try{const r=await api.get("/crm/opportunities");setOpps(r.data.data||[])}catch{toast.error("Failed")}finally{setLoading(false)}};
  useEffect(()=>{fetch();api.get("/clients?limit=100").then(r=>setCompanies(r.data.data||[])).catch(()=>{})},[]);
  const totalValue=opps.filter(o=>o.stage!=="lost").reduce((s,o)=>s+(o.amount||0),0);
  const totalWon=opps.filter(o=>o.stage==="won").reduce((s,o)=>s+(o.amount||0),0);
  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();try{await api.post("/crm/opportunities",form);toast.success("Created");setShowNew(false);setForm({name:"",companyId:"",amount:0,probability:50,stage:"prospect",expectedCloseDate:"",notes:""});fetch()}catch{toast.error("Failed")}};
  const handleStageChange=async(id:string,stage:string)=>{try{await api.patch(`/crm/opportunities/${id}`,{stage});fetch()}catch{}};

  if(loading)return <div className="text-center py-20 text-gray-500">Loading pipeline...</div>;
  const stages=STAGE_ORDER.map(s=>({key:s,items:opps.filter(o=>o.stage===s)}));
  const weightedValue=opps.filter(o=>o.stage!=="lost").reduce((s,o)=>s+(o.amount*o.probability/100),0);

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-white">Sales Pipeline</h2><p className="text-sm text-gray-400">{opps.length} deals · ${totalValue.toLocaleString()} pipeline · ${totalWon.toLocaleString()} won · ${Math.round(weightedValue).toLocaleString()} weighted</p></div>
      <div className="flex items-center gap-2">
        <div className="flex bg-surface rounded-lg border border-surface-border"><button onClick={()=>setView("kanban")} className={`px-3 py-1.5 text-xs font-medium rounded-l-lg ${view==="kanban"?"bg-cyber-600/20 text-cyber-400":"text-gray-400"}`}>Kanban</button><button onClick={()=>setView("table")} className={`px-3 py-1.5 text-xs font-medium rounded-r-lg ${view==="table"?"bg-cyber-600/20 text-cyber-400":"text-gray-400"}`}>Table</button></div>
        <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>New Deal</button>
      </div>
    </div>

    {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Opportunity</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white">✕</button></div>
      <input className="input-field" placeholder="Deal name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>
      <div className="grid grid-cols-3 gap-3">
        <select className="input-field" value={form.companyId} onChange={e=>setForm({...form,companyId:e.target.value})} required><option value="">Company...</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="input-field" type="number" placeholder="Amount" value={form.amount} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/>
        <input className="input-field" type="number" placeholder="Probability %" value={form.probability} onChange={e=>setForm({...form,probability:Number(e.target.value)})}/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select className="input-field" value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{STAGE_ORDER.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</select>
        <input className="input-field" type="date" value={form.expectedCloseDate} onChange={e=>setForm({...form,expectedCloseDate:e.target.value})}/>
      </div>
      <textarea className="input-field" placeholder="Notes" rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    {view==="kanban"?(
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto">
        {stages.map(stage=>(<div key={stage.key} className="card min-w-[180px]">
          <div className="flex items-center justify-between mb-3"><span className={`badge ${STAGES[stage.key]||""} text-xs`}>{stage.key.replace(/_/g," ")}</span><span className="text-xs text-gray-600">{stage.items.length}</span></div>
          <div className="space-y-2">{stage.items.map(o=>(<div key={o.id} className="bg-surface-lighter rounded-lg p-2.5 cursor-pointer hover:ring-1 hover:ring-cyber-500/30 transition-all" draggable onDragStart={e=>e.dataTransfer.setData("oppId",o.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{const id=e.dataTransfer.getData("oppId");if(id&&stage.key!==o.stage)handleStageChange(id,stage.key)}}>
            <p className="text-sm font-medium text-white">{o.name}</p>
            <div className="flex items-center justify-between mt-2 text-xs"><span className="text-cyber-400">${(o.amount||0).toLocaleString()}</span><span className="text-gray-500">{o.probability}%</span></div>
            {o.expectedCloseDate&&<p className="text-[10px] text-gray-600 mt-1">Close: {new Date(o.expectedCloseDate).toLocaleDateString()}</p>}
          </div>))}</div>
        </div>))}
      </div>
    ):(
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Deal</th><th className="p-3">Stage</th><th className="p-3">Amount</th><th className="p-3">Prob.</th><th className="p-3">Weighted</th><th className="p-3">Close</th></tr></thead>
        <tbody>{opps.map(o=>(<tr key={o.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
          <td className="p-3 font-medium text-white">{o.name}</td><td className="p-3"><span className={`badge ${STAGES[o.stage]||""}`}>{o.stage.replace(/_/g," ")}</span></td>
          <td className="p-3">${(o.amount||0).toLocaleString()}</td><td className="p-3">{o.probability}%</td>
          <td className="p-3 text-cyber-400">${Math.round(o.amount*o.probability/100).toLocaleString()}</td>
          <td className="p-3 text-gray-400 text-xs">{o.expectedCloseDate?new Date(o.expectedCloseDate).toLocaleDateString():"—"}</td>
        </tr>))}</tbody></table></div></div>
    )}
  </div>);
}
