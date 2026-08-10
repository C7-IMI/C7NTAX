import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Calendar, Clock, Plus } from "lucide-react";

export function PTOPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: "vacation", startDate: "", endDate: "", hours: 8, reason: "" });

  const fetch = () => {
    api.get("/pto").then(r => setRequests(r.data.data || r.data || [])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = (e: any) => {
    e.preventDefault();
    api.post("/pto", form).then(() => { toast.success("Requested"); setShowCreate(false); fetch(); }).catch(() => toast.error("Failed"));
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Time Off</h2><p className="text-sm text-gray-400">{requests.length} requests</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Request Time Off</button>
      </div>
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> :
       requests.length === 0 ? <div className="card py-12 text-center text-gray-500"><Calendar size={40} className="text-gray-600 mx-auto mb-3" /><p>No PTO requests</p></div> :
       <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-4 py-3">Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Hours</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>{requests.map(r => (
            <tr key={r.id} className="border-b border-surface-border/50">
              <td className="px-4 py-3 text-white capitalize">{r.type}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.startDate).toLocaleDateString()} - {new Date(r.endDate).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-gray-400">{r.hours}h</td>
              <td className="px-4 py-3"><span className={`badge text-xs ${r.status === "approved" ? "bg-green-600/20 text-green-400" : r.status === "denied" ? "bg-red-600/20 text-red-400" : "bg-amber-600/20 text-amber-400"}`}>{r.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">Request Time Off</h3>
            <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}><option value="vacation">Vacation</option><option value="sick">Sick</option><option value="personal">Personal</option></select>
            <input className="input-field" type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} required />
            <input className="input-field" type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} required />
            <input className="input-field" type="number" placeholder="Hours" value={form.hours} onChange={e => setForm({...form, hours: Number(e.target.value)})} />
            <textarea className="input-field" rows={2} placeholder="Reason" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Submit</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
