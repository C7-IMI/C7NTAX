/**
 * The report the wizard prints.
 *
 * It is rendered into the application's own print container (`index.css` hides everything on `@media
 * print` except `.ticket-print-only`), so "Print" produces the **report** — not the application chrome
 * around it — and the same report prints whichever interface is in use. The mockup says this explicitly:
 * the destination for a printed report is the same in both designs.
 *
 * Every line comes from the payload. An item whose state was *read from the repository* says so, because
 * a printed page is the one thing that outlives the screen and it must not read as "this was executed".
 *
 * `aria-hidden` and `display: none` on screen: it is the same content the hand-off draws, written for
 * paper, and reading it twice to a screen reader would be noise.
 */
import {
  type DeploymentCounts,
  type DeploymentModel,
  STATE_LABEL,
  stepReason,
  summarise,
  unattachedRecords,
} from "./deploymentContract";

export function DeploymentPrintReport({ model, counts }: { model: DeploymentModel; counts: DeploymentCounts }) {
  const unattached = unattachedRecords(model);
  return (
    <section className="ticket-print-only" aria-hidden="true">
      <h1>Prepare for Live Deployment</h1>
      <p>
        {model.destination.label}
        {model.planFile ? ` · ${model.planFile}` : ""}
        {model.planCommit ? ` · commit ${model.planCommit}` : ""}
      </p>
      <p>
        {summarise(counts)} · {counts.advisories} advisories
        {counts.derived ? " (counted from the steps received)" : ""} · generated{" "}
        {new Date(model.generatedAt ?? Date.now()).toLocaleString()}
      </p>
      {model.planUnverified ? <p>{model.planUnverified}</p> : null}
      <p>A check that could not run is recorded as could not verify, never as a pass. Compiling is not deploying.</p>

      {model.unreadable.length > 0 ? (
        <>
          <h2>The deployment reported these as unread</h2>
          <ul>
            {model.unreadable.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>What was checked</h2>
      {model.steps.length === 0 ? (
        <p>No step was read.</p>
      ) : (
        model.steps.map((step) => {
          const reason = stepReason(step);
          return (
            <div key={step.id} className="ticket-print-activity">
              <h3>
                {step.number} · {step.title ?? "untitled"} — {STATE_LABEL[step.state]}
                {step.scope ? ` (${step.scope})` : ""}
              </h3>
              {step.plan ? <p>Plan: {step.plan}</p> : null}
              {reason ? (
                <p>
                  {reason.label ? <b>{reason.label}: </b> : null}
                  {reason.text}
                </p>
              ) : null}
              {step.items.length === 0 ? (
                <p>No item was read for this step, so none is reported as having passed.</p>
              ) : (
                <ul>
                  {step.items.map((item) => (
                    <li key={item.id}>
                      <b>{item.title ?? item.id}</b> — {STATE_LABEL[item.state]}
                      {item.derived ? " (read from the repository, not run)" : ""}
                      {item.blocking ? "" : " (does not hold the deployment)"}
                      {item.evidence ? ` · checked against: ${item.evidence}` : ""}
                      {item.ifSkipped ? ` · skip it: ${item.ifSkipped}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}

      <h2>What remains the operator's decision</h2>
      {model.decisions.length === 0 ? (
        <p>No decision was read.</p>
      ) : (
        model.decisions.map((decision) => (
          <div key={decision.id} className="ticket-print-activity">
            <h3>
              {decision.id} · {decision.title ?? "untitled"}
              {decision.blocking ? " — blocking" : ""}
            </h3>
            {decision.recommendation ? <p>Recommendation: {decision.recommendation}</p> : null}
            {decision.detail ? <p>Why: {decision.detail}</p> : null}
            <p>Answered against: {decision.id} — this decision's own id, which is what the endpoint accepts</p>
            <p>
              Answer: {decision.record?.note ?? "not recorded yet"}
              {decision.record?.recordedBy ? ` — ${decision.record.recordedBy}` : ""}
              {decision.record?.recordedAt ? `, ${new Date(decision.record.recordedAt).toLocaleString()}` : ""}
            </p>
          </div>
        ))
      )}

      <h2>Read from the deployment</h2>
      {model.report.length === 0 ? (
        <p>Not read.</p>
      ) : (
        model.report.map((group) => (
          <div key={group.id}>
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.value}
                    {row.flag ? ` (${row.flag})` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}

      {unattached.length > 0 ? (
        <>
          <h2>Recorded answers the report no longer names a subject for</h2>
          <ul>
            {unattached.map((record) => (
              <li key={`${record.kind}:${record.id}`}>
                <b>
                  {record.kind}:{record.id}
                </b>
                {record.subject ? ` — ${record.subject}` : ""}: {record.note}
                {record.recordedBy ? ` (${record.recordedBy})` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>The go-live bar (§8.11), in the order it is held</h2>      {model.bar.length === 0 ? (
        <p>Not read.</p>
      ) : (
        <ol>
          {model.bar.map((item) => (
            <li key={`${item.order}-${item.item}`}>
              {item.item} — {STATE_LABEL[item.state].toLowerCase()}
              {item.detail ? `; ${item.detail}` : ""}
            </li>
          ))}
        </ol>
      )}

      <h2>Advisories — they do not gate the deploy</h2>
      {model.advisories.length === 0 ? (
        <p>None was read.</p>
      ) : (
        <ul>
          {model.advisories.map((advisory, index) => (
            <li key={`${index}-${advisory.title}`}>
              {advisory.title}
              {advisory.detail ? ` — ${advisory.detail}` : ""}
              {advisory.plan ? ` (${advisory.plan})` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
