import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Shield, Eye, EyeOff, Search, X, Save, Clock } from "lucide-react";

export function KumoPasswordsPage() {
  const [passwords, setPasswords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ label: "", username: "", password: "", email: "", url: "", category: "" });
  const [reveal, setReveal] = useState<string | null>(null);
  const [revealData, setRevealData] = useState<any>(null);

  const fetch = async () => {
    try { const r = await api.get("/kumo/passwords"); setPasswords(r.data.data || []); }
    catch { toast.error("Failed to load passwords"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/kumo/passwords", form); toast.success("Password saved"); setShowCreate(false); setForm({ label: "", username: "", password: "", email: "", url: "", category: "" }); fetch(); }
    catch { toast.error("Failed"); }
  };

  const handleReveal = async (id: string) => {
    try { const r = await api.post(`/kumo/passwords/${id}/reveal`); setRevealData(r.data); setReveal(id); setTimeout(() => { setReveal(null); setRevealData(null); }, 30000); }
    catch { toast.error("Access denied or reveal failed"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate?")) return;
    try { await api.delete(`/kumo/passwords/${id}`); toast.success("Deactivated"); fetch(); }
    catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Password Vault</h2><p className="text-sm text-gray-400">{passwords.length} passwords</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Add Password</button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Password</h3>
            <input className="input-field" placeholder="Label *" value={form.label} onChange={e => setForm({...form, label: e.target.value})} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field" placeholder="Username" value={form.username} onChange={e => setForm({...form, username: e.target.value})} />
              <input className="input-field" placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
            </div>
            <input className="input-field" type="password" placeholder="Password *" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required />
            <input className="input-field" placeholder="URL" value={form.url} onChange={e => setForm({...form, url: e.target.value})} />
            <input className="input-field" placeholder="Category" value={form.category} onChange={e => setForm({...form, category: e.target.value})} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Save</button></div>
          </form>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : passwords.length === 0 ? (
        <div className="text-center py-12 card"><Shield size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No passwords stored</p></div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-4 py-3">Label</th><th className="px-4 py-3 hidden sm:table-cell">Username</th><th className="px-4 py-3 hidden md:table-cell">Category</th><th className="px-4 py-3 w-24">Actions</th></tr></thead>
            <tbody>
              {passwords.map(p => (
                <tr key={p.id} className="border-b border-surface-border/50 hover:bg-surface-light/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-cyber-400" />
                      <span className="text-white">{p.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-400">{p.username || "—"}</td>
                  <td className="px-4 py-3 hidden md:table-cell"><span className="badge bg-cyber-600/15 text-cyber-400">{p.category || "general"}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleReveal(p.id)} className="p-1 text-gray-500 hover:text-cyber-400" title="Reveal"><Eye size={14} /></button>
                      <button onClick={() => handleDelete(p.id)} className="p-1 text-gray-500 hover:text-red-400"><X size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reveal && revealData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setReveal(null); setRevealData(null); }}>
          <div className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">{revealData.label}</h3>
            <div className="bg-surface-lighter rounded-lg p-3 space-y-2 text-sm">
              <div><span className="text-gray-500 text-xs">Username</span><p className="text-white">{revealData.username || "—"}</p></div>
              <div><span className="text-gray-500 text-xs">Password</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="bg-black/30 px-3 py-1.5 rounded text-green-400 font-mono text-sm flex-1 select-all">{revealData.passwordPlaintext}</code>
                </div>
              </div>
            </div>
            <p className="text-xs text-amber-400 flex items-center gap-1"><Clock size={12} /> Auto-clears in 30 seconds. This access is logged.</p>
            <button onClick={() => { setReveal(null); setRevealData(null); }} className="btn-secondary w-full text-sm">Close & Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
