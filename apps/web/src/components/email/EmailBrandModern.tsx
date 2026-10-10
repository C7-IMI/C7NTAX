/**
 * The brand, identity, matrix, rules, recipient and override screens in the **modern** interface.
 *
 * The arrangement is the Modern interface's own furniture, not a restyle of the classic one: a rail of the six
 * subjects you press (each with a count and a line saying what it answers), rows-as-cards with the
 * sentence beside the control that acts, chips you press to narrow the matrix, a track you step along
 * for the batching rule, the kit applied beside the kit it applies, and a countable footer under the
 * matrix. A write is a sheet.
 *
 * The classic arrangement of the same six screens — a table with an Action column, labelled fields in a
 * grid, a `<select>` where this file has a segmented control, a dialog with a heading and Save/Cancel —
 * is `EmailBrandClassic.tsx`. The state, the API calls and the words live in `pages/EmailBrand.tsx`,
 * `brandScreen.ts`, `brandView.ts` and `emailFacts.ts`, and are shared by both.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, Clock, FileText, Inbox, Info, Link2, ListChecks, Lock, Mail, Pencil,
  ShieldCheck, Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ListFooter, ListViews, PageHeader, StatCard } from "../ui";
import { Band, Fact, MessageStatusChip, Mono, MonoTm, StateChip, UnavailablePanel } from "./emailChrome";
import { EmailSampleMessage, EmailSecuritySample } from "./EmailSample";
import { FieldsEditor, type EditorSurface } from "./EmailEditors";
import {
  BRAND_SUBJECTS, IDENTITY_FIELDS, KIT_FIELDS, RULE_FIELDS, subjectCounts, unsetNote,
  type EmailBrandProps, type FieldCtx,
} from "./brandScreen";
import { SOURCE_SENTENCE } from "./brandView";
import { groupsIn, matrixCountSentence, matrixSourceSentence, type MatrixRow } from "./matrixView";
import {
  BATCH_EXEMPT, BOUNCE_RULES, BOUNCE_TODAY, BRAND_ASSET_NOTES, ENFORCEMENT, IDENTITY_BOUNDARY,
  NOTE_SWITCH_CORRECTION, OPT_OUT, OVERRIDE_CHAIN, OVERRIDE_PATTERN_QUOTE, PLAIN_BY_RULE_KEYS,
  PLAIN_TEXT_RULE, PROPOSED_CONFIG_SECTION, PROPOSED_SECURITY_NOTICES, RECIPIENT_ROLES, REPLY_INTO_TICKET,
  SENDING_IDENTITY_FACTS, UNSUBSCRIBE_RULE, WORDMARK_FALLBACK_RULE, NO_SETTINGS_ENDPOINT,
} from "./emailFacts";

export function EmailBrandModern(props: EmailBrandProps) {
  const {
    messages, relay, clientsRead, boardsRead,
    brandView: view, delivery, matrix, overrides, canManage, subject, onSubject,
    saving, writeError, onSaveBrand,
  } = props;

  const counts = useMemo(
    () => subjectCounts(matrix, overrides.brandOverridden, overrides.clients, delivery),
    [matrix, overrides.brandOverridden, overrides.clients, delivery],
  );
  const [editor, setEditor] = useState<EditorSurface | null>(null);
  const [group, setGroup] = useState<string>("all");
  const [lockedOnly, setLockedOnly] = useState(false);

  const ctx: FieldCtx = { brand: view, canManage };
  const subjectSpec = BRAND_SUBJECTS.find((entry) => entry.id === subject) ?? BRAND_SUBJECTS[0]!;
  const surface: EditorSurface = subject === "senders" ? "identity" : "kit";
  const fieldsFor = (which: EditorSurface) => (which === "identity" ? IDENTITY_FIELDS : KIT_FIELDS);
  const blockedReason = fieldsFor(surface)[0]!.readonly(ctx);

  const rows = matrix.rows.filter((row) => (group === "all" || row.group === group) && (!lockedOnly || row.locked));
  const groupViews = useMemo(
    () => [
      { id: "all", label: "Every message", count: matrix.rows.length },
      ...groupsIn(matrix.rows).map((name) => ({ id: name, label: name, count: matrix.rows.filter((row) => row.group === name).length })),
    ],
    [matrix.rows],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Email Brand & Sending"
        icon={<Mail size={16} className="text-cyber-400" />}
        subtitle="What every message inherits — the logo, the colours, the footer and the address it is sent from."
        actions={
          <>
            <Link to="/admin/email" className="chip"><Pencil size={12} /> The Studio</Link>
            <Link to="/admin/email/log" className="chip"><Inbox size={12} /> Delivery log</Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <aside className="card p-3 lg:sticky lg:top-4" aria-label="Email brand and delivery subjects">
          <p className="mb-1.5 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">What this screen answers</p>
          <div className="space-y-0.5">
            {BRAND_SUBJECTS.map((entry) => {
              const Icon = entry.icon;
              const chosen = entry.id === subject;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => { onSubject(entry.id); setEditor(null); }}
                  className={`flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    chosen
                      ? "border-cyber-500/40 bg-cyber-600/15 text-white"
                      : "border-transparent text-gray-300 hover:bg-surface-lighter hover:text-white"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium"><Icon size={13} />{entry.label}</span>
                    <span className={`whitespace-nowrap text-[11px] font-semibold ${chosen ? "text-cyber-300" : "text-gray-500"}`}>{counts[entry.id]}</span>
                  </span>
                  <span className="text-[10.5px] leading-snug text-gray-500">{entry.blurb}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 border-t border-surface-border pt-2.5 text-[10.5px] leading-relaxed text-gray-600">
            Unsubscribe applies to one message (<Mono>report.scheduled</Mono>). Quiet hours apply to every message except the
            security class and the closure. Both are rules this section proposes; neither is enforced by a sender yet.
          </p>
        </aside>

        <div className="min-w-0 space-y-3.5">
          <PageHeader variant="section" title={subjectSpec.label} subtitle={subjectSpec.blurb} />

          {subject === "kit" ? (
            <KitSubject view={view} blockedReason={blockedReason} writeError={writeError} onEdit={() => setEditor("kit")} canManage={canManage} />
          ) : null}
          {subject === "senders" ? (
            <IdentitySubject props={props} blockedReason={blockedReason} onEdit={() => setEditor("identity")} canManage={canManage} />
          ) : null}
          {subject === "matrix" ? (
            <MatrixSubject
              sourceSentence={matrixSourceSentence(matrix, messages.message)}
              countSentence={matrixCountSentence(matrix)}
              groupViews={groupViews}
              group={group}
              onGroup={setGroup}
              lockedOnly={lockedOnly}
              onLockedOnly={setLockedOnly}
              rows={rows}
              messagesRead={messages}
            />
          ) : null}
          {subject === "rules" ? <RulesSubject delivery={delivery} canManage={canManage} /> : null}
          {subject === "recipients" ? <RecipientsSubject /> : null}
          {subject === "overrides" ? (
            <OverridesSubject overrides={overrides} clientsRead={clientsRead} boardsRead={boardsRead} canManage={canManage} />
          ) : null}

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
        </div>
      </div>
    </div>
  );
}

// ── One: the brand kit, applied ──────────────────────────────────────────────────────────────────

function KitSubject({
  view, blockedReason, writeError, onEdit, canManage,
}: {
  view: EmailBrandProps["brandView"];
  blockedReason: string | null;
  writeError: string | null;
  onEdit: () => void;
  canManage: boolean;
}) {
  const swatches: Array<[string, string]> = [
    ["Primary", view.primaryColor],
    ["Accent", view.accentColor],
  ];

  return (
    <div className="space-y-3">
      <Band
        tone="good"
        icon={<FileText size={14} className="text-alert-green" />}
        title="Shared with the PDFs — one kit, not two brands"
        right={<><StateChip tone="neutral"><Mono>BrandKit</Mono></StateChip><StateChip tone="good">1 row</StateChip></>}
      >
        One row wears this brand: <Mono>EmailBrandKit</Mono>, id <Mono>instance</Mono> — the row every send reads, and the
        same row <Mono>services/brand.ts</Mono> and <Mono>hooks/useBrandKit.ts</Mono> hand to a document. The values behind
        these fields are also the shipped defaults in <Mono>packages/shared/src/brand.ts</Mono>, which is what a document falls
        back to before anybody opens this screen. Two stylesheets that "look about the same" drift apart on the first rebrand;
        one row cannot.
      </Band>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">The kit, and where each value comes from</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                {SOURCE_SENTENCE[view.source]}
                {view.updatedByName ? ` Last changed by ${view.updatedByName}${view.updatedAt ? ` on ${new Date(view.updatedAt).toLocaleString()}` : ""}.` : ""}
              </p>
            </div>
            {canManage ? (
              <button type="button" className={`chip ${blockedReason ? "" : "chip--on"}`} onClick={onEdit} disabled={blockedReason !== null}>
                <Pencil size={12} /> Edit the kit
              </button>
            ) : (
              <StateChip tone="neutral">read-only: email:manage</StateChip>
            )}
          </div>

          {blockedReason && canManage ? (
            <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">{blockedReason}</p>
          ) : null}
          {writeError ? (
            <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">{writeError}</p>
          ) : null}

          <div>
            <Fact label="Product">{view.productName} · {view.companyName}</Fact>
            <Fact label="Logo (light / dark)">
              {view.stored.logoUrl ? view.logoUrl : <span className="text-gray-500">{view.logoUrl} — the built-in shield, so a logo change for a report is a logo change here</span>}
            </Fact>
            <Fact label="Wordmark fallback">{view.wordmark} <span className="text-gray-500">— the words that stand in when an image will not load</span></Fact>
            <Fact label="Colour set">
              <span className="inline-flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                {swatches.map(([label, value]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 rounded-full border border-surface-border" style={{ background: value }} aria-hidden="true" />
                    <span className="text-[11.5px]">{label}</span>
                    <Mono>{value}</Mono>
                  </span>
                ))}
              </span>
            </Fact>
            <Fact label="Type scale">18/600 · 15/600 · 13.5/400 · 11.5/400 on the senders' own stack — a mail client cannot be asked to fetch a webfont</Fact>
            <Fact label="Footer text">{view.footerText}</Fact>
            <Fact label="Legal line">
              {view.legalText || <span className="text-gray-500">{view.companyName} — the company name stands in while this is empty</span>}
            </Fact>
          </div>

          <Band tone="warn" icon={<Ban size={14} className="text-alert-amber" />} title="The unsubscribe rule: it goes on the messages a person may refuse, and on no others">
            {UNSUBSCRIBE_RULE}
          </Band>

          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-gray-600">The assets, and where they come from</p>
            {BRAND_ASSET_NOTES.map((asset) => (
              <Fact key={asset.asset} label={asset.asset}>{asset.value} <span className="text-gray-500">— {asset.source}</span></Fact>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Applied — the same kit on a real message</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              The words are the shape of <Mono>ticketActivityTemplate</Mono>, and the records are the kind the Studio previews
              against: a ticket on the Intelligence Desk for Acme Corporation, whose primary contact is James Wilson.
            </p>
          </div>
          <EmailSampleMessage brand={view} replyToSentence="the connector's mailbox, so the reply becomes a reply on the ticket" />
          <Band tone="info" icon={<Info size={14} className="text-cyber-300" />} title="Both parts, from the same lines">
            {PLAIN_TEXT_RULE}
          </Band>
        </div>
      </div>

      <Band
        tone="locked"
        icon={<Lock size={14} className="text-cyber-300" />}
        title={<>What the brand kit does <em>not</em> decorate — and the rules that do not apply to them</>}
        right={<StateChip tone="locked"><Lock size={11} /> {PLAIN_BY_RULE_KEYS.length} locked rows</StateChip>}
      >
        Three of the twelve are <Mono>security</Mono> class and get no brand kit at all:{" "}
        {PLAIN_BY_RULE_KEYS.map((key, index) => (
          <span key={key}>{index > 0 ? ", " : ""}<Mono>{key}</Mono></span>
        ))}
        . They are read once, in a hurry, often on a poor connection, and a designed header is friction in the way of the number:
        they get the code or the credential, the expiry and the instruction, and a plain-text part.{" "}
        <b className="text-gray-300">No shield, no wordmark, no crimson header, no footer, no unsubscribe link and no
        reply-to.</b>{" "}
        Batching, quiet hours and opt-out do not apply to them either — a held code is an expired code — and the closure and the
        internal reopened notice are never batched or held for reasons of their own.
      </Band>

      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">The same brand, deliberately absent</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            The code message as the rule leaves it — the crimson header <Mono>mfaTemplate</Mono> has today is exactly what the rule
            removes from the three security-class messages.
          </p>
        </div>
        <EmailSecuritySample />
      </div>

      <p className="text-[11px] leading-relaxed text-gray-600">{WORDMARK_FALLBACK_RULE}</p>

      <Band tone="info" icon={<Mail size={14} className="text-cyber-300" />} title={<>{PROPOSED_CONFIG_SECTION.label} — the ninth configuration section, in the registry's own shape</>}>
        <Mono>{PROPOSED_CONFIG_SECTION.summary}</Mono> {PROPOSED_CONFIG_SECTION.whyNotIntegrations}{" "}
        <Mono>{PROPOSED_CONFIG_SECTION.fields.length} fields</Mono>, mirroring <Mono>integrations</Mono>' permissions so that
        whoever may change the relay is who may change the address the mail leaves from.
      </Band>
    </div>
  );
}

// ── Two: the sending identity ────────────────────────────────────────────────────────────────────

function IdentitySubject({
  props, blockedReason, onEdit, canManage,
}: {
  props: EmailBrandProps;
  blockedReason: string | null;
  onEdit: () => void;
  canManage: boolean;
}) {
  const { brandView: view, matrix, relay } = props;
  const mail = relay.status === "ok" ? relay.data?.mail ?? null : null;
  const deliverable = Boolean(mail?.configured && mail?.hasCredentials && mail?.host && mail.host !== "localhost");
  const identities = new Set(matrix.rows.map((row) => row.from ?? "—")).size;
  const repliesTo = matrix.rows.filter((row) => row.replyTo).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Distinct from addresses" value={identities} foot={<span className="text-[11px] text-gray-500">across {matrix.rows.length} messages</span>} />
        <StatCard label="Reply-To headers set" value={repliesTo} tone="amber" foot={<span className="text-[11px] text-gray-500">the registry declares replyTo: null for every message today</span>} />
        <StatCard
          label="Relay on this instance"
          value={relay.status === "ok" ? `${mail?.host ?? "—"}:${mail?.port ?? "—"}` : "—"}
          tone={deliverable ? "green" : "amber"}
          foot={<span className="text-[11px] text-gray-500">{relay.status === "ok" ? (deliverable ? "credentials present" : "configured, no credentials — nothing would leave") : "not readable yet — see below"}</span>}
        />
        <StatCard label="From address on the relay" value={mail?.from ? 1 : "—"} foot={<span className="text-[11px] text-gray-500">{mail?.from ?? "not readable"}</span>} />
      </div>

      {relay.status === "unavailable" ? (
        <UnavailablePanel
          message={relay.message ?? "The relay configuration could not be read."}
          onRetry={relay.reload}
          what={<>The relay's six fields (<Mono>configured · host · port · secure · hasCredentials · from</Mono>) come from <Mono>GET /api/system/deployment</Mono>, guarded by <Mono>Permission.SystemConfig</Mono>. Until that read answers this screen cannot say what this instance would send through — and it says so rather than showing a green tick.</>}
        />
      ) : null}

      {mail ? (
        <Band
          tone={deliverable ? "good" : "warn"}
          icon={deliverable ? <CheckCircle2 size={14} className="text-alert-green" /> : <AlertTriangle size={14} className="text-alert-amber" />}
          title={deliverable ? "The relay on this instance is configured, with credentials" : "On this instance mail is \"configured\" and would not be delivered"}
          right={
            <>
              <StateChip tone={mail.configured ? "warn" : "bad"}>{mail.configured ? "configured" : "not configured"}</StateChip>
              <StateChip tone={deliverable ? "good" : "bad"}>{deliverable ? "deliverable" : "not deliverable"}</StateChip>
            </>
          }
        >
          <Mono>configured {String(mail.configured)} · host {mail.host ?? "—"} · port {mail.port ?? "—"} · secure {String(mail.secure)} · hasCredentials {String(mail.hasCredentials)} · from {mail.from ?? "—"}</Mono>
          {" "}— reported field by field rather than as a green tick, because a tick that only means "a string was set" is worse than
          no tick. The relay answering <Mono>verify()</Mono> says only that it answered.
        </Band>
      ) : null}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">The identity in force, and the per-message answer</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              One sender name, one address and one reply-to serve every message: there is no per-message identity to read, so the
              table below shows what each message declares about its own sender instead of an invented one.
            </p>
          </div>
          {canManage ? (
            <button type="button" className={`chip ${blockedReason ? "" : "chip--on"}`} onClick={onEdit} disabled={blockedReason !== null}>
              <Pencil size={12} /> Edit the identity
            </button>
          ) : (
            <StateChip tone="neutral">read-only: email:manage</StateChip>
          )}
        </div>

        {blockedReason && canManage ? (
          <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">{blockedReason}</p>
        ) : null}

        <div>
          {IDENTITY_FIELDS.map((field) => {
            const value = field.value({ brand: view, canManage });
            return (
              <Fact key={field.id} label={field.label}>
                {value || <span className="text-gray-500">{unsetNote(field.id)}</span>}
              </Fact>
            );
          })}
        </div>

        <div className="space-y-2">
          {matrix.rows.map((row) => (
            <div key={row.key} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <MonoTm>{row.key}</MonoTm>
                <MessageStatusChip status={row.status} />
                {row.locked ? <StateChip tone="locked"><Lock size={11} /> locked</StateChip> : null}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
                <b className="text-gray-300">From</b> {row.from ?? "not stated"}
                {" · "}
                <b className="text-gray-300">Reply-To</b> {row.replyTo ?? "none"}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">Sent by {row.sentBy ?? "nothing"}</p>
            </div>
          ))}
        </div>
      </div>

      <Band tone="info" icon={<Link2 size={14} className="text-cyber-300" />} title={<>Why a ticket notification replies <em>into the ticket</em></>}>
        {REPLY_INTO_TICKET}
      </Band>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Domains — and the three things a person must not get wrong</h3>
        {SENDING_IDENTITY_FACTS.map((fact) => (
          <Band key={fact.rule} tone="plain" icon={<StateChip tone="on">{fact.rule}</StateChip>} title={fact.label}>{fact.detail}</Band>
        ))}
      </div>

      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Records — the application reads what you paste, and says what it cannot see</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            The section cannot reach your DNS provider and does not pretend to: it holds the records you paste and checks the two
            things a string can be checked for — that the value has the shape the standard requires, and that it names the relay
            this instance actually sends through.
          </p>
        </div>

        <Band tone="info" icon={<Info size={14} className="text-cyber-300" />} title="No record is stored, and none has been pasted">
          The brand kit holds a sender name, an address and a reply-to. There is no store for a domain record yet, so nothing is
          drawn as if there were. These are the shapes it would hold:
        </Band>

        <div className="space-y-1.5">
          {[
            ["TXT", "@", "v=spf1 include:<your relay's include> -all"],
            ["TXT", "c7ntax._domainkey", "v=DKIM1; k=rsa; p=<public key from the relay>"],
            ["TXT", "_dmarc", "v=DMARC1; p=none; rua=mailto:dmarc@cyber7group.com"],
          ].map(([kind, name, value]) => (
            <p key={name} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-surface-border bg-surface-light px-3.5 py-2 font-mono text-[11px] text-gray-400">
              <b className="text-cyber-300">{kind}</b>
              <span>{name}</span>
              <span className="break-all">{value}</span>
            </p>
          ))}
          <p className="text-[11px] text-gray-500">Illustrative shapes only — the include, the selector and the key are yours to paste.</p>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <Band tone="warn" icon={<AlertTriangle size={14} className="text-alert-amber" />} title="What the application cannot verify — stated on the screen, not in a footnote">
            {IDENTITY_BOUNDARY.cannot}
          </Band>
          <Band tone="good" icon={<ShieldCheck size={14} className="text-alert-green" />} title="What it can do — and already does">
            {IDENTITY_BOUNDARY.can} {relay.status === "ok" ? "On this instance that read answered." : "On this instance that read did not answer."}
          </Band>
        </div>
      </div>
    </div>
  );
}

// ── Three: the trigger matrix ────────────────────────────────────────────────────────────────────

function MatrixSubject({
  sourceSentence, countSentence, groupViews, group, onGroup, lockedOnly, onLockedOnly, rows, messagesRead,
}: {
  sourceSentence: string;
  countSentence: string;
  groupViews: { id: string; label: string; count: number }[];
  group: string;
  onGroup: (id: string) => void;
  lockedOnly: boolean;
  onLockedOnly: (on: boolean) => void;
  rows: MatrixRow[];
  messagesRead: EmailBrandProps["messages"];
}) {
  return (
    <div className="space-y-3">
      <Band tone="info" icon={<ListChecks size={14} className="text-cyber-300" />} title="Where this catalogue came from">
        {sourceSentence}
      </Band>

      {messagesRead.status === "unavailable" ? (
        <UnavailablePanel
          message={messagesRead.message ?? "The message catalogue could not be read."}
          onRetry={messagesRead.reload}
          what={<>What follows is neither empty nor a guess: it is the catalogue read from the code — the same file the Studio's list reads — and every row names the sender behind it. When <Mono>GET /api/email/messages</Mono> answers, its answer replaces this one entirely.</>}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <ListViews views={groupViews} value={group} onChange={onGroup} label="Narrow the matrix by group" />
        <button type="button" aria-pressed={lockedOnly} onClick={() => onLockedOnly(!lockedOnly)} className={`chip ${lockedOnly ? "chip--on" : ""}`}>
          <Lock size={12} /> Never batched or held
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <article key={row.key} className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <MonoTm>{row.key}</MonoTm>
              <MessageStatusChip status={row.status} />
              {row.locked ? <StateChip tone="locked"><Lock size={11} /> locked</StateChip> : null}
              {row.state && row.state !== "default" ? <StateChip tone="neutral">template {row.state}</StateChip> : null}
              <span className="ml-auto text-[11px] text-gray-500">{row.name}</span>
            </div>
            <div>
              <Fact label="When it fires">{row.trigger}</Fact>
              <Fact label="Who receives it">{row.recipients}</Fact>
              <Fact label="Customer sees it">
                {row.customerVisible === null
                  ? <span className="text-gray-500">not stated by the API</span>
                  : row.customerVisible
                    ? <span className="text-alert-green">Yes</span>
                    : <span className="text-gray-400">No — internal</span>}
              </Fact>
              <Fact label="Can be turned off">{row.canBeTurnedOff}</Fact>
              <Fact label="Template in force">
                {row.template}
                {row.templateVersion === null ? <span className="text-gray-500"> · no saved version — the code's own wording is in force</span> : <> · <Mono>v{row.templateVersion}</Mono></>}
              </Fact>
              <Fact label="Sent by">{row.sentBy ?? "nothing"}</Fact>
            </div>
            {row.note ? (
              <p className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed text-gray-400 ${row.locked ? "border-cyber-500/30 bg-cyber-600/10" : "border-surface-border bg-surface-light"}`}>
                {row.note}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <ListFooter from={rows.length === 0 ? 0 : 1} to={rows.length} total={rows.length} page={1} pages={1} onPage={() => {}} note={countSentence} />

      <Band tone="bad" icon={<AlertTriangle size={14} className="text-alert-red" />} title="Two messages the design names, and the registry does not have">
        The approved drawing lists {PROPOSED_SECURITY_NOTICES.length} more security notices. They are not rows above, because a row
        would claim this system can send something it cannot — the registry declares twelve keys and neither of these is one.
        <ul className="mt-1.5 space-y-1">
          {PROPOSED_SECURITY_NOTICES.map((notice) => (
            <li key={notice.key}><MonoTm>{notice.key}</MonoTm> <span className="text-gray-500">{notice.why}</span></li>
          ))}
        </ul>
      </Band>
    </div>
  );
}

// ── Four: quiet hours, batching and the digest ───────────────────────────────────────────────────

const BATCH_STEPS = [
  { state: "done", title: "First event", body: "A status change. It is customer-visible, so a window opens and a count starts.", n: "t + 0:00 · 1 of 3" },
  { state: "done", title: "Second event", body: "A note is added. It joins the open window rather than starting its own email.", n: "t + 0:06 · 2 of 3" },
  { state: "hold", title: "Threshold reached", body: "The third event trips the threshold: the window is now a digest, and the clock resets inside it so a long thread cannot push the send out all evening.", n: "t + 0:17 · digest armed" },
  { state: "now", title: "Digest sends", body: "One email listing every event in order with its own timestamp, in the words the single-event email would have used.", n: "t + 0:32" },
  { state: "next", title: "Sixth event", body: "After the digest, a new window. If it is the only event it goes as itself — a lone change does not wait to be told about alone.", n: "t + 0:51 · 1 of 3" },
];

function RulesSubject({
  delivery, canManage,
}: {
  delivery: EmailBrandProps["delivery"];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Quiet hours window" value={`${delivery.quietHoursStart} – ${delivery.quietHoursEnd}`} icon={<Clock size={13} />} foot={<span className="text-[11px] text-gray-500">{delivery.quietHoursEnabled ? delivery.quietHoursTimezone : "switched off"}</span>} />
        <StatCard label="Batch window" value={`${delivery.batchWindowMinutes} min`} foot={<span className="text-[11px] text-gray-500">measured from the first customer-visible event</span>} />
        <StatCard label="Collapse threshold" value={delivery.batchThreshold} foot={<span className="text-[11px] text-gray-500">the third event turns the window into a digest</span>} />
        <StatCard label="Hard ceiling on any wait" value={`${delivery.batchCeilingMinutes} min`} tone="amber" foot={<span className="text-[11px] text-gray-500">nothing is held longer, whatever has been queued</span>} />
      </div>

      <Band
        tone="warn"
        icon={<AlertTriangle size={14} className="text-alert-amber" />}
        title="These are the defaults this feature proposes, and there is nothing to save them to"
        right={<StateChip tone="neutral">{canManage ? "no endpoint" : "read-only: email:manage"}</StateChip>}
      >
        {NO_SETTINGS_ENDPOINT}
      </Band>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">The rules, as this feature proposes them</h3>
        <p className="text-xs text-gray-500">
          Each is a value with the sentence saying what it means. They are drawn disabled rather than offered, because a control
          whose Save has nowhere to go is a promise the screen cannot keep.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {RULE_FIELDS.map((field) => (
            <div key={field.id}>
              <label className="mb-1 block text-xs text-gray-400" htmlFor={`rule-${field.id}`}>{field.label}</label>
              <input id={`rule-${field.id}`} className="input-field" value={field.value(delivery)} readOnly disabled aria-describedby={`rule-help-${field.id}`} />
              <p id={`rule-help-${field.id}`} className="mt-1 text-[11px] leading-relaxed text-gray-500">{field.help}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">The rule, as a track — one ticket, one hour, six events</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Ticket <b className="text-gray-300">NOC-05-2007</b> ("CPU sustained at 100% on app node", Stark Enterprises) is the
            shape this is for: six customer-visible changes inside the hour, three messages rather than six.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-5">
          {BATCH_STEPS.map((step) => (
            <div
              key={step.title}
              className={`rounded-xl border px-3.5 py-3 ${
                step.state === "now"
                  ? "border-cyber-500/55 bg-cyber-600/10"
                  : step.state === "hold"
                    ? "border-alert-amber/45 bg-alert-amber/10"
                    : step.state === "done"
                      ? "border-alert-green/30 bg-surface-light"
                      : "border-surface-border bg-surface-light"
              }`}
            >
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
                <span className="h-2 w-2 rounded-full bg-cyber-400" aria-hidden="true" />
                {step.title}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{step.body}</p>
              <p className="mt-1.5 font-mono text-[10.5px] text-gray-500">{step.n}</p>
            </div>
          ))}
        </div>
        <Band tone="info" icon={<Clock size={14} className="text-cyber-300" />} title="A lone event sends immediately">
          The window is not a delay applied to everything — it is a hold that only becomes real if a second event arrives inside
          it. One change is sent at once. That is why the ceiling matters more than the window: the ceiling is what stops a busy
          ticket being silent for an afternoon.
        </Band>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="card space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-white">What is deliberately <em>not</em> batched or held</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Not preferences: each is a message whose value is destroyed by waiting. The five the registry has are drawn as locked
              rows in the matrix too, so the rule stands in two places rather than in one paragraph.
            </p>
          </div>
          {BATCH_EXEMPT.map((entry) => (
            <Band
              key={entry.key}
              tone="locked"
              icon={<Lock size={14} className="text-cyber-300" />}
              title={<span className="flex flex-wrap items-center gap-2"><MonoTm>{entry.key}</MonoTm>{entry.inRegistry ? null : <StateChip tone="bad">proposed</StateChip>}</span>}
            >
              {entry.why}
            </Band>
          ))}
        </div>

        <div className="card space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">The digest — what a client receives after six events</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              One block per event, in order, in the words the single-event message would have used — read here as its plain-text
              part, which is what a client that strips HTML receives.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-surface-border bg-surface-light px-3.5 py-3 font-mono text-[11px] leading-relaxed text-gray-400">{`Hi Tony Stark,

Ticket NOC-05-2007 — CPU sustained at 100% on app node

5 updates in the last hour

18:02 — Status updated
Status changed from "New" to "In Progress".

18:08 — New note added
Monitoring shows the alert cleared twice and returned; we are watching the node.

18:17 — Time logged
0.5 hours logged by the on-call engineer.

18:29 — New note added
Restarted the application pool; CPU back under 40%.

18:32 — Status updated
Status changed from "In Progress" to "Waiting On Client".

Open the ticket: https://c7ntax.example.com/tickets/NOC-05-2007

Cyber 7 Group, LLC
One message, five events. You are the contact on ticket NOC-05-2007 at Stark Enterprises.`}</pre>
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold text-white">Where each rule is applied — a rule that is not enforced somewhere is a sentence</h3>
        {ENFORCEMENT.map((row) => (
          <div key={row.rule} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-2.5">
            <p className="text-[12.5px] font-medium text-white">{row.rule}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">
              <b className="text-gray-300">Enforced in {row.enforcedIn}.</b> {row.why}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Five: who may be emailed ─────────────────────────────────────────────────────────────────────

function RecipientsSubject() {
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-white">
            The rules as they exist today — <Mono>ticketContacts.ts</Mono>, <Mono>ticketNotifications.ts</Mono>
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            This is the part of the feature with the least to invent: the roles are modelled, enforced, and behave identically
            whether a contact was added at ticket creation, from the ticket screen, or while writing a note.
          </p>
        </div>
        {RECIPIENT_ROLES.map((role) => (
          <div key={role.role} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[12.5px] font-semibold text-white">{role.role}</span>
              <span className="text-[11px] text-gray-500">stored at <Mono>{role.storedAt}</Mono></span>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">{role.receives}</p>
            <p className="mt-1 text-[11.5px] text-gray-400"><b className="text-gray-300">The switch:</b> {role.theSwitch}</p>
          </div>
        ))}
        <p className="text-[11px] text-gray-600">
          Plus the composer's own extras: <Mono>extraTo</Mono> and <Mono>extraCc</Mono> from the send dialog, with{" "}
          <Mono>includePrimary</Mono> to untick the primary for a single event. An empty "to" is refused — a mail client needs a To.
        </p>
      </div>

      <Band
        tone="warn"
        icon={<AlertTriangle size={14} className="text-alert-amber" />}
        title="A correction this screen has to make, on the screen"
        right={<StateChip tone="neutral"><Mono>TicketContact.notifyOnNote</Mono></StateChip>}
      >
        {NOTE_SWITCH_CORRECTION}
      </Band>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Opt-out — proposed, and deliberately narrow</h3>
          <Fact label="What it suppresses">{OPT_OUT.suppresses}</Fact>
          <Fact label="What it cannot suppress">{OPT_OUT.cannotSuppress}</Fact>
          <Fact label="How it is recorded">{OPT_OUT.recordedAs}</Fact>
          <Fact label="Applied in">{OPT_OUT.appliedIn}</Fact>
          <p className="text-[11px] text-gray-500">
            An opt-out that only removes a link from a footer is not a rule; the drop has to happen where the message is addressed.
          </p>
        </div>

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Bounce and complaint — proposed, and a rule the application enforces</h3>
          {BOUNCE_RULES.map((rule) => (
            <div key={rule.signal} className="rounded-xl border border-surface-border bg-surface-light px-3.5 py-2.5">
              <p className="text-[12px] font-medium text-white">{rule.signal}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-400">{rule.whatHappens}</p>
            </div>
          ))}
          <Fact label="Applied in">
            the sender for the drop, and the delivery log for the record — a bounce is only useful if it is attached to the
            message that caused it.
          </Fact>
          <Band tone="warn" icon={<AlertTriangle size={14} className="text-alert-amber" />} title="Today">{BOUNCE_TODAY}</Band>
        </div>
      </div>

      <Band tone="locked" icon={<Users size={14} className="text-cyber-300" />} title="Two suppressions, both reversible by a named person">
        Opt-out and a hard-bounce suppression are the same drop in the same place, and both stay visible on the recipient screen. A
        suppression nobody can lift becomes a client nobody can email, discovered six months later. Neither exists yet: the log can
        only record that a send failed.
      </Band>
    </div>
  );
}

// ── Six: per-client overrides ────────────────────────────────────────────────────────────────────

function OverridesSubject({
  overrides, clientsRead, boardsRead, canManage,
}: {
  overrides: EmailBrandProps["overrides"];
  clientsRead: EmailBrandProps["clientsRead"];
  boardsRead: EmailBrandProps["boardsRead"];
  canManage: boolean;
}) {
  const example: Array<{ label: string; value: string | null; detail: string }> = [
    { label: "Footer", value: null, detail: "inherits the kit's footer text" },
    { label: "From name", value: "C7NTAX for Stark Enterprises", detail: "the only field set, in the example" },
    { label: "Quiet hours", value: null, detail: "inherits the instance window" },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        <UnavailablePanel
          message={clientsRead.message ?? "The client list could not be read."}
          onRetry={clientsRead.reload}
          what={<>The first two figures come from <Mono>GET /api/clients</Mono>, a route that already exists. Without it this screen cannot say how many clients there are or how many differ.</>}
        />
      ) : null}
      {boardsRead.status === "unavailable" ? (
        <UnavailablePanel
          message={boardsRead.message ?? "The board list could not be read."}
          onRetry={boardsRead.reload}
          what={<>The per-board level of the chain is real: a board holds <Mono>notifyCustomerOnClose</Mono>, which is the exception this pattern was built for.</>}
        />
      ) : null}

      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-white">The chain — what a client inherits, and what it can disagree with</h3>
        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-5">
          {OVERRIDE_CHAIN.map((level, index) => (
            <div key={level.level} className={`rounded-xl border px-3.5 py-3 ${index === 2 ? "border-cyber-500/55 bg-cyber-600/10" : "border-surface-border bg-surface-light"}`}>
              <p className="text-[12.5px] font-semibold text-white">{level.level}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{level.whatItHolds}</p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-500">{level.realToday}</p>
            </div>
          ))}
        </div>
        <Band
          tone="good"
          icon={<CheckCircle2 size={14} className="text-alert-green" />}
          title="The pattern is already in the repository, with its reasoning written down"
          right={<StateChip tone="good">existing pattern</StateChip>}
        >
          <Mono>Company.portalVisibility</Mono>, <Mono>portalAllowTicketCreation</Mono>, <Mono>portalAllowReplies</Mono>,{" "}
          <Mono>portalBoardId</Mono>, <Mono>portalAccentColor</Mono> and <Mono>portalLogoUrl</Mono> all carry the comment{" "}
          <i>"{OVERRIDE_PATTERN_QUOTE}"</i> The email overrides are that sentence, applied to mail.
        </Band>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="card space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Creating one, and what it inherits</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              A sheet on the client's own record, beside the portal branding it already has: the instance's value with a "use the
              instance's" state above it, so nothing is typed twice.
            </p>
          </div>
          <div className="space-y-2 rounded-xl border border-surface-border bg-surface-light px-3.5 py-3">
            {example.map((field) => (
              <div key={field.label} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-gray-300">{field.label}</span>
                {field.value ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StateChip tone="warn">set</StateChip>
                    <span className="text-[11.5px] text-gray-400">{field.value}</span>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <StateChip tone="on">use the instance's</StateChip>
                    <span className="text-[11.5px] text-gray-500">{field.detail}</span>
                  </span>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-2.5">
              <button type="button" className="btn-primary text-sm" disabled>Save overrides</button>
              <button type="button" className="btn-secondary text-sm" disabled>Revert to inherited</button>
            </div>
            <p className="text-[11px] leading-relaxed text-gray-500">
              {canManage
                ? "Disabled because no endpoint carries a per-client email override yet: PUT /api/email/brand takes the instance's kit, and a client record has no email fields. The form is the proposal, and it does not pretend to save."
                : "Not offered: changing an override is email:manage, which this account does not hold."}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">
            <b className="text-gray-300">Reverting</b> is the same button for every field: clear the value, inherit again. There
            is no "restore the instance's value" because no copy of it is kept on the client — which is what makes a revert safe
            after the instance itself has changed.
          </p>
        </div>

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-white">Who is overridden right now</h3>
          {overrides.clientsMessage ? (
            <p className="text-[11.5px] text-gray-400">{overrides.clientsMessage}</p>
          ) : (
            <div>
              <Fact label="Brand override">{`${overrides.brandOverridden ?? 0} of ${overrides.clients ?? 0} clients differ from the instance`}</Fact>
              <Fact label="From name">none — the field does not exist on a client record yet</Fact>
              <Fact label="Quiet hours">every client inherits the instance window</Fact>
              <Fact label="Applied in">
                <b className="text-gray-300">the renderer</b> — the API resolves instance → board → client → language immediately
                before it renders, and the delivery log records the scope it used, so "which footer did they actually get" is
                answerable a year later.
              </Fact>
              <Fact label="Why not the sender">
                because an override is about <i>content</i>, and the sender only sees the finished message. A resolution that
                happens after rendering is a resolution nothing can act on.
              </Fact>
            </div>
          )}
          <p className="text-[11px] text-gray-500">
            The count is zero rather than {overrides.clients ?? 5} because the pattern is a nullable field where null means
            inherit: a client that differs carries a value, and none does yet.
          </p>
        </div>
      </div>
    </div>
  );
}
