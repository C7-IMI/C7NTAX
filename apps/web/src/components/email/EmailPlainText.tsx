/**
 * The plain-text part — a first-class pane, not a footnote.
 *
 * The owner's words: *"some mail systems strip the HTML out of it, so I still want the email to be
 * readable."* So the product sends every message as `multipart/alternative` and the send always
 * supplies the text part; the text is **derived from the same blocks** the HTML is, so the two cannot
 * carry different facts; the derivation is always shown; and somebody may correct it, in which case the
 * message is marked *plain text overridden* and the pane warns when the two parts disagree about a
 * figure, a URL or an amount.
 *
 * The two arrangements differ, as they must:
 *
 *  · **Modern** shows the derived text as the pane's subject — a monospace block with the two chips
 *    above it (*derived from the blocks* / *overridden*) and one button to drop an override. The
 *    override is the exception, so the derived text is what the pane is about.
 *  · **Classic** is a labelled textarea with a <em>Use the derived text</em> button beneath it, because
 *    the classic screen edits a field and shows the derived value in the field: the "it is derived"
 *    fact is written under the label rather than drawn as a state chip.
 */
import { useState } from "react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { Band, StateChip, plural } from "./emailChrome";
import { compareTextFacts } from "./emailBlocks";

export interface EmailPlainTextProps {
  /** The text part derived from the blocks — always present, whatever anybody has edited. */
  derived: string;
  /** Somebody's own text part, or `null` while the derived one is what is sent. */
  edited: string | null;
  /** Omitted by the read-only uses (the simulation window), where there is nothing to correct. */
  onEdit?: (text: string | null) => void;
  /**
   * Show the message's text part without offering to change it.
   *
   * The pane is reused rather than restated wherever the text part is *shown* rather than edited — the
   * simulation window, and the fallback overlay beside it — so those surfaces cannot describe the text
   * part differently from the screen that writes it. Read-only also means the edit affordances are not
   * drawn: a control that cannot act is worse than no control.
   */
  readOnly?: boolean;
  /** The HTML the two parts are compared against, when the renderer has answered. */
  html?: string;
  /** True when the derivation came from the code's blocks rather than from the API's answer. */
  derivedLocally?: boolean;
  className?: string;
}

function DifferenceWarning({ html, text }: { html: string; text: string }) {
  const difference = compareTextFacts(html, text);
  if (difference.missingFromText.length === 0 && difference.extraInText.length === 0) return null;
  return (
    <Band tone="warn" title="The two parts do not carry the same facts">
      {difference.missingFromText.length > 0 && (
        <p>
          In the HTML and not in the text: <code className="font-mono text-gray-300">{difference.missingFromText.join(", ")}</code>.
        </p>
      )}
      {difference.extraInText.length > 0 && (
        <p>
          In the text and not in the HTML: <code className="font-mono text-gray-300">{difference.extraInText.join(", ")}</code>.
        </p>
      )}
      <p className="mt-1">
        A message read in a client that strips HTML has to be the same message, so one of the two is wrong
        rather than merely different.
      </p>
    </Band>
  );
}

export function EmailPlainText({ derived, edited, onEdit, readOnly = false, html, derivedLocally = false, className = "" }: EmailPlainTextProps) {
  const modern = useModernInterface();
  const [draft, setDraft] = useState(edited ?? "");
  const shown = edited ?? derived;
  const overridden = edited !== null;

  if (modern) {
    return (
      <section className={`card ${className}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Plain text — the other half of the message</h3>
          <span className="flex flex-wrap items-center gap-1.5">
            {overridden ? (
              <StateChip tone="warn">plain text overridden</StateChip>
            ) : (
              <StateChip tone="good">derived from the blocks</StateChip>
            )}
            {derivedLocally ? <StateChip tone="neutral">derived here, not by the API</StateChip> : null}
            <StateChip tone="neutral">{plural(shown.split("\n").length, "line")}</StateChip>
          </span>
        </div>

        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
          Every message is sent with both parts, so a client that strips HTML still gets a readable one. A
          button becomes <code className="font-mono text-gray-400">Label: https://…</code> — the URL in full,
          never hidden behind the link text — a fact pair becomes <code className="font-mono text-gray-400">Label: value</code>,
          and a quote is prefixed <code className="font-mono text-gray-400">&gt;</code>.
        </p>

        <div className="mt-2 space-y-2">
          <pre className="max-h-96 overflow-auto rounded-lg border border-surface-border bg-surface-light p-3 font-mono text-[11.5px] leading-relaxed text-gray-300 whitespace-pre-wrap">
            {shown}
          </pre>
          {overridden && !readOnly && (
            <div className="space-y-2">
              <textarea
                className="input-field h-32 w-full font-mono text-[11.5px]"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  onEdit?.(event.target.value);
                }}
                aria-label="Edited plain-text part"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary" onClick={() => { onEdit?.(null); setDraft(""); }}>
                  Use the derived text
                </button>
                <span className="text-[11px] text-gray-500">Restores the derivation above and clears the override.</span>
              </div>
            </div>
          )}
          {!overridden && !readOnly && (
            <button
              type="button"
              className="text-xs text-cyber-400 hover:underline"
              onClick={() => { setDraft(derived); onEdit?.(derived); }}
            >
              Edit the text part instead
            </button>
          )}
          {html && overridden ? <DifferenceWarning html={html} text={shown} /> : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`card space-y-3 ${className}`}>
      <div>
        <h3 className="text-lg font-semibold text-white">Plain text</h3>
        <p className="mt-0.5 text-sm text-gray-400">
          Derived from the blocks and sent as the alternative part on every message. A button becomes{" "}
          <code className="font-mono text-gray-300">Label: https://…</code> with the URL in full; a quote is
          prefixed <code className="font-mono text-gray-300">&gt;</code>; an attachment is named.
        </p>
      </div>

      <label className="block text-xs text-gray-400">
        Text part {overridden ? "(edited — this is what will be sent)" : "(derived from the blocks)"}
        <textarea
          className="input-field mt-1 h-64 w-full font-mono text-[11.5px]"
          value={overridden ? draft : derived}
          readOnly={readOnly || !overridden}
          onChange={(event) => {
            if (readOnly) return;
            setDraft(event.target.value);
            onEdit?.(event.target.value);
          }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && (
          <button type="button" className="btn-secondary" disabled={!overridden} onClick={() => { onEdit?.(null); setDraft(""); }}>
            Use the derived text
          </button>
        )}
        {overridden ? (
          <span className="chip chip--warn">plain text overridden</span>
        ) : (
          <span className="text-xs text-gray-500">
            {derivedLocally
              ? "Derived here from the blocks; the API's own derivation could not be read."
              : "Derived from the blocks — the setting that cannot drift."}
          </span>
        )}
      </div>

      {html && overridden ? <DifferenceWarning html={html} text={shown} /> : null}
    </section>
  );
}
