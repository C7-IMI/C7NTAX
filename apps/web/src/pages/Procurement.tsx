import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, ShoppingCart, Truck, CheckCircle, X, Building } from "lucide-react";

interface PO{id:string;poNumber:string;vendorId:string;status:string;total:number;expectedAt?:string;createdAt:string;vendor?:{name:string};}

export function ProcurementPage(){
  const [pos,setPos]=useState<PO[]>([]);
  const [loading,setLoading]=useState(true);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({vendorId:"",items:[{description:"",quantity:1,unitPrice:0}]});
  const [vendors,setVendors]=useState<Array<{id:string;name:string}>>([]);

  const fetch=()=>{api.get("/procurement/orders?limit=50").then(r=>setPos(r.data.data||r.data||[])).catch(()=>{}).finally(()=>setLoading(false))};
  useEffect(()=>{fetch();api.get("/procurement/vendors").then(r=>setVendors(r.data||[])).catch(()=>{})},[]);

  const addItem=()=>setForm({...form,items:[...form.items,{description:"",quantity:1,unitPrice:0}]});
  const updateItem=(i:number,field:string,val:string|number)=>setForm({...form,items:form.items.map((item,idx)=>idx===i?{...item,[field]:val}:item)});

  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();
    const subtotal=form.items.reduce((s,i)=>s+i.quantity*i.unitPrice,0);
    try{await api.post("/procurement/orders",{vendorId:form.vendorId,items:form.items.filter(i=>i.description),subtotal});toast.success("PO created");setShowNew(false);setForm({vendorId:"",items:[{description:"",quantity:1,unitPrice:0}]});fetch()}catch{toast.error("Failed")}};

  const handleReceive=async(id:string)=>{try{await api.patch("/procurement/orders/"+id,{status:"received",receivedAt:new Date().toISOString()});toast.success("Received");fetch()}catch{toast.error("Failed")}};

  const SC:Record<string,string>={draft:"bg-gray-600/20 text-gray-400",ordered:"bg-blue-600/20 text-blue-400",shipped:"bg-amber-600/20 text-amber-400",received:"bg-green-600/20 text-green-400"};

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-lg font-semibold text-white">Procurement</h2><p className="text-sm text-gray-400">{pos.length} purchase orders</p></div>
      <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>New PO</button>
    </div>

    {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Purchase Order</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white"><X size={18}/></button></div>
      <select className="input-field" value={form.vendorId} onChange={e=>setForm({...form,vendorId:e.target.value})} required><option value="">Select vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <div className="space-y-2">{form.items.map((item,i)=>(<div key={i} className="grid grid-cols-12 gap-2"><input className="input-field col-span-5" placeholder="Description" value={item.description} onChange={e=>updateItem(i,"description",e.target.value)}/><input className="input-field col-span-2" type="number" placeholder="Qty" value={item.quantity} onChange={e=>updateItem(i,"quantity",Number(e.target.value))}/><input className="input-field col-span-3" type="number" placeholder="Price" value={item.unitPrice} onChange={e=>updateItem(i,"unitPrice",Number(e.target.value))}/><span className="col-span-2 text-xs text-gray-500 self-center">${(item.quantity*item.unitPrice).toFixed(2)}</span></div>))}</div>
      <button type="button" onClick={addItem} className="text-xs text-cyber-400 hover:text-cyber-300">+ Add Line Item</button>
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm"><ShoppingCart size={14} className="inline mr-1"/>Create PO</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    {loading?<div className="text-center py-12 text-gray-500">Loading...</div>:pos.length===0?<div className="text-center py-12 card"><ShoppingCart size={40} className="text-gray-600 mx-auto mb-3"/><p className="text-gray-500">No purchase orders</p></div>:(
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">PO #</th><th className="p-3">Vendor</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3 hidden md:table-cell">Created</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>{pos.map(po=>(<tr key={po.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
          <td className="p-3 font-medium text-white font-mono text-xs">{po.poNumber}</td><td className="p-3 text-gray-300">{po.vendor?.name||"—"}</td>
          <td className="p-3">${po.total.toFixed(2)}</td><td className="p-3"><span className={"badge text-xs "+(SC[po.status]||"")}>{po.status}</span></td>
          <td className="p-3 text-gray-400 text-xs hidden md:table-cell">{new Date(po.createdAt).toLocaleDateString()}</td>
          <td className="p-3 text-right">{po.status==="shipped"&&<button onClick={()=>handleReceive(po.id)} className="text-xs text-green-400 hover:text-green-300"><CheckCircle size={13} className="inline mr-1"/>Receive</button>}</td>
        </tr>))}</tbody></table></div></div>)}
  </div>);
}
