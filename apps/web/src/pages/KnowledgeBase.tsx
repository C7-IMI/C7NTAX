import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, BookOpen, Search } from "lucide-react";

interface Article { id: string; title: string; slug: string; excerpt?: string; status: string; visibility: string; viewCount: number; category?: { name: string }; author?: { firstName: string; lastName: string }; tags: string[]; updatedAt: string; }

export function KnowledgeBasePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", status: "draft", visibility: "internal", categoryId: "", tags: "" });

  const fetch = async () => { try { const r = await api.get("/kb"); setArticles(r.data.data); } catch { toast.error("Failed"); } finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/kb", { ...form, tags: form.tags.split(",").map(t => t.trim()).filter(Boolean) }); toast.success("Article created"); setShowNew(false); fetch(); } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Knowledge Base</h2><p className="text-sm text-gray-400">{articles.length} articles</p></div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />New Article</button>
      </div>

      {showNew && (
        <div className="card"><form onSubmit={handleCreate} className="space-y-3">
          <input className="input-field" placeholder="Article title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
          <textarea className="input-field" placeholder="Content (Markdown)" value={form.content} onChange={e => setForm({...form, content: e.target.value})} rows={5} required />
          <div className="grid grid-cols-3 gap-3">
            <select className="input-field" value={form.status} onChange={e => setForm({...form, status: e.target.value})}><option value="draft">Draft</option><option value="published">Published</option></select>
            <select className="input-field" value={form.visibility} onChange={e => setForm({...form, visibility: e.target.value})}><option value="internal">Internal</option><option value="public">Public</option></select>
            <input className="input-field" placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm({...form, tags: e.target.value})} />
          </div>
          <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={() => setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
        </form></div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : articles.length === 0 ? (
        <div className="text-center py-12 card"><BookOpen size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No articles yet</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {articles.map(a => (
            <div key={a.id} className="card hover:border-surface-border/80 transition-colors cursor-pointer">
              <h3 className="font-semibold text-white mb-1">{a.title}</h3>
              {a.excerpt && <p className="text-sm text-gray-400 mb-2 line-clamp-2">{a.excerpt}</p>}
              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className={`badge ${a.status === "published" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>{a.status}</span>
                <span className="badge bg-cyber-600/20 text-cyber-400">{a.visibility}</span>
                {a.category && <span className="badge bg-surface-border text-gray-400">{a.category.name}</span>}
              </div>
              <div className="flex justify-between text-xs text-gray-500 pt-2 border-t border-surface-border">
                <span>{a.viewCount} views</span>
                <span>{new Date(a.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
