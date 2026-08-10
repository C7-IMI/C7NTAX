import { useState, useEffect, useCallback } from "react";
import api from "../api";
import { Shield, Monitor, FileText, Link2, Server, Database, Clock, Key, BookOpen, Globe, ShieldCheck } from "lucide-react";

interface RecentItem {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string;
  entityIcon: string;
  viewedAt: string;
}

export function KumoDashboardPage() {
  const [stats, setStats] = useState({ assets: 0, passwords: 0, configs: 0, documents: 0, links: 0 });
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  const fetchRecent = useCallback(() => {
    api.get("/kumo/recently-viewed").then(r => setRecentItems(r.data?.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/kumo/dashboard").then(r => setStats(r.data)).catch(() => {});
    fetchRecent();
    // Poll for live updates every 10 seconds
    const interval = setInterval(fetchRecent, 10000);
    return () => clearInterval(interval);
  }, [fetchRecent]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-white">Kumo — IT Documentation</h2>
        <p className="text-sm text-gray-400 mt-0.5">Assets, passwords, configurations, and SOPs in one place.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card icon={Monitor} title="Flexible Assets" description={`${stats.assets} assets • Dynamic templates & custom fields`} to="/kumo/assets" color="cyber" />
        <Card icon={Shield} title="Password Vault" description={`${stats.passwords} passwords • AES-256 encrypted`} to="/kumo/passwords" color="amber" />
        <Card icon={Server} title="Configurations" description={`${stats.configs} servers • Workstations & networks`} to="/kumo/configs" color="green" />
        <Card icon={FileText} title="Documents & SOPs" description={`${stats.documents} documents • Folders & revisions`} to="/kumo/documents" color="purple" />
        <Card icon={Link2} title="Universal Links" description={`${stats.links} links • Universal relationship mapping`} to="/kumo" color="blue" />
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recently Viewed</h3>
        {recentItems.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No recently viewed items. Browse your assets, passwords, or configurations to populate this list.</p>
        ) : (
          <div className="space-y-0.5">
            {recentItems.map((item) => (
              <RecentRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, description, to, color }: {
  icon: any; title: string; description: string; to: string; color: string;
}) {
  const colors: Record<string, string> = {
    cyber: "bg-cyber-600/10 text-cyber-400 border-cyber-500/20",
    amber: "bg-amber-600/10 text-amber-400 border-amber-500/20",
    green: "bg-green-600/10 text-green-400 border-green-500/20",
    purple: "bg-purple-600/10 text-purple-400 border-purple-500/20",
    blue: "bg-blue-600/10 text-blue-400 border-blue-500/20",
    gray: "bg-gray-600/10 text-gray-400 border-gray-500/20",
  };
  return (
    <a href={to} className={`card border ${colors[color] || colors.gray} hover:bg-surface-lighter/50 transition-colors space-y-3 block`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}><Icon size={18} /></div>
        <div>
          <p className="text-white font-medium text-sm">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </a>
  );
}

function RecentRow({ item }: { item: RecentItem }) {
  const icon = getIcon(item.entityIcon, item.entityType);
  const typeLabel = getTypeLabel(item.entityType);
  const timeAgo = getTimeAgo(item.viewedAt);
  const link = getEntityLink(item.entityType, item.entityId);

  return (
    <a href={link} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-lighter transition-colors group">
      <div className={`p-1.5 rounded-md ${getTypeColor(item.entityType)}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate group-hover:text-cyber-300 transition-colors">{item.entityName}</p>
        <p className="text-xs text-gray-500">{typeLabel}</p>
      </div>
      <span className="text-xs text-gray-600 shrink-0 flex items-center gap-1">
        <Clock size={11} />
        {timeAgo}
      </span>
    </a>
  );
}

function getIcon(entityIcon: string, entityType: string) {
  const map: Record<string, JSX.Element> = {
    key: <Key size={15} />,
    shield: <ShieldCheck size={15} />,
    monitor: <Monitor size={15} />,
    book: <BookOpen size={15} />,
    globe: <Globe size={15} />,
    certificate: <ShieldCheck size={15} />,
    link: <Link2 size={15} />,
    document: <FileText size={15} />,
    server: <Server size={15} />,
  };
  return map[entityIcon] || map[entityType] || <FileText size={15} />;
}

function getTypeLabel(entityType: string): string {
  const map: Record<string, string> = {
    password: "Password",
    config: "Configuration",
    asset: "Flexible Asset",
    document: "Document / SOP",
    domain: "Domain",
    certificate: "Certificate",
    link: "Universal Link",
  };
  return map[entityType] || entityType;
}

function getTypeColor(entityType: string): string {
  const map: Record<string, string> = {
    password: "bg-amber-600/10 text-amber-400",
    config: "bg-green-600/10 text-green-400",
    asset: "bg-cyber-600/10 text-cyber-400",
    document: "bg-purple-600/10 text-purple-400",
    domain: "bg-blue-600/10 text-blue-400",
    certificate: "bg-yellow-600/10 text-yellow-400",
    link: "bg-gray-600/10 text-gray-400",
  };
  return map[entityType] || "bg-gray-600/10 text-gray-400";
}

function getEntityLink(entityType: string, entityId: string): string {
  const map: Record<string, string> = {
    password: `/kumo/passwords`,
    config: `/kumo/configs`,
    asset: `/kumo/assets/${entityId}`,
    document: `/kumo/documents`,
    domain: `/kumo`,
    certificate: `/kumo`,
    link: `/kumo`,
  };
  return map[entityType] || `/kumo`;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function PhaseRow({ phase, label, status }: { phase: string; label: string; status: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`w-2 h-2 rounded-full ${status === "complete" ? "bg-green-400" : "bg-gray-600"}`} />
      <span className="text-gray-400 w-20">{phase}</span>
      <span className="text-white">{label}</span>
      <span className={`badge text-xs ml-auto ${status === "complete" ? "bg-green-600/20 text-green-400" : "bg-gray-600/20 text-gray-400"}`}>
        {status === "complete" ? "Done" : "Pending"}
      </span>
    </div>
  );
}
