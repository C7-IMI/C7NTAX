import { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Mail, Plus, RefreshCw, Trash2, Power } from "lucide-react";

interface Connector {
  id: string;
  name: string;
  enabled: boolean;
  hasCredentials: boolean;
  settings: { boardId?: string; folder?: string; pollIntervalSeconds?: number };
  status: string;
  errorMessage: string | null;
  lastSyncAt: string | null;
}

interface Board {
  id: string;
  name: string;
}

/** Email connector management panel (kind=email_connector integrations). */
export function EmailConnectorsPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [form, setForm] = useState({ name: "", host: "", port: "993", secure: true, user: "", password: "", folder: "INBOX", pollIntervalSeconds: "300", boardId: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.get("/email-connectors").then((r) => setConnectors(r.data.data || [])).catch(() => {});
    api.get("/boards").then((r) => setBoards(r.data || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    try {
      await api.post("/email-connectors", { ...form, port: Number(form.port) || 993, pollIntervalSeconds: Number(form.pollIntervalSeconds) || 300, secure: form.secure });
      toast.success("Email connector created");
      setForm({ name: "", host: "", port: "993", secure: true, user: "", password: "", folder: "INBOX", pollIntervalSeconds: "300", boardId: "" });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Create failed");
    } finally { setBusy(null); }
  };

  const toggle = async (c: Connector) => {
    setBusy(c.id);
    try {
      await api.patch(`/email-connectors/${c.id}`, { enabled: !c.enabled });
      load();
    } catch { toast.error("Toggle failed"); } finally { setBusy(null); }
  };

  const test = async (c: Connector) => {
    setBusy(c.id);
    try {
      const r = await api.post(`/email-connectors/${c.id}/test`);
      if (r.data.ok) toast.success(`Connected — ${r.data.unseenMessages} unseen message(s)`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Test failed");
    } finally { setBusy(null); load(); }
  };

  const poll = async (c: Connector) => {
    setBusy(c.id);
    try { await api.post(`/email-connectors/${c.id}/poll`); toast.success("Poll triggered"); }
    catch (err: any) { toast.error(err?.response?.data?.error || "Poll failed"); }
    finally { setBusy(null); }
  };

  const remove = async (c: Connector) => {
    setBusy(c.id);
    try { await api.delete(`/email-connectors/${c.id}`); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed"); } finally { setBusy(null); }
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Mail size={16} className="text-cyber-400" />
        <h3 className="text-sm font-semibold text-white">Email Connectors (IMAP → Service Tickets)</h3>
      </div>

      {connectors.length === 0 && <p className="text-sm text-gray-500">No email connectors yet. Add a mailbox to turn incoming emails into tickets.</p>}
      {connectors.map((c) => (
        <div key={c.id} className="border border-surface-border rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium text-sm">{c.name}</p>
              <p className="text-xs text-gray-500">Board: {c.settings.boardId || "—"} · Folder: {c.settings.folder || "INBOX"} · {c.status}{c.errorMessage ? ` · ${c.errorMessage.slice(0, 80)}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <button title={c.enabled ? "Disable" : "Enable"} onClick={() => toggle(c)} disabled={busy === c.id}
                className={`p-1.5 rounded ${c.enabled ? "bg-green-600/20 text-green-400" : "bg-gray-700 text-gray-400"}`}><Power size={14} /></button>
              <button title="Test connection" onClick={() => test(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><RefreshCw size={14} /></button>
              <button title="Poll now" onClick={() => poll(c)} disabled={busy === c.id || !c.enabled} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><Mail size={14} /></button>
              <button title="Delete" onClick={() => remove(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
            </div>
          </div>
        </div>
      ))}

      <form onSubmit={create} className="border-t border-surface-border pt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input className="input-field" placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="input-field" placeholder="IMAP host * (e.g. outlook.office365.com)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
        <input className="input-field" placeholder="Port (993)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
        <input className="input-field" placeholder="Username/email *" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} required />
        <input className="input-field" type="password" placeholder="Password *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <select className="input-field" value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })} required>
          <option value="">Target service board *</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="input-field" placeholder="Folder (INBOX)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
        <input className="input-field" type="number" min={30} placeholder="Poll interval seconds (300)" value={form.pollIntervalSeconds} onChange={(e) => setForm({ ...form, pollIntervalSeconds: e.target.value })} />
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} /> Use TLS (secure)
        </label>
        <div className="md:col-span-3 flex justify-end">
          <button type="submit" disabled={busy === "create"} className="btn-primary flex items-center gap-2 text-sm"><Plus size={14} /> Add Email Connector</button>
        </div>
      </form>
    </div>
  );
}
