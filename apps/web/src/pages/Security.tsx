/**
 * Sign-in audit, live sessions and registered devices — Administration's security screen.
 *
 * Three questions, three tabs, in the order they are asked: *did anybody try to get in* (the sign-in
 * log, which is Entra's), *who is signed in right now* (live sessions, revocable), and *on what* (the
 * devices an account has registered, removable). They share a screen because they are read together —
 * an unexpected sign-in is followed by "which session is it?" and then "what device is that?" — and a
 * reader who has to move between three pages to answer one question will stop halfway.
 *
 * The summary tiles above the log are computed from the same filter as the table, so "how many of the
 * failures were lockouts" is answerable per window rather than only in total.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ShieldAlert, ShieldCheck, KeyRound, MonitorSmartphone, LogOut, Trash2, RefreshCw,
  Lock, XCircle, LogIn, Smartphone, Search,
} from "lucide-react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { PageHeader } from "../components/ui";
import { Tabs } from "../components/ui/Tabs";
import { StatCard } from "../components/ui";
import { TableSkeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui";
import { useModernInterface } from "../hooks/useNavigationStyle";

type Tab = "sign-ins" | "sessions" | "devices";

interface SignInRow {
  id: string;
  createdAt: string;
  result: string;
  method: string;
  reason: string | null;
  email: string;
  ipAddress: string | null;
  device: string | null;
  userId: string | null;
  sessionId: string | null;
  userName: string | null;
  roleName: string | null;
}

interface SessionRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  roleName: string | null;
  ipAddress: string | null;
  device: string | null;
  method: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  invalidatedAt: string | null;
  active: boolean;
}

interface DeviceRow {
  id: string;
  kind: "passkey" | "push";
  label: string;
  platform: string | null;
  user: { id: string; email: string; name: string } | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The result words, as a reader says them. `mfa_failed` and `code_failed` read as one thing to
 * somebody looking for "attempts that did not get in", which is why the screen groups them.
 */
const RESULT_LABEL: Record<string, string> = {
  success: "Signed in",
  failure: "Failed",
  locked: "Locked out",
  mfa_failed: "MFA failed",
  code_failed: "Code failed",
  signed_out: "Signed out",
};

/** Tone per result: only two of these are good news, and the tiles should not pretend otherwise. */
const RESULT_TONE: Record<string, string> = {
  success: "chip--good",
  signed_out: "text-gray-400",
  failure: "chip--bad",
  locked: "chip--bad",
  mfa_failed: "chip--warn",
  code_failed: "chip--warn",
};

const METHOD_LABEL: Record<string, string> = {
  password: "Password",
  totp: "Authenticator app",
  email_code: "Emailed code",
  passkey: "Passkey",
  sso: "Single sign-on",
  portal_code: "Portal code",
};

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

