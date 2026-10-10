import { Check } from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import type { PurgeModelCount, PurgeReceipt } from "./developerApi";
import { formatCount } from "./developerUi";

/**
 * The pieces of the purge screen that both arrangements read from: the five-step track, the model
 * tables, and the receipt. The *arrangement* differs between the interfaces; the state, the API calls
 * and the words do not, which is why they live here.
 */

export type TrackStepId = "snapshot" | "dry-run" | "confirm" | "purge" | "receipt";

const TRACK: Array<{ id: TrackStepId; title: string; say: string }> = [
  { id: "snapshot", title: "Snapshot", say: "Captured before anything is deleted, and the lock shown as set from this moment." },
  { id: "dry-run", title: "Dry run", say: "The same delegates counted rather than deleted, model by model, plus the two lists that are not on the delete path." },
  { id: "confirm", title: "Typed confirmation", say: "The phrase, and a reason written down beside it. Neither is optional and neither has a default." },
  { id: "purge", title: "Purge", say: "Children before parents, the order the wipe list already imposes. One transaction per model, so a failure names the model it stopped on." },
  { id: "receipt", title: "Receipt", say: "What was removed, what was kept, and where the record went." },
];

export type TrackState = "todo" | "current" | "done";

/**
 * The five-step track: the order `pnpm db:sample-off` already performs, moved onto the screen so the lock
 * — the thing that keeps the snapshot from being overwritten — is visible as the consequence of pressing
 * rather than as something that happened unannounced. Modern furniture, deliberately: the classic screen
 * is a form and has no track.
 */
export function PurgeStatusTrack({ state }: { state: (id: TrackStepId) => TrackState }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
      {TRACK.map((step, index) => {
        const at = state(step.id);
        const tone =
          at === "done"
            ? "border-alert-green/40 bg-alert-green/10 text-alert-green"
            : at === "current"
              ? "border-cyber-500/50 bg-cyber-600/15 text-cyber-300"
              : "border-surface-border bg-surface text-gray-500";
        return (
          <li key={step.id} className={`rounded-xl border p-3 ${tone}`}>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-semibold tabular-nums">
                {at === "done" ? <Check size={11} /> : index + 1}
              </span>
              <span className="text-xs font-semibold text-white">{step.title}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{step.say}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** A model table. `showWhy` is on for the removed list, where each row explains why it is on the list. */
export function ModelTable({
  rows,
  showWhy = false,
  empty,
  footer,
  accent = false,
}: {
  rows: PurgeModelCount[];
  showWhy?: boolean;
  empty: string;
  footer?: string;
  accent?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-surface-border bg-surface px-3 py-4 text-xs text-gray-500">{empty}</p>
    );
  }
  const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  return (
    <div className={`overflow-hidden rounded-xl border ${accent ? "border-alert-amber/40" : "border-surface-border"}`}>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-lighter text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 font-semibold">Model</th>
              <th className="px-3 py-2 text-right font-semibold">Rows</th>
              {showWhy ? <th className="px-3 py-2 font-semibold">Why it is in the list</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} className="border-t border-surface-border">
                <td className="px-3 py-1.5 font-mono text-gray-300">{row.model}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-white">{formatCount(row.count)}</td>
                {showWhy ? <td className="px-3 py-1.5 text-gray-500">{row.why || "—"}</td> : null}
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-surface-light">
            <tr className="border-t border-surface-border">
              <td className="px-3 py-2 font-semibold text-gray-300">{formatCount(rows.length)} models</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-white">{formatCount(total)}</td>
              {showWhy ? <td className="px-3 py-2 text-gray-500">{footer || ""}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * The receipt: what the instance looks like afterwards, and where the record was written.
 *
 * It is shown in both interfaces from the same response — the state and the words are shared — but the
 * modern one is a dashed card that reads like a result, and the classic one is a labelled grid under the
 * form, because that is what a classic screen does with a result. The API's own response is available
 * underneath as well: if the receipt ever carries a field this screen does not know, the raw record is
 * still on the page rather than quietly dropped.
 */
export function PurgeReceiptPanel({ receipt }: { receipt: PurgeReceipt }) {
  const modern = useModernInterface();
  const written =
    (typeof receipt.receiptPath === "string" && receipt.receiptPath) ||
    (typeof receipt.wrote === "string" && receipt.wrote) ||
    (typeof receipt.auditId === "string" && `auditLog ${receipt.auditId}`) ||
    null;

  const rows: Array<[string, string]> = [
    ["Operation", receipt.operation || "Disable sample data"],
    ["Actor", receipt.actor || "not reported"],
    ["IP", receipt.ip || "not reported"],
    ["Reason", receipt.reason || "not reported"],
    ["Dry run said", countsLine(receipt.dryRun)],
    ["Actually removed", countsLine(receipt.removed)],
    ["Preserved", countsLine(receipt.preserved)],
    ["Left alone", receipt.unlisted ? `${formatCount(receipt.unlisted.rows ?? 0)} rows · ${formatCount(receipt.unlisted.models ?? 0)} models` : "not reported"],
    ["Snapshot", receipt.snapshot || "not reported"],
    ["Flag", receipt.flag || "not reported"],
  ];

  if (modern) {
    return (
      <div className="rounded-xl border border-dashed border-alert-green/50 bg-surface-light p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-alert-green/15 text-alert-green">
            <Check size={13} />
          </span>
          <span className="text-sm font-semibold text-white">Receipt — what was removed, and where the record went</span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2 text-xs">
              <dt className="w-32 shrink-0 text-gray-500">{label}</dt>
              <dd className="min-w-0 text-gray-300">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-gray-400">
          {written ? (
            <>
              The record was written to <span className="font-mono text-gray-300">{written}</span>. The receipt is
              written outside the wiped set, because <span className="font-mono">auditLog</span> is itself removed by
              this operation.
            </>
          ) : (
            <>The API did not name where the record was written, so this screen cannot say.</>
          )}
        </p>
        <RawReceipt receipt={receipt} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-surface-border bg-surface-light p-4">
      <h3 className="text-sm font-semibold text-white">Receipt</h3>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2 text-sm">
            <dt className="w-36 shrink-0 text-gray-400">{label}</dt>
            <dd className="min-w-0 text-gray-300">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-gray-500">
        {written
          ? `The record was written to ${written}.`
          : "The API did not name where the record was written, so this screen cannot say."}
      </p>
      <RawReceipt receipt={receipt} />
    </div>
  );
}

function RawReceipt({ receipt }: { receipt: PurgeReceipt }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[11px] text-gray-600">The API's own receipt</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-3 font-mono text-[11px] text-gray-400">
        {JSON.stringify(receipt, null, 2)}
      </pre>
    </details>
  );
}

function countsLine(counts: { rows?: number; tables?: number } | null | undefined): string {
  if (!counts) return "not reported";
  const rows = typeof counts.rows === "number" ? formatCount(counts.rows) : "?";
  const tables = typeof counts.tables === "number" ? formatCount(counts.tables) : "?";
  return `${rows} rows · ${tables} tables`;
}
