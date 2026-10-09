/**
 * History and reset — what it said before, who changed it, and the way back to what the code writes.
 *
 * The honest problem this screen has today is that there is nothing to show: nothing has ever been
 * saved, because there was no template system to save one into. So `v0` is real — it is the body the
 * matching template function in `EmailService.ts` returns right now — and everything the API reports
 * above it is drawn exactly as read. A history screen that invented five plausible revisions would be
 * the worst place in a product to lie, because the whole reason it exists is to be believed.
 *
 * The two arrangements: the modern screen is a version track you step along plus version rows with
 * Compare and Restore; the classic screen is a table whose Action column opens a confirmation dialog
 * before it restores anything, because that is how a classic screen asks a question that changes what a
 * client reads.
 */
import { useState } from "react";
import { Clock, RotateCcw } from "lucide-react";
import type { EmailBlock, EmailMessageKey, EmailTemplateVersion } from "@C7NTAX/shared";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { Band, MonoTm, StateChip, UnavailablePanel, plural } from "./emailChrome";
import { codeBlocksFor } from "./emailCodeV0";
import { derivePlainText, htmlToText } from "./emailBlocks";

export interface EmailHistoryProps {
  messageKey: EmailMessageKey;
  versions: EmailTemplateVersion[];
  versionsReading: boolean;
  /** What the versions read said, when it failed. */
  versionsFailure: string | null;
  onRetryVersions: () => void;
  /** The template as it stands in the editor, for the difference from the default. */
  subject: string;
  blocks: EmailBlock[];
  /** The live state the list reported, if it did. */
  stateLabel: string | null;
  canManage: boolean;
  onRestore: (version: number) => void;
  onReset: () => void;
  overrides: { level: string; scope: string; message: string; state: string }[];
  busy: boolean;
}

/** The five steps a change to a customer-facing message goes through, and where it stops for some. */
const TRACK = [
  { step: "Step 1", title: "v0 imported", say: "The body the code writes, read out of EmailService.ts and kept as the default forever.", value: "v0 · the default" },
  { step: "Step 2", title: "Edited as a draft", say: "Blocks, fields and conditionals, with a save blocked by a broken reference rather than by a warning.", value: "unsaved" },
  { step: "Step 3", title: "Previewed against a record", say: "A real ticket and a real invoice, at 520 px and at 340 px, plus the plain-text derivation. The mobile width is compulsory, not optional.", value: "a real record" },
  { step: "Step 4", title: "Sent as a test", say: "To one address, through the real SMTP connection, because a canvas is a browser and a browser is not Outlook. There is no sandbox to soften this step.", value: "recorded in the history" },
  { step: "Step 5", title: "Saved as live", say: "For a security-class message the track stops at step 2: there is nothing to preview or test that has not already been fixed.", value: "3 messages end at step 2" },
];

function DefaultDifference({ messageKey, blocks }: { messageKey: EmailMessageKey; blocks: EmailBlock[] }) {
  const defaultBlocks = codeBlocksFor(messageKey);
  const asWritten = derivePlainText(defaultBlocks, (value) => value.replace(/\{\{\s*(.*?)\s*\}\}/g, "$1"));
  const now = derivePlainText(blocks, (value) => value.replace(/\{\{\s*(.*?)\s*\}\}/g, "$1"));
  const sameBlocks = defaultBlocks.length === blocks.length && asWritten === now;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-surface-border bg-surface-light p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">As the code writes it (v0)</p>
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-gray-400">
          {asWritten || "—"}
        </pre>
      </div>
      <div className="rounded-xl border border-cyber-500/40 bg-cyber-600/10 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">As the editor would send it</p>
        <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-gray-400">
          {now || "—"}
        </pre>
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500 lg:col-span-2">
        The difference is stated against <strong className="font-medium text-gray-400">the default</strong> rather
        than against the previous version, because the question somebody actually asks is &ldquo;how far have we moved
        from what the product shipped&rdquo;, and that question has the same answer on every row.{" "}
        {sameBlocks ? "Nothing differs from the default at the moment." : "The two texts above are not the same."}
      </p>
    </div>
  );
}

