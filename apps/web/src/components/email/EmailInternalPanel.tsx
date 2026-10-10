/**
 * "What an internal message is not" — the distinction the code already draws, quoted in its own words.
 *
 * `sendTicketReopened`'s comment and `ticketReopenedTemplate`'s both say the same thing, and it is
 * worth keeping where it can be read: an internal message is deliberately *not* the customer template
 * with different words. The reader is a technician who has to decide what to do next, so it names who
 * replied and quotes what they said, and it links to the ticket instead of inviting a reply — the
 * answer belongs in the thread, not in an inbox.
 *
 * The section's job is not to repeat that argument. It is to stop an editor quietly undoing it: the
 * brand kit's logo, colours, marketing footer and unsubscribe line are not available on this message,
 * and the section says *why* rather than presenting a lock with no reason. It also draws the four
 * treatments the ten messages fall into, because the moment there is one editor, the pressure to make
 * every message use it is the pressure that ruins the plain ones.
 *
 * The two arrangements: modern is two cards side by side — the quoted reasoning against the comparison
 * table — and the classic screen is one column read in order, because a form is read top to bottom.
 */
import { Shield, Lock, AlertTriangle } from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { Band, Mono, MonoTm, StateChip, plural } from "./emailChrome";

const CODE_COMMENT = "\u201CInternal, and therefore not the customer template with different words: it names who replied and quotes what they said, because the person reading it has to decide what to do about it and the client is already in the thread. The ticket's own page is the link — an internal email that asks somebody to reply by email would put the answer in the wrong place.\u201D";

const TEMPLATE_COMMENT = "\u201CAn internal notification: a ticket the client has just reopened. Its own template rather than the customer one with different words. The reader is a technician who has to decide what to do next, so it names the person who replied and quotes what they said, and it links to the ticket instead of inviting a reply — the answer belongs in the thread, not in an inbox.\u201D";

const COMPARISON: { fact: string; internal: string; customer: string }[] = [
  { fact: "Reader", internal: "the assignee, else whoever raised the ticket", customer: "a client contact, or the client's own address" },
  { fact: "Brand kit", internal: "not applied — no logo, no marketing footer, no unsubscribe", customer: "inherited, and the footer, legal line and unsubscribe come from it" },
  { fact: "Voice", internal: "third person about the client: \u201CDavid Chen replied to the closing email, so this ticket is back in the queue\u201D", customer: "second person to the client: \u201CIf you have any questions, simply reply to this email\u201D" },
  { fact: "The link", internal: "Open the ticket — the answer belongs in the thread", customer: "the portal, or a reply that becomes a ticket comment" },
  { fact: "What it quotes", internal: "the client's own words, so the technician can decide without opening the ticket first", customer: "the technician's note, because the client has not read it yet" },
  { fact: "Attachment rules", internal: "none — an internal message carries no client document", customer: "the ticket's files, pasted images, or the invoice PDF" },
];

const TREATMENTS: { treatment: string; tone: "good" | "warn" | "bad" | "neutral"; messages: string; why: string }[] = [
  {
    treatment: "Designed",
    tone: "good",
    messages: "ticket.note · ticket.activity · ticket.follow_up · invoice.send · invoice.overdue",
    why: "Read by a client at leisure, so it may carry the brand kit; and read in a hurry, so it may not depend on an image or a hover state to make sense.",
  },
  {
    treatment: "The composer's own words",
    tone: "good",
    messages: "ticket.note",
    why: "A person typed this. The template's part is the frame — the subject tag, the footer that names the ticket and the client — and it should stay the frame rather than grow into the message.",
  },
  {
    treatment: "Plain by design",
    tone: "neutral",
    messages: "ticket.reopened_internal",
    why: "Read by a technician who has to act. A branded footer at the bottom is furniture in the way of the decision.",
  },
  {
    treatment: "Locked plain",
    tone: "warn",
    messages: "auth.mfa_code · portal.login_code · user.invite",
    why: "Read once, in a hurry, possibly on a phone with one bar of signal. A code that has to be found is a code that gets lost. Only the sender and the footer may change.",
  },
  {
    treatment: "Nothing yet",
    tone: "bad",
    messages: "ticket.closure · report.scheduled · quote.send",
    why: "Listed and openable, with the section saying plainly that no code path reaches them — so nobody reads a well-formed preview and assumes a message went out.",
  },
];

