import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, BookOpen, Search, Eye, ThumbsUp } from "lucide-react";

interface Article{id:string;title:string;slug:string;excerpt?:string;status:string;visibility:string;tags:string[];viewCount:number;helpfulCount:number;updatedAt:string;}

export function KnowledgeBasePage(){
  const [articles,setArticles]=useState<Article[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({title:"",content:"",status:"draft",visibility:"internal",tags:""});
  const [selected,setSelected]=useState<Article|null>(null);

  const fetch=()=>{api.get("/kb?limit=100").then(r=>setArticles(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false))};
  useEffect(()=>{fetch()},[]);

  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();try{await api.post("/kb",{...form,tags:form.tags.split(",").map(t=>t.trim()).filter(Boolean)});toast.success("Article created");setShowNew(false);setForm({title:"",content:"",status:"draft",visibility:"internal",tags:""});fetch()}catch{toast.error("Failed")}};

  const filtered=articles.filter(a=>!search||a.title.toLowerCase().includes(search.toLowerCase())||a.tags?.some(t=>t.toLowerCase().includes(search.toLowerCase())));
  const SC:Record<string,string>={draft:"bg-gray-600/20 text-gray-400",published:"bg-green-600/20 text-green-400",archived:"bg-red-600/20 text-red-400"};
  const VC:Record<string,string>={internal:"bg-purple-600/20 text-purple-400",public:"bg-blue-600/20 text-blue-400"};

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-white">Knowledge Base</h2><p className="text-sm text-gray-400">{articles.length} articles</p></div>
      <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>New Article</button>
    </div>

    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input className="input-field pl-9" placeholder="Search articles or tags..." value={search} onChange={e=>setSearch(e.target.value)}/></div>

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Article</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white">x</button></div>
          <input className="input-field" placeholder="Title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required/>
          <textarea className="input-field" placeholder="Content (Markdown)" rows={8} value={form.content} onChange={e=>setForm({...form,content:e.target.value})} required/>
          <div className="grid grid-cols-3 gap-3">
            <select className="input-field" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="draft">Draft</option><option value="published">Published</option></select>
            <select className="input-field" value={form.visibility} onChange={e=>setForm({...form,visibility:e.target.value})}><option value="internal">Internal</option><option value="public">Public</option></select>
            <input className="input-field" placeholder="Tags (comma)" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/>
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
        </form></div>)}

        {loading?<div className="text-center py-12 text-gray-500">Loading...</div>:filtered.length===0?<div className="text-center py-12 card"><BookOpen size={40} className="text-gray-600 mx-auto mb-3"/><p className="text-gray-500">No articles</p></div>:filtered.map(a=>(<div key={a.id} className="card hover:border-cyber-500/30 transition-colors cursor-pointer group" onClick={()=>setSelected(a)}>
          <div className="flex items-start justify-between"><div className="flex-1"><h3 className="font-semibold text-white text-sm group-hover:text-cyber-400">{a.title}</h3>{a.excerpt&&<p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.excerpt}</p>}</div>
            <div className="flex items-center gap-2 shrink-0"><span className={"badge text-xs "+(SC[a.status]||"")}>{a.status}</span><span className={"badge text-xs "+(VC[a.visibility]||"")}>{a.visibility}</span></div></div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500"><span className="flex items-center gap-1"><Eye size={12}/>{a.viewCount}</span><span className="flex items-center gap-1"><ThumbsUp size={12}/>{a.helpfulCount}</span><span>{new Date(a.updatedAt).toLocaleDateString()}</span>{a.tags?.map(t=><span key={t} className="bg-surface-lighter rounded px-1.5 py-0.5 text-gray-600">{t}</span>)}</div>
        </div>))}
      </div>
      <div className="card hidden lg:block"><h3 className="text-sm font-semibold text-gray-400 mb-3">Popular Articles</h3><div className="space-y-2">{[...articles].sort((a,b)=>b.viewCount-a.viewCount).slice(0,5).map(a=>(<div key={a.id} className="flex items-center gap-2 text-xs cursor-pointer hover:text-cyber-400 text-gray-400" onClick={()=>setSelected(a)}><Eye size={11}/>{a.title}<span className="ml-auto text-gray-600">{a.viewCount}</span></div>))}</div></div>
    </div>

    {selected&&(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setSelected(null)}><div className="card w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3"><h2 className="text-lg font-semibold text-white">{selected.title}</h2><button onClick={()=>setSelected(null)} className="text-gray-500 hover:text-white">x</button></div>
      <div className="flex items-center gap-2 mb-3">{selected.tags?.map(t=><span key={t} className="badge bg-surface-lighter text-gray-400 text-xs">{t}</span>)}<span className={"badge text-xs "+(SC[selected.status]||"")}>{selected.status}</span></div>
      <div className="prose prose-invert text-sm text-gray-300 whitespace-pre-wrap">{selected.excerpt||selected.title}</div>
      <div className="flex items-center gap-4 mt-4 text-xs text-gray-500"><Eye size={12}/> {selected.viewCount} views · <ThumbsUp size={12}/> {selected.helpfulCount} helpful</div>
    </div></div>)}
  </div>);
}
