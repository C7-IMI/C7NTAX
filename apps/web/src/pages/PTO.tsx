import { useState, useEffect, useMemo } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Calendar, Clock, Plus, ChevronLeft, ChevronRight } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const STATUS_COLORS: Record<string, string> = {
  approved: "#4ade80",
  denied: "#f87171",
  pending: "#fbbf24",
};

export function PTOPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: "vacation", startDate: "", endDate: "", hours: 8, reason: "" });
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const fetch = () => {
    api.get("/pto").then(r => setRequests(r.data.data || r.data || [])).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = (e: any) => {
    e.preventDefault();
    api.post("/pto", form).then(() => { toast.success("Requested"); setShowCreate(false); setForm({ type: "vacation", startDate: "", endDate: "", hours: 8, reason: "" }); fetch(); }).catch(() => toast.error("Failed"));
  };

  // ── Monthly calendar helpers (same design as the Calendar page) ──
  const { year, month } = useMemo(() => ({ year: viewDate.getFullYear(), month: viewDate.getMonth() }), [viewDate]);

  const calendarDays = useMemo(() => {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const totalDays = last.getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(d);
    return cells;
  }, [year, month]);

  const dateKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Map each PTO request across every day of its span
  const eventsByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const r of requests) {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      let guard = 0;
      while (cursor <= endDay && guard < 400) {
        const key = dateKeyOf(cursor);
        if (!map[key]) map[key] = [];
        map[key].push(r);
        cursor.setDate(cursor.getDate() + 1);
        guard++;
      }
    }
    return map;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (!selectedDate) return requests;
    return requests.filter(r => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
      const sel = new Date(selectedDate + "T00:00:00");
      const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      return sel >= s && sel <= e;
    });
  }, [requests, selectedDate]);

  const dateKey = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const todayKey = dateKeyOf(new Date());

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Time Off</h2><p className="text-sm text-gray-400">{requests.length} requests</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Request Time Off</button>
      </div>

      {/* ── Monthly PTO Calendar Card ── */}
      <div className="card p-3 max-w-3xl">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setViewDate(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-surface-lighter text-gray-400 hover:text-white transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => { setViewDate(new Date()); setSelectedDate(null); }} className="text-sm font-semibold text-white hover:text-cyber-400 transition-colors">
            {MONTHS[month]} {year}
          </button>
          <button onClick={() => setViewDate(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-surface-lighter text-gray-400 hover:text-white transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-medium uppercase tracking-wide text-gray-500 py-0.5">{d}</div>
          ))}
        </div>

        {/* Day cells — mini card style with subtle borders and consistent spacing */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} className="aspect-square rounded-md border border-transparent" />;
            const dk = dateKey(day);
            const dayEvents = eventsByDate[dk] || [];
            const isToday = dk === todayKey;
            const isSelected = dk === selectedDate;
            return (
              <button
                key={dk}
                onClick={() => setSelectedDate(isSelected ? null : dk)}
                className={`aspect-square rounded-md border p-1 flex flex-col items-start text-left transition-colors
                  ${isSelected ? "border-cyber-500/60 bg-cyber-600/20" :
                    isToday ? "border-cyber-500/40 bg-cyber-600/10" :
                    "border-surface-border hover:border-gray-600 hover:bg-surface-lighter"}`}
              >
                <span className={`text-[11px] leading-none px-0.5 ${isToday && !isSelected ? "font-bold text-cyber-400" : "text-gray-300"}`}>{day}</span>
                <span className="mt-1 w-full space-y-0.5 overflow-hidden">
                  {dayEvents.slice(0, 2).map((r, ei) => {
                    const color = STATUS_COLORS[r.status] || "#94a3b8";
                    return (
                      <span key={ei} className="block truncate rounded px-1 py-px text-[9px] leading-tight capitalize" style={{ backgroundColor: color + "1f", color }}>
                        {r.type}
                      </span>
                    );
                  })}
                  {dayEvents.length > 2 && <span className="block px-0.5 text-[9px] leading-tight text-gray-500">+{dayEvents.length - 2} more</span>}
                </span>
              </button>
            );
          })}
        </div>

        {selectedDate && (
          <div className="mt-3 flex items-center justify-between pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-400">
              Showing requests for <span className="text-white">{MONTHS[new Date(selectedDate).getMonth()]} {new Date(selectedDate).getDate()}, {new Date(selectedDate).getFullYear()}</span>
            </p>
            <button onClick={() => setSelectedDate(null)} className="text-xs text-cyber-400 hover:text-cyber-300">Clear filter</button>
          </div>
        )}
      </div>

      {/* ── PTO Requests Card ── */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">PTO Requests {selectedDate ? `— ${filteredRequests.length} on this date` : `— ${requests.length} total`}</h3>
        </div>
        {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> :
         filteredRequests.length === 0 ? <div className="py-8 text-center text-gray-500"><Calendar size={36} className="text-gray-600 mx-auto mb-2" /><p className="text-sm">{selectedDate ? "No requests on this date" : "No PTO requests"}</p></div> :
        <table className="w-full text-sm">
          <thead><tr className="border-b border-surface-border text-left text-gray-400 text-xs uppercase"><th className="px-4 py-3">Type</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Hours</th><th className="px-4 py-3">Status</th></tr></thead>
          <tbody>{filteredRequests.map(r => (
            <tr key={r.id} className="border-b border-surface-border/50">
              <td className="px-4 py-3 text-white capitalize">{r.type}</td>
              <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.startDate).toLocaleDateString()} - {new Date(r.endDate).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-gray-400">{r.hours}h</td>
              <td className="px-4 py-3"><span className={`badge text-xs ${r.status === "approved" ? "bg-green-600/20 text-green-400" : r.status === "denied" ? "bg-red-600/20 text-red-400" : "bg-amber-600/20 text-amber-400"}`}>{r.status}</span></td>
            </tr>
          ))}</tbody>
        </table>}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">Request Time Off</h3>
            <select className="input-field" value={form.type} onChange={e => setForm({...form, type: e.target.value})}><option value="vacation">Vacation</option><option value="sick">Sick</option><option value="personal">Personal</option></select>
            <input className="input-field" type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} required />
            <input className="input-field" type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} required />
            <input className="input-field" type="number" placeholder="Hours" value={form.hours} onChange={e => setForm({...form, hours: Number(e.target.value)})} />
            <textarea className="input-field" rows={2} placeholder="Reason" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Submit</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
