/**
 * AWS Signature Version 4.
 *
 * `AwsAdapter` used to send `Authorization: AWS4-HMAC-SHA256 Credential=<keyId>` and nothing else —
 * no canonical request, no signing key, no `x-amz-date`, no `Signature=` — which AWS rejects on
 * sight. The signature is not optional and cannot be approximated: it is the only thing that proves
 * the request was made by the holder of the secret key, and the whole algorithm is documented at
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 *
 * This implements it directly on `node:crypto`, which keeps the integration package free of the AWS
 * SDK — the SDK is a large dependency to add for four read-only calls, and this is 60 lines of
 * documented arithmetic.
 *
 * Everything here is synchronous and pure apart from the clock, so it can be reasoned about and
 * tested without a network.
 */
import { createHash, createHmac } from "node:crypto";

/** The date and time the signature is bound to. */
export interface SigV4Clock {
  /** `20261008T031500Z` */
  amzDate: string;
  /** `20261008` */
  dateStamp: string;
}

export function sigV4Clock(at: Date = new Date()): SigV4Clock {
  const iso = at.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: Buffer | string, value: string): Buffer => createHmac("sha256", key).update(value, "utf8").digest();

/**
 * The query string, sorted by key and percent-encoded the way AWS expects.
 *
 * `encodeURIComponent` is close but not the same: AWS wants `~` left alone and spaces as `%20`, and
 * it signs the *encoded* value, so a difference here is a signature mismatch rather than a wrong URL.
 */
export function canonicalQuery(params: Record<string, string>): string {
  const encode = (value: string) =>
    encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return Object.keys(params)
    .sort()
    .map(key => `${encode(key)}=${encode(params[key] ?? "")}`)
    .join("&");
}

export interface SignOptions {
  method: "GET" | "POST";
  /** The full URL. Its path and query are what gets signed. */
  url: string;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** For temporary credentials from STS, which must also be sent as `x-amz-security-token`. */
  sessionToken?: string;
  /** Sent as the body; its hash goes into the signature. Empty for a GET. */
  body?: string;
  clock?: SigV4Clock;
}

export interface SignedRequest {
  headers: Record<string, string>;
  body?: string;
}

/**
 * Sign one request.
 *
 * The canonical request is `method \n canonicalUri \n canonicalQuery \n canonicalHeaders \n
 * signedHeaders \n hashedPayload`, and the signature is the HMAC chain over `AWS4<secret>`, the date,
 * the region, the service and `aws4_request`. Get any of those wrong and AWS says
 * `SignatureDoesNotMatch` without saying which.
 */
export function signRequest(options: SignOptions): SignedRequest {
  const url = new URL(options.url);
  const clock = options.clock ?? sigV4Clock();
  const payload = options.body ?? "";
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": clock.amzDate,
    ...(options.sessionToken ? { "x-amz-security-token": options.sessionToken } : {}),
  };

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map(name => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    options.method,
    url.pathname || "/",
    canonicalQuery(Object.fromEntries(url.searchParams.entries())),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${clock.dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", clock.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, clock.dateStamp), options.region), options.service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(payload ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(payload ? { body: payload } : {}),
  };
}
