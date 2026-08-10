import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Calendar, Clock, MapPin, Plus, X, Save } from "lucide-react";

export function CalendarPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", startTime: "", endTime: "", location: "", color: "#3b82d6" });

  const fetch = async () => {
    try { const r = await api.get("/schedule"); setEntries(r.data.data || r.data || []); }
    catch { toast.error("Failed to load"); } finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/schedule", form); toast.success("Event created"); setShowCreate(false); fetch(); }
    catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Calendar</h2><p className="text-sm text-gray-400">{entries.length} events</p></div><button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Add Event</button></div>
      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> :
       entries.length === 0 ? <div className="card py-12 text-center text-gray-500"><Calendar size={40} className="text-gray-600 mx-auto mb-3" /><p>No scheduled events</p></div> :
       <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className="card flex items-start gap-3">
            <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: e.color + "20" }}><Calendar size={18} style={{ color: e.color }} /></div>
            <div className="flex-1 min-w-0"><p className="text-white font-medium text-sm">{e.title}</p>{e.description && <p className="text-xs text-gray-500 mt-0.5">{e.description}</p>}<div className="flex items-center gap-3 mt-1 text-xs text-gray-500"><span className="flex items-center gap-1"><Clock size={11} />{new Date(e.startTime).toLocaleString()}</span>{e.location && <span className="flex items-center gap-1"><MapPin size={11} />{e.location}</span>}</div></div>
          </div>
        ))}
      </div>}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Event</h3>
            <input className="input-field" placeholder="Title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            <textarea className="input-field" rows={2} placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input className="input-field" type="datetime-local" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} required /><input className="input-field" type="datetime-local" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} /></div>
            <input className="input-field" placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
            <input className="input-field" type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Create</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
