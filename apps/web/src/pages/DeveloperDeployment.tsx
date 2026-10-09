/**
 * Prepare for Live Deployment — the migration plan with a surface.
 *
 * PLAN-030 is a plan on paper: a template that compiles, a script, a workflow, a table of findings and a
 * go-live bar. What it did not have is a *screen*. This page is that screen — the plan's sections and
 * exit conditions as eight steps with a state, a checklist per step whose items carry the evidence they
 * were checked against and the sentence saying what happens if they are skipped, a sanitisation step the
 * plan does not cover at all, and a hand-off report at the end instead of a green tick.
 *
 * **Two designs, one set of handlers.** `useRedesign()` decides which arrangement is drawn, and this
 * component draws neither of them itself:
 *
 *   · the **modern** arrangement (`DeploymentModern.tsx`) is the approved mockup — a step track you
 *     advance along, pills you press, a sentence beside the control that acts, a countable footer;
 *   · the **classic** arrangement (`DeploymentClassic.tsx`) is a form — a numbered table of contents, a
 *     `<select>` for the destination, a dialog per step with labelled fields and Save/Cancel, and the
 *     counts as a labelled row.
 *
 * They live in their own files only because this page is large; the rule the repository keeps is kept
 * exactly — **the state, the API calls and the words are shared, and the layout is not.** Everything
 * both arrangements need is the prop object below.
 *
 * **The truth this page keeps.** The screen exists because the plan's own second review found a gate
 * that could not see the database, so: a check that could not run is never drawn as a pass; the open
 * items — the placeholder `webOrigin`, the app connecting to the database as the server administrator,
 * nothing having run against a real subscription — are shown as open; and when
 * `GET /api/developer/deployment` does not answer, the page says what it could not read rather than
 * falling back to a hard-coded green. The fallback is the plan's own eight steps with every state
 * `unverified`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useRedesign } from "../hooks/useNavigationStyle";
import { useDeveloperAccess } from "../hooks/useDeveloperAccess";
import { PageHeader } from "../components/ui";
import {
  buildReportText,
  countDeployment,
  type DeploymentStep,
} from "../components/developer/deploymentContract";
import type { DeploymentView, DeploymentViewProps } from "../components/developer/deploymentView";
import { DeploymentModern } from "../components/developer/DeploymentModern";
import { DeploymentClassic } from "../components/developer/DeploymentClassic";
import { DeploymentPrintReport } from "../components/developer/DeploymentPrintReport";
import { recordDeploymentRecord, useDeveloperDeployment } from "../components/developer/useDeveloperDeployment";

/**
 * Which step to open when the operator has not chosen one: the one that most needs a person. A blocked
 * step first, then an owed decision, then something the wizard could not verify — never simply the
 * first row, which would open a green step on a screen whose whole argument is about the other four.
 */
function defaultStepId(steps: DeploymentStep[]): string {
  const wanted = ["blocked", "decision", "unverified", "attention"] as const;
  for (const state of wanted) {
    const match = steps.find((step) => step.state === state);
    if (match) return match.id;
  }
  return steps[0]?.id ?? "";
}

export function DeveloperDeploymentPage() {
  const redesign = useRedesign();
  const { canPurge } = useDeveloperAccess();
  const { status, model, error, reload, applyPayload } = useDeveloperDeployment();

  const counts = useMemo(() => countDeployment(model), [model]);

  const [view, setView] = useState<DeploymentView>("track");
  const [destination, setDestination] = useState<"azure" | "aws">("azure");
  /** `null` until the operator picks a step, so the default follows the data once it arrives. */
  const [chosenStepId, setChosenStepId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedStepId = chosenStepId ?? defaultStepId(model.steps);

  useEffect(() => {
    setSaveError(null);
  }, [chosenStepId, view]);

  const record = useCallback(
    async (kind: "decision" | "check", id: string, note: string): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      const result = await recordDeploymentRecord({ kind, id, note });
      setSaving(false);
      if (!result.ok) {
        setSaveError(`${result.message} Nothing was recorded, and the answer is still shown as outstanding.`);
        return false;
      }
      toast.success("Recorded");
      // The POST may hand back the updated deployment state; otherwise re-read it.
      if (!applyPayload(result.payload)) reload();
      return true;
    },
    [applyPayload, reload],
  );

  const onExport = useCallback(() => {
    const blob = new Blob([buildReportText(model, counts)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `c7ntax-deployment-report-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [model, counts]);

  const viewProps: DeploymentViewProps = {
    model,
    counts,
    readStatus: status,
    readError: error,
    view,
    onView: setView,
    destination,
    onDestination: setDestination,
    selectedStepId,
    chosenStepId,
    onSelectStep: (id) => setChosenStepId(id === "" ? null : id),
    canPurge,
    saving,
    saveError,
    onRecordDecision: (id, note) => record("decision", id, note),
    onRecordCheck: (id, note) => record("check", id, note),
    onPrint: () => window.print(),
    onExport,
    onReload: reload,
  };

  return (
    <>
      {/* The report the browser prints, whichever interface is on screen. */}
      <DeploymentPrintReport model={model} counts={counts} />

      {status === "loading" ? (
        <div className="space-y-4">
          <PageHeader
            title="Prepare for Live Deployment"
            subtitle="Sanitise and validate this instance before it is deployed, against the migration plan."
          />
          <div className="card flex items-center gap-2.5 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin text-cyber-400" />
            Reading the deployment state…
          </div>
        </div>
      ) : redesign ? (
        <DeploymentModern {...viewProps} />
      ) : (
        <DeploymentClassic {...viewProps} />
      )}
    </>
  );
}
