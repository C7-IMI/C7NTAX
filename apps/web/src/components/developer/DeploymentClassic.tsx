/**
 * Developer → Prepare for Live Deployment, in the classic interface: the same wizard drawn as a form.
 *
 * The two interfaces are two designs of one screen and this is the second one, not a restyle of the
 * first. What the classic arrangement is, said once (the mockup's own closing panel, followed):
 *
 *   · **a numbered table of contents, not a step track.** The steps the API sent are a table with a State
 *     column; clicking a row opens that step's dialog. There is no card you press and no pills.
 *   · **counts as a labelled row under the table**, not a sticky bar that follows you down the page.
 *   · **a `<select>` for the destination**, because a form has selects where the modern screen has a
 *     segmented control.
 *   · **a dialog per step with a heading, labelled fields in a grid and Save / Draft / Cancel** — and a
 *     **remarks** field beside every unverifiable check, because a form has somewhere to write an
 *     exception, which is the whole reason the classic arrangement is worth keeping here.
 *   · **the sanitisation step as two panels with their own headings and their own action** — never one
 *     form with two buttons of the same colour.
 *   · **no printed-report preview**: the classic hand-off is a Print button and a summary grid, because
 *     the destination for a printed report is the same in both designs.
 *
 * The shared part is the state, the checks, the API calls and the words — never the layout. `Developer
 * Deployment.tsx` holds one set of handlers and hands both arrangements the same props. Every field in
 * the dialog is a field the payload sent: `decides`, `plan`, `run`, and each item's `evidence`.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2, Lock, Printer, ShieldAlert, Terminal } from "lucide-react";
import toast from "react-hot-toast";
import { PageHeader, Section } from "../ui";
import {
  type DeploymentItem,
  type DeploymentStep,
  DESTINATIONS,
  itemCounts,
  STATE_LABEL,
  stepReason,
  summarise,
  unattachedRecords,
} from "./deploymentContract";
import type { DeploymentViewProps } from "./deploymentView";
import { DeploymentUnreadPanel, StateChip, StateLegend } from "./DeploymentChrome";

const SCOPE_LABEL: Record<string, string> = { shared: "Shared", azure: "Azure", aws: "AWS" };

/** The left column of a classic form: a label, then the field. */
function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[11px] font-semibold text-gray-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ReadOnlyField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <Field label={label} wide={wide}>
      <input className="input-field w-full" type="text" value={value} readOnly />
    </Field>
  );
}

/** The two facts the API attaches to an item's state, as a form writes them: a labelled sentence. */
function ItemFacts({ item }: { item: DeploymentItem }) {
  if (!item.derived && item.blocking) return null;
  return (
    <p className="mt-1 text-[11px] text-gray-500">
      {item.derived ? "The state was decided by reading a file in this repository, not by running anything." : null}
      {item.derived && !item.blocking ? " " : null}
      {item.blocking ? null : "This item does not hold the deployment back."}
    </p>
  );
}

/**
 * One step, as a dialog: a heading, a grid of labelled fields, the checks as a table with a remarks
 * field beside the ones that could not be verified, and Save / Draft / Cancel.
 */
