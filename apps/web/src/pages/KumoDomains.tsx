import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { Globe, Lock, CalendarClock, Building2, RefreshCw, ExternalLink, ShieldCheck } from "lucide-react";
import { daysUntil, formatDate } from "../lib/format";

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

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Domains &amp; Certificates</h2>
          <p className="text-sm text-gray-400">
            {loading ? "Loading…" : `${visible.length} tracked`}
            {expiredCount > 0 && <span className="text-red-400"> • {expiredCount} expired</span>}
          </p>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-1">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : visible.length === 0 ? (
            <div className="card py-8 text-center text-gray-500 text-sm">
              {filter === "expired" ? "Nothing has expired." : filter === "upcoming" ? "Nothing expiring in the next 90 days." : "No domains or certificates yet."}
            </div>
          ) : (
            visible.map((row) => {
              const when = row.expiryDate ? daysUntil(row.expiryDate) : null;
              return (
                <button
                  key={`${row.kind}-${row.id}`}
                  onClick={() => setSelected(row)}
                  className={`w-full text-left card px-4 py-3 hover:border-cyber-500/30 transition-colors ${selected?.id === row.id ? "border-cyber-500/50 bg-cyber-600/5" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {row.kind === "Certificate" ? <Lock size={14} className="text-cyber-400 shrink-0" /> : <Globe size={14} className="text-cyber-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{row.name}</p>
                      <p className="text-xs text-gray-500 truncate">{row.companyName || "No client"}</p>
                    </div>
                    {when && <span className={`text-[10px] shrink-0 ${expiryTone(row)}`}>{when.overdue ? "expired" : when.label}</span>}
                  </div>
                </button>
              );
            })
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
                <span className={`badge text-xs ${
                  selected.expiryDate && daysUntil(selected.expiryDate).overdue
                    ? "bg-red-600/20 text-red-400"
                    : selected.expiryDate && daysUntil(selected.expiryDate).days <= 30
                      ? "bg-amber-600/20 text-amber-400"
                      : "bg-green-600/20 text-green-400"
                }`}>
                  {selected.expiryDate ? (daysUntil(selected.expiryDate).overdue ? "Expired" : "Valid") : "No expiry tracked"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={selected.kind === "Certificate" ? "Domain" : "Domain name"} value={selected.target} icon={Globe} />
                <Field label={selected.kind === "Certificate" ? "Issuer" : "Registrar"} value={selected.issuer} icon={ShieldCheck} />
                <Field
                  label="Expires"
                  value={selected.expiryDate ? `${formatDate(selected.expiryDate)} (${daysUntil(selected.expiryDate).label})` : null}
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
