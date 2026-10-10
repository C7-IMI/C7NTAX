import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Globe, Lock, CalendarClock, Building2, RefreshCw, ExternalLink, ShieldCheck, SquareArrowOutUpRight, AppWindow, Copy, Download, Eraser, CalendarX } from "lucide-react";
import { daysUntil, formatDate, formatDateShort } from "../lib/format";
import { kumoClientTrail, kumoTrail, useBreadcrumbTrail } from "../components/Breadcrumbs";
import { ContextMenu, useContextMenu, isTextEntryTarget, type MenuEntry } from "../components/ContextMenu";
import { copyText, openInNewTab, openInNewWindow, viewMenuEntries } from "../lib/menuActions";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "../lib/csv";
import { TableSkeleton } from "../components/ui/Skeleton";
import { ListFooter, ListViews, PageHeader, StatCard } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";


interface DomainRow {
  kind: "Domain" | "Certificate";
  id: string;
  name: string;
  target: string | null;
  issuer: string | null;
  expiryDate: string | null;
  autoRenew: boolean;
  companyId: string | null;
  companyName: string | null;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
];

function expiryTone(row: DomainRow): string {
  if (!row.expiryDate) return "text-gray-500";
  const { days, overdue } = daysUntil(row.expiryDate);
  if (overdue) return "text-red-400";
  return days <= 30 ? "text-amber-400" : "text-gray-500";
}