export function EmailHistoryPanel(props: EmailHistoryProps) {
  const redesign = useRedesign();
  const [confirm, setConfirm] = useState<number | null>(null);
  const versions = [...props.versions].sort((a, b) => b.version - a.version);

  const rows = versions.length > 0
    ? versions.map((version) => ({
        version: version.version,
        title: version.note ?? `Saved as v${version.version}`,
        detail: htmlToText(derivePlainText(version.blocks, (value) => value)).slice(0, 220) || "—",
        who: version.savedByName ?? "not stated",
        when: version.savedAt,
        text: version.text,
      }))
    : [{
        version: 0,
        title: "Imported from EmailService.ts — the default",
        detail: "The body the matching template function returns today, transcribed into the block vocabulary. Read from the code, not authored here.",
        who: "read from the code",
        when: "",
        text: null as string | null,
      }];

  const confirmRow = confirm === null ? null : rows.find((row) => row.version === confirm);

  if (redesign) {
    return (
      <div className="space-y-4">
        <Band
          tone={props.versions.length > 0 ? "info" : "warn"}
          title={props.versions.length > 0 ? `${plural(props.versions.length, "saved version")} of ${props.messageKey}` : "No version has ever been saved, and v0 is real"}
        >
          {props.versions.length > 0 ? (
            <>Read from <MonoTm>GET /api/email/templates/{props.messageKey}/versions</MonoTm>.</>
          ) : (
            <>
              <strong>v0</strong> is real: it is the body the code writes, kept as the default forever. Nothing above it
              exists, because nothing can be saved until this screen&apos;s Save writes one — and a history that invented
              revisions would be worse than an empty one.
            </>
          )}
        </Band>

        {props.versionsFailure ? (
          <UnavailablePanel
            message={props.versionsFailure}
            onRetry={props.onRetryVersions}
            what={<>What is drawn below is the code&apos;s own version, which needs no API to be true.</>}
          />
        ) : null}

        <section className="card">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold text-white">How a change gets to a client</h3>
            <p className="text-[11.5px] text-gray-500">
              Nothing that leaves the building skips a step, which is why a template edit is not a text field with a Save
              button.
            </p>
          </div>
          <ol className="mt-3 grid gap-2 md:grid-cols-5">
            {TRACK.map((entry, index) => (
              <li key={entry.step} className="relative rounded-xl border border-surface-border bg-surface-light/60 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${index === 2 ? "bg-cyber-400" : "bg-gray-600"}`} />
                  <span className="text-[10.5px] uppercase tracking-wide text-gray-500">{entry.step}</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-gray-200">{entry.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{entry.say}</p>
                <p className="mt-1.5 font-mono text-[10.5px] text-gray-600">{entry.value}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="card !p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-4 py-2.5">
            <Clock size={14} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-white">Versions of {props.messageKey}</h3>
            <span className="ml-auto font-mono text-[11px] text-gray-500">
              {props.versionsReading ? "reading…" : `${props.versions.length} from the API`}
            </span>
          </div>
          <ul>
            {rows.map((row) => (
              <li key={row.version} className="flex flex-wrap items-start gap-3 border-b border-surface-border/60 px-4 py-3 last:border-b-0">
                <MonoTm className="mt-0.5">v{row.version}</MonoTm>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-200">{row.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{row.detail}</p>
                </div>
                <span className="text-[11px] text-gray-500">
                  {row.who}
                  {row.when ? <span className="block">{new Date(row.when).toLocaleString()}</span> : null}
                </span>
                <span className="flex items-center gap-1.5">
                  {row.text !== null && row.text !== undefined ? <StateChip tone="warn">plain text overridden</StateChip> : null}
                  {row.version === 0 ? (
                    <StateChip tone="neutral">default</StateChip>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary !px-2 !py-1 text-xs" disabled={!props.canManage} onClick={() => setConfirm(row.version)}>
                        Restore
                      </button>
                      <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setConfirm(row.version)}>
                        Compare
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3 className="text-sm font-semibold text-white">The difference from the default</h3>
          <div className="mt-2">
            <DefaultDifference messageKey={props.messageKey} blocks={props.blocks} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" disabled={!props.canManage || props.busy} onClick={props.onReset}>
              <RotateCcw size={13} /> Reset this template to default
            </button>
            <span className="text-[11px] text-gray-500">
              The default is not a blank document — it is the version in the code, so reset always has somewhere to go.
              {props.stateLabel ? ` State: ${props.stateLabel}.` : ""}
            </span>
          </div>
        </section>

        <section className="card !p-0">
          <div className="border-b border-surface-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-white">Overrides — instance, then board, then client, then language</h3>
            <p className="text-[11px] text-gray-500">the order is fixed</p>
          </div>
          <div className="overflow-x-auto p-3.5">
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr className="border-b border-surface-border">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Level</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Scope</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Message</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {props.overrides.map((row) => (
                  <tr key={row.level} className="border-b border-surface-border/60 last:border-b-0">
                    <td className="whitespace-nowrap px-2 py-1.5 text-gray-200">{row.level}</td>
                    <td className="px-2 py-1.5 text-gray-400">{row.scope}</td>
                    <td className="px-2 py-1.5 text-gray-400">{row.message}</td>
                    <td className="px-2 py-1.5"><StateChip tone={row.state === "inherits" ? "neutral" : "on"}>{row.state}</StateChip></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
              A more specific level wins, and every row says what it is inheriting <em>from</em>. On a message with an
              override at level 3, the person editing at level 2 needs to know their change will reach four clients rather
              than one.
            </p>
          </div>
        </section>

        {confirmRow ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Restore v${confirmRow.version}`}>
            <div className="card w-full max-w-lg">
              <h3 className="text-sm font-semibold text-white">Restore v{confirmRow.version}{confirmRow.version === 0 ? " — the code's own version" : ""}?</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                This writes a new version whose body is v{confirmRow.version}&apos;s. Nothing is deleted, so the version
                you are on now stays in the list.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!props.canManage || props.busy}
                  onClick={() => { props.onRestore(confirmRow.version); setConfirm(null); }}
                >
                  Restore
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="card space-y-3" onSubmit={(event) => { event.preventDefault(); props.onReset(); }}>
        <h3 className="text-lg font-semibold text-white">Version history — {props.messageKey}</h3>
        <p className="text-sm text-gray-400">
          {props.versionsReading
            ? "Reading the versions…"
            : props.versions.length > 0
              ? `${plural(props.versions.length, "saved version")} from the API, newest first.`
              : "No version has ever been saved. v0 is the body the code writes today, and it is kept as the default forever."}
        </p>
        {props.versionsFailure ? <UnavailablePanel message={props.versionsFailure} onRetry={props.onRetryVersions} /> : null}
      </form>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-surface-border">
              <th scope="col" className="px-3 py-2 text-left font-medium">Version</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">What changed</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Who · when</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Plain text</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">State</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.version} className="border-b border-surface-border/60 align-top last:border-b-0">
                <td className="px-3 py-2"><MonoTm>v{row.version}</MonoTm></td>
                <td className="max-w-[28rem] px-3 py-2">
                  <span className="block font-medium text-gray-200">{row.title}</span>
                  <span className="mt-0.5 block text-[11px] text-gray-500">{row.detail}</span>
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {row.who}
                  {row.when ? <span className="mt-0.5 block text-[11px]">{new Date(row.when).toLocaleString()}</span> : null}
                </td>
                <td className="px-3 py-2 text-gray-400">{row.text ? "overridden" : "derived"}</td>
                <td className="px-3 py-2"><StateChip tone={row.version === 0 ? "neutral" : "on"}>{row.version === 0 ? "default" : `v${row.version}`}</StateChip></td>
                <td className="whitespace-nowrap px-3 py-2">
                  <button
                    type="button"
                    className="text-xs text-cyber-400 hover:underline"
                    onClick={() => setConfirm(row.version)}
                    disabled={!props.canManage && row.version !== 0}
                  >
                    {row.version === 0 ? "Compare with default" : "Restore…"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">The difference from the default</h3>
        <DefaultDifference messageKey={props.messageKey} blocks={props.blocks} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-secondary" disabled={!props.canManage || props.busy}>
            <RotateCcw size={13} /> Reset to default
          </button>
          <span className="text-xs text-gray-500">
            The default is the code&apos;s own version, preserved forever — so the way back always returns to a body that
            exists in the repository rather than to an earlier draft somebody has forgotten.
          </span>
        </div>
      </div>

      <div className="card overflow-x-auto !p-0">
        <div className="border-b border-surface-border px-3.5 py-2.5">
          <h3 className="text-sm font-semibold text-white">Overrides</h3>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-surface-border">
              <th scope="col" className="px-3 py-2 text-left font-medium">Level</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Scope</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Message</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {props.overrides.map((row) => (
              <tr key={row.level} className="border-b border-surface-border/60 last:border-b-0">
                <td className="px-3 py-2 text-gray-200">{row.level}</td>
                <td className="px-3 py-2 text-gray-400">{row.scope}</td>
                <td className="px-3 py-2 text-gray-400">{row.message}</td>
                <td className="px-3 py-2">{row.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Restore v${confirmRow.version}`}>
          <div className="card w-full max-w-lg">
            <h3 className="text-sm font-semibold text-white">Restore v{confirmRow.version}?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
              This writes a new version whose body is v{confirmRow.version}&apos;s. Nothing is deleted.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!props.canManage || props.busy}
                onClick={() => { props.onRestore(confirmRow.version); setConfirm(null); }}
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
