import { useState, useEffect, useMemo } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Calendar, Clock, MapPin, Plus, ChevronLeft, ChevronRight } from "lucide-react";

interface ScheduleEntry {
  id: string; title: string; description?: string; startTime: string; endTime: string;
  location?: string; color?: string; ticket?: { id: string; ticketNumber: number; title: string };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function CalendarPage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", startTime: "", endTime: "", location: "", color: "#3b82d6" });
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const fetch = async () => {
    try { const r = await api.get("/schedule?limit=500"); setEntries(Array.isArray(r.data) ? r.data : (r.data.data || [])); }
    catch { toast.error("Failed to load"); } finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.post("/schedule", form); toast.success("Event created"); setShowCreate(false); setForm(prev => ({ ...prev, title: "", description: "", startTime: "", endTime: "", location: "", color: "#3b82d6" })); fetch(); }
    catch { toast.error("Failed"); }
  };

  // ── Monthly calendar helpers ──
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

  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEntry[]> = {};
    for (const e of entries) {
      const d = new Date(e.startTime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    }
    return map;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (!selectedDate) return entries;
    return entries.filter(e => {
      const d = new Date(e.startTime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return key === selectedDate;
    });
  }, [entries, selectedDate]);

  const dateKey = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold text-white">Calendar</h2><p className="text-sm text-gray-400">{entries.length} events</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm"><Plus size={16} /> Add Event</button>
      </div>

      {/* ── Monthly Calendar Card ── */}
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
                  {dayEvents.slice(0, 2).map((ev, ei) => (
                    <span key={ei} className="block truncate rounded px-1 py-px text-[9px] leading-tight" style={{ backgroundColor: (ev.color || "#3b82d6") + "1f", color: ev.color || "#3b82d6" }}>
                      {new Date(ev.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} {ev.title}
                    </span>
                  ))}
                  {dayEvents.length > 2 && <span className="block px-0.5 text-[9px] leading-tight text-gray-500">+{dayEvents.length - 2} more</span>}
                </span>
              </button>
            );
          })}
        </div>

        {selectedDate && (
          <div className="mt-3 flex items-center justify-between pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-400">
              Showing events for <span className="text-white">{MONTHS[new Date(selectedDate).getMonth()]} {new Date(selectedDate).getDate()}, {new Date(selectedDate).getFullYear()}</span>
            </p>
            <button onClick={() => setSelectedDate(null)} className="text-xs text-cyber-400 hover:text-cyber-300">Clear filter</button>
          </div>
        )}
      </div>

      {/* ── Scheduled Events Card ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-white mb-3">
          Scheduled Events {selectedDate ? `— ${filteredEntries.length} on this date` : `— ${entries.length} total`}
        </h3>
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            <Calendar size={36} className="text-gray-600 mx-auto mb-2" />
            <p className="text-sm">{selectedDate ? "No events on this date" : "No scheduled events"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredEntries.map(e => (
              <div key={e.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface-lighter transition-colors group">
                <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: (e.color || "#3b82d6") + "20" }}>
                  <Calendar size={16} style={{ color: e.color || "#3b82d6" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{e.title}</p>
                  {e.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{e.description}</p>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Clock size={11} />{new Date(e.startTime).toLocaleString()}</span>
                    {e.location && <span className="flex items-center gap-1"><MapPin size={11} />{e.location}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create Event Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <form className="card w-full max-w-md mx-4 space-y-3" onClick={e => e.stopPropagation()} onSubmit={handleCreate}>
            <h3 className="text-lg font-semibold text-white">New Event</h3>
            <input className="input-field" placeholder="Title *" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
            <textarea className="input-field" rows={2} placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            <div className="grid grid-cols-2 gap-2"><input className="input-field" type="datetime-local" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} required /><input className="input-field" type="datetime-local" value={form.endTime} onChange={e => setForm({...form, endTime: e.target.value})} /></div>
            <input className="input-field" placeholder="Location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
            <input className="input-field" type="color" value={form.color} onChange={e => setForm({...form, color: e.target.value})} />
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button><button type="submit" className="btn-primary text-sm">Create</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
