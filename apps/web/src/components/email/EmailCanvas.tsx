/**
 * The canvas: a message drawn from its blocks, at the width it is actually mailed at.
 *
 * This is the report designer's middle pane, over a message instead of a page, and it is deliberately
 * the **sanitiser's** canvas — the paragraphs are passed through `inspectPastedHtml()` before they are
 * shown, a field is drawn as the value it resolves to for the record being previewed, and a
 * conditional is a rail around the blocks it guards. Three things the mockup insists must be visible
 * rather than described live here: a field being inserted, a conditional block, and a pasted element
 * the mail sanitiser would strip.
 *
 * The classic interface has no canvas. Its editor is a form — an ordered list of blocks with
 * Add/Move/Remove and a labelled property grid — because that is what a classic screen is, and
 * drawing this beside it would make one of the two designs redundant.
 */
import type { EmailBlock } from "@C7NTAX/shared";
import { fieldValue } from "./emailRecords";
import { inspectPastedHtml, describeRemoval } from "./emailStrip";
import { blockKindLabel, conditionLabel, tokensInBlock } from "./emailBlocks";

function FieldChip({ token, recordId }: { token: string; recordId: string | null }) {
  const { value, from } = fieldValue(token, recordId);
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-cyber-500/40 bg-cyber-600/15 px-2 py-0.5 font-mono text-[11px] text-cyber-300">
      {token}
      <em className="not-italic text-gray-400">
        {from === "empty" ? "→ (no such field)" : from === "record" ? `→ ${value}` : `→ ${value} (sample)`}
      </em>
    </span>
  );
}

