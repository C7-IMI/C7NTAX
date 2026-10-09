/**
 * The Email Studio's reads and writes — one shape for every panel, and the sentence a failed read
 * prints.
 *
 * These screens exist to answer "what is this system actually sending out", so a read that did not
 * arrive must never be drawn as an empty table or a zero: `null` and "nothing there" are different
 * answers and the page has to be able to tell them apart. Every read therefore resolves to a
 * **status** rather than to data:
 *
 *   · `loading`     — the page draws its skeleton;
 *   · `ok`          — the record arrived;
 *   · `unavailable` — the read failed and `message` says what could not be read and why, in words the
 *                     panel prints verbatim.
 *
 * The endpoints, and who may reach them:
 *
 * | | |
 * |---|---|
 * | `GET /api/email/messages` | the trigger matrix, the per-message sender identity and the template in force — `email:view` |
 * | `GET|PUT /api/email/brand` | the brand kit — `email:view` / `email:manage` |
 * | `GET /api/email/log` | the delivery log — `email:view` |
 * | `GET /api/system/deployment` | the relay this instance was started with — `Permission.SystemConfig` |
 * | `GET /api/clients`, `GET /api/boards` | the two figures the override screen can ground without inventing an endpoint |
 *
 * **Three things this feature proposes do not exist on the API, and the screens say so rather than
 * calling a route that is not there:** the delivery rules (`/api/email/settings`), a per-client
 * override, and a resend. `emailFacts.ts` says where each rule *would* be enforced; the screens draw the
 * value as proposed and disabled, with the reason beside it.
 */
import { useCallback, useEffect, useState } from "react";
import api from "../../api";
import { apiErrorMessage } from "../../lib/apiError";

export type ReadStatus = "loading" | "ok" | "unavailable";

export interface Read<T> {
  status: ReadStatus;
  data: T | null;
  /** What could not be read, in the words the panel prints. `null` while loading and on success. */
  message: string | null;
  reload: () => void;
}

/**
 * Turn a failed request into the sentence a panel shows, distinguishing "absent" from "broken".
 *
 * 404 is the case a feature still being written is in, so it says *that* rather than reporting a fault
 * the reader cannot act on.
 */
export function describeReadFailure(err: unknown, what: string): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 404) return `${what} could not be read: this instance does not serve that endpoint yet (404).`;
  if (status === 403) return `${what} could not be read: this account does not hold the permission it needs (403).`;
  if (status === undefined) return `${what} could not be read: the request did not reach the API.`;
  const message = apiErrorMessage(err, "");
  return message ? `${what} could not be read: ${message}` : `${what} could not be read: the API answered ${status}.`;
}

