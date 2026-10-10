import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/ui";
import { EnvironmentBadge } from "../components/developer/EnvironmentBadge";
import { LoadingBlock, StateChip, formatCount, plural } from "../components/developer/developerUi";
import {
  useApiKeys, useDeveloperEnvironment, usePurgePreview, type PurgeModelCount,
} from "../components/developer/developerApi";
import { useDeveloperAccess } from "../hooks/useDeveloperAccess";
import { useModernInterface } from "../hooks/useNavigationStyle";

/**
 * `/developer/danger` — the operations with no way back, kept apart from everything else.
 *
 * The reason they are apart is not severity — a purge is severe too — it is that these have **no way
 * back at all**, and a control with no way back should not sit under a heading whose other entries are
 * recoverable.
 *
 * Three rules govern the screen, and they are the screen:
 *
 *   1. **The blast radius is a countable sentence, not a colour.** Each card states, in the figures the
 *      API reports, what it will destroy before its control can arm. Where a figure could not be read,
 *      the screen says which read failed rather than showing a zero.
 *   2. **A production instance refuses.** Every operation here quotes the environment badge, and refuses
 *      to arm at all when the badge says production. The refusal is drawn, not left to the API to say.
 *   3. **Not built is said plainly.** Operations with no route behind them are shown as not built: the
 *      card renders, the sentence is countable, and pressing the armed control says that nothing ran
 *      rather than pretending.
 *
 * Two designs: the modern screen is four cards whose sentences are the guard, with the typed confirmation
 * inline; the classic screen is a table of four rows whose Action column opens a confirmation dialog. The
 * state, the calls and the words are shared; the arrangement is not.
 */
