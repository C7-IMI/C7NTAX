import { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Mail, Plus, RefreshCw, Trash2, Power, ShieldCheck, Info, AlertTriangle } from "lucide-react";

interface Connector {
  id: string;
  boardId: string;
  transport: "imap" | "graph";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  folder: string;
  pollIntervalSec: number;
  enabled: boolean;
  lastPollAt: string | null;
  tenantId: string | null;
  clientId: string | null;
  hasPassword: boolean;
  hasClientSecret: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessedAt: string | null;
  processedCount: number;
}

interface Board {
  id: string;
  name: string;
}

type Transport = "graph" | "imap";

const emptyForm = {
  name: "",
  boardId: "",
  transport: "graph" as Transport,
  // Graph
  tenantId: "",
  clientId: "",
  clientSecret: "",
  mailbox: "",
  // IMAP
  host: "",
  port: "993",
  secure: true,
  user: "",
  password: "",
  folder: "INBOX",
  pollIntervalSeconds: "300",
};

const graphDefaults = { folder: "Inbox" };
const imapDefaults = { folder: "INBOX" };

/** The API returns { error: { message, status } }; show the message, not the object. */
function errText(e: any, fallback: string): string {
  const raw = e?.response?.data?.error;
  return (typeof raw === "string" ? raw : raw?.message) || e?.message || fallback;
}

