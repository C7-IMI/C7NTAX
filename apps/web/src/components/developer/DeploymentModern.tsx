/**
 * Developer → Prepare for Live Deployment, in the modern interface: the wizard as a thing you are
 * half-way through.
 *
 * This is the arrangement the approved mockup draws (`docs/mockups/prepare-for-live-deployment.html`):
 * a **step track you advance along**, pills you press rather than numbered headings you scroll past,
 * a sentence beside the control that acts, and a **countable footer** that says how much of this is
 * left. A plan is a document you read in order and then close; a wizard is a state you are in, and the
 * furniture says which one this is.
 *
 * The classic arrangement of the same screen is a form — a numbered table of contents, labelled fields
 * in a grid, a dialog per step with Save/Cancel, and the counts as a labelled row rather than a sticky
 * bar. It lives in `DeploymentClassic.tsx` and shares this file's model, words and handlers and none of
 * its layout, so neither is a restyle of the other.
 *
 * **The track is the payload's own steps.** Eight of them, in the order the API sends, with the states
 * it reports — and when it could not read something, this screen says so rather than drawing a verdict.
 * The plan's steps appear here only when the read itself failed, and then every one of them is
 * `unverified`.
 */
import { ChevronRight, Info, Layers } from "lucide-react";
import { DESTINATIONS, itemCounts, stepReason, summarise } from "./deploymentContract";
import type { DeploymentView, DeploymentViewProps } from "./deploymentView";
import { DeploymentUnreadPanel, StateChip, StateLegend, STEP_EDGE_CLASS } from "./DeploymentChrome";
import { DeploymentModernBody } from "./DeploymentModernViews";

const VIEWS: { id: DeploymentView; label: string }[] = [
  { id: "track", label: "1 · The track" },
  { id: "step", label: "2 · A step in detail" },
  { id: "sanitise", label: "3 · Sanitisation" },
  { id: "handoff", label: "4 · The hand-off" },
];

const SCOPE_LABEL: Record<string, string> = { shared: "Shared", azure: "Azure", aws: "AWS" };

