/**
 * The editor — a palette, a canvas and an inspector over one message.
 *
 * **Two designs, and the note says what each one does differently.**
 *
 *  · **Modern** is the mockup's three panes. The reusable pieces are on the left (the block kinds you
 *    may add, and the merge fields grouped by the record they come from, each chip showing the value it
 *    resolves to *for the record being previewed*). The canvas in the middle draws the message at the
 *    width it is mailed at, with a field drawn as a chip, a conditional drawn as a rail around the
 *    blocks it guards, and anything the mail sanitiser would strip shown stripped *now*, at editing
 *    time. The inspector on the right holds two things and keeps them apart: the selected block (its
 *    fields, its rows, its condition) and the message (subject, sender, reply-to, the recipients rule,
 *    the attachments).
 *  · **Classic** is a form. Subject, From and Reply-to are labelled fields in a grid; the blocks are an
 *    ordered list with an *Add block* select and Move/Remove buttons; the selected block's properties
 *    are a labelled grid — Text, Level, Tone, Condition — under a select; and Save and Cancel sit at
 *    the foot. The classic editor keeps every field on screen at once, which is the difference the Help
 *    walkthrough has to state, because the modern inspector reveals a block's properties beside the
 *    block rather than in a grid.
 *
 * The two share the *state*, the calls and the words — and the block-field list, which lives in
 * `emailBlockEdit.ts` so the two cannot drift apart about what a field is called.
 *
 * **The editing classes are enforced here, in the interface.** A `security` message opens with its body
 * fixed: the block list is drawn padlocked and read-only and the canvas carries a plate saying why,
 * with only the sender and the footer live. An `internal` message says the brand kit does not apply. A
 * `proposed` message is shown, labelled, and not editable at all.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import type { EmailBlock, EmailMessageKey } from "@C7NTAX/shared";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { Band, Fact, Mono, MonoTm, StateChip, UnavailablePanel, plural } from "./emailChrome";
import { EmailCanvasBlock } from "./EmailCanvas";
import { EmailContentSwitches } from "./EmailContentSwitches";
import { EmailPlainText } from "./EmailPlainText";
import {
  blockFields,
  blockRows,
  defaultBlock,
  insertBlock,
  insertToken,
  moveBlock,
  paletteKinds,
  removeBlock,
  replaceBlock,
  setBlockField,
  setBlockRows,
} from "./emailBlockEdit";
import { EMAIL_FIELD_GROUPS, fieldValue, fieldsInGroup, groupCaption } from "./emailRecords";
import { computedFields } from "./emailFieldRegistry";
import { blockIsRequired } from "./emailCodeV0";
import type { EmailMessageFact } from "./emailCatalogue";

export interface EmailEditorProps {
  messageKey: EmailMessageKey;
  fact: EmailMessageFact | undefined;
  subject: string;
  onSubject: (value: string) => void;
  blocks: EmailBlock[];
  onBlocks: (blocks: EmailBlock[]) => void;
  text: string | null;
  onText: (text: string | null) => void;
  /** The text part derived from the blocks — always present, whoever has edited what. */
  derivedText: string;
  recordId: string | null;
  onOpenPreview: () => void;
  canManage: boolean;
  dirty: boolean;
  /** Whether the template came from the API or from the code's transcribed body. */
  source: "api" | "code";
  sourceFailure: string | null;
  saving: boolean;
  saveMessage: string | null;
  onSave: () => void;
  onReset: () => void;
  /** Throw away unsaved edits and re-read the stored template. */
  onDiscard: () => void;
  switches: Record<string, boolean>;
  onToggleSwitch: (id: string, on: boolean) => void;
  overrides: { level: string; scope: string; message: string; state: string }[];
}

const LOCKED_CLASSES: EmailMessageFact["editingClass"][] = ["security"];

function resolved(text: string, recordId: string | null): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_whole, token: string) => fieldValue(token, recordId).value);
}

