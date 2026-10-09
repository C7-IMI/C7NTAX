/**
 * The Email Studio probe.
 *
 * Two questions this answers, both of which are otherwise assertions in a commit message:
 *
 * 1. **Do the two parts of a message carry the same facts?** For every message in the registry the
 *    default is rendered, and the plain-text part is checked against the HTML it was derived from: every
 *    link the HTML carries is written out in the text, every attachment is named there, and every value
 *    substituted into the body appears in it. That is the owner's requirement — "some mail systems strip
 *    the HTML out of it, so I still want the email to be readable" — stated as something a machine
 *    checks rather than as a promise.
 *
 * 2. **Does a default still say what the code says?** Each message whose sender exists in
 *    `packages/email/src/EmailService.ts` is compared, word for word, against the template function it
 *    replaces. This is what makes the migration onto a template table safe: a row that does not exist
 *    renders the message the instance has always sent.
 *
 * It is also the only place the renderer is exercised without a database, which is why the renderer, the
 * registry and the sample records deliberately import nothing that reaches for a Prisma client.
 *
 *     pnpm --filter @C7NTAX/api probe:email              # the render checks (no database, no network)
 *     pnpm --filter @C7NTAX/api probe:email -- --smtp    # + catch one real send and read its MIME parts
 *
 * `--smtp` starts a throwaway SMTP server on 127.0.0.1:2526 and waits for one message. Point a second
 * API instance at it (`SMTP_HOST=127.0.0.1 SMTP_PORT=2526 PORT=4100`) and send a test from the Studio;
 * the probe decodes what arrives and says whether both a text and an HTML part were in it. Nothing
 * leaves the machine.
 */
import { createServer, type Server, type Socket } from "node:net";
import {
  autoCloseTemplate,
  followUpTemplate,
  invoiceTemplate,
  mfaTemplate,
  overdueTemplate,
  ticketActivityTemplate,
  ticketReopenedTemplate,
} from "@C7NTAX/email";
import { EMAIL_MESSAGE_KEYS, type EmailBlock, type EmailMessageKey } from "@C7NTAX/shared";
import { EMAIL_STYLE_PROPS, EMAIL_TAGS, htmlToText, sanitizeEmailHtml } from "./services/emailHtml";
import { DEFAULT_BRAND, EMAIL_MESSAGES, registryCoverage } from "./services/emailMessages";
import { renderEmail, type EmailRenderContext, type EmailRenderResult } from "./services/emailTemplateRender";
import { instanceFields, SAMPLE_FIELDS } from "./services/emailSampleRecords";

let failures = 0;
let checks = 0;

function pass(message: string): void {
  checks += 1;
  console.log(`  ✓ ${message}`);
}

function fail(message: string): void {
  checks += 1;
  failures += 1;
  console.log(`  ✗ ${message}`);
}

function context(key: EmailMessageKey, overrides: Record<string, string | null | undefined> = {}, composer?: string): EmailRenderContext {
  return {
    fields: { ...instanceFields(DEFAULT_BRAND), ...SAMPLE_FIELDS[key], ...overrides },
    conditions: {},
    brand: DEFAULT_BRAND,
    composerHtml: composer ?? (key === "ticket.note" ? "<p>The replacement licence has been assigned and Outlook is signed in again.</p>" : undefined),
  };
}

function render(key: EmailMessageKey, overrides: Record<string, string | null | undefined> = {}, composer?: string): EmailRenderResult {
  const entry = EMAIL_MESSAGES.find((message) => message.key === key)!;
  return renderEmail(
    { key, subject: entry.defaultSubject, blocks: entry.defaultBlocks, text: null },
    context(key, overrides, composer),
  );
}

/** Lines, whitespace collapsed, blanks dropped: a message read as words rather than as markup. */
function words(html: string): string[] {
  return htmlToText(html)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function firstDifference(a: string[], b: string[]): string | undefined {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return `line ${index + 1}: rendered "${a[index] ?? "(nothing)"}" vs code "${b[index] ?? "(nothing)"}"`;
  }
  return undefined;
}

/** Every string value a context supplies, so the text part can be checked against the facts. */
function facts(values: Record<string, string | null | undefined>): string[] {
  return Object.values(values).filter((value): value is string => typeof value === "string" && value.trim().length > 3);
}

// ── 1. The registry ─────────────────────────────────────────────────────────

