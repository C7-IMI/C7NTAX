import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Pencil } from "lucide-react";
import { kumoClientTrail, kumoTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { KumoAssetDialog } from "../components/KumoAssetDialog";

export function KumoAssetDetailPage() {
  const { id } = useParams();
  const [asset, setAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try { const r = await api.get(`/kumo/assets/${id}`); setAsset(r.data);
      if (r.data) api.post("/kumo/recently-viewed", { entityType: "asset", entityId: id!, entityName: r.data.name, entityIcon: "monitor" }).catch(() => {}); }
    catch { toast.error("Asset not found"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  // The record belongs to a client, so the trail names the client and the type
  // it was filed under rather than just "Assets".
  const client = asset?.company as { id: string; name: string } | undefined;
  useBreadcrumbTrail(
    asset
      ? client
        ? kumoClientTrail(
            client.id,
            client.name,
            { label: asset.template?.name ?? "Configurations", to: `/kumo/assets?companyId=${client.id}&templateId=${asset.templateId}` },
            { label: asset.name },
          )
        : kumoTrail({ label: "Assets", to: "/kumo/assets" }, { label: asset.name })
      : null
  );

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!asset) return <div className="text-center py-12 text-gray-500">Asset not found</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{asset.name}</h2>
          <p className="text-sm text-gray-400">
            {[asset.template?.name, client?.name, asset.status].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button onClick={() => setEditing(true)} className="btn-primary text-sm flex items-center gap-1.5">
          <Pencil size={13} /> Edit
        </button>
      </div>
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Fields</h3>
        {asset.template?.fields?.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {asset.template.fields.map((f: any) => {
              const raw = asset.values?.[f.key];
              const val = raw === null || raw === undefined || raw === "" ? "" : Array.isArray(raw) ? raw.join(", ") : String(raw);
              return (
                <div key={f.id}>
                  <label className="text-xs text-gray-500 block mb-1">
                    {f.label}{f.required && <span className="text-red-400"> *</span>}
                  </label>
                  <p className="text-sm text-white">{val || "—"}</p>
                  {f.helpText && <p className="text-[10px] text-gray-600 mt-0.5">{f.helpText}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">This type has no fields yet.</p>
        )}
      </div>

      {editing && (
        <KumoAssetDialog
          template={asset.template}
          asset={asset}
          companies={client ? [client] : []}
          clientId={client?.id}
          onSaved={load}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
