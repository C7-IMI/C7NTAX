import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import api from "../api";
import { apiErrorMessage } from "../lib/apiError";
import { PageHeader, StatCard } from "../components/ui";
import { EnvironmentBadge } from "../components/developer/EnvironmentBadge";
import { ModelTable, PurgeReceiptPanel, PurgeStatusTrack, type TrackStepId, type TrackState } from "../components/developer/purgeParts";
import { LoadingBlock, StateChip, UnavailablePanel, formatCount, plural } from "../components/developer/developerUi";
import {
  useDeveloperEnvironment, usePurgePreview, type PurgeModelCount, type PurgePreview, type PurgeReceipt,
  type PurgeSnapshot,
} from "../components/developer/developerApi";
import { useDeveloperAccess } from "../hooks/useDeveloperAccess";
import { useRedesign } from "../hooks/useNavigationStyle";

/**
 * `/developer/purge` — the purge, with the count in front of it and the survivors on the same screen.
 *
 * The CLI's `pnpm db:sample-off` performs three steps in a fixed order: capture a snapshot, delete every
 * delegate in `WIPE_MODELS`, then set the marker file that locks the snapshot and pauses the reseed. It
 * prints a line per model it deleted and a total, and it does not say what it left behind — which is
 * exactly why this screen exists. Everything a person needs in order to decide whether to press it is on
 * this screen before the button is, including:
 *
 *   · the **removed list beside the preserved list**, because the preserved list is the thing that makes
 *     the operation acceptable: the instance is empty of work, not of people;
 *   · the **third list** — the models neither `WIPE_MODELS` nor `KEEP_MODELS` names, which therefore
 *     survive. A purge that leaves clients and contacts on the instance is a purge somebody runs and then
 *     does not understand. The screen does not resolve it; it counts it, names it, and puts it next to the
 *     preserved list.
 *
 * The confirmation is a real gate: the exact phrase the dry run published, and a reason that is written
 * to the audit log with the actor and the IP. The control **does not arm** for somebody without
 * `developer:purge` — it is drawn disabled with the sentence saying why, because a control that refuses
 * after the click is worse than one that never armed.
 *
 * Two designs, and they are not the same design with a class toggled:
 *
 *   · **Modern** is a five-step track you step along, the two lists side by side with the third turned
 *     on beneath them, and the reason sitting beside the phrase that arms the control.
 *   · **Classic** is a form: a summary grid of read-only labelled fields, labelled list boxes, and a
 *     confirmation dialog with a heading and Save/Cancel, where the reason textarea is visible from the
 *     moment the dialog opens. The classic dialog keeps a snapshot checkbox; the modern screen has no
 *     equivalent because on the modern screen the snapshot is a step on the track rather than a choice.
 */
