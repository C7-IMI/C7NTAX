/**
 * What both arrangements of the screen are handed.
 *
 * The two interfaces are two designs of one screen, so they share the **state, the API calls and the
 * words** and nothing else — which is exactly what this interface is: the model that was read, the
 * selection, the two record handlers and the print/export actions. There is no layout in here, and
 * nothing in here decides anything visually, so neither arrangement can drift from the other's answers.
 */
import type { DeploymentCounts, DeploymentModel } from "./deploymentContract";
import type { DeploymentReadStatus } from "./useDeveloperDeployment";

/** The four things the modern screen can be showing — the mockup's four switchable states. */
export type DeploymentView = "track" | "step" | "sanitise" | "handoff";

export interface DeploymentViewProps {
  model: DeploymentModel;
  counts: DeploymentCounts;
  readStatus: DeploymentReadStatus;
  /** Non-null when the read failed; the arrangements must say so rather than draw a verdict. */
  readError: string | null;

  view: DeploymentView;
  onView: (view: DeploymentView) => void;

  destination: "azure" | "aws";
  onDestination: (destination: "azure" | "aws") => void;

  selectedStepId: string;
  /** The step the operator actually opened, or `null` if they have not opened one yet. */
  chosenStepId: string | null;
  onSelectStep: (id: string) => void;

  /** `developer:purge` — whether the purge screen's controls will arm for this person. */
  canPurge: boolean;

  saving: boolean;
  saveError: string | null;
  /**
   * Records an answer, by the id the write endpoint accepts: a **decision's own id** for a decision, an
   * **item's id** for a check. Resolves false when it could not be saved, so the answer stays outstanding.
   */
  onRecordDecision: (id: string, note: string) => Promise<boolean>;
  /** Records a remark against a check that could not be verified, by item id. */
  onRecordCheck: (id: string, note: string) => Promise<boolean>;

  onPrint: () => void;
  onExport: () => void;
  onReload: () => void;
}
