/**
 * The state of the instance, in one sentence, on the sign-in page.
 *
 * A sign-in page is the one screen where the backend's health is worth stating: a person arriving at
 * it can do nothing else until the API answers. What matters to them is not a topology, though — it
 * is whether this page will work, and if not, what to do about it. So healthy takes one line, because
 * healthy is the state in which there is nothing to do, and the services themselves go behind a
 * disclosure that prints the probe answers somebody can hand to whoever runs the instance.
 *
 * **Two probes, and the honest one for the database.** `/api/health` is deliberately liveness only —
 * "is this process listening" — and must never query the database, or an outage becomes a crash
 * storm. `/api/ready` is the probe that answers "can this revision actually serve a request", and the
 * database is most of that answer. The panel this replaces printed **Database — Connected** from
 * `/api/health` alone, so the tile a person would trust most was reporting something nothing had
 * asked. Both routes are unauthenticated, which is what lets a signed-out page ask them.
 *
 * The services are a list carrying a word each — Serving, Healthy, Connected, Available, Unreachable
 * — rather than four blocks of colour, because a state told only in colour is a state half of the
 * readers miss: on the light theme `--alert-amber` is 3.19:1 on white and `--alert-green` 3.30:1.
 *
 * The three answers are distinct on purpose (`api`, `db`, and a page that is still asking), because
 * collapsing them is exactly how one probe came to be printed as four facts.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Database, Globe, Server, Wifi } from "lucide-react";
import { HELP_MESSAGES } from "./ServiceHealthPanel";

/** What the page needs to know: both probes, or `null` while the first answer is still coming. */
export interface SignInSystem {
  /** `/api/health` answered — the process is listening. */
  api: boolean;
  /** `/api/ready` answered — the database answers, so a sign-in can actually be served. */
  db: boolean;
  /** The build the API reports, when it reported one. Printed rather than assumed. */
  version: string | null;
}

/** The panel this replaces polled every three seconds; the same cadence keeps the copy honest. */
const PROBE_INTERVAL_MS = 3000;

/** The process. `null` means it did not answer, which is a different fact from a body we could not read. */
async function readHealth(signal: AbortSignal): Promise<{ version?: string } | null> {
  try {
    const response = await fetch("/api/health", { signal });
    if (!response.ok) return null;
    return (await response.json()) as { version?: string };
  } catch {
    return null;
  }
}

/** The database, through the probe that asks it — 503 until it can serve a request. */
async function readReady(signal: AbortSignal): Promise<boolean> {
  try {
    return (await fetch("/api/ready", { signal })).ok;
  } catch {
    return false;
  }
}

async function probe(): Promise<SignInSystem> {
  // One timeout for both, because either answer alone is not enough to state the sentence.
  const signal = AbortSignal.timeout(3000);
  const [health, ready] = await Promise.all([readHealth(signal), readReady(signal)]);
  return { api: health !== null, db: ready, version: health?.version ?? null };
}

export function SignInStatus({ onChange }: {
  /**
   * Reported up so the form can act on it: when the instance cannot serve a sign-in, the page stops
   * offering one rather than letting the password be typed and refused.
   */
  onChange?: (state: SignInSystem) => void;
}) {
  const [state, setState] = useState<SignInSystem | null>(null);

  // Held in a ref so a caller passing an inline arrow does not restart the probe every render.
  const notify = useRef(onChange);
  notify.current = onChange;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      const next = await probe();
      if (cancelled) return;
      setState(next);
      notify.current?.(next);
      timer = setTimeout(run, PROBE_INTERVAL_MS);
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const api = state?.api ?? false;
  const db = state?.db ?? false;
  const degraded = state !== null && !(api && db);

  const services = [
    // True by construction: this component is rendering, so something served the page.
    { name: "Web Server", port: "3010", word: "Serving", ok: true, icon: <Globe size={12} /> },
    { name: "API Server", port: "4000", word: api ? "Healthy" : "Unreachable", ok: api, icon: <Server size={12} /> },
    { name: "Database", port: "5432", word: db ? "Connected" : "Unreachable", ok: db, icon: <Database size={12} /> },
    // The WebSocket shares the API's port, and this page cannot see either independently.
    { name: "WebSocket", port: "4000", word: api ? "Available" : "Unavailable", ok: api, icon: <Wifi size={12} /> },
  ];

  return (
    <div className="mt-4 text-xs">
      {state === null ? (
        <p className="flex items-start gap-2 text-gray-500" aria-live="polite">
          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-alert-amber" />
          <span>Checking the services…</span>
        </p>
      ) : degraded ? (
        <div className="rounded-lg border border-alert-red/35 bg-alert-red/10 px-3 py-2" role="alert">
          <p className="flex items-start gap-2 text-gray-300">
            <AlertTriangle size={13} className="mt-[2px] shrink-0 text-alert-red" />
            <span>
              <b className="font-semibold text-white">Sign-in cannot complete.</b>{" "}
              {api
                ? "The API is answering but it cannot reach the database, so no password can be checked."
                : "The API is not answering, so no password can be checked and no passkey can be verified."}{" "}
              This is not your account — everybody sees it.
            </span>
          </p>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-gray-300" aria-live="polite">
          <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-alert-green" />
          <span>All systems ready — the API answered, and so did the database.</span>
        </p>
      )}

      <details className="mt-2 group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-gray-500 hover:text-white">
          <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
          {degraded ? "What is down, and what to do about it" : "Show the four services"}
        </summary>

        <div className="mt-2 rounded-lg border border-surface-border bg-surface-light px-3 py-2.5">
          <dl className="space-y-1.5">
            {services.map((service) => (
              <div key={service.name} className="flex items-baseline gap-2 text-xs">
                <dt className="w-[98px] shrink-0 text-gray-500">{service.name}</dt>
                <dd className="flex items-baseline gap-1.5 text-gray-300">
                  <span className={`h-2 w-2 shrink-0 self-center rounded-full ${service.ok ? "bg-alert-green" : "bg-alert-red"}`} />
                  {service.word}
                  <span className="text-[10.5px] text-gray-600">:{service.port}</span>
                </dd>
              </div>
            ))}
          </dl>

          {/*
            The probe answers, printed rather than summarised: a person who has to hand this to somebody
            else should not have to translate it. `null` prints as "no answer" rather than as a body that
            was never received.
          */}
          <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500">
            Read from <code className="text-gray-300">GET /api/health</code> →{" "}
            <code className="text-gray-300">
              {api ? `{"status":"ok"${state?.version ? `,"version":"${state.version}"` : ""}}` : "no answer"}
            </code>{" "}
            and <code className="text-gray-300">GET /api/ready</code> →{" "}
            <code className="text-gray-300">{db ? '{"status":"ready"}' : "no answer"}</code>. “Web Server”
            is this page having been served at all, and “WebSocket” shares the API’s port; the Database
            row is the one that comes from <code className="text-gray-300">/api/ready</code>, which is the
            probe that actually asks it.
          </p>

          {/*
            The remedy is written for whoever runs the instance, not for the person signing in, so it
            lives here rather than in the sentence above. The wording is ServiceHealthPanel's own, so the
            two places that give this advice cannot drift apart.
          */}
          {degraded && (
            <p className="mt-2.5 border-t border-dashed border-surface-border pt-2.5 text-[11px] leading-relaxed text-gray-500">
              <b className="font-semibold text-gray-400">For whoever runs this instance:</b>{" "}
              {[
                ...(api ? [] : [HELP_MESSAGES["API Server"]]),
                ...(db ? [] : [HELP_MESSAGES.Database]),
              ].join(" ")}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
