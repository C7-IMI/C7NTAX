/**
 * The CLI's HTTP client: one method, and an error mapped to the exit codes PLAN-028 §9 defines.
 *
 * It is deliberately thin. **The CLI parses nothing the server should decide and authorizes nothing** —
 * it sends the request the command names with the key it was given, and the route checks the permission
 * exactly as it does for the browser (§6). So there is no logic here beyond "send it, and say what
 * happened in the vocabulary a script can branch on".
 */
import { CONSOLE_EXIT, type ConsoleExitCode } from "@C7NTAX/shared";
import { apiBase, type ResolvedProfile } from "./profile.ts";

export interface ApiFailure {
  ok: false;
  code: ConsoleExitCode;
  message: string;
  /** The route's own words, when it said something — §9 says surface them verbatim. */
  hint?: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; body: T; status: number } | ApiFailure;

export function apiFetch(
  profile: ResolvedProfile,
  path: string,
  query: Record<string, string> = {},
): Promise<ApiResult<unknown>> {
  const url = new URL(`${apiBase(profile.server)}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== "" && value !== undefined) url.searchParams.set(key, value);
  }

  return fetch(url, {
    headers: {
      authorization: `Bearer ${profile.apiKey}`,
      accept: "application/json",
    },
  })
    .then(async (response): Promise<ApiResult<unknown>> => {
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* a non-JSON body is kept as text, which is more useful than "invalid JSON" */
      }

      if (response.ok) return { ok: true, body, status: response.status };

      const message =
        (body as { error?: string; message?: string })?.error ??
        (body as { message?: string })?.message ??
        `${response.status} ${response.statusText}`;

      /*
       * The status codes are translated into the console's own vocabulary so a script can branch on the
       * *reason* rather than on HTTP: 403 is a permission the key does not hold (2), 404 is "no such
       * record, or you may not see it" (3), and anything else is "the API ran it and it failed" (6) —
       * the same distinction PLAN-026 drew between "could not try" and "tried and the route refused".
       */
      const code: ConsoleExitCode =
        response.status === 401 ? CONSOLE_EXIT.refused
          : response.status === 403 ? CONSOLE_EXIT.refused
            : response.status === 404 ? CONSOLE_EXIT.notFound
              : response.status === 429 ? CONSOLE_EXIT.failed
                : CONSOLE_EXIT.failed;

      return { ok: false, code, message, status: response.status };
    })
    .catch((error: unknown): ApiFailure => ({
      ok: false,
      code: CONSOLE_EXIT.failed,
      message: `Could not reach ${profile.server}: ${(error as Error).message}`,
      hint: "Check the server address, and that the API is running.",
    }));
}

/** The catalogue this key may run, exactly as the in-app console sees it. */
export interface Catalogue {
  groups: { id: string; label: string; summary: string; commands: CommandDescriptor[] }[];
  verbs: { name: string; summary: string }[];
  universalFlags: { name: string; help: string; type: string; scope?: string }[];
  counts: { available: number; total: number };
}

export interface CommandDescriptor {
  name: string;
  noun: string;
  verb: string;
  group: string;
  permission: string | null;
  description: string;
  path: string;
  query?: readonly string[];
  subject?: { label: string; required?: boolean; values?: readonly string[] };
  flags: { name: string; help: string; type: string; values?: readonly string[] }[];
  columns?: readonly { header: string; path: string }[];
}

export async function fetchCatalogue(profile: ResolvedProfile): Promise<ApiResult<Catalogue>> {
  const result = await apiFetch(profile, "/console/catalog");
  if (!result.ok) {
    // A 404 here is almost always the console being switched off for the deployment, which is worth
    // saying plainly: the alternative is a person hunting through their own key's scopes.
    if (result.status === 404) {
      return {
        ok: false,
        code: CONSOLE_EXIT.policy,
        message: "The console is disabled on this deployment.",
        hint: "An administrator can switch it on under Workspace → Command console, or with CONSOLE_ENABLED.",
      };
    }
    return result;
  }
  return { ok: true, body: result.body as Catalogue, status: result.status };
}
