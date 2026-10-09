/**
 * The delivery log in the **classic** interface: a table with an Action column, and the reason in a
 * dialog.
 *
 * The difference from the modern arrangement is deliberate, not a restyle: the modern log draws each send
 * as a row you read down with the reason inline and the chips as filters; this one is a table whose
 * columns are fixed — At, Message, To, Template, Outcome, Action — with a `<select>` for the outcome
 * filter, `Reason…` opening the four lines in a dialog, and Resend beside it with its refusal stated in
 * the row. The state, the read and the words are shared with the modern arrangement through
 * `pages/EmailLog.tsx` and `logView.ts`.
 */
import { useMemo, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { ListFooter, PageHeader, StatCard } from "../ui";
import { Fact, Mono, MonoTm, StateChip, UnavailablePanel } from "./emailChrome";
import { LOG_TODAY, OUTCOME_LABEL, REASON_LINES, formatWhen, reasonValue, type EmailLogProps, type LogRowView } from "./logView";
import { BOUNCE_TODAY, NO_RESEND_ROUTE, OPT_OUT } from "./emailFacts";

export function EmailLogClassic(props: EmailLogProps) {
  const { rows, counts, countsAreWholeLog, status, message, reload, retentionDays, canManage, resendBlockedBecause } = props;
  const [outcome, setOutcome] = useState<"all" | "delivered" | "failed">("all");
  const [page, setPage] = useState(1);
  const [reasonFor, setReasonFor] = useState<LogRowView | null>(null);
  const perPage = 25;

  const shown = useMemo(() => rows.filter((row) => outcome === "all" || row.outcome === outcome), [rows, outcome]);
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * perPage, current * perPage);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Delivery Log"
        subtitle="What was sent, to whom, which template version, and what happened to it."
        actions={
          <>
            <Link to="/admin/email" className="btn-secondary text-sm">Open the Studio</Link>
            <Link to="/admin/email/brand" className="btn-secondary text-sm">Brand & sending</Link>
            <button type="button" className="btn-secondary text-sm" onClick={reload}>
              <RefreshCw size={12} className="mr-1.5 inline" /> Re-read
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Delivered" value={counts.sent} tone="green" />
        <StatCard label="Failed" value={counts.failed} tone="red" />
        <StatCard label="Test sends" value={counts.test} tone="amber" />
        <StatCard label="Skipped by a rule" value={0} foot={<span className="text-[11px] text-gray-500">proposed: nothing suppresses an address yet</span>} />
      </div>

      {status === "unavailable" ? (
        <UnavailablePanel
          message={message ?? "The delivery log could not be read."}
          onRetry={reload}
          what={<>There is no fallback for this screen, on purpose: a delivery log is evidence, and a fabricated row is worse than an empty one. What exists instead of a log is described below.</>}
        />
      ) : null}

      {status === "loading" ? (
        <div className="card flex items-center gap-2 text-xs text-gray-500">
          <RefreshCw size={12} className="animate-spin" /> Reading the delivery log…
        </div>
      ) : null}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500" htmlFor="email-log-outcome">Outcome</label>
            <select
              id="email-log-outcome"
              className="input-field"
              value={outcome}
              onChange={(event) => { setOutcome(event.target.value as typeof outcome); setPage(1); }}
            >
              <option value="all">All messages</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <p className="text-xs text-gray-500">
            Newest first. {countsAreWholeLog ? "The figures above are over the whole log." : "The figures above are over the rows read."}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="ptable w-full text-xs">
            <caption className="sr-only">The delivery log, one row per send</caption>
            <thead>
              <tr>
                <th className="px-2 py-2 text-left">At</th>
                <th className="px-2 py-2 text-left">Message</th>
                <th className="px-2 py-2 text-left">To</th>
                <th className="px-2 py-2 text-left">Template</th>
                <th className="px-2 py-2 text-left">Outcome</th>
                <th className="px-2 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-3 text-center text-gray-500">
                    {status === "ok" && rows.length === 0
                      ? "Nothing has been sent yet on this instance — a real answer, not a failed read."
                      : rows.length === 0
                        ? "No rows could be read."
                        : `No ${outcome} rows in what was read.`}
                  </td>
                </tr>
              ) : (
                slice.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-2 align-top font-mono text-[11px] tabular-nums text-gray-400">{formatWhen(row.at)}</td>
                    <td className="px-2 py-2 align-top">
                      <span className="font-mono text-[11px] text-cyber-300">{row.key}</span>
                      {row.test ? <StateChip tone="warn">test</StateChip> : null}
                      <div className="mt-0.5 text-gray-500">{row.subject ?? "—"}</div>
                    </td>
                    <td className="px-2 py-2 align-top text-gray-300">
                      {row.to.length === 0 ? "no recipient recorded" : row.to.join(", ")}
                      {row.cc.length > 0 ? <span className="block text-gray-500">Cc {row.cc.join(", ")}</span> : null}
                    </td>
                    <td className="px-2 py-2 align-top text-gray-400">
                      {row.templateKey ?? "—"}
                      {row.templateVersion === null
                        ? <span className="block text-gray-500">no saved version</span>
                        : <span className="ml-1 font-mono text-[11px]">v{row.templateVersion}</span>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StateChip tone={row.outcome === "delivered" ? "good" : "bad"}>{OUTCOME_LABEL[row.outcome]}</StateChip>
                      {row.error ? <span className="mt-0.5 block text-[11px] text-alert-amber">{row.error}</span> : null}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" disabled title={resendBlockedBecause}>
                          Resend
                        </button>
                        <button
                          type="button"
                          className="btn-secondary !px-2.5 !py-1 text-xs"
                          onClick={() => setReasonFor(row)}
                          disabled={row.outcome !== "failed"}
                        >
                          Reason…
                        </button>
                        <span className="text-[10.5px] text-gray-500">
                          {!canManage ? "Resending is email:manage." : resendBlockedBecause}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <ListFooter
          from={shown.length === 0 ? 0 : (current - 1) * perPage + 1}
          to={Math.min(current * perPage, shown.length)}
          total={shown.length}
          page={current}
          pages={pages}
          onPage={setPage}
          note={`retention proposed at ${retentionDays} days, longer for anything that bounced`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">The four lines behind anything that did not go</h3>
          <table className="ptable w-full text-xs">
            <caption className="sr-only">The four lines every non-delivery carries</caption>
            <tbody>
              {REASON_LINES.map((line) => (
                <tr key={line.id}>
                  <td className="px-2 py-1.5 align-top text-gray-500">{line.label}</td>
                  <td className="px-2 py-1.5 align-top text-gray-300">
                    {line.proposed
                      ? <span className="text-gray-500">proposed — nothing writes this line yet</span>
                      : line.id === "what"
                        ? "the relay's own error, which is what the log records"
                        : "the provider's message id, which is what the log holds"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs leading-relaxed text-gray-400">
            Every non-delivery should carry the same four lines in the same order, which is why <b className="text-gray-300">Reason…</b>{" "}
            opens the same dialog for all of them — and why two of the four say plainly that nothing writes them.
          </p>
        </div>

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Resend, and the template version</h3>
          <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
            <b className="text-gray-200">No route serves a resend.</b> {NO_RESEND_ROUTE}
          </div>
          <Fact label="What it would do">re-render the message from its record and send it again, in the sender — so a resend from this screen and a retry are the same act.</Fact>
          <Fact label="What it would refuse">a suppressed address, and a row whose failure is that no sender is wired.</Fact>
          <Fact label="Template version">
            Stamped on the row at send. A message whose wording has never been edited records no version at all — the code's own
            wording was sent — and <Mono>PUT /api/email/templates/:key</Mono> is what starts producing them.
          </Fact>
        </div>
      </div>

      <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3.5 py-2.5 text-xs leading-relaxed text-gray-300">
        <b className="text-gray-200">There was no delivery log until this one.</b> {LOG_TODAY}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3.5 py-2.5 text-xs leading-relaxed text-gray-300">
          <b className="text-gray-200">Bounce handling, as proposed.</b> {BOUNCE_TODAY}
        </div>
        <div className="rounded-lg border border-surface-border bg-surface-light px-3.5 py-2.5 text-xs leading-relaxed text-gray-400">
          <Inbox size={13} className="mr-1.5 inline text-cyber-300" />
          <b className="text-gray-200">A skipped row would be a rule, not a failure.</b> {OPT_OUT.appliedIn}
        </div>
      </div>

      {reasonFor ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setReasonFor(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Why this message did not go"
            className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h2 className="text-sm font-semibold text-white">Why this message did not go</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                <MonoTm>{reasonFor.key}</MonoTm> to <span className="text-gray-300">{reasonFor.to.join(", ") || "no recipient recorded"}</span> at {formatWhen(reasonFor.at)}
              </p>
            </div>
            <div>
              {REASON_LINES.map((line) => (
                <Fact key={line.id} label={line.label}>
                  {reasonValue(reasonFor.reason, line.id) ?? <span className="text-gray-500">proposed — the log does not carry this line yet</span>}
                </Fact>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500">{resendBlockedBecause}</span>
              <button type="button" className="btn-secondary text-sm" onClick={() => setReasonFor(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
