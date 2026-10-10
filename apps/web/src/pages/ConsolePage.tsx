import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Link2, Lock } from "lucide-react";
import {
  CONSOLE_OWN_VERBS,
  commandsByGroup,
  permittedCommands,
} from "@C7NTAX/shared";
import { ConsolePanel } from "../components/ConsoleDialog";
import { useAuth } from "../hooks/useAuth";
import { useConsoleEnabled } from "../hooks/useConsoleEnabled";
import { useModernInterface } from "../hooks/useNavigationStyle";
import { PageHeader } from "../components/ui";

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
  const modern = useModernInterface();
  const { permissions } = useAuth();
  const consoleEnabled = useConsoleEnabled();
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

  /*
   * The page is reachable by URL, so hiding the header icon is not enough on its own: a pasted link
   * outlives the permission that made it, and someone else's bookmark is the ordinary way a person
   * arrives at a surface they may not use. The refusal is drawn instead of the panel rather than beside
   * a disabled one — the same answer the API gives the catalogue.
   *
   * Placed below every hook on purpose: the deployment gate resolves asynchronously, so this branch can
   * be entered after the first render, and a `return` above a hook would change the hook count mid-life.
   */
  if (!consoleEnabled) {
    return (
      <div className="card max-w-xl space-y-2" data-testid="console-unavailable">
        <div className="flex items-center gap-2">
          <Lock size={16} className="text-gray-500" />
          <h1 className="text-sm font-semibold text-white">The console is not available to this account</h1>
        </div>
        <p className="text-xs text-gray-500">
          The command console is offered to people whose role, or individual permissions, include{" "}
          <span className="font-mono text-gray-400">console:use</span>. An administrator can grant it in
          Administration → Users &amp; Roles, on the Console row of the Permissions tab; a client's own
          record can also withhold it for everybody who belongs to that client.
        </p>
        <p className="text-xs text-gray-600">
          If you arrived from a link, it was made while the console was open to you — it still works for
          whoever holds the permission.
        </p>
      </div>
    );
  }

  /*
   * The sentence and the copy-link button are shared by both interfaces — the classic header draws
   * them itself and the Modern one hands them to the shared PageHeader — so they are built once
   * here. Only the number inside the sentence is dressed differently, which is why it comes from a
   * helper rather than a duplicated paragraph (a fragment adds no element in the classic interface).
   */
  const count = (n: number) => (modern ? <span className="tabular-nums">{n}</span> : <>{n}</>);

  const consoleHelp = (
    <>
      {count(permitted.length)} read command{permitted.length === 1 ? "" : "s"}{" "}
      available to you, grouped the way{" "}
      <span className="text-gray-400">help</span> prints them. This page
      runs the same commands as the popup and adds a URL: a link like{" "}
      <span className="font-mono text-gray-400">/console?c=ticket+list</span>{" "}
      opens with that command already run. Writes arrive with PLAN-026's
      action manifest — until then the console reads.
    </>
  );

  const copyButton = (
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
  );

  return (
    <div className="h-[calc(100vh-11rem)] min-h-[24rem] flex flex-col gap-3">
      {modern ? (
        <PageHeader
          variant="section"
          title="Console"
          subtitle={consoleHelp}
          actions={copyButton}
        />
      ) : (
        <div className="flex items-start gap-3 shrink-0">
          <div className="min-w-0">
            <h1 className={modern ? "text-base font-semibold text-white" : "text-lg font-semibold text-white"}>Console</h1>
            <p className="text-xs text-gray-500">
              {consoleHelp}
            </p>
          </div>
          {copyButton}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ConsolePanel
          variant="page"
          initialCommand={initialCommand}
          onCommit={commit}
        />
      </div>

      {/* The catalogue in a form you can read without typing anything: the same groups `help` prints. */}
      <details className="shrink-0 rounded-lg border border-surface-border bg-surface">
        <summary className={modern ? "px-3.5 py-2 text-xs text-gray-400 cursor-pointer hover:text-white tabular-nums" : "px-3.5 py-2 text-xs text-gray-400 cursor-pointer hover:text-white"}>
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
