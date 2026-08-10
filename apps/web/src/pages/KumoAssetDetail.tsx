import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { ChevronLeft, Save } from "lucide-react";

export function KumoAssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});

  const load = async () => {
    try { const r = await api.get(`/kumo/assets/${id}`); setAsset(r.data); setValues(r.data.values || {}); }
    catch { toast.error("Asset not found"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const handleSave = async () => {
    try {
      await api.patch(`/kumo/assets/${id}`, { name: asset.name, values });
      toast.success("Saved");
      setEditing(false);
      load();
    } catch { toast.error("Save failed"); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!asset) return <div className="text-center py-12 text-gray-500">Asset not found</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center gap-2 text-sm">
        <button onClick={() => navigate("/kumo/assets")} className="text-gray-500 hover:text-white flex items-center gap-1"><ChevronLeft size={14} /> Assets</button>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{asset.name}</h2>
          <p className="text-sm text-gray-400">Template: {asset.template?.name} · Status: {asset.status}</p>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} className="btn-primary text-sm"><Save size={14} /> Save</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="btn-primary text-sm">Edit</button>
        )}
      </div>
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Fields</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {asset.template?.fields?.map((f: any) => {
            const val = values[f.key] ?? "";
            return (
              <div key={f.id}>
                <label className="text-xs text-gray-500 block mb-1">{f.label}{f.required && " *"}</label>
                {editing ? (
                  <input className="input-field text-sm" value={val} onChange={e => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} />
                ) : (
                  <p className="text-sm text-white">{val || "—"}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
