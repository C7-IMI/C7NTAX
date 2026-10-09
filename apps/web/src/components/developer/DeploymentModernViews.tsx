/**
 * State two, three and four of the modern arrangement: a step in detail, the sanitisation step, and
 * the hand-off.
 *
 * The furniture is the modern interface's throughout, as the mockup draws it: pills you press, cards
 * rather than tables, a sentence beside the control that acts, and a countable footer that says how
 * much of this is left. The classic arrangement of the same three things is a form — see
 * `DeploymentClassic.tsx`, which shares this file's model, words and handlers and none of its layout.
 *
 * Two rules are enforced here rather than described:
 *
 *   · **a check that could not run is never drawn as a pass.** An item whose evidence is missing says
 *     so, an item whose state was *read from the repository* says that too — "we read `main.bicep`" and
 *     "a check ran" are different claims — and an item the wizard cannot run offers "Mark as could not
 *     verify", which records a remark and carries it into the hand-off; and
 *   · **the two removals never share a button.** Removing sample data is a link to the purge screen
 *     (it has its own screen at `/developer/purge` and this page does not duplicate it); removing a
 *     customer's real data is a locked, out-of-band operation that this screen records and refuses.
 *
 * Everything shown comes from the payload: an item's evidence is the API's `evidence`, its "skip it"
 * sentence is `ifSkipped`, and the panel the mockup calls "What this step actually decides" is the
 * API's `decides`.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  Info,
  Loader2,
  Lock,
  Printer,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  type DeploymentDecision,
  type DeploymentItem,
  type DeploymentStep,
  itemCounts,
  STATE_LABEL,
  stepReason,
  summarise,
  unattachedRecords,
} from "./deploymentContract";
import type { DeploymentViewProps } from "./deploymentView";
import { StateChip, StateCountChip, StateIcon, STEP_EDGE_CLASS } from "./DeploymentChrome";

/* ── State two: a step in detail ─────────────────────────────────────────────────────────────── */

/**
 * The two facts the API attaches to an item's state and the mockup does not draw: whether the state was
 * **read from the repository** rather than run, and whether the item holds the deployment back. Both are
 * shown, because a `done` item that was derived has never been executed and that is exactly the
 * distinction this screen exists to keep.
 */
function ItemFacts({ item }: { item: DeploymentItem }) {
  if (!item.derived && item.blocking) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {item.derived ? (
        <span className="chip text-gray-400" title="The state was decided by reading a file in this repository, not by running anything.">
          read from the repository, not run
        </span>
      ) : null}
      {!item.blocking ? <span className="chip text-gray-500">does not hold the deployment</span> : null}
    </div>
  );
}