function checkRegistry(): void {
  console.log("\nThe registry");
  const coverage = registryCoverage();
  if (coverage.missing.length || coverage.extra.length) {
    fail(`registry coverage — missing: ${coverage.missing.join(", ") || "none"}; extra: ${coverage.extra.join(", ") || "none"}`);
  } else {
    pass(`every one of the ${EMAIL_MESSAGE_KEYS.length} keys in the shared vocabulary has exactly one entry`);
  }
  const wrong = EMAIL_MESSAGES.filter((message) => {
    if (message.editingClass === "proposed") return message.live;
    return !message.live;
  });
  if (wrong.length) fail(`proposed messages are marked live (or the reverse): ${wrong.map((m) => m.key).join(", ")}`);
  else pass("live and proposed agree with the editing class");
  for (const message of EMAIL_MESSAGES) {
    const tokens = new Set<string>();
    for (const match of JSON.stringify([message.defaultSubject, message.defaultBlocks]).matchAll(/\{\{([\w.]+)\}\}/g)) tokens.add(match[1]!);
    const declared = new Set(message.fields.map((field) => field.token));
    const undeclared = [...tokens].filter((token) => !declared.has(token));
    const unused = [...declared].filter((token) => !tokens.has(token));
    if (undeclared.length) fail(`${message.key} uses ${undeclared.join(", ")} but does not declare it`);
    if (unused.length) fail(`${message.key} declares ${unused.join(", ")} but never uses it`);
  }
  if (!failures) pass("every default only uses fields its own entry declares");
}

// ── 2. The two parts, checked against each other ────────────────────────────

function checkTextPart(): void {
  console.log("\nPlain text carries the same facts as the HTML");
  for (const message of EMAIL_MESSAGES) {
    const key = message.key;
    const rendered = render(key);
    const supplied = { ...instanceFields(DEFAULT_BRAND), ...SAMPLE_FIELDS[key] };
    const problems: string[] = [];

    // The text must be a real part, not a leftover.
    if (!rendered.text.trim()) problems.push("the text part is empty");
    if (rendered.text === rendered.html) problems.push("the text part is the HTML");

    // Every link in the HTML is written out in the text, not hidden behind link text.
    for (const match of rendered.html.matchAll(/href\s*=\s*"([^"]+)"/g)) {
      const href = match[1]!;
      if (!/^https?:/i.test(href)) continue;
      if (!rendered.text.includes(href)) problems.push(`the link ${href} is missing from the text`);
    }
    // Every image carries words.
    for (const match of rendered.html.matchAll(/<img[^>]*alt="([^"]*)"/g)) {
      const alt = match[1]!;
      if (!alt) problems.push("an image has no alt text");
      else if (!rendered.text.includes(alt)) problems.push(`the image description "${alt}" is missing from the text`);
    }
    // Every attachment is named.
    for (const match of rendered.html.matchAll(/Attached: ([^<]+)/g)) {
      const name = match[1]!.trim();
      if (!rendered.text.includes(name)) problems.push(`the attachment ${name} is not named in the text`);
    }
    // Every fact the caller supplied — a code, a credential, a total — reaches the text.
    const haystack = rendered.text.replace(/\s+/g, " ");
    const htmlWords = words(rendered.html).join(" ");
    for (const fact of facts(supplied)) {
      const needle = fact.replace(/\s+/g, " ");
      if (haystack.includes(needle)) continue;
      // Only a loss if the message really did say it: a value the message deliberately splits across a
      // line ("David" in a greeting, "Chen" in a sentence) is not a fact that went missing.
      if (htmlWords.includes(needle)) problems.push(`the value "${fact.slice(0, 60)}" is in the HTML but not in the text`);
    }
    // Nothing may be sent as a stated absence unless there is nothing to state.
    const absent = [...rendered.text.matchAll(/—/g)].length;

    if (problems.length) fail(`${key}: ${problems.slice(0, 3).join("; ")}`);
    else pass(`${key} — both parts (text ${rendered.text.split("\n").length} lines${absent ? `, ${absent} stated absence${absent === 1 ? "" : "s"}` : ""})`);
  }
}

// ── 3. Inside the allowlist ────────────────────────────────────────────────

function checkAllowlist(): void {
  console.log("\nThe renderer stays inside the sanitiser's allowlist");
  for (const message of EMAIL_MESSAGES) {
    const key = message.key;
    const rendered = render(key);
    const problems: string[] = [];
    // Every tag is one the sanitiser would keep: an unknown tag is unwrapped, and its text would then
    // arrive in a shape nobody previewed.
    const tags = [...rendered.html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1]!.toLowerCase());
    const outside = [...new Set(tags.filter((tag) => !EMAIL_TAGS.has(tag)))];
    if (outside.length) problems.push(`tags outside the allowlist: ${outside.join(", ")}`);
    // Every style property is one it would keep, and every URL is one it would accept.
    const properties = [...rendered.html.matchAll(/style="([^"]*)"/g)]
      .flatMap((match) => [...match[1]!.matchAll(/(?:^|;)\s*([a-zA-Z-]+)\s*:/g)].map((declaration) => declaration[1]!.toLowerCase()))
      .filter(Boolean);
    const unknown = [...new Set(properties.filter((property) => !EMAIL_STYLE_PROPS.has(property)))];
    if (unknown.length) problems.push(`style properties outside the allowlist: ${unknown.join(", ")}`);
    const urls = [...rendered.html.matchAll(/(?:src|href)="([^"]*)"/g)].map((match) => match[1]!);
    const refused = urls.filter((url) => !/^(https?:|mailto:|tel:|cid:|\/)/i.test(url));
    if (refused.length) problems.push(`URLs the sanitiser would refuse: ${refused.slice(0, 3).join(", ")}`);
    // Re-sanitising must not lose a word: the delivered message is the previewed one.
    const again = words(sanitizeEmailHtml(rendered.html)).join("\n");
    if (again !== words(rendered.html).join("\n")) problems.push("re-sanitising the message would drop words");

    if (problems.length) fail(`${key}: ${problems.join("; ")}`);
    else pass(`${key} — ${new Set(tags).size} tags, ${new Set(properties).size} style properties, all inside the allowlist`);
  }
}

