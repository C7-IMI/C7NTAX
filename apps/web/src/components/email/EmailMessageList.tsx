/**
 * The message list — every message this instance sends, each row answering the same three questions in
 * the same order: what fires it, who reads it, and whether anybody has changed it.
 *
 * **Two designs, not one with a class toggled.**
 *
 *  · **Modern** is the mockup's: a rail of groups and states you press on the left (with the count of
 *    what each would show), then each group as a card whose rows carry their trigger, their reader and
 *    their subject *as written*, with a coloured left edge for the state. "Which of these have we
 *    changed?" is answered by seeing the answer on the row.
 *  · **Classic** is a form's list: one sortable table with seven labelled columns — Message, Key,
 *    Group, Trigger, To, State, Attachments — where the same question is answered by *sorting on
 *    State*, and the group rail is a `<select>` because a classic screen chooses from a list rather
 *    than pressing a chip.
 *
 * The state, the API call and the words are shared; the arrangement is not. What is shared by *both*
 * and lives in `emailChrome.tsx` is the notice band, the state chip and the failed-read panel, because
 * those are facts about a message rather than a layout.
 */
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Mail, Paperclip } from "lucide-react";
import type { EmailMessageKey } from "@C7NTAX/shared";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { Band, LoadingBlock, MonoTm, StateChip, UnavailablePanel, plural } from "./emailChrome";
import {
  EMAIL_FACTS_BY_KEY,
  EMAIL_GROUPS,
  EDITING_CLASS_LABEL,
  groupFor,
  type EmailGroupId,
} from "./emailCatalogue";
import type { EmailMessageRow } from "./emailMessageRow";

export interface EmailListProps {
  rows: EmailMessageRow[];
  selectedKey: EmailMessageKey;
  /** Open the editor on this message. */
  onOpen: (key: EmailMessageKey) => void;
  loading: boolean;
  /** What could not be read, when the list itself did not arrive. */
  failure: string | null;
  onRetry: () => void;
  /** True when the rows were built from the code's facts rather than from the API's answer. */
  fromCode: boolean;
}

const STATE_TONE: Record<EmailMessageRow["state"], "neutral" | "on" | "warn"> = {
  default: "neutral",
  customised: "on",
  overridden: "warn",
};

/** The left edge that makes a changed row visibly a changed row. */
function stateEdge(row: EmailMessageRow): string {
  if (!row.live) return "border-l-2 border-l-alert-amber";
  if (row.state === "customised") return "border-l-2 border-l-cyber-500";
  if (row.state === "overridden") return "border-l-2 border-l-alert-amber";
  return "border-l-2 border-l-surface-border";
}

function StateBadge({ row }: { row: EmailMessageRow }) {
  if (!row.live) return <StateChip tone="warn">never sent</StateChip>;
  if (row.state === "overridden") {
    return <StateChip tone="warn">overridden{row.overrideCount ? ` for ${row.overrideCount}` : ""}</StateChip>;
  }
  return <StateChip tone={STATE_TONE[row.state]}>{row.state}</StateChip>;
}

function SubjectLine({ subject }: { subject: string | null }) {
  return (
    <p className="mt-1.5 text-[11.5px] text-gray-500">
      Subject as written:{" "}
      {subject ? (
        <code className="font-mono text-gray-400">{subject}</code>
      ) : (
        <span className="text-gray-600">no subject — nothing sends this key, so none has been written</span>
      )}
    </p>
  );
}

function FactLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-[11.5px] leading-relaxed text-gray-400">
      <span className="mr-2 inline-block w-[4.5rem] text-[10.5px] uppercase tracking-wide text-gray-600">{label}</span>
      {children}
    </p>
  );
}

// ── Modern ───────────────────────────────────────────────────────────────────────────────────────

