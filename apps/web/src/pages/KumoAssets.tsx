import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Search, Monitor, Server, Laptop, Wifi, Edit3, Trash2, AlertTriangle, ExternalLink, SquareArrowOutUpRight, AppWindow, Copy, Download, RotateCw, Eraser } from "lucide-react";
import { templateIcon } from "../lib/kumoIcons";
import { KumoAssetDialog } from "../components/KumoAssetDialog";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { TableSkeleton } from "../components/ui/Skeleton";

interface KumoAsset {
  id: string; name: string; templateId: string; status: string; companyId: string | null;
  template?: { name: string; icon?: string; color?: string };
  createdAt: string;
}

export function KumoAssetsPage() {
  const [assets, setAssets] = useState<KumoAsset[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [dialog, setDialog] = useState<{ template: any; asset: any | null; clientId: string } | null>(null);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The organization rail hands us the type and client, e.g.
  // /kumo/assets?new=1&templateId=<id>&companyId=<id>
  const deepLinkApplied = useRef(false);

  const fetchAll = async () => {
    try {
      const [aRes, tRes, cRes] = await Promise.all([
        // The list is capped server-side, so the scope travels with the request —
        // filtering a page of 50 client-side shows nothing for an older client.
        api.get("/kumo/assets", {
          params: {
            companyId: searchParams.get("companyId") || undefined,
            templateId: searchParams.get("templateId") || undefined,
            limit: 500,
          },
        }),
        api.get("/kumo/templates"),
        api.get("/clients?limit=100"),
      ]);
      setAssets(aRes.data.data || []);
      const tpls = tRes.data.data || [];
      setTemplates(tpls);
      setCompanies(cRes.data.data || []);

      if (!deepLinkApplied.current) {
        const templateIdParam = searchParams.get("templateId") ?? "";
        const companyIdParam = searchParams.get("companyId") ?? "";
        if (templateIdParam && searchParams.get("new") === "1") {
          const tpl = tpls.find((t: any) => t.id === templateIdParam);
          if (tpl) {
            setDialog({ template: tpl, asset: null, clientId: companyIdParam });
            deepLinkApplied.current = true;
          }
        } else if (templateIdParam) {
          setTemplateFilter(templateIdParam);
          deepLinkApplied.current = true;
        }
      }
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const menu = useContextMenu();

  /** Client scope from the URL, e.g. /kumo/assets?companyId=<id> from an organization. */
  const companyScope = searchParams.get("companyId") ?? "";

  const filtered = assets.filter(a => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (templateFilter && a.templateId !== templateFilter) return false;
    if (companyScope && a.companyId !== companyScope) return false;
    return true;
  });

  // ── Right-click menu: Kumo Assets ──
  const csvColumns: CsvColumn<KumoAsset>[] = [
    { key: "name", label: "Asset", value: a => a.name },
    { key: "template", label: "Template", value: a => a.template?.name ?? "" },
    { key: "status", label: "Status", value: a => a.status },
    { key: "client", label: "Client", value: a => companies.find((c: any) => c.id === a.companyId)?.name ?? "" },
  ];

  const exportCsv = () => {
    if (filtered.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-kumo-assets-${fileStamp()}.csv`, toCsv(filtered, csvColumns));
    toast.success(`Exported ${filtered.length} asset${filtered.length === 1 ? "" : "s"}`);
  };

  const assetMenuHeader = (a: KumoAsset) => ({
    title: a.name,
    subtitle: [a.template?.name, a.status, companies.find((c: any) => c.id === a.companyId)?.name].filter(Boolean).join(" · "),
  });

  const assetMenuEntries = (a: KumoAsset): MenuEntry[] => {
    const path = `/kumo/assets/${a.id}`;
    const clientName = companies.find((c: any) => c.id === a.companyId)?.name;
    return [
      { label: "Open asset", icon: ExternalLink, hint: "⏎", onSelect: () => navigate(path) },
      { label: "Open in new tab", icon: SquareArrowOutUpRight, onSelect: () => openInNewTab(path) },
      { label: "Open in new window", icon: AppWindow, onSelect: () => openInNewWindow(path) },
      "separator",
      {
        label: "New asset from this template…", icon: Plus, disabled: !a.templateId,
        onSelect: () => { const tpl = templates.find((t: any) => t.id === a.templateId); startCreate(tpl, a.companyId ?? ""); },
      },
      a.companyId && {
        label: `Show only ${clientName ?? "this client"}`, icon: Monitor,
        onSelect: () => navigate(`/kumo/assets?companyId=${a.companyId}`),
      },
      "separator",
      { label: "Copy asset name", icon: Copy, onSelect: () => void copyText(a.name, "Asset name") },
      {
        label: "Copy asset details", icon: Copy,
        onSelect: () => void copyText([
          a.name,
          a.template?.name ? `Template: ${a.template.name}` : null,
          `Status: ${a.status}`,
          clientName ? `Client: ${clientName}` : null,
        ].filter(Boolean).join("\n"), "Asset details"),
      },
      "separator",
      { label: "Delete asset…", icon: Trash2, danger: true, onSelect: () => void handleDelete(a.id) },
    ].filter(Boolean) as MenuEntry[];
  };

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "New asset", icon: Plus, onSelect: () => startCreate() },
    { label: "Refresh list", icon: RotateCw, onSelect: () => void fetchAll() },
    "separator",
    {
      label: "Clear filters", icon: Eraser, disabled: !search && !templateFilter && !companyScope,
      onSelect: () => { setSearch(""); setTemplateFilter(""); if (companyScope) navigate("/kumo/assets"); },
    },
    {
      label: "Filter by template", icon: Monitor,
      items: templates.filter((t: any) => t.isActive).map((tpl: any) => ({
        label: tpl.name, checked: templateFilter === tpl.id, onSelect: () => setTemplateFilter(tpl.id),
      })),
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${filtered.length} row${filtered.length === 1 ? "" : "s"}`, disabled: filtered.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  /** Opens the type's configuration dialog — with no type chosen, the picker first. */
  const startCreate = (tpl?: any, companyId = companyScope) => {
    if (!tpl) { setTemplatePicker(true); return; }
    setDialog({ template: tpl, asset: null, clientId: companyId ?? "" });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this asset?")) return;
    try { await api.delete(`/kumo/assets/${id}`); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Kumo Assets</h2>
          <p className="text-sm text-gray-400">{filtered.length} assets</p>
        </div>
        <button onClick={() => startCreate()} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={16} /> New Asset
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={templateFilter} onChange={e => setTemplateFilter(e.target.value)}>
          <option value="">All Templates</option>
          {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {/* Templates quick-create */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {templates.filter((t:any) => t.isActive).map((tpl: any) => {
          const Icon = templateIcon(tpl.icon);
          return (
            <button key={tpl.id} onClick={() => startCreate(tpl)}
              className="card hover:border-cyber-500/30 transition-colors p-3 text-left group">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyber-600/10 group-hover:bg-cyber-600/20">
                  <Icon size={16} className="text-cyber-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white">{tpl.name}</p>
                  <p className="text-[10px] text-gray-500">{tpl.fields?.length || 0} fields</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Asset list */}
      {loading ? <TableSkeleton /> :
       filtered.length === 0 ? <div className="card text-center py-8 text-gray-500">No assets found</div> :
       <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-400">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 hidden md:table-cell">Template</th>
              <th className="px-4 py-3 hidden sm:table-cell">Status</th>
              <th className="px-4 py-3 w-20"></th>
            </tr></thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} tabIndex={0} className="border-b border-surface-border/50 hover:bg-surface-lighter/30 cursor-pointer focus:outline-none focus:bg-surface-lighter/30"
                  onClick={() => { 
                    navigate(`/kumo/assets/${a.id}`); 
                    api.post("/kumo/recently-viewed", { entityType: "asset", entityId: a.id, entityName: a.name, entityIcon: "monitor" }).catch(() => {});
                  }}
                  onContextMenu={(e) => menu.open(e, assetMenuEntries(a), assetMenuHeader(a))}
                  onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, assetMenuEntries(a), assetMenuHeader(a))}
                >
                  <td className="px-4 py-3 text-white font-medium">{a.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-400 text-xs">{a.template?.name || "—"}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`badge text-xs ${a.status === "active" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={e => { e.stopPropagation(); handleDelete(a.id); }}
                      className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {/* Create/edit modal — one dialog for every type, driven by the template */}
      {dialog && (
        <KumoAssetDialog
          template={dialog.template}
          asset={dialog.asset}
          companies={companies.map((c: any) => ({ id: c.id, name: c.name }))}
          clientId={dialog.clientId}
          onSaved={fetchAll}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Type picker — every type is described the same way once one is chosen */}
      {templatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTemplatePicker(false)}>
          <div className="card w-full max-w-3xl max-h-[85vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold text-white">New configuration</h3>
              <p className="text-xs text-gray-500">Pick the asset type — each one has its own fields.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {templates.filter((t: any) => t.isActive).map((tpl: any) => {
                const TplIcon = templateIcon(tpl.icon);
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => { setTemplatePicker(false); setDialog({ template: tpl, asset: null, clientId: companyScope }); }}
                    className="card p-3 text-left hover:border-cyber-500/30 transition-colors flex items-start gap-2.5"
                  >
                    <span className="w-7 h-7 rounded-lg grid place-items-center bg-surface-lighter shrink-0">
                      <TplIcon size={14} style={tpl.color ? { color: tpl.color } : undefined} />
                    </span>
                    <span className="min-w-0">
                      <span className="text-sm text-white block truncate">{tpl.name}</span>
                      <span className="text-xs text-gray-500 block truncate">{tpl.description || `${tpl._count?.fields ?? 0} fields`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end border-t border-surface-border pt-3">
              <button type="button" onClick={() => setTemplatePicker(false)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
