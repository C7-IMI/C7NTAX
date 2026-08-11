import { useState, useEffect } from "react";
import { Calendar, Sparkles, Zap, RefreshCw, Bug } from "lucide-react";

interface ChangeItem {
  text: string;
  type: "new" | "update" | "fix";
}

interface Version {
  id: number;
  version: string;
  date: string;
  title: string;
  changes: ChangeItem[];
}

/** Parse FEATURE_LIST.md text into structured version entries */
function parseFeatureList(raw: string): Version[] {
  const versions: Version[] = [];

  // Match version headers:  ## YYYY.M.D.BBB — Title
  const headerRe = /^## (\d{4}\.\d{1,2}\.\d{1,2}\.\d{3})\s*[—–-]\s*(.+)$/gm;
  const matches = [...raw.matchAll(headerRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const version = m[1];
    const title = m[2].trim();
    const headerEnd = (m.index ?? 0) + m[0].length;
    const nextHeaderStart = i + 1 < matches.length ? matches[i + 1].index! : raw.length;

    // Extract lines between this header and the next
    const body = raw.slice(headerEnd, nextHeaderStart);
    const changes: ChangeItem[] = [];

    // Parse bullet lines:  - **[Type]** text
    const bulletRe = /^-\s*\*\*\[(New|Update|Fix)\]\*\*\s+(.+)$/gm;
    let bm: RegExpExecArray | null;
    while ((bm = bulletRe.exec(body)) !== null) {
      const typeLabel = bm[1];
      const text = bm[2].trim();
      const type = typeLabel === "New" ? "new" : typeLabel === "Update" ? "update" : "fix";
      changes.push({ text, type });
    }

    if (changes.length > 0 || title) {
      // Derive date from version: YYYY.M.D.BBB → YYYY-MM-DD
      const parts = version.split(".");
      const date = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      versions.push({ id: versions.length + 1, version, date, title, changes });
    }
  }

  return versions;
}

export function ChangelogPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch raw FEATURE_LIST.md from Vite's public directory — no server needed
    fetch("/FEATURE_LIST.md")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(raw => {
        const parsed = parseFeatureList(raw);
        if (parsed.length === 0) throw new Error("No version entries found in FEATURE_LIST.md");
        setVersions(parsed);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading changelog...</div>;

  if (error) return (
    <div className="text-center py-12">
      <p className="text-red-400 text-sm">Could not load changelog: {error}</p>
      <p className="text-gray-500 text-xs mt-2">Ensure FEATURE_LIST.md exists in the public/ directory.</p>
    </div>
  );

  if (versions.length === 0) return <div className="text-center py-12 text-gray-500">No changelog entries found.</div>;

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
          {versions.map((v, i) => {
            const features = v.changes.filter(c => c.type === "new");
            const updates = v.changes.filter(c => c.type === "update");
            const fixes = v.changes.filter(c => c.type === "fix");
            const featuresAndUpdates = [...features, ...updates];

            return (
              <div key={v.version} className="relative pl-14">
                <div className="absolute left-[18px] top-1 w-3 h-3 rounded-full bg-cyber-500 border-2 border-surface ring-4 ring-navy-950" />
                {i === 0 && <div className="absolute left-[18px] -top-2 w-3 h-3 rounded-full bg-green-400 border-2 border-surface ring-4 ring-navy-950 animate-pulse" />}

                {/* Version header */}
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="badge bg-navy-600/40 text-gray-500 font-mono text-xs px-2 py-0.5">#{v.id}</span>
                    <span className="badge bg-cyber-600/20 text-cyber-400 font-mono text-sm px-3 py-1">{v.version}</span>
                    {i === 0 && <span className="badge bg-green-600/20 text-green-400 text-xs">Latest</span>}
                  </div>
                  <span className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Calendar size={12} /> {v.date}
                  </span>
                </div>
                <h3 className="text-white font-semibold text-base mb-3">{v.title}</h3>

                {/* Top card: New Features + Updates */}
                {featuresAndUpdates.length > 0 && (
                  <div className="card space-y-3 mb-3 border-l-2 border-l-cyber-500">
                    {featuresAndUpdates.map((c, ci) => (
                      <div key={ci} className="flex items-start gap-3 text-sm">
                        {c.type === "new" ? (
                          <span className="badge bg-green-600/20 text-green-400 text-[11px] px-2 py-0.5 shrink-0 mt-0.5 flex items-center gap-1">
                            <Zap size={10} /> New
                          </span>
                        ) : (
                          <span className="badge bg-amber-600/20 text-amber-400 text-[11px] px-2 py-0.5 shrink-0 mt-0.5 flex items-center gap-1">
                            <RefreshCw size={10} /> Update
                          </span>
                        )}
                        <span className="text-gray-300">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Bottom card: Bug Fixes */}
                {fixes.length > 0 && (
                  <div className="card space-y-3 border-l-2 border-l-red-500">
                    {fixes.map((c, ci) => (
                      <div key={ci} className="flex items-start gap-3 text-sm">
                        <span className="badge bg-red-600/20 text-red-400 text-[11px] px-2 py-0.5 shrink-0 mt-0.5 flex items-center gap-1">
                          <Bug size={10} /> Fix
                        </span>
                        <span className="text-gray-300">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