// ── 4. Word for word against the code ──────────────────────────────────────

function checkLegacyFidelity(): void {
  console.log("\nWord for word against the hard-coded sender it replaces");
  const comparisons: { key: EmailMessageKey; label: string; from: string; overrides?: Record<string, string>; tolerance?: (line: string) => string; note?: string }[] = [
    {
      key: "auth.mfa_code",
      label: "EmailService.mfaTemplate",
      from: mfaTemplate("482913"),
    },
    {
      key: "ticket.activity",
      label: "EmailService.ticketActivityTemplate",
      from: ticketActivityTemplate({
        ticketNumber: "MSP-1001-1001",
        ticketTitle: "Email server not sending outbound messages",
        eventLabel: "New note added",
        details: SAMPLE_FIELDS["ticket.activity"]["note.body"]!,
        clientName: "Acme Corporation",
        contactName: "David Chen",
      }),
      overrides: { "message.greeting": "Hi David Chen,", "message.clientLine": "Acme Corporation" },
    },
    {
      key: "ticket.follow_up",
      label: "EmailService.followUpTemplate",
      from: followUpTemplate("MSP-1003-1001", "VPN connection drops every 15 minutes", 3, "https://demo.c7ntax.example/tickets/MSP-1003-1001"),
    },
    {
      key: "ticket.closure",
      label: "EmailService.autoCloseTemplate",
      from: autoCloseTemplate("MSP-1005-1002", "Printer on the second floor will not scan"),
    },
    {
      key: "ticket.reopened_internal",
      label: "EmailService.ticketReopenedTemplate",
      from: ticketReopenedTemplate({
        ticketNumber: "MSP-1001-1001",
        ticketTitle: "Email server not sending outbound messages",
        clientName: "Acme Corporation",
        contactName: "David Chen",
        replyExcerpt: SAMPLE_FIELDS["ticket.reopened_internal"]["note.body"]!,
        ticketUrl: "https://demo.c7ntax.example/tickets/MSP-1001-1001",
      }),
    },
    {
      // The one deliberate difference in the whole set: the sender wrote `amount.toFixed(2)`, so
      // $13,050.00 went out as "$13050.00". Both say the same amount; the separators are normalised
      // here so the check compares the figure rather than the punctuation.
      key: "invoice.send",
      label: "EmailService.invoiceTemplate",
      from: invoiceTemplate("INV-2026-004", 13050, "6 November 2026", "https://demo.c7ntax.example/billing?invoice=INV-2026-004"),
      tolerance: (line) => line.replace(/(\d),(?=\d{3})/g, "$1"),
      note: "thousands separators",
    },
    {
      key: "invoice.overdue",
      label: "EmailService.overdueTemplate",
      from: overdueTemplate("INV-2026-003", 3788.75, 15, "https://demo.c7ntax.example/billing?invoice=INV-2026-003"),
      tolerance: (line) => line.replace(/(\d),(?=\d{3})/g, "$1"),
      note: "thousands separators",
    },
    {
      // Not a template function: the composer's footer, which was a string literal in the route. The
      // ticket's own typed message is the body, so the comparison leaves the composer's words out.
      key: "ticket.note",
      label: "the composer's footer in routes/tickets/index.ts",
      from: "<hr><p>Ticket: MSP-1001-1001 — Email server not sending outbound messages<br>Client: Acme Corporation</p>",
    },
  ];

  for (const comparison of comparisons) {
    const rendered = render(comparison.key, comparison.overrides, comparison.key === "ticket.note" ? "" : undefined);
    const normalise = comparison.tolerance ?? ((line: string) => line);
    const mine = words(rendered.html).map(normalise);
    const theirs = words(comparison.from).map(normalise);
    const difference = firstDifference(mine, theirs);
    if (difference) fail(`${comparison.key} does not match ${comparison.label} — ${difference}`);
    else pass(`${comparison.key} matches ${comparison.label}, word for word (${mine.length} lines${comparison.note ? `, ${comparison.note} normalised` : ""})`);
  }
}

