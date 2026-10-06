import { useEffect, useRef, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Mail, Plus, RefreshCw, Trash2, Power, ShieldCheck, Info, AlertTriangle, Link2, Unlink } from "lucide-react";

interface Connector {
  id: string;
  boardId: string;
  transport: "imap" | "ews" | "graph";
  authType: "basic" | "clientSecret" | "delegated";
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
  hasRefreshToken: boolean;
  oauthAccount: string | null;
  oauthConnectedAt: string | null;
  defaultCompanyId: string | null;
  autoCreateCompany: boolean;
  autoCreateContact: boolean;
  markSeenOnSuccess: boolean;
  ignoreAutoReplies: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastProcessedAt: string | null;
  processedCount: number;
}

interface Board {
  id: string;
  name: string;
}

interface Company {
  id: string;
  name: string;
}

type Transport = "graph" | "ews" | "imap";
type GraphAuth = "clientSecret" | "delegated";

const emptyForm = {
  boardId: "",
  transport: "graph" as Transport,
  graphAuth: "clientSecret" as GraphAuth,
  // Graph
  tenantId: "",
  clientId: "",
  clientSecret: "",
  mailbox: "",
  // EWS / IMAP
  host: "",
  port: "993",
  secure: true,
  user: "",
  password: "",
  folder: "Inbox",
  pollIntervalSeconds: "300",
  // Ingestion rules
  defaultCompanyId: "",
  autoCreateCompany: false,
  autoCreateContact: true,
  markSeenOnSuccess: true,
  ignoreAutoReplies: true,
};

const graphDefaults = { folder: "Inbox" };
const imapDefaults = { folder: "INBOX" };
const ewsDefaults = { folder: "Inbox", port: "443" };

/** The API returns { error: { message, status } }; show the message, not the object. */
function errText(e: any, fallback: string): string {
  const raw = e?.response?.data?.error;
  return (typeof raw === "string" ? raw : raw?.message) || e?.message || fallback;
}

const transportLabel = (c: Connector) =>
  c.transport === "graph" ? (c.authType === "delegated" ? "→ Microsoft 365 (delegated)" : "→ Microsoft 365") : c.transport === "ews" ? "→ Exchange (EWS)" : `→ ${c.host}`;

