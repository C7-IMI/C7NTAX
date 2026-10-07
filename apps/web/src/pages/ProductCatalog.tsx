import { useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { apiErrorMessage } from "../lib/apiError";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { copyText, viewMenuEntries } from "../lib/menuActions";
import { TableSkeleton } from "../components/ui/Skeleton";
import { useAuth } from "../hooks/useAuth";
import { Permission } from "@C7NTAX/shared";
import {
  Boxes, Plus, Search, Package, Cpu, KeyRound, RefreshCw, Wrench, Layers, AlertTriangle,
  Pencil, Copy, Trash2, Power, PackagePlus, PackageMinus, Download, RotateCw, Eraser, Filter, X,
} from "lucide-react";

/**
 * Administration → Product Catalog.
 *
 * The shape follows what Autotask, ConnectWise and Scoro converge on: a type that says what the
 * thing *is* (hardware, software, licence, subscription, service, bundle), a category to filter
 * by, a unit to price in, cost and sell prices kept apart, an optional recurring billing period,
 * and optional stock with a reorder point.
 *
 * Two things it insists on visually, because they are the point of the page:
 *   · cost and margin appear only for roles that hold `product:manage` — the API decides this and
 *     the page never assumes either way;
 *   · a product that is in use cannot be deleted, and the dialog says which record holds it.
 */

interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  productType: string;
  category?: string | null;
  subcategory?: string | null;
  manufacturer?: string | null;
  vendorId?: string | null;
  vendor?: { id: string; name: string } | null;
  vendorSku?: string | null;
  unit: string;
  costPrice?: number;
  sellPrice: number;
  billingPeriod: string;
  taxable: boolean;
  isActive: boolean;
  trackStock: boolean;
  stockOnHand: number;
  reorderPoint?: number | null;
  reorderQuantity?: number | null;
  warrantyMonths?: number | null;
  purchaseUrl?: string | null;
  notes?: string | null;
  margin?: number;
  marginPercent?: number;
  annualValue?: number;
  belowReorderPoint?: boolean;
  usage?: { quoteLines: number; poLines: number; invoiceLines: number; total: number };
}

interface FilterOptions {
  productTypes: string[];
  billingPeriods: string[];
  units: string[];
  categories: string[];
  manufacturers: string[];
  countsByType: Record<string, number>;
  lowStock: number;
}

const TYPE_META: Record<string, { label: string; icon: typeof Package; classes: string }> = {
  hardware: { label: "Hardware", icon: Cpu, classes: "bg-blue-600/20 text-blue-400" },
  software: { label: "Software", icon: Boxes, classes: "bg-purple-600/20 text-purple-400" },
  license: { label: "Licence", icon: KeyRound, classes: "bg-amber-600/20 text-amber-400" },
  subscription: { label: "Subscription", icon: RefreshCw, classes: "bg-cyber-600/20 text-cyber-400" },
  service: { label: "Service", icon: Wrench, classes: "bg-green-600/20 text-green-400" },
  bundle: { label: "Bundle", icon: Layers, classes: "bg-pink-600/20 text-pink-400" },
  other: { label: "Other", icon: Package, classes: "bg-gray-600/20 text-gray-400" },
};

