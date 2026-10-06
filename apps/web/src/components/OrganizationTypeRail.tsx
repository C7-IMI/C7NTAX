import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen, Building2, ChevronDown, ChevronRight, GitPullRequestArrow, Globe, Key, LayoutDashboard,
  Lock, MapPin, Server, Settings2, Users,
} from "lucide-react";
import { templateIcon } from "../lib/kumoIcons";

/**
 * One entry per thing a client can have documented. `type` is the value that
 * travels in ?type= for the views this screen renders itself; entries with a
 * `to` are destinations that already have their own screen, scoped by client.
 */
export interface AssetType {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isBuiltIn: boolean;
  ownedByClient: boolean;
  fieldCount: number;
  count: number;
}

export interface RailCounts {
  assets: number;
  configs: number;
  contacts: number;
  documents: number;
  passwords: number;
  domains: number;
  certificates: number;
  tickets: number;
}

interface Props {
  orgId: string;
  counts: RailCounts;
  assetTypes: AssetType[];
  changeBoard: { id: string; name: string } | null;
  activeType: string;
}

const SHOW_EMPTY_KEY = "c7_kumo_types_show_empty";

/**
 * Types that belong in Core Assets rather than the asset-type list — the ones
 * reached for on nearly every client and awkward to hunt for in a long list.
 * Matched on id or name so it holds whatever slug the type was seeded with.
 */
const CORE_ASSET_TYPES = ["checklists"];

const isCoreAssetType = (type: AssetType) =>
  CORE_ASSET_TYPES.includes(type.id.trim().toLowerCase()) || CORE_ASSET_TYPES.includes(type.name.trim().toLowerCase());

const isActive = (activeType: string, key: string) => activeType.toLowerCase() === key.toLowerCase();

function RailItem({
  to, icon: Icon, iconColor, label, count, active, title,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>;
  iconColor?: string | null;
  label: string;
  count?: number | null;
  active: boolean;
  title?: string;
}) {
  return (
    <Link
      to={to}
      title={title || label}
      className={`flex items-center gap-2 rounded-lg border-l-2 pl-2 pr-1.5 py-1.5 text-sm transition-colors ${
        active
          ? "border-cyber-500 bg-surface-lighter text-white"
          : "border-transparent text-gray-400 hover:bg-surface-lighter hover:text-white"
      }`}
    >
      <Icon size={14} className={active ? "text-cyber-400 shrink-0" : "text-gray-500 shrink-0"} style={iconColor ? { color: iconColor } : undefined} />
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && count !== null && (
        <span className={`text-[10px] tabular-nums shrink-0 ${count === 0 ? "text-gray-600" : "text-gray-500"}`}>{count}</span>
      )}
    </Link>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-wider text-gray-600 uppercase px-2 mt-3 mb-1">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function OrganizationTypeRail({ orgId, counts, assetTypes, changeBoard, activeType }: Props) {
  const [showEmpty, setShowEmpty] = useState(() => {
    try { return localStorage.getItem(SHOW_EMPTY_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SHOW_EMPTY_KEY, showEmpty ? "1" : "0"); } catch { /* ignore */ }
  }, [showEmpty]);

  const coreAssetTypes = assetTypes.filter(isCoreAssetType);
  const docTypes = assetTypes.filter((t) => !isCoreAssetType(t));
  const visibleTypes = showEmpty ? docTypes : docTypes.filter((t) => t.count > 0);
  const emptyCount = docTypes.length - docTypes.filter((t) => t.count > 0).length;
  const base = `/kumo/organizations/${orgId}`;

  const changeControlTo = changeBoard
    ? `/tickets?companyId=${orgId}&boardId=${changeBoard.id}`
    : `/tickets?companyId=${orgId}`;

  return (
    <nav className="card p-2 lg:sticky lg:top-4" aria-label="Documentation types">
      <p className="text-xs font-semibold text-gray-400 px-2 py-1 flex items-center gap-1.5">
        <Settings2 size={13} className="text-gray-500" /> Types
      </p>

      <Group label="Core Assets">
        <RailItem to={base} icon={LayoutDashboard} label="Overview" active={!activeType} title="Back to the organization overview" />
        {coreAssetTypes.map((t) => (
          <RailItem
            key={t.id}
            to={`${base}?type=${t.id}`}
            icon={templateIcon(t.icon)}
            iconColor={t.count > 0 ? t.color : null}
            label={t.name}
            count={t.count}
            active={isActive(activeType, t.id)}
            title={t.description || t.name}
          />
        ))}
        <RailItem to={`/kumo/configs?companyId=${orgId}`} icon={Server} label="Configurations" count={counts.configs} active={false} title="Servers, workstations and network devices" />
        <RailItem to={`/clients/contacts?companyId=${orgId}`} icon={Users} label="Contacts" count={counts.contacts} active={false} title="Contacts for this client" />
        <RailItem to={`/kumo/documents?companyId=${orgId}`} icon={BookOpen} label="Documents" count={counts.documents} active={false} title="Documents for this client" />
        <RailItem to={`/kumo/passwords?companyId=${orgId}`} icon={Key} label="Passwords" count={counts.passwords} active={false} title="Credentials for this client" />
        <RailItem to={`/kumo/domains?companyId=${orgId}&kind=Domain`} icon={Globe} label="Domain Tracker" count={counts.domains} active={false} title="Domains owned by this client" />
        <RailItem to={`/kumo/domains?companyId=${orgId}&kind=Certificate`} icon={Lock} label="SSL Tracker" count={counts.certificates} active={false} title="Certificates for this client" />
        <RailItem to={`${base}?type=locations`} icon={MapPin} label="Locations" active={isActive(activeType, "locations")} title="Where this client operates from" />
        <RailItem to={`/kumo/organizations?companyType=Vendor`} icon={Building2} label="Vendors" active={false} title="Vendors across all clients" />
        <RailItem
          to={changeControlTo}
          icon={GitPullRequestArrow}
          label="Change Control"
          count={counts.tickets}
          active={false}
          title={changeBoard ? `${changeBoard.name} tickets for this client` : "Tickets for this client"}
        />
      </Group>

      <Group label="Asset Types">
        {visibleTypes.length === 0 ? (
          <p className="text-xs text-gray-600 px-2 py-1.5">
            Nothing documented by type yet{emptyCount > 0 ? `. ${emptyCount} type${emptyCount === 1 ? "" : "s"} available.` : "."}
          </p>
        ) : (
          visibleTypes.map((t) => (
            <RailItem
              key={t.id}
              to={`${base}?type=${t.id}`}
              icon={templateIcon(t.icon)}
              iconColor={t.count > 0 ? t.color : null}
              label={t.name}
              count={t.count}
              active={isActive(activeType, t.id)}
              title={t.description || t.name}
            />
          ))
        )}
        {emptyCount > 0 && (
          <button
            onClick={() => setShowEmpty((v) => !v)}
            className="w-full flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-cyber-300 px-2 py-1 mt-0.5"
          >
            {showEmpty ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {showEmpty ? "Hide empty types" : `Show ${emptyCount} empty type${emptyCount === 1 ? "" : "s"}`}
          </button>
        )}
      </Group>
    </nav>
  );
}
