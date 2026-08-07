import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Building2, Mail, Phone, MapPin, Users, FileText, DollarSign, ChevronDown, Search } from "lucide-react";

interface Company{id:string;name:string;email?:string;phone?:string;city?:string;state?:string;clientType?:string;isActive:boolean;_count?:{tickets:number;invoices:number;users:number};}
interface Contact{id:string;firstName:string;lastName:string;email:string;phone?:string;isPrimary:boolean;}

export function ClientsPage(){
  const [clients,setClients]=useState<Company[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState("");
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({name:"",email:"",phone:"",city:"",state:""});
  const [selected,setSelected]=useState<Company|null>(null);
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [showContact,setShowContact]=useState(false);
  const [contactForm,setContactForm]=useState({firstName:"",lastName:"",email:"",phone:""});

  const fetch=()=>{api.get("/clients?limit=100").then(r=>setClients(r.data.data||[])).catch(()=>{}).finally(()=>setLoading(false))};
  useEffect(()=>{fetch()},[]);

  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();try{await api.post("/clients",form);toast.success("Client created");setShowNew(false);setForm({name:"",email:"",phone:"",city:"",state:""});fetch()}catch{toast.error("Failed")}};
  const selectClient=async(c:Company)=>{setSelected(c);try{const r=await api.get("/clients/"+c.id);setContacts(r.data.contacts||[])}catch{setContacts([])}};
  const handleAddContact=async(e:React.FormEvent)=>{e.preventDefault();if(!selected)return;try{await api.post("/clients/"+selected.id+"/contacts",contactForm);toast.success("Contact added");setShowContact(false);setContactForm({firstName:"",lastName:"",email:"",phone:""});selectClient(selected)}catch{toast.error("Failed")}};

  const filtered=clients.filter(c=>!search||c.name.toLowerCase().includes(search.toLowerCase())||c.email?.toLowerCase().includes(search.toLowerCase()));

  const CT:Record<string,string>={MSP:"bg-cyber-600/20 text-cyber-400",INT:"bg-purple-600/20 text-purple-400",INF:"bg-blue-600/20 text-blue-400"};

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-white">Clients</h2><p className="text-sm text-gray-400">{clients.length} clients</p></div>
      <div className="flex items-center gap-2">
        <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>Add Client</button>
      </div>
    </div>

    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input className="input-field pl-9" placeholder="Search clients..." value={search} onChange={e=>setSearch(e.target.value)}/></div>

    {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Client</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white">x</button></div>
      <input className="input-field" placeholder="Company name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>
      <div className="grid grid-cols-2 gap-3"><input className="input-field" placeholder="Email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><input className="input-field" placeholder="Phone" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
      <div className="grid grid-cols-2 gap-3"><input className="input-field" placeholder="City" value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/><input className="input-field" placeholder="State" value={form.state} onChange={e=>setForm({...form,state:e.target.value})}/></div>
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        {loading?<div className="text-center py-12 text-gray-500">Loading...</div>:filtered.length===0?<div className="text-center py-12 card"><Building2 size={40} className="text-gray-600 mx-auto mb-3"/><p className="text-gray-500">No clients</p></div>:filtered.map(c=>(<div key={c.id} className={`card hover:border-cyber-500/30 transition-colors cursor-pointer ${selected?.id===c.id?"border-cyber-500/30":""}`} onClick={()=>selectClient(c)}>
          <div className="flex items-start justify-between">
            <div><h3 className="font-semibold text-white text-sm">{c.name}{c.clientType&&<span className={"badge text-xs ml-2 "+(CT[c.clientType]||"")}>{c.clientType}</span>}</h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">{c.email&&<span className="flex items-center gap-1"><Mail size={11}/>{c.email}</span>}{c.phone&&<span className="flex items-center gap-1"><Phone size={11}/>{c.phone}</span>}{c.city&&<span className="flex items-center gap-1"><MapPin size={11}/>{c.city}{c.state?", "+c.state:""}</span>}</div></div>
            <span className={"w-2 h-2 rounded-full "+(c.isActive?"bg-green-400":"bg-gray-600")}/>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500"><span><FileText size={11} className="inline mr-1"/>{c._count?.tickets||0} tickets</span><span><DollarSign size={11} className="inline mr-1"/>{c._count?.invoices||0} invoices</span><span><Users size={11} className="inline mr-1"/>{c._count?.users||0} users</span></div>
        </div>))}
      </div>

      {selected&&(<div className="card">
        <h3 className="text-sm font-semibold text-white mb-2">{selected.name}</h3>
        <div className="space-y-2 text-xs text-gray-400">
          {selected.email&&<p>Email: {selected.email}</p>}
          {selected.phone&&<p>Phone: {selected.phone}</p>}
          {selected.city&&<p>Location: {selected.city}{selected.state?", "+selected.state:""}</p>}
        </div>
        <div className="mt-3 pt-3 border-t border-surface-border">
          <div className="flex items-center justify-between mb-2"><h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Contacts</h4><button onClick={()=>setShowContact(true)} className="text-xs text-cyber-400 hover:text-cyber-300"><Plus size={12} className="inline"/> Add</button></div>
          {contacts.length===0?<p className="text-xs text-gray-600">No contacts</p>:contacts.map(con=>(<div key={con.id} className="flex items-center justify-between text-xs py-1.5"><div><p className="text-white">{con.firstName} {con.lastName}</p><p className="text-gray-500">{con.email}</p></div>{con.isPrimary&&<span className="badge bg-cyber-600/20 text-cyber-400 text-[10px]">Primary</span>}</div>))}
          {showContact&&(<form onSubmit={handleAddContact} className="space-y-2 mt-2 pt-2 border-t border-surface-border">
            <div className="grid grid-cols-2 gap-2"><input className="input-field text-xs" placeholder="First" value={contactForm.firstName} onChange={e=>setContactForm({...contactForm,firstName:e.target.value})} required/><input className="input-field text-xs" placeholder="Last" value={contactForm.lastName} onChange={e=>setContactForm({...contactForm,lastName:e.target.value})} required/></div>
            <input className="input-field text-xs" placeholder="Email" type="email" value={contactForm.email} onChange={e=>setContactForm({...contactForm,email:e.target.value})} required/>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-xs">Save</button><button type="button" onClick={()=>setShowContact(false)} className="
Cancel</button></div>
          </form>)}
        </div>
      </div>)}
    </div>
  </div>);
}