export function DeveloperDangerPage() {
  const modern = useModernInterface();
  const { canPurge } = useDeveloperAccess();
  const environment = useDeveloperEnvironment();
  const preview = usePurgePreview();
  const keys = useApiKeys();

  const [openOp, setOpenOp] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [refused, setRefused] = useState<string | null>(null);

  const isProduction = environment.data?.badge?.isProduction === true;
  const removedRows = preview.data?.dryRun?.rows ?? null;
  const removedTables = preview.data?.dryRun?.tables ?? null;
  const preservedRows = preview.status === "ok" ? sumRows(preview.data?.preserved) : null;
  const preservedTables = preview.data?.preserved?.length ?? null;
  const unlistedRows = preview.status === "ok" ? sumRows(preview.data?.unlisted) : null;
  // `/api-keys` answers in the list envelope `{ data: [...] }`, so the rows are one level in.
  const keyRows = keys.status === "ok" ? (keys.data?.data ?? []) : null;
  const keyCount = keyRows ? keyRows.length : null;
  const unusedKeys = keyRows ? keyRows.filter((key) => !key.lastUsedAt).length : null;

  const operations: DangerOperation[] = [
    {
      id: "purge-all",
      name: "Purge all business data",
      phrase: "purge sample data permanently",
      does: "The deletion the purge screen performs, as a single act rather than a return to a sample state: no snapshot captured, no flag set, no route back. For handing an instance on, or for starting again.",
      destroys: removedRows !== null && removedTables !== null ? (
        <>
          Removes <b className="tabular-nums text-white">{formatCount(removedRows)} rows</b> across{" "}
          {plural(removedTables, "table")}, and keeps only what is not on the delete path — the same{" "}
          {formatCount(preservedRows ?? 0)} identity rows and the same {formatCount(unlistedRows ?? 0)} rows the
          lists do not name.
        </>
      ) : (
        <>The Purge Data screen counts what this removes. That read did not arrive here, so this card will not
          show a zero in its place.</>
      ),
      safeguard: "Drawn next door with the difference spelled out, and the typed phrase is the operation's own name rather than a policy word.",
      link: { to: "/developer/purge", label: "Compare with Purge Data" },
    },
    {
      id: "reset-schema",
      name: "Reset the database to the empty schema",
      phrase: "reset the schema completely",
      does: "Drops and recreates the schema from the migrations in apps/api/prisma/migrations, leaving nothing — not even the tables the purge keeps.",
      destroys: removedRows !== null && preservedRows !== null ? (
        <>
          Removes <b className="tabular-nums text-white">{formatCount(removedRows + preservedRows)} rows</b> in
          total — the {plural(removedRows, "row")} the purge removes <i>and</i> the {plural(preservedRows, "row")}{" "}
          across {plural(preservedTables ?? 0, "table")} the purge keeps — plus the schema itself. Not one row
          survives, and the login being used to run it stops existing mid-operation.
        </>
      ) : (
        <>Removes every row in the schema, including the identity and configuration tables the purge keeps.
          The counts could not be read here; the Purge Data screen reports them.</>
      ),
      safeguard: "Refuses while any account other than the one acting is signed in, takes a full dump first, and requires the phrase typed.",
    },
    {
      id: "rotate-keys",
      name: "Rotate every API key and disable every integration",
      phrase: "rotate everything",
      does: "One press for the exit case: new keys for every row in apiKey, and every integration switched off.",
      destroys: keyCount !== null && keyCount > 0 ? (
        <>
          Every machine's access stops at once —{" "}
          <b className="tabular-nums text-white">{plural(keyCount, "API key")}</b>{" "}
          {keyCount === 1 ? "is" : "are"} rotated
          {unusedKeys !== null ? <>, {formatCount(unusedKeys)} of which {unusedKeys === 1 ? "has" : "have"} never been used</> : null},
          and every integration switch is turned off. Some of those machines are ones nobody remembered.
        </>
      ) : keyCount === 0 ? (
        <>
          Every integration switch is turned off, so every machine talking to this instance stops at once. The
          API access list holds no keys to rotate right now, so there is nothing on that half of the operation.
        </>
      ) : (
        <>Every machine's access stops at once. The key count could not be read here, so this card will not
          offer a number for it.</>
      ),
      safeguard: "Shows each caller's last-seen time before it acts, and reports afterwards what has not been heard from — the only way to find the machine nobody remembered.",
      link: { to: "/admin/api", label: "See the keys and their last use" },
    },
  ];

  const unreadable = [
    preview.status === "unavailable" ? "the purge dry run" : null,
    keys.status === "unavailable" ? "the API key list" : null,
  ].filter(Boolean) as string[];

  const resetGate = () => {
    setPhrase("");
    setReason("");
    setRefused(null);
  };

  // Nothing here has a route behind it yet, and the honest answer to an armed press is to say so. The
  // card, its countable sentence and its confirmation are drawn; the request it would send does not exist.
  const tryOperation = (operation: DangerOperation) => {
    if (phrase !== operation.phrase || reason.trim().length === 0) return;
    setRefused(
      "Nothing ran. This operation has no route behind it yet — the card and its confirmation are drawn, and the request it would send does not exist.",
    );
    toast.error("Not built — nothing ran");
  };

  const auditCard: DangerOperation = {
    id: "audit",
    name: "The audit record every developer action leaves",
    phrase: "",
    does: "The section's own log, filtered to developer actions only, with the actor, IP, operation, the reason and the blast radius the dry run reported — readable after the fact and exportable.",
    destroys: <>Nothing. But note the order: <span className="font-mono">auditLog</span> is itself in the wipe list, so a purge takes its own read-out with it. That is why the receipt is written outside the wiped set.</>,
    safeguard: "Written by the service that performs the work, never by the screen; the destructive operations additionally write a copy outside the wiped set, and the purge's receipt names where that copy is.",
    readOnly: true,
  };

  if (!modern) {
    const rows = [...operations, auditCard];
    const open = operations.find((operation) => operation.id === openOp) ?? null;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Danger Zone"
          subtitle="The four operations that cannot be undone."
        />
        <EnvironmentBadge read={environment} />

        <div className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-4 py-3 text-sm text-gray-300">
          These four are kept apart from the rest of the section. The reason is not severity — a purge is
          severe too — it is that these have no way back at all. Each states what it will destroy before its
          control can arm, and each refuses to arm on a production instance.
        </div>

        {unreadable.length > 0 ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-4 py-3 text-xs text-gray-300">
            Some figures could not be read here: {unreadable.join(" and ")}. The cards that needed them say so
            rather than showing a zero.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-lighter text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Operation</th>
                <th className="px-3 py-2 font-semibold">What it destroys</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operation) => (
                <tr key={operation.id} className="border-t border-surface-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{operation.name}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{operation.does}</div>
                    <div className="mt-1 text-xs text-gray-500">{operation.safeguard}</div>
                    {operation.link ? (
                      <Link to={operation.link.to} className="mt-1 inline-block text-xs text-cyber-400 hover:text-cyber-300">
                        {operation.link.label}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs leading-relaxed text-alert-amber">{operation.destroys}</td>
                  <td className="px-3 py-2">
                    {operation.readOnly ? (
                      <StateChip tone="neutral">read-only</StateChip>
                    ) : isProduction ? (
                      <StateChip tone="bad">refused on production</StateChip>
                    ) : (
                      <StateChip tone="warn">not built</StateChip>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {operation.readOnly ? (
                      <span className="text-xs text-gray-500">No control — it is a read.</span>
                    ) : (
                      <button
                        className="btn-danger !px-3 !py-1.5 text-xs"
                        disabled={!canPurge || isProduction}
                        onClick={() => {
                          resetGate();
                          setOpenOp(operation.id);
                        }}
                      >
                        Run…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {open ? (
          <DangerConfirmDialog
            operation={open}
            isProduction={isProduction}
            canPurge={canPurge}
            phrase={phrase}
            setPhrase={setPhrase}
            reason={reason}
            setReason={setReason}
            refusal={refused}
            onCancel={() => setOpenOp(null)}
            onConfirm={() => tryOperation(open)}
          />
        ) : null}
      </div>
    );
  }

  // ── Modern: four cards whose sentences are the guard ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title="Danger Zone"
        icon={<AlertTriangle size={16} className="text-alert-red" />}
        subtitle="The four operations that cannot be undone."
        actions={
          <Link to="/developer/purge" className="chip">
            <Trash2 size={12} className="text-alert-red" />
            Purge Data
          </Link>
        }
      />

      <EnvironmentBadge read={environment} />

      <div className="rounded-xl border border-alert-red/40 bg-alert-red/10 px-4 py-3 text-sm text-gray-300">
        <b className="text-gray-200">These four are kept apart from the rest of the section.</b> The reason is not
        severity — a purge is severe too — it is that these have no way back at all, and a control with no way
        back should not sit under a heading whose other entries are recoverable.
      </div>

      {unreadable.length > 0 ? (
        <p className="rounded-xl border border-alert-amber/40 bg-alert-amber/10 px-4 py-3 text-xs text-gray-300">
          Some figures could not be read here: {unreadable.join(" and ")}. The cards that needed them say so
          rather than showing a zero.
        </p>
      ) : null}

      {environment.status === "loading" ? <LoadingBlock label="the environment badge" /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {operations.map((operation) => (
          <DangerCard
            key={operation.id}
            operation={operation}
            isProduction={isProduction}
            canPurge={canPurge}
            showRefusedState={operation.id === "reset-schema"}
            phrase={phrase}
            setPhrase={setPhrase}
            reason={reason}
            setReason={setReason}
            refusal={refused}
            onConfirm={() => tryOperation(operation)}
          />
        ))}
      </div>

      <AuditRecordCard operation={auditCard} />
    </div>
  );
}

interface DangerOperation {
  id: string;
  name: string;
  phrase: string;
  does: string;
  destroys: ReactNode;
  safeguard: string;
  link?: { to: string; label: string };
  readOnly?: boolean;
}

/**
 * One operation, as a card. Everything it needs to say is on it: what it does, what it destroys in
 * countable words, the safeguard, and the typed confirmation — or, on a production instance, the refusal.
 *
 * `showRefusedState` marks the one card the mockup draws in the **armed-but-refused** state: the sentence
 * and the confirmation are all present, and the control will not run. It is the same refusal the other
 * cards draw; it is drawn fully here because that is the state a person needs to see to believe it.
 */
function DangerCard({
  operation, isProduction, canPurge, showRefusedState, phrase, setPhrase, reason, setReason, refusal, onConfirm,
}: {
  operation: DangerOperation;
  isProduction: boolean;
  canPurge: boolean;
  showRefusedState: boolean;
  phrase: string;
  setPhrase: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  refusal: string | null;
  onConfirm: () => void;
}) {
  const matches = phrase === operation.phrase;
  const armed = canPurge && !isProduction && matches && reason.trim().length > 0;

  return (
    <article className="card flex flex-col gap-3 border-alert-red/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert-red/15 text-alert-red">
          <AlertTriangle size={15} />
        </span>
        <h3 className="text-sm font-semibold text-white">{operation.name}</h3>
        <span className="ml-auto">
          {isProduction ? (
            <StateChip tone="bad">{showRefusedState ? "armed — but refused" : "refused"}</StateChip>
          ) : (
            <StateChip tone="warn">not built</StateChip>
          )}
        </span>
      </div>

      <div className="space-y-2">
        <AnswerRow label="Does">{operation.does}</AnswerRow>
        <AnswerRow label="Can destroy" tone="text-alert-amber">{operation.destroys}</AnswerRow>
        <AnswerRow label="Safeguard">{operation.safeguard}</AnswerRow>
      </div>

      {operation.link ? (
        <Link to={operation.link.to} className="text-xs font-medium text-cyber-400 hover:text-cyber-300">
          {operation.link.label}
        </Link>
      ) : null}

      <div className="mt-auto space-y-3 border-t border-surface-border pt-3">
        {isProduction ? (
          <p className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-xs text-gray-300">
            <b className="text-white">Refused.</b> This instance is running in production, so this control will
            not arm at all. The environment badge is the fact and this control quotes it.
          </p>
        ) : null}

        <div>
          <label className="block text-[11px] text-gray-500">
            Type <code className="font-mono text-alert-amber">{operation.phrase}</code> to arm.
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              className="input-field max-w-full font-mono text-xs"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={isProduction ? "refused on this instance" : operation.phrase}
              disabled={!canPurge || isProduction}
              aria-label={`Confirmation phrase for ${operation.name}`}
            />
            <StateChip tone={isProduction ? "bad" : matches ? "good" : "neutral"}>
              {isProduction ? "refused" : matches ? "matches" : "does not match"}
            </StateChip>
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-gray-500">Reason — required, and written down with the actor and the IP.</label>
          <input
            className="input-field mt-1 text-xs"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this operation, in a sentence"
            disabled={!canPurge || isProduction}
          />
        </div>

        {!canPurge ? (
          <p className="text-[11px] text-gray-500">
            Your role does not hold <code className="font-mono text-cyber-300">developer:purge</code>, so this
            control will not arm.
          </p>
        ) : null}

        {refusal ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11px] text-gray-300">{refusal}</p>
        ) : null}

        <button className="btn-danger flex w-full items-center justify-center gap-2 text-sm" disabled={!armed} onClick={onConfirm}>
          <Trash2 size={14} />
          {operation.name}
        </button>
      </div>
    </article>
  );
}

function AuditRecordCard({ operation }: { operation: DangerOperation }) {
  return (
    <article className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-white">{operation.name}</h3>
        <StateChip tone="neutral">read-only</StateChip>
      </div>
      <div className="space-y-2">
        <AnswerRow label="Does">{operation.does}</AnswerRow>
        <AnswerRow label="Can destroy" tone="text-alert-amber">{operation.destroys}</AnswerRow>
        <AnswerRow label="Safeguard">{operation.safeguard}</AnswerRow>
      </div>
      <p className="rounded-lg border border-surface-border bg-surface-lighter px-3 py-2 text-xs text-gray-400">
        The developer-action read is not served yet, so this panel cannot show rows: the log the section leaves
        will be readable here, filtered to <span className="font-mono">developer.*</span> operations. It is
        written by the service, not by this screen.
      </p>
    </article>
  );
}

function AnswerRow({ label, tone = "text-gray-300", children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-full shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500 sm:w-24">{label}</span>
      <span className={`text-xs leading-relaxed ${tone}`}>{children}</span>
    </div>
  );
}

/** The classic confirmation dialog: a heading, the sentence, the phrase and the reason, Save/Cancel. */
function DangerConfirmDialog({
  operation, isProduction, canPurge, phrase, setPhrase, reason, setReason, refusal, onCancel, onConfirm,
}: {
  operation: DangerOperation;
  isProduction: boolean;
  canPurge: boolean;
  phrase: string;
  setPhrase: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  refusal: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const matches = phrase === operation.phrase;
  const armed = canPurge && !isProduction && matches && reason.trim().length > 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="danger-confirm-title"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-surface-border px-5 py-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-alert-red/15 text-alert-red">
            <AlertTriangle size={16} />
          </span>
          <h2 id="danger-confirm-title" className="text-sm font-semibold text-white">{operation.name}</h2>
          <button onClick={onCancel} className="ml-auto rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-surface-lighter hover:text-white" aria-label="Cancel">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-relaxed text-alert-amber">{operation.destroys}</p>
          <p className="text-xs text-gray-500">{operation.safeguard}</p>

          {isProduction ? (
            <p className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-3 py-2 text-xs text-gray-300">
              <b className="text-white">Refused.</b> This instance is running in production, so this operation
              will not arm here.
            </p>
          ) : null}

          <div>
            <label htmlFor="danger-phrase" className="block text-sm text-gray-300">Confirmation phrase</label>
            <input
              id="danger-phrase"
              className="input-field mt-1 font-mono"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={operation.phrase}
              disabled={!canPurge || isProduction}
            />
            <p className="mt-1 text-xs text-gray-500">
              {matches ? "The phrase matches." : <>Type <code className="font-mono text-alert-amber">{operation.phrase}</code> exactly.</>}
            </p>
          </div>

          <div>
            <label htmlFor="danger-reason" className="block text-sm text-gray-300">Reason</label>
            <textarea
              id="danger-reason"
              className="input-field mt-1 resize-y"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this operation, in a sentence"
              disabled={!canPurge || isProduction}
            />
          </div>

          {!canPurge ? (
            <p className="rounded-lg border border-surface-border bg-surface-lighter px-3 py-2 text-xs text-gray-400">
              Your role does not hold <code className="font-mono">developer:purge</code>, so this control will not arm.
            </p>
          ) : null}
          {refusal ? (
            <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-gray-300">{refusal}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-surface-border bg-surface-light/40 px-5 py-4">
          <button className="btn-secondary text-sm" onClick={onCancel}>Cancel</button>
          <button className="btn-danger flex items-center gap-1.5 text-sm" onClick={onConfirm} disabled={!armed}>
            {operation.name}
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