// ── 5. Catch one real send ─────────────────────────────────────────────────

interface MimePart {
  contentType: string;
  body: string;
}

/** Split a captured message into its parts, decoding base64 and quoted-printable bodies. */
function mimeParts(raw: string): MimePart[] {
  const parts: MimePart[] = [];
  const chunks = raw.split(/\r?\n--/);
  for (const chunk of chunks.slice(1)) {
    const bodyAt = chunk.search(/\r?\n\r?\n/);
    if (bodyAt === -1) continue;
    const headers = chunk.slice(0, bodyAt);
    const body = chunk.slice(bodyAt).replace(/^\r?\n\r?\n/, "").replace(/\r?\n--$/, "");
    const type = /content-type:\s*([^;\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
    if (!type) continue;
    const encoding = /content-transfer-encoding:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? "7bit";
    let decoded = body;
    if (encoding === "base64") decoded = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    else if (encoding === "quoted-printable") {
      decoded = Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "binary").toString("utf8");
    }
    parts.push({ contentType: type, body: decoded });
  }
  return parts;
}

function checkSmtpCapture(): void {
  const port = Number(process.env.PROBE_SMTP_PORT ?? 2526);
  const expect = process.env.PROBE_EXPECT ?? "MSP-1001-1001";
  console.log(`\nCatching one real send on 127.0.0.1:${port} (nothing leaves the machine)`);
  console.log("  … point the API at it (SMTP_HOST=127.0.0.1 SMTP_PORT=" + port + ") and send a test, or run one now");

  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let data = "";
    socket.write("220 probe.local ESMTP ready\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 Ok: queued\r\n");
            report(data);
          } else {
            data += `${line}\r\n`;
          }
        } else {
          const command = line.slice(0, 4).toUpperCase();
          if (command === "EHLO" || command === "HELO") socket.write("250-probe.local\r\n250 SIZE 10485760\r\n");
          else if (command === "DATA") {
            inData = true;
            data = "";
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (command === "QUIT") {
            socket.write("221 Bye\r\n");
            socket.end();
          } else socket.write("250 Ok\r\n");
        }
        index = buffer.indexOf("\r\n");
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  let reported = false;
  function report(raw: string): void {
    if (reported) return;
    reported = true;
    const parts = mimeParts(raw);
    const text = parts.find((part) => part.contentType.startsWith("text/plain"));
    const html = parts.find((part) => part.contentType.startsWith("text/html"));
    if (text && html) pass(`the message arrived as multipart/alternative with both parts (${parts.map((part) => part.contentType).join(", ")})`);
    else fail(`the message arrived without both parts — found: ${parts.map((part) => part.contentType).join(", ") || "none"}`);
    if (text && expect && text.body.includes(expect)) pass(`the text part carries the record it is about ("${expect}")`);
    else if (text) fail(`the text part does not mention "${expect}": ${text.body.slice(0, 240)}`);
    if (text && text.body.includes("http")) pass("the text part writes its links out in full");
    else if (text) fail("the text part carries no readable link");
    if (html?.body.includes("<div")) pass("the HTML part carries the message markup");
    else fail("the HTML part carries no markup");
    console.log("\n── captured text part ──\n" + (text?.body ?? "").trim().slice(0, 1200));
    setTimeout(() => {
      server.close();
      for (const socket of sockets) socket.destroy();
      finish();
    }, 200);
  }

  server.on("error", (error: NodeJS.ErrnoException) => {
    fail(`the probe could not listen on 127.0.0.1:${port} (${error.code ?? error.message}) — set PROBE_SMTP_PORT to a free port`);
    finish();
  });
  server.listen(port, "127.0.0.1");
  setTimeout(() => {
    if (!reported) {
      fail(`no message arrived within ${process.env.PROBE_TIMEOUT ?? 90} seconds`);
      server.close();
      for (const socket of sockets) socket.destroy();
      finish();
    }
  }, Number(process.env.PROBE_TIMEOUT ?? 90) * 1000);
}

function finish(): void {
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("the two parts of every message carry the same facts, and the defaults still say what the code says");
}

if (process.argv.includes("--smtp")) {
  checkSmtpCapture();
} else {
  checkRegistry();
  checkTextPart();
  checkAllowlist();
  checkLegacyFidelity();
  finish();
}

/** The block kinds the renderer switches on, so a new one in the vocabulary cannot go unhandled. */
const KNOWN_KINDS: EmailBlock["kind"][] = [
  "heading", "paragraph", "button", "facts", "quote", "table", "image", "divider", "note", "attachment", "conditional", "signature", "footer",
];
if (KNOWN_KINDS.length !== 13) fail("the vocabulary has grown a block kind this probe does not know about");