const PERIOD_LABEL: Record<string, string> = { none: "One-off", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

/** How many times a recurring price is charged in a year — the figure both the API and this page report. */
const periodMultiplier = (period: string): number => ({ monthly: 12, quarterly: 4, annual: 1 } as Record<string, number>)[period] ?? 0;

/** The badge metadata for a type, with a guaranteed fallback for one the API does not offer. */
const typeMeta = (productType: string) => TYPE_META[productType] ?? TYPE_META.other ?? { label: productType, icon: Package, classes: "bg-gray-600/20 text-gray-400" };

const emptyForm = {
  name: "", sku: "", description: "", productType: "hardware", category: "", subcategory: "",
  manufacturer: "", vendorId: "", vendorSku: "", unit: "each", costPrice: 0, sellPrice: 0,
  billingPeriod: "none", taxable: true, isActive: true, trackStock: false, stockOnHand: 0,
  reorderPoint: "", reorderQuantity: "", warrantyMonths: "", purchaseUrl: "", notes: "",
};

export function ProductCatalogPage() {
  const { permissions } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const canCreate = permissions.includes(Permission.ProductCreate);
  const canEdit = permissions.includes(Permission.ProductEdit);
  const canDelete = permissions.includes(Permission.ProductDelete);
  const canManageCost = permissions.includes(Permission.ProductManage);

  const fetchProducts = () => {
    let url = "/products?limit=500";
    if (typeFilter) url += `&type=${encodeURIComponent(typeFilter)}`;
    if (categoryFilter) url += `&category=${encodeURIComponent(categoryFilter)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (lowStockOnly) url += "&lowStock=true";
    else if (!showInactive) url += "&active=true";
    api.get(url)
      .then(r => setProducts(r.data?.data || []))
      .catch(e => toast.error(apiErrorMessage(e, "Could not load the catalog")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, [typeFilter, categoryFilter, search, showInactive, lowStockOnly]);
  useEffect(() => {
    api.get("/products/filters").then(r => setFilters(r.data)).catch(() => {});
    api.get("/products/suppliers").then(r => setVendors(r.data?.data || [])).catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku, description: p.description ?? "", productType: p.productType,
      category: p.category ?? "", subcategory: p.subcategory ?? "", manufacturer: p.manufacturer ?? "",
      vendorId: p.vendorId ?? "", vendorSku: p.vendorSku ?? "", unit: p.unit,
      costPrice: p.costPrice ?? 0, sellPrice: p.sellPrice, billingPeriod: p.billingPeriod,
      taxable: p.taxable, isActive: p.isActive, trackStock: p.trackStock, stockOnHand: p.stockOnHand,
      reorderPoint: p.reorderPoint ?? "", reorderQuantity: p.reorderQuantity ?? "",
      warrantyMonths: p.warrantyMonths ?? "", purchaseUrl: p.purchaseUrl ?? "", notes: p.notes ?? "",
    });
    setShowForm(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      // Empty strings mean "not set" for the numeric optionals; the API rejects "" as a number.
      for (const key of ["reorderPoint", "reorderQuantity", "warrantyMonths"]) {
        payload[key] = payload[key] === "" || payload[key] === null ? null : Number(payload[key]);
      }
      if (!payload.sku) delete payload.sku;
      if (!canManageCost) delete payload.costPrice;
      if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        toast.success(`${payload.name} updated`);
      } else {
        await api.post("/products", payload);
        toast.success(`${payload.name} added to the catalog`);
      }
      setShowForm(false);
      fetchProducts();
      api.get("/products/filters").then(r => setFilters(r.data)).catch(() => {});
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Could not save the product"));
    } finally { setSaving(false); }
  };

  const toggleActive = async (p: Product) => {
    try {
      await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
      toast.success(`${p.name} ${p.isActive ? "retired" : "back in the catalog"}`);
      fetchProducts();
    } catch (e: unknown) { toast.error(apiErrorMessage(e, "Could not change that product")); }
  };

  const duplicate = async (p: Product) => {
    try {
      const r = await api.post(`/products/${p.id}/duplicate`);
      toast.success(`Copied ${p.name} — edit the copy to make the variation`);
      fetchProducts();
      openEdit(r.data);
    } catch (e: unknown) { toast.error(apiErrorMessage(e, "Could not copy that product")); }
  };

  const adjustStock = async (p: Product, delta: number) => {
    try {
      const r = await api.post(`/products/${p.id}/stock`, { delta, reason: delta > 0 ? "Received" : "Issued" });
      toast.success(`${p.name}: ${r.data.stockOnHand} on hand`);
      fetchProducts();
    } catch (e: unknown) { toast.error(apiErrorMessage(e, "Could not adjust stock")); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/products/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      fetchProducts();
    } catch (e: unknown) {
      // A 409 names the record that holds it — surface that instead of a flat failure.
      toast.error(apiErrorMessage(e, "Could not delete that product"));
      setDeleting(null);
    }
  };

  const rows = useMemo(
    () => sortData(products, sort?.field || "name", sort?.direction || "asc"),
    [products, sort],
  );

  const totals = useMemo(() => {
    const active = products.filter(p => p.isActive).length;
    const recurring = products.filter(p => p.billingPeriod !== "none").length;
    const oneOff = products.filter(p => p.billingPeriod === "none").length;
    const low = products.filter(p => p.belowReorderPoint).length;
    const monthly = products
      .filter(p => p.billingPeriod === "monthly")
      .reduce((sum, p) => sum + p.sellPrice, 0);
    return { active, recurring, oneOff, low, monthly };
  }, [products]);

  // The cards count the rows on screen, so their wording says so once a filter narrows the list.
  const isFiltered = Boolean(search || typeFilter || categoryFilter || lowStockOnly);

  const csvColumns: CsvColumn<Product>[] = [
    { key: "sku", label: "SKU", value: p => p.sku },
    { key: "name", label: "Name", value: p => p.name },
    { key: "type", label: "Type", value: p => p.productType },
    { key: "category", label: "Category", value: p => p.category ?? "" },
    { key: "unit", label: "Unit", value: p => p.unit },
    ...(canManageCost ? [{ key: "cost", label: "Cost", value: (p: Product) => p.costPrice ?? "" } as CsvColumn<Product>] : []),
    { key: "sell", label: "Sell", value: p => p.sellPrice },
    { key: "period", label: "Billing", value: p => PERIOD_LABEL[p.billingPeriod] ?? p.billingPeriod },
    { key: "taxable", label: "Taxable", value: p => (p.taxable ? "yes" : "no") },
    { key: "stock", label: "Stock", value: p => (p.trackStock ? p.stockOnHand : "") },
    { key: "active", label: "Active", value: p => (p.isActive ? "yes" : "no") },
  ];

  const exportCsv = () => {
    if (rows.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-product-catalog-${fileStamp()}.csv`, toCsv(rows, csvColumns));
    toast.success(`Exported ${rows.length} product${rows.length === 1 ? "" : "s"}`);
  };

  const menu = useContextMenu();

  const productMenuEntries = (p: Product): MenuEntry[] => [
    canEdit && { label: "Edit product", icon: Pencil, hint: "⏎", onSelect: () => openEdit(p) },
    canCreate && { label: "Duplicate as a variation", icon: Copy, onSelect: () => void duplicate(p) },
    "separator",
    p.trackStock && canManageCost && { label: "Receive stock (+1)", icon: PackagePlus, onSelect: () => void adjustStock(p, 1) },
    p.trackStock && canManageCost && { label: "Issue stock (−1)", icon: PackageMinus, onSelect: () => void adjustStock(p, -1) },
    canEdit && {
      label: p.isActive ? "Retire from the catalog" : "Put back in the catalog",
      icon: Power, onSelect: () => void toggleActive(p),
    },
    "separator",
    { label: "Copy SKU", icon: Copy, onSelect: () => void copyText(p.sku, "SKU") },
    { label: "Copy name", icon: Copy, onSelect: () => void copyText(p.name, "Name") },
    canDelete && { label: "Delete…", icon: Trash2, danger: true, onSelect: () => setDeleting(p) },
  ].filter(Boolean) as MenuEntry[];

  const sectionMenuEntries = (): MenuEntry[] => ([
    canCreate && { label: "Add a product…", icon: Plus, onSelect: openCreate },
    { label: "Refresh the catalog", icon: RotateCw, onSelect: fetchProducts },
    "separator",
    { label: "Clear filters", icon: Eraser, disabled: !search && !typeFilter && !categoryFilter && !lowStockOnly, onSelect: () => { setSearch(""); setTypeFilter(""); setCategoryFilter(""); setLowStockOnly(false); } },
    { label: "Sort by", icon: Filter, items: [
      { label: "Name", checked: sort?.field === "name", onSelect: () => setSort({ field: "name", direction: "asc" }) },
      { label: "SKU", checked: sort?.field === "sku", onSelect: () => setSort({ field: "sku", direction: "asc" }) },
      ...(canManageCost ? [{ label: "Margin", checked: sort?.field === "margin", onSelect: () => setSort({ field: "margin", direction: "desc" }) }] : []),
      { label: "Sell price", checked: sort?.field === "sellPrice", onSelect: () => setSort({ field: "sellPrice", direction: "desc" }) },
      { label: "Stock", checked: sort?.field === "stockOnHand", onSelect: () => setSort({ field: "stockOnHand", direction: "asc" }) },
      { label: "Type", checked: sort?.field === "productType", onSelect: () => setSort({ field: "productType", direction: "asc" }) },
    ] },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${rows.length} row${rows.length === 1 ? "" : "s"}`, disabled: rows.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ].filter(Boolean) as MenuEntry[]);

  return (
    <div className="space-y-4 animate-fade-in" onContextMenu={e => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}>
      <ContextMenu state={menu.menuState} onClose={menu.close} />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Product Catalog</h2>
          <p className="text-sm text-gray-400">Everything you sell or reorder — hardware, software, licences, subscriptions and services</p>
        </div>
        {canCreate && <button onClick={openCreate} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Add Product</button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard icon={Package} label={isFiltered ? "Matching" : "In the catalog"} value={String(products.length)} />
        <SummaryCard icon={Power} label={isFiltered ? "Active in view" : "Active"} value={String(totals.active)} color="text-green-400" />
        <SummaryCard icon={RefreshCw} label={isFiltered ? "Recurring in view" : "Recurring"} value={String(totals.recurring)} color="text-cyber-400" />
        <SummaryCard icon={AlertTriangle} label="Below reorder point" value={String(totals.low)} color={totals.low ? "text-amber-400" : "text-gray-400"} />
        <SummaryCard icon={Boxes} label="Monthly list value" value={`$${totals.monthly.toFixed(2)}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-9"
            placeholder="Search SKU, name, manufacturer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search the catalog"
          />
        </div>
        <select className="input-field text-sm py-1.5 w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {(filters?.productTypes || Object.keys(TYPE_META)).map(t => (
            <option key={t} value={t}>{TYPE_META[t]?.label ?? t}{filters?.countsByType?.[t] ? ` (${filters.countsByType[t]})` : ""}</option>
          ))}
        </select>
        <select className="input-field text-sm py-1.5 w-auto" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {(filters?.categories || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} /> Low stock only
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Include retired
        </label>
      </div>

      {(search || typeFilter || categoryFilter || lowStockOnly) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 flex items-center gap-1"><Filter size={12} /> Filtered by</span>
          {search && <button className="badge bg-cyber-600/15 text-cyber-300 flex items-center gap-1" onClick={() => setSearch("")}>Search: {search} <X size={12} /></button>}
          {typeFilter && <button className="badge bg-cyber-600/15 text-cyber-300 flex items-center gap-1" onClick={() => setTypeFilter("")}>Type: {typeMeta(typeFilter).label} <X size={12} /></button>}
          {categoryFilter && <button className="badge bg-cyber-600/15 text-cyber-300 flex items-center gap-1" onClick={() => setCategoryFilter("")}>Category: {categoryFilter} <X size={12} /></button>}
          {lowStockOnly && <button className="badge bg-cyber-600/15 text-cyber-300 flex items-center gap-1" onClick={() => setLowStockOnly(false)}>Low stock <X size={12} /></button>}
        </div>
      )}

      {loading ? <TableSkeleton /> : rows.length === 0 ? (
        <div className="card text-center py-12">
          <Package size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No products match this view.</p>
          <p className="text-xs text-gray-600 mt-1">{search || typeFilter || categoryFilter || lowStockOnly ? "Clear a filter to see more." : "Add the first item to build the catalog."}</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="group"><tr className="border-b border-surface-border text-left text-gray-400">
                <SortableHeader field="sku" label="SKU" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3" />
                <SortableHeader field="name" label="Product" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3" />
                <SortableHeader field="productType" label="Type" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3 hidden sm:table-cell" />
                <th className="px-4 py-3 hidden lg:table-cell">Category</th>
                {canManageCost && <SortableHeader field="costPrice" label="Cost" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3 hidden md:table-cell" />}
                <SortableHeader field="sellPrice" label="Sell" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3" />
                {canManageCost && <SortableHeader field="margin" label="Margin" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />}
                <th className="px-4 py-3 hidden md:table-cell">Billing</th>
                <SortableHeader field="stockOnHand" label="Stock" sort={sort} onSort={f => setSort(nextSort(sort, f))} className="px-4 py-3 hidden sm:table-cell" />
                <th className="px-4 py-3 w-16"></th>
              </tr></thead>
              <tbody>
                {rows.map(p => {
                  const meta = typeMeta(p.productType);
                  const Icon = meta.icon;
                  return (
                    <tr key={p.id} tabIndex={0}
                      className={`border-b border-surface-border/50 hover:bg-surface-light/50 cursor-pointer focus:outline-none focus:bg-surface-light/50 ${p.isActive ? "" : "opacity-60"}`}
                      onClick={() => canEdit && openEdit(p)}
                      onContextMenu={e => menu.open(e, productMenuEntries(p), { title: p.name, subtitle: [p.sku, meta.label, `$${p.sellPrice.toFixed(2)}`].join(" · ") })}
                      onKeyDown={e => menu.onKeyDown(e, e.currentTarget, productMenuEntries(p), { title: p.name, subtitle: p.sku })}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-300">{p.sku}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`badge text-xs flex items-center gap-1 ${meta.classes}`}><Icon size={11} /> {meta.label}</span>
                          <span className="text-white">{p.name}</span>
                        </div>
                        {p.manufacturer || p.vendor?.name ? <p className="text-xs text-gray-500 mt-0.5">{[p.manufacturer, p.vendor?.name].filter(Boolean).join(" · ")}</p> : null}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-400">{meta.label}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-400">{p.category || "—"}</td>
                      {canManageCost && <td className="px-4 py-3 hidden md:table-cell text-gray-300">${(p.costPrice ?? 0).toFixed(2)}</td>}
                      <td className="px-4 py-3 text-white">
                        ${p.sellPrice.toFixed(2)}
                        <span className="text-xs text-gray-500"> / {p.unit}</span>
                      </td>
                      {canManageCost && (
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className={p.marginPercent !== undefined && p.marginPercent < 15 ? "text-amber-400" : "text-gray-300"}>
                            ${(p.margin ?? 0).toFixed(2)} <span className="text-xs">({p.marginPercent ?? 0}%)</span>
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 hidden md:table-cell text-gray-400">
                        {PERIOD_LABEL[p.billingPeriod] ?? p.billingPeriod}
                        {p.annualValue ? <span className="text-xs text-gray-500"> · ${p.annualValue.toFixed(0)}/yr</span> : null}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {p.trackStock
                          ? <span className={p.belowReorderPoint ? "text-amber-400 flex items-center gap-1" : "text-gray-300"}>
                              {p.belowReorderPoint && <AlertTriangle size={12} />} {p.stockOnHand}
                              {p.reorderPoint ? <span className="text-xs text-gray-500"> / rp {p.reorderPoint}</span> : null}
                            </span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {canEdit && <button onClick={() => openEdit(p)} className="p-1.5 text-gray-400 hover:text-white" title="Edit"><Pencil size={14} /></button>}
                          {canDelete && <button onClick={() => setDeleting(p)} className="p-1.5 text-gray-400 hover:text-red-400" title="Delete"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <form className="card w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()} onSubmit={save}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{editing ? `Edit ${editing.name}` : "Add a product"}</h3>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-xs uppercase tracking-wider text-gray-500">What it is</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Field label="Name *"><input className="input-field" required maxLength={160} value={String(form.name)} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dell Latitude 5450, 14-inch" /></Field></div>
                <Field label="SKU" hint="Left blank, one is generated from the name">
                  <input className="input-field font-mono text-sm" value={String(form.sku)} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="HW-LAPTOP-14" />
                </Field>
                <Field label="Type">
                  <select className="input-field" value={String(form.productType)} onChange={e => setForm({ ...form, productType: e.target.value })}>
                    {(filters?.productTypes || Object.keys(TYPE_META)).map(t => <option key={t} value={t}>{typeMeta(t).label}</option>)}
                  </select>
                </Field>
                <Field label="Category" hint="Groups the catalog, e.g. Networking">
                  <input className="input-field" list="catalog-categories" value={String(form.category)} onChange={e => setForm({ ...form, category: e.target.value })} />
                  <datalist id="catalog-categories">{(filters?.categories || []).map(c => <option key={c} value={c} />)}</datalist>
                </Field>
                <Field label="Subcategory"><input className="input-field" value={String(form.subcategory)} onChange={e => setForm({ ...form, subcategory: e.target.value })} /></Field>
                <Field label="Manufacturer">
                  <input className="input-field" list="catalog-manufacturers" value={String(form.manufacturer)} onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
                  <datalist id="catalog-manufacturers">{(filters?.manufacturers || []).map(m => <option key={m} value={m} />)}</datalist>
                </Field>
                <Field label="Unit">
                  <select className="input-field" value={String(form.unit)} onChange={e => setForm({ ...form, unit: e.target.value })}>
                    {(filters?.units || ["each"]).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
                <div className="col-span-2"><Field label="Description"><textarea className="input-field text-sm" rows={2} value={String(form.description)} onChange={e => setForm({ ...form, description: e.target.value })} /></Field></div>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs uppercase tracking-wider text-gray-500">Pricing</legend>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {canManageCost ? (
                  <Field label="Cost price">
                    <input className="input-field" type="number" step="0.01" min="0" value={String(form.costPrice)} onChange={e => setForm({ ...form, costPrice: e.target.value })} />
                  </Field>
                ) : (
                  <div className="col-span-2 text-xs text-gray-500 self-end pb-2">Cost and margin are managed by roles with catalog management access.</div>
                )}
                <Field label="Sell price"><input className="input-field" type="number" step="0.01" min="0" required value={String(form.sellPrice)} onChange={e => setForm({ ...form, sellPrice: e.target.value })} /></Field>
                <Field label="Billing">
                  <select className="input-field" value={String(form.billingPeriod)} onChange={e => setForm({ ...form, billingPeriod: e.target.value })}>
                    {(filters?.billingPeriods || ["none", "monthly", "quarterly", "annual"]).map(p => <option key={p} value={p}>{PERIOD_LABEL[p] ?? p}</option>)}
                  </select>
                </Field>
                <Field label="Taxable">
                  <label className="flex items-center gap-2 text-sm text-gray-300 mt-2">
                    <input type="checkbox" checked={Boolean(form.taxable)} onChange={e => setForm({ ...form, taxable: e.target.checked })} /> Charge tax on this item
                  </label>
                </Field>
              </div>
              {canManageCost && Number(form.sellPrice) > 0 && (
                <p className="text-xs text-gray-500">
                  Margin: ${(Number(form.sellPrice) - Number(form.costPrice || 0)).toFixed(2)}
                  {" "}({(((Number(form.sellPrice) - Number(form.costPrice || 0)) / Number(form.sellPrice)) * 100).toFixed(1)}%)
                  {String(form.billingPeriod) !== "none" && Number(form.sellPrice) > 0 && (
                    <> · {PERIOD_LABEL[String(form.billingPeriod)]} equivalent ${(Number(form.sellPrice) * periodMultiplier(String(form.billingPeriod))).toFixed(2)} a year</>
                  )}
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs uppercase tracking-wider text-gray-500">Stock & supplier</legend>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Stocked">
                  <label className="flex items-center gap-2 text-sm text-gray-300 mt-2">
                    <input type="checkbox" checked={Boolean(form.trackStock)} onChange={e => setForm({ ...form, trackStock: e.target.checked })} /> Track quantity on hand
                  </label>
                </Field>
                {Boolean(form.trackStock) && (
                  <>
                    <Field label="On hand"><input className="input-field" type="number" min="0" value={String(form.stockOnHand)} onChange={e => setForm({ ...form, stockOnHand: e.target.value })} /></Field>
                    <Field label="Reorder point" hint="Flag it when stock reaches this"><input className="input-field" type="number" min="0" value={String(form.reorderPoint)} onChange={e => setForm({ ...form, reorderPoint: e.target.value })} /></Field>
                    <Field label="Reorder quantity"><input className="input-field" type="number" min="0" value={String(form.reorderQuantity)} onChange={e => setForm({ ...form, reorderQuantity: e.target.value })} /></Field>
                  </>
                )}
                <Field label="Supplier">
                  <select className="input-field" value={String(form.vendorId)} onChange={e => setForm({ ...form, vendorId: e.target.value })}>
                    <option value="">— none —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </Field>
                <Field label="Supplier part number"><input className="input-field font-mono text-sm" value={String(form.vendorSku)} onChange={e => setForm({ ...form, vendorSku: e.target.value })} /></Field>
                <Field label="Warranty (months)"><input className="input-field" type="number" min="0" value={String(form.warrantyMonths)} onChange={e => setForm({ ...form, warrantyMonths: e.target.value })} /></Field>
                <Field label="Purchase link"><input className="input-field text-sm" type="url" placeholder="https://" value={String(form.purchaseUrl)} onChange={e => setForm({ ...form, purchaseUrl: e.target.value })} /></Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs uppercase tracking-wider text-gray-500">Notes & availability</legend>
              <Field label="Internal notes"><textarea className="input-field text-sm" rows={2} value={String(form.notes)} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={Boolean(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                Available to quote, ticket and order (unchecked retires it without deleting it)
              </label>
            </fieldset>

            <div className="flex items-center justify-between pt-2 border-t border-surface-border">
              <div className="text-xs text-gray-500">
                {editing?.usage?.total ? `Used by ${editing.usage.quoteLines} quote line(s), ${editing.usage.poLines} order line(s), ${editing.usage.invoiceLines} invoice line(s)` : "Not used on any quote, order or invoice yet"}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add to catalog"}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleting(null)}>
          <div className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white">Delete {deleting.name}?</h3>
            <p className="text-sm text-gray-400">
              Deleting removes it from the catalog for good. If it has been quoted, ordered or billed, retire it instead —
              the API refuses the delete and says which record holds it.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn-primary" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color = "text-white" }: { icon: typeof Package; label: string; value: string; color?: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className="p-2 rounded-lg bg-cyber-600/10"><Icon size={18} className="text-cyber-400" /></div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-lg font-semibold ${color}`}>{value}</p>
      </div>
    </div>
  );
}