/** Email connector management panel (kind=email_connector integrations). */
export function EmailConnectorsPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [busy, setBusy] = useState<string | null>(null);
  const handledRedirect = useRef(false);

  const load = () => {
    api.get("/email-connectors").then((r) => setConnectors(r.data.data || [])).catch(() => {});
    api.get("/boards").then((r) => setBoards(r.data || [])).catch(() => {});
    api.get("/clients", { params: { limit: 200, sort: "name" } })
      .then((r) => setCompanies(r.data?.data || []))
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  // ── "Connect to Microsoft" round trip ──
  // The callback redirects the browser here with the outcome in the query string.
  // When the flow ran in a popup, the opener is told and the popup closes; when
  // popups were blocked the same page handles it directly.
  useEffect(() => {
    const finish = (account: string | null) => {
      toast.success(account ? `Connected to Microsoft as ${account}` : "Connected to Microsoft");
      load();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; connected?: string; account?: string; reason?: string };
      if (data?.type !== "c7:email-connector-connect") return;
      if (data.connected === "1") finish(data.account || null);
      else toast.error(data.reason || "Could not connect to Microsoft", { duration: 9000 });
    };
    window.addEventListener("message", onMessage);

    if (!handledRedirect.current) {
      handledRedirect.current = true;
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("connected");
      if (connected !== null) {
        const account = params.get("account");
        const reason = params.get("reason");
        const inPopup = Boolean(window.opener && !window.opener.closed);
        if (inPopup) {
          window.opener.postMessage({ type: "c7:email-connector-connect", connected, account, reason }, window.location.origin);
          window.close();
        } else if (connected === "1") {
          finish(account);
        } else {
          toast.error(reason || "Could not connect to Microsoft", { duration: 9000 });
        }
        const clean = new URL(window.location.href);
        ["connected", "account", "reason", "emailConnector"].forEach((k) => clean.searchParams.delete(k));
        window.history.replaceState({}, "", `${clean.pathname}${clean.search ? clean.search : ""}`);
      }
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const setTransport = (transport: Transport) =>
    setForm((f) => ({
      ...f,
      transport,
      folder: transport === "graph" ? graphDefaults.folder : transport === "ews" ? ewsDefaults.folder : imapDefaults.folder,
      port: transport === "ews" ? ewsDefaults.port : transport === "imap" ? "993" : f.port,
    }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    try {
      const rules = {
        defaultCompanyId: form.defaultCompanyId || null,
        autoCreateCompany: form.autoCreateCompany,
        autoCreateContact: form.autoCreateContact,
        markSeenOnSuccess: form.markSeenOnSuccess,
        ignoreAutoReplies: form.ignoreAutoReplies,
        pollIntervalSec: Number(form.pollIntervalSeconds) || 300,
      };
      const payload = form.transport === "graph"
        ? {
            transport: "graph",
            authType: form.graphAuth,
            boardId: form.boardId,
            user: form.mailbox,
            tenantId: form.tenantId,
            clientId: form.clientId,
            clientSecret: form.clientSecret,
            folder: form.folder || graphDefaults.folder,
            ...rules,
          }
        : {
            transport: form.transport,
            authType: "basic",
            boardId: form.boardId,
            user: form.user,
            host: form.host,
            port: Number(form.port) || (form.transport === "ews" ? 443 : 993),
            secure: form.secure,
            password: form.password,
            folder: form.folder || (form.transport === "ews" ? ewsDefaults.folder : imapDefaults.folder),
            ...rules,
          };
      await api.post("/email-connectors", payload);
      toast.success(
        form.transport === "graph" && form.graphAuth === "delegated"
          ? "Connector created — now press Connect to Microsoft to authorize the mailbox"
          : "Connector created — test the connection, then switch it on",
      );
      setForm({ ...emptyForm });
      load();
    } catch (err: any) {
      toast.error(errText(err, "Create failed"), { duration: 9000 });
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
      const prefix = data?.transport === "graph" ? "Microsoft Graph: " : data?.transport === "ews" ? "Exchange EWS: " : data?.transport === "imap" ? "IMAP: " : "";
      toast.error(`${prefix}${errText(err, "Test failed")}`, { duration: 12000 });
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

  const connect = async (c: Connector) => {
    setBusy(c.id);
    try {
      const r = await api.post(`/email-connectors/${c.id}/oauth/start`);
      const url = r.data?.url as string;
      const popup = window.open(url, "c7-ms-connect", "width=620,height=780,menubar=no,toolbar=no");
      if (!popup) toast.error(`Your browser blocked the sign-in window. Open this URL to authorize:\n${url}`, { duration: 20000 });
    } catch (err: any) {
      toast.error(errText(err, "Could not start the Microsoft sign-in"), { duration: 12000 });
    } finally { setBusy(null); }
  };

  const disconnect = async (c: Connector) => {
    setBusy(c.id);
    try {
      await api.post(`/email-connectors/${c.id}/oauth/disconnect`);
      toast.success("Disconnected");
      load();
    } catch (err: any) { toast.error(errText(err, "Disconnect failed")); }
    finally { setBusy(null); }
  };

  const remove = async (c: Connector) => {
    setBusy(c.id);
    try { await api.delete(`/email-connectors/${c.id}`); toast.success("Deleted"); load(); }
    catch (err: any) { toast.error(errText(err, "Delete failed")); } finally { setBusy(null); }
  };

  const boardName = (id: string) => boards.find((b) => b.id === id)?.name || id;
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name || "Unknown client" : "");

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
                {c.user || c.oauthAccount || "(no mailbox)"} <span className="text-gray-500 font-normal">{transportLabel(c)}</span>
              </p>
              <p className="text-xs text-gray-500">
                Board: {boardName(c.boardId)} · Folder: {c.folder || (c.transport === "graph" ? "Inbox" : "INBOX")} · Poll: {c.pollIntervalSec}s
                {c.lastPollAt ? ` · Last poll: ${new Date(c.lastPollAt).toLocaleString()}` : ""}
                {c.processedCount > 0 ? ` · ${c.processedCount} message(s) processed` : ""}
                {c.defaultCompanyId ? ` · Unmatched senders → ${companyName(c.defaultCompanyId)}` : c.autoCreateCompany ? " · Unmatched senders → new client per domain" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`badge ${c.enabled ? "bg-green-600/15 text-green-400" : "bg-surface-lighter text-gray-500"}`}>
                {c.enabled ? "Watching" : "Off"}
              </span>
              {c.transport === "graph" && c.authType === "delegated" && (
                c.hasRefreshToken
                  ? <button title="Disconnect the Microsoft sign-in" onClick={() => disconnect(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-green-400 hover:text-white"><Unlink size={14} /></button>
                  : <button title="Connect to Microsoft" onClick={() => connect(c)} disabled={busy === c.id} className="p-1.5 rounded bg-cyber-600 text-white hover:bg-cyber-500"><Link2 size={14} /></button>
              )}
              <button title={c.enabled ? "Stop watching" : "Start watching"} onClick={() => toggle(c)} disabled={busy === c.id}
                className={`p-1.5 rounded ${c.enabled ? "bg-green-600/20 text-green-400" : "bg-gray-700 text-gray-400"}`}><Power size={14} /></button>
              <button title="Test connection" onClick={() => test(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><RefreshCw size={14} /></button>
              <button title="Poll now" onClick={() => poll(c)} disabled={busy === c.id || !c.enabled} className="p-1.5 rounded bg-gray-700 text-gray-300 hover:text-white"><Mail size={14} /></button>
              <button title="Delete" onClick={() => remove(c)} disabled={busy === c.id} className="p-1.5 rounded bg-gray-700 text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
            </div>
          </div>
          {c.transport === "graph" && c.authType === "delegated" && (
            <p className={`text-xs flex items-center gap-1.5 pt-1 ${c.hasRefreshToken ? "text-green-400" : "text-amber-300"}`}>
              {c.hasRefreshToken
                ? <>Signed in as {c.oauthAccount || c.user}{c.oauthConnectedAt ? ` since ${new Date(c.oauthConnectedAt).toLocaleString()}` : ""}</>
                : <>Not connected to Microsoft yet — press the link button to authorize the mailbox.</>}
            </p>
          )}
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
          <button type="button" onClick={() => setTransport("ews")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.transport === "ews" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
            Exchange (EWS, on-premises)
          </button>
          <button type="button" onClick={() => setTransport("imap")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.transport === "imap" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
            IMAP (username + password)
          </button>
        </div>

        {form.transport === "graph" && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setForm((f) => ({ ...f, graphAuth: "clientSecret" }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.graphAuth === "clientSecret" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
              App-only (client secret)
            </button>
            <button type="button" onClick={() => setForm((f) => ({ ...f, graphAuth: "delegated" }))}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.graphAuth === "delegated" ? "bg-cyber-600/20 border-cyber-500/50 text-white" : "bg-surface-lighter border-surface-border text-gray-400 hover:text-white"}`}>
              Connect to Microsoft (delegated)
            </button>
          </div>
        )}

        {form.transport === "graph" && form.graphAuth === "clientSecret" && (
          <div className="flex items-start gap-2 rounded-lg border border-cyber-500/20 bg-cyber-500/5 p-3">
            <ShieldCheck size={14} className="text-cyber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">
              Microsoft has disabled Basic authentication for Exchange Online in every tenant, so a mailbox on Microsoft 365 can only be read with an
              OAuth app. In Entra, register an app, grant it the <strong>application</strong> permission <strong>Mail.ReadWrite</strong> with admin consent
              (write is needed to mark messages processed), and scope its access to this one mailbox with Exchange Online RBAC for Applications. Then paste the
              tenant, client id and secret here.
            </p>
          </div>
        )}
        {form.transport === "graph" && form.graphAuth === "delegated" && (
          <div className="flex items-start gap-2 rounded-lg border border-cyber-500/20 bg-cyber-500/5 p-3">
            <Link2 size={14} className="text-cyber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">
              In Entra, register an app and add the <strong>delegated</strong> permissions <strong>Mail.ReadWrite</strong> and <strong>User.Read</strong> plus
              <strong> offline_access</strong> (a Web platform redirect URI is created for you when you press Connect). Save the tenant and client id here, then
              press the link button on the connector to sign in — the mailbox it reads is the account that signs in, so no shared-mailbox scoping is needed.
              The client secret is optional; leave it empty for a public client using PKCE.
            </p>
          </div>
        )}
        {form.transport === "ews" && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <Info size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-gray-300">
              EWS is for <strong>on-premises</strong> Exchange (and hybrid servers where it is still exposed) and uses the mailbox username and password over
              Basic authentication, so the EWS virtual directory must allow Basic. Microsoft is retiring EWS for Exchange Online — use the Microsoft 365 option
              for cloud mailboxes. Only well-known folder names are supported (Inbox, SentItems, Drafts, DeletedItems, JunkEmail, Archive).
            </p>
          </div>
        )}
        {form.transport === "imap" && (
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
              {form.graphAuth === "clientSecret" && (
                <input className="input-field" placeholder="Mailbox to watch * (servicedesk@cyber7group.com)" value={form.mailbox} onChange={(e) => setForm({ ...form, mailbox: e.target.value })} required />
              )}
              <input className="input-field" placeholder="Directory (tenant) ID *" value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} required />
              <input className="input-field" placeholder="Application (client) ID *" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required />
              <input className="input-field" type="password" placeholder={form.graphAuth === "delegated" ? "Client secret (optional for a public client)" : "Client secret *"} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required={form.graphAuth === "clientSecret"} />
              <input className="input-field" placeholder="Folder (Inbox)" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
            </>
          ) : (
            <>
              <input className="input-field" placeholder={`Server * (e.g. ${form.transport === "ews" ? "mail.contoso.local" : "imap.fastmail.com"})`} value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
              <input className="input-field" placeholder={form.transport === "ews" ? "Port (443)" : "Port (993)"} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              <input className="input-field" placeholder="Username/email *" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} required />
              <input className="input-field" type="password" placeholder="Password *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <input className="input-field" placeholder={form.transport === "ews" ? "Folder (Inbox, SentItems, …)" : "Folder (INBOX)"} value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} /> Use TLS (secure)
              </label>
            </>
          )}

          <input className="input-field" type="number" min={30} placeholder="Poll interval seconds (300)" value={form.pollIntervalSeconds} onChange={(e) => setForm({ ...form, pollIntervalSeconds: e.target.value })} />
        </div>

        <div className="rounded-lg border border-surface-border p-3 space-y-2">
          <p className="text-xs font-medium text-gray-300">When the sender is not a known contact</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className="input-field" value={form.defaultCompanyId} onChange={(e) => setForm({ ...form, defaultCompanyId: e.target.value })}>
              <option value="">No default client — use the oldest client and warn</option>
              {companies.map((c) => <option key={c.id} value={c.id}>File under {c.name}</option>)}
            </select>
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.autoCreateCompany} onChange={(e) => setForm({ ...form, autoCreateCompany: e.target.checked })} /> Create a client for the sender's domain
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.autoCreateContact} onChange={(e) => setForm({ ...form, autoCreateContact: e.target.checked })} /> Create the contact
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.markSeenOnSuccess} onChange={(e) => setForm({ ...form, markSeenOnSuccess: e.target.checked })} /> Mark mail read after filing
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.ignoreAutoReplies} onChange={(e) => setForm({ ...form, ignoreAutoReplies: e.target.checked })} /> Ignore auto-replies
              </label>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            A sender is matched by contact email first, then by the client's email or website domain. The default client above is used next, and creating a
            client per domain is a last resort before the oldest-client fallback (which logs a warning).
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={busy === "create"} className="btn-primary flex items-center gap-2">
            <Plus size={14} /> Add Email Connector
          </button>
        </div>
      </form>
    </div>
  );
}
