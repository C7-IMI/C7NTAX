import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Folder, FileText, ChevronRight, X, Save, Clock } from "lucide-react";

export function KumoDocumentsPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", folderId: "" });
  const [folderName, setFolderName] = useState("");
  const [viewDoc, setViewDoc] = useState<any>(null);

  const fetchAll = async () => {
    try {
      const [fRes, dRes] = await Promise.all([
        api.get("/kumo/documents/folders"),
        api.get(`/kumo/documents${selectedFolder ? `?folderId=${selectedFolder}` : ""}`),
      ]);
      setFolders(fRes.data.data || []);
      setDocuments(dRes.data.data || []);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, [selectedFolder]);

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/kumo/documents", { ...form, folderId: selectedFolder || form.folderId });
      toast.success("Document created");
      setShowCreate(false);
      setForm({ title: "", content: "", folderId: "" });
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    try {
      await api.post("/kumo/documents/folders", { name: folderName });
      toast.success("Folder created");
      setShowFolder(false);
      setFolderName("");
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  const openDoc = async (id: string) => {
    try { const r = await api.get(`/kumo/documents/${id}`); setViewDoc(r.data); 
      if (r.data) api.post("/kumo/recently-viewed", { entityType: "document", entityId: id, entityName: r.data.title, entityIcon: "book" }).catch(() => {}); }
    catch { toast.error("Failed to load"); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Kumo Documents</h2>
          <p className="text-sm text-gray-400">{documents.length} documents</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFolder(true)} className="btn-secondary text-sm flex items-center gap-1"><Folder size={14} /> New Folder</button>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> New Doc</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-1">
          <button onClick={() => setSelectedFolder(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${!selectedFolder ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white"}`}>
            All Documents
          </button>
          {folders.map(f => (
            <button key={f.id} onClick={() => setSelectedFolder(f.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${selectedFolder === f.id ? "bg-cyber-600/15 text-cyber-400" : "text-gray-400 hover:text-white"}`}>
              <Folder size={14} /> {f.name}
              {f._count?.documents > 0 && <span className="text-xs text-gray-600 ml-auto">{f._count.documents}</span>}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> :
           documents.length === 0 ? <div className="text-center py-12 card"><FileText size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No documents</p></div> :
           <div className="space-y-2">
            {documents.map(d => (
              <div key={d.id} className="card hover:border-cyber-500/30 transition-colors cursor-pointer p-4" onClick={() => openDoc(d.id)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-cyber-400 shrink-0" />
                    <div>
                      <p className="text-white font-medium text-sm">{d.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        v{d.currentVersion} · {d.status} · {d.visibility}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-600" />
                </div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-lg mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreateDoc}>
            <h3 className="text-lg font-semibold text-white">New Document</h3>
            <input className="input-field" placeholder="Title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            <textarea className="input-field" rows={8} placeholder="Content * (Markdown or HTML)" value={form.content} onChange={e => setForm({...form, content: e.target.value})} required />
            <select className="input-field" value={form.folderId} onChange={e => setForm({...form, folderId: e.target.value})}>
              <option value="">No folder</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" className="btn-primary text-sm">Create</button>
            </div>
          </form>
        </div>
      )}

      {showFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFolder(false)}>
          <div className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">New Folder</h3>
            <input className="input-field" placeholder="Folder name" value={folderName} onChange={e => setFolderName(e.target.value)} autoFocus />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowFolder(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleCreateFolder} className="btn-primary text-sm">Create</button>
            </div>
          </div>
        </div>
      )}

      {viewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setViewDoc(null)}>
          <div className="card w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{viewDoc.title}</h3>
              <button onClick={() => setViewDoc(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>v{viewDoc.currentVersion}</span>
              <span>·</span>
              <span className="badge bg-cyber-600/20 text-cyber-400">{viewDoc.status}</span>
              <span>·</span>
              <span>{viewDoc.visibility}</span>
            </div>
            <div className="bg-surface-lighter rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {viewDoc.currentContent}
            </div>
            {viewDoc.revisions?.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 mb-2">Revisions</h4>
                {viewDoc.revisions.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs py-1 text-gray-400">
                    <Clock size={11} />
                    <span>v{r.version}</span>
                    {r.changeLog && <span className="text-gray-500">— {r.changeLog}</span>}
                    <span className="ml-auto text-gray-600">{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
