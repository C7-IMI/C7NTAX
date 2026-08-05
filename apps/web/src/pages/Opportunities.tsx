import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, Target, TrendingUp } from "lucide-react";

const STAGES: Record<string, string> = { prospect: "bg-blue-600/20 text-blue-400", qualified: "bg-cyber-600/20 text-cyber-400", proposal: "bg-amber-600/20 text-amber-400", negotiation: "bg-purple-600/20 text-purple-400", won: "bg-green-600/20 text-green-400", lost: "bg-red-600/20 text-red-400" };

interface Opp { id: string; name: string; stage: string; amount: number; probability: number; company?: { name: string }; }

export function OpportunitiesPage() {
  const [opps, setOpps] = useState<Opp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", companyId: "", amount: 0, probability: 50, stage: "prospect" });

  const fetch = async () => { try { const r = await api.get("/crm/opportunities"); setOpps(r.data.data); } catch { toast.error("Failed to load"); } finally { setLoading(false); } };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => { e.preventDefault();
    try { await api.post("/crm/opportunities", form); toast.success("Opportunity created"); setShowNew(false); fetch(); } catch { toast.error("Failed"); }
  };

  const totalValue = opps.filter(o => o.stage !== "lost").reduce((s, o) => s + (o.amount || 0), 0);
  const totalWon = opps.filter(o => o.stage === "won").reduce((s, o) => s + (o.amount || 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Sales Pipeline</h2><p className="text-sm text-gray-400">{opps.length} opportunities · ${totalValue.toLocaleString()} pipeline · ${totalWon.toLocaleString()} won</p></div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} />New Opportunity</button>
      </div>

      {showNew && (
        <div className="card">
          <form onSubmit={handleCreate} className="space-y-3">
            <input className="input-field" placeholder="Opportunity name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
            <div className="grid grid-cols-3 gap-3">
              <input className="input-field" placeholder="Company ID" value={form.companyId} onChange={e => setForm({...form, companyId: e.target.value})} required />
              <input className="input-field" type="number" placeholder="Amount" value={form.amount} onChange={e => setForm({...form, amount: Number(e.target.value)})} />
              <input className="input-field" type="number" placeholder="Probability %" value={form.probability} onChange={e => setForm({...form, probability: Number(e.target.value)})} />
            </div>
            <select className="input-field" value={form.stage} onChange={e => setForm({...form, stage: e.target.value})}>
              {Object.keys(STAGES).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Create</button><button type="button" onClick={() => setShowNew(false)} className="btn-secondary text-sm">Cancel</button></div>
          </form>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : opps.length === 0 ? (
        <div className="text-center py-12 card"><Target size={40} className="text-gray-600 mx-auto mb-3" /><p className="text-gray-500">No opportunities yet</p></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-surface-border text-left text-gray-500 text-xs uppercase"><th className="p-3">Name</th><th className="p-3">Company</th><th className="p-3">Stage</th><th className="p-3">Amount</th><th className="p-3">Prob.</th><th className="p-3">Weighted</th></tr></thead>
            <tbody>{opps.map(o => (
              <tr key={o.id} className="border-b border-surface-border/50 hover:bg-surface-lighter/30">
                <td className="p-3 font-medium text-white">{o.name}</td><td className="p-3 text-gray-400">{o.company?.name || "-"}</td>
                <td className="p-3"><span className={`badge ${STAGES[o.stage] || ""}`}>{o.stage}</span></td>
                <td className="p-3">${o.amount.toLocaleString()}</td><td className="p-3">{o.probability}%</td>
                <td className="p-3 text-cyber-400">${((o.amount * o.probability) / 100).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