/** Email connector management panel (kind=email_connector integrations). */
export function EmailConnectorsPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.get("/email-connectors").then((r) => setConnectors(r.data.data || [])).catch(() => {});
    api.get("/boards").then((r) => setBoards(r.data || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const setTransport = (transport: Transport) =>
    setForm((f) => ({ ...f, transport, folder: transport === "graph" ? graphDefaults.folder : imapDefaults.folder }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    try {
      const payload = form.transport === "graph"
        ? {
            transport: "graph",
            boardId: form.boardId,
            user: form.mailbox,
            tenantId: form.tenantId,
            clientId: form.clientId,
            clientSecret: form.clientSecret,
            folder: form.folder || graphDefaults.folder,
            pollIntervalSec: Number(form.pollIntervalSeconds) || 300,
          }
        : {
            transport: "imap",
            boardId: form.boardId,
            user: form.user,
            host: form.host,
            port: Number(form.port) || 993,
            secure: form.secure,
            password: form.password,
            folder: form.folder || imapDefaults.folder,
            pollIntervalSec: Number(form.pollIntervalSeconds) || 300,
          };
      await api.post("/email-connectors", payload);
      toast.success("Connector created — test the connection, then switch it on");
      setForm({ ...emptyForm });
      load();
    } catch (err: any) {
      toast.error(errText(err, "Create failed"));
    } finally { setBusy(null); }
  };

  const toggle = async (c: Connector) => {
    setBusy(c.id);
    try {
      await api.patch(`/email-connectors/${c.id}`, { enabled: !c.enabled });
      load();
    } catch (err: any) {
      toast.error(errText(err, "Toggle failed"));
    } finally { setBusy(null); }
  };

  const test = async (c: Connector) => {
    setBusy(c.id);
    try {
      const r = await api.post(`/email-connectors/${c.id}/test`);
      toast.success(r.data?.detail || "Connected");
    } catch (err: any) {
      const data = err?.response?.data;
      const prefix = data?.transport === "graph" ? "Microsoft Graph: " : data?.transport === "imap" ? "IMAP: " : "";
      toast.error(`${prefix}${errText(err, "Test failed")}`, { duration: 9000 });
    } finally { setBusy(null); load(); }
  };

  const poll = async (c: Connector) => {
    setBusy(c.id);
    try {
      const r = await api.post(`/email-connectors/${c.id}/poll`);
      if (r.data?.lastError) toast.error(r.data.lastError, { duration: 9000 });
      else toast.success("Polled the mailbox");
    } catch (err: any) { toast.error(errText(err, "Poll failed")); }
    finally { setBusy(null); load(); }
  };

  const remove = async (c: Connector) => {
    setBusy(c.id);
    try { await api.delete(`/email-connectors/${c.id}`); toast.success("Deleted"); load(); }
    catch (err: any) { toast.error(errText(err, "Delete failed")); } finally { setBusy(null); }
  };

  const boardName = (id: string) => boards.find((b) => b.id === id)?.name || id;

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Mail size={16} className="text-cyber-400" />
        <h3 className="text-sm font-semibold text-white">Email Connectors (mailbox → Service Tickets)</h3>
      </div>

      {connectors.length === 0 && <p className="text-sm text-gray-500">No email connectors yet. Add a mailbox to turn incoming emails into tickets.</p>}
      {connectors.map((c) => (
        <div key={c.id} className="border border-surface-border rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-white font-medium text-sm truncate">
                {c.user} {c.transport === "graph" ? <span className="text-gray-500 font-normal">→ Microsoft Graph</span> : <span className="text-gray-500 font-normal">→ {c.host}</span>}
              </p>
              <p className="text-xs text-gray-500">
                Board: {boardName(c.boardId)} · Folder: {c.folder || (c.transport === "graph" ? "Inbox" : "INBOX")} · Poll: {c.pollIntervalSec}s
                {c.lastPollAt ? ` · Last poll: ${new Date(c.lastPollAt).toLocaleString()}` : ""}
                {c.processedCount > 0 ? ` · ${c.processedCount} message(s) processed` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`badge ${c.enabled ? "bg-green-600/15 text-green-400" : "bg-surface-lighter text-gray-500"}`}>
                {c.enabled ? "Watching" : "Off"}
              </span>
              <button title={c.enabled ? "Stop watching" : "Start watching"} onClick={() => toggle(c)} disabled={busy === c.id}
                className={`p-1.5 rounded ${c.enabled ? "bg-green-600/20 text-green-400" : "bg-gray-700 text-gray-400"}`}><Power size={14} /></button>
              <button title="Test connection" onClick={() => test(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><RefreshCw size={14} /></button>
              <button title="Poll now" onClick={() => poll(c)} disabled={busy === c.id || !c.enabled} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><Mail size={14} /></button>
              <button title="Delete" onClick={() => remove(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
            </div>
          </div>
          {c.lastError && (
            <p className="text-xs text-red-300 flex items-start gap-1.5 pt-1">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                {c.lastError}
                {c.lastErrorAt ? <span className="text-gray-500"> ({new Date(c.lastErrorAt).toLocaleString()})</span> : null}
              </span>
            </p>
          )}
        </div>
      ))}

      <form onSubmit={create} className="border-t border-surface-border pt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTransport("graph")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.transport === "graph" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
            Microsoft 365 / Exchange Online
          </button>
          <button type="button" onClick={() => setTransport("imap")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.transport === "imap" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
            IMAP (username + password)
          </button>
        </div>

        {form.transport === "graph" ? (
          <div className="flex items-start gap-2 rounded-lg border border-cyber-500/20 bg-cyber-500/5 p-3">
            <ShieldCheck size={14} className="text-cyber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">
              Microsoft has disabled Basic authentication for Exchange Online in every tenant, so a mailbox on Microsoft 365 can only be read with an
              OAuth app. In Entra, register an app, grant it the <strong>application</strong> permission <strong>Mail.ReadWrite</strong> with admin consent
              (write is needed to mark messages processed), and scope its access to this one mailbox with Exchange Online RBAC for Applications. Then paste the
              tenant, client id and secret here.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">
              IMAP with a password works for mailboxes that still accept one (often with an app password). It will <strong>not</strong> work for Microsoft 365
              or Exchange Online — use the Microsoft 365 option above for those.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select className="input-field" value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })} required>
            <option value="">Target service board *</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {form.transport === "graph" ? (
            <>
              <input className="input-field" placeholder="Mailbox to watch * (servicedesk@cyber7group.com)" value={form.mailbox} onChange={(e) => setForm({ ...form, mailbox: e.target.value })} required />
              <input className="input-field" placeholder="Directory (tenant) ID *" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required />
              <input className="input-field" placeholder="Application (client) ID *" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required />
              <input className="input-field" type="password" placeholder="Client secret *" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required />
              <input className="input-field" placeholder="Folder (Inbox)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
            </>
          ) : (
            <>
              <input className="input-field" placeholder="IMAP host * (e.g. imap.fastmail.com)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
              <input className="input-field" placeholder="Port (993)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              <input className="input-field" placeholder="Username/email *" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} required />
              <input className="input-field" type="password" placeholder="Password *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <input className="input-field" placeholder="Folder (INBOX)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} /> Use TLS (secure)
              </label>
            </>
          )}

          <input className="input-field" type="number" min={30} placeholder="Poll interval seconds (300)" value={form.pollIntervalSeconds} onChange={(e) => setForm({ ...form, pollIntervalSeconds: e.target.value })} />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={busy === "create"} className="btn-primary flex items-center gap-2 text-sm"><Plus size={14} /> Add Email Connector</button>
        </div>
      </form>
    </div>
  );
}

