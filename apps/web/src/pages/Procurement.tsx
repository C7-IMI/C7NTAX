import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { Plus, ShoppingCart, Truck, CheckCircle, X, Building } from "lucide-react";
import { TableSkeleton } from "../components/ui/Skeleton";
import { ProductPicker } from "../components/ProductPicker";
import { PurchaseOrderDialog } from "../components/PurchaseOrderDialog";
import { PageHeader, ListViews, ListFooter } from "../components/ui";
import { useRedesign } from "../hooks/useNavigationStyle";

interface PO{id:string;poNumber:string;vendorId:string;status:string;total:number;expectedAt?:string;createdAt:string;vendor?:{name:string};}
interface POItem{description:string;quantity:number;unitPrice:number;productId?:string|null;sku?:string|null;}

export function ProcurementPage(){
  const [pos,setPos]=useState<PO[]>([]);
  const [loading,setLoading]=useState(true);
  const [showNew,setShowNew]=useState(false);
  /** The order whose detail is open. A row is a door, not a label. */
  const [openOrderId,setOpenOrderId]=useState<string|null>(null);
  const [newVendorName,setNewVendorName]=useState("");
  const [addingVendor,setAddingVendor]=useState(false);
  const [form,setForm]=useState<{vendorId:string;items:POItem[]}>({vendorId:"",items:[{description:"",quantity:1,unitPrice:0}]});
  const [vendors,setVendors]=useState<Array<{id:string;name:string}>>([]);

  const fetch=()=>{api.get("/procurement/orders?limit=50").then(r=>setPos(r.data.data||r.data||[])).catch(()=>{}).finally(()=>setLoading(false))};
  useEffect(()=>{fetch();api.get("/procurement/vendors").then(r=>setVendors(r.data||[])).catch(()=>{})},[]);

  const addItem=()=>setForm({...form,items:[...form.items,{description:"",quantity:1,unitPrice:0}]});
  const updateItem=(i:number,field:string,val:string|number)=>setForm({...form,items:form.items.map((item,idx)=>idx===i?{...item,[field]:val}:item)});
  // A line's price is what we pay the vendor, so the catalog's cost price is the default — the
  // sell price only appears for a role the API withholds cost from.
  const pickProduct=(i:number,p:{id:string;sku:string;name:string;costPrice?:number;sellPrice:number})=>setForm({...form,items:form.items.map((item,idx)=>idx===i?{...item,description:p.name,productId:p.id,sku:p.sku,unitPrice:p.costPrice??p.sellPrice}:item)});

  const handleCreate=async(e:React.FormEvent)=>{e.preventDefault();
    const subtotal=form.items.reduce((s,i)=>s+i.quantity*i.unitPrice,0);
    try{await api.post("/procurement/orders",{vendorId:form.vendorId,items:form.items.filter(i=>i.description),subtotal});toast.success("PO created");setShowNew(false);setForm({vendorId:"",items:[{description:"",quantity:1,unitPrice:0}]});fetch()}catch{toast.error("Failed")}};

  const handleReceive=async(id:string)=>{try{await api.patch("/procurement/orders/"+id,{status:"received",receivedAt:new Date().toISOString()});toast.success("Received");fetch()}catch{toast.error("Failed")}};

  /**
   * A vendor the catalog has never heard of is the usual first step of raising an order, so the
   * create form can add one rather than sending somebody to another screen to do it first.
   */
  const addVendor=async()=>{
    const name=newVendorName.trim();
    if(!name) return;
    setAddingVendor(true);
    try{
      const {data}=await api.post("/procurement/vendors",{name});
      setVendors(prev=>[...prev,data].sort((a,b)=>a.name.localeCompare(b.name)));
      setForm(f=>({...f,vendorId:data.id}));
      setNewVendorName("");
      toast.success("Vendor added");
    }catch{toast.error("Could not add the vendor")}
    finally{setAddingVendor(false)}
  };

  const SC:Record<string,string>={draft:"bg-gray-600/20 text-gray-400",ordered:"bg-blue-600/20 text-blue-400",shipped:"bg-amber-600/20 text-amber-400",received:"bg-green-600/20 text-green-400"};
  const redesign = useRedesign();
  const [view,setView]=useState("all");
  const PO_STATUSES = ["draft","ordered","shipped","received"] as const;
  const poViews = [
    { id:"all", label:"All", count: pos.length },
    ...PO_STATUSES.map(status=>({ id:status, label:status, count: pos.filter(p=>p.status===status).length })),
  ];
  const shownPos = pos.filter(p=>view==="all"||p.status===view);
  // Outstanding is what has been ordered and not received: the figure a buyer is actually tracking.
  const outstanding = pos.filter(p=>p.status!=="received").reduce((n,p)=>n+(Number(p.total)||0),0);
  const outstandingCount = pos.filter(p=>p.status!=="received").length;
  const PAGE = 25;
  const [page,setPage]=useState(1);
  const pageCount = Math.max(1, Math.ceil(shownPos.length / PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE;
  const pageRows = shownPos.slice(pageStart, pageStart + PAGE);

  return(<div className="space-y-4 animate-fade-in">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <PageHeader variant="section" title="Procurement" subtitle={<>{pos.length} purchase orders{outstandingCount > 0 ? ` · $${outstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })} outstanding` : ""}</>} />
      <button onClick={()=>setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16}/>New PO</button>
    </div>

    {redesign && pos.length > 0 && (
      <div className="flex flex-wrap items-center gap-2">
        <ListViews views={poViews} value={view} onChange={(id)=>{ setView(id); setPage(1); }} label="Purchase order views" />
        <span className="text-xs text-gray-500">{shownPos.length} shown · ${outstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })} outstanding</span>
      </div>
    )}

    {showNew&&(<div className="card"><form onSubmit={handleCreate} className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-white">New Purchase Order</h3><button type="button" onClick={()=>setShowNew(false)} className="text-gray-500 hover:text-white"><X size={18}/></button></div>
      <select className="input-field" value={form.vendorId} onChange={e=>setForm({...form,vendorId:e.target.value})} required><option value="">Select vendor...</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <div className="flex items-center gap-2">
        <input
          className="input-field flex-1 text-sm"
          placeholder="…or add a new vendor by name"
          value={newVendorName}
          onChange={e=>setNewVendorName(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); void addVendor(); } }}
        />
        <button type="button" onClick={addVendor} disabled={addingVendor||!newVendorName.trim()} className="btn-secondary text-sm disabled:opacity-40">Add vendor</button>
      </div>
      <div className="space-y-2">{form.items.map((item,i)=>(<div key={i} className="grid grid-cols-12 gap-2 items-start"><div className="col-span-5"><ProductPicker value={item.description} onValueChange={text=>setForm({...form,items:form.items.map((it,idx)=>idx===i?{...it,description:text,productId:null,sku:null}:it)})} onPick={p=>pickProduct(i,p)} pickedSku={item.sku} priceBasis="cost" placeholder="Description or catalog item"/></div><input className="input-field col-span-2" type="number" placeholder="Qty" value={item.quantity} onChange={e=>updateItem(i,"quantity",Number(e.target.value))}/><input className="input-field col-span-3" type="number" placeholder="Price" value={item.unitPrice} onChange={e=>updateItem(i,"unitPrice",Number(e.target.value))}/><span className="col-span-2 text-xs text-gray-500 self-center">${(item.quantity*item.unitPrice).toFixed(2)}</span></div>))}</div>
      <button type="button" onClick={addItem} className="text-xs text-cyber-400 hover:text-cyber-300">+ Add Line Item</button>
      <div className="flex gap-2"><button type="submit" className="btn-primary text-sm"><ShoppingCart size={14} className="inline mr-1"/>Create PO</button><button type="button" onClick={()=>setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
    </form></div>)}

    {loading?<TableSkeleton />:pos.length===0?<div className="text-center py-12 card"><ShoppingCart size={40} className="text-gray-600 mx-auto mb-3"/><p className="text-gray-500">No purchase orders</p></div>:(
      <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">PO #</th><th className="p-3">Vendor</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3 hidden md:table-cell">Created</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>{pageRows.map(po=>(<tr key={po.id}
          onClick={()=>setOpenOrderId(po.id)}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); setOpenOrderId(po.id); } }}
          tabIndex={0}
          title={`Open ${po.poNumber}`}
          className="border-b border-surface-border/50 hover:bg-surface-lighter/30 cursor-pointer focus:outline-none focus-visible:bg-surface-lighter/50">
          <td className="p-3 font-medium text-white font-mono text-xs">{po.poNumber}</td><td className="p-3 text-gray-300">{po.vendor?.name||"—"}</td>
          <td className="p-3 tabular-nums">${po.total.toFixed(2)}</td><td className="p-3"><span className={"badge text-xs "+(SC[po.status]||"")}>{po.status}</span></td>
          <td className="p-3 text-gray-400 text-xs hidden md:table-cell">{new Date(po.createdAt).toLocaleDateString()}</td>
          <td className="p-3 text-right" onClick={e=>e.stopPropagation()}>{po.status==="shipped"&&<button onClick={()=>handleReceive(po.id)} className="text-xs text-green-400 hover:text-green-300"><CheckCircle size={13} className="inline mr-1"/>Receive</button>}</td>
        </tr>))}</tbody></table></div>
        {redesign && shownPos.length > 0 && (
          <ListFooter
            from={pageStart + 1}
            to={pageStart + pageRows.length}
            total={shownPos.length}
            page={currentPage}
            pages={pageCount}
            onPage={setPage}
            note={`${outstandingCount} not yet received`}
          />
        )}
      </div>)}

    {openOrderId && (
      <PurchaseOrderDialog
        orderId={openOrderId}
        onClose={()=>setOpenOrderId(null)}
        onChanged={fetch}
      />
    )}
  </div>);
}
