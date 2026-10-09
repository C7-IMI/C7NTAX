/**
 * The delivery log in the **modern** interface: the last sends as rows you read down, with the reason
 * drawn where the failure is rather than behind a click.
 *
 * The arrangement is the redesign's own: a strip of figures, chips you press to narrow the list, rows
 * with the outcome chip beside the recipient and the reason inline under the row it belongs to, a Resend
 * with the sentence saying why it is not offered, and a countable footer. The classic arrangement of the
 * same screen — a table with an Action column and the reason in a dialog — is `EmailLogClassic.tsx`; the
 * read and the words are shared with it through `pages/EmailLog.tsx` and `logView.ts`.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Inbox, Info, Link2, Mail, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { ListFooter, PageHeader, StatCard } from "../ui";
import { Band, Fact, Mono, MonoTm, StateChip, UnavailablePanel } from "./emailChrome";
import { LOG_TODAY, OUTCOME_LABEL, REASON_LINES, formatWhen, reasonValue, type EmailLogProps } from "./logView";
import { BOUNCE_TODAY, NO_RESEND_ROUTE, OPT_OUT } from "./emailFacts";

export function EmailLogModern(props: EmailLogProps) {
  const { rows, counts, countsAreWholeLog, status, message, reload, retentionDays, canManage, resendBlockedBecause } = props;
  const [outcome, setOutcome] = useState<"all" | "delivered" | "failed">("all");

  const shown = useMemo(() => rows.filter((row) => outcome === "all" || row.outcome === outcome), [rows, outcome]);
  const chips: Array<{ id: typeof outcome; label: string; count: number }> = [
    { id: "all", label: "All messages", count: rows.length },
    { id: "delivered", label: "Delivered", count: rows.filter((row) => row.outcome === "delivered").length },
    { id: "failed", label: "Failed", count: rows.filter((row) => row.outcome === "failed").length },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email Delivery Log"
        icon={<Mail size={16} className="text-cyber-400" />}
        subtitle="What was sent, to whom, which template version, and what happened to it."
        actions={
          <>
            <Link to="/admin/email" className="chip"><Send size={12} /> The Studio</Link>
            <Link to="/admin/email/brand" className="chip"><Inbox size={12} /> Brand & sending</Link>
            <button type="button" className="chip" onClick={reload}><RefreshCw size={12} /> Re-read</button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Delivered" value={counts.sent} tone="green" foot={<span className="text-[11px] text-gray-500">{countsAreWholeLog ? "over the whole log" : "of the rows read"}</span>} />
        <StatCard label="Failed" value={counts.failed} tone="red" foot={<span className="text-[11px] text-gray-500">the error the relay gave, retained against the message</span>} />
        <StatCard label="Test sends" value={counts.test} tone="amber" foot={<span className="text-[11px] text-gray-500">marked on the row, so a test is never read as a client message</span>} />
        <StatCard label="Skipped by a rule" value={0} foot={<span className="text-[11px] text-gray-500">proposed: nothing suppresses an address yet, so the API has no such outcome</span>} />
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

      {status === "ok" && rows.length === 0 ? (
        <Band tone="info" icon={<Inbox size={14} className="text-cyber-300" />} title="The log answered and holds nothing">
          Nothing has been sent yet on this instance, so there is nothing to show — a real answer rather than a failed read.
        </Band>
      ) : null}

      <div className="card p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Last sends</h3>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={outcome === chip.id}
              onClick={() => setOutcome(chip.id)}
              className={`chip ${outcome === chip.id ? "chip--on" : ""}`}
            >
              {chip.label}
              <span className="chip__n">{chip.count}</span>
            </button>
          ))}
          <span className="ml-auto text-[11px] text-gray-500">newest first</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-500">
            {rows.length === 0 ? "No rows to show." : `No ${outcome} rows in what was read.`}
          </p>
        ) : (
          shown.map((row) => (
            <article key={row.id} className="border-b border-surface-border/60 px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold text-white">
                  {row.to.length === 0 ? "no recipient recorded" : row.to.join(", ")}
                </span>
                <MonoTm>{row.key}</MonoTm>
                <StateChip tone={row.outcome === "delivered" ? "good" : "bad"}>{OUTCOME_LABEL[row.outcome]}</StateChip>
                {row.test ? <StateChip tone="warn">test</StateChip> : null}
                <span className="ml-auto font-mono text-[11px] tabular-nums text-gray-500">{formatWhen(row.at)}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">
                {row.subject ?? row.key}
                {row.cc.length > 0 ? <> · <Mono>Cc</Mono> {row.cc.length}</> : null}
                {" · "}template <b className="text-gray-300">{row.templateKey ?? "—"}</b>
                {row.templateVersion === null
                  ? <span className="text-gray-500"> · no saved version, so the code's own wording was sent</span>
                  : <> <Mono>v{row.templateVersion}</Mono></>}
                {row.sentByName ? <> · sent by {row.sentByName}</> : null}
                {row.providerMessageId ? <> · provider <Mono>{row.providerMessageId}</Mono></> : null}
              </p>
              {row.outcome === "failed" ? (
                <div className="mt-2 rounded-lg border border-dashed border-surface-border bg-surface-light px-3 py-2">
                  {REASON_LINES.map((line) => (
                    <p key={line.id} className="text-[11.5px] leading-relaxed text-gray-400">
                      <span className="mr-2 inline-block w-24 align-top font-mono text-[10.5px] text-gray-500">{line.label}</span>
                      {reasonValue(row.reason, line.id) ?? <span className="text-gray-500">proposed — the log does not carry this line yet</span>}
                      {line.id === "evidence" && row.templateKey ? (
                        <>
                          {" "}
                          <Link to="/admin/email" className="text-cyber-400 hover:text-cyber-300">
                            Open the wording in the Studio
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary text-xs" disabled title={resendBlockedBecause}>
                  Resend
                </button>
                <span className="text-[11px] text-gray-500">
                  {canManage ? resendBlockedBecause : "Not offered: resending is email:manage, which this account does not hold."}
                </span>
              </div>
            </article>
          ))
        )}

        <ListFooter
          from={shown.length === 0 ? 0 : 1}
          to={shown.length}
          total={shown.length}
          page={1}
          pages={1}
          onPage={() => {}}
          note={`retention proposed at ${retentionDays} days, longer for anything that bounced`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">The four lines behind anything that did not go</h3>
          <p className="text-xs leading-relaxed text-gray-400">
            A relay code on its own is not an explanation, and "failed" on its own is not a fact a person can act on. Every
            non-delivery should carry the same four lines, in the same order, whether the cause is a suppression, a relay refusal
            or a missing sender.
          </p>
          {REASON_LINES.map((line) => (
            <Fact key={line.id} label={line.label}>
              {line.id === "what" ? "the mechanism, not the symptom — the relay's own words are what the API records today."
                : line.id === "why" ? <span className="text-gray-500">proposed: the cause in words rather than a status code. Nothing writes this line.</span>
                  : line.id === "whatToDo" ? <span className="text-gray-500">proposed: the next step, with what it costs. Nothing writes this line.</span>
                    : "the record the claim can be checked against — the provider's message id is what the log holds today."}
            </Fact>
          ))}
        </div>

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Resend — and the one thing it must not pretend</h3>
          <Band tone="warn" icon={<AlertTriangle size={14} className="text-alert-amber" />} title="No route serves a resend">{NO_RESEND_ROUTE}</Band>
          <Fact label="What it would do">re-render the message from its record and send it again, in the sender — so a resend from this screen and a retry are the same act.</Fact>
          <Fact label="What it would refuse">a suppressed address, and a row whose failure is that no sender is wired.</Fact>
          <Fact label="Template version">
            Stamped on the row at send. Today a message whose wording has never been edited records no version at all — the code's
            own wording was sent — and <Mono>PUT /api/email/templates/:key</Mono> is what starts producing them.
          </Fact>
        </div>
      </div>

      <Band tone="warn" icon={<AlertTriangle size={14} className="text-alert-amber" />} title="There was no delivery log until this one">
        {LOG_TODAY}
      </Band>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Band tone="warn" icon={<ShieldAlert size={14} className="text-alert-amber" />} title="Bounce handling, as proposed">{BOUNCE_TODAY}</Band>
        <Band tone="info" icon={<Link2 size={14} className="text-cyber-300" />} title="A skipped row would be a rule, not a failure">{OPT_OUT.appliedIn}</Band>
        <Band tone="good" icon={<CheckCircle2 size={14} className="text-alert-green" />} title="What makes this screen trustworthy">
          Without it, "we changed the template" has no evidence and "the client never got it" has no answer. The recipient rules,
          the quiet hours and the batch window all say what should happen; only this says what did.
        </Band>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-600">
        <Clock size={11} className="mr-1.5 inline" />
        Retention is proposed at {retentionDays} days, longer for anything that bounced, so the reason an address is suppressed
        outlives the message that caused it. No setting stores that figure yet.
        <Info size={11} className="ml-1.5 mr-1.5 inline" />
        The log holds what the sender did: <Mono>sent</Mono> or <Mono>failed</Mono>, the recipients, the subject, the template and
        its version, the provider's id and the sender's name.
      </p>
    </div>
  );
}