function StepDialog({ props, step }: { props: DeploymentViewProps; step: DeploymentStep }) {
  const [remarks, setRemarks] = useState<Record<string, string>>(() => ({}));
  const [saving, setSaving] = useState(false);

  const unverifiable = step.items.filter((item) => item.state === "unverified");

  const save = async () => {
    const toRecord = unverifiable.filter((item) => (remarks[item.id] ?? "").trim() !== "");
    if (toRecord.length === 0) {
      props.onSelectStep("");
      return;
    }
    setSaving(true);
    let failed = 0;
    for (const item of toRecord) {
      const ok = await props.onRecordCheck(item.id, (remarks[item.id] ?? "").trim());
      if (!ok) failed += 1;
    }
    setSaving(false);
    if (failed === 0) props.onSelectStep("");
  };

  const counts = itemCounts(step);
  const reason = stepReason(step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={() => props.onSelectStep("")}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Step ${step.number} — ${step.title ?? step.id}`}
        className="card mt-8 w-full max-w-3xl space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold text-white">
            Step {step.number} — {step.title ?? "untitled"}
          </h2>
          <StateChip state={step.state} />
          <button
            type="button"
            className="text-gray-500 hover:text-white"
            aria-label="Close"
            onClick={() => props.onSelectStep("")}
          >
            ✕
          </button>
        </div>

        {step.summary ? <p className="text-xs leading-relaxed text-gray-400">{step.summary}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Destination">
            <select
              className="input-field w-full"
              value={props.destination}
              onChange={(event) => props.onDestination(event.target.value as "azure" | "aws")}
            >
              {DESTINATIONS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id === "azure" ? "Azure (Bicep, PLAN-016 / PLAN-030)" : "AWS"}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField label="Scope" value={step.scope ? SCOPE_LABEL[step.scope] ?? step.scope : "(not sent)"} />
          <ReadOnlyField label="Step id" value={step.id} />
          <ReadOnlyField label="Plan" value={step.plan ?? "(not sent)"} />
          <Field label="What this step actually decides" wide>
            <textarea className="input-field w-full" rows={3} value={step.decides ?? "(not sent)"} readOnly />
          </Field>
          <Field label="How it is run" wide>
            <textarea
              className="input-field w-full font-mono text-[11px]"
              rows={step.run.length > 0 ? Math.min(step.run.length + 1, 5) : 2}
              value={step.run.length > 0 ? step.run.join("\n") : "(no commands — this step is a decision and a reading)"}
              readOnly
            />
          </Field>
          {reason ? (
            <ReadOnlyField label={reason.label ?? "What this step's state rests on"} value={reason.text} wide />
          ) : null}
        </div>

        {step.items.length > 0 ? (
          <div>
            <div className="flex flex-wrap items-center gap-1.5 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Checks</span>
              <span className="text-[11px] text-gray-500">{step.items.length} items</span>
              {(["done", "attention", "blocked", "decision", "unverified"] as const)
                .filter((state) => (counts[state] ?? 0) > 0)
                .map((state) => (
                  <span key={state} className="text-[11px] text-gray-500">
                    {counts[state]} {STATE_LABEL[state].toLowerCase()}
                  </span>
                ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-surface-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-light text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">State</th>
                    <th className="px-3 py-2 font-semibold">Evidence</th>
                    <th className="px-3 py-2 font-semibold">Skip it</th>
                  </tr>
                </thead>
                <tbody>
                  {step.items.map((item) => (
                    <tr key={item.id} className="border-t border-surface-border align-top">
                      <td className="px-3 py-2 text-white">
                        {item.title ?? item.id}
                        <span className="mt-0.5 block font-mono text-[10px] text-gray-600">{item.id}</span>
                      </td>
                      <td className="px-3 py-2">
                        <StateChip state={item.state} />
                        <ItemFacts item={item} />
                      </td>
                      <td className="px-3 py-2 text-gray-400">{item.evidence ?? "not recorded"}</td>
                      <td className="px-3 py-2 text-gray-400">{item.ifSkipped ?? "not recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-surface-border bg-surface-light p-3 text-xs text-gray-400">
            This step's checks came back empty, so no item is shown as having passed.
          </p>
        )}

        {unverifiable.length > 0 ? (
          <div className="rounded-lg border border-dashed border-surface-border bg-surface-light p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Could not verify</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              A check the wizard cannot run is recorded here and carried into the hand-off, rather than being set to
              Passed.
            </p>
            <div className="mt-2 space-y-3">
              {unverifiable.map((item) => (
                <label key={item.id} className="block">
                  <span className="text-[11px] font-semibold text-gray-400">
                    Remarks — {item.title ?? item.id} ({item.id})
                  </span>
                  <textarea
                    className="input-field mt-1 w-full"
                    rows={2}
                    value={remarks[item.id] ?? ""}
                    onChange={(event) => setRemarks((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Why it could not be checked, and who has it…"
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {props.saveError ? <p className="text-xs text-red-400">{props.saveError}</p> : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border pt-3">
          <button type="button" className="btn-secondary" onClick={() => props.onSelectStep("")}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => toast.success("Draft kept on this screen only — Save records it against the check.")}
          >
            Save draft
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeploymentClassic(props: DeploymentViewProps) {
  const { model, counts, readError, destination, onDestination, chosenStepId, onSelectStep, canPurge } = props;
  const selected = chosenStepId ? (model.steps.find((step) => step.id === chosenStepId) ?? null) : null;
  const sanitisation = model.steps.find((step) => step.id === "sanitisation");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const unattached = unattachedRecords(model);
  const databaseName =
    model.report.find((group) => group.id === "database")?.rows.find((row) => row.label === "name")?.value ?? "c7ntax";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prepare for Live Deployment"
        subtitle="Sanitise and validate this instance before it is deployed, against the migration plan."
        actions={
          <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={props.onPrint}>
            <Printer size={13} /> Print
          </button>
        }
      />

      {readError ? (
        <DeploymentUnreadPanel
          error={readError}
          unreadable={model.unreadable}
          onRetry={props.onReload}
          retrying={props.readStatus === "loading"}
        />
      ) : null}

      <Section title="1 · Destination">
        <div className="card grid gap-3 sm:grid-cols-2">
          <Field label="Destination">
            <select
              className="input-field w-full"
              value={destination}
              onChange={(event) => onDestination(event.target.value as "azure" | "aws")}
            >
              {DESTINATIONS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id === "azure" ? "Azure (Bicep, PLAN-016 / PLAN-030)" : "AWS"}
                </option>
              ))}
            </select>
          </Field>
          <ReadOnlyField label="Plan" value={model.planFile ?? "(not sent)"} />
          <ReadOnlyField label="Commit" value={model.planCommit ?? "(not sent)"} />
          <ReadOnlyField label="Generated" value={model.generatedAt ? new Date(model.generatedAt).toLocaleString() : "(not sent)"} />
          <Field label="What has not been verified" wide>
            <textarea className="input-field w-full" rows={2} value={model.planUnverified ?? "(not sent)"} readOnly />
          </Field>
        </div>
      </Section>

      <Section title="2 · Steps">
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-light text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-10 px-3.5 py-2 font-semibold">#</th>
                <th className="px-3.5 py-2 font-semibold">Step</th>
                <th className="px-3.5 py-2 font-semibold">Id</th>
                <th className="px-3.5 py-2 font-semibold">Scope</th>
                <th className="px-3.5 py-2 font-semibold">Checks</th>
                <th className="px-3.5 py-2 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {model.steps.length === 0 ? (
                <tr>
                  <td className="px-3.5 py-3 text-gray-400" colSpan={6}>
                    The deployment sent no steps.
                  </td>
                </tr>
              ) : (
                model.steps.map((step) => {
                  const reason = stepReason(step);
                  return (
                    <tr
                      key={step.id}
                      className="cursor-pointer border-t border-surface-border hover:bg-surface-light"
                      onClick={() => onSelectStep(step.id)}
                    >
                      <td className="px-3.5 py-2.5 tabular-nums text-gray-500">{step.number}</td>
                      <td className="px-3.5 py-2.5">
                        <span className="text-white">{step.title ?? "untitled"}</span>
                        {reason ? (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">
                            {reason.label ? <b className="font-semibold text-gray-400">{reason.label}: </b> : null}
                            {reason.text}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-gray-500">{step.id}</td>
                      <td className="px-3.5 py-2.5 text-gray-400">
                        {step.scope ? SCOPE_LABEL[step.scope] ?? step.scope : "—"}
                      </td>
                      <td className="px-3.5 py-2.5 tabular-nums text-gray-400">{step.items.length}</td>
                      <td className="px-3.5 py-2.5">
                        <StateChip state={step.state} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-500">
          Clicking a row opens that step's dialog. The counts are a labelled row rather than a sticky bar:{" "}
          <span className="text-gray-400">{summarise(counts)}</span> ·{" "}
          <span className="text-gray-400">{counts.advisories} advisories</span>
          {counts.derived ? <span> · counted from the steps received</span> : null}
        </p>
        <div className="mt-1">
          <StateLegend />
        </div>
      </Section>

      <Section title="3 · Sanitisation">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h3 className="text-sm font-semibold text-white">Remove sample and seed data</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              Reversible, with a snapshot behind it. The contract is the API's own
              (<code className="font-mono text-cyber-300">sample-data-toggle.ts</code>): snapshot first, then wipe the
              business models children-before-parents, then set the disabled flag — which locks the snapshot and stops
              automatic capture. Identity and platform configuration are preserved.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Command" value="pnpm db:sample-off" />
              <ReadOnlyField label="Reversible with" value="pnpm db:sample-on" />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-surface-border pt-3">
              <Link to="/developer/purge" className="btn-secondary">
                Preview what would be removed
              </Link>
              {canPurge ? (
                <Link to="/developer/purge" className="btn-primary inline-flex items-center gap-1.5">
                  Disable sample data
                </Link>
              ) : (
                <span className="chip">
                  <Lock size={11} /> Needs developer:purge
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              This screen does not perform the purge; the purge screen does, with the real counts and the receipt.
            </p>
          </div>

          <div className="card border-red-500/30 bg-red-500/[0.04]">
            <h3 className="text-sm font-semibold text-white">Remove a customer's real data</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              A different act with a different owner, a different authority and a different recovery: written
              authorisation from the customer, a taken-and-restored backup, and an operator willing to sign for it.
              The wizard records the decision and refuses the act.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Owner" value="the operator" />
              <ReadOnlyField label="Database" value={databaseName} />
              <Field label="Database name to confirm the out-of-band run" wide>
                <input className="input-field w-full" type="text" value="" readOnly disabled placeholder="Locked" />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-3">
              <span className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-red-400/80" />
                Recorded in the hand-off as the operator's decision, with the authority attached.
              </span>
              <button type="button" className="btn-danger inline-flex items-center gap-1.5" disabled>
                <Lock size={13} /> Delete customer data
              </button>
            </div>
          </div>
        </div>

        <div className="card !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2.5">
            <p className="min-w-0 flex-1 text-sm font-semibold text-white">
              What travels into production, and what this step reads from the destination
            </p>
            <span className="chip border-dashed text-gray-500">
              {sanitisation ? `${sanitisation.items.length} surfaces` : "not read"}
            </span>
          </div>
          {sanitisation && sanitisation.items.length > 0 ? (
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
                {sanitisation.items.map((item) => (
                  <tr key={item.id} className="border-b border-surface-border/60 align-top last:border-0">
                    <td className="px-3.5 py-2.5 text-white">{item.title ?? item.id}</td>
                    <td className="px-3.5 py-2.5 text-gray-400">{item.evidence ?? "not recorded"}</td>
                    <td className="px-3.5 py-2.5 text-gray-400">{item.ifSkipped ?? "not recorded"}</td>
                    <td className="px-3.5 py-2.5">
                      <StateChip state={item.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3.5 py-3 text-xs text-gray-400">
              The surfaces this step is responsible for were not read, so none is named here.
            </p>
          )}
        </div>
      </Section>

      <Section title="4 · Hand-off">
        <div className="card grid gap-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-xs leading-relaxed text-gray-400">
            The end state is a report you can attach, not a green tick. The printed report is the same in both
            designs; this arrangement shows it as a summary grid rather than a preview.
          </p>
          <ReadOnlyField label="Steps" value={`${counts.steps}`} />
          <ReadOnlyField label="Done" value={`${counts.done}`} />
          <ReadOnlyField label="Blocked" value={`${counts.blocked}`} />
          <ReadOnlyField label="Decisions owed" value={`${counts.decision}`} />
          <ReadOnlyField label="Could not verify" value={`${counts.unverified}`} />
          <ReadOnlyField label="Attention" value={`${counts.attention}`} />
          <ReadOnlyField label="Advisories" value={`${counts.advisories}`} />
          <ReadOnlyField
            label="Bar"
            value={`${model.bar.filter((item) => item.state !== "done" && item.state !== "unverified").length} open · ${
              model.bar.filter((item) => item.state === "unverified").length
            } could not verify · of ${model.bar.length}`}
          />
          <ReadOnlyField label="Decisions unanswered" value={`${counts.owed} of ${model.decisions.length}`} />
          <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 border-t border-surface-border pt-3">
            <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={props.onPrint}>
              <Printer size={13} /> Print
            </button>
            <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={props.onExport}>
              <Download size={13} /> Export report
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-white">What was checked</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-light text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Step</th>
                  <th className="px-3 py-2 font-semibold">Result</th>
                  <th className="px-3 py-2 font-semibold">What it rests on</th>
                </tr>
              </thead>
              <tbody>
                {model.steps.map((step) => {
                  const reason = stepReason(step);
                  return (
                    <tr key={step.id} className="border-t border-surface-border align-top">
                      <td className="px-3 py-2 text-white">
                        {step.number} · {step.title ?? "untitled"}
                      </td>
                      <td className="px-3 py-2">
                        <StateChip state={step.state} />
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {reason ? (
                          <>
                            {reason.label ? <span className="text-gray-500">{reason.label}: </span> : null}
                            {reason.text}
                          </>
                        ) : (
                          "not recorded"
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
          <h3 className="text-sm font-semibold text-white">What remains the operator's decision</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            None of these is a task. Each has a field to record the answer, because a checkbox that pretends a
            decision is done is worse than a blank.
          </p>
          {props.saveError ? <p className="mt-2 text-xs text-red-400">{props.saveError}</p> : null}
          <div className="mt-3 space-y-4">
            {model.decisions.length === 0 ? (
              <p className="text-xs text-gray-400">
                The decisions the operator owes were not read, so none is shown as answered and none is shown as
                absent.
              </p>
            ) : (
              model.decisions.map((decision) => (
                <div key={decision.id} className="grid gap-3 border-t border-surface-border pt-3 sm:grid-cols-2">
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      <code className="mr-1.5 font-mono text-[11px] text-cyber-300">{decision.id}</code>
                      {decision.title ?? "untitled decision"}
                    </span>
                    {decision.blocking ? <span className="chip chip--bad">blocking</span> : null}
                    {decision.record ? <span className="chip chip--good">answered</span> : null}
                  </div>
                  {decision.recommendation ? (
                    <ReadOnlyField label="Recommendation" value={decision.recommendation} wide />
                  ) : null}
                  {decision.detail ? <ReadOnlyField label="Why" value={decision.detail} wide /> : null}
                  <ReadOnlyField
                    label="Answered against"
                    value={`${decision.id} — this decision's own id, which is what the endpoint accepts${
                      decision.plan ? ` · ${decision.plan}` : ""
                    }`}
                  />
                  <ReadOnlyField
                    label="Recorded answer"
                    value={
                      decision.record
                        ? `${decision.record.note}${
                            decision.record.recordedBy ? ` — ${decision.record.recordedBy}` : ""
                          }${decision.record.recordedByRole ? ` (${decision.record.recordedByRole})` : ""}${
                            decision.record.recordedAt ? `, ${new Date(decision.record.recordedAt).toLocaleString()}` : ""
                          }`
                        : "(not answered)"
                    }
                  />
                  <Field label="Record the answer" wide>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="input-field min-w-[240px] flex-1"
                        type="text"
                        value={drafts[decision.id] ?? ""}
                        onChange={(event) =>
                          setDrafts((current) => ({ ...current, [decision.id]: event.target.value }))
                        }
                        placeholder="Record the answer, and who gave it…"
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={props.saving || (drafts[decision.id] ?? "").trim() === ""}
                        onClick={() => void props.onRecordDecision(decision.id, (drafts[decision.id] ?? "").trim())}
                      >
                        Save
                      </button>
                    </div>
                  </Field>
                </div>
              ))
            )}
          </div>
        </div>

        {unattached.length > 0 ? (
          <div className="card border-amber-500/40 bg-amber-500/[0.06]">
            <h3 className="text-sm font-semibold text-white">
              Recorded answers the report no longer names a subject for
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              These were written down against a subject the deployment no longer reports. They are shown rather than
              dropped: a check that lost its id is when somebody most needs to read what was decided about it.
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-400">
              {unattached.map((record) => (
                <li key={`${record.kind}:${record.id}`}>
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
          <h3 className="text-sm font-semibold text-white">The go-live bar (§8.11), in the order it is held</h3>          <ol className="mt-2 space-y-1.5 list-disc pl-5 text-xs text-gray-400">
            {model.bar.length === 0 ? (
              <li>The bar was not read.</li>
            ) : (
              model.bar.map((item) => (
                <li key={`${item.order}-${item.item}`}>
                  <span className="text-white">{item.item}</span>
                  <span className="text-gray-500">
                    {" — "}
                    {STATE_LABEL[item.state].toLowerCase()}
                    {item.detail ? `; ${item.detail}` : ""}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>

        <div className="card">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Terminal size={13} className="text-cyber-400/80" /> How each step is run
          </h3>
          {model.steps.every((step) => step.run.length === 0) ? (
            <p className="mt-1 text-xs text-gray-400">No step reported a command.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {model.steps
                .filter((step) => step.run.length > 0)
                .map((step) => (
                  <div key={step.id}>
                    <p className="text-[11px] font-semibold text-gray-400">
                      {step.number} · {step.title ?? step.id}
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-md border border-surface-border bg-surface-lighter p-2 text-[11px] text-gray-300">
                      {step.run.join("\n")}
                    </pre>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Section>

      {selected ? <StepDialog key={selected.id} props={props} step={selected} /> : null}
    </div>
  );
}
