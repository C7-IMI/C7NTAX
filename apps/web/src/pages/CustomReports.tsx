import { useEffect, useState } from "react";
import api from "../api";
import { Filter, Play, Plus } from "lucide-react";

type CustomReport = { id: string; name: string; description: string | null; type: string; createdAt: string };

export function CustomReportsPage() {
  const [reports, setReports] = useState<CustomReport[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("ticket_summary");
  const [config, setConfig] = useState("{}");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<{ report: string; type: string; data: Array<Record<string, unknown>> } | null>(null);

  const load = () => api.get("/reports").then(r => setReports(r.data || [])).catch(() => setReports([]));

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!name) { setMessage("Name required"); return; }
    let parsed: unknown = {};
    try { parsed = JSON.parse(config || "{}"); } catch { setMessage("Config must be valid JSON"); return; }
    try {
      await api.post("/reports", { name, description: description || null, type, config: parsed });
      setName(""); setDescription(""); setConfig("{}"); setMessage("Report created");
      void load();
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Create failed"); }
  };

  const run = async (id: string) => {
    try {
      const r = await api.get(`/reports/${id}/run`);
      setResults(r.data);
    } catch (e: unknown) { setMessage(e instanceof Error ? e.message : "Run failed"); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Filter size={18} className="text-cyber-400" /> Custom Report Builder</h2>
        <p className="text-sm text-gray-400 mt-0.5">Create, run, and schedule custom reports</p>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">New report</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="input-field" placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ticket_summary">Ticket summary</option>
            <option value="revenue">Revenue (paid invoices)</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <input className="input-field" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <textarea className="input-field" rows={3} placeholder='Config JSON, e.g. {"filters": {"status": "open"}}' value={config} onChange={(e) => setConfig(e.target.value)} />
        <div className="flex items-center gap-3">
          <button className="btn-primary flex items-center gap-2" onClick={create}><Plus size={14} /> Create report</button>
          {message && <span className="text-xs text-cyber-400">{message}</span>}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Your reports</h3>
        <table className="w-full text-sm border-collapse">
          <thead><tr className="text-left text-gray-400 border-b border-surface-border">
            <th className="py-2 px-2">Name</th><th className="py-2 px-2">Type</th><th className="py-2 px-2">Description</th><th className="py-2 px-2"></th>
          </tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-b border-surface-border/50">
                <td className="py-2 px-2 text-white">{r.name}</td>
                <td className="py-2 px-2 text-gray-400">{r.type}</td>
                <td className="py-2 px-2 text-gray-400">{r.description || "—"}</td>
                <td className="py-2 px-2 text-right">
                  <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => run(r.id)}><Play size={12} /> Run</button>
                </td>
              </tr>
            ))}
            {reports.length === 0 && <tr><td colSpan={4} className="py-4 text-gray-600 text-center">No custom reports yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {results && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Results — {results.report} ({results.type})</h3>
          {results.data.length === 0 ? <p className="text-gray-600 text-sm">No rows returned.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead><tr className="text-left text-gray-400 border-b border-surface-border">
                  {Object.keys(results.data[0] || {}).map((k) => <th key={k} className="py-2 px-2">{k}</th>)}
                </tr></thead>
                <tbody>
                  {results.data.map((row, i) => (
                    <tr key={i} className="border-b border-surface-border/50">
                      {Object.values(row).map((v, j) => <td key={j} className="py-2 px-2 text-gray-300">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
