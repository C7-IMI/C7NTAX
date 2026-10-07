import { useEffect, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";
import { Calendar, X } from "lucide-react";
import { apiErrorMessage } from "../../lib/apiError";

interface SavedReport { id: string; name: string; type: string }

/**
 * Schedules a *saved* report. A schedule points at a stored report because that is what the
 * delivery worker can find again tomorrow — a standard report has no row to point at, so it is
 * saved as a custom report first (the Custom Reports screen does this in one step).
 *
 * Failure is reported rather than swallowed: the previous version closed the dialog whatever
 * happened, so a rejected schedule looked exactly like a saved one.
 */
export function ScheduleReportDialog({ onClose, reportId }: { onClose: () => void; reportId?: string }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [form, setForm] = useState({ reportId: reportId ?? "", frequency: "weekly", dayOfWeek: "1", dayOfMonth: "1", timeOfDay: "06:00", recipients: "", format: "pdf" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get("/reports")
      .then((r: { data: SavedReport[] }) => {
        const list = (r.data ?? []) as SavedReport[];
        setReports(list);
        setForm(f => ({ ...f, reportId: f.reportId || list[0]?.id || "" }));
      })
      .catch(() => setReports([]));
  }, []);

  const submit = async () => {
    if (!form.reportId) { setError("Choose a report to schedule."); return; }
    const recipients = form.recipients.split(/[,;\s]+/).map(r => r.trim()).filter(Boolean);
    if (recipients.length === 0) { setError("Give at least one recipient address."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/reports/${form.reportId}/schedules`, {
        frequency: form.frequency,
        dayOfWeek: form.frequency === "weekly" ? Number(form.dayOfWeek) : null,
        dayOfMonth: form.frequency === "monthly" ? Number(form.dayOfMonth) : null,
        timeOfDay: form.timeOfDay,
        recipients,
        format: form.format,
      });
      toast.success("Report scheduled");
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "Could not schedule the report"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Calendar size={14} /> Schedule a report</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>

        {reports.length === 0 ? (
          <p className="text-sm text-gray-500">
            No saved reports yet. Save one from Custom Reports and it can be scheduled here.
          </p>
        ) : (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Report</label>
              <select className="input-field w-full" value={form.reportId} onChange={e => setForm({ ...form, reportId: e.target.value })}>
                <option value="">Select a report…</option>
                {reports.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">How often</label>
                <select className="input-field w-full" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              {form.frequency === "weekly" ? (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Day</label>
                  <select className="input-field w-full" value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: e.target.value })}>
                    {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
                  </select>
                </div>
              ) : form.frequency === "monthly" ? (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Day of month</label>
                  <input className="input-field w-full" type="number" min={1} max={28} value={form.dayOfMonth} onChange={e => setForm({ ...form, dayOfMonth: e.target.value })} />
                </div>
              ) : <div />}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Time</label>
                <input className="input-field w-full" type="time" value={form.timeOfDay} onChange={e => setForm({ ...form, timeOfDay: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Recipients</label>
              <input className="input-field w-full" placeholder="finance@example.com, ops@example.com" value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Format</label>
              <select className="input-field w-full" value={form.format} onChange={e => setForm({ ...form, format: e.target.value })}>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
                <option value="xls">Excel</option>
              </select>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary text-sm px-3 py-1.5" onClick={onClose}>Cancel</button>
              <button className="btn-primary text-sm px-3 py-1.5" disabled={busy} onClick={submit}>{busy ? "Scheduling…" : "Schedule"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ScheduleReportDialog;