export function DeploymentModern(props: DeploymentViewProps) {
  const { model, counts, readError, view, onView, destination, onDestination, selectedStepId, onSelectStep } = props;
  const hint = DESTINATIONS.find((candidate) => candidate.id === destination)?.hint ?? "";

  return (
    <div className="space-y-4 pb-16">
      {/* ── Which state of the wizard, and against which destination ─────────────────────────── */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">State</span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which state of the wizard to show">
            {VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onView(entry.id)}
                aria-pressed={view === entry.id}
                className={`chip ${view === entry.id ? "chip--on" : ""}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Destination">
            {DESTINATIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onDestination(entry.id)}
                aria-pressed={destination === entry.id}
                className={`chip ${destination === entry.id ? "chip--on" : ""}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[11px] text-gray-500">{hint}</span>
        </div>
      </div>

      {/* ── What is being prepared, and the one thing that is true of all of it ──────────────── */}
      <div className="card border-l-2 border-l-cyber-500">
        <div className="flex flex-wrap items-start gap-3">
          <span className="w-8 h-8 shrink-0 rounded-lg bg-cyber-600/20 text-cyber-400 flex items-center justify-center">
            <Layers size={15} />
          </span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-gray-400">
            A wizard that works alongside the migration plan ({model.destination.label}): it turns the plan's
            sections and exit conditions into steps with a state, and hands the operator a report at the end rather
            than a tick.
            {model.planUnverified ? <span className="mt-1.5 block text-gray-500">{model.planUnverified}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StateChip state="unverified" label="nothing has run against Azure" />
            {model.planCommit ? (
              <span className="chip">
                <code className="font-mono text-[11px]">{model.planCommit}</code>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {readError ? (
        <DeploymentUnreadPanel
          error={readError}
          unreadable={model.unreadable}
          onRetry={props.onReload}
          retrying={props.readStatus === "loading"}
        />
      ) : null}

      {model.unreadable.length > 0 && !readError ? (
        <div className="card border-amber-500/40 bg-amber-500/[0.06]">
          <p className="text-sm font-semibold text-white">The deployment reported something it could not read</p>
          <ul className="mt-2 space-y-1 list-disc pl-5 text-xs text-gray-400">
            {model.unreadable.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── The track, or a step in detail, or the sanitisation step, or the hand-off ─────────── */}
      {view === "track" ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">
              The steps, and the state of each one told the same way in every card
            </h3>
            <p className="mt-1 max-w-[110ch] text-xs leading-relaxed text-gray-400">
              The plan's order of work, with its own exit conditions as the checks. A step is
              <span className="text-gray-300"> done</span>,<span className="text-gray-300"> attention</span>, blocked
              by a named thing, an <span className="text-gray-300">owed decision</span>, or
              <span className="text-gray-300"> could not verify</span>. The last two exist because 2.3 is deferred by
              decision rather than forgotten, and because nothing in this package has touched ARM yet.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {model.steps.map((step) => {
              const reason = stepReason(step);
              const items = itemCounts(step);
              const notDone = (["attention", "blocked", "decision", "unverified"] as const)
                .map((state) => items[state] ?? 0)
                .reduce((total, n) => total + n, 0);
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    onSelectStep(step.id);
                    onView("step");
                  }}
                  className={`flex flex-col gap-2 rounded-xl border border-surface-border bg-surface p-3.5 text-left transition-colors hover:border-cyber-500/45 ${STEP_EDGE_CLASS[step.state]} ${
                    selectedStepId === step.id ? "ring-1 ring-cyber-500/40" : ""
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      Step {step.number}
                    </span>
                    {step.scope ? (
                      <span className="ml-auto rounded-md border border-surface-border px-1.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                        {SCOPE_LABEL[step.scope] ?? step.scope}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] font-semibold text-white">
                    {step.title ?? <span className="text-gray-500">untitled step</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StateChip state={step.state} />
                    {step.items.length > 0 ? (
                      <span className="chip text-gray-500">{step.items.length} checks</span>
                    ) : null}
                  </span>
                  {step.summary ? (
                    <span className="text-[11px] leading-relaxed text-gray-500">{step.summary}</span>
                  ) : null}
                  {reason ? (
                    <span className="mt-auto border-t border-dashed border-surface-border pt-2 text-[11px] leading-relaxed text-gray-500">
                      {reason.label ? <b className="font-semibold text-gray-400">{reason.label}: </b> : null}
                      {reason.text}
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-1 text-[11px] text-cyber-300">
                    {step.items.length === 0 && notDone === 0 ? "No checklist was read" : "Open the checklist"}
                    <ChevronRight size={12} />
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white">The five states, explained once</h3>
            <p className="mt-1 text-xs text-gray-400">
              <span className="text-gray-300">Could not verify</span> is a state of its own, not a quiet kind of
              done — review round 2 was a gate that could not see the database.
            </p>
            <div className="mt-2.5">
              <StateLegend />
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-semibold text-white">
                Advisories — they do not gate the deploy
              </p>
              <span className="chip">{counts.advisories}</span>
            </div>
            {model.advisories.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">
                No advisories were read. That is not the same as there being none, so none is claimed.
              </p>
            ) : (
              <ul className="mt-2.5 space-y-2">
                {model.advisories.map((advisory, index) => (
                  <li key={`${index}-${advisory.title}`} className="flex items-start gap-2.5 text-xs text-gray-400">
                    <Info size={13} className="mt-0.5 shrink-0 text-cyber-400/80" />
                    <span className="min-w-0">
                      <span className="text-white">{advisory.title}</span>
                      {advisory.detail ? <span> — {advisory.detail}</span> : null}
                      {advisory.plan ? <span className="text-gray-600"> ({advisory.plan})</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <DeploymentModernBody props={props} />
      )}

      {/* ── The countable footer: how much of this is left, always on screen ─────────────────── */}
      <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-surface-border bg-surface px-3.5 py-2 shadow-lg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
          <span className="text-gray-400">Target: {model.destination.label}</span>
          <span className="text-gray-600">|</span>
          <span className="tabular-nums text-gray-400">{summarise(counts)}</span>
          <span className="text-gray-600">|</span>
          <span className="tabular-nums text-gray-400">{counts.advisories} advisories</span>
          {counts.derived ? <span className="text-gray-600">(counted from the steps received)</span> : null}
          <span className="ml-auto">Companion to PLAN-030 · nothing deployed</span>
        </div>
      </div>
    </div>
  );
}