export function useEmailRead<T>(path: string, what: string): Read<T> {
  const [state, setState] = useState<{ status: ReadStatus; data: T | null; message: string | null }>({
    status: "loading",
    data: null,
    message: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, message: null });
    api
      .get<T>(path)
      .then((res) => {
        if (!cancelled) setState({ status: "ok", data: res.data, message: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "unavailable", data: null, message: describeReadFailure(err, what) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, what, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** The answer a write gives back, so a panel can report a refusal in the API's own words. */
export interface WriteResult<T = unknown> {
  ok: boolean;
  message: string | null;
  payload: T | null;
}

export async function writeEmail<T = unknown>(
  method: "put" | "post",
  path: string,
  body: unknown,
  what: string,
): Promise<WriteResult<T>> {
  try {
    const res = await api.request<T>({ method, url: path, data: body });
    return { ok: true, message: null, payload: res.data ?? null };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
    const detail = apiErrorMessage(err, "");
    const why = status === 404
      ? "this instance does not serve that endpoint (404)"
      : status === 403
        ? "this account does not hold the permission it needs (403)"
        : detail || (status === undefined ? "the request did not reach the API" : `the API answered ${status}`);
    return { ok: false, message: `${what}: ${why}.`, payload: null };
  }
}

// ── The trigger matrix — `GET /api/email/messages` ───────────────────────────────────────────────

/** The registry's own summary of a message. Every field optional: a page must not assume a shape. */
export interface ApiMessage {
  key?: string;
  name?: string;
  group?: string;
  audience?: string;
  editingClass?: string;
  live?: boolean;
  trigger?: string;
  recipients?: string;
  /** The address it leaves from, as the registry states it. */
  from?: string;
  /** How a reply is answered, in prose. `null` when a reply goes nowhere in particular. */
  replyTo?: string | null;
  attachments?: string | null;
  /** The function or route that sends it today, so the matrix can point at it. */
  sender?: string;
  bodyFromComposer?: boolean;
  /** The template in force for this key — the Studio's own shape. */
  template?: ApiTemplateSummary | null;
}

export interface ApiTemplateSummary {
  key?: string;
  name?: string;
  subject?: string;
  state?: string;
  version?: number | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
  /** Present when somebody edited the plain-text part, as opposed to the derived one. */
  text?: string | null;
}

export interface ApiMessagesResponse {
  groups?: string[];
  counts?: { messages?: number; live?: number; neverSent?: number; customised?: number };
  conditions?: Array<{ key: string; label: string }>;
  messages?: ApiMessage[];
}

/** The list envelope the product's own list routes use, plus the bare array and a named key. */
export function normaliseList<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record[key])) return record[key] as T[];
    if (Array.isArray(record.data)) return record.data as T[];
  }
  return [];
}

// ── The brand kit — `GET|PUT /api/email/brand` ───────────────────────────────────────────────────

/** The values every send actually uses, defaults included. */
export interface ApiBrandValues {
  productName?: string;
  companyName?: string;
  wordmark?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string | null;
  legalText?: string | null;
}

export interface ApiBrand {
  productName?: string;
  companyName?: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  wordmark?: string | null;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string | null;
  legalText?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
  /** What every send uses, defaults included — the screen shows this rather than an empty box. */
  effective?: ApiBrandValues;
  /** What an instance whose brand kit does not override the sender address would send from. */
  smtpFrom?: string;
  updatedAt?: string | null;
  updatedByName?: string | null;
}

// ── The delivery log — `GET /api/email/log` ──────────────────────────────────────────────────────

/**
 * One logged send. `result` is `sent` or `failed` today: the API records what the sender did, and the
 * third outcome this feature proposes — `skipped`, for an address a rule suppressed — arrives with the
 * rules rather than with the log.
 */
export interface ApiLogRow {
  id?: string;
  key?: string;
  to?: string;
  cc?: string | null;
  subject?: string;
  templateKey?: string;
  templateVersion?: number | null;
  providerMessageId?: string | null;
  result?: string;
  error?: string | null;
  /** A test send is logged too, and marked, so a test is never mistaken for a client message. */
  test?: boolean;
  at?: string;
  sentByName?: string | null;
  /** The four lines, when the API carries them. Nothing writes them yet. */
  reason?: { what?: string; why?: string; whatToDo?: string; evidence?: string } | null;
}

export interface ApiLogResponse {
  data?: ApiLogRow[];
  total?: number;
  /** `sent`, `failed` and `test` over the whole log, not only over the page that was asked for. */
  counts?: { sent?: number; failed?: number; test?: number };
}

export function useEmailMessages(): Read<ApiMessagesResponse> {
  return useEmailRead<ApiMessagesResponse>("/email/messages", "The message catalogue");
}

export function useEmailBrand(): Read<ApiBrand> {
  return useEmailRead<ApiBrand>("/email/brand", "The brand kit");
}

export function useEmailLog(): Read<ApiLogResponse> {
  return useEmailRead<ApiLogResponse>("/email/log", "The delivery log");
}

/**
 * The client list, read for the one figure the override screen cannot get anywhere else: how many
 * clients differ from the instance. `GET /api/clients` is a route that already exists and already
 * carries `portalLogoUrl` and `portalAccentColor` — the nearest real thing to an email override until
 * the client record grows the email fields the screen proposes.
 */
export interface ClientRow {
  id: string;
  name?: string | null;
  portalLogoUrl?: string | null;
  portalAccentColor?: string | null;
}

export interface ClientsResponse {
  data?: ClientRow[];
  total?: number;
}

export function useClientsForOverrides(): Read<ClientsResponse> {
  return useEmailRead<ClientsResponse>("/clients?limit=200", "The client list");
}

/** `PUT /api/email/brand` — the only write these two screens have, under `email:manage`. */
export function saveBrand(payload: Partial<ApiBrand>): Promise<WriteResult<ApiBrand>> {
  return writeEmail<ApiBrand>("put", "/email/brand", payload, "The brand kit could not be saved");
}
