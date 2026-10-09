/**
 * One purchase order, in full.
 *
 * The list is a queue of orders and says only what a row can hold. This is the record behind it: the
 * lines as they were ordered, the vendor's own details, who raised it and who approved it, the dates
 * that say whether it is late, and — the reason it exists — the actions that move it along. A buyer
 * clicks a row because they want to do something with it, so the detail is built around the two things
 * they do: say where the order has got to, and fix the lines if the wrong thing was ordered.
 *
 * Two designs, deliberately, because the two interfaces read differently:
 *
 * * **Modern** — a sheet whose top line is the identity (number, vendor, total) and whose status is a
 *   track you can step along, with the vendor, dates and notes beside the lines rather than under them.
 *   Status is pressed, not saved: the stepper writes immediately, the way a ticket's pills do.
 * * **Classic** — a form: labelled fields in a grid, a status select with a Save beside it, and the
 *   lines in a table underneath. Everything is staged and written once, which is what the classic
 *   screens do everywhere else.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Check, Loader2, Pencil, Plus, Trash2, Truck, X } from "lucide-react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { useRedesign } from "../hooks/useNavigationStyle";

export interface POLine {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
  productId?: string | null;
  sku?: string | null;
}

export interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  notes: string | null;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vendor: VendorRecord | null;
  lineItems: POLine[];
  createdBy: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  approvedBy: { firstName?: string | null; lastName?: string | null } | null;
}

export interface VendorRecord {
  id: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  taxId?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

/** The four states, in the order a buyer walks them. */
const STATUSES = ["draft", "ordered", "shipped", "received"] as const;
const STATUS_LABELS: Record<string, string> = { draft: "Draft", ordered: "Ordered", shipped: "Shipped", received: "Received" };
const STATUS_BADGES: Record<string, string> = {
  draft: "bg-gray-600/20 text-gray-400",
  ordered: "bg-blue-600/20 text-blue-400",
  shipped: "bg-amber-600/20 text-amber-400",
  received: "bg-green-600/20 text-green-400",
};

const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);

const day = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

/** For a date input: yyyy-mm-dd in local time, which is what the control expects. */
const dayInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const personName = (person?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null) => {
  if (!person) return "—";
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || person.email || "—";
};

