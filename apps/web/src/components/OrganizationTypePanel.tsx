import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus, Search } from "lucide-react";
import api from "../api";
import { templateIcon } from "../lib/kumoIcons";
import { timeAgo } from "../lib/format";

interface Asset {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  values?: Record<string, unknown>;
  fieldValues?: { field?: { label?: string; key?: string } }[];
}

interface Props {
  orgId: string;
  orgName: string;
  templateId: string;
  templateName: string;
  templateDescription?: string | null;
  templateIconName?: string | null;
  templateColor?: string | null;
  fieldCount: number;
}

/**
 * One client's records of a single asset type. Everything here is scoped by the
 * query, so the same screen serves every type the rail can list.
 */
export function OrganizationTypePanel({
  orgId, orgName, templateId, templateName, templateDescription, templateIconName, templateColor, fieldCount,
}: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const Icon = templateIcon(templateIconName);

  useEffect(() => {
    setLoading(true);
    api.get("/kumo/assets", { params: { templateId, companyId: orgId, limit: 200 } })
      .then((r) => setAssets(r.data?.data ?? []))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [templateId, orgId]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter((a) => {
      if (a.name.toLowerCase().includes(needle)) return true;
      const labels = (a.fieldValues ?? []).map((v) => v.field?.label ?? v.field?.key ?? "");
      return labels.some((l) => l.toLowerCase().includes(needle));
    });
  }, [assets, search]);

  const createLink = `/kumo/assets?new=1&templateId=${templateId}&companyId=${orgId}`;
  const addLabel = `Add ${templateName.replace(/s$/, "")}`;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg grid place-items-center bg-surface-lighter shrink-0">
            <Icon size={16} style={templateColor ? { color: templateColor } : undefined} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">
              {templateName} <span className="text-gray-500 font-normal">· {orgName}</span>
            </h3>
            <p className="text-xs text-gray-500">
              {assets.length} record{assets.length === 1 ? "" : "s"}
              {fieldCount > 0 && ` · ${fieldCount} field${fieldCount === 1 ? "" : "s"}`}
              {templateDescription ? ` · ${templateDescription}` : ""}
            </p>
          </div>
        </div>
        <Link to={createLink} className="btn-primary text-sm flex items-center gap-2 shrink-0">
          <Plus size={14} /> {addLabel}
        </Link>
      </div>

      {assets.length > 3 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-9 text-sm"
            placeholder={`Search ${templateName.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 py-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="py-4 space-y-2">
          <p className="text-sm text-gray-500">
            {assets.length === 0
              ? `Nothing documented for ${orgName} yet.`
              : `Nothing matches “${search}”.`}
          </p>
          {assets.length === 0 && (
            <Link to={createLink} className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1.5">
              <Plus size={12} /> {addLabel}
            </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-surface-border/50">
          {filtered.map((a) => {
            const details = (a.fieldValues ?? [])
              .map((v) => v.field?.label && a.values?.[v.field.key!] != null ? `${v.field.label}: ${String(a.values[v.field.key!])}` : null)
              .filter(Boolean)
              .slice(0, 3);
            return (
              <Link
                key={a.id}
                to={`/kumo/assets/${a.id}`}
                title={`Open ${a.name}`}
                className="flex items-center gap-3 py-2 -mx-1.5 px-1.5 rounded-lg group hover:bg-surface-lighter"
              >
                <Icon size={14} className="text-gray-500 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-gray-300 block truncate group-hover:text-cyber-300">{a.name}</span>
                  {details.length > 0 && <span className="text-[10px] text-gray-600 block truncate">{details.join(" · ")}</span>}
                </span>
                {a.status && a.status !== "active" && (
                  <span className="badge text-[10px] bg-gray-600/20 text-gray-400 shrink-0">{a.status}</span>
                )}
                <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(a.updatedAt)}</span>
                <ExternalLink size={11} className="text-gray-600 group-hover:text-cyber-400 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
