import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, FolderKanban, Calendar, ArrowRight } from "lucide-react";

interface Proj { id: string; name: string; status: string; company?: { name: string }; manager?: { firstName: string; lastName: string }; budget: number; _count?: { phases: number }; }

const STATUS_COLORS: Record<string, string> = { planning: "bg-blue-600/20 text-blue-400", active: "bg-cyber-600/20 text-cyber-400", on_hold: "bg-amber-600/20 text-amber-400", completed: "bg-green-600/20 text-green-400", cancelled: "bg-gray-600/20 text-gray-400" };

export function ProjectsPage() {
  const [projects, setProjects] = useState<Proj[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", companyId: "", description: "", budget: 0 });

  const fetch = async () => { try { const r = await api.get("/projects"); setProjects(r.data.data); } catch { toast.error("Failed"); } finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/projects", form); toast.success("Project created"); setShowNew(false); fetch(); } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Projects</h2><p className="text-sm text-gray-400">{projects.length} projects</p></div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />New Project</button>
      </div>

      {showNew && (
        <div className="card"><form onSubmit={handleCreate} className="space-y-3">
          <input className="input-field" placeholder="Project name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
          <input className="input-field" placeholder="Description (optional)" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input-field" placeholder="Company ID" value={form.companyId} onChange={e => setForm({...form, companyId: e.target.value})} required />
            <input className="input-field" type="number" placeholder="Budget" value={form.budget} onChange={e => setForm({...form, budget: Number(e.target.value)})} />
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={() => setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
        </form></div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card hover:border-surface-border/80 transition-colors cursor-pointer block">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-white">{p.name}</h3>
                <span className={`badge ${STATUS_COLORS[p.status] || ""}`}>{p.status.replace("_", " ")}</span>
              </div>
              <div className="text-sm text-gray-400 space-y-1">
                <p>{p.company?.name || "-"}</p>
                <p>Manager: {p.manager ? `${p.manager.firstName} ${p.manager.lastName}` : "Unassigned"}</p>
                <div className="flex justify-between pt-2 border-t border-surface-border"><span>{p._count?.phases || 0} phases</span><span className="text-white font-medium">${p.budget.toLocaleString()}</span></div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
