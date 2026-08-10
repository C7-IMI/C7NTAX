import { useState, useEffect } from "react";
import api from "../api";
import { Calendar, GitBranch, Sparkles, ArrowRight } from "lucide-react";

interface Version {
  version: string; date: string; title: string; changes: string[];
}

export function ChangelogPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/system/changelog").then(r => setVersions(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading changelog...</div>;

  return (
    <div className="space-y-8 animate-fade-in max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Sparkles size={20} className="text-cyber-400" /> What's New
        </h2>
        <p className="text-sm text-gray-400 mt-0.5">Release history and feature changelog for C7NTAX</p>
      </div>

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-px bg-surface-border" />
        <div className="space-y-8">
          {versions.map((v, i) => (
            <div key={v.version} className="relative pl-14">
              <div className="absolute left-[18px] top-1 w-3 h-3 rounded-full bg-cyber-500 border-2 border-surface ring-4 ring-navy-950" />
              {i === 0 && <div className="absolute left-[18px] -top-2 w-3 h-3 rounded-full bg-green-400 border-2 border-surface ring-4 ring-navy-950 animate-pulse" />}
              <div className="card space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <span className="badge bg-cyber-600/20 text-cyber-400 font-mono text-sm px-3 py-1">{v.version}</span>
                    {i === 0 && <span className="badge bg-green-600/20 text-green-400 text-xs">Latest</span>}
                  </div>
                  <span className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Calendar size={12} /> {v.date}
                  </span>
                </div>
                <h3 className="text-white font-semibold text-base">{v.title}</h3>
                <ul className="space-y-1.5">
                  {v.changes.map((c, ci) => (
                    <li key={ci} className="flex items-start gap-2 text-sm text-gray-300">
                      <ArrowRight size={12} className="text-cyber-400 shrink-0 mt-1" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