export function KumoDomainsPage() {
  const modern = useModernInterface();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DomainRow | null>(null);

  const filter = searchParams.get("filter") ?? "all";
  const companyId = searchParams.get("companyId") ?? "";
  const selectId = searchParams.get("select");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/kumo/domains", { params: { filter } });
      setRows(r.data?.data || []);
    } catch {
      toast.error("Failed to load domains and certificates");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const kind = searchParams.get("kind") ?? "";

  const visible = useMemo(() => {
    const scoped = companyId ? rows.filter((r) => r.companyId === companyId) : rows;
    // Domain Tracker and SSL Tracker are the same page, narrowed by ?kind=.
    return kind ? scoped.filter((r) => r.kind.toLowerCase() === kind.toLowerCase()) : scoped;
  }, [rows, companyId, kind]);

  // Named after the visible row because the payload carries the client's name;
  // it needs the filtered rows, so this runs after `visible`.
  const kindLabel = kind ? (kind === "Certificate" ? "Certificates" : "Domains") : "";
  useBreadcrumbTrail(
    companyId
      ? kumoClientTrail(
          companyId,
          visible[0]?.companyName,
          { label: "Domains & Certs", to: kindLabel ? "/kumo/domains" : undefined },
          ...(kindLabel ? [{ label: kindLabel }] : [])
        )
      : kindLabel
        ? kumoTrail({ label: "Domains & Certs", to: "/kumo/domains" }, { label: kindLabel })
        : null
  );

  // Deep link: /kumo/domains?select=<id> opens straight onto that record.
  useEffect(() => {
    if (!selectId) return;
    const match = visible.find((r) => r.id === selectId);
    if (match) setSelected(match);
  }, [selectId, visible]);

  const setFilter = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === "all") next.delete("filter"); else next.set("filter", key);
    setSearchParams(next, { replace: true });
  };

  const clearCompany = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("companyId");
    next.delete("select");
    setSearchParams(next, { replace: true });
  };

  const clearKind = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("kind");
    next.delete("select");
    setSearchParams(next, { replace: true });
  };

  const companyName = visible[0]?.companyName ?? null;
  const expiredCount = visible.filter((r) => r.expiryDate && daysUntil(r.expiryDate).overdue).length;

  /*
   * The figures the tracker can state from the rows already loaded, and the two slices it can
   * honestly offer: a domain and a certificate are different records on the same list. The client
   * scope is applied first so the counts describe the estate on screen.
   */
  const scopedRows = companyId ? rows.filter((r) => r.companyId === companyId) : rows;
  const kindCount = (k: DomainRow["kind"]) => scopedRows.filter((r) => r.kind === k).length;
  const domainCount = kindCount("Domain");
  const certificateCount = kindCount("Certificate");
  const expiringSoonCount = visible.filter((r) => r.expiryDate && !daysUntil(r.expiryDate).overdue && daysUntil(r.expiryDate).days <= 30).length;
  const autoRenewCount = visible.filter((r) => r.autoRenew).length;
  const domainViews = [
    { id: "", label: "All", count: domainCount + certificateCount },
    { id: "Domain", label: "Domains", count: domainCount },
    { id: "Certificate", label: "Certificates", count: certificateCount },
  ];

  /** The Modern views strip sets the same ?kind= the rail, the menu and the breadcrumbs use. */
  const setKind = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("kind", id); else next.delete("kind");
    next.delete("select");
    setSearchParams(next, { replace: true });
  };

  // ── Right-click menu: Kumo Domains & Certs ──
  const menu = useContextMenu();

  const csvColumns: CsvColumn<DomainRow>[] = [
    { key: "kind", label: "Kind", value: r => r.kind },
    { key: "name", label: "Name", value: r => r.name },
    { key: "client", label: "Client", value: r => r.companyName ?? "" },
    { key: "target", label: "Target", value: r => r.target ?? "" },
    { key: "issuer", label: "Issuer", value: r => r.issuer ?? "" },
    { key: "expiry", label: "Expires", value: r => (r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : "not tracked") },
    { key: "daysLeft", label: "Days Left", value: r => (r.expiryDate ? daysUntil(r.expiryDate).days : "") },
    { key: "autoRenew", label: "Auto Renew", value: r => (r.autoRenew ? "Yes" : "No") },
  ];

  const exportCsv = () => {
    if (visible.length === 0) { toast.error("Nothing to export"); return; }
    downloadCsv(`c7ntax-kumo-domains-${fileStamp()}.csv`, toCsv(visible, csvColumns));
    toast.success(`Exported ${visible.length} record${visible.length === 1 ? "" : "s"}`);
  };

  const domainMenuHeader = (row: DomainRow) => ({
    title: row.name,
    subtitle: [
      row.kind,
      row.companyName,
      row.expiryDate ? `${formatDateShort(row.expiryDate)} (${daysUntil(row.expiryDate).overdue ? "expired" : daysUntil(row.expiryDate).label})` : "no expiry tracked",
    ].filter(Boolean).join(" · "),
  });

  const domainMenuEntries = (row: DomainRow): MenuEntry[] => [
    { label: "Show details", icon: ExternalLink, hint: "⏎", onSelect: () => setSelected(row) },
    "separator",
    row.companyId && {
      label: "Filter to this client", icon: Building2,
      onSelect: () => setSearchParams({ companyId: String(row.companyId) }),
    },
    {
      label: `Show only ${row.kind === "Certificate" ? "certificates" : "domains"}`, icon: row.kind === "Certificate" ? Lock : Globe,
      onSelect: () => setSearchParams({ kind: row.kind }),
    },
    "separator",
    { label: "Copy name", icon: Copy, onSelect: () => void copyText(row.name, "Name") },
    {
      label: "Copy expiry date", icon: Copy, disabled: !row.expiryDate,
      onSelect: () => void copyText(String(row.expiryDate ? formatDateShort(row.expiryDate) : ""), "Expiry date"),
    },
    {
      label: "Copy record details", icon: Copy,
      onSelect: () => void copyText([
        `${row.kind}: ${row.name}`,
        row.companyName ? `Client: ${row.companyName}` : null,
        row.target ? `Target: ${row.target}` : null,
        row.issuer ? `Issuer: ${row.issuer}` : null,
        row.expiryDate
          ? `Expires: ${formatDate(row.expiryDate)} (${daysUntil(row.expiryDate).overdue ? "expired" : daysUntil(row.expiryDate).label})`
          : "No expiry tracked",
        `Auto renew: ${row.autoRenew ? "yes" : "no"}`,
      ].filter(Boolean).join("\n"), "Record details"),
    },
  ].filter(Boolean) as MenuEntry[];

  const sectionMenuEntries = (): MenuEntry[] => [
    { label: "Refresh", icon: RefreshCw, onSelect: () => void load() },
    {
      label: "Filter", icon: CalendarX,
      items: FILTERS.map(f => ({ label: f.label, checked: filter === f.key, onSelect: () => setFilter(f.key) })),
    },
    {
      label: "Clear filters", icon: Eraser, disabled: filter === "all" && !companyId && !kind,
      onSelect: () => setSearchParams({}),
    },
    "separator",
    { label: "Export as CSV", icon: Download, hint: `${visible.length} row${visible.length === 1 ? "" : "s"}`, disabled: visible.length === 0, onSelect: exportCsv },
    "separator",
    ...viewMenuEntries(),
  ];

  return (
    <div
      className="space-y-4 animate-fade-in"
      onContextMenu={(e) => { if (isTextEntryTarget(e.target)) return; menu.open(e, sectionMenuEntries()); }}
    >
      <ContextMenu state={menu.menuState} onClose={menu.close} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader variant="section" title="Domains &amp; Certificates" subtitle={<>{loading ? "Loading…" : `${visible.length} tracked`}
            {expiredCount > 0 && <span className="text-red-400"> • {expiredCount} expired</span>}</>} />
        <div className="flex flex-wrap items-center gap-2">
          {companyId && (
            <button onClick={clearCompany} className="btn-secondary text-xs py-1 flex items-center gap-1.5" title="Clear the client filter">
              <Building2 size={12} /> {companyName || "Filtered client"} ✕
            </button>
          )}
          {kind && (
            <button onClick={clearKind} className="btn-secondary text-xs py-1 flex items-center gap-1.5" title="Show domains and certificates together">
              {kind === "Certificate" ? <Lock size={12} /> : <Globe size={12} />} {kind === "Certificate" ? "Certificates" : "Domains"} ✕
            </button>
          )}
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  filter === f.key
                    ? "border-cyber-500/40 bg-cyber-600/10 text-cyber-300"
                    : "border-surface-border text-gray-400 hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Figures — the state of the estate this tracker is holding. */}
      {modern && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Tracked" value={visible.length} icon={<Globe size={13} />} />
          <StatCard label="Expired" value={expiredCount} icon={<CalendarX size={13} />} tone={expiredCount > 0 ? "red" : "neutral"} />
          <StatCard label="Expiring in 30 days" value={expiringSoonCount} icon={<CalendarClock size={13} />} tone={expiringSoonCount > 0 ? "amber" : "neutral"} />
          <StatCard label="Auto-renew" value={autoRenewCount} icon={<RefreshCw size={13} />} tone="neutral" />
        </div>
      )}

      {/* Views — domains and certificates are different records, so the list names both. */}
      {modern && (
        <div className="flex flex-wrap items-center gap-2">
          <ListViews views={domainViews} value={kind} onChange={setKind} label="Domains and certificates" />
          <span className="text-xs text-gray-500 tabular-nums">
            {visible.length} tracked{companyName ? ` for ${companyName}` : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-1">
          {loading ? (
            <TableSkeleton />
          ) : visible.length === 0 ? (
            <div className="card py-8 text-center text-gray-500 text-sm">
              {filter === "expired" ? "Nothing has expired." : filter === "upcoming" ? "Nothing expiring in the next 90 days." : "No domains or certificates yet."}
            </div>
          ) : (
            <>
            {visible.map((row) => {
              const when = row.expiryDate ? daysUntil(row.expiryDate) : null;
              return (
                <button
                  key={`${row.kind}-${row.id}`}
                  onClick={() => setSelected(row)}
                  onContextMenu={(e) => menu.open(e, domainMenuEntries(row), domainMenuHeader(row))}
                  onKeyDown={(e) => menu.onKeyDown(e, e.currentTarget, domainMenuEntries(row), domainMenuHeader(row))}
                  className={`w-full text-left card px-4 py-3 hover:border-cyber-500/30 transition-colors ${selected?.id === row.id ? "border-cyber-500/50 bg-cyber-600/5" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {row.kind === "Certificate" ? <Lock size={14} className="text-cyber-400 shrink-0" /> : <Globe size={14} className="text-cyber-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{row.name}</p>
                      <p className="text-xs text-gray-500 truncate">{row.companyName || "No client"}</p>
                    </div>
                    {when ? (
                      <span className="text-right shrink-0">
                        {modern ? (
                          <span className={`chip ${when.overdue ? "chip--bad" : when.days <= 30 ? "chip--warn" : "chip--good"}`}>
                            {when.overdue ? "expired" : when.label}
                          </span>
                        ) : (
                        <span className={`block text-[10px] ${expiryTone(row)}`}>{when.overdue ? "expired" : when.label}</span>
                        )}
                        <span className="block text-[10px] text-gray-600 mt-0.5" title={formatDate(row.expiryDate)}>
                          {formatDateShort(row.expiryDate)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-600 shrink-0">no expiry tracked</span>
                    )}
                  </div>
                </button>
              );
            })
            }
            {modern && (
              <ListFooter from={1} to={visible.length} total={visible.length} page={1} pages={1} onPage={() => {}}
                note={filter === "expired" ? "Everything already past its date" : filter === "upcoming" ? "Due within 90 days" : "Renewals and cover in one list"} />
            )}
            </>
          )}
        </div>

        <div className="lg:col-span-2">
          {!selected ? (
            <div className="card flex items-center justify-center py-16 text-gray-500 text-sm">
              <div className="text-center">
                <ShieldCheck size={40} className="text-gray-600 mx-auto mb-3" />
                <p>Select a domain or certificate to view details</p>
              </div>
            </div>
          ) : (
            <div className="card space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {selected.kind === "Certificate"
                    ? <Lock size={16} className="text-cyber-400 shrink-0" />
                    : <Globe size={16} className="text-cyber-400 shrink-0" />}
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-white truncate">{selected.name}</h3>
                    <p className="text-xs text-gray-500">{selected.kind}</p>
                  </div>
                </div>
                {modern ? (
                  <span className={`chip ${
                    selected.expiryDate && daysUntil(selected.expiryDate).overdue
                      ? "chip--bad"
                      : selected.expiryDate && daysUntil(selected.expiryDate).days <= 30
                        ? "chip--warn"
                        : selected.expiryDate ? "chip--good" : ""
                  }`}>
                    {selected.expiryDate ? (daysUntil(selected.expiryDate).overdue ? "Expired" : "Valid") : "No expiry tracked"}
                  </span>
                ) : (
                <span className={`badge text-xs ${
                  selected.expiryDate && daysUntil(selected.expiryDate).overdue
                    ? "bg-red-600/20 text-red-400"
                    : selected.expiryDate && daysUntil(selected.expiryDate).days <= 30
                      ? "bg-amber-600/20 text-amber-400"
                      : "bg-green-600/20 text-green-400"
                }`}>
                  {selected.expiryDate ? (daysUntil(selected.expiryDate).overdue ? "Expired" : "Valid") : "No expiry tracked"}
                </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={selected.kind === "Certificate" ? "Domain" : "Domain name"} value={selected.target} icon={Globe} />
                <Field label={selected.kind === "Certificate" ? "Issuer" : "Registrar"} value={selected.issuer} icon={ShieldCheck} />
                <Field
                  label="Expires"
                  value={selected.expiryDate ? `${formatDateShort(selected.expiryDate)} (${daysUntil(selected.expiryDate).label})` : null}
                  icon={CalendarClock}
                  tone={expiryTone(selected)}
                />
                <Field label="Auto-renew" value={selected.autoRenew ? "On" : "Off"} icon={RefreshCw} />
              </div>

              <div className="pt-3 border-t border-surface-border flex flex-wrap items-center gap-3">
                {selected.companyId ? (
                  <Link to={`/kumo/organizations/${selected.companyId}`} className="text-sm text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1.5">
                    <Building2 size={13} /> {selected.companyName || "Open organization"}
                  </Link>
                ) : (
                  <span className="text-sm text-gray-500">Not attached to a client</span>
                )}
                <a
                  href={`https://${(selected.target || "").replace(/^\*\./, "").replace(/^https?:\/\//, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-gray-400 hover:text-cyber-300 inline-flex items-center gap-1.5"
                >
                  <ExternalLink size={13} /> Check live
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, icon: Icon, tone = "" }: { label: string; value: string | null; icon: typeof Globe; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5 inline-flex items-center gap-1"><Icon size={11} />{label}</p>
      <p className={`text-sm ${tone || "text-gray-300"}`}>{value || "—"}</p>
    </div>
  );
}