/** A paragraph's HTML with its fields drawn as chips and its stripped elements reported. */
function PastedHtml({ html, recordId }: { html: string; recordId: string | null }) {
  const inspection = inspectPastedHtml(html);
  const parts = inspection.html.split(/(\{\{\s*[a-zA-Z0-9_.]+\s*\}\})/g).filter((part) => part !== "");
  return (
    <>
      <div className="text-sm leading-relaxed text-gray-300 [&_a]:text-cyber-400 [&_a]:underline [&_strong]:text-white [&_em]:text-gray-200 [&_ul]:list-disc [&_ul]:pl-5">
        {parts.map((part, index) => {
          const field = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/.exec(part);
          if (field) return <FieldChip key={index} token={field[1] ?? ""} recordId={recordId} />;
          return <span key={index} dangerouslySetInnerHTML={{ __html: part }} />;
        })}
      </div>
      {inspection.removals.length > 0 && (
        <div className="mt-2 rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2">
          <p className="text-[11px] font-semibold text-alert-amber">
            Stripped at editing time, not after sending
          </p>
          <ul className="mt-1 space-y-0.5">
            {inspection.removals.map((removal, index) => (
              <li key={index} className="text-[11px] text-gray-300">{describeRemoval(removal)}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function BlockBody({ block, recordId, locked }: { block: EmailBlock; recordId: string | null; locked: boolean }) {
  const resolve = (value: string) => value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_whole, token: string) => fieldValue(token, recordId).value);
  switch (block.kind) {
    case "heading":
      return (
        <p className={block.level === 1 ? "text-base font-semibold text-white" : "text-sm font-semibold text-white"}>
          {resolve(block.text)}
        </p>
      );
    case "paragraph":
      return <PastedHtml html={block.html} recordId={recordId} />;
    case "facts":
      return (
        <div>
          {block.title ? <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{resolve(block.title)}</p> : null}
          <dl className="grid grid-cols-[104px_1fr] gap-x-4 gap-y-0.5 text-[12.5px]">
            {block.items.map((item, index) => (
              <div key={index} className="contents">
                <dt className="text-gray-500">{resolve(item.label)}</dt>
                <dd className="text-gray-300">{resolve(item.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "quote":
      return (
        <div>
          {block.title ? <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{resolve(block.title)}</p> : null}
          <div className="rounded-lg border-l-2 border-cyber-500 bg-surface-light px-3 py-2 text-[12.5px] italic leading-relaxed text-gray-300">
            {htmlToParagraph(resolve(block.html), recordId)}
          </div>
          {block.source ? <p className="mt-1 text-[11px] text-gray-500">{resolve(block.source)}</p> : null}
        </div>
      );
    case "button":
      return (
        <span className="inline-block rounded-lg bg-cyber-600 px-3.5 py-2 text-xs font-semibold text-white">
          {resolve(block.label)}
        </span>
      );
    case "table":
      return (
        <table className="w-full text-left text-[12.5px]">
          {block.title ? <caption className="mb-1 text-left text-[11px] uppercase tracking-wide text-gray-500">{resolve(block.title)}</caption> : null}
          <thead>
            <tr>{block.columns.map((column, index) => <th key={index} className="border-b border-surface-border pb-1 text-gray-500">{resolve(column)}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-surface-border/60 py-1 text-gray-300 tabular-nums">{resolve(cell)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      return (
        <div className="rounded-lg border border-dashed border-surface-border px-3 py-4 text-center">
          <p className="text-xs text-gray-400">{resolve(block.alt) || "an image with no words — it must have some"}</p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-600">{resolve(block.src).slice(0, 70)}</p>
        </div>
      );
    case "divider":
      return <hr className="border-surface-border" />;
    case "note":
      return (
        <div
          className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${
            block.tone === "warn"
              ? "border-alert-amber/40 bg-alert-amber/10 text-gray-200"
              : block.tone === "good"
                ? "border-alert-green/40 bg-alert-green/10 text-gray-200"
                : "border-surface-border bg-surface-light text-gray-300"
          }`}
        >
          {resolve(block.text)}
        </div>
      );
    case "attachment":
      return (
        <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-light px-3 py-2">
          <span className="text-xs font-medium text-gray-200">{resolve(block.name)}</span>
          {block.note ? <span className="text-[11px] text-gray-500">{resolve(block.note)}</span> : null}
        </div>
      );
    case "signature":
      return <p className="text-[12.5px] text-gray-400">The brand kit&apos;s sign-off — one place, one change.</p>;
    case "footer":
      return (
        <div className="border-t border-surface-border pt-2">
          <p className="text-[11px] text-gray-500">
            {locked
              ? "Footer — plain text only. A transactional security message must not offer to unsubscribe from itself."
              : "The footer, the legal line and the unsubscribe rule are inherited from the brand kit — a template references it, it does not restate it."}
          </p>
        </div>
      );
    default:
      return null;
  }
}

/** `{{field}}` inside a run of HTML, split so the chips are real elements rather than text. */
function htmlToParagraph(html: string, recordId: string | null) {
  const parts = html.split(/(\{\{\s*[a-zA-Z0-9_.]+\s*\}\})/g).filter((part) => part !== "");
  return parts.map((part, index) => {
    const field = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/.exec(part);
    if (field) return <FieldChip key={index} token={field[1] ?? ""} recordId={recordId} />;
    return <span key={index} dangerouslySetInnerHTML={{ __html: part }} />;
  });
}

export function EmailCanvasBlock({
  block,
  index,
  selected,
  onSelect,
  recordId,
  locked,
  required,
}: {
  block: EmailBlock;
  index: number;
  selected: boolean;
  onSelect: () => void;
  recordId: string | null;
  locked: boolean;
  required: boolean;
}) {
  const tokens = tokensInBlock(block);
  const condition = block.kind === "conditional" ? conditionLabel(block.when) : null;
  return (
    <div
      className={`rounded-xl border px-3 py-2 transition-colors ${
        selected ? "border-cyber-500 bg-cyber-600/10" : "border-transparent hover:border-surface-border"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full flex-wrap items-center gap-1.5 text-left"
      >
        <span className="font-mono text-[10px] text-gray-600">{index + 1}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{blockKindLabel(block.kind)}</span>
        {required ? <span className="chip px-1.5 text-[10px]">required</span> : null}
        {locked ? <span className="chip chip--warn px-1.5 text-[10px]">locked</span> : null}
        {condition ? <span className="chip chip--on px-1.5 text-[10px]">only when {condition}</span> : null}
      </button>

      {tokens.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {tokens.map((token) => <FieldChip key={token} token={token} recordId={recordId} />)}
        </div>
      )}

      {block.kind === "conditional" ? (
        <div className="mt-2 border-l-2 border-cyber-500/50 pl-3">
          <p className="mb-1 text-[11px] text-gray-500">
            Sent only when {condition}. When the condition is false the block is not sent <em>at all</em> — not sent
            empty — which is the difference between a message with a hole in it and a message without that paragraph in it.
          </p>
          <div className="space-y-2">
            {block.blocks.map((inner, innerIndex) => (
              <BlockBody key={innerIndex} block={inner} recordId={recordId} locked={locked} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-1.5">
          <BlockBody block={block} recordId={recordId} locked={locked} />
        </div>
      )}
    </div>
  );
}
