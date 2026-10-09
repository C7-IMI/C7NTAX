/**
 * Reading the deployment state, and recording what the operator answers.
 *
 * Two rules decide the shape of this file.
 *
 * **A read that failed is never quietly replaced by a verdict.** When `GET /api/developer/deployment`
 * does not answer — or answers with something that is not a deployment payload — this hook returns the
 * plan's own steps with every state `unverified` and the reason in `error`, so the screen has something
 * to be honest about rather than something to draw green. That is the whole point of the page
 * (PLAN-030 §8.14: a gate that could not see the database). The fallback is used **only** here; a
 * successful read is rendered exactly as it answered, with nothing folded into it.
 *
 * **The write path records, and performs nothing.** The wizard records two things: an answer to a
 * decision the operator owes, and a remark against a check that could not be verified. Both are one
 * record on the deployment, so they are one call — `POST /developer/deployment/records` with
 * `{ kind, id, note }`, where `id` is a step id or an item id. The POST may answer with the updated
 * deployment payload (which is applied straight away, no second read) or with a plain acknowledgement
 * (which triggers a re-read), so both are handled.
 */
import { useCallback, useEffect, useState } from "react";
import api from "../../api";
import { apiErrorMessage } from "../../lib/apiError";
import { type DeploymentModel, emptyModel, isDeploymentPayload, normaliseDeployment } from "./deploymentContract";

export const DEPLOYMENT_ENDPOINT = "/developer/deployment";
export const DEPLOYMENT_RECORDS_ENDPOINT = "/developer/deployment/records";

export type DeploymentReadStatus = "loading" | "ready" | "unreadable";

export interface DeploymentRead {
  status: DeploymentReadStatus;
  model: DeploymentModel;
  /** What could not be read, in a sentence that names the endpoint — shown, never swallowed. */
  error: string | null;
  reload: () => void;
  /**
   * Adopt a payload the API has just handed back — the POST's updated deployment state — so a
   * recorded answer appears without a second round trip. Ignored when the body is not a payload.
   */
  applyPayload: (raw: unknown) => boolean;
}

export function useDeveloperDeployment(): DeploymentRead {
  const [status, setStatus] = useState<DeploymentReadStatus>("loading");
  const [model, setModel] = useState<DeploymentModel>(() =>
    emptyModel("the deployment state has not been read yet."),
  );
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    api
      .get(DEPLOYMENT_ENDPOINT)
      .then((response) => {
        if (cancelled) return;
        if (!isDeploymentPayload(response.data)) {
          const reason = "the response did not carry a step list, so it is not a deployment state.";
          setModel(emptyModel(`${DEPLOYMENT_ENDPOINT} answered with something this screen cannot read — ${reason}`));
          setError(`${DEPLOYMENT_ENDPOINT} answered with something this screen cannot read — ${reason}`);
          setStatus("unreadable");
          return;
        }
        setModel(normaliseDeployment(response.data));
        setError(null);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        const reason = apiErrorMessage(err, "the API did not answer");
        setModel(
          emptyModel(
            `${DEPLOYMENT_ENDPOINT} could not be read (${reason}). No step's state is known, so none is drawn as a pass.`,
          ),
        );
        setError(`${DEPLOYMENT_ENDPOINT} could not be read — ${reason}.`);
        setStatus("unreadable");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const applyPayload = useCallback((raw: unknown) => {
    if (!isDeploymentPayload(raw)) return false;
    setModel(normaliseDeployment(raw));
    setError(null);
    setStatus("ready");
    return true;
  }, []);

  return { status, model, error, reload, applyPayload };
}

export type DeploymentRecordResult =
  | { ok: true; payload: unknown | null }
  | { ok: false; message: string };

/**
 * Record an answer or a remark.
 *
 * The failure is returned rather than toasted here, because the two interfaces word their failures
 * differently (a sheet has a sentence beside the control; a form has a field error), and because a
 * refusal must leave the answer shown as outstanding.
 */
export async function recordDeploymentRecord(input: {
  kind: "decision" | "check";
  id: string;
  note: string;
}): Promise<DeploymentRecordResult> {
  try {
    const response = await api.post(DEPLOYMENT_RECORDS_ENDPOINT, input);
    return { ok: true, payload: isDeploymentPayload(response.data) ? response.data : null };
  } catch (err) {
    return { ok: false, message: apiErrorMessage(err, "The record could not be saved.") };
  }
}
