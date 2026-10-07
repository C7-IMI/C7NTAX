/**
 * One outbound-request helper (PLAN-018 H1, closing A5 and A10).
 *
 * The API fetches URLs that an administrator or an operator supplies — an AI provider's
 * endpoint, a status page, a monitor URL, an SSO issuer. Without a policy, any of those
 * can point at the metadata service, an internal admin panel, or a database port, and
 * whatever comes back is reflected into an alert or sent along with a stored API key.
 *
 * The rules, applied to the URL *and* to every resolved address so a public hostname
 * cannot resolve to a private one:
 *   - http(s) only, and https unless the host is loopback and private access is allowed
 *   - no loopback, link-local (which includes 169.254.169.254), or RFC1918/CGNAT/ULA
 *   - redirects are followed, but every hop is validated like the first, so a public URL
 *     cannot bounce the request into the private network
 *   - every attempt is logged, with its outcome, so an SSRF attempt is visible
 *
 * Private access is off unless `EGRESS_ALLOW_PRIVATE=true`, which exists for a local
 * model server (Ollama) in development and is refused in production. Link-local stays
 * blocked even then.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { logger } from "./logger";

export type EgressPurpose = "inference" | "monitor" | "webhook" | "sso" | "other";

export class EgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressError";
  }
}

const allowPrivate = (): boolean => process.env.EGRESS_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";
/** Redirect hops allowed before a request is abandoned (each one is re-validated). */
const MAX_REDIRECTS = 3;
const isLoopbackHost = (host: string): boolean =>
  host === "localhost" || host === "::1" || host === "127.0.0.1" || host.endsWith(".localhost") || host === "[::1]";

/** Ranges that are never a legitimate destination, even with the private opt-in:
 *  link-local (169.254.0.0/16 and fe80::/10 — this is the cloud metadata service) and
 *  the unspecified address. */
export function isAlwaysBlocked(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 169 && b === 254;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower.startsWith("fe80")) return true;
    if (lower.startsWith("::ffff:")) return isAlwaysBlocked(lower.replace("::ffff:", ""));
    return false;
  }
  return false;
}

/** RFC1918, loopback, link-local (metadata), CGNAT, multicast and ULA/reserved v6. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.replace("::ffff:", ""));
    return false;
  }
  return true; // unparseable — treat as unsafe
}

/**
 * Validates a URL that is about to be fetched server-side.
 * Throws {@link EgressError} with a message that can be shown to the person who set it.
 */
export async function assertSafeOutboundUrl(rawUrl: string, purpose: EgressPurpose = "other"): Promise<void> {
  const url = assertSafeUrlLiteral(rawUrl);
  const privateOk = allowPrivate();

  // Resolve and check every address: a public name can still point at 127.0.0.1.
  let addresses: string[];
  try {
    const records = await lookup(url.hostname, { all: true });
    addresses = records.map(r => r.address);
  } catch {
    throw new EgressError(`Could not resolve ${url.hostname}`);
  }
  if (addresses.length === 0) throw new EgressError(`Could not resolve ${url.hostname}`);
  const alwaysBlocked = addresses.find(a => isAlwaysBlocked(a));
  if (alwaysBlocked) {
    throw new EgressError(`${url.hostname} resolves to a link-local address (${alwaysBlocked}), which is never allowed`);
  }
  if (!privateOk) {
    const blocked = addresses.find(a => isPrivateAddress(a));
    if (blocked) {
      throw new EgressError(`${url.hostname} resolves to a private address (${blocked}), which is not allowed`);
    }
  }
  logger.info("egress", `allowed ${purpose} request to ${url.hostname}${url.pathname}`);
}

/**
 * The synchronous half: scheme, and the address when the host is written as one.
 * Used where a value is being saved, so a typo is caught immediately; the DNS half
 * above still runs before any request.
 */
export function assertSafeUrlLiteral(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressError(`"${rawUrl}" is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EgressError(`Only http and https URLs can be requested (got ${url.protocol.replace(":", "")})`);
  }
  // Address before scheme: "169.254.169.254 is a private address" is the useful message
  // for a metadata URL, while "only https" would send someone looking for a certificate.
  const privateOk = allowPrivate();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isAlwaysBlocked(host)) throw new EgressError(`${host} is a link-local address, which is never allowed`);
    if (!privateOk && isPrivateAddress(host)) {
      throw new EgressError(`${host} is a private address, which is not allowed`);
    }
  }
  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "http:" && !(loopback && privateOk)) {
    throw new EgressError("Only https URLs can be requested (http is allowed for a local service in development)");
  }
  if (loopback && !privateOk) {
    throw new EgressError("URLs on this machine are not allowed (set EGRESS_ALLOW_PRIVATE=true for a local model server in development)");
  }
  return url;
}

export interface SafeFetchOptions {
  purpose?: EgressPurpose;
  timeoutMs?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

/**
 * Fetch with the policy applied. Redirects are followed, but one hop at a time with the
 * checks re-applied to each target: following them blindly is how a public URL bounces a
 * server-side request into the private network.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { purpose = "other", timeoutMs = 15000, method = "GET", headers, body } = options;
  const started = Date.now();
  let url = rawUrl;
  let currentMethod = method;
  let currentBody = body;
  const chain: string[] = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeOutboundUrl(url, purpose);
    let response: Response;
    try {
      response = await fetch(url, {
        method: currentMethod,
        headers,
        body: currentBody,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      logger.info("egress", `${purpose} request to ${url} failed after ${Date.now() - started}ms: ${(e as Error).message}`);
      throw e;
    }
    if (response.status < 300 || response.status >= 400) {
      logger.info("egress", `${purpose} request to ${url} -> ${response.status} in ${Date.now() - started}ms`);
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      logger.info("egress", `${purpose} request to ${url} -> ${response.status} with no Location — returned as is`);
      return response;
    }
    if (hop === MAX_REDIRECTS) {
      logger.info("egress", `${purpose} request to ${url} exceeded ${MAX_REDIRECTS} redirects`);
      throw new EgressError(`${url} redirected too many times (more than ${MAX_REDIRECTS})`);
    }
    const next = new URL(location, url).toString();
    chain.push(next);
    logger.info("egress", `${purpose} request to ${url} redirected (${response.status}) to ${next}`);
    // 303 (and the legacy 301/302 on a POST, as browsers do) becomes a bodyless GET.
    if (response.status === 303 || (currentMethod !== "GET" && response.status !== 307 && response.status !== 308)) {
      currentMethod = "GET";
      currentBody = null;
    }
    url = next;
  }
  throw new EgressError(`${rawUrl} redirected too many times`);
}
