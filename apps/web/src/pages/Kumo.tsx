import { useState, useEffect } from "react";
import api from "../api";
import { Shield, Monitor, FileText, Link2, Server, Database } from "lucide-react";

export function KumoDashboardPage() {
  const [stats, setStats] = useState({ assets: 0, passwords: 0, configs: 0, documents: 0, links: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/kumo/dashboard").then(r => setStats(r.data)).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-white">Kumo — IT Documentation</h2>
        <p className="text-sm text-gray-400 mt-0.5">Assets, passwords, configurations, and SOPs in one place.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card
          icon={Monitor}
          title="Flexible Assets"
          description={`${stats.assets} assets • Dynamic templates description="Dynamic asset records with user-defined templates and custom fields." custom fields`}
          to="/kumo/assets"
          color="cyber"
        />
        <Card
          icon={Shield}
          title="Password Vault"
          description={`${stats.passwords} passwords • AES-256 encrypted`}
          to="/kumo/passwords"
          color="amber"
        />
        <Card
          icon={Server}
          title="Configurations"
          description={`${stats.configs} servers • Workstations description="Standardized servers, workstations, and network device records." networks`}
          to="/kumo/configs"
          color="green"
        />
        <Card
          icon={FileText}
          title="Documents & SOPs"
          description={`${stats.documents} documents • Folders description="WYSIWYG knowledge base with folders, revisions, and templates." revisions`}
          to="/kumo/documents"
          color="purple"
        />
        <Card
          icon={Link2}
          title="Universal Links"
          description={`${stats.links} links • Universal relationship mapping`}
          to="/kumo"
          color="blue"
        />
        <Card
          icon={Database}
          title="Coming Soon"
          description="Additional Kumo features are in active development. Check back regularly."
          to="/kumo"
          color="gray"
        />
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Implementation Status</h3>
        <div className="space-y-2">
          <PhaseRow phase="Phase 1" label="Foundation" status="complete" />
          <PhaseRow phase="Phase 2" label="Flexible Assets" status="pending" />
          <PhaseRow phase="Phase 3" label="Password Vault" status="pending" />
          <PhaseRow phase="Phase 4" label="Universal Links & Configs" status="pending" />
          <PhaseRow phase="Phase 5" label="Documents & SOPs" status="pending" />
          <PhaseRow phase="Phase 6" label="Navigation & Asset Migration" status="pending" />
        </div>
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
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-white font-medium text-sm">{title}</p>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
    </a>
  );
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
