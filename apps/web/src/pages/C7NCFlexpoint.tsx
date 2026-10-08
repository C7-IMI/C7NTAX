/**
 * C7NC → FlexPoint.
 *
 * FlexPoint is the billing and accounts-receivable system a good many MSPs already run — it holds
 * the invoices that have actually been issued to a client, and whether they have been paid. This
 * page is where the connection is configured and where what it brought back is put to work:
 *
 *   · the options, each of which changes something the service does (see services/flexpoint.ts);
 *   · the clients table, where a FlexPoint customer is tied to a C7NTAX client, which is what makes
 *     a client's receivable knowable at all;
 *   · the invoices list, where a local invoice can be created in FlexPoint through the merchant API,
 *     and where the payment FlexPoint records against it comes back as a payment here.
 *
 * Everything that writes is off until it is switched on, and each switch says what it will do.
 * The connection itself — the merchant API secret and the base URL — lives in CloudConnect, because
 * that is where every connector's credentials live; the page links there rather than repeating it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import {
  AlertTriangle, CheckCircle2, CreditCard, Link2, Loader2, RefreshCw, Send, Unlink, Wallet, XCircle,
} from "lucide-react";
import { PageSkeleton } from "../components/ui/Skeleton";
import { DataSourceNote } from "../components/DataSourceNote";

interface FlexpointOptions {
  syncCustomers: boolean;
  syncInvoices: boolean;
  syncDeposits: boolean;
  pageSize: number;
  matchRule: "externalUri" | "externalUriOrName" | "name";
  createMissingClients: boolean;
  writeBackExternalUri: boolean;
  recordSettledPayments: boolean;
  pushInvoices: boolean;
  pushStatus: "Draft" | "Posted" | "Paid" | "Processing" | "Void";
}

interface OptionMeta { key: keyof FlexpointOptions; label: string; hint: string; group: string }

interface ClientRow {
  companyId: string;
  companyName: string;
  customerId: string;
  customerName: string;
  externalUri: string | null;
  openBalance: number;
  overdueAmount: number;
  overdueCount: number;
  invoiceCount: number;
  paidTotal: number;
}

interface Overview {
  connection: {
    configured: boolean; id: string | null; name: string | null; enabled: boolean; status: string;
    errorMessage: string | null; lastSyncAt: string | null; baseUrl: string; hasSecret: boolean;
  };
  options: FlexpointOptions;
  optionMeta: OptionMeta[];
  counts: { customers: number; invoices: number; deposits: number; linkedClients: number; unlinkedCustomers: number };
  totals: { openBalance: number; overdue: number; paid: number; deposits: number; lastPaymentAt: string | null };
  clients: ClientRow[];
  unlinked: Array<{ customerId: string; name: string; email: string | null; city: string | null }>;
  lastSync: { status: string; startedAt: string; recordsProcessed: number; recordsFailed: number; errorMessage: string | null } | null;
}

interface LocalInvoice {
  id: string; invoiceNumber: string; status: string; total: number; companyId: string; companyName: string;
  lineItems: number; flexpointInvoiceId: string | null; flexpointPushedAt: string | null; flexpointPaid: number;
}

interface ClientOption { id: string; name: string }

const MATCH_RULES: Array<{ value: FlexpointOptions["matchRule"]; label: string }> = [
  { value: "externalUriOrName", label: "External reference, then a unique name" },
  { value: "externalUri", label: "External reference only" },
  { value: "name", label: "Name only" },
];

const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function when(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString();
}

export function C7NCFlexpointPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [draft, setDraft] = useState<FlexpointOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosenClient, setChosenClient] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [overviewRes, invoiceRes, clientRes] = await Promise.all([
        api.get("/flexpoint"),
        api.get("/flexpoint/invoices", { params: { limit: 15 } }),
        api.get("/clients", { params: { limit: 200 } }),
      ]);
      const data: Overview = overviewRes.data;
      setOverview(data);
      setDraft(previous => previous ?? data.options);
      setInvoices(invoiceRes.data?.data || []);
      setPushEnabled(Boolean(invoiceRes.data?.pushEnabled));
      setClients((clientRes.data?.data || []).map((c: ClientOption) => ({ id: c.id, name: c.name })));
    } catch { toast.error("Could not load the FlexPoint page"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => Boolean(draft && overview && JSON.stringify(draft) !== JSON.stringify(overview.options)),
    [draft, overview],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, OptionMeta[]>();
    for (const meta of overview?.optionMeta || []) {
      groups.set(meta.group, [...(groups.get(meta.group) || []), meta]);
    }
    return [...groups.entries()];
  }, [overview]);

  const setOption = <K extends keyof FlexpointOptions>(key: K, value: FlexpointOptions[K]) =>
    setDraft(current => (current ? { ...current, [key]: value } : current));

  const saveOptions = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await api.put("/flexpoint/options", { options: draft });
      toast.success("Options saved");
      await load();
    } catch (e: any) {
      toast.error(String(e?.response?.data?.error?.message || e?.response?.data?.error || "Could not save"));
    } finally { setBusy(null); }
  };

  const syncNow = async () => {
    setBusy("sync");
    try {
      const { data } = await api.post("/flexpoint/sync");
      const parts = [
        `${data.recordsProcessed} records`,
        `${data.linked.byExternalUri + data.linked.byName + data.linked.created} clients linked`,
      ];
      if (data.linked.created) parts.push(`${data.linked.created} clients created`);
      if (data.paymentsRecorded) parts.push(`${data.paymentsRecorded} payments recorded`);
      if (data.errors?.length) toast.error(data.errors[0]);
      else toast.success(`Synced ${parts.join(" · ")}`);
      await load();
    } catch (e: any) {
      toast.error(String(e?.response?.data?.error?.message || e?.response?.data?.error || "Sync failed"));
    } finally { setBusy(null); }
  };

  const link = async (companyId: string, customerId: string | null) => {
    setBusy(`link:${companyId}`);
    try {
      const { data } = await api.post("/flexpoint/link", { companyId, customerId });
      toast.success(customerId ? (data.wroteExternalUri ? "Linked, and the client id written back to FlexPoint" : "Linked") : "Link cleared");
      await load();
    } catch (e: any) {
      toast.error(String(e?.response?.data?.error?.message || e?.response?.data?.error || "Could not change the link"));
    } finally { setBusy(null); }
  };

  const push = async (invoiceId: string) => {
    setBusy(`push:${invoiceId}`);
    try {
      const { data } = await api.post(`/flexpoint/invoices/${invoiceId}/push`);
      if (data.pushed) toast.success(data.created ? `Created in FlexPoint as #${data.flexpointInvoiceId}` : "Updated in FlexPoint");
      else toast.error(String(data.reason || "FlexPoint refused the invoice"));
      await load();
    } catch (e: any) {
      toast.error(String(e?.response?.data?.error?.message || e?.response?.data?.error || "Could not push"));
    } finally { setBusy(null); }
  };

  if (loading) return <PageSkeleton />;
  if (!overview) return <div className="card text-center py-8 text-gray-500">The FlexPoint page could not be loaded.</div>;

  const { connection, counts, totals, lastSync } = overview;

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <CreditCard size={18} className="text-cyber-400" /> FlexPoint Payment Solutions
            <DataSourceNote source="flexpoint" tone="inline" />
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Billing and accounts receivable from FlexPoint's merchant API — who owes what, and whether it has been paid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/cloudconnect" className="btn-secondary text-sm">Connection settings</Link>
          <button onClick={syncNow} disabled={busy === "sync" || !connection.configured} className="btn-primary text-sm flex items-center gap-2">
            {busy === "sync" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync now
          </button>
        </div>
      </div>

      {/* The connection — where it is, how it is doing, and what it has brought in */}
      {!connection.configured ? (
        <div className="card space-y-3 border-l-2 border-l-amber-500">
          <p className="text-sm text-white flex items-center gap-2"><AlertTriangle size={15} className="text-amber-400" /> No FlexPoint connection yet</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            Add one in <Link to="/cloudconnect" className="text-cyber-400 hover:text-cyber-300">CloudConnect</Link> — choose
            <span className="text-gray-300"> FlexPoint</span> in the connector list and paste the merchant API secret from
            FlexPoint's own <span className="text-gray-300">Settings → WebAPI</span>. It is the only credential: FlexPoint's API
            has no account or tenant id, because the secret is what identifies the merchant. Once the connection exists, its
            options appear here.
          </p>
        </div>
      ) : (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex items-center gap-1.5 text-xs rounded-md px-2 py-1 ${
                connection.status === "connected" ? "bg-emerald-600/10 text-emerald-300"
                : connection.status === "error" ? "bg-red-600/10 text-red-300" : "bg-surface-lighter text-gray-400"}`}>
                {connection.status === "connected" ? <CheckCircle2 size={12} /> : connection.status === "error" ? <XCircle size={12} /> : null}
                {connection.status}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{connection.name}</p>
                <p className="text-xs text-gray-500 truncate font-mono">{connection.baseUrl}</p>
              </div>
            </div>
            <div className="text-xs text-gray-500 text-right">
              <p>{connection.hasSecret ? "Merchant API secret is set" : "No merchant API secret"}</p>
              <p>Last sync {when(connection.lastSyncAt)}{lastSync ? ` · ${lastSync.recordsProcessed} records` : ""}</p>
            </div>
          </div>
          {connection.errorMessage && (
            <p className="text-xs text-red-300 bg-red-600/10 rounded-lg p-2.5 leading-relaxed">{connection.errorMessage}</p>
          )}
          {!connection.enabled && (
            <p className="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 leading-relaxed">
              This connection is switched <strong>off</strong> in CloudConnect. Syncing and pushing from this page still work; what an
              off connection does not do is take part in the automatic accounting push when a bill-through batch is approved.
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 border-t border-surface-border pt-3">
            {[
              { label: "Linked clients", value: String(counts.linkedClients), hint: `${counts.customers} FlexPoint customers pulled` },
              { label: "Open balance", value: money(totals.openBalance), hint: "Across linked clients" },
              { label: "Overdue", value: money(totals.overdue), hint: "Past its due date" },
              { label: "Received", value: money(totals.paid), hint: "Recorded by FlexPoint" },
              { label: "Deposits", value: money(totals.deposits), hint: "Settled to the bank" },
            ].map(tile => (
              <div key={tile.label}>
                <p className="text-[11px] uppercase tracking-wider text-gray-500">{tile.label}</p>
                <p className="text-sm text-white font-medium tabular-nums">{tile.value}</p>
                <p className="text-[11px] text-gray-600">{tile.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Options */}
      {connection.configured && draft && (
        <div className="card space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">What FlexPoint does here</h3>
              <p className="text-xs text-gray-500 mt-0.5">Every switch below changes what a sync does. Nothing that writes to FlexPoint or to the ledger is on unless it is switched on.</p>
            </div>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-[11px] text-amber-300">Unsaved changes</span>}
              <button onClick={() => setDraft(overview.options)} disabled={!dirty || busy === "save"} className="btn-secondary text-sm">Discard</button>
              <button onClick={saveOptions} disabled={!dirty || busy === "save"} className="btn-primary text-sm">
                {busy === "save" ? "Saving…" : "Save options"}
              </button>
            </div>
          </div>

          {grouped.map(([group, metas]) => (
            <div key={group} className="space-y-3 border-t border-surface-border pt-4 first:border-t-0 first:pt-0">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{group}</h4>
              {metas.map(meta => {
                const value = draft[meta.key];
                return (
                  <div key={meta.key} className="flex items-start gap-3">
                    <div className="w-[15rem] shrink-0 pt-0.5">
                      {typeof value === "boolean" ? (
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={value} onChange={e => setOption(meta.key, e.target.checked as never)} className="rounded" />
                          <span className="text-sm text-gray-300">{meta.label}</span>
                        </label>
                      ) : (
                        <label className="text-sm text-gray-300 block">{meta.label}</label>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      {meta.key === "matchRule" ? (
                        <select className="input-field !w-auto" value={String(value)}
                          onChange={e => setOption("matchRule", e.target.value as FlexpointOptions["matchRule"])}>
                          {MATCH_RULES.map(rule => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
                        </select>
                      ) : meta.key === "pushStatus" ? (
                        <select className="input-field !w-auto" value={String(value)}
                          onChange={e => setOption("pushStatus", e.target.value as FlexpointOptions["pushStatus"])}>
                          {["Draft", "Posted", "Paid", "Processing", "Void"].map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                      ) : meta.key === "pageSize" ? (
                        <input type="number" min={1} max={200} className="input-field !w-[8rem]" value={Number(value)}
                          onChange={e => setOption("pageSize", Number(e.target.value))} />
                      ) : null}
                      <p className={`text-[11px] text-gray-500 leading-relaxed ${typeof value === "boolean" ? "ml-6" : ""}`}>{meta.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Clients and their receivable */}
      {connection.configured && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Wallet size={15} className="text-cyber-400" /> Clients and what they owe</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                A client's receivable comes from the FlexPoint customer it is linked to. One customer per client — the
                receivable must be one account, not two.
              </p>
            </div>
          </div>

          {overview.clients.length === 0 ? (
            <p className="text-xs text-gray-500">
              No clients are linked yet. Run a sync, then link a FlexPoint customer below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="text-left font-medium py-1.5">Client</th>
                    <th className="text-left font-medium py-1.5">FlexPoint customer</th>
                    <th className="text-right font-medium py-1.5">Open</th>
                    <th className="text-right font-medium py-1.5">Overdue</th>
                    <th className="text-right font-medium py-1.5">Invoices</th>
                    <th className="text-right font-medium py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {overview.clients.map(client => (
                    <tr key={client.companyId} className="border-t border-surface-border">
                      <td className="py-2">
                        <Link to={`/clients/${client.companyId}`} className="text-white hover:text-cyber-400">{client.companyName}</Link>
                      </td>
                      <td className="py-2 text-gray-400">
                        {client.customerName}
                        <span className="text-gray-600"> · #{client.customerId}</span>
                        {client.externalUri && <span className="block text-[11px] text-gray-600">reference {client.externalUri.slice(0, 8)}…</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums text-white">{money(client.openBalance)}</td>
                      <td className={`py-2 text-right tabular-nums ${client.overdueAmount > 0 ? "text-red-300" : "text-gray-500"}`}>
                        {client.overdueAmount > 0 ? `${money(client.overdueAmount)} · ${client.overdueCount}` : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-400">{client.invoiceCount}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => link(client.companyId, null)} disabled={busy === `link:${client.companyId}`}
                          className="btn-secondary text-xs inline-flex items-center gap-1.5">
                          <Unlink size={12} /> Unlink
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {overview.unlinked.length > 0 && (
            <div className="space-y-2 border-t border-surface-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                FlexPoint customers not linked to a client ({overview.unlinked.length})
              </p>
              {overview.unlinked.map(customer => (
                <div key={customer.customerId} className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{customer.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      #{customer.customerId}{customer.email ? ` · ${customer.email}` : ""}{customer.city ? ` · ${customer.city}` : ""}
                    </p>
                  </div>
                  <select className="input-field !w-auto text-xs" value={chosenClient[customer.customerId] || ""}
                    onChange={e => setChosenClient(current => ({ ...current, [customer.customerId]: e.target.value }))}>
                    <option value="">Link to a client…</option>
                    {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  <button
                    onClick={() => link(chosenClient[customer.customerId]!, customer.customerId)}
                    disabled={!chosenClient[customer.customerId] || busy === `link:${chosenClient[customer.customerId]}`}
                    className="btn-secondary text-xs inline-flex items-center gap-1.5">
                    <Link2 size={12} /> Link
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Local invoices, and their state in FlexPoint */}
      {connection.configured && (
        <div className="card space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Send size={15} className="text-cyber-400" /> Invoices and FlexPoint</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {pushEnabled
                  ? "Pushing is on: the most recent invoices can be created in FlexPoint. A pushed invoice keeps a link back, so the payment FlexPoint records against it is recorded here too."
                  : "Pushing is off, so nothing below is sent to FlexPoint. Switch on “Push invoices to FlexPoint” above to enable it."}
              </p>
            </div>
          </div>
          {invoices.length === 0 ? (
            <p className="text-xs text-gray-500">No invoices to show.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="text-left font-medium py-1.5">Invoice</th>
                    <th className="text-left font-medium py-1.5">Client</th>
                    <th className="text-right font-medium py-1.5">Total</th>
                    <th className="text-left font-medium py-1.5">FlexPoint</th>
                    <th className="text-right font-medium py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(invoice => (
                    <tr key={invoice.id} className="border-t border-surface-border">
                      <td className="py-2">
                        <span className="text-white">{invoice.invoiceNumber}</span>
                        <span className="text-gray-600"> · {invoice.status}</span>
                      </td>
                      <td className="py-2 text-gray-400 truncate">{invoice.companyName}</td>
                      <td className="py-2 text-right tabular-nums text-white">{money(invoice.total)}</td>
                      <td className="py-2 text-xs">
                        {invoice.flexpointInvoiceId ? (
                          <span className="text-emerald-300">
                            #{invoice.flexpointInvoiceId}
                            {invoice.flexpointPaid > 0 && <span className="text-gray-400"> · {money(invoice.flexpointPaid)} received</span>}
                          </span>
                        ) : <span className="text-gray-500">not pushed</span>}
                      </td>
                      <td className="py-2 text-right">
                        <button onClick={() => push(invoice.id)} disabled={!pushEnabled || busy === `push:${invoice.id}`}
                          title={pushEnabled ? (invoice.flexpointInvoiceId ? "Update it in FlexPoint" : "Create it in FlexPoint") : "Pushing is switched off"}
                          className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-40">
                          {busy === `push:${invoice.id}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          {invoice.flexpointInvoiceId ? "Update" : "Push"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-600 leading-relaxed">
        Deposits are payouts settled to the merchant's bank account; FlexPoint's API does not attach one to a customer, so they
        are shown as a merchant total rather than per client. FlexPoint publishes no webhooks, so nothing arrives on its own —
        a sync is what reads the current state.
      </p>
    </div>
  );
}
