import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import { Search, ExternalLink, History, ChevronRight } from "lucide-react";
import { SortableHeader, sortData, nextSort, type SortState } from "../components/SortableHeader";
import { initials, avatarColor } from "../lib/format";

interface Organization {
  id: string;
  name: string;
  companyType: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  updatedAt: string;
  _count: { contacts: number; tickets: number; serviceAgreements: number };
  kumo: { assets: number; passwords: number; documents: number; domains: number; certificates: number };
}

interface RecentItem {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string;
  viewedAt: string;
}

const TYPE_COLORS: Record<string, string> = {
  Client: "bg-cyber-600/20 text-cyber-400",
  Prospect: "bg-amber-600/20 text-amber-400",
  Vendor: "bg-purple-600/20 text-purple-400",
  Partner: "bg-green-600/20 text-green-400",
};

function CountCell({ value, className = "" }: { value: number; className?: string }) {
  return <td className={`px-4 py-3 ${className} ${value > 0 ? "text-gray-300" : "text-gray-600"}`}>{value}</td>;
}

export function KumoOrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>({ field: "name", direction: "asc" });
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Set by the organization rail's Vendors entry, e.g. ?companyType=Vendor
  const companyType = searchParams.get("companyType") ?? "";

  const fetchOrgs = useCallback(async (term: string, type: string) => {
    try {
      const r = await api.get("/kumo/organizations", { params: { search: term, companyType: type || undefined, limit: 200 } });
      setOrgs(r.data?.data || []);
      setTotal(r.data?.total || 0);
      setError("");
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(
        status === 404
          ? "This view needs the Organizations endpoint, which the running API server does not have yet. Restart the API and reload."
          : "Could not load organizations."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced so typing doesn't fire a request per keystroke.
    const timer = setTimeout(() => fetchOrgs(search, companyType), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, companyType, fetchOrgs]);

  useEffect(() => {
    api
      .get("/kumo/recently-viewed")
      .then((r) => setRecent((r.data?.data || []).filter((i: RecentItem) => i.entityType === "organization").slice(0, 8)))
      .catch(() => {});
  }, []);

  const rows = useMemo(() => (sort ? sortData(orgs, sort.field, sort.direction) : orgs), [orgs, sort]);

  const setCompanyType = (type: string) => {
    const next = new URLSearchParams(searchParams);
    if (type) next.set("companyType", type); else next.delete("companyType");
    setSearchParams(next, { replace: true });
  };

  const open = (org: Organization) => {
    api
      .post("/kumo/recently-viewed", {
        entityType: "organization",
        entityId: org.id,
        entityName: org.name,
        entityIcon: "building",
      })
      .catch(() => {});
    navigate(`/kumo/organizations/${org.id}`);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Organizations</h2>
          <p className="text-sm text-gray-400">
            {loading ? "Loading…" : `${rows.length} of ${total} organizations`} • Kumo documentation coverage
          </p>
        </div>
        <Link to="/clients" className="btn-secondary text-sm flex items-center gap-2">
          <ExternalLink size={14} /> Client records
        </Link>
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <History size={14} className="text-gray-500" />
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Recents</h3>
          </div>
          <div className="flex flex-wrap gap-3">
            {recent.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(`/kumo/organizations/${item.entityId}`)}
                title={item.entityName}
                className="flex flex-col items-center gap-1.5 w-16 group"
              >
                <span
                  className={`w-10 h-10 rounded-lg grid place-items-center text-xs font-semibold ${avatarColor(item.entityName)} group-hover:ring-2 group-hover:ring-cyber-500/40 transition`}
                >
                  {initials(item.entityName)}
                </span>
                <span className="text-[10px] text-gray-500 group-hover:text-cyber-300 truncate w-full text-center">
                  {item.entityName}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 p-3 border-b border-surface-border">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-8"
              placeholder="Filter by name, city, or industry…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input-field text-sm py-1.5 w-auto"
            value={companyType}
            onChange={(e) => setCompanyType(e.target.value)}
            title="Filter by company type"
          >
            <option value="">All types</option>
            <option value="Client">Clients</option>
            <option value="Prospect">Prospects</option>
            <option value="Vendor">Vendors</option>
            <option value="Partner">Partners</option>
          </select>
          <span className="text-xs text-gray-500">
            {rows.length} of {total}
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : error ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm text-gray-400">{error}</p>
            <button onClick={() => fetchOrgs(search, companyType)} className="btn-secondary text-sm">
              Retry
            </button>
          </div>
        ) : orgs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {search
              ? `No organizations match “${search}”.`
              : companyType
                ? `No ${companyType.toLowerCase()} organizations yet.`
                : "No organizations yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="group">
                <tr className="border-b border-surface-border text-left text-gray-400">
                  <SortableHeader field="name" label="Organization" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" />
                  <SortableHeader field="companyType" label="Type" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden sm:table-cell" />
                  <SortableHeader field="_count.contacts" label="Contacts" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />
                  <SortableHeader field="kumo.assets" label="Assets" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3" />
                  <SortableHeader field="kumo.passwords" label="Passwords" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden md:table-cell" />
                  <SortableHeader field="kumo.documents" label="Documents" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden md:table-cell" />
                  <SortableHeader field="kumo.domains" label="Domains" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden xl:table-cell" />
                  <SortableHeader field="kumo.certificates" label="Certs" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden xl:table-cell" />
                  <SortableHeader field="isActive" label="Status" sort={sort} onSort={(f) => setSort(nextSort(sort, f))} className="px-4 py-3 hidden lg:table-cell" />
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((org) => (
                  <tr
                    key={org.id}
                    className="border-b border-surface-border/50 hover:bg-surface-light/50 cursor-pointer"
                    onClick={() => open(org)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg grid place-items-center text-xs font-semibold shrink-0 ${avatarColor(org.name)}`}>
                          {initials(org.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{org.name}</p>
                          <p className="text-xs text-gray-500 truncate">
                            {[org.city, org.state].filter(Boolean).join(", ") || org.industry || "—"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {org.companyType && (
                        <span className={`badge text-xs ${TYPE_COLORS[org.companyType] || "bg-gray-600/20 text-gray-400"}`}>
                          {org.companyType}
                        </span>
                      )}
                    </td>
                    <CountCell value={org._count?.contacts ?? 0} className="hidden lg:table-cell" />
                    <CountCell value={org.kumo?.assets ?? 0} />
                    <CountCell value={org.kumo?.passwords ?? 0} className="hidden md:table-cell" />
                    <CountCell value={org.kumo?.documents ?? 0} className="hidden md:table-cell" />
                    <CountCell value={org.kumo?.domains ?? 0} className="hidden xl:table-cell" />
                    <CountCell value={org.kumo?.certificates ?? 0} className="hidden xl:table-cell" />
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${org.isActive ? "bg-green-400" : "bg-gray-600"}`} />
                      <span className="text-xs text-gray-400">{org.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <ChevronRight size={15} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