/** A list of label/value rows. Shared by both interfaces: a list of pairs is not a layout. */
function BlockRowsEditor({
  block,
  onBlock,
  disabled,
}: {
  block: EmailBlock;
  onBlock: (next: EmailBlock) => void;
  disabled: boolean;
}) {
  const rows = blockRows(block);
  if (rows.length === 0 && block.kind !== "facts" && block.kind !== "table") return null;
  const legacy = { ...block };
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {block.kind === "facts" ? "Fact pairs" : "Lines"}
      </p>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            className="input-field flex-1"
            value={row.label}
            aria-label={`Row ${index + 1} label`}
            disabled={disabled}
            onChange={(event) => {
              const next = rows.map((entry, position) => (position === index ? { ...entry, label: event.target.value } : entry));
              onBlock(setBlockRows(legacy, next));
            }}
          />
          <input
            className="input-field flex-1"
            value={row.value}
            aria-label={`Row ${index + 1} value`}
            disabled={disabled}
            onChange={(event) => {
              const next = rows.map((entry, position) => (position === index ? { ...entry, value: event.target.value } : entry));
              onBlock(setBlockRows(legacy, next));
            }}
          />
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-alert-red"
            aria-label={`Remove row ${index + 1}`}
            disabled={disabled}
            onClick={() => onBlock(setBlockRows(legacy, rows.filter((_, position) => position !== index)))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={disabled}
        onClick={() => onBlock(setBlockRows(legacy, [...rows, { label: "New fact", value: "" }]))}
      >
        Add a row
      </button>
    </div>
  );
}