function ModernList({ rows, selectedKey, onOpen, failure, onRetry, fromCode }: EmailListProps) {
  const [group, setGroup] = useState<EmailGroupId | "all">("all");
  const [stateView, setStateView] = useState<"all" | "changed" | "never">("all");

  const byState = useMemo(() => {
    const changed = rows.filter((row) => row.state !== "default").length;
    const never = rows.filter((row) => !row.live).length;
    return { changed, never };
  }, [rows]);

  const visible = rows.filter((row) => {
    if (group !== "all" && groupFor(row.group as EmailGroupId).id !== group) {
      // A row whose group the API named differently still belongs somewhere: fall back to the fact's group.
      const factGroup = EMAIL_FACTS_BY_KEY[row.key]?.group;
      if (factGroup !== group) return false;
    }
    if (stateView === "changed" && row.state === "default") return false;
    if (stateView === "never" && row.live) return false;
    return true;
  });

  const groupCount = (id: EmailGroupId) => rows.filter((row) => (EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) === id).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="card h-max space-y-4" aria-label="Message groups">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">Groups</p>
          <button
            type="button"
            onClick={() => setGroup("all")}
            aria-pressed={group === "all"}
            className={`mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-left ${group === "all" ? "bg-surface-lighter" : "hover:bg-surface-light"}`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-gray-200">All messages</span>
              <span className="font-mono text-[11px] text-gray-500">{rows.length}</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-gray-500">
              {rows.filter((row) => row.live).length} live · {plural(byState.never, "never sent", "never sent")}
            </span>
          </button>
          {EMAIL_GROUPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setGroup(entry.id)}
              aria-pressed={group === entry.id}
              className={`mt-1 w-full rounded-lg px-2.5 py-1.5 text-left ${group === entry.id ? "bg-surface-lighter" : "hover:bg-surface-light"}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-gray-200">{entry.label}</span>
                <span className="font-mono text-[11px] text-gray-500">{groupCount(entry.id)}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-500">{entry.say}</span>
            </button>
          ))}
        </div>

        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">State</p>
          <button
            type="button"
            onClick={() => setStateView("all")}
            aria-pressed={stateView === "all"}
            className={`mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-left ${stateView === "all" ? "bg-surface-lighter" : "hover:bg-surface-light"}`}
          >
            <span className="text-xs font-medium text-gray-200">Every state</span>
          </button>
          <button
            type="button"
            onClick={() => setStateView("changed")}
            aria-pressed={stateView === "changed"}
            className={`mt-1 w-full rounded-lg px-2.5 py-1.5 text-left ${stateView === "changed" ? "bg-surface-lighter" : "hover:bg-surface-light"}`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-gray-200">Changed from the code</span>
              <span className="font-mono text-[11px] text-gray-500">{byState.changed}</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-gray-500">Customised, or overridden for some clients</span>
          </button>
          <button
            type="button"
            onClick={() => setStateView("never")}
            aria-pressed={stateView === "never"}
            className={`mt-1 w-full rounded-lg px-2.5 py-1.5 text-left ${stateView === "never" ? "bg-surface-lighter" : "hover:bg-surface-light"}`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-gray-200">Never sent</span>
              <span className="font-mono text-[11px] text-gray-500">{byState.never}</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-gray-500">The sender is written; no caller exists</span>
          </button>
        </div>

        <p className="border-t border-surface-border pt-3 text-[11px] leading-relaxed text-gray-500">
          Every one of these is <strong className="font-medium text-gray-400">default</strong> until somebody edits
          it: the code&apos;s version is kept as the default forever, so <em>reset to default</em> always has
          somewhere to go.{fromCode ? " The states shown are the code's, because the live state could not be read." : ""}
        </p>
      </aside>

      <div className="space-y-3.5">
        {failure ? (
          <UnavailablePanel
            message={failure}
            onRetry={onRetry}
            what={
              <>
                The rows below are the facts the sender code itself carries, read from{" "}
                <MonoTm>packages/email/src/EmailService.ts</MonoTm> and its callers. Anything the API owns — the
                state of a template, who changed it, how many clients hold an override — is <strong>not</strong> read
                here, and is shown as <em>default</em> only because the code&apos;s version is the default.
              </>
            }
          />
        ) : null}

        {byState.never > 0 && stateView !== "changed" && (
          <Band
            tone="warn"
            icon={<AlertTriangle size={15} className="text-alert-amber" />}
            title={`${plural(byState.never, "message")} here ${byState.never === 1 ? "is" : "are"} never sent`}
          >
            <MonoTm>sendInvoice</MonoTm> renders a correct invoice email and attaches the PDF; nothing calls it, so
            an invoice marked <em>sent</em> is a status change rather than a message that left the building.{" "}
            <MonoTm>sendTicketAutoClose</MonoTm> is in the same position — closing a ticket actually rides on{" "}
            <MonoTm>ticket.activity</MonoTm>, so the closure wording that matters is that template&apos;s. Two further
            keys, <MonoTm>report.scheduled</MonoTm> and <MonoTm>quote.send</MonoTm>, have no sender at all; they are in
            the <em>Reserved</em> group and say so.
          </Band>
        )}

        {visible.length === 0 ? (
          <div className="card text-sm text-gray-400">No message matches that view.</div>
        ) : (
          EMAIL_GROUPS.filter((entry) => visible.some((row) => (EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) === entry.id)).map((entry) => {
            const inGroup = visible.filter((row) => (EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) === entry.id);
            return (
              <section key={entry.id} className="card">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Mail size={16} className="text-cyber-400" />
                  <h3 className="text-sm font-semibold text-white">{entry.label}</h3>
                  <p className="min-w-0 flex-1 text-[11.5px] text-gray-500">{entry.say}</p>
                  <span className="font-mono text-[11px] text-gray-500">{plural(inGroup.length, "message")}</span>
                </div>
                <div className="mt-2 divide-y divide-surface-border/60">
                  {inGroup.map((row) => {
                    const fact = EMAIL_FACTS_BY_KEY[row.key];
                    const selected = row.key === selectedKey;
                    return (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => onOpen(row.key)}
                        aria-current={selected}
                        className={`w-full rounded-lg px-2.5 py-2.5 text-left transition-colors ${stateEdge(row)} ${
                          selected ? "bg-surface-lighter" : "hover:bg-surface-light"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs font-semibold text-white">{row.name}</span>
                          <MonoTm>{row.key}</MonoTm>
                          <span className="ml-auto flex flex-wrap items-center gap-1.5">
                            <StateChip tone={row.audience === "internal" ? "neutral" : "good"}>{row.audience}</StateChip>
                            <StateBadge row={row} />
                            {row.editingClass !== "full" ? (
                              <StateChip tone={row.editingClass === "security" ? "warn" : "neutral"}>
                                {row.editingClass === "security" ? "body locked" : row.editingClass === "internal" ? "no brand kit" : "proposed"}
                              </StateChip>
                            ) : null}
                            {fact?.attachments ? (
                              <StateChip tone="neutral" icon={<Paperclip size={10} />}>attachments</StateChip>
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          <FactLine label="Fires when">{fact?.trigger ?? "not stated"}</FactLine>
                          <FactLine label="Reader">{fact?.reader ?? "not stated"}</FactLine>
                          {fact?.body ? <FactLine label="The words">{fact.body}</FactLine> : null}
                          {fact?.attachments ? <FactLine label="Carries">{fact.attachments}</FactLine> : null}
                        </div>
                        <SubjectLine subject={row.subject} />
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}

        <div className="card">
          <h3 className="text-sm font-semibold text-white">What the states mean, and which of these have we changed?</h3>
          <dl className="mt-2 space-y-1.5 text-[11.5px] text-gray-400">
            <div className="flex flex-wrap items-baseline gap-2">
              <dt><StateChip tone="neutral">default</StateChip></dt>
              <dd className="min-w-0 flex-1">
                Never edited. The body is exactly what <MonoTm>EmailService.ts</MonoTm> returns today — including the
                colours written into the markup.
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt><StateChip tone="on">customised</StateChip></dt>
              <dd className="min-w-0 flex-1">
                Edited at the instance. The code&apos;s version stays as the default, and <em>reset to default</em> always
                has something to return to.
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt><StateChip tone="warn">overridden</StateChip></dt>
              <dd className="min-w-0 flex-1">Some clients get different words — a count on the chip, and the list of them in the editor&apos;s Overrides panel.</dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt><StateChip tone="warn">never sent</StateChip></dt>
              <dd className="min-w-0 flex-1">
                A sender with no caller. Listed and openable, and labelled so nobody mistakes a well-formed preview for a
                delivered message.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

// ── Classic ──────────────────────────────────────────────────────────────────────────────────────

type SortKey = "name" | "key" | "group" | "state" | "audience";

function ClassicList({ rows, selectedKey, onOpen, failure, onRetry, fromCode }: EmailListProps) {
  const [sort, setSort] = useState<SortKey>("group");
  const [ascending, setAscending] = useState(true);
  const [group, setGroup] = useState<"all" | EmailGroupId>("all");

  const sorted = useMemo(() => {
    const filtered = group === "all" ? rows : rows.filter((row) => (EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) === group);
    const value = (row: EmailMessageRow) => {
      switch (sort) {
        case "key": return row.key;
        case "group": return groupFor((EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) as EmailGroupId).label;
        case "state": return row.live ? row.state : "never sent";
        case "audience": return row.audience;
        default: return row.name;
      }
    };
    return [...filtered].sort((a, b) => value(a).localeCompare(value(b)) * (ascending ? 1 : -1));
  }, [rows, sort, ascending, group]);

  const header = (key: SortKey, label: string) => (
    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">
      <button
        type="button"
        onClick={() => {
          if (sort === key) setAscending((current) => !current);
          else {
            setSort(key);
            setAscending(true);
          }
        }}
        className="inline-flex items-center gap-1 hover:text-white"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort === key ? <span aria-hidden="true">{ascending ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      {failure ? (
        <UnavailablePanel
          message={failure}
          onRetry={onRetry}
          what={
            <>
              The table below is built from the facts the sender code carries. Sort on <strong>State</strong> to answer
              &ldquo;which of these have we changed?&rdquo; — the state of anything the API owns is not read here.
            </>
          }
        />
      ) : null}

      <form className="card" onSubmit={(event) => event.preventDefault()}>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-gray-400">
            Group
            <select
              className="input-field mt-1 w-56"
              value={group}
              onChange={(event) => setGroup(event.target.value as "all" | EmailGroupId)}
            >
              <option value="all">All messages ({rows.length})</option>
              {EMAIL_GROUPS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} ({rows.filter((row) => (EMAIL_FACTS_BY_KEY[row.key]?.group ?? row.group) === entry.id).length})
                </option>
              ))}
            </select>
          </label>
          <p className="min-w-0 flex-1 text-[11.5px] text-gray-500">
            {plural(sorted.length, "message")} · {plural(rows.filter((row) => !row.live).length, "message")} written and
            never called · {plural(rows.filter((row) => row.state !== "default").length, "message")} changed from the code
            {fromCode ? " (the code's own state — the live state could not be read)" : ""}
          </p>
        </div>
      </form>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-surface-border">
              {header("name", "Message")}
              {header("key", "Key")}
              {header("group", "Group")}
              <th scope="col" className="px-3 py-2 text-left font-medium">Trigger</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">To</th>
              {header("state", "State")}
              {header("audience", "Reader")}
              <th scope="col" className="px-3 py-2 text-left font-medium">Attachments</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Subject as written</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const fact = EMAIL_FACTS_BY_KEY[row.key];
              const selected = row.key === selectedKey;
              return (
                <tr
                  key={row.key}
                  className={`border-b border-surface-border/60 align-top ${selected ? "bg-surface-lighter" : ""}`}
                >
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onOpen(row.key)} className="text-left font-medium text-white hover:text-cyber-300">
                      {row.name}
                    </button>
                    <span className="mt-0.5 block text-[10.5px] text-gray-500">{EDITING_CLASS_LABEL[row.editingClass]}</span>
                  </td>
                  <td className="px-3 py-2"><MonoTm>{row.key}</MonoTm></td>
                  <td className="px-3 py-2 text-gray-400">{groupFor((fact?.group ?? row.group) as EmailGroupId).label}</td>
                  <td className="max-w-[22rem] px-3 py-2 text-gray-400">{fact?.trigger ?? "not stated"}</td>
                  <td className="max-w-[18rem] px-3 py-2 text-gray-400">{fact?.reader ?? "not stated"}</td>
                  <td className="whitespace-nowrap px-3 py-2"><StateBadge row={row} /></td>
                  <td className="px-3 py-2 text-gray-400">{row.audience}</td>
                  <td className="px-3 py-2 text-gray-400">{fact?.attachments ?? "none"}</td>
                  <td className="max-w-[20rem] px-3 py-2">
                    {row.subject ? (
                      <code className="font-mono text-[11px] text-gray-400">{row.subject}</code>
                    ) : (
                      <span className="text-gray-600">none written</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 ? <p className="p-4 text-sm text-gray-400">No message matches that group.</p> : null}
      </div>
    </div>
  );
}

export function EmailMessageList(props: EmailListProps) {
  const redesign = useRedesign();
  if (props.loading) return <LoadingBlock label="the message list" />;
  return redesign ? <ModernList {...props} /> : <ClassicList {...props} />;
}