export function PurchaseOrderDialog({
  orderId, onClose, onChanged,
}: {
  orderId: string;
  onClose: () => void;
  /** Called after anything was written, so the list behind the dialog can refresh. */
  onChanged: () => void;
}) {
  const redesign = useRedesign();
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [draftLines, setDraftLines] = useState<POLine[]>([]);
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [vendorOpen, setVendorOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/procurement/orders/${orderId}`);
      setOrder(data);
      setExpected(dayInput(data.expectedAt));
      setNotes(data.notes || "");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not load the purchase order"));
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = editingLines ? draftLines : order?.lineItems ?? [];
  const draftSubtotal = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0),
    [lines],
  );
  const shownSubtotal = editingLines ? draftSubtotal : order?.subtotal ?? 0;
  const shownTotal = Number((shownSubtotal + Number(order?.taxTotal ?? 0)).toFixed(2));

  const patch = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    try {
      await api.patch(`/procurement/orders/${orderId}`, body);
      await load();
      onChanged();
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not update the purchase order"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: string) => {
    if (!order || order.status === status) return;
    void patch({ status }, `Marked ${STATUS_LABELS[status]?.toLowerCase() || status}`);
  };

  const saveLines = async () => {
    const cleaned = draftLines
      .map((line) => ({ ...line, description: line.description.trim() }))
      .filter((line) => line.description);
    if (!cleaned.length) {
      toast.error("A purchase order needs at least one line");
      return;
    }
    if (await patch({ lineItems: cleaned }, "Order lines updated")) setEditingLines(false);
  };

  const saveDetails = () =>
    void patch({ expectedAt: expected || null, notes }, "Purchase order updated");

  const dirty = Boolean(order) && (expected !== dayInput(order!.expectedAt) || notes !== (order!.notes || ""));

  const startEditingLines = () => {
    setDraftLines((order?.lineItems ?? []).map((line) => ({ ...line })));
    setEditingLines(true);
  };
  const updateLine = (index: number, field: "description" | "quantity" | "unitPrice", value: string | number) =>
    setDraftLines((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const addLine = () => setDraftLines((rows) => [...rows, { description: "", quantity: 1, unitPrice: 0 }]);
  const removeLine = (index: number) => setDraftLines((rows) => rows.filter((_, i) => i !== index));

  const canEditLines = order && order.status !== "received";
  const nextLabel = order?.status === "draft" ? "Mark ordered" : order?.status === "ordered" ? "Mark shipped" : order?.status === "shipped" ? "Mark received" : null;

  // ── Loading / missing ──
  if (loading || !order) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="card flex items-center gap-2 text-sm text-gray-400" onClick={(event) => event.stopPropagation()}>
          <Loader2 size={16} className="animate-spin" /> Loading purchase order…
        </div>
      </div>
    );
  }

  const vendorCard = (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white" title={order.vendor?.name}>{order.vendor?.name || "No vendor"}</p>
          {order.vendor?.contactName && <p className="truncate text-xs text-gray-400">{order.vendor.contactName}</p>}
        </div>
        <button
          onClick={() => setVendorOpen(true)}
          disabled={!order.vendor}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-surface-border px-2 py-1 text-xs text-gray-400 transition-colors hover:text-white disabled:opacity-40"
        >
          <Pencil size={12} /> Edit
        </button>
      </div>
      <dl className="space-y-1 text-xs">
        {[
          ["Email", order.vendor?.email],
          ["Phone", order.vendor?.phone],
          ["Terms", order.vendor?.paymentTerms],
          ["Tax ID", order.vendor?.taxId],
          ["Address", order.vendor?.address],
        ].map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-16 shrink-0 text-gray-600">{label}</dt>
            <dd className="min-w-0 flex-1 truncate text-gray-300" title={value || undefined}>{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  const linesTable = (compact: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-gray-500">
            <th className="py-2 pr-2">Item</th>
            <th className="py-2 px-2 w-20 text-right">Qty</th>
            <th className="py-2 px-2 w-28 text-right">Unit</th>
            <th className="py-2 pl-2 w-28 text-right">Total</th>
            {editingLines && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id || index} className="border-b border-surface-border/40 last:border-0">
              <td className="py-2 pr-2">
                {editingLines ? (
                  <input
                    className="input-field py-1 text-sm"
                    value={line.description}
                    onChange={(event) => updateLine(index, "description", event.target.value)}
                    placeholder="What was ordered"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-gray-200" title={line.description}>{line.description}</span>
                    {line.sku && <span className="chip shrink-0 text-gray-400">{line.sku}</span>}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                {editingLines ? (
                  <input
                    type="number"
                    step="1"
                    className="input-field py-1 text-right text-sm"
                    value={line.quantity}
                    onChange={(event) => updateLine(index, "quantity", Number(event.target.value))}
                  />
                ) : line.quantity}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                {editingLines ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input-field py-1 text-right text-sm"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, "unitPrice", Number(event.target.value))}
                  />
                ) : money(line.unitPrice, order.currency)}
              </td>
              <td className="py-2 pl-2 text-right tabular-nums text-white">
                {money((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), order.currency)}
              </td>
              {editingLines && (
                <td className="py-2 pl-1 text-right">
                  <button onClick={() => removeLine(index)} className="text-gray-600 transition-colors hover:text-red-400" aria-label="Remove line">
                    <Trash2 size={13} />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!lines.length && (
            <tr><td colSpan={5} className={compact ? "py-3 text-center text-xs text-gray-500" : "py-4 text-center text-sm text-gray-500"}>No lines on this order</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-surface-border text-sm">
            <td className="py-2 text-gray-500" colSpan={editingLines ? 2 : 3}>Subtotal</td>
            <td className="py-2 pl-2 text-right tabular-nums text-gray-200" colSpan={editingLines ? 2 : 1}>{money(shownSubtotal, order.currency)}</td>
          </tr>
          {Number(order.taxTotal) > 0 && (
            <tr className="text-sm">
              <td className="py-1 text-gray-500" colSpan={editingLines ? 2 : 3}>Tax</td>
              <td className="py-1 pl-2 text-right tabular-nums text-gray-200" colSpan={editingLines ? 2 : 1}>{money(order.taxTotal, order.currency)}</td>
            </tr>
          )}
          <tr className="text-sm font-semibold">
            <td className="py-2 text-white" colSpan={editingLines ? 2 : 3}>Total</td>
            <td className="py-2 pl-2 text-right tabular-nums text-cyber-400" colSpan={editingLines ? 2 : 1}>{money(shownTotal, order.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const lineActions = canEditLines ? (
    editingLines ? (
      <div className="flex items-center gap-2">
        <button onClick={addLine} className="text-xs text-cyber-400 hover:text-cyber-300">+ Add line</button>
        <button onClick={() => setEditingLines(false)} className="text-xs text-gray-500 hover:text-white">Cancel</button>
        <button onClick={saveLines} disabled={busy} className="btn-primary text-xs">Save lines</button>
      </div>
    ) : (
      <button onClick={startEditingLines} className="text-xs text-gray-500 hover:text-white">Edit lines</button>
    )
  ) : null;

  // ── Modern: a sheet, with the status as a track and the vendor beside the lines ──
  if (redesign) {
    return (
      <>
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={onClose}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-dialog-title"
            className="w-full max-w-4xl overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start gap-3 border-b border-surface-border px-5 py-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-600/15 text-cyber-400">
                <Truck size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-white">{order.poNumber}</span>
                  <span className={`badge whitespace-nowrap ${STATUS_BADGES[order.status] || ""}`}>{STATUS_LABELS[order.status] || order.status}</span>
                </div>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {order.vendor?.name || "No vendor"} · raised {day(order.createdAt)}
                  {order.expectedAt ? ` · expected ${day(order.expectedAt)}` : ""}
                  {order.receivedAt ? ` · received ${day(order.receivedAt)}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-gray-500">Total</p>
                <p className="text-lg font-semibold tabular-nums text-white">{money(order.total, order.currency)}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {/* The status is a track: pressed, not saved, like a ticket's pills. */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-border px-5 py-3">
              {STATUSES.map((status, index) => {
                const reached = STATUSES.indexOf(order.status as (typeof STATUSES)[number]) >= index;
                const current = order.status === status;
                return (
                  <button
                    key={status}
                    onClick={() => setStatus(status)}
                    disabled={busy}
                    aria-current={current ? "step" : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      current
                        ? "border-cyber-500/60 bg-cyber-600/15 text-white"
                        : reached
                          ? "border-surface-border text-gray-300 hover:text-white"
                          : "border-surface-border/60 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {index < STATUSES.indexOf(order.status as (typeof STATUSES)[number]) && <Check size={11} />}
                    {STATUS_LABELS[status]}
                  </button>
                );
              })}
              <span className="ml-auto flex items-center gap-2">
                {lineActions}
              </span>
            </div>

            <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1.6fr_1fr]">
              <div className="min-w-0 space-y-2">
                <p className="text-xs uppercase tracking-wider text-gray-500">What was ordered</p>
                {linesTable(true)}
              </div>

              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Vendor</p>
                  {vendorCard}
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-gray-500">Dates</p>
                  <label className="block text-xs text-gray-500">
                    Expected
                    <input type="date" className="input-field mt-1 text-sm" value={expected} onChange={(event) => setExpected(event.target.value)} />
                  </label>
                  <dl className="space-y-1 text-xs">
                    {[
                      ["Ordered", day(order.orderedAt)],
                      ["Received", day(order.receivedAt)],
                      ["Raised by", personName(order.createdBy)],
                      ["Approved by", personName(order.approvedBy)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex gap-2">
                        <dt className="w-20 shrink-0 text-gray-600">{label}</dt>
                        <dd className="min-w-0 flex-1 truncate text-gray-300">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Notes</p>
                  <textarea
                    rows={3}
                    className="input-field resize-y text-sm"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Delivery instructions, a reference number, anything the next person needs."
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-surface-border bg-surface-light/40 px-5 py-4">
              <span className="truncate text-xs text-gray-500">
                {order.status === "received"
                  ? `Received${order.receivedAt ? ` ${day(order.receivedAt)}` : ""} — the lines are locked`
                  : canEditLines ? "The lines can still be changed" : ""}
              </span>
              <div className="flex items-center gap-2">
                {dirty && (
                  <button className="btn-secondary text-sm" onClick={saveDetails} disabled={busy}>Save changes</button>
                )}
                {nextLabel && (
                  <button
                    className="btn-primary flex items-center gap-1.5 text-sm"
                    onClick={() => setStatus(order.status === "draft" ? "ordered" : order.status === "ordered" ? "shipped" : "received")}
                    disabled={busy}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {nextLabel}
                  </button>
                )}
                <button className="btn-secondary text-sm" onClick={onClose}>Close</button>
              </div>
            </div>
          </div>
        </div>
        {vendorOpen && order.vendor && (
          <VendorDialog
            vendor={order.vendor}
            onClose={() => setVendorOpen(false)}
            onSaved={async () => { setVendorOpen(false); await load(); onChanged(); }}
          />
        )}
      </>
    );
  }

  // ── Classic: a form, staged and saved once ──
  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Purchase order"
          className="card max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Purchase order {order.poNumber}</h3>
              <p className="mt-1 text-sm text-gray-400">
                {order.vendor?.name || "No vendor"} · created {day(order.createdAt)}
              </p>
            </div>
            <span className={`badge whitespace-nowrap ${STATUS_BADGES[order.status] || ""}`}>{STATUS_LABELS[order.status] || order.status}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="po-status">Status</label>
              <select
                id="po-status"
                className="input-field"
                value={order.status}
                onChange={(event) => { if (event.target.value !== order.status) void patch({ status: event.target.value }, `Marked ${STATUS_LABELS[event.target.value]?.toLowerCase()}`); }}
                disabled={busy}
              >
                {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="po-expected">Expected date</label>
              <input id="po-expected" type="date" className="input-field" value={expected} onChange={(event) => setExpected(event.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Ordered", day(order.orderedAt)],
              ["Received", day(order.receivedAt)],
              ["Raised by", personName(order.createdBy)],
              ["Approved by", personName(order.approvedBy)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 border-b border-surface-border/50 py-1">
                <span className="text-gray-500">{label}</span>
                <span className="truncate text-gray-300" title={value}>{value}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-gray-500">Lines</p>
              {lineActions}
            </div>
            {linesTable(false)}
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1" htmlFor="po-notes">Notes</label>
            <textarea
              id="po-notes"
              rows={3}
              className="input-field"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Delivery instructions, a reference number, anything the next person needs."
            />
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Vendor</p>
            {vendorCard}
          </div>

          <div className="flex justify-end gap-2">
            <button className="btn-secondary text-sm" onClick={onClose}>Close</button>
            {dirty && <button className="btn-primary text-sm" onClick={saveDetails} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
          </div>
        </div>
      </div>
      {vendorOpen && order.vendor && (
        <VendorDialog
          vendor={order.vendor}
          onClose={() => setVendorOpen(false)}
          onSaved={async () => { setVendorOpen(false); await load(); onChanged(); }}
        />
      )}
    </>
  );
}

/**
 * A vendor's record: who to call, on what terms.
 *
 * These are the fields a purchase order gets wrong when they are wrong — the contact nobody answers,
 * the terms that decide when the invoice is due, the tax id that has to match the invoice — so they are
 * editable from the order they are printed on rather than only from a list nobody opens. Designed twice
 * for the same reason the order is: the modern sheet puts the labels above the fields, the classic form
 * puts them beside.
 */
export function VendorDialog({
  vendor, onClose, onSaved,
}: {
  vendor: VendorRecord;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const redesign = useRedesign();
  const [form, setForm] = useState({
    name: vendor.name || "",
    contactName: vendor.contactName || "",
    email: vendor.email || "",
    phone: vendor.phone || "",
    website: vendor.website || "",
    address: vendor.address || "",
    taxId: vendor.taxId || "",
    paymentTerms: vendor.paymentTerms || "",
    notes: vendor.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (field: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("A vendor needs a name");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/procurement/vendors/${vendor.id}`, form);
      toast.success("Vendor updated");
      await onSaved();
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not save the vendor"));
    } finally {
      setSaving(false);
    }
  };

  const fields: Array<[keyof typeof form, string, string]> = [
    ["contactName", "Contact", "Who we speak to"],
    ["email", "Email", "orders@vendor.example"],
    ["phone", "Phone", ""],
    ["paymentTerms", "Payment terms", "Net 30"],
    ["taxId", "Tax ID", ""],
    ["website", "Website", ""],
  ];

  if (redesign) {
    return (
      <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh]" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-dialog-title"
          className="w-full max-w-lg overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="vendor-dialog-title" className="text-sm font-semibold text-white">Edit vendor</h2>
              <p className="mt-0.5 text-xs text-gray-500">These details appear on every purchase order raised against them.</p>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 px-5 py-5">
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-gray-500">Name</span>
              <input className="input-field mt-1 text-sm" value={form.name} onChange={(event) => set("name", event.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(([field, label, placeholder]) => (
                <label key={field} className="block">
                  <span className="text-xs uppercase tracking-wider text-gray-500">{label}</span>
                  <input className="input-field mt-1 text-sm" value={form[field]} placeholder={placeholder} onChange={(event) => set(field, event.target.value)} />
                </label>
              ))}
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-gray-500">Address</span>
              <textarea rows={2} className="input-field mt-1 resize-y text-sm" value={form.address} onChange={(event) => set("address", event.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-gray-500">Notes</span>
              <textarea rows={2} className="input-field mt-1 resize-y text-sm" value={form.notes} onChange={(event) => set("notes", event.target.value)} />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-surface-border bg-surface-light/40 px-5 py-4">
            <button className="btn-secondary text-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save vendor
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit vendor"
        className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Edit vendor</h3>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Name</label>
          <input className="input-field" value={form.name} onChange={(event) => set("name", event.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([field, label, placeholder]) => (
            <div key={field}>
              <label className="text-xs text-gray-500 block mb-1">{label}</label>
              <input className="input-field" value={form[field]} placeholder={placeholder} onChange={(event) => set(field, event.target.value)} />
            </div>
          ))}
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Address</label>
          <textarea rows={2} className="input-field" value={form.address} onChange={(event) => set("address", event.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Notes</label>
          <textarea rows={2} className="input-field" value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary text-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary text-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save vendor"}</button>
        </div>
      </div>
    </div>
  );
}