export function SecurityPage() {
  const modern = useModernInterface();
  const [params, setParams] = useSearchParams();
  const tab = (["sign-ins", "sessions", "devices"].includes(params.get("tab") ?? "")
    ? params.get("tab")
    : "sign-ins") as Tab;
  const userId = params.get("userId") ?? "";

  const [rows, setRows] = useState<SignInRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; success: number; failure: number; locked: number; mfaFailed: number; signedOut: number; users: number; devices: number } | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"active" | "ended" | "all">("active");
  const [busy, setBusy] = useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = useCallback(() => {
    setLoading(true);
    if (tab === "sign-ins") {
      api.get("/security/sign-ins", { params: { result: result || undefined, search: search || undefined, userId: userId || undefined, limit: 100 } })
        .then((r) => { setRows(r.data.data ?? []); setSummary(r.data.summary ?? null); })
        .catch((error) => toast.error(apiErrorMessage(error, "Could not load the sign-in log")))
        .finally(() => setLoading(false));
      return;
    }
    if (tab === "sessions") {
      api.get("/security/sessions", { params: { userId: userId || undefined, state } })
        .then((r) => setSessions(r.data.data ?? []))
        .catch((error) => toast.error(apiErrorMessage(error, "Could not load sessions")))
        .finally(() => setLoading(false));
      return;
    }
    api.get("/security/devices", { params: { userId: userId || undefined } })
      .then((r) => setDevices(r.data.data ?? []))
      .catch((error) => toast.error(apiErrorMessage(error, "Could not load devices")))
      .finally(() => setLoading(false));
  }, [tab, result, search, userId, state]);

  useEffect(() => { load(); }, [load]);

  const signOutSession = async (row: SessionRow) => {
    setBusy(row.id);
    try {
      const r = await api.delete(`/security/sessions/${row.id}`);
      toast.success(r.data?.revoked ? `Signed ${row.userName || row.userEmail} out` : "That session had already ended");
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not revoke the session"));
    } finally { setBusy(null); }
  };

  const signOutEverywhere = async (row: SessionRow) => {
    setBusy(`all-${row.userId}`);
    try {
      const r = await api.post("/security/sessions/revoke-user", { userId: row.userId });
      toast.success(`${row.userName || row.userEmail}: ${r.data?.revoked ?? 0} session(s) ended`);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not revoke the sessions"));
    } finally { setBusy(null); }
  };

  const removeDevice = async (row: DeviceRow) => {
    setBusy(row.id);
    try {
      await api.delete(row.kind === "passkey" ? `/security/devices/passkey/${row.id}` : `/security/devices/push/${row.id}`);
      toast.success(`${row.label} removed`);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not remove the device"));
    } finally { setBusy(null); }
  };

  const tabs = useMemo(() => ([
    { id: "sign-ins" as Tab, label: "Sign-in audit", count: summary?.total },
    { id: "sessions" as Tab, label: "Active sessions", count: sessions.filter((s) => s.active).length || undefined },
    { id: "devices" as Tab, label: "Devices", count: devices.length || undefined },
  ]), [summary?.total, sessions, devices]);

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl">
      <PageHeader
        title="Sign-in audit"
        subtitle="Who signed in, who did not get in, what is signed in now, and on which device"
        actions={
          <button onClick={load} className="btn-secondary text-sm flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <Tabs items={tabs} value={tab} onChange={(id) => setParam("tab", id)} label="Security sections" />

      {userId && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="chip">Filtered to one account</span>
          <button onClick={() => setParam("userId", "")} className="text-cyber-400 hover:text-cyber-300">Show everyone</button>
        </div>
      )}

      {/* ── Sign-in audit ─────────────────────────────────────────────────── */}
      {tab === "sign-ins" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Signed in" value={summary?.success ?? "—"} icon={<ShieldCheck size={16} />} tone="green" />
            <StatCard label="Failed" value={summary?.failure ?? "—"} icon={<XCircle size={16} />} tone="red" />
            <StatCard label="Locked out" value={summary?.locked ?? "—"} icon={<Lock size={16} />} tone="amber" />
            {/* Devices rather than sign-ins: a count of rows would flatter a busy day, a count of
                devices says how many machines are involved. */}
            <StatCard label="People / devices" value={summary ? `${summary.users} / ${summary.devices}` : "—"} icon={<MonitorSmartphone size={16} />} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input-field pl-9 w-64"
                placeholder="Address, device, IP or reason…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="input-field w-44" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">Every outcome</option>
              <option value="success">Signed in</option>
              <option value="failure">Failed</option>
              <option value="locked">Locked out</option>
              <option value="mfa_failed">MFA failed</option>
              <option value="code_failed">Code failed</option>
              <option value="signed_out">Signed out</option>
            </select>
            <span className="text-xs text-gray-500 tabular-nums">{rows.length} shown</span>
          </div>

          {loading ? <TableSkeleton /> : rows.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert size={20} />}
              title="Nothing recorded yet"
              description="Attempts appear here as they happen — including the ones that failed. Widening the filter or clearing the search may find what you are after."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-surface-border">
                    <th className="py-2 pr-3 font-semibold">When</th>
                    <th className="py-2 pr-3 font-semibold">Account</th>
                    <th className="py-2 pr-3 font-semibold">Outcome</th>
                    <th className="py-2 pr-3 font-semibold">Method</th>
                    <th className="py-2 pr-3 font-semibold">Device</th>
                    <th className="py-2 pr-3 font-semibold">IP address</th>
                    <th className="py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-surface-border/50 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-400">{when(row.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <span className="block text-gray-200">{row.userName || row.email}</span>
                        {row.userName && <span className="block text-xs text-gray-500">{row.email}</span>}
                        {row.roleName && <span className="block text-xs text-gray-600">{row.roleName}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`chip ${RESULT_TONE[row.result] ?? ""}`}>{RESULT_LABEL[row.result] ?? row.result}</span>
                      </td>
                      <td className="py-2 pr-3 text-gray-400">{METHOD_LABEL[row.method] ?? row.method}</td>
                      <td className="py-2 pr-3 text-gray-400">
                        {row.device ?? <span className="text-gray-600">not recognised</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-400">
                        {row.ipAddress ?? <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-2 text-gray-400">{row.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Active sessions ───────────────────────────────────────────────── */}
      {tab === "sessions" && (
        <>
          {modern && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-surface-border p-0.5">
                {([["active", "Signed in"], ["ended", "Ended"], ["all", "All"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setState(value)}
                    aria-pressed={state === value}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${state === value ? "bg-cyber-600 text-white" : "text-gray-400 hover:text-white"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-500">
                A revoked session stops working immediately — the cookie it was using no longer resolves.
              </span>
            </div>
          )}

          {loading ? <TableSkeleton /> : sessions.length === 0 ? (
            <EmptyState
              icon={<LogIn size={20} />}
              title={state === "active" ? "Nobody is signed in" : "No sessions to show"}
              description="A session appears here the moment somebody signs in through the browser, and disappears when they sign out, time out, or are revoked here."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-surface-border">
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 font-semibold">Device</th>
                    <th className="py-2 pr-3 font-semibold">Signed in with</th>
                    <th className="py-2 pr-3 font-semibold">IP address</th>
                    <th className="py-2 pr-3 font-semibold">Started</th>
                    <th className="py-2 pr-3 font-semibold">Last seen</th>
                    <th className="py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => (
                    <tr key={row.id} className="border-b border-surface-border/50">
                      <td className="py-2 pr-3">
                        <span className="block text-gray-200">{row.userName || row.userEmail}</span>
                        <span className="block text-xs text-gray-500">{row.userEmail}</span>
                        {row.roleName && <span className="block text-xs text-gray-600">{row.roleName}</span>}
                      </td>
                      <td className="py-2 pr-3 text-gray-400">{row.device ?? <span className="text-gray-600">not recognised</span>}</td>
                      <td className="py-2 pr-3 text-gray-400">
                        {row.method ? METHOD_LABEL[row.method] ?? row.method : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs text-gray-400">{row.ipAddress ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-400">{when(row.createdAt)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-400">
                        {when(row.lastActivityAt)}
                        {!row.active && <span className="block text-xs text-gray-600">{row.invalidatedAt ? `revoked ${when(row.invalidatedAt)}` : "expired"}</span>}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          {row.active && (
                            <button
                              onClick={() => signOutSession(row)}
                              disabled={busy === row.id}
                              className="btn-secondary text-xs inline-flex items-center gap-1.5"
                              title="End this session"
                            >
                              <LogOut size={12} /> Revoke
                            </button>
                          )}
                          <button
                            onClick={() => signOutEverywhere(row)}
                            disabled={busy === `all-${row.userId}`}
                            className="btn-secondary text-xs inline-flex items-center gap-1.5"
                            title="End every session this person has"
                          >
                            Sign out everywhere
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Devices ───────────────────────────────────────────────────────── */}
      {tab === "devices" && (
        <>
          <p className="text-sm text-gray-400">
            Passkeys sign in; browser notifications receive. A passkey is added by the person it belongs
            to — on <span className="text-gray-300">My Settings → Security</span> — so what an administrator
            needs here is the other half: seeing one that should not be there, and removing it.
          </p>
          {loading ? <TableSkeleton /> : devices.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={20} />}
              title="No devices registered"
              description="A passkey or a browser notification subscription appears here as soon as somebody registers one on their own account."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-surface-border">
                    <th className="py-2 pr-3 font-semibold">Device</th>
                    <th className="py-2 pr-3 font-semibold">Kind</th>
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 font-semibold">Registered</th>
                    <th className="py-2 pr-3 font-semibold">Last used</th>
                    <th className="py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((row) => (
                    <tr key={`${row.kind}-${row.id}`} className="border-b border-surface-border/50">
                      <td className="py-2 pr-3 text-gray-200">{row.label}</td>
                      <td className="py-2 pr-3">
                        <span className="chip text-gray-300 inline-flex items-center gap-1.5">
                          {row.kind === "passkey" ? <KeyRound size={11} /> : <Smartphone size={11} />}
                          {row.kind === "passkey" ? "Passkey" : "Notifications"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="block text-gray-300">{row.user?.name || "—"}</span>
                        <span className="block text-xs text-gray-500">{row.user?.email ?? ""}</span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-400">{when(row.createdAt)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-400">{row.lastUsedAt ? when(row.lastUsedAt) : <span className="text-gray-600">never</span>}</td>
                      <td className="py-2">
                        <button
                          onClick={() => removeDevice(row)}
                          disabled={busy === row.id}
                          className="p-1.5 rounded bg-gray-700 text-red-400 hover:text-red-300"
                          title="Remove this device"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
