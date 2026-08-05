import { useState, useEffect, useCallback } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Lightbulb, TrendingUp, RefreshCw, AlertTriangle, ExternalLink, Zap, ChevronDown, ChevronUp } from "lucide-react";

interface Suggestion { ticketId: string; ticketNumber: string; title: string; relevanceScore: number; resolution: string | null; matchReason: string; resolvedAt: string | null; }
interface Pattern { name: string; description: string | null; category: string; severity: string; metrics?: Record<string, unknown>; }

interface Props { ticketId: string; ticketTitle: string; ticketDescription?: string; }

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-gray-600/20 text-gray-400", medium: "bg-amber-600/20 text-amber-400",
  high: "bg-orange-600/20 text-orange-400", critical: "bg-red-600/20 text-red-400",
};
const CATEGORY_ICONS: Record<string, string> = {
  recurring_issue: "🔄", emerging_trend: "📈", sla_risk: "⏰", knowledge_gap: "📚",
};

export function InferencePanel({ ticketId, ticketTitle }: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [summary, setSummary] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const analyze = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await api.post("/inference/suggestions", { ticketId, forceRefresh: force });
      setSuggestions(res.data.suggestions || []);
      setPatterns(res.data.patterns || []);
      setSummary(res.data.summary || "");
    } catch {
      if (!force) toast.error("Analysis unavailable — ensure an AI provider is configured");
    } finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => { analyze(); }, [analyze]);

  if (!ticketId) return null;

  return (
    <div className="card border-cyber-500/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyber-600/15 flex items-center justify-center">
            <Lightbulb size={15} className="text-cyber-400" />
          </div>
          <h3 className="font-semibold text-white text-sm">AI Inference</h3>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => analyze(true)} disabled={loading} className="p-1.5 text-gray-500 hover:text-cyber-400 transition-colors rounded" title="Re-analyze">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setCollapsed(!collapsed)} className="p-1 text-gray-500 hover:text-white transition-colors">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-3 animate-fade-in">
          {/* Summary */}
          {loading && !summary && (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
              <Zap size={14} className="animate-pulse text-cyber-400" />
              Analyzing ticket history...
            </div>
          )}

          {summary && (
            <div className="bg-surface-lighter rounded-lg p-3 text-sm text-gray-300 leading-relaxed">
              <Zap size={13} className="inline text-cyber-400 mr-1.5 -mt-0.5" />
              {summary}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Lightbulb size={12} /> Suggested Solutions ({suggestions.length})
              </h4>
              <div className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <div key={`${s.ticketId}-${i}`} className="border border-surface-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-surface-lighter/50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <div className="flex items-center gap-2">
                          <span className="badge bg-cyber-600/15 text-cyber-400 font-mono text-[10px]">{s.ticketNumber}</span>
                          <span className="text-xs text-gray-400">{Math.round(s.relevanceScore * 100)}% match</span>
                        </div>
                        <p className="text-sm text-white mt-0.5 truncate">{s.title}</p>
                      </div>
                      <ChevronDown size={14} className={`text-gray-500 shrink-0 transition-transform ${expanded === i ? "rotate-180" : ""}`} />
                    </button>
                    {expanded === i && (
                      <div className="px-3 pb-3 pt-0 border-t border-surface-border animate-fade-in">
                        <p className="text-xs text-gray-500 mb-1">{s.matchReason}</p>
                        {s.resolution ? (
                          <div className="bg-surface-lighter rounded-lg p-2.5 text-sm text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {s.resolution}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-600 italic">No resolution notes recorded</p>
                        )}
                        <a href={`/tickets/${s.ticketId}`} className="inline-flex items-center gap-1 text-xs text-cyber-400 hover:text-cyber-300 mt-2 transition-colors">
                          <ExternalLink size={11} /> Open ticket
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patterns */}
          {patterns.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <TrendingUp size={12} /> Detected Patterns ({patterns.length})
              </h4>
              <div className="space-y-1.5">
                {patterns.map((p, i) => (
                  <div key={i} className="border border-surface-border rounded-lg px-3 py-2.5 hover:bg-surface-lighter/50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs">{CATEGORY_ICONS[p.category] || "📌"}</span>
                          <span className="badge bg-cyber-600/15 text-cyber-400 text-[10px]">{p.category.replace(/_/g, " ")}</span>
                          <span className={`badge text-[10px] ${SEVERITY_COLORS[p.severity] || ""}`}>{p.severity}</span>
                        </div>
                        <p className="text-sm text-white">{p.name}</p>
                        {p.description && <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>}
                      </div>
                      <AlertTriangle size={14} className={`shrink-0 ${p.severity === "critical" ? "text-red-400" : p.severity === "high" ? "text-orange-400" : "text-gray-500"}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && suggestions.length === 0 && patterns.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-2">
              No suggestions or patterns found. Try re-analyzing or configure an AI provider for enhanced results.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
