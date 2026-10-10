/**
 * "What gets sent" — a choice about content, kept outside the canvas.
 *
 * The owner asked to *"choose what information gets sent"*. That is three different kinds of decision
 * and the mockup separates them from layout on purpose: a paragraph is a way of saying something, and a
 * switch is a decision about whether to say it at all. So this panel is not part of the editor's canvas
 * in either interface; it is its own surface, and each switch reads as a sentence with the consequence
 * beside it.
 *
 * The counts are **counted from the switches, not asserted**: `TICKET_FACTS` names the nine facts a
 * ticket owns and which switch carries each one, so "4 of 9 ticket facts" is arithmetic over the switch
 * state. A figure that is typed by hand into a band is a figure that goes stale the first time somebody
 * flips a switch.
 *
 * The two arrangements differ:
 *
 *  · **Modern** is the mockup's panel of switches, each with its consequence underneath and one band
 *    stating the total.
 *  · **Classic** is a `<fieldset>` of labelled checkboxes in the same order with the summary line under
 *    it — the classic screen's own way of asking a list of yes/no questions.
 */
import { useModernInterface } from "../../hooks/useNavigationStyle";
import { CONTENT_SWITCHES } from "./emailCodeV0";

/** The nine facts a ticket owns, and the switch that puts each one in the message. */
export const TICKET_FACTS: { fact: string; carriedBy: string | null }[] = [
  { fact: "Ticket number", carriedBy: "ticket-line" },
  { fact: "Ticket title", carriedBy: "ticket-line" },
  { fact: "Status", carriedBy: null },
  { fact: "Priority", carriedBy: null },
  { fact: "Last activity", carriedBy: null },
  { fact: "Technician", carriedBy: "technician" },
  { fact: "Client", carriedBy: "client-name" },
  { fact: "Time logged", carriedBy: "time-entries" },
  { fact: "Status history", carriedBy: "status-history" },
];

export function countFacts(switches: Record<string, boolean>): number {
  return TICKET_FACTS.filter((entry) => entry.carriedBy !== null && switches[entry.carriedBy] === true).length;
}

export function countQuotes(switches: Record<string, boolean>): number {
  return ["quote-note", "quote-thread"].filter((id) => switches[id] === true).length;
}

function summarySentence(switches: Record<string, boolean>): string {
  const facts = countFacts(switches);
  const quotes = countQuotes(switches);
  return `This message will contain ${facts} of ${TICKET_FACTS.length} ticket facts and will quote ${quotes} item${quotes === 1 ? "" : "s"}.`;
}

export interface EmailContentSwitchesProps {
  switches: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
  className?: string;
}

export function EmailContentSwitches({ switches, onToggle, className = "" }: EmailContentSwitchesProps) {
  const modern = useModernInterface();

  if (modern) {
    return (
      <section className={`card ${className}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold text-white">What gets sent</h3>
          <p className="text-[11.5px] text-gray-500">a choice, not a layout</p>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-500">
          Kept out of the canvas on purpose: a paragraph is a way of saying something, and a switch is a
          decision about whether to say it at all. Each switch reads as a sentence with its consequence beside it.
        </p>

        <div className="mt-3 space-y-1">
          {CONTENT_SWITCHES.map((entry) => (
            <label
              key={entry.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-light"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border px-0.5 transition-colors ${
                  switches[entry.id] ? "border-cyber-500 bg-cyber-600/40" : "border-surface-border bg-surface-lighter"
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full transition-transform ${
                    switches[entry.id] ? "translate-x-3 bg-cyber-400" : "translate-x-0 bg-gray-500"
                  }`}
                />
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={switches[entry.id] === true}
                onChange={(event) => onToggle(entry.id, event.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-200">{entry.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500">{entry.say}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-alert-green/30 bg-alert-green/10 px-3.5 py-2.5">
          <p className="text-xs font-semibold text-white">{summarySentence(switches)}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Counted from the switches, not asserted — and it is a figure about the message, which is why it is
            stated here rather than drawn on the canvas.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`card space-y-3 ${className}`}>
      <div>
        <h3 className="text-lg font-semibold text-white">What gets sent</h3>
        <p className="mt-0.5 text-sm text-gray-400">
          Which facts appear in the message body, whether the thread is quoted, and whether time entries are
          included. These are decisions about the message&apos;s content rather than about its layout, so they are
          not part of the block editor.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-white">Facts and quotation</legend>
        {CONTENT_SWITCHES.map((entry) => (
          <div key={entry.id} className="border-b border-surface-border/60 pb-3 last:border-b-0 last:pb-0">
            <label className="flex items-start gap-2.5 text-xs text-gray-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={switches[entry.id] === true}
                onChange={(event) => onToggle(entry.id, event.target.checked)}
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-200">{entry.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-gray-400">{entry.say}</span>
              </span>
            </label>
          </div>
        ))}
      </fieldset>

      <p className="rounded-lg border border-surface-border bg-surface-light px-3 py-2 text-xs text-gray-300">
        {summarySentence(switches)} An unswitched fact is not sent at all, rather than sent empty.
      </p>
    </section>
  );
}
