import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Link2 } from "lucide-react";
import {
  CONSOLE_OWN_VERBS,
  commandsByGroup,
  permittedCommands,
} from "@C7NTAX/shared";
import { ConsolePanel } from "../components/ConsoleDialog";
import { useAuth } from "../hooks/useAuth";

/**
 * `/console` — the console as a page rather than a popup (PLAN-028 §10).
 *
 * The two surfaces run the same component, so a command behaves identically in each; what the page
 * adds is a **URL**. `?c=ticket+list+--status+new` opens the console with that command already run,
 * which is how a command becomes something a colleague can click, and how a run can be linked from a
 * ticket, a runbook or a chat window. The URL tracks the last line run rather than every keystroke, so
 * a link is a command and not a transcript.
 *
 * **Why the initial command is read once and never re-synced.** If the effect re-ran on every URL
 * change, the URL *and* the console would each try to be the source of truth and a link would fire its
 * command twice. The URL is written after the fact (`replaceState`, so a session does not fill the back
 * button) and read only when the page mounts.
 */
export function ConsolePage() {
  const { permissions } = useAuth();
  const [params, setParams] = useSearchParams();
  const [copied, setCopied] = useState(false);

  // Read once, on mount: a later change to `params` is this page's own write coming back.
  const [initialCommand] = useState(() => params.get("c") ?? undefined);

  const permitted = useMemo(
    () => permittedCommands(permissions),
    [permissions],
  );

  const commit = useCallback(
    (line: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("c", line);
          return next;
        },
        { replace: true },
      );
      setCopied(false);
    },
    [setParams],
  );

  const shareUrl = `${window.location.origin}/console?c=${encodeURIComponent(params.get("c") ?? "")}`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the URL is in the address bar either way, which is why the
      // failure is silent rather than an error the person cannot act on.
      setCopied(false);
    }
  }, [shareUrl]);

  return (
    <div className="h-[calc(100vh-11rem)] min-h-[24rem] flex flex-col gap-3">
      <div className="flex items-start gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">Console</h1>
          <p className="text-xs text-gray-500">
            {permitted.length} read command{permitted.length === 1 ? "" : "s"}{" "}
            available to you, grouped the way{" "}
            <span className="text-gray-400">help</span> prints them. This page
            runs the same commands as the popup and adds a URL: a link like{" "}
            <span className="font-mono text-gray-400">
              /console?c=ticket+list
            </span>{" "}
            opens with that command already run. Writes arrive with PLAN-026's
            action manifest — until then the console reads.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyLink()}
          disabled={!params.get("c")}
          className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-gray-400 hover:text-white hover:bg-surface-lighter disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent transition-colors"
          title={
            params.get("c")
              ? "Copy a link that opens the console with this command"
              : "Run a command first"
          }
          data-testid="console-copy-link"
        >
          {copied ? (
            <Check size={12} className="text-alert-green" />
          ) : (
            <Link2 size={12} />
          )}
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <ConsolePanel
          variant="page"
          initialCommand={initialCommand}
          onCommit={commit}
        />
      </div>

      {/* The catalogue in a form you can read without typing anything: the same groups `help` prints. */}
      <details className="shrink-0 rounded-lg border border-surface-border bg-surface">
        <summary className="px-3.5 py-2 text-xs text-gray-400 cursor-pointer hover:text-white">
          What is available ({permitted.length} commands,{" "}
          {CONSOLE_OWN_VERBS.length} console verbs)
        </summary>
        <div className="px-3.5 pb-3 max-h-64 overflow-y-auto grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {commandsByGroup(permitted).map(({ group, commands }) => (
            <div key={group.id}>
              <p className="text-[11px] font-medium text-cyber-400">
                {group.label}
              </p>
              <p className="text-[11px] text-gray-500">{group.summary}</p>
              <ul className="mt-1 space-y-0.5">
                {commands.map((command) => (
                  <li
                    key={command.name}
                    className="text-[11px] font-mono text-gray-400"
                    title={command.description}
                  >
                    {command.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