function CheckItem({ item, onRemark }: { item: DeploymentItem; onRemark: () => void }) {
  return (
    <div className={`rounded-lg border border-surface-border bg-surface-light p-3.5 ${STEP_EDGE_CLASS[item.state]}`}>
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-white">
          {item.title ?? <span className="text-gray-500">item {item.id} — the API sent no title</span>}
        </p>
        <StateChip state={item.state} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-gray-400">
        <span className="text-gray-500">Checked against: </span>
        {item.evidence ?? "the API recorded no evidence for this item, so it is not a pass."}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
        <span className="text-amber-400/90">Skip it: </span>
        {item.ifSkipped ?? "the consequence of skipping it was not recorded."}
      </p>
      {item.record ? (
        <p className="mt-1.5 rounded-md border border-surface-border bg-surface px-2.5 py-2 text-xs leading-relaxed text-gray-300">
          <span className="text-gray-500">Recorded: </span>
          {item.record.note}
          {item.record.recordedBy ? <span className="text-gray-500"> — {item.record.recordedBy}</span> : null}
          {item.record.recordedAt ? (
            <span className="text-gray-500">, {new Date(item.record.recordedAt).toLocaleString()}</span>
          ) : null}
        </p>
      ) : null}
      <ItemFacts item={item} />
      {item.state === "unverified" ? (
        <div className="mt-2.5">
          <button type="button" onClick={onRemark} className="chip text-gray-400 hover:text-white">
            Mark as could not verify, with the reason
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StepDetailView({ props, step }: { props: DeploymentViewProps; step: DeploymentStep }) {
  const [remarkFor, setRemarkFor] = useState<DeploymentItem | null>(null);
  const [remark, setRemark] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);

  const counts = itemCounts(step);
  const outstanding = step.items.filter((item) => item.state !== "done");
  const reason = stepReason(step);

  const saveRemark = async () => {
    if (!remarkFor) return;
    setSavingRemark(true);
    const ok = await props.onRecordCheck(remarkFor.id, remark.trim());
    setSavingRemark(false);
    if (!ok) return;
    setRemarkFor(null);
    setRemark("");
  };

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="card">
          <p className="text-sm font-semibold text-white">
            Step {step.number} · {step.title ?? "untitled"}
            {step.items.length > 0
              ? ` — ${step.items.length} checks, each with its evidence and its cost of skipping`
              : ""}
          </p>
          {step.summary ? <p className="mt-1.5 text-xs leading-relaxed text-gray-400">{step.summary}</p> : null}

          {step.items.length > 0 ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">Checklist</span>
                {(["done", "attention", "blocked", "decision", "unverified"] as const)
                  .filter((state) => (counts[state] ?? 0) > 0)
                  .map((state) => (
                    <StateCountChip key={state} state={state} count={counts[state] ?? 0} />
                  ))}
              </div>
              <div className="mt-2.5 space-y-2.5">
                {step.items.map((item) => (
                  <CheckItem key={item.id} item={item} onRemark={() => setRemarkFor(item)} />
                ))}
              </div>
            </>
          ) : (
            <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-dashed border-surface-border bg-surface-light p-3.5">
              <Info size={14} className="mt-0.5 shrink-0 text-gray-500" />
              <p className="text-xs leading-relaxed text-gray-400">
                This step's checklist came back empty. Nothing is shown as having been checked, because nothing was:
                the items, their evidence and their "Skip it" sentences arrive with the deployment state.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="card">
            <p className="text-sm font-semibold text-white">What this step actually decides</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              {step.decides ?? "the API did not say what this step decides."}
            </p>
          </div>

          <div className="card">
            <p className="text-sm font-semibold text-white">Where this step comes from</p>            {step.plan ? (
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-words rounded-md border border-surface-border bg-surface-lighter px-2 py-1 text-[11px] text-cyber-300">
                  {step.plan}
                </code>
                <button
                  type="button"
                  className="chip px-1.5"
                  aria-label="Copy the plan reference"
                  onClick={() => {
                    void navigator.clipboard?.writeText(step.plan ?? "").then(
                      () => toast.success("Plan reference copied"),
                      () => toast.error("The browser refused the clipboard"),
                    );
                  }}
                >
                  <Copy size={12} />
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-gray-400">the API did not name a source for this step.</p>
            )}
            {reason ? (
              <p className="mt-2 border-t border-dashed border-surface-border pt-2 text-[11px] leading-relaxed text-gray-500">
                {reason.label ? <b className="font-semibold text-gray-400">{reason.label}: </b> : null}
                {reason.text}
              </p>
            ) : null}
          </div>

          <div className="card">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Terminal size={13} className="text-cyber-400/80" /> How it is run
            </p>
            {step.run.length > 0 ? (
              <pre className="mt-2 overflow-x-auto rounded-md border border-surface-border bg-surface-lighter p-2.5 text-[11px] leading-relaxed text-gray-300">
                {step.run.join("\n")}
              </pre>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                This step is not run from a shell — it is a decision and a reading, so the API reported no commands.
              </p>
            )}
          </div>

          <div className="card">
            <p className="text-sm font-semibold text-white">Still outstanding on this step</p>
            {outstanding.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">
                Nothing is outstanding: every item on this step is done, with its evidence.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {outstanding.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-xs text-gray-400">
                    <span className="mt-0.5 shrink-0">
                      <StateIcon state={item.state} />
                    </span>
                    <span className="min-w-0">
                      {item.title ?? item.id}
                      <span className="text-gray-500"> — {STATE_LABEL[item.state].toLowerCase()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2.5 border-t border-dashed border-surface-border pt-2.5 text-[11px] leading-relaxed text-gray-500">
              A check the wizard cannot run is recorded as unverified and carried into the hand-off, rather than
              being pressed into a pass.
            </p>
          </div>
        </div>
      </div>

      {remarkFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRemarkFor(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Record why a check could not be verified"
            className="card w-full max-w-lg space-y-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <p className="text-sm font-semibold text-white">Mark as could not verify</p>
              <p className="mt-1 text-xs text-gray-400">
                {remarkFor.title ?? remarkFor.id} · {remarkFor.id}
              </p>
            </div>
            <p className="text-xs leading-relaxed text-gray-400">
              This records the check as <span className="text-gray-300">could not verify</span> — not as passed — and
              carries the reason into the hand-off, where the operator sees it beside everything that was checked.
            </p>
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-400">Why it could not be checked, and who has it</span>
              <textarea
                className="input-field mt-1 w-full"
                rows={3}
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                placeholder="No Azure CLI is installed here, so the runner's flags are asserted from the CLI reference rather than tested…"
              />
            </label>
            {props.saveError ? <p className="text-xs text-red-400">{props.saveError}</p> : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setRemarkFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-1.5"
                disabled={savingRemark || remark.trim() === ""}
                onClick={() => void saveRemark()}
              >
                {savingRemark ? <Loader2 size={13} className="animate-spin" /> : null}
                Record it as unverified
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ── State three: sanitisation ───────────────────────────────────────────────────────────────── */

function SanitiseView({ props }: { props: DeploymentViewProps }) {
  const { model, canPurge } = props;
  const [typed, setTyped] = useState("");
  const step = model.steps.find((candidate) => candidate.id === "sanitisation");
  const databaseName =
    model.report.find((group) => group.id === "database")?.rows.find((row) => row.label === "name")?.value ?? "c7ntax";

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="text-sm font-semibold text-white">
          Strip the instance of what must not travel — and never confuse the two removals
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
          Removing <span className="text-gray-300">sample data</span> is a reversible act with a snapshot behind it,
          run by a script. Removing a <span className="text-gray-300">customer's real data</span> is an irreversible
          act that belongs to the operator, out of band, with the customer's authorisation and a backup taken first.
          The two never share a button, and this screen performs only the first.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card border-emerald-500/25">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold text-white">Remove sample and seed data</p>
            <span className="chip chip--good">reversible</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            The contract is the API's own (<code className="font-mono text-cyber-300">sample-data-toggle.ts</code>):
            snapshot first, then wipe the business models children-before-parents, then set the disabled flag — which
            locks the snapshot and stops automatic snapshot capture and auto-reseed. Identity and platform
            configuration are preserved, so the instance stays usable.
          </p>
          <pre className="mt-2.5 overflow-x-auto rounded-md border border-surface-border bg-surface-lighter p-2.5 text-[11px] leading-relaxed text-gray-300">
{`pnpm db:sample-off
[SampleData] Capturing snapshot before clearing...
[SampleData] Removing sample/business data...
[SampleData] Removed N business records (identity & platform config preserved).
[SampleData] Snapshot is locked — it will not be overwritten until
             sample data is re-enabled.
[SampleData] Automatic reseed after changes is paused.`}
          </pre>
          <p className="mt-2.5 text-xs text-gray-400">
            Reversible with <code className="font-mono text-cyber-300">pnpm db:sample-on</code>. The dry run with the
            real counts, the removed list beside the preserved list and the receipt live on their own screen.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link to="/developer/purge" className="btn-secondary">
              Preview what would be removed
            </Link>
            {canPurge ? (
              <Link to="/developer/purge" className="btn-primary">
                Disable sample data
              </Link>
            ) : (
              <span className="chip">
                <Lock size={11} /> Needs developer:purge
              </span>
            )}
          </div>
          {!canPurge ? (
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              The purge screen opens for anyone with <code className="font-mono">developer:view</code>, and its
              controls arm only for <code className="font-mono">developer:purge</code> — looking and destroying are
              separate decisions.
            </p>
          ) : null}
        </div>

        <div className="card border-red-500/30 bg-red-500/[0.04]">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold text-white">Remove a customer's real data</p>
            <span className="chip chip--bad">not done here</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-400">
            This is not a script in this wizard and not a button beside the one above. It is a destructive,
            irreversible act with a different owner, a different authority and a different recovery: written
            authorisation from the customer, a taken-and-restored backup, and an operator willing to sign for it.
            The wizard records the decision and refuses the act.
          </p>
          <label className="mt-3 block">
            <span className="text-[11px] font-semibold text-gray-400">
              To proceed out of band, type the database name to confirm
            </span>
            <input
              className="input-field mt-1 w-full disabled:opacity-60"
              type="text"
              value={typed}
              disabled
              onChange={(event) => setTyped(event.target.value)}
              placeholder={databaseName}
            />
          </label>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="chip">
              <Lock size={11} /> Locked
            </span>
            <span className="text-[11px] text-gray-500">owner: the operator</span>
          </div>
          <p className="mt-2.5 flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-red-400/80" />
            Recorded in the hand-off as the operator's decision, with the authority attached.
          </p>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-semibold text-white">
            What travels into production, and what this step reads from the destination
          </p>
          <span className="chip border-dashed text-gray-500">
            {step ? `${step.items.length} surfaces` : "not read"}
          </span>
        </div>
        {step && step.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-gray-500">
                <tr className="border-b border-surface-border">
                  <th className="px-3.5 py-2 font-semibold">Thing that must not travel</th>
                  <th className="px-3.5 py-2 font-semibold">What this step reads</th>
                  <th className="px-3.5 py-2 font-semibold">Skip it</th>
                  <th className="px-3.5 py-2 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {step.items.map((item) => (
                  <tr key={item.id} className="border-b border-surface-border/60 align-top last:border-0">
                    <td className="px-3.5 py-2.5 text-white">{item.title ?? item.id}</td>
                    <td className="px-3.5 py-2.5 text-gray-400">
                      {item.evidence ?? "the API recorded no evidence for this surface."}
                    </td>
                    <td className="px-3.5 py-2.5 text-gray-400">{item.ifSkipped ?? "not recorded"}</td>
                    <td className="px-3.5 py-2.5">
                      <StateChip state={item.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3.5 py-3 text-xs text-gray-400">
            The surfaces this step is responsible for were not read, so none is named here — the list arrives with
            the deployment state.
          </p>
        )}
      </div>

      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400/80" />
        Every row is reported as the destination answered, because this is the instance the screen is running in: the
        answers belong to the destination. The step's job is to name each surface and read it from the target — not
        to assume the instance it is running in is the one being promoted.
      </p>
    </div>
  );
}

/* ── State four: the hand-off ────────────────────────────────────────────────────────────────── */

function DecisionCard({
  decision,
  props,
  value,
  onChange,
}: {
  decision: DeploymentDecision;
  props: DeploymentViewProps;
  value: string;
  onChange: (value: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await props.onRecordDecision(decision.id, value.trim());
    setSaving(false);
  };

  const recorded = decision.record;

  return (
    <div className="rounded-lg border border-surface-border bg-surface-light p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-white">
          <code className="mr-1.5 font-mono text-[11px] text-cyber-300">{decision.id}</code>
          {decision.title ?? "untitled decision"}
        </p>
        {decision.blocking ? <span className="chip chip--bad">blocking</span> : null}
        {recorded ? <span className="chip chip--good">answered</span> : null}
      </div>
      {decision.recommendation ? (
        <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
          <span className="text-gray-500">Recommendation: </span>
          {decision.recommendation}
        </p>
      ) : null}
      {decision.detail ? (
        <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
          <span className="text-gray-500">Why: </span>
          {decision.detail}
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px] text-gray-500">
        Answered against <code className="font-mono">{decision.id}</code> — this decision's own id, which is what the
        endpoint accepts
        {decision.plan ? <> · {decision.plan}</> : null}
      </p>

      {recorded ? (
        <p className="mt-2.5 rounded-md border border-surface-border bg-surface px-2.5 py-2 text-xs text-white">
          {recorded.note}
          {recorded.recordedBy ? (
            <span className="text-gray-500">
              {" — "}
              {recorded.recordedBy}
              {recorded.recordedByRole ? ` (${recorded.recordedByRole})` : ""}
            </span>
          ) : null}
          {recorded.recordedAt ? (
            <span className="text-gray-500">, {new Date(recorded.recordedAt).toLocaleString()}</span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          className="input-field min-w-[220px] flex-1"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Record the answer, and who gave it…"
          aria-label={`Record the ${decision.id} decision`}
        />
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5"
          disabled={saving || value.trim() === ""}
          onClick={() => void save()}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}

function HandoffView({ props }: { props: DeploymentViewProps }) {
  const { model, counts } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /*
   * "Open" is the bar items that are still somebody's to act on — a decision or a named blockage. The
   * bar's own `unverified` entry (the four §3 checks a subscription alone can confirm) is counted
   * separately, by the figure the sentence already carries for it, so the same checks are not counted
   * twice. `ready` still requires every one of them to be done.
   */
  const openBar = model.bar.filter((item) => item.state !== "done" && item.state !== "unverified");
  const unverifiedBar = model.bar.filter((item) => item.state === "unverified");
  const owed = model.decisions.filter((decision) => !decision.record);
  const unattached = unattachedRecords(model);
  const ready =
    openBar.length === 0 &&
    unverifiedBar.length === 0 &&
    owed.length === 0 &&
    counts.blocked === 0 &&
    counts.unverified === 0 &&
    counts.decision === 0;

  return (
    <div className="space-y-4">
      <div className={`card ${ready ? "border-emerald-500/30" : "border-red-500/30"}`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{ready ? "Ready to promote" : "Not ready to promote"}</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              {ready
                ? "Nothing is open on the bar, no decision is unanswered and nothing could not be verified."
                : `${openBar.length} item${openBar.length === 1 ? "" : "s"} open on the bar, ${counts.decision} decision${counts.decision === 1 ? "" : "s"} owed, ${counts.unverified} check${counts.unverified === 1 ? "" : "s"} the wizard could not run. The end state is a report you can attach, not a green tick.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={props.onPrint}>
              <Printer size={13} /> Print
            </button>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={props.onExport}>
              <Download size={13} /> Export report
            </button>
          </div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-surface-border px-3.5 py-2.5">
          <p className="text-sm font-semibold text-white">What was checked</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500">
              <tr className="border-b border-surface-border">
                <th className="px-3.5 py-2 font-semibold">Step</th>
                <th className="px-3.5 py-2 font-semibold">Result</th>
                <th className="px-3.5 py-2 font-semibold">What it rests on</th>
              </tr>
            </thead>
            <tbody>
              {model.steps.map((step) => {
                const reason = stepReason(step);
                return (
                  <tr key={step.id} className="border-b border-surface-border/60 align-top last:border-0">
                    <td className="px-3.5 py-2.5 text-white">
                      {step.number} · {step.title ?? "untitled"}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StateChip state={step.state} />
                    </td>
                    <td className="px-3.5 py-2.5 text-gray-400">
                      {reason ? (
                        <>
                          {reason.label ? <span className="text-gray-500">{reason.label}: </span> : null}
                          {reason.text}
                        </>
                      ) : (
                        "Nothing was recorded for this step."
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <p className="text-sm font-semibold text-white">What remains the operator's decision</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          None of these is a task. Each has a place to record the answer, because a checkbox that pretends a decision
          is done is worse than a blank.
        </p>
        {props.saveError ? <p className="mt-2 text-xs text-red-400">{props.saveError}</p> : null}
        <div className="mt-3 space-y-2.5">
          {model.decisions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-surface-border bg-surface-light p-3.5 text-xs text-gray-400">
              The decisions the operator owes were not read. Nothing is shown as answered, and nothing is shown as
              there being no decision to take.
            </p>
          ) : (
            model.decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                props={props}
                value={drafts[decision.id] ?? ""}
                onChange={(value) => setDrafts((current) => ({ ...current, [decision.id]: value }))}
              />
            ))
          )}
        </div>
      </div>

      {unattached.length > 0 ? (
        <div className="card border-amber-500/40 bg-amber-500/[0.06]">
          <p className="text-sm font-semibold text-white">
            Recorded answers the report no longer names a subject for
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            These were written down against a subject the deployment no longer reports. They are shown rather than
            dropped, because a check that lost its id is when somebody most needs to read what was decided about it.
          </p>
          <ul className="mt-2.5 space-y-2">
            {unattached.map((record) => (
              <li key={`${record.kind}:${record.id}`} className="text-xs text-gray-400">
                <code className="mr-1.5 font-mono text-[11px] text-cyber-300">
                  {record.kind}:{record.id}
                </code>
                {record.subject ? <span className="text-white">{record.subject} — </span> : null}
                {record.note}
                {record.recordedBy ? <span className="text-gray-500"> ({record.recordedBy})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <p className="text-sm font-semibold text-white">The exported report</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          Printable and attachable, and honest about what it could not check. Read from the deployment's own
          <code className="mx-1 font-mono text-cyber-300">handoff</code>, plus the guard output and the saved
          <code className="mx-1 font-mono text-cyber-300">what-if</code>.
        </p>
        {model.report.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-surface-border bg-surface-light p-3.5 text-xs text-gray-400">
            The report's contents were not read, so there is nothing to attach. Print and export produce what was
            read, and say which fields are missing rather than leaving blanks that look deliberate.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {model.report.map((group) => (
              <div key={group.id} className="min-w-0 rounded-lg border border-surface-border bg-surface-light p-3">
                <p className="text-xs font-semibold text-white">{group.title}</p>
                <div className="mt-2 space-y-1.5">
                  {group.rows.map((row) => (
                    <div key={row.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                      <span className="w-32 shrink-0 text-gray-500">{row.label}</span>
                      <span className="min-w-0 flex-1 break-words font-mono text-white">{row.value}</span>
                      {row.flag ? (
                        <span className={`chip ${row.flag === "placeholder" ? "chip--warn" : "chip--bad"}`}>{row.flag}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={props.onPrint}>
            <Printer size={13} /> Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="card">
        <p className="text-sm font-semibold text-white">The go-live bar (§8.11), in the order it is held</p>
        <ol className="mt-3 space-y-2">
          {model.bar.length === 0 ? (
            <li className="text-xs text-gray-400">The bar was not read.</li>
          ) : (
            model.bar.map((item) => (
              <li key={`${item.order}-${item.item}`} className="flex items-start gap-2.5 text-xs">
                <span className="mt-0.5 shrink-0">
                  <StateIcon state={item.state} />
                </span>
                <span className="min-w-0 text-gray-400">
                  <span className="text-white">{item.item}</span>
                  <span className="text-gray-500"> — {STATE_LABEL[item.state].toLowerCase()}</span>
                  {item.detail ? <span className="text-gray-500">; {item.detail}</span> : null}
                </span>
              </li>
            ))
          )}
        </ol>
      </div>

      <p className="text-[11px] text-gray-500">
        {summarise(counts)} · {counts.advisories} advisories · {model.destination.label}
        {counts.derived ? " · counted from the steps received" : ""}
        {model.planCommit ? (
          <>
            {" · commit "}
            <code className="font-mono">{model.planCommit}</code>
          </>
        ) : null}
      </p>
    </div>
  );
}

/* ── The three views, dispatched ─────────────────────────────────────────────────────────────── */

export function DeploymentModernBody({ props }: { props: DeploymentViewProps }) {
  const step = props.model.steps.find((candidate) => candidate.id === props.selectedStepId) ?? props.model.steps[0];

  if (props.view === "step") {
    if (!step) {
      return (
        <div className="card">
          <p className="text-sm font-semibold text-white">No step to show</p>
          <p className="mt-1 text-xs text-gray-400">
            The deployment sent no steps, so there is no step in detail to open.
          </p>
        </div>
      );
    }
    return <StepDetailView props={props} step={step} />;
  }
  if (props.view === "sanitise") return <SanitiseView props={props} />;
  return <HandoffView props={props} />;
}

/** The step cards' own "press to open" affordance, exported so the track can use it in one place. */
export function StepOpenAffordance() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-cyber-300">
      Open the checklist <ChevronRight size={12} />
    </span>
  );
}
