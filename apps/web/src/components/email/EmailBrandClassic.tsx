/**
 * The brand, identity, matrix, rules, recipient and override screens in the **classic** interface.
 *
 * This is a form, and the difference from the modern arrangement is deliberate rather than cosmetic:
 *
 * | | modern (`EmailBrandModern`) | classic (this file) |
 * |---|---|---|
 * | Choosing a subject | a rail of six entries you press, each with a count and a line | one labelled `<select>` and a table of contents |
 * | The matrix | rows-as-cards, filtered by chips, locked rows marked with a lock chip | a six-column sortable, paged table with a disabled checkbox in "Can be turned off" |
 * | The kit | the kit applied to a real message beside the fields | labelled fields in a grid, with the applied message behind a **Preview** button and a dialog |
 * | The rules | a status track you step along, then the numbers | a labelled grid of numbers and clock fields, then the exempt messages as a read-only list |
 * | The identity | rows-as-cards with the sender sentence inside them | a table with an Action column, plus a labelled relay block and a Domains table |
 * | Overrides | the chain as a track, then a form panel | a client-major table whose per-client cell opens the client record |
 * | A write | a sheet with a sentence beside each control and one Save | a dialog with a heading, labelled fields and Save/Cancel |
 *
 * Everything else — the state, the API calls and the words — is shared with the modern arrangement
 * through `pages/EmailBrand.tsx`, `brandScreen.ts`, `brandView.ts` and `emailFacts.ts`.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Lock, Mail, Pencil, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { ListFooter, PageHeader, StatCard } from "../ui";
import { Band, Fact, MessageStatusChip, Mono, MonoTm, StateChip, UnavailablePanel } from "./emailChrome";
import { EmailSampleMessage, EmailSecuritySample } from "./EmailSample";
import { FieldsEditor, type EditorSurface } from "./EmailEditors";
import {
  BRAND_SUBJECTS, IDENTITY_FIELDS, KIT_FIELDS, RULE_FIELDS, unsetNote,
  type EmailBrandProps, type FieldCtx,
} from "./brandScreen";
import { SOURCE_SENTENCE } from "./brandView";
import { groupsIn, matrixCountSentence, matrixSourceSentence, type MatrixRow } from "./matrixView";
import {
  BATCH_EXEMPT, BOUNCE_RULES, BOUNCE_TODAY, BRAND_ASSET_NOTES, ENFORCEMENT, IDENTITY_BOUNDARY,
  NO_SETTINGS_ENDPOINT, NOTE_SWITCH_CORRECTION, OPT_OUT, OVERRIDE_CHAIN, OVERRIDE_PATTERN_QUOTE,
  PLAIN_BY_RULE_KEYS, PLAIN_TEXT_RULE, PROPOSED_CONFIG_SECTION, PROPOSED_SECURITY_NOTICES,
  RECIPIENT_ROLES, REPLY_INTO_TICKET, SENDING_IDENTITY_FACTS, UNSUBSCRIBE_RULE, WORDMARK_FALLBACK_RULE,
} from "./emailFacts";

export function EmailBrandClassic(props: EmailBrandProps) {
  const {
    messages, relay, clientsRead, boardsRead,
    brandView: view, delivery, matrix, overrides, canManage, subject, onSubject,
    saving, writeError, onSaveBrand,
  } = props;

  const ctx: FieldCtx = { brand: view, canManage };
  const fieldsFor = (which: EditorSurface) => (which === "identity" ? IDENTITY_FIELDS : KIT_FIELDS);
  const surface: EditorSurface = subject === "senders" ? "identity" : "kit";

  const [editor, setEditor] = useState<EditorSurface | null>(null);
  const [preview, setPreview] = useState(false);
  const [group, setGroup] = useState<string>("all");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "trigger", dir: "asc" });
  const [page, setPage] = useState(1);
  const perPage = 10;

  const filtered = matrix.rows.filter((row) => group === "all" || row.group === group);
  const sorted = useMemo(() => {
    const value = (row: MatrixRow) =>
      sort.key === "key" ? row.key
        : sort.key === "group" ? row.group
          : sort.key === "recipients" ? row.recipients
            : sort.key === "customer" ? (row.customerVisible ? "1" : "0")
              : sort.key === "off" ? (row.canBeTurnedOff.startsWith("Yes") ? "0" : "1")
                : sort.key === "template" ? row.template
                  : row.trigger;
    const copy = [...filtered];
    copy.sort((a, b) => value(a).localeCompare(value(b)));
    return sort.dir === "asc" ? copy : copy.reverse();
  }, [filtered, sort.key, sort.dir]);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, pages);
  const shown = sorted.slice((current - 1) * perPage, current * perPage);

  const sortHeader = (key: string, label: string): ReactNode => (
    <th className="px-2 py-2 text-left">
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold text-gray-300 hover:text-white"
        onClick={() => setSort((now) => ({ key, dir: now.key === key && now.dir === "asc" ? "desc" : "asc" }))}
      >
        {label}
        {sort.key === key ? <span className="text-cyber-300">{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );

  const subjectSpec = BRAND_SUBJECTS.find((entry) => entry.id === subject) ?? BRAND_SUBJECTS[0]!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Brand & Sending"
        subtitle="What every message inherits — the logo, the colours, the footer and the address it is sent from."
        actions={
          <>
            <Link to="/admin/email" className="btn-secondary text-sm">Open the Studio</Link>
            <Link to="/admin/email/log" className="btn-secondary text-sm">Delivery log</Link>
          </>
        }
      />

      {/* Choosing a screen is a field, not a rail you press. */}
      <div className="card space-y-2">
        <label className="block text-sm font-semibold text-white" htmlFor="email-brand-screen">These six screens</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-start">
          <select
            id="email-brand-screen"
            className="input-field"
            value={subject}
            onChange={(event) => { onSubject(event.target.value as typeof subject); setEditor(null); setPage(1); }}
          >
            {BRAND_SUBJECTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <p className="text-xs text-gray-500">{subjectSpec.blurb}</p>
        </div>
        <table className="ptable w-full text-xs">
          <caption className="sr-only">The six screens of the Email Studio's brand and delivery page</caption>
          <thead>
            <tr><th className="px-2 py-1 text-left">Screen</th><th className="px-2 py-1 text-left">What it answers</th></tr>
          </thead>
          <tbody>
            {BRAND_SUBJECTS.map((entry) => (
              <tr key={entry.id} className={entry.id === subject ? "bg-surface-lighter" : undefined}>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    className={`text-left ${entry.id === subject ? "font-semibold text-white" : "text-cyber-400 hover:text-cyber-300"}`}
                    onClick={() => { onSubject(entry.id); setEditor(null); setPage(1); }}
                  >
                    {entry.label}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-gray-400">{entry.blurb}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        <PageHeader variant="section" title={subjectSpec.label} subtitle={subjectSpec.blurb} />

        {subject === "kit" ? (
          <KitForm
            ctx={ctx}
            view={view}
            canManage={canManage}
            blockedReason={fieldsFor("kit")[0]!.readonly(ctx)}
            writeError={writeError}
            onEdit={() => setEditor("kit")}
            onPreview={() => setPreview(true)}
          />
        ) : null}

        {subject === "senders" ? (
          <IdentityForm
            props={props}
            canManage={canManage}
            blockedReason={fieldsFor("identity")[0]!.readonly(ctx)}
            onEdit={() => setEditor("identity")}
          />
        ) : null}

        {subject === "matrix" ? (
          <MatrixTable
            sortHeader={sortHeader}
            shown={shown}
            pages={pages}
            page={current}
            onPage={setPage}
            total={filtered.length}
            group={group}
            onGroup={(next) => { setGroup(next); setPage(1); }}
            groups={groupsIn(matrix.rows)}
            sourceSentence={matrixSourceSentence(matrix, messages.message)}
            countSentence={matrixCountSentence(matrix)}
            messagesRead={messages}
            canManage={canManage}
          />
        ) : null}

        {subject === "rules" ? <RulesForm delivery={delivery} canManage={canManage} /> : null}

        {subject === "recipients" ? <RecipientsTables /> : null}

        {subject === "overrides" ? (
          <OverridesTable overrides={overrides} clientsRead={clientsRead} boardsRead={boardsRead} canManage={canManage} />
        ) : null}
      </div>

      {editor ? (
        <FieldsEditor
          key={`${editor}:${view.source}`}
          surface={editor}
          ctx={ctx}
          blockedReason={fieldsFor(editor)[0]!.readonly(ctx)}
          saving={saving}
          error={writeError}
          onSave={(patch) => { onSaveBrand(patch); setEditor(null); }}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {/* The applied message, as a dialog rather than beside the fields: the classic screen is a form. */}
      {preview ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[6vh]" onClick={() => setPreview(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="The kit applied to a message"
            className="card w-full max-w-3xl space-y-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">The kit applied to a message</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  A ticket message in the shape of <Mono>ticketActivityTemplate</Mono> — both the HTML and the plain-text part,
                  because the second is what a client that strips HTML receives.
                </p>
              </div>
              <button type="button" className="btn-secondary text-sm" onClick={() => setPreview(false)}>Close</button>
            </div>
            <EmailSampleMessage brand={view} replyToSentence="the connector's mailbox, so the reply becomes a reply on the ticket" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── One: the brand kit as labelled fields ────────────────────────────────────────────────────────

function KitForm({
  ctx, view, canManage, blockedReason, writeError, onEdit, onPreview,
}: {
  ctx: FieldCtx;
  view: EmailBrandProps["brandView"];
  canManage: boolean;
  blockedReason: string | null;
  writeError: string | null;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const identity = IDENTITY_FIELDS.map((field) => ({ label: field.label, value: field.value(ctx) }));
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Shared with the PDFs — one kit, not two brands</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          One row wears this brand: <Mono>EmailBrandKit</Mono>, id <Mono>instance</Mono> — the row every send reads, and the
          same row <Mono>services/brand.ts</Mono> and <Mono>hooks/useBrandKit.ts</Mono> hand to a document. The values behind
          these fields are also the shipped defaults in <Mono>packages/shared/src/brand.ts</Mono>, which is what a document
          falls back to before anybody opens this screen. Two stylesheets that "look about the same" drift apart on the first
          rebrand; one row cannot.
        </p>
        <div>
          <Fact label="Source">{SOURCE_SENTENCE[view.source]}</Fact>
          <Fact label="Applies to">{`${KIT_FIELDS.length} fields · every message · the report PDFs and the ticket print sheet`}</Fact>
          {view.updatedByName ? (
            <Fact label="Last changed">{`${view.updatedByName}${view.updatedAt ? ` · ${new Date(view.updatedAt).toLocaleString()}` : ""}`}</Fact>
          ) : null}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">The kit</h3>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={onPreview}>Preview the message</button>
            {canManage ? (
              <button type="button" className="btn-primary text-sm" onClick={onEdit} disabled={blockedReason !== null}>
                <Pencil size={12} className="mr-1.5 inline" /> Edit the kit
              </button>
            ) : (
              <span className="text-xs text-gray-500">Read-only: changing the kit is email:manage.</span>
            )}
          </div>
        </div>

        {blockedReason && canManage ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-gray-300">{blockedReason}</p>
        ) : null}
        {writeError ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-gray-300">{writeError}</p>
        ) : null}

        <table className="ptable w-full text-xs">
          <caption className="sr-only">The brand kit, field by field</caption>
          <thead>
            <tr><th className="px-2 py-2 text-left">Field</th><th className="px-2 py-2 text-left">Value</th><th className="px-2 py-2 text-left">What it does</th></tr>
          </thead>
          <tbody>
            {KIT_FIELDS.map((field) => (
              <tr key={field.id}>
                <td className="px-2 py-2 text-gray-300">{field.label}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-gray-300">{field.value(ctx) || <span className="font-sans text-gray-500">{unsetNote(field.id)}</span>}</td>
                <td className="px-2 py-2 text-gray-500">{field.help}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
          <b className="text-gray-200">The unsubscribe rule.</b> {UNSUBSCRIBE_RULE}
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The identity the kit already carries</h3>
        <table className="ptable w-full text-xs">
          <tbody>
            {identity.map((row) => (
              <tr key={row.label}>
                <td className="px-2 py-1.5 text-gray-500">{row.label}</td>
                <td className="px-2 py-1.5 text-gray-300">{row.value || <span className="text-gray-500">unset — {view.smtpFrom} is used, and no Reply-To is sent</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500">
          One kit holds one sender identity, so "which address does this message leave from" is answered below on the Sending
          identity screen — where the twelve messages say what their own sender does today.
        </p>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The assets, and where they come from</h3>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Asset</th><th className="px-2 py-2 text-left">Value</th><th className="px-2 py-2 text-left">Source</th></tr></thead>
          <tbody>
            {BRAND_ASSET_NOTES.map((asset) => (
              <tr key={asset.asset}>
                <td className="px-2 py-2 text-gray-300">{asset.asset}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-gray-300">{asset.value}</td>
                <td className="px-2 py-2 text-gray-500">{asset.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500">{WORDMARK_FALLBACK_RULE}</p>
        <p className="text-xs text-gray-500">{PLAIN_TEXT_RULE}</p>
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-2">
          <Lock size={14} className="mt-0.5 shrink-0 text-cyber-300" />
          <div>
            <h3 className="text-sm font-semibold text-white">What the brand kit does not decorate</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-400">
              Three of the twelve are <Mono>security</Mono> class and wear no kit at all:{" "}
              {PLAIN_BY_RULE_KEYS.join(", ")}. They are read once, in a hurry, and a designed header is friction in the way of the
              number. They get the code or the credential, the expiry and the instruction, and a plain-text part: no shield, no
              wordmark, no crimson header, no footer, no unsubscribe link, no reply-to — and no batching, quiet hours or opt-out
              either, because a held code is an expired code.
            </p>
          </div>
        </div>
        <EmailSecuritySample />
      </div>
    </div>
  );
}

// ── Two: the sending identity as a table with an Action column ───────────────────────────────────

function IdentityForm({
  props, canManage, blockedReason, onEdit,
}: {
  props: EmailBrandProps;
  canManage: boolean;
  blockedReason: string | null;
  onEdit: () => void;
}) {
  const { brandView: view, matrix, relay } = props;
  const mail = relay.status === "ok" ? relay.data?.mail ?? null : null;
  const deliverable = Boolean(mail?.configured && mail?.hasCredentials && mail?.host && mail.host !== "localhost");

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">The relay this instance was started with</h3>
        {relay.status === "unavailable" ? (
          <UnavailablePanel
            message={relay.message ?? "The relay configuration could not be read."}
            onRetry={relay.reload}
            what={<>These six values come from <Mono>GET /api/system/deployment</Mono>, guarded by <Mono>Permission.SystemConfig</Mono>.</>}
          />
        ) : (
          <>
            <table className="ptable w-full text-xs">
              <caption className="sr-only">The relay as GET /api/system/deployment reports it</caption>
              <tbody>
                <tr><td className="px-2 py-1.5 text-gray-500">configured</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{String(mail?.configured)}</td></tr>
                <tr><td className="px-2 py-1.5 text-gray-500">host</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{mail?.host ?? "—"}</td></tr>
                <tr><td className="px-2 py-1.5 text-gray-500">port</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{mail?.port ?? "—"}</td></tr>
                <tr><td className="px-2 py-1.5 text-gray-500">secure</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{String(mail?.secure)}</td></tr>
                <tr><td className="px-2 py-1.5 text-gray-500">hasCredentials</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{String(mail?.hasCredentials)}</td></tr>
                <tr><td className="px-2 py-1.5 text-gray-500">from</td><td className="px-2 py-1.5 font-mono text-[11px] text-gray-300">{mail?.from ?? "—"}</td></tr>
              </tbody>
            </table>
            <p className="text-xs leading-relaxed text-gray-400">
              {deliverable
                ? "A relay with credentials. verify() says only that it answered."
                : "configured is true because SMTP_HOST is set, and that is all it means: the host is localhost, secure is false and there are no credentials, so nothing would leave. A green tick that only means \"a string was set\" is worse than no tick."}
            </p>
          </>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">The identity in force</h3>
          {canManage ? (
            <button type="button" className="btn-primary text-sm" onClick={onEdit} disabled={blockedReason !== null}>
              <Pencil size={12} className="mr-1.5 inline" /> Edit the identity
            </button>
          ) : (
            <span className="text-xs text-gray-500">Read-only: changing the identity is email:manage.</span>
          )}
        </div>
        {blockedReason && canManage ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-gray-300">{blockedReason}</p>
        ) : null}
        <table className="ptable w-full text-xs">
          <tbody>
            {IDENTITY_FIELDS.map((field) => {
              const value = field.value({ brand: view, canManage });
              return (
                <tr key={field.id}>
                  <td className="px-2 py-1.5 text-gray-500">{field.label}</td>
                  <td className="px-2 py-1.5 text-gray-300">{value || <span className="text-gray-500">{unsetNote(field.id)}</span>}</td>
                  <td className="px-2 py-1.5 text-gray-500">{field.help}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">Per message — what each one declares about its own sender</h3>
        <p className="text-xs text-gray-500">
          There is no per-message identity to read — the registry declares one address for every message and a null reply-to for
          all twelve — so this table shows exactly that, with the function or route that sends each one, rather than an invented
          identity per row.
        </p>
        <div className="overflow-x-auto">
          <table className="ptable w-full text-xs">
            <thead>
              <tr>
                <th className="px-2 py-2 text-left">Message</th>
                <th className="px-2 py-2 text-left">From</th>
                <th className="px-2 py-2 text-left">Reply-To</th>
                <th className="px-2 py-2 text-left">Sent by</th>
                <th className="px-2 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-2 py-2">
                    <span className="font-mono text-[11px] text-cyber-300">{row.key}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <MessageStatusChip status={row.status} />
                      {row.locked ? <StateChip tone="locked"><Lock size={10} /> locked</StateChip> : null}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-gray-300">{row.from ?? "not stated"}</td>
                  <td className="px-2 py-2 text-gray-300">{row.replyTo ?? <span className="text-gray-500">none</span>}</td>
                  <td className="px-2 py-2 text-gray-400">{row.sentBy ?? "nothing"}</td>
                  <td className="px-2 py-2">
                    <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={onEdit} disabled={!canManage || blockedReason !== null}>
                      Edit the identity
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="px-2 py-2 text-gray-500">One address serves every message, which is why the Action column sets the same row for all twelve.</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Why a ticket notification replies into the ticket</h3>
        <p className="text-xs leading-relaxed text-gray-400">{REPLY_INTO_TICKET}</p>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Domains — the three things a person must not get wrong</h3>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Record</th><th className="px-2 py-2 text-left">The rule</th><th className="px-2 py-2 text-left">Detail</th></tr></thead>
          <tbody>
            {SENDING_IDENTITY_FACTS.map((fact) => (
              <tr key={fact.rule}>
                <td className="px-2 py-2 font-semibold text-cyber-300">{fact.rule}</td>
                <td className="px-2 py-2 text-gray-300">{fact.label}</td>
                <td className="px-2 py-2 text-gray-400">{fact.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">Domains — the records you paste</h3>
        <table className="ptable w-full text-xs">
          <caption className="sr-only">Domain records</caption>
          <thead><tr><th className="px-2 py-2 text-left">Domain</th><th className="px-2 py-2 text-left">SPF</th><th className="px-2 py-2 text-left">DKIM</th><th className="px-2 py-2 text-left">DMARC</th><th className="px-2 py-2 text-left">Status</th></tr></thead>
          <tbody>
            <tr>
              <td colSpan={5} className="px-2 py-2 text-gray-500">
                No record has been pasted, and there is nowhere for one to live yet: the brand kit holds a sender name, an address
                and a reply-to, and nothing holds a domain record.
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="px-2 py-2 font-mono text-[11px] text-gray-500">
                TXT @ &nbsp; v=spf1 include:&lt;your relay's include&gt; -all · TXT c7ntax._domainkey &nbsp; v=DKIM1; k=rsa; p=&lt;public key&gt; · TXT _dmarc &nbsp; v=DMARC1; p=none; rua=mailto:dmarc@…
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="text-xs leading-relaxed text-gray-400">
          Illustrative shapes only — the include, the selector and the key are yours to paste. The section cannot reach your DNS
          provider and does not pretend to: it checks the shape of what you paste and whether it names the relay this instance
          sends through, and says "pasted, not confirmed" rather than "verified".
        </p>
        <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
          <b className="text-gray-200">What it cannot verify.</b> {IDENTITY_BOUNDARY.cannot}
        </div>
        <div className="rounded-lg border border-alert-green/30 bg-alert-green/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
          <b className="text-gray-200">What it can do.</b> {IDENTITY_BOUNDARY.can}
        </div>
      </div>
    </div>
  );
}

// ── Three: the trigger matrix as a sortable, paged table ─────────────────────────────────────────

function MatrixTable({
  sortHeader, shown, pages, page, onPage, total, group, onGroup, groups, sourceSentence, countSentence, messagesRead, canManage,
}: {
  sortHeader: (key: string, label: string) => ReactNode;
  shown: MatrixRow[];
  pages: number;
  page: number;
  onPage: (page: number) => void;
  total: number;
  group: string;
  onGroup: (group: string) => void;
  groups: string[];
  sourceSentence: string;
  countSentence: string;
  messagesRead: EmailBrandProps["messages"];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-border bg-surface-light px-3.5 py-2.5 text-xs leading-relaxed text-gray-400">
        {sourceSentence}
      </div>

      {messagesRead.status === "unavailable" ? (
        <UnavailablePanel
          message={messagesRead.message ?? "The message catalogue could not be read."}
          onRetry={messagesRead.reload}
          what={<>What follows is neither empty nor a guess: it is the catalogue read from the code, and every row names the sender behind it. When <Mono>GET /api/email/messages</Mono> answers, its answer replaces this one.</>}
        />
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500" htmlFor="email-matrix-group">Group</label>
          <select id="email-matrix-group" className="input-field" value={group} onChange={(event) => onGroup(event.target.value)}>
            <option value="all">Every message</option>
            {groups.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={!canManage}
          title={canManage ? "Nothing on this table is editable here — see the note below the table." : "email:manage is required."}
        >
          Save
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Nothing on this table can be changed here, which is why <b className="text-gray-300">Save</b> is disabled: the switches
        that exist belong to the <i>board</i> (<Mono>notifyCustomerOnClose</Mono>, <Mono>followUpEnabled</Mono>), and an
        instance-wide off for a message is a proposal this feature makes. A Save that cannot save is worse than a disabled one.
      </p>

      <div className="overflow-x-auto">
        <table className="ptable w-full text-xs">
          <caption className="sr-only">The trigger matrix, one row per message</caption>
          <thead>
            <tr>
              {sortHeader("key", "Message")}
              {sortHeader("trigger", "Fires when")}
              {sortHeader("recipients", "Receives")}
              {sortHeader("customer", "Customer sees")}
              {sortHeader("off", "Can be turned off")}
              {sortHeader("template", "Template")}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key}>
                <td className="px-2 py-2 align-top">
                  <span className="font-mono text-[11px] text-cyber-300">{row.key}</span>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <MessageStatusChip status={row.status} />
                    {row.locked ? <StateChip tone="locked"><Lock size={10} /> locked</StateChip> : null}
                  </div>
                  {row.note ? <p className="mt-1 text-[11px] leading-snug text-gray-500">{row.note}</p> : null}
                </td>
                <td className="px-2 py-2 align-top text-gray-400">
                  {row.trigger}
                  <span className="mt-1 block text-gray-600">Sent by {row.sentBy ?? "nothing"}</span>
                </td>
                <td className="px-2 py-2 align-top text-gray-400">{row.recipients}</td>
                <td className="px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    className="accent-cyber-500"
                    checked={row.customerVisible === true}
                    disabled
                    readOnly
                    aria-label={`Customer sees ${row.key}`}
                  />
                  <span className="ml-1.5 text-gray-400">{row.customerVisible === null ? "not stated" : row.customerVisible ? "Yes" : "No — internal"}</span>
                </td>
                <td className="px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    className="accent-cyber-500"
                    checked={row.canBeTurnedOff.startsWith("Yes")}
                    disabled
                    readOnly
                    aria-label={`Can be turned off: ${row.key}`}
                  />
                  <span className="ml-1.5 text-gray-400">{row.canBeTurnedOff}</span>
                </td>
                <td className="px-2 py-2 align-top text-gray-400">
                  {row.template}
                  {row.templateVersion === null ? null : <span className="ml-1 font-mono text-[11px]">v{row.templateVersion}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListFooter
        from={total === 0 ? 0 : (page - 1) * 10 + 1}
        to={Math.min(page * 10, total)}
        total={total}
        page={page}
        pages={pages}
        onPage={onPage}
        note={countSentence}
      />

      <div className="rounded-lg border border-alert-red/40 bg-alert-red/10 px-3.5 py-2.5 text-xs leading-relaxed text-gray-300">
        <b className="text-gray-200">Two messages the design names, and the registry does not have.</b> The approved drawing
        lists {PROPOSED_SECURITY_NOTICES.length} more security notices. They are not rows above, because a row would claim this
        system can send something it cannot — the registry declares twelve keys and neither of these is one.
        <ul className="mt-1.5 space-y-1">
          {PROPOSED_SECURITY_NOTICES.map((notice) => (
            <li key={notice.key}><span className="font-mono text-[11px] text-cyber-300">{notice.key}</span> {notice.why}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Four: the rules as a labelled grid of numbers and clock fields ───────────────────────────────

function RulesForm({ delivery, canManage }: { delivery: EmailBrandProps["delivery"]; canManage: boolean }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3.5 py-2.5 text-xs leading-relaxed text-gray-300">
        <b className="text-gray-200">There is nothing to save these to.</b> {NO_SETTINGS_ENDPOINT}
        {canManage ? "" : " Changing them would be email:manage, which this account does not hold either."}
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">The delivery rules</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RULE_FIELDS.map((field) => (
            <div key={field.id}>
              <label className="mb-1 block text-xs text-gray-500" htmlFor={`rule-read-${field.id}`}>{field.label}</label>
              <input id={`rule-read-${field.id}`} className="input-field" value={field.value(delivery)} readOnly disabled aria-describedby={`rule-help-${field.id}`} />
              <p id={`rule-help-${field.id}`} className="mt-1 text-[11px] leading-relaxed text-gray-500">{field.help}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">What is deliberately not batched or held</h3>
        <p className="text-xs text-gray-500">
          Not preferences: each is a message whose value is destroyed by waiting. The five the registry has carry a lock in the
          matrix; the other two are proposed.
        </p>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Message</th><th className="px-2 py-2 text-left">Why it never waits</th></tr></thead>
          <tbody>
            {BATCH_EXEMPT.map((entry) => (
              <tr key={entry.key}>
                <td className="px-2 py-2 align-top font-mono text-[11px] text-cyber-300">
                  {entry.key}
                  {entry.inRegistry ? null : <span className="ml-1.5 text-gray-500">(proposed)</span>}
                </td>
                <td className="px-2 py-2 align-top text-gray-400">{entry.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The window, and the digest after six events</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          Ticket NOC-05-2007 is the shape this is for: six customer-visible changes inside the hour, three messages rather than
          six. The window opens on the first customer-visible event; it is a hold that only becomes real if a second event arrives
          inside it, so a lone change is sent at once. The third event trips the threshold and the window becomes a digest; the hard
          ceiling is what stops a busy ticket being silent for an afternoon.
        </p>
        <Fact label="The window">{`${delivery.batchWindowMinutes} minutes, ${delivery.batchThreshold} to collapse, ${delivery.batchCeilingMinutes} minutes maximum wait`}</Fact>
        <Fact label="Quiet hours">{`${delivery.quietHoursEnabled ? "on" : "off"} — ${delivery.quietHoursStart} to ${delivery.quietHoursEnd}, in ${delivery.quietHoursTimezone}`}</Fact>
        <Fact label="The digest">{delivery.digestEnabled ? "one message listing every event in order, in the words the single-event message would have used" : "off"}</Fact>
        <Fact label="The sample">the applied message on the brand screen, read as its plain-text part</Fact>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Where each rule is applied — a rule that is not enforced somewhere is a sentence</h3>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Rule</th><th className="px-2 py-2 text-left">Enforced in</th><th className="px-2 py-2 text-left">Why there</th></tr></thead>
          <tbody>
            {ENFORCEMENT.map((row) => (
              <tr key={row.rule}>
                <td className="px-2 py-2 align-top text-gray-300">{row.rule}</td>
                <td className="px-2 py-2 align-top text-gray-300">{row.enforcedIn}</td>
                <td className="px-2 py-2 align-top text-gray-400">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Five: who may be emailed, as tables ──────────────────────────────────────────────────────────

function RecipientsTables() {
  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The rules as they exist today</h3>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Role</th><th className="px-2 py-2 text-left">Receives</th><th className="px-2 py-2 text-left">The switch</th><th className="px-2 py-2 text-left">Stored at</th></tr></thead>
          <tbody>
            {RECIPIENT_ROLES.map((role) => (
              <tr key={role.role}>
                <td className="px-2 py-2 align-top font-semibold text-gray-300">{role.role}</td>
                <td className="px-2 py-2 align-top text-gray-400">{role.receives}</td>
                <td className="px-2 py-2 align-top text-gray-400">{role.theSwitch}</td>
                <td className="px-2 py-2 align-top font-mono text-[11px] text-gray-400">{role.storedAt}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4} className="px-2 py-2 text-gray-500">
              Plus the composer's own extras: <Mono>extraTo</Mono> and <Mono>extraCc</Mono>, with <Mono>includePrimary</Mono> to
              untick the primary for a single event. An empty "to" is refused — a mail client needs a To.
            </td></tr>
          </tfoot>
        </table>
        <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
          <b className="text-gray-200">A correction this screen has to make, on the screen.</b> {NOTE_SWITCH_CORRECTION}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Opt-out — proposed, and deliberately narrow</h3>
          <table className="ptable w-full text-xs">
            <tbody>
              <tr><td className="px-2 py-1.5 text-gray-500">What it suppresses</td><td className="px-2 py-1.5 text-gray-300">{OPT_OUT.suppresses}</td></tr>
              <tr><td className="px-2 py-1.5 text-gray-500">What it cannot suppress</td><td className="px-2 py-1.5 text-gray-300">{OPT_OUT.cannotSuppress}</td></tr>
              <tr><td className="px-2 py-1.5 text-gray-500">How it is recorded</td><td className="px-2 py-1.5 text-gray-300">{OPT_OUT.recordedAs}</td></tr>
              <tr><td className="px-2 py-1.5 text-gray-500">Applied in</td><td className="px-2 py-1.5 text-gray-300">{OPT_OUT.appliedIn}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Bounce and complaint — proposed, and a rule the application enforces</h3>
          <table className="ptable w-full text-xs">
            <thead><tr><th className="px-2 py-2 text-left">Signal</th><th className="px-2 py-2 text-left">What happens</th></tr></thead>
            <tbody>
              {BOUNCE_RULES.map((rule) => (
                <tr key={rule.signal}>
                  <td className="px-2 py-2 align-top text-gray-300">{rule.signal}</td>
                  <td className="px-2 py-2 align-top text-gray-400">{rule.whatHappens}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Fact label="Applied in">the sender for the drop, and the delivery log for the record — a bounce is only useful if it is attached to the message that caused it.</Fact>
          <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs leading-relaxed text-gray-300">
            <b className="text-gray-200">Today.</b> {BOUNCE_TODAY}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-cyber-500/30 bg-cyber-600/10 px-3.5 py-2.5 text-xs leading-relaxed text-gray-300">
        <Users size={13} className="mr-1.5 inline text-cyber-300" />
        <b className="text-gray-200">Two suppressions, both reversible by a named person.</b> Opt-out and a hard-bounce
        suppression are the same drop in the same place, and both stay visible on the recipient screen. A suppression nobody can
        lift becomes a client nobody can email, discovered six months later. Neither exists yet: the log can only say a send failed.
      </div>
    </div>
  );
}

// ── Six: per-client overrides, client-major ──────────────────────────────────────────────────────

function OverridesTable({
  overrides, clientsRead, boardsRead, canManage,
}: {
  overrides: EmailBrandProps["overrides"];
  clientsRead: EmailBrandProps["clientsRead"];
  boardsRead: EmailBrandProps["boardsRead"];
  canManage: boolean;
}) {
  const clients = (clientsRead.status === "ok" ? clientsRead.data?.data : undefined) ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Clients" value={overrides.clients ?? "—"} foot={<span className="text-[11px] text-gray-500">read from GET /api/clients</span>} />
        <StatCard label="Overriding the brand today" value={overrides.brandOverridden ?? "—"} foot={<span className="text-[11px] text-gray-500">counting the portal logo and accent, the only brand a client record holds</span>} />
        <StatCard
          label="Boards that differ on close-mail"
          value={overrides.boards === null ? "—" : `${overrides.boardsDiffering ?? 0} of ${overrides.boards}`}
          tone="amber"
          foot={<span className="text-[11px] text-gray-500">{overrides.boardNamesDiffering.length > 0 ? `${overrides.boardNamesDiffering.join(", ")} — and no sender reads that switch` : "no board has notifyCustomerOnClose switched off"}</span>}
        />
        <StatCard label="Email override fields" value="0" tone="amber" foot={<span className="text-[11px] text-gray-500">the client record does not hold them yet — this screen proposes them</span>} />
      </div>

      {clientsRead.status === "unavailable" ? (
        <UnavailablePanel message={clientsRead.message ?? "The client list could not be read."} onRetry={clientsRead.reload} />
      ) : null}
      {boardsRead.status === "unavailable" ? (
        <UnavailablePanel message={boardsRead.message ?? "The board list could not be read."} onRetry={boardsRead.reload} />
      ) : null}

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The chain — what a client inherits, and what it can disagree with</h3>
        <table className="ptable w-full text-xs">
          <thead><tr><th className="px-2 py-2 text-left">Level</th><th className="px-2 py-2 text-left">What it holds</th><th className="px-2 py-2 text-left">Real today</th></tr></thead>
          <tbody>
            {OVERRIDE_CHAIN.map((level) => (
              <tr key={level.level}>
                <td className="px-2 py-2 align-top font-semibold text-gray-300">{level.level}</td>
                <td className="px-2 py-2 align-top text-gray-400">{level.whatItHolds}</td>
                <td className="px-2 py-2 align-top text-gray-500">{level.realToday}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs leading-relaxed text-gray-400">
          <Mono>Company.portalVisibility</Mono>, <Mono>portalAllowTicketCreation</Mono>, <Mono>portalAllowReplies</Mono>,{" "}
          <Mono>portalBoardId</Mono>, <Mono>portalAccentColor</Mono> and <Mono>portalLogoUrl</Mono> all carry the comment{" "}
          <i>"{OVERRIDE_PATTERN_QUOTE}"</i> The email overrides are that sentence, applied to mail.
        </p>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Clients, and where an override would be set</h3>
        <p className="text-xs text-gray-500">
          The per-client cell opens the client record, which is where an override belongs — beside the portal branding it already
          carries.
        </p>
        <table className="ptable w-full text-xs">
          <thead>
            <tr>
              <th className="px-2 py-2 text-left">Client</th>
              <th className="px-2 py-2 text-left">Brand override</th>
              <th className="px-2 py-2 text-left">From name</th>
              <th className="px-2 py-2 text-left">Quiet hours</th>
              <th className="px-2 py-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-gray-500">
                  {clientsRead.status === "ok" ? "The client list is empty." : overrides.clientsMessage ?? "The client list could not be read."}
                </td>
              </tr>
            ) : (
              clients.map((client) => {
                const overridden = Boolean(client.portalLogoUrl || client.portalAccentColor);
                return (
                  <tr key={client.id}>
                    <td className="px-2 py-2 text-gray-300">{client.name ?? client.id}</td>
                    <td className="px-2 py-2">{overridden ? <StateChip tone="warn">set</StateChip> : <StateChip tone="on">inherited</StateChip>}</td>
                    <td className="px-2 py-2 text-gray-500">inherited — the field does not exist yet</td>
                    <td className="px-2 py-2 text-gray-500">inherited</td>
                    <td className="px-2 py-2">
                      <Link to={`/clients/${client.id}`} className="btn-secondary !px-2.5 !py-1 text-xs">Open client</Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className="px-2 py-2 text-gray-500">
              {`${overrides.brandOverridden ?? 0} of ${overrides.clients ?? 0} clients differ from the instance, counting the portal logo and accent only — a client record has no email override fields yet, which is what this screen proposes.`}
            </td></tr>
          </tfoot>
        </table>
      </div>

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">Email overrides — the proposed form</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Footer", "From name", "Quiet hours"].map((label) => (
            <div key={label}>
              <label className="mb-1 block text-xs text-gray-500" htmlFor={`override-${label}`}>{label}</label>
              <input id={`override-${label}`} className="input-field" value="Use the instance's" disabled readOnly />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary text-sm" disabled>Save</button>
          <button type="button" className="btn-secondary text-sm" disabled>Revert to inherited</button>
          <span className="text-xs text-gray-500">
            {canManage
              ? "Disabled because no endpoint carries a per-client email override yet: PUT /api/email/brand takes the instance's kit, and a client record has no email fields. The form is the proposal, and it does not pretend to save."
              : "Not offered: changing an override is email:manage, which this account does not hold."}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          <b className="text-gray-300">Reverting</b> is the same button for every field: clear the value, inherit again. There is
          no "restore the instance's value" because no copy of it is kept on the client — which is what makes a revert safe after
          the instance itself has changed.
        </p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-light px-3.5 py-2.5 text-xs leading-relaxed text-gray-400">
        <Mail size={13} className="mr-1.5 inline text-cyber-300" />
        <b className="text-gray-200">{PROPOSED_CONFIG_SECTION.label}</b> — the ninth configuration section, written in the
        registry's own shape: <Mono>{PROPOSED_CONFIG_SECTION.summary}</Mono> {PROPOSED_CONFIG_SECTION.whyNotIntegrations}
      </div>
    </div>
  );
}
