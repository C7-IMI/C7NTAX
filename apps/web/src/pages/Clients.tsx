import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Building2, Mail, Phone } from "lucide-react";

interface Company { id: string; name: string; email: string | null; phone: string | null; city: string | null; state: string | null; status: string; _count?: { tickets: number; invoices: number; users: number }; }

export function ClientsPage() {
  const [clients, setClients] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  const fetchClients = async () => {
    try {
      const res = await api.get("/clients");
      setClients(res.data.data);
    } catch { toast.error("Failed to load clients"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchClients(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/clients", form);
      toast.success("Client created");
      setShowCreate(false);
      setForm({ name: "", email: "", phone: "" });
      fetchClients();
    } catch { toast.error("Failed to create client"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Clients</h2>
          <p className="text-sm text-gray-400">{clients.length} companies</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />Add Client</button>
      </div>

      {showCreate && (
        <div className="card">
          <form onSubmit={handleCreate} className="space-y-3">
            <input className="input-field" placeholder="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <input className="input-field" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="input-field" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading clients...</div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 card">
          <Building2 size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No clients yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clients.map((c) => (
            <div key={c.id} className="card hover:border-surface-border/80 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-white">{c.name}</h3>
                <span className={`badge ${c.status === "active" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{c.status}</span>
              </div>
              <div className="space-y-1.5 text-sm text-gray-400">
                {c.email && <div className="flex items-center gap-2"><Mail size={13} />{c.email}</div>}
                {c.phone && <div className="flex items-center gap-2"><Phone size={13} />{c.phone}</div>}
                {c.city && <p>{c.city}{c.state ? `, ${c.state}` : ""}</p>}
              </div>
              {c._count && (
                <div className="flex gap-4 mt-3 pt-3 border-t border-surface-border text-xs text-gray-500">
                  <span>{c._count.tickets} tickets</span>
                  <span>{c._count.invoices} invoices</span>
                  <span>{c._count.users} users</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