export function DeveloperPurgePage() {
  const redesign = useRedesign();
  const { canPurge } = useDeveloperAccess();
  const preview = usePurgePreview();
  const environment = useDeveloperEnvironment();

  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<PurgeReceipt | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The snapshot checkbox the classic dialog shows. The API's purge always captures the snapshot first,
  // so the box is drawn checked and cannot be cleared — see the note beside it.
  const captureSnapshot = true;

  const data = preview.data;
  const requiredPhrase = data?.requiredPhrase ?? "";
  const phraseMatches = requiredPhrase.length > 0 && phrase === requiredPhrase;
  const reasonOk = reason.trim().length > 0;
  const alreadyDisabled = data?.disabled === true;
  const armed = canPurge && !alreadyDisabled && phraseMatches && reasonOk && !busy;

  const submit = async () => {
    if (!armed) return;
    setBusy(true);
    setRefusal(null);
    try {
      const { data: result } = await api.post<PurgeReceipt>("/developer/purge", {
        phrase,
        reason: reason.trim(),
      });
      setReceipt(result ?? {});
      setDialogOpen(false);
      setPhrase("");
      setReason("");
      preview.reload();
      toast.success("Sample data disabled");
    } catch (err) {
      // A 400 names the field the API refused; show its words rather than a generic failure.
      setRefusal(apiErrorMessage(err, "The purge was refused."));
    } finally {
      setBusy(false);
    }
  };

  const stepState = (id: TrackStepId): TrackState => {
    if (id === "snapshot" || id === "dry-run") return preview.status === "ok" ? "done" : "todo";
    if (id === "confirm") return receipt ? "done" : preview.status === "ok" ? "current" : "todo";
    if (id === "purge") return busy ? "current" : receipt ? "done" : "todo";
    return receipt ? "done" : "todo";
  };

  const removedRows = data?.dryRun?.rows ?? sumRows(data?.removed);
  const removedTables = data?.dryRun?.tables ?? (data?.removed?.length ?? 0);
  const preservedRows = sumRows(data?.preserved);
  const preservedTables = data?.preserved?.length ?? 0;
  const unlistedRows = sumRows(data?.unlisted);
  const unlistedModels = data?.unlisted?.length ?? 0;

  const countableSentence =
    preview.status === "ok" && data ? (
      <>
        This removes <b className="tabular-nums text-white">{formatCount(removedRows)} rows</b> across{" "}
        {plural(removedTables, "table")}; it keeps{" "}
        <b className="tabular-nums text-white">{formatCount(preservedRows)} rows</b> across{" "}
        {plural(preservedTables, "identity and configuration table")}, and it leaves{" "}
        <b className="tabular-nums text-white">{formatCount(unlistedRows)} rows</b> across{" "}
        {plural(unlistedModels, "model")} that neither list names. It sets the sample-data flag, which locks
        the snapshot and pauses the automatic reseed until sample data is enabled again.
      </>
    ) : null;

  const unavailable = preview.status === "unavailable";

  // ── Classic: a form with a summary grid, labelled list boxes and a confirmation dialog ──────────
  if (!redesign) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Purge Data"
          subtitle="Remove the sample and seed data so the instance is a clean slate before live data arrives; identity and platform configuration stay."
        />
        <EnvironmentBadge read={environment} />

        {preview.status === "loading" ? (
          <div className="rounded-lg border border-surface-border bg-surface-light px-4 py-3 text-sm text-gray-500">
            Reading the dry run…
          </div>
        ) : null}
        {unavailable ? (
          <div className="space-y-3">
            <UnavailablePanel message={preview.message ?? "The purge dry run could not be read."} onRetry={preview.reload} />
            <p className="text-xs text-gray-500">
              Without the dry run this screen cannot count what the operation would remove, so the control cannot
              arm. Nothing has been deleted.
            </p>
          </div>
        ) : null}

        {preview.status === "ok" && data ? (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-white">Disable sample data</h2>
            <p className="max-w-3xl text-sm text-gray-400">{countableSentence}</p>

            {alreadyDisabled ? (
              <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-sm text-gray-300">
                Sample data is already disabled — the marker file is set. Enable it to reseed from the locked
                snapshot before purging again.
              </p>
            ) : null}

            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <ReadField label="Rows to remove" value={formatCount(removedRows)} />
              <ReadField label="Tables to remove" value={formatCount(removedTables)} />
              <ReadField label="Preserved" value={`${formatCount(preservedRows)} rows · ${formatCount(preservedTables)} tables`} />
              <ReadField label="Left behind" value={`${formatCount(unlistedRows)} rows in ${formatCount(unlistedModels)} models`} />
              <ReadField label="Audit rows inside the total" value={data.auditRows === null ? "not reported" : formatCount(data.auditRows)} />
              <ReadField label="Sample data flag" value={data.disabled ? "set (already disabled)" : "not set"} />
              <ReadField label="Snapshot to be captured" value={snapshotLine(data.snapshot)} />
            </dl>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ListBox title={`Would be removed — ${formatCount(removedTables)} tables, ${formatCount(removedRows)} rows`} rows={data.removed} />
              <ListBox title={`Preserved — ${formatCount(preservedTables)} tables, ${formatCount(preservedRows)} rows`} rows={data.preserved} />
            </div>
            <ListBox
              title={`Left behind, because neither list names them — ${formatCount(unlistedModels)} models, ${formatCount(unlistedRows)} rows`}
              rows={data.unlisted}
              warn
            />

            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={captureSnapshot} disabled className="mt-1" />
              <span>
                Capture snapshot — yes
                <span className="mt-0.5 block text-xs text-gray-500">
                  The operation captures the snapshot before it deletes and the snapshot is locked afterwards;
                  it is part of the contract rather than a field on this form, which is why the box cannot be
                  cleared.
                </span>
              </span>
            </label>

            <div className="flex items-center gap-3 border-t border-surface-border pt-4">
              <button className="btn-danger" disabled={!canPurge || alreadyDisabled} onClick={() => setDialogOpen(true)}>
                Disable sample data
              </button>
              <span className="text-xs text-gray-500">
                {canPurge
                  ? "The phrase and the reason are entered in the confirmation dialog."
                  : "Your role does not hold developer:purge, so this control will not arm."}
              </span>
            </div>
          </div>
        ) : null}

        {receipt ? <PurgeReceiptPanel receipt={receipt} /> : null}

        {dialogOpen && data ? (
          <PurgeConfirmDialog
            data={data}
            removedRows={removedRows}
            removedTables={removedTables}
            preservedRows={preservedRows}
            unlistedRows={unlistedRows}
            unlistedModels={unlistedModels}
            phrase={phrase}
            setPhrase={setPhrase}
            reason={reason}
            setReason={setReason}
            requiredPhrase={requiredPhrase}
            phraseMatches={phraseMatches}
            armed={armed}
            busy={busy}
            refusal={refusal}
            canPurge={canPurge}
            onCancel={() => setDialogOpen(false)}
            onConfirm={() => void submit()}
          />
        ) : null}
      </div>
    );
  }

  // ── Modern: the track, the lists, and the reason beside the control that acts ────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Purge Data"
        icon={<Trash2 size={16} className="text-alert-red" />}
        subtitle="Remove the sample and seed data so the instance is a clean slate before live data arrives; identity and platform configuration stay."
        actions={
          <Link to="/developer/danger" className="chip">
            <AlertTriangle size={12} className="text-alert-amber" />
            Danger Zone
          </Link>
        }
      />

      <EnvironmentBadge read={environment} />

      <div className="card space-y-3">
        <p className="text-sm text-gray-400">
          The same three steps <span className="font-mono text-xs">pnpm db:sample-off</span> performs, in the
          order it performs them: snapshot, remove, lock. Everything a person needs in order to decide whether
          to press it is on this screen before the button is.
        </p>
        <PurgeStatusTrack state={stepState} />
        {preview.status === "ok" && data?.snapshot ? (
          <p className="border-t border-surface-border pt-3 text-xs text-gray-500">
            Step 1 — the snapshot this operation captures first:{" "}
            <span className="font-mono text-gray-400">{snapshotLine(data.snapshot)}</span>
          </p>
        ) : null}
      </div>

      {preview.status === "loading" ? <LoadingBlock label="the purge dry run" /> : null}

      {unavailable ? (
        <div className="space-y-3">
          <UnavailablePanel message={preview.message ?? "The purge dry run could not be read."} onRetry={preview.reload} />
          <p className="text-xs text-gray-500">
            Without the dry run this screen cannot count what the operation would remove, so the control cannot
            arm. Nothing has been deleted.
          </p>
        </div>
      ) : null}

      {preview.status === "ok" && data ? (
        <>
          {alreadyDisabled ? (
            <div className="rounded-xl border border-alert-amber/40 bg-alert-amber/10 px-4 py-3 text-sm text-gray-300">
              Sample data is already disabled — the marker file is set, so the snapshot is locked and the
              automatic reseed is paused. Enabling sample data reseeds from the locked snapshot.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Would be removed"
              tone="red"
              value={formatCount(removedRows)}
              foot={<span className="text-[11px] text-gray-500">{plural(removedTables, "table")} — every delegate in the wipe list, children before parents.</span>}
            />
            <StatCard
              label="Preserved by KEEP_MODELS"
              tone="green"
              value={formatCount(preservedRows)}
              foot={<span className="text-[11px] text-gray-500">{plural(preservedTables, "table")}: identity and platform configuration, so the instance still signs people in afterwards.</span>}
            />
            <StatCard
              label="Left behind by omission"
              tone="amber"
              value={formatCount(unlistedRows)}
              foot={<span className="text-[11px] text-gray-500">{plural(unlistedModels, "model")} neither list names. Detail below.</span>}
            />
            <StatCard
              label="Audit rows inside the total"
              tone="neutral"
              value={data.auditRows === null ? "—" : formatCount(data.auditRows)}
              foot={<span className="text-[11px] text-gray-500">{data.auditRows === null ? "the API did not report this figure" : "auditLog is in the wipe list, so the purge takes the trail with it."}</span>}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-white">
                Removed — {plural(removedTables, "table")}, {plural(removedRows, "row")}
              </h3>
              <p className="text-xs text-gray-500">The delegates in the wipe list, counted rather than deleted.</p>
              <ModelTable rows={data.removed} showWhy footer="one transaction per model, children before parents" empty="The dry run reported nothing removable." />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-white">
                Preserved — {plural(preservedTables, "table")}, {plural(preservedRows, "row")}
              </h3>
              <p className="text-xs text-gray-500">
                Every model in the keep list. This is the list that makes the operation acceptable: the instance
                is empty of work, not of people.
              </p>
              <ModelTable rows={data.preserved} empty="The dry run reported nothing preserved." footer="identity and platform configuration" />
            </section>
          </div>

          {/* The third list: the reason this screen exists, given the prominence the mockup gives it. */}
          <section className="rounded-xl border border-alert-amber/40 bg-alert-amber/10 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={15} className="text-alert-amber" />
              <h3 className="text-sm font-semibold text-white">
                Left behind, because neither list names them — {plural(unlistedModels, "model")}, {plural(unlistedRows, "row")}
              </h3>
            </div>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-gray-300">
              These models are in neither the wipe list nor the keep list, so this operation does not remove
              them. Clients and contacts survive an “empty” instance. The screen has to say so before the
              button, because “everything else goes” is not what the code does — the honest fix is a one-line
              decision about each of them, and until it is made this list is the truth.
            </p>
            <div className="mt-3">
              <ModelTable rows={data.unlisted} accent empty="The dry run reported no unlisted models." footer="in neither list" />
            </div>
          </section>

          <section className="card space-y-4 border-alert-red/40">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Typed confirmation</h3>
              <StateChip tone={armed ? "bad" : "neutral"}>{armed ? "armed" : "not armed"}</StateChip>
            </div>
            <p className="max-w-4xl text-sm text-gray-300">{countableSentence}</p>

            <div>
              <label className="block text-xs text-gray-400">
                Type <code className="font-mono text-alert-amber">{requiredPhrase || "the phrase the dry run published"}</code> to arm the control.
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  className="input-field max-w-sm font-mono"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  placeholder={requiredPhrase || "the phrase has not been read yet"}
                  disabled={!canPurge || alreadyDisabled}
                  aria-label="Confirmation phrase"
                />
                <StateChip tone={phraseMatches ? "good" : "neutral"}>{phraseMatches ? "matches" : "does not match"}</StateChip>
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                The phrase is the operation's own name, not a word like DELETE, which people type without
                reading. It is not accepted in a different case and there is no clipboard button.
              </p>
            </div>

            <div>
              <label htmlFor="purge-reason" className="block text-xs text-gray-400">
                Reason — required, and written to the audit log with the actor and the IP.
              </label>
              <input
                id="purge-reason"
                className="input-field mt-1.5 max-w-xl"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Handover to Acme Corp — clearing sample tickets before live ingestion"
                disabled={!canPurge || alreadyDisabled}
              />
              <p className="mt-1 text-[11px] text-gray-500">
                It is a sentence, not a fragment: the API refuses a value it has seen from the same actor in the
                last 24 hours, which is what stops “test” being a reason.
              </p>
            </div>

            {!canPurge ? (
              <p className="rounded-lg border border-surface-border bg-surface-lighter px-3 py-2 text-xs text-gray-400">
                Your role does not hold <code className="font-mono text-cyber-300">developer:purge</code>, so this
                control will not arm. An administrator can grant it in Administration → Users &amp; Roles, on the
                Developer row of the Permissions tab.
              </p>
            ) : null}

            {refusal ? (
              <p className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-xs text-gray-300">
                {refusal}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-surface-border pt-4">
              <button className="btn-danger flex items-center gap-2" disabled={!armed} onClick={() => void submit()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Disable sample data
              </button>
              <span className="text-xs text-gray-500">
                {plural(removedRows, "row")} · {plural(removedTables, "table")} · one snapshot first · flag set afterwards
              </span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Why a typed phrase and not a checkbox</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                A checkbox is answered by reflex in under a second and is the same reflex the second time. A
                phrase has to be read to be typed, it takes long enough for the sentence above it to arrive, and
                it cannot be dismissed by muscle memory — which is the only failure mode this control has.
              </p>
            </div>
            <div className="card">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Why the snapshot is step one and not step three</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                Because the point of the snapshot is the state <i>before</i> the deletion, and{" "}
                <span className="font-mono">sample-data-toggle.ts</span> captures it first for exactly that
                reason. The screen moves the step onto the track so that the lock — the thing that keeps the
                snapshot from being overwritten by the next change — is visible as the consequence of pressing.
              </p>
            </div>
          </div>

          {receipt ? <PurgeReceiptPanel receipt={receipt} /> : null}
        </>
      ) : null}
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-52 shrink-0 text-gray-400">{label}</dt>
      <dd className="text-white tabular-nums">{value}</dd>
    </div>
  );
}

/** A labelled list box, which is how the classic screen shows a list of models. */
function ListBox({ title, rows, warn = false }: { title: string; rows: PurgeModelCount[]; warn?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      <div className={`max-h-64 overflow-y-auto rounded-lg border ${warn ? "border-alert-amber/40" : "border-surface-border"} bg-surface`}>
        {rows.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-500">Nothing reported.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.model} className="flex items-center justify-between gap-3 border-b border-surface-border px-3 py-1.5 text-xs last:border-0">
                <span className="font-mono text-gray-300">{row.model}</span>
                <span className="tabular-nums text-white">{formatCount(row.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The classic confirmation dialog: a heading, the figures restated read-only, the phrase and the reason
 * visible from the moment it opens, and Save/Cancel. The Save button is labelled with the operation, not
 * with "OK", because the label is the last thing read before the press.
 */
function PurgeConfirmDialog({
  data, removedRows, removedTables, preservedRows, unlistedRows, unlistedModels,
  phrase, setPhrase, reason, setReason, requiredPhrase, phraseMatches, armed, busy, refusal, canPurge,
  onCancel, onConfirm,
}: {
  data: PurgePreview;
  removedRows: number;
  removedTables: number;
  preservedRows: number;
  unlistedRows: number;
  unlistedModels: number;
  phrase: string;
  setPhrase: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  requiredPhrase: string;
  phraseMatches: boolean;
  armed: boolean;
  busy: boolean;
  refusal: string | null;
  canPurge: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purge-confirm-title"
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-400">
            <Trash2 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="purge-confirm-title" className="text-sm font-semibold text-white">Disable sample data</h2>
            <p className="mt-1 text-xs text-gray-500">
              Removes {plural(removedRows, "row")} across {plural(removedTables, "table")} and keeps{" "}
              {plural(preservedRows, "row")}. This cannot be undone from this screen.
            </p>
          </div>
          <button onClick={onCancel} className="ml-auto rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white" aria-label="Cancel">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <ReadField label="Rows to remove" value={`${formatCount(removedRows)} (read-only)`} />
            <ReadField label="Tables to remove" value={`${formatCount(removedTables)} (read-only)`} />
            <ReadField label="Preserved" value={`${formatCount(preservedRows)} rows`} />
            <ReadField label="Left behind" value={`${formatCount(unlistedRows)} rows in ${formatCount(unlistedModels)} models`} />
          </dl>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Preserved models</p>
            <p className="mt-1 rounded-lg border border-surface-border bg-surface-light px-3 py-2 font-mono text-[11px] text-gray-400">
              {data.preserved.map((row) => row.model).join(", ") || "none reported"}
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input type="checkbox" checked disabled className="mt-1" />
            <span>
              Capture snapshot — yes
              <span className="mt-0.5 block text-xs text-gray-500">
                The snapshot is taken first by the operation itself; it is not a field this form can turn off.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="purge-dialog-phrase" className="block text-sm text-gray-300">
              Confirmation phrase
            </label>
            <input
              id="purge-dialog-phrase"
              className="input-field mt-1 font-mono"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={requiredPhrase || "the phrase has not been read yet"}
              disabled={!canPurge}
            />
            <p className="mt-1 text-xs text-gray-500">
              {phraseMatches ? "The phrase matches." : <>Type <code className="font-mono text-alert-amber">{requiredPhrase}</code> exactly.</>}
            </p>
          </div>

          <div>
            <label htmlFor="purge-dialog-reason" className="block text-sm text-gray-300">Reason</label>
            <textarea
              id="purge-dialog-reason"
              className="input-field mt-1 resize-y"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this instance is being emptied, in a sentence"
              disabled={!canPurge}
            />
          </div>

          {!canPurge ? (
            <p className="rounded-lg border border-surface-border bg-surface-lighter px-3 py-2 text-xs text-gray-400">
              Your role does not hold <code className="font-mono">developer:purge</code>, so this control will not
              arm.
            </p>
          ) : null}
          {refusal ? (
            <p className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-xs text-gray-300">{refusal}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-surface-border bg-surface-light/40 px-5 py-4">
          <button className="btn-secondary text-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-danger flex items-center gap-1.5 text-sm" onClick={onConfirm} disabled={!armed}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Disable sample data
          </button>
        </div>
      </div>
    </div>
  );
}

function sumRows(rows: PurgeModelCount[] | undefined): number {
  if (!rows) return 0;
  return rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
}

/** The snapshot step's own evidence: the manifest, how much it holds, and whether it is locked. */
function snapshotLine(snapshot: PurgeSnapshot | null | undefined): string {
  if (!snapshot) return "not reported";
  const parts = [snapshot.file || snapshot.name || "reported"];
  if (typeof snapshot.files === "number") parts.push(`${formatCount(snapshot.files)} fixture files`);
  if (typeof snapshot.records === "number") parts.push(`${formatCount(snapshot.records)} records`);
  parts.push(snapshot.locked ? "locked" : "not locked");
  return parts.join(" · ");
}
