/**
 * What FlexPoint knows about one client, on the client's own record.
 *
 * Read-only on purpose: the writing side of FlexPoint — linking customers to clients, pushing
 * invoices, switching the options on — lives in one place (C7NC → FlexPoint) so there is one
 * screen where a financial write can be triggered. This card answers the question the client
 * record raises: what does this client owe, and what have they paid.
 *
 * It renders nothing at all when the client has no FlexPoint customer, or when the API refuses
 * (a role without integration visibility) — an empty panel would suggest a problem that is not
 * there.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import { CreditCard, ExternalLink } from "lucide-react";

interface ClientAr {
  linked: boolean;
  customerId: string | null;
  customerName: string | null;
  openBalance: number;
  overdueAmount: number;
  overdueCount: number;
  paidTotal: number;
  invoices: Array<{ id: string; docNum: string | null; status: string; issued: string | null; due: string | null; amount: number; openBalance: number; received: number; paymentUrl: string | null; localInvoiceId: string | null; pushed: boolean }>;
  payments: Array<{ id: string; amount: number; processedAt: string; reference: string | null }>;
}

const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "—");

const STATUS_TONE: Record<string, string> = {
  Paid: "text-emerald-300",
  Posted: "text-cyber-300",
  Draft: "text-gray-400",
  Processing: "text-amber-300",
  Void: "text-gray-500",
};

export function FlexpointClientCard({ companyId }: { companyId: string }) {
  const [ar, setAr] = useState<ClientAr | null>(null);

  useEffect(() => {
    let live = true;
    api.get(`/flexpoint/clients/${companyId}`)
      .then(response => { if (live) setAr(response.data); })
      .catch(() => { if (live) setAr(null); });
    return () => { live = false; };
  }, [companyId]);

  if (!ar?.linked) return null;

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-cyber-600/10"><CreditCard size={16} className="text-cyber-400" /></div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              FlexPoint — accounts receivable
            </h3>
            <p className="text-xs text-gray-500 truncate">
              Customer {ar.customerName} · #{ar.customerId} · read from FlexPoint's merchant API
            </p>
          </div>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <span className="text-right">
            <span className="block text-[11px] uppercase tracking-wider text-gray-500">Open</span>
            <span className="text-white tabular-nums font-medium">{money(ar.openBalance)}</span>
          </span>
          <span className="text-right">
            <span className="block text-[11px] uppercase tracking-wider text-gray-500">Overdue</span>
            <span className={`tabular-nums font-medium ${ar.overdueAmount > 0 ? "text-red-300" : "text-gray-400"}`}>
              {ar.overdueAmount > 0 ? `${money(ar.overdueAmount)} · ${ar.overdueCount}` : "—"}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-[11px] uppercase tracking-wider text-gray-500">Received</span>
            <span className="text-white tabular-nums font-medium">{money(ar.paidTotal)}</span>
          </span>
          <Link to="/c7nc/flexpoint" className="text-cyber-400 hover:text-cyber-300 inline-flex items-center gap-1">
            Manage <ExternalLink size={11} />
          </Link>
        </div>
      </div>

      {ar.invoices.length === 0 ? (
        <p className="text-xs text-gray-500">FlexPoint has no invoices for this customer yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="text-left font-medium py-1.5">Document</th>
                <th className="text-left font-medium py-1.5">Issued</th>
                <th className="text-left font-medium py-1.5">Due</th>
                <th className="text-right font-medium py-1.5">Amount</th>
                <th className="text-right font-medium py-1.5">Open</th>
                <th className="text-left font-medium py-1.5">Status</th>
                <th className="text-left font-medium py-1.5">Here</th>
              </tr>
            </thead>
            <tbody>
              {ar.invoices.map(invoice => (
                <tr key={invoice.id} className="border-t border-surface-border">
                  <td className="py-2 text-white">{invoice.docNum || `#${invoice.id}`}</td>
                  <td className="py-2 text-gray-400 text-xs">{day(invoice.issued)}</td>
                  <td className="py-2 text-gray-400 text-xs">{day(invoice.due)}</td>
                  <td className="py-2 text-right tabular-nums text-white">{money(invoice.amount)}</td>
                  <td className="py-2 text-right tabular-nums text-gray-300">{money(invoice.openBalance)}</td>
                  <td className={`py-2 text-xs ${STATUS_TONE[invoice.status] || "text-gray-400"}`}>{invoice.status}</td>
                  <td className="py-2 text-xs text-gray-500">
                    {invoice.pushed ? `pushed from ${invoice.localInvoiceId}` : "not from here"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ar.payments.length > 0 && (
        <div className="border-t border-surface-border pt-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Payments recorded from FlexPoint</p>
          {ar.payments.map(payment => (
            <p key={payment.id} className="text-xs text-gray-400">
              {money(payment.amount)} on {new Date(payment.processedAt).toLocaleDateString()}
              {payment.reference && <span className="text-gray-600 font-mono"> · {payment.reference}</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