function BlockFieldsEditor({
  block,
  onBlock,
  disabled,
}: {
  block: EmailBlock;
  onBlock: (next: EmailBlock) => void;
  disabled: boolean;
}) {
  const fields = blockFields(block);
  const pasted =
    "<h5 style=\"position:absolute; top:0; left:0; font-size:22px\">Service notice</h5><script>trackOpen()</script>";
  const pasteInto = (): EmailBlock => {
    switch (block.kind) {
      case "paragraph": return { ...block, html: `${block.html}${pasted}` };
      case "quote": return { ...block, html: `${block.html}${pasted}` };
      case "heading": return { ...block, text: `${block.text}${pasted}` };
      case "note": return { ...block, text: `${block.text}${pasted}` };
      default: return block;
    }
  };
  const canPaste = block.kind === "paragraph" || block.kind === "quote" || block.kind === "heading" || block.kind === "note";
  return (
    <div className="space-y-2.5">
      {fields.map((field) => (
        <div key={field.name}>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {field.label}
            {field.control === "textarea" ? (
              <textarea
                className="input-field mt-1 h-24 w-full font-mono text-[11.5px]"
                value={field.value}
                disabled={disabled}
                onChange={(event) => onBlock(setBlockField(block, field.name, event.target.value))}
              />
            ) : field.control === "select" ? (
              <select
                className="input-field mt-1 w-full"
                value={field.value}
                disabled={disabled}
                onChange={(event) => onBlock(setBlockField(block, field.name, event.target.value))}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                className="input-field mt-1 w-full"
                value={field.value}
                disabled={disabled}
                onChange={(event) => onBlock(setBlockField(block, field.name, event.target.value))}
              />
            )}
          </label>
          {field.hint ? <p className="mt-1 text-[11px] leading-relaxed text-gray-600">{field.hint}</p> : null}
        </div>
      ))}
      <BlockRowsEditor block={block} onBlock={onBlock} disabled={disabled} />
      <p className="text-[11px] leading-relaxed text-gray-600">
        Font size and colour are not properties of a block — they come from the brand kit, so there is no field
        here that would do nothing.
      </p>
      {canPaste ? (
        <div className="border-t border-surface-border pt-2.5">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={disabled}
            onClick={() => onBlock(pasteInto())}
          >
            Put a pasted element in this block
          </button>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            Appends an <code className="font-mono">&lt;h5&gt;</code> with a fixed position and a{" "}
            <code className="font-mono">&lt;script&gt;</code>. The send path unwraps the first and drops the second with
            everything inside it, and the canvas shows both — this is the sanitiser&apos;s own decision, not a picture of
            one.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The recipient rule — read out of the code, shown so the person editing can see who will read it. */
function RecipientsRule({ fact }: { fact: EmailMessageFact | undefined }) {
  const ticketBased = fact?.key.startsWith("ticket.") ?? false;
  return (
    <div className="space-y-1">
      {ticketBased ? (
        <>
          <Fact label="To">the primary contact — the ticket&apos;s own contact, unless somebody removes them</Fact>
          <Fact label="Cc">every ticket contact whose role is <Mono>cc</Mono>, copied on all of it</Fact>
          <Fact label="Notes only">
            a contact whose role is <Mono>additional</Mono>, and only while that contact&apos;s own{" "}
            <Mono>notifyOnNote</Mono> field is on — a stored column on <Mono>ticket_contacts</Mono>, not a setting
            in a configuration section
          </Fact>
          <Fact label="Cc only">
            never sent alone: with no <Mono>To</Mono> the first copy is promoted, because a mail client needs one
          </Fact>
        </>
      ) : (
        <Fact label="Reader">{fact?.reader ?? "not stated"}</Fact>
      )}
      <p className="pt-1.5 text-[11px] leading-relaxed text-gray-500">
        Read-only here, and deliberately. Who receives a message is a fact about the ticket rather than a word in
        the template — the rule is shown so the person editing can see who will read it.
      </p>
      <p className="text-[11px] leading-relaxed text-gray-600">
        Nothing in the product honours an opt-out or records a send yet. Those are proposed, and this panel says so
        rather than implying a log that does not exist.
      </p>
    </div>
  );
}

function ClassTable({ fact }: { fact: EmailMessageFact | undefined }) {
  const rows: { label: string; message: string; mayEdit: string }[] = [
    {
      label: "Full editor",
      message: "ticket.note · ticket.activity · ticket.follow_up · invoice.send · invoice.overdue",
      mayEdit: "Everything: subject, blocks, fields, conditionals, attachments, the brand kit's inheritance.",
    },
    {
      label: "Security — body locked",
      message: "auth.mfa_code · portal.login_code · user.invite",
      mayEdit: "Sender and footer only. The body is a fixed, plain sentence plus the code or the credential.",
    },
    {
      label: "Internal — no brand kit",
      message: "ticket.reopened_internal",
      mayEdit: "Fully editable, but the brand kit is not applied: no logo, no marketing footer, no unsubscribe.",
    },
    {
      label: "Proposed — nothing calls it",
      message: "ticket.closure · invoice.send · report.scheduled · quote.send",
      mayEdit: "Shown and labelled, not editable, so nobody mistakes a well-formed preview for a delivered message.",
    },
  ];
  return (
    <div className="card !p-0">
      <div className="border-b border-surface-border px-4 py-2.5">
        <h3 className="text-sm font-semibold text-white">Which message is in which class</h3>
        <p className="text-[11px] text-gray-500">the decision, made visible</p>
      </div>
      <div className="overflow-x-auto p-3.5">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-surface-border">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Class</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">Messages</th>
              <th scope="col" className="px-2 py-1.5 text-left font-medium">What may be edited</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-surface-border/60 align-top last:border-b-0">
                <td className="whitespace-nowrap px-2 py-1.5 text-gray-200">{row.label}</td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-gray-400">{row.message}</td>
                <td className="px-2 py-1.5 text-gray-400">{row.mayEdit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fact ? (
          <p className="mt-2 text-[11px] text-gray-500">
            You are editing <MonoTm>{fact.key}</MonoTm> — {fact.name}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EmailEditor(props: EmailEditorProps) {
  const modern = useModernInterface();
  const locked = props.fact ? LOCKED_CLASSES.includes(props.fact.editingClass) : false;
  const proposed = props.fact?.editingClass === "proposed";
  const bodyLocked = locked || proposed || !props.canManage;
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"design" | "content" | "text" | "overrides">("design");
  const block = props.blocks[selected];
  /*
   * The fields the API's registry adds to the contract's 21 — the computed ones (`message.greeting`,
   * `message.clientLine`), which a template function assembles at send time and no drawing can resolve.
   * They are offered like any other field, with the API's own label and sample.
   */
  const extraFields = computedFields();

  const saveBlock = (next: EmailBlock) => props.onBlocks(replaceBlock(props.blocks, selected, next));

  const lockBand = (locked || proposed || props.fact?.editingClass === "internal") && (
    <Band
      tone={locked ? "locked" : "warn"}
      icon={locked ? <Lock size={15} className="text-cyber-400" /> : <AlertTriangle size={15} className="text-alert-amber" />}
      title={
        locked
          ? "Security-class: the sender and the footer are the only live fields"
          : proposed
            ? "Nothing calls this sender, so nothing here is editable"
            : "Internal: no brand kit applies to this message"
      }
    >
      {locked
        ? "A one-time code is read once, in a hurry, often on a poor connection, and decorating it is how a legitimate message comes to look like a phishing attempt. The block list below is drawn padlocked rather than empty, so the message you are not allowed to change is still visible."
        : proposed
          ? "The sender is written and no code path reaches it. It is drawn so somebody can see what would go out and decide whether it is right — and it cannot be saved."
          : "Read by a technician rather than a customer, so the logo, the marketing footer and the unsubscribe line are not available: an internal message is deliberately not the customer template with different words."}
    </Band>
  );

  if (!modern) {
    return (
      <ClassicEditor
        {...props}
        bodyLocked={bodyLocked}
        locked={locked}
        proposed={proposed}
        selected={selected}
        setSelected={setSelected}
        lockBand={lockBand}
      />
    );
  }

  return (
    <div className="space-y-4">
      {lockBand}

      <div className="card flex flex-wrap items-center gap-2">
        <div className="inline-flex items-stretch gap-1 rounded-xl border border-surface-border bg-surface-lighter p-1">
          {([
            ["design", "Design"],
            ["content", "What gets sent"],
            ["text", "Plain text"],
            ["overrides", "Overrides"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                view === id ? "tab-active font-semibold" : "font-medium text-gray-300 hover:bg-surface-border/70 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <StateChip tone={props.source === "api" ? "neutral" : "warn"}>
            state: {props.source === "api" ? "read from the API" : "the code's own version"}
          </StateChip>
          {props.dirty ? <StateChip tone="warn">unsaved</StateChip> : null}
          {!props.canManage ? <StateChip tone="neutral">read-only — needs email:manage</StateChip> : null}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary text-xs" onClick={props.onOpenPreview}>
            Preview against a record
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={!props.canManage || bodyLocked || !props.dirty || props.saving}
            onClick={props.onSave}
          >
            {props.saving ? "Saving…" : "Save template"}
          </button>
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        Save is blocked by a broken reference rather than by a warning — the report designer&apos;s rule, kept: a field
        that does not exist on the chosen record, a link the mail sanitiser would refuse, or a required block that has
        been removed stops the save and says which one it is.
      </p>

      {props.saveMessage ? (
        <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">
          {props.saveMessage}
        </p>
      ) : null}

      {view === "design" && (
        <>
          <ClassTable fact={props.fact} />
          <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
            {/* Palette */}
            <aside className="card space-y-3" aria-label="Blocks and fields">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">Blocks</h3>
                <span className="font-mono text-[11px] text-gray-500">{plural(paletteKinds().length, "kind")}</span>
              </div>
              {locked ? <StateChip tone="locked">body locked</StateChip> : null}
              <div className="space-y-1">
                {paletteKinds().map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    disabled={bodyLocked}
                    onClick={() => {
                      props.onBlocks(insertBlock(props.blocks, defaultBlock(entry.kind), selected + 1));
                      setSelected(selected + 1);
                    }}
                    className="w-full rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-surface-border hover:bg-surface-light disabled:opacity-50"
                  >
                    <span className="block text-xs font-medium text-gray-200">{entry.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{entry.say}</span>
                  </button>
                ))}
              </div>

              <div className="border-t border-surface-border pt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fields · grouped by source</h4>
                <div className="mt-2 space-y-2.5">
                  {EMAIL_FIELD_GROUPS.map((group) => (
                    <div key={group}>
                      <p className="text-[11px] text-gray-400">
                        {group}
                        <span className="text-gray-600"> · {groupCaption(group, props.recordId)}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {fieldsInGroup(group).map((field) => {
                          const { value, from } = fieldValue(field.token, props.recordId);
                          return (
                            <button
                              key={field.token}
                              type="button"
                              disabled={bodyLocked || !block}
                              title={`Insert ${field.token} — resolves to ${value}`}
                              onClick={() => { if (block) saveBlock(insertToken(block, field.token)); }}
                              className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg border border-cyber-500/40 bg-cyber-600/15 px-2 py-0.5 font-mono text-[11px] text-cyber-300 disabled:opacity-50"
                            >
                              <span className="shrink-0">{field.token}</span>
                              <em className="min-w-0 truncate not-italic text-gray-400" title={value}>
                                {from === "record" ? value : `${value} (sample)`}
                              </em>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {extraFields.length > 0 ? (
                    <div>
                      <p className="text-[11px] text-gray-400">
                        This message
                        <span className="text-gray-600"> · built by the sender, not from a record</span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {extraFields.map((field) => (
                          <button
                            key={field.token}
                            type="button"
                            disabled={bodyLocked || !block}
                            title={`Insert ${field.token} — ${field.label}`}
                            onClick={() => { if (block) saveBlock(insertToken(block, field.token)); }}
                            className="inline-flex max-w-full items-baseline gap-1.5 rounded-lg border border-cyber-500/40 bg-cyber-600/15 px-2 py-0.5 font-mono text-[11px] text-cyber-300 disabled:opacity-50"
                          >
                            <span className="shrink-0">{field.token}</span>
                            <em className="min-w-0 truncate not-italic text-gray-400" title={field.sample}>
                              {field.sample || "blank on this record"} (sample)
                            </em>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
                  A field list without values is a list of names, and a name is what makes{" "}
                  <Mono>{"{{ticket.status}}"}</Mono> look fine while it resolves to a blank. Nothing enters the
                  document except through a chip, because a field typed by hand is a field nothing can validate.
                </p>
              </div>
            </aside>

            {/* Canvas */}
            <div className="card !p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-surface-border px-3.5 py-2">
                <span className="text-xs font-semibold text-white">Canvas — {props.messageKey}</span>
                <StateChip tone="neutral">{plural(props.blocks.length, "block")}</StateChip>
                <StateChip tone={props.blocks.some((entry) => entry.kind === "conditional") ? "on" : "neutral"}>
                  {plural(props.blocks.filter((entry) => entry.kind === "conditional").length, "conditional")}
                </StateChip>
                <span className="ml-auto text-[11px] text-gray-500">520 px · the width the message is mailed at</span>
              </div>
              <div className="bg-surface-light/40 p-3">
                <div className="mx-auto w-full max-w-[520px] rounded-xl border border-surface-border bg-surface p-3">
                  <div className="mb-2 flex items-center justify-between border-b border-surface-border pb-2">
                    <span className="text-sm font-bold tracking-tight text-cyber-400">C7NTAX</span>
                    <span className="text-[11px] text-gray-500">{props.fact?.audience === "internal" ? "internal" : "Cyber 7 Group"}</span>
                  </div>
                  <p className="mb-2 font-mono text-[11px] text-gray-500">{resolved(props.subject, props.recordId) || "no subject"}</p>
                  {locked && (
                    <p className="mb-2 rounded-lg border border-cyber-500/40 bg-cyber-600/10 px-3 py-2 text-[11px] text-cyber-200">
                      Body fixed for this message. Only the sender and the footer may change.
                    </p>
                  )}
                  <div className="space-y-1">
                    {props.blocks.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-gray-500">
                        Nothing written yet. This key is reserved — no code path sends it.
                      </p>
                    ) : (
                      props.blocks.map((entry, index) => (
                        <EmailCanvasBlock
                          key={index}
                          block={entry}
                          index={index}
                          selected={index === selected}
                          onSelect={() => setSelected(index)}
                          recordId={props.recordId}
                          locked={locked}
                          required={blockIsRequired(props.messageKey, entry)}
                        />
                      ))
                    )}
                  </div>
                  <p className="mt-2 border-t border-surface-border pt-2 text-[11px] text-gray-500">
                    {props.fact?.audience === "internal"
                      ? "No brand kit: no logo, no marketing footer, no unsubscribe."
                      : "The footer, the legal line and the unsubscribe rule are inherited from the brand kit — a template references it, it does not restate it."}
                  </p>
                </div>
              </div>
            </div>

            {/* Inspector */}
            <aside className="card space-y-4" aria-label="Inspector">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Selected block{block ? ` — ${block.kind}` : ""}
                </h3>
                {block ? (
                  <div className="mt-2">
                    <BlockFieldsEditor block={block} onBlock={saveBlock} disabled={bodyLocked} />
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button type="button" className="btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={bodyLocked || selected === 0} onClick={() => { props.onBlocks(moveBlock(props.blocks, selected, -1)); setSelected(selected - 1); }}>
                        <ArrowUp size={12} />
                      </button>
                      <button type="button" className="btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={bodyLocked || selected >= props.blocks.length - 1} onClick={() => { props.onBlocks(moveBlock(props.blocks, selected, 1)); setSelected(selected + 1); }}>
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-danger text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        title={blockIsRequired(props.messageKey, block) ? "A required block: its wording is editable, its presence is not." : "Remove this block"}
                        onClick={() => { props.onBlocks(removeBlock(props.blocks, selected)); setSelected(0); }}
                      >
                        <Trash2 size={12} />
                      </button>
                      {blockIsRequired(props.messageKey, block) ? <StateChip tone="locked">required</StateChip> : null}
                    </div>
                    {blockIsRequired(props.messageKey, block) ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                        This sentence does something rather than says something — it is a mechanism, so its presence is
                        not optional. Its wording is yours to change.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-gray-500">Select a block on the canvas.</p>
                )}
              </div>

              <div className="border-t border-surface-border pt-3">
                <h3 className="text-sm font-semibold text-white">The message — {props.messageKey}</h3>
                <div className="mt-2 space-y-2">
                  <label className="block text-[11px] uppercase tracking-wide text-gray-500">
                    Subject
                    <input
                      className="input-field mt-1 w-full font-mono text-[11.5px]"
                      value={props.subject}
                      disabled={locked || proposed || !props.canManage}
                      onChange={(event) => props.onSubject(event.target.value)}
                    />
                  </label>
                  {locked ? (
                    <p className="text-[11px] leading-relaxed text-alert-amber">
                      Fixed. &ldquo;{props.subject}&rdquo; is what somebody looks for in a crowded inbox, and it is the
                      phrase support tells them to search for.
                    </p>
                  ) : null}
                  <Fact label="From">
                    <Mono>noreply@cyber7group.com</Mono> — the built-in default, <Mono>SMTP_FROM</Mono>
                  </Fact>
                  <Fact label="Reply-to">blank — a reply becomes a ticket comment</Fact>
                </div>
              </div>

              <div className="border-t border-surface-border pt-3">
                <h3 className="text-sm font-semibold text-white">The recipients rule</h3>
                <div className="mt-2">
                  <RecipientsRule fact={props.fact} />
                </div>
              </div>

              <div className="border-t border-surface-border pt-3">
                <h3 className="text-sm font-semibold text-white">Attachments this message may carry</h3>
                <p className="mt-2 text-[11.5px] leading-relaxed text-gray-400">
                  {props.fact?.attachments ?? "None: this message carries nothing that has to load."}
                </p>
              </div>
            </aside>
          </div>
        </>
      )}

      {view === "content" && (
        <EmailContentSwitches switches={props.switches} onToggle={props.onToggleSwitch} />
      )}

      {view === "text" && (
        <EmailPlainText
          derived={props.derivedText}
          edited={props.text}
          onEdit={props.onText}
        />
      )}

      {view === "overrides" && (
        <div className="card !p-0">
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
              A more specific level wins, and every row says what it is inheriting <em>from</em> rather than only that it
              inherits. The board and client names are this instance&apos;s own. Nothing in the product holds a client
              override today, so every row below instance reads <em>inherits</em> — which is the honest answer rather
              than an illustration.
            </p>
          </div>
        </div>
      )}

      {props.sourceFailure ? (
        <UnavailablePanel
          message={props.sourceFailure}
          what={
            <>
              The blocks above are the code&apos;s own body, transcribed into the block vocabulary and labelled as the
              code&apos;s version rather than as a saved template. Nothing you can read here was written by the API.
            </>
          }
        />
      ) : null}
    </div>
  );
}

function ClassicEditor({
  bodyLocked,
  locked,
  proposed,
  selected,
  setSelected,
  lockBand,
  ...props
}: EmailEditorProps & {
  bodyLocked: boolean;
  locked: boolean;
  proposed: boolean;
  selected: number;
  setSelected: (index: number) => void;
  lockBand: ReactNode;
}) {
  const [addKind, setAddKind] = useState<EmailBlock["kind"]>("paragraph");
  const block = props.blocks[selected];
  const extraFields = computedFields();

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
      {lockBand}

      <div className="card space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Edit template — {props.messageKey}</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            {props.fact?.name} · {props.fact?.attachments ? `${props.fact.attachments}` : "no attachments"} ·{" "}
            {props.source === "api" ? "read from the API" : "the code's own version, not a saved template"}
          </p>
        </div>

        {locked ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">
            A security message — the body is fixed, and only the sender and the footer may change.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-gray-400">
            Subject
            <input
              className="input-field mt-1 w-full font-mono text-[11.5px]"
              value={props.subject}
              readOnly={locked || proposed || !props.canManage}
              onChange={(event) => props.onSubject(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-gray-600">Fields go in as {"{{ticket.number}}"}.</span>
          </label>
          <label className="text-xs text-gray-400">
            From
            <input className="input-field mt-1 w-full" value="noreply@cyber7group.com" readOnly />
            <span className="mt-1 block text-[11px] text-gray-600">The built-in default, <Mono>SMTP_FROM</Mono>.</span>
          </label>
          <label className="text-xs text-gray-400 sm:col-span-2">
            Reply-to
            <input className="input-field mt-1 w-full" value="" readOnly placeholder="blank" />
            <span className="mt-1 block text-[11px] text-gray-600">
              Blank by default — a reply to this message becomes a ticket comment.
            </span>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-xs text-gray-400">
            State
            <p className="input-field mt-1 w-full text-gray-300">
              {props.source === "api" ? "read from the API" : "default (as written in EmailService.ts)"}
            </p>
          </div>
          <div className="text-xs text-gray-400">
            Plain text
            <p className="input-field mt-1 w-full text-gray-300">
              {props.text === null ? "derived from the blocks" : "overridden — somebody edited it"}
            </p>
          </div>
        </div>
      </div>

      {/*
        * A disabled `<fieldset>` rather than a scattered set of `disabled` attributes: it is the classic
        * screen's own way of saying "this part of the form is not yours to change", it disables every control
        * inside it at once, and it cannot be half-applied the way nineteen flags can. It is what the mockup
        * asks for — "the classic locked message is a disabled fieldset".
        */}
      <fieldset disabled={bodyLocked} className="min-w-0 space-y-4">
        <legend className="sr-only">Blocks and the selected block&apos;s properties</legend>
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-white">Blocks</h3>
        <ol className="space-y-1">
          {props.blocks.map((entry, index) => (
            <li key={index}>
              <div
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                  index === selected ? "border-cyber-500 bg-cyber-600/10" : "border-surface-border"
                }`}
              >
                <button
                  type="button"
                  className="text-left text-xs font-medium text-gray-200 hover:text-cyber-300"
                  onClick={() => setSelected(index)}
                >
                  {index + 1}. {entry.kind}
                </button>
                {blockIsRequired(props.messageKey, entry) ? <StateChip tone="locked">required</StateChip> : null}
                {entry.kind === "conditional" ? <StateChip tone="on">conditional</StateChip> : null}
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" className="btn-secondary !px-2 !py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={bodyLocked || index === 0} onClick={() => { props.onBlocks(moveBlock(props.blocks, index, -1)); setSelected(Math.max(0, index - 1)); }}>
                    Move up
                  </button>
                  <button type="button" className="btn-secondary !px-2 !py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={bodyLocked || index >= props.blocks.length - 1} onClick={() => { props.onBlocks(moveBlock(props.blocks, index, 1)); setSelected(Math.min(props.blocks.length - 1, index + 1)); }}>
                    Move down
                  </button>
                  <button type="button" className="btn-danger !px-2 !py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={bodyLocked || blockIsRequired(props.messageKey, entry)} onClick={() => { props.onBlocks(removeBlock(props.blocks, index)); setSelected(0); }}>
                    Remove
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        {props.blocks.length === 0 ? (
          <p className="text-xs text-gray-500">No blocks. This key is reserved — no code path sends it.</p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-400">
            Add block
            <select className="input-field mt-1 w-56" value={addKind} onChange={(event) => setAddKind(event.target.value as EmailBlock["kind"])}>
              {paletteKinds().map((entry) => (
                <option key={entry.kind} value={entry.kind}>{entry.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={bodyLocked}
            onClick={() => {
              props.onBlocks(insertBlock(props.blocks, defaultBlock(addKind), selected + 1));
              setSelected(selected + 1);
            }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {block ? (
        <div className="card space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Selected block — {block.kind}</h3>
            <p className="mt-0.5 text-[11.5px] text-gray-500">
              A labelled grid, where the modern editor hangs the same fields beside the block on the canvas.
            </p>
          </div>
          <BlockFieldsEditor block={block} onBlock={(next) => props.onBlocks(replaceBlock(props.blocks, selected, next))} disabled={bodyLocked} />
          <div>
            <label className="text-xs text-gray-400">
              Insert a field
              <select
                className="input-field mt-1 w-full font-mono text-[11.5px]"
                value=""
                disabled={bodyLocked}
                onChange={(event) => {
                  if (!event.target.value) return;
                  props.onBlocks(replaceBlock(props.blocks, selected, insertToken(block, event.target.value)));
                }}
              >
                <option value="">Choose a field…</option>
                {EMAIL_FIELD_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {fieldsInGroup(group).map((field) => (
                      <option key={field.token} value={field.token}>
                        {field.label} ({field.token}) — {fieldValue(field.token, props.recordId).value}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {extraFields.length > 0 ? (
                  <optgroup label="This message - built by the sender">
                    {extraFields.map((field) => (
                      <option key={field.token} value={field.token}>
                        {field.label} ({field.token}) — {field.sample} (sample)
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
          </div>
        </div>
      ) : null}
      </fieldset>

      <EmailContentSwitches switches={props.switches} onToggle={props.onToggleSwitch} />

      <EmailPlainText derived={props.derivedText} edited={props.text} onEdit={props.onText} />

      {props.saveMessage ? (
        <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">
          {props.saveMessage}
        </p>
      ) : null}

      <div className="card flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!props.canManage || bodyLocked || props.saving}>
          {props.saving ? "Saving…" : "Save template"}
        </button>
        <button type="button" className="btn-secondary" onClick={props.onReset} disabled={!props.canManage}>
          Reset to default
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={props.onDiscard}
        >
          Cancel
        </button>
        <span className="text-xs text-gray-500">
          {props.dirty ? "Unsaved changes." : "Nothing to save."} Cancel re-reads the stored template.
        </span>
      </div>
    </form>
  );
}
