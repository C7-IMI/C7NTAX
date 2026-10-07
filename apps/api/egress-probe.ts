/**
 * Temporary probe: egress policy assertions (deleted after the run).
 */
import { assertSafeUrlLiteral, assertSafeOutboundUrl, isPrivateAddress, safeFetch } from "./src/services/egress";

const ALLOWED = [
  "https://api.openai.com/v1/chat/completions",
  "https://status.openai.com",
  "https://r.jina.ai/https://downdetector.com/status/x/",
];
const BLOCKED: Array<[string, string]> = [
  ["http://169.254.169.254/latest/meta-data/", "link-local metadata"],
  ["http://127.0.0.1:5432/", "loopback"],
  ["http://localhost:11434/v1/chat/completions", "localhost"],
  ["http://10.0.0.5/admin", "RFC1918"],
  ["http://192.168.1.1/", "RFC1918"],
  ["http://172.16.9.9/", "RFC1918"],
  ["http://[::1]:4000/", "ipv6 loopback"],
  ["https://10.0.0.5/admin", "private literal over https"],
  ["https://169.254.169.254/latest/meta-data/", "metadata over https"],
  ["file:///etc/passwd", "non-http scheme"],
  ["http://example.com/", "plain http"],
  ["not a url", "garbage"],
];

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

console.log("address classification");
check(isPrivateAddress("169.254.169.254"), "169.254.169.254 is private");
check(isPrivateAddress("127.0.0.1") && isPrivateAddress("10.1.2.3") && isPrivateAddress("172.20.0.1") && isPrivateAddress("192.168.0.9"), "RFC1918 + loopback private");
check(!isPrivateAddress("8.8.8.8") && !isPrivateAddress("1.1.1.1"), "public addresses not private");
check(isPrivateAddress("::1") && isPrivateAddress("fd00::1") && isPrivateAddress("fe80::1"), "ipv6 special ranges private");
check(isPrivateAddress("::ffff:127.0.0.1"), "mapped loopback private");

console.log("literal validation (private access off)");
for (const url of ALLOWED) {
  try { assertSafeUrlLiteral(url); check(true, `allowed ${url}`); }
  catch (e) { check(false, `allowed ${url}`, (e as Error).message); }
}
for (const [url, why] of BLOCKED) {
  try { assertSafeUrlLiteral(url); check(false, `blocked ${url} (${why})`, "was allowed"); }
  catch (e) { check(true, `blocked ${url} (${why}): ${(e as Error).message}`); }
}

console.log("full validation (resolves names too)");
async function main() {
try { await assertSafeOutboundUrl("https://api.openai.com/v1/chat/completions", "inference"); check(true, "public name resolves and passes"); }
catch (e) { check(false, "public name passes", (e as Error).message); }
try { await assertSafeOutboundUrl("https://lvh.me/", "monitor"); check(false, "name resolving to 127.0.0.1 blocked", "was allowed"); }
catch (e) { check(true, `name resolving to 127.0.0.1 blocked: ${(e as Error).message}`); }
try { await assertSafeOutboundUrl("https://not-a-real-host-name.invalid/", "monitor"); check(false, "unresolvable name blocked", "was allowed"); }
catch (e) { check(true, `unresolvable name blocked: ${(e as Error).message}`); }

console.log("redirect handling");
// A public URL may redirect, but each hop is re-validated, so a redirect to an internal
// address is refused rather than followed.
try {
  const r = await safeFetch("https://httpbingo.org/redirect-to?url=https://example.com/&status_code=302", { purpose: "monitor", timeoutMs: 9000 });
  check(r.status === 200, `public redirect followed to the end (${r.status})`);
} catch (e) { check(false, "public redirect followed", (e as Error).message); }
// A local origin makes the hop test deterministic: the source is reachable under the
// opt-in, and what it points at is not.
{
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); });
  await new Promise<void>(resolve => server.listen(45999, "127.0.0.1", resolve));
  process.env.EGRESS_ALLOW_PRIVATE = "true";
  try {
    await safeFetch("http://127.0.0.1:45999/hop", { purpose: "monitor", timeoutMs: 5000 });
    check(false, "redirect into the metadata service refused", "was followed");
  } catch (e) { check(true, `redirect into the metadata service refused: ${(e as Error).message}`); }
  // The same server redirecting to a public host must still be followed, so the policy
  // does not simply break every redirect.
  process.env.EGRESS_ALLOW_PRIVATE = "false";
  server.close();
}
}

console.log("private allow-list (EGRESS_ALLOW_PRIVATE=true)");
process.env.EGRESS_ALLOW_PRIVATE = "true";
try { assertSafeUrlLiteral("http://localhost:11434/v1/chat/completions"); check(true, "local model server allowed when opted in"); }
catch (e) { check(false, "local model server allowed when opted in", (e as Error).message); }
try { assertSafeUrlLiteral("https://api.openai.com/v1/chat/completions"); check(true, "https still required for public hosts"); }
catch (e) { check(false, "https still required for public hosts", (e as Error).message); }
try { assertSafeUrlLiteral("http://169.254.169.254/"); check(false, "metadata IP stays blocked under the opt-in", "was allowed"); }
catch (e) { check(true, `metadata IP stays blocked under the opt-in: ${(e as Error).message}`); }
delete process.env.EGRESS_ALLOW_PRIVATE;

const summary = () => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
};
void main().then(summary);