function ComparisonTable() {
  return (
    <table className="w-full text-xs">
      <thead className="text-gray-500">
        <tr className="border-b border-surface-border">
          <th scope="col" className="px-2 py-1.5 text-left font-medium" />
          <th scope="col" className="px-2 py-1.5 text-left font-medium">ticket.reopened_internal</th>
          <th scope="col" className="px-2 py-1.5 text-left font-medium">The customer messages</th>
        </tr>
      </thead>
      <tbody>
        {COMPARISON.map((row) => (
          <tr key={row.fact} className="border-b border-surface-border/60 align-top last:border-b-0">
            <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left text-gray-200">{row.fact}</th>
            <td className="px-2 py-1.5 text-gray-400">{row.internal}</td>
            <td className="px-2 py-1.5 text-gray-400">{row.customer}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TreatmentsTable() {
  return (
    <table className="w-full text-xs">
      <thead className="text-gray-500">
        <tr className="border-b border-surface-border">
          <th scope="col" className="px-2 py-1.5 text-left font-medium">Treatment</th>
          <th scope="col" className="px-2 py-1.5 text-left font-medium">Messages</th>
          <th scope="col" className="px-2 py-1.5 text-left font-medium">Why it is that and not the other</th>
        </tr>
      </thead>
      <tbody>
        {TREATMENTS.map((row) => (
          <tr key={row.treatment} className="border-b border-surface-border/60 align-top last:border-b-0">
            <td className="whitespace-nowrap px-2 py-1.5">
              <span className="block text-gray-200">{row.treatment}</span>
              <StateChip tone={row.tone}>{row.tone === "good" ? "rich" : row.tone === "warn" ? "security" : row.tone === "bad" ? "no caller" : "internal"}</StateChip>
            </td>
            <td className="px-2 py-1.5 font-mono text-[11px] text-gray-400">{row.messages}</td>
            <td className="px-2 py-1.5 text-gray-400">{row.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LockedEditorNote() {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-light/50 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Lock size={14} className="text-cyber-400" />
        <h3 className="text-sm font-semibold text-white">What the editor looks like when the message is a security message</h3>
        <MonoTm>auth.mfa_code</MonoTm>
        <span className="ml-auto"><StateChip tone="locked">body locked</StateChip></span>
      </div>
      <ul className="mt-2.5 space-y-1.5 text-xs">
        {[
          "Heading — \u201CVerification Code\u201D · fixed",
          "Paragraph — the expiry sentence · fixed",
          "Code panel — {{portal.code}} · fixed, letterspaced",
          "Footer · editable — the instance's support line",
        ].map((line, index) => (
          <li key={line} className="flex items-center gap-2 rounded-lg border border-surface-border px-2.5 py-1.5">
            <span aria-hidden="true" className="text-[11px]">{index < 3 ? "🔒" : "⣿"}</span>
            <span className="text-gray-300">{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500">
        Every block above the footer is <strong className="font-medium text-gray-400">read-only and listed</strong>{" "}
        rather than hidden, so a person can see the message they are not allowed to change. An empty editor would be a
        mystery; a locked one is a decision.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Drawn at 400 px rather than 520 in the mockup — a security message is the one place the product should be
        smaller than it could be. Nothing that has to load belongs in it: not the brand kit, not an attachment, not an
        inline image. The subject is fixed too, because <Mono>C7NTAX — Your Verification Code</Mono> is the phrase
        support tells people to search for.
      </p>
    </div>
  );
}

export function EmailInternalPanel() {
  const modern = useModernInterface();

  const codeCards = (
    <>
      <div className="rounded-xl border border-surface-border bg-surface-light p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          sendTicketReopened — the sender&apos;s own comment
        </p>
        <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-gray-400">{CODE_COMMENT}</p>
      </div>
      <div className="rounded-xl border border-surface-border bg-surface-light p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          ticketReopenedTemplate — the template function
        </p>
        <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-gray-400">{TEMPLATE_COMMENT}</p>
      </div>
    </>
  );

  if (modern) {
    return (
      <div className="space-y-4">
        <Band
          tone="warn"
          icon={<Shield size={15} className="text-alert-amber" />}
          title={`${plural(1, "message")} of twelve goes to a member of staff, and it is not the customer message with different words`}
        >
          It does not carry the brand kit, and it is not a place to be consistent with the others. The section&apos;s job
          is to make sure that cannot be quietly undone.
        </Band>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="card space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-white">What the code says, in its own words</h3>
              <span className="text-[11.5px] text-gray-500">two comments, quoted</span>
            </div>
            {codeCards}
            <p className="text-[11px] leading-relaxed text-gray-500">
              The section does not need to repeat that argument. It needs to make it un-undone: the brand kit is not
              available on this message, and the reason is printed beside the lock.
            </p>
          </section>

          <section className="card !p-0">
            <div className="border-b border-surface-border px-4 py-2.5">
              <h3 className="text-sm font-semibold text-white">The one internal message, against the eleven that are not</h3>
              <p className="text-[11px] text-gray-500">12 keys · 1 internal</p>
            </div>
            <div className="overflow-x-auto p-3.5">
              <ComparisonTable />
            </div>
          </section>
        </div>

        <section className="card !p-0">
          <div className="border-b border-surface-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-white">Four treatments, decided by who reads it and why</h3>
            <p className="text-[11px] text-gray-500">not by what looks consistent</p>
          </div>
          <div className="overflow-x-auto p-3.5">
            <TreatmentsTable />
          </div>
        </section>

        <section className="card">
          <LockedEditorNote />
        </section>

        <Band
          tone="locked"
          icon={<AlertTriangle size={15} className="text-cyber-400" />}
          title="The design decision, stated once and enforced everywhere"
        >
          Three of the twelve messages are locked to a plain body. That is a property of the message rather than a
          setting somebody can switch: it is visible on the list row, in the editor&apos;s class chip, on the locked
          block list and on the canvas plate — and it is the only place in the section where a control is drawn locked
          instead of absent.
        </Band>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">What an internal message is not</h2>
        <p className="text-sm text-gray-400">
          One key of twelve goes to a member of staff. It is not the customer message with different words, it does not
          carry the brand kit, and it is not a place to be consistent with the others.
        </p>
        {codeCards}
      </div>

      <div className="card overflow-x-auto !p-0">
        <div className="border-b border-surface-border px-3.5 py-2.5">
          <h3 className="text-sm font-semibold text-white">The one internal message, against the eleven that are not</h3>
        </div>
        <div className="p-3.5">
          <ComparisonTable />
        </div>
      </div>

      <div className="card overflow-x-auto !p-0">
        <div className="border-b border-surface-border px-3.5 py-2.5">
          <h3 className="text-sm font-semibold text-white">Four treatments, decided by who reads it and why</h3>
        </div>
        <div className="p-3.5">
          <TreatmentsTable />
        </div>
      </div>

      <div className="card">
        <LockedEditorNote />
      </div>

      <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-xs leading-relaxed text-gray-400">
        Three of the twelve messages are locked to a plain body, and that is a property of the message rather than a
        setting: on the classic screen a locked message is a disabled fieldset under a caption, and on the modern one it
        is a padlocked block list with the reason on the canvas.
      </p>
    </div>
  );
}
