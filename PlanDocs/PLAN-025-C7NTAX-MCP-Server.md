# PLAN-025 — C7NTAX as an MCP Server

> **Sequence:** filed 2026-10-08. **Not scheduled** — this is a plan for a capability, not a defect, and
> nothing else in the sequence waits on it. It absorbs and replaces **PLAN-011 phase 9** ("risk-classified
> action layer + MCP server"), whose action half is now shipped, and it answers **PLAN-013 #7**.
> **Recommended coupling:** phases 0–2 can be built now (they need nothing that is not in the codebase
> today); phases 3–5 want PLAN-016's deployment, because a remote server needs a public origin.
> **Status:** 📝 plan only — nothing built, no code in this repository yet.
> **Cost when taken:** one new workspace package, one small API addition (`GET /api/mcp/tools` and an
> `mcp` API-key source kind), and — for remote clients — OAuth 2.1 authorization-server work on an
> application that currently holds API keys and *consumes* OIDC but never issues. Phases are costed in §11.
> **Depends on:** the assistant's function registry and the action layer (both shipped, 2026.10.8.020),
> API keys with scoped permissions (shipped), and a decision in §9 on how external agents authenticate.
> **Next action:** freeze the decisions in §9 — above all **D1 (authorization)** — then build phase 0.
>
> **Protocol facts in this document were verified against the specification's own pages on 2026-10-08.**
> The MCP specification was rewritten twice in the twelve months before that, so §4 is a snapshot with a
> version stamp: **re-verify the protocol version and the authorization requirements before phase 2**, and
> treat the version strings here as the thing to check, not the thing to trust.

---

## 1. Why

C7NTAX already answers "what is the state of a client, and what should happen next" through **ten app
functions** an AI model can call, with reads running as the caller and every write raised as a
**proposal for a human to approve**. That capability is currently reachable from exactly one place: the
assistant inside our own UI, using a model the operator connected in CloudConnect.

Every MSP technician is already sitting in an AI client of their own — Claude Desktop, VS Code with
Copilot, Cursor, ChatGPT — and those clients now speak a protocol for calling tools on a remote system.
An **MCP server for C7NTAX** would let the technician ask *their* assistant the same questions, in the
tool they are already using, with the same permission model behind it. Concretely:

| The question a technician actually asks | Answered from |
|---|---|
| "What is going on with Contoso this week?" | `find_clients` → `client_overview` → `service_alerts` |
| "Which of my clients have an open incident right now?" | `service_alerts`, scoped by the key's permissions |
| "Draft a note on C7-00000042 saying we have scheduled the on-site" | `propose_ticket_note` → an `AiAction` awaiting approval |
| "Has anything in the knowledge base been fixed like this before?" | `search_knowledge_base`, `find_tickets` |

Two strategic points, both from the competitive review (PLAN-013): **MCP interop is the current
differentiator** in this market — PLAN-013 §2 records C7NTAX as the only one of three products without
it — and the *action layer* is what makes it safe to offer. "An AI can read your PSA and propose changes,
and nothing happens until a person approves it" is a much better proposition than "an AI can read your
PSA", and it is also the harder half, which we have already built.

**What this is not.** It is not exposing the 426 REST operations as 426 tools: that would be unusable for
a model (context cost, and a hundred ways to write data around the approval layer) and it would put the
business logic in a second place. The MCP server is a **thin translation of the existing function
registry**, and the registry stays the definition of what an agent may do.

---

## 2. What exists today, and where

Everything below is in this repository and shipped, which is why this plan is short on invention: the
seam was deliberately built first.

| Piece | Where | What it gives the MCP server |
|---|---|---|
| The app's ten functions, with a permission each and a read/propose split | `apps/api/src/services/ai/tools.ts` | The tool surface, its descriptions and its permissions — already written for a model to read |
| The tool loop, with the caller's permissions re-checked per call and a step ceiling | `apps/api/src/services/ai/assistant.ts` | The shape to imitate: filter what is offered, then check what is asked |
| Risk-classified proposals and their approval trail | `apps/api/src/routes/aiActions.ts`, `AiAction`/`AiActionAudit` models | Where every write goes; tiers `low`/`medium`/`high`/`critical`, `critical` unapprovable |
| The catalogue served to clients | `GET /api/inference/tools` | A running server can ask what *this key* may call instead of hard-coding a list |
| Scoped machine credentials, intersected with the owner's live permissions | `apps/api/src/services/apiKeys.ts`, `middleware/auth.ts` (`granted = ownerPermissions ∩ key.permissions`) | The authorization model, unchanged: an MCP token *is* an API key |
| Audit of who asked what | `ai_assist` entries (prompt, model, functions, outcome) | The precedent for auditing tool calls without copying the data they returned |
| Outbound request policy and its log | `apps/api/src/services/egress.ts` | Reusable for the OAuth metadata/CIMD fetches in §5 (the spec requires SSRF care there) |
| Rate limiting | `apps/api/src/middleware/rateLimiter.ts` | Per-key quotas are a middleware concern, not an MCP one |
| A documented, generated API | `docs/API.md`, `docs/openapi.yaml` (426 operations) | The transport the MCP server will call |
| The probe culture | `apps/api/probe-*.mjs` (four AI probes, 291 checks) | What §12 is written in the style of |

---

## 3. What the server exposes

### 3.1 Tools — the registry, renamed for the protocol

Tool names must be 1–128 characters of `A-Z a-z 0-9 _ - .` and unique within the server; ours already
are. The mapping is one-to-one, and **there is no second implementation of anything**:

| MCP tool | App function | Permission | Annotation |
|---|---|---|---|
| `find_clients` | find clients by name | `client:view` | `readOnlyHint: true` |
| `client_overview` | one client, with counts and recent tickets | `client:view` | `readOnlyHint: true` |
| `find_tickets` | ticket search by text, client, status | `ticket:view` | `readOnlyHint: true` |
| `ticket_detail` | one ticket, with its recent notes | `ticket:view` | `readOnlyHint: true` |
| `service_alerts` | open incidents and what was resolved | `servicealert:view` | `readOnlyHint: true` |
| `connection_health` | connections, failures, model in use | `integration:view` | `readOnlyHint: true` |
| `search_knowledge_base` | published articles | `kb:view` | `readOnlyHint: true` |
| `list_assets` | assets, optionally per client | `asset:view` | `readOnlyHint: true` |
| `propose_ticket_note` | raise a note proposal | `ticket:edit` | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` |
| `propose_ticket` | raise a new-ticket proposal | `ticket:create` | as above |

The `annotations` matter more than they look: the specification is explicit that clients **must** treat
them as untrusted hints, but a truthful `readOnlyHint` is what lets a client decide it does not need to
interrupt the user for a lookup. `destructiveHint: false` on a *proposal* is accurate — nothing is
destroyed, and nothing changes at all until a human approves — and saying so is the whole point of the
design.

Tools not in this list are not exposed: no time entries, no invoicing, no user administration, no
connector configuration. The blast radius of an agent's mistake should be a draft, not a ledger.

### 3.2 Resources — read-only, addressed by URI

Resources are worth having where a client wants to *attach* something rather than call something:
`c7ntax://client/{id}`, `c7ntax://ticket/{ticketNumber}`, `c7ntax://lead/incidents` (the same payload as
`service_alerts`), and `c7ntax://kb/{slug}`. Each is a rendering of data an existing function already
returns, so a resource cannot reveal anything a tool could not. Resource **templates** (`c7ntax://ticket/{number}`)
are the natural form for this, and — because `resources/subscribe` was removed in the current revision —
freshness comes from the client re-reading, not from us pushing.

### 3.3 Prompts — three, no more

`triage_ticket` (given a ticket number: pull the ticket, the client, the service picture, and ask for a
triage note), `client_review` (the weekly question), and `draft_reply` (a note for a customer, proposed
rather than written). Prompts are cheap and rarely surfaced by clients; three that encode *our* idea of a
good question are worth having, thirty would not be maintained.

### 3.4 What a "fetch/search" pair buys

ChatGPT's deep-research and company-knowledge connectors want a read-only `search`/`fetch` pair returning
`structuredContent` **and** the same JSON as a text block, with a `url` for citation. `search_knowledge_base`
and `ticket_detail` map onto that almost directly, and adding `mcp_search`/`mcp_fetch` tools that wrap
them is a small, contained piece of phase 3 — worth doing deliberately, because that surface is where a
"company knowledge" answer starts citing our tickets as sources.

---

## 4. The protocol, as it stands (verified 2026-10-08)

The important structural fact: **the current specification (`2026-07-28`) is stateless.** The
`initialize` handshake and protocol-level sessions are gone; every request declares its version and
capabilities in `_meta`, and servers **must** implement `server/discover`. Clients that speak the older,
handshake-based revisions (`2025-11-25` and earlier) still exist in the field, so a server that wants
both must be **dual-era** — which is a design requirement for us, not a nicety, because the clients our
users have are a mix.

| Concern | What the current revision says | What we do |
|---|---|---|
| Version | `2026-07-28` current; `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` also exist | Support the current revision properly, plus the handshake-era fallback (phase 2), and log which one each client used |
| Negotiation | No handshake: `_meta["io.modelcontextprotocol/protocolVersion"]`, mirrored to the `MCP-Protocol-Version` header; unsupported → JSON-RPC `-32022` (`UnsupportedProtocolVersion`) with `data.supported` | Serve `server/discover`; answer `-32022` with the versions we do support |
| Transports | **stdio** (newline-delimited JSON-RPC on stdin/stdout) and **Streamable HTTP**: one endpoint, **POST only**, `Accept: application/json, text/event-stream`, either a JSON response or a request-scoped SSE stream | stdio first (phase 1), Streamable HTTP second (phase 2) |
| Required headers | `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` (the last for `tools/call`, `resources/read`, `prompts/get`); mismatches → `400` + `-32020` (`HeaderMismatch`) | Validate them against the body, as the spec requires — they are a free integrity check |
| Sessions | `Mcp-Session-Id` removed; a server **should** ignore it; cross-call state uses explicit server-minted handles passed as ordinary tool arguments | We keep no session state; a handle is a ticket id, and it is bound server-side to the authenticated key (§7) |
| Server-initiated requests | Gone. `sampling`, `elicitation` and `roots` are delivered as **Multi Round-Trip Requests (MRTR)**: a result returns `InputRequiredResult`/`inputRequests` and the client replies with `inputResponses` | Not needed: our writes are proposals, not questions. `roots`/`sampling`/`logging` are deprecated and we should not adopt them |
| Tool results | `{ resultType: "complete", content: [...], structuredContent?: …, isError?: boolean }`; `structuredContent` must conform to `outputSchema` and should *also* be serialised into a text block | Give every tool an `outputSchema` and both forms: the model reads the text, the client can trust the structure |
| Errors | `isError: true` is a *tool execution* error the model should see; protocol errors (unknown tool, bad arguments) are JSON-RPC errors (`-32602`) | Our refusals ("not permitted", "no client with that id") are `isError` results with a sentence in them, exactly as the assistant returns them today |
| Deprecated | Roots, sampling, logging; HTTP+SSE transport; `ping`; `resources/subscribe`; `logging/setLevel` | Use `subscriptions/listen` if we ever push, and nothing else from that list |
| SDKs | TypeScript `@modelcontextprotocol/server` 2.3.1 (monorepo v2, Node ≥20); Python `mcp` 2.3.0; Inspector `@modelcontextprotocol/inspector` 2.10.1 | TypeScript, in this monorepo — the tool registry and its types are already TypeScript |

---

## 5. Authorization — the decision that shapes everything

An MCP server that runs on our origin and reads client data is a resource server, and the specification
says how it must behave: **OAuth 2.1**, RFC 9728 protected-resource metadata, RFC 8707 resource
indicators, tokens validated for *this* server as audience, and **no token passthrough** — a token issued
for something else must never be accepted or forwarded. A bearer token travels in the `Authorization`
header on every request, never in a query string.

C7NTAX is not an authorization server today. It *authenticates* users (sessions, passkeys) and it
*consumes* OIDC as a client for SSO; nothing in it issues OAuth grants to third parties. So there is a
real decision here, and three honest options:

**A. API keys as bearer tokens (phase 1–2).** An MCP connection is authenticated with an API key that
already exists: created in Administration → API Access, scoped to permissions, intersected with its
owner's live permissions at every request, revocable, and counted. This needs no new protocol work, and
it works with the clients that accept a static header (Cursor supports static OAuth client credentials;
VS Code takes a `headers` map; anything that runs locally takes an environment variable).
*It does not work for hosted assistants that insist on OAuth* — Claude's connectors do exactly that.

**B. Become an authorization server (phase 3).** Implement RFC 9728 metadata
(`.well-known/oauth-protected-resource`, advertising an authorization server), RFC 8414/OIDC discovery,
PKCE, RFC 8707 resource indicators, and client registration — **Client ID Metadata Documents** as the
current mechanism, with RFC 7591 DCR retained for the clients that only speak that (Claude self-registers
via DCR; it follows the `2025-11-25` authorization revision, *not* `2026-07-28`, which is exactly the kind
of detail that turns "OAuth" into a month). Authorization codes would be issued for a C7NTAX consent
screen, and the resulting access token would **be** an API key underneath, so §2's intersection rule and
the audit trail keep applying.
**C. Put an OAuth gateway in front** (Entra ID, Auth0, Keycloak). MCP servers are told by the spec to
advertise *some* authorization server, and a gateway can be it. The cost moves from code to
configuration and a dependency; the mapping problem moves to "how does a gateway identity become a
C7NTAX user and a permission set", which is the SSO work we already do — but it also adds an external
party to a trust path that currently ends at this application.

**Recommendation: A now, B when a hosted client is genuinely wanted, C only if the estate already runs an
identity provider the customer trusts.** The reasons are the ones this codebase keeps arriving at: the
permission model already exists and is enforced in one place, and an API key is a thing an MSP already
knows how to issue, scope and revoke.

Two consequences worth writing down before anyone builds it:

- **Per-key identity is the scope.** `granted = ownerPermissions ∩ key.permissions` means an MCP key can
  never exceed the person who issued it, and deactivating that person's account stops it. The MCP server
  must not add a second, weaker notion of "what this connection may do".
- **The MCP *client* is not the user.** The token belongs to a key; every destructive decision still
  belongs to a named human in the application (§6). "MCP interop" must not become a way around the
  approval layer.

---

## 6. Writes: proposals, never actions

This is the part of the design that should not be "paused for later".

> **Related:** **PLAN-026** (filed 2026-10-08, after this plan) widens the same surface to the whole
> application and introduces an **opt-in `act` mode** in which `low`/`medium` actions apply without a
> click. When that lands, the tools exposed here come from PLAN-026's manifest, and the rule below
> becomes narrower rather than void: **no tool approves somebody else's action** — a model may confirm
> its own just-proposed action once, by a single-use token bound to the caller and the exact
> arguments, which is what a client's own permission prompt is for. Nothing in this plan's MCP surface
> executes `critical` actions, and `high` still requires a person's click.

- **Reads execute. Writes propose.** `propose_ticket_note` and `propose_ticket` raise a risk-classified
  `AiAction` and return `{ proposalId, status: "pending", approveUrl }` as `structuredContent` with
  `isError: false` — because nothing went wrong; a proposal is the successful outcome.
- **No approval tool.** There is deliberately no `approve_proposal` tool: approval is a human decision in
  the AI Actions screen, where the diff, the requester and the audit trail are visible. A model that can
  approve its own proposal has outsourced the review to the thing being reviewed. The specification's own
  position — hosts *must* obtain explicit user consent before invoking a tool, and tool definitions are
  untrusted — points the same way.
- **`riskTier` is our business, not the client's.** The tier is decided server-side (`critical` is
  unapprovable), so a client cannot argue a proposal into a lower tier.
- **Idempotency:** a proposal is not idempotent and must not pretend to be. A retried call raises a
  second proposal, which is visible and rejectable — better than silently swallowing a retry and leaving
  the operator unsure whether the note exists.

---

## 7. Security

Client data, third-party models, and a protocol designed to be called by an automated agent: the risks
here are not hypothetical, and the specification publishes its own list. What we do about each:

- **Prompt injection through our own data.** A ticket body, a note, a client name and a knowledge-base
  article are all attacker-influenced text that we hand to a model as tool output. The rule: **tool
  results are data, never instructions.** Concretely — writes only ever become proposals, the tier is set
  server-side, no tool accepts "instructions from the last result" as an argument, and the server never
  chains a write off a read the model did not explicitly ask for. This is also why there is no
  `approve` tool (§6): the injection's best outcome is a proposal a human sees.
- **Token passthrough is forbidden** (spec MUST). We accept only keys issued by us, for us. If the
  MCP server is ever fronted by a gateway, the gateway's token is exchanged, never forwarded.
- **State-handle hijacking.** With sessions gone, any handle we mint (a report id, a pagination cursor) is
  bound server-side to the authenticated key, is non-deterministic, and is **never** treated as
  authentication. `Mcp-Session-Id` is ignored if a client sends one.
- **Confused deputy** (if we proxy to a customer's own identity provider) — per-client consent that names
  the client, exact-match redirect URIs, `state` stored server-side and single-use. This is why option C
  in §5 is not free.
- **SSRF in discovery.** RFC 9728 metadata URLs and CIMD documents are fetched from third parties; the
  spec tells clients to be careful, and a *server* that fetches a CIMD URL inherits the problem. Our
  existing egress policy (private/link-local refusal, redirect re-validation, an allow log) is the
  answer — and it means CIMD can be supported without opening a hole.
- **Scope minimisation.** One key per MCP client, named for it, with the narrowest permissions that make
  it useful; `sourceKind: "mcp"` in the key inventory so the list says what each key is for.
- **Audit without data.** Every `tools/call` writes an audit entry naming the key, the tool, the outcome
  and the arguments' *shape* — not the records returned, for the same reason the assistant does not: an
  audit table is not the place for a second copy of client data under weaker rules.
- **Rate limiting and ceilings**: the existing limiter plus a per-key quota; a hard cap on tool calls per
  request and page sizes, so one agent cannot walk an estate.
- **Logs**: no tokens, no secrets, no personal data in log lines (the spec says log messages must not
  contain credentials or PII; we should also not put ticket bodies in them).
- **What we cannot control**: the prompts and the returned data go to whichever model the *user's* client
  uses, under that vendor's terms. That is the same sentence CloudConnect's model guidance already says
  out loud, and the MCP surface needs its own version of it — an operator deciding whether to connect a
  key should be told which clients will hold their data, exactly as they are told which vendors do.

---

## 8. Where it lives, and how it is built

**A new workspace package, `apps/mcp`** (TypeScript, `@modelcontextprotocol/server`), with two entry
points: `stdio` for local use and an HTTP handler for the hosted one. It is deliberately **not** mounted
inside `apps/api`: the API's entry point starts a server, a poller and four workers as a side effect of
being imported, which the assistant's own probe work already ran into.

**It talks to the API over HTTP with an API key, rather than to Postgres directly.** Three reasons: the
permission intersection, the rate limiter and the audit trail are enforced in the middleware and would
have to be reimplemented otherwise; every read then goes through the same code path the UI uses, so a
scoping bug shows up in both places at once; and the API is the thing with the published contract.

The consequence is that the MCP server needs a **catalogue endpoint it can call as a key**: today
`GET /api/inference/tools` needs `inference:view` and returns the caller's slice, which is almost right —
so phase 0 adds `GET /api/mcp/tools` (or widens the existing one) returning the tools this key may use,
their schemas and their annotations, plus `sourceKind: "mcp"` for keys. That keeps §3's promise — one
registry — true even across the process boundary.

**A design consequence worth stating:** the MCP server is a *translator*, so it holds no business logic
and no schema knowledge. Anything it could do that the API cannot is a bug.

---

## 9. Decisions to freeze (with recommendations)

| # | Decision | Recommendation | If taken the other way |
|---|---|---|---|
| **D1** | How external agents authenticate | **API keys as bearer tokens first** (§5A); OAuth 2.1 with CIMD/DCR as phase 3 for hosted clients | Choosing OAuth on day one adds the consent screen, the metadata endpoints and a client-registration policy before anything is callable |
| **D2** | Tool surface | **The eight reads and two proposals**, nothing else | A broader surface (time entries, invoices) makes an agent's mistake expensive and the review burden real |
| **D3** | Can an agent write at all? | **Only as proposals** — no approval tool, no direct writes | Direct writes would make the approval layer advisory and the audit trail a formality |
| **D4** | Transports | **stdio (phase 1) then Streamable HTTP (phase 2)**, both from one codebase | HTTP-only shuts out local clients that are the easiest first win |
| **D5** | Dual-era support | **Yes** — current revision plus the `initialize` handshake | Modern-only would silently fail for Claude-as-it-is-today and older clients |
| **D6** | Hosting | Same origin as the API (`/mcp`) in the existing deployment; a separate service only if a client needs it | A separate origin needs its own certificate, WAF rules and rate limits |
| **D7** | Whether we also become an MCP **client** | **Separate plan.** The connector catalogue is the wrong place for a first MCP experiment | Doing both at once doubles the security surface (inbound *and* outbound tool calls) |
| **D8** | Multi-tenant shape | One server, many keys — the key decides the tenant's scope | Depends on PLAN-003; today's instance is single-tenant |

---

## 10. Phases

Each phase ends with something a person can watch work, and with a probe of the kind this repository
already writes (`apps/api/probe-*.mjs`, 291 AI checks to date).

**Phase 0 — contract, catalogue, and a fixture (½ day).** `GET /api/mcp/tools` returns the key's tools
with JSON Schemas and annotations; `sourceKind: "mcp"` accepted for keys; a fixture that issues a key for
a test persona. **Probe:** every registered tool appears exactly once with a valid schema and an
annotation set; a key without `ticket:view` does not see `find_tickets`; the tool names satisfy the
protocol's character and length rules.

**Phase 1 — stdio server, read-only (1–2 days).** `apps/mcp` with `server/discover`, `tools/list`,
`tools/call` for the eight reads, calling the API with a key from the environment. **Acceptance:** the
MCP Inspector lists the tools and a real call returns a client's tickets; `tools/call` on
`propose_ticket_note` returns a refusal naming the missing permission. **Probe:** protocol-level —
`server/discover` answers, an unsupported version gets `-32022`, a `tools/call` with a bad argument is
`-32602`, a refusal is `isError` with a sentence rather than a crash, and stdout carries nothing but MCP
messages.

**Phase 2 — remote HTTP (2–3 days).** Streamable HTTP on the API origin: POST-only endpoint, the
`MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers validated against the body, `Origin` checked,
401 with `WWW-Authenticate` when the key is absent or bad, `405` for GET/DELETE, and the handshake-era
fallback for older clients. **Acceptance:** VS Code (or Cursor) configured against the URL answers a
question about a real client; the access log shows which protocol era each client used. **Probe:** header
mismatch → `400`/`-32020`; missing bearer → `401` with metadata; a valid key with no `client:view` → a
refusal, not an empty answer.

**Phase 3 — OAuth 2.1, resources and prompts (3–5 days).** RFC 9728 metadata and RFC 8707 resource
indicators, PKCE, CIMD (+ DCR for clients that need it), the consent screen, and access tokens that *are*
API keys underneath. Resources and templates, and the three prompts. The ChatGPT-shaped
`search`/`fetch` pair. **Acceptance:** a hosted assistant completes the flow and calls a read tool;
revoking the key stops it within one request. **Probe:** a token minted for another audience is refused;
a code redeemed twice is refused; the consent screen's recorded client matches the one that then calls.

**Phase 4 — proposals over MCP (1–2 days).** The two proposal tools, with `structuredContent` carrying
the proposal id and a link, and the audit entry naming the key. **Acceptance:** asking a client's
assistant to draft a note leaves the ticket untouched and the AI Actions screen showing a pending
proposal from *that key*. **Probe:** the ticket's note count is unchanged after the call (the assertion
the assistant's probe already makes); a proposal raised by a key without `ticket:edit` is refused; the
tier is `low` for an internal note and never settable by the caller.

**Phase 5 — packaging and discovery (1 day).** README and operator documentation, the API guide's MCP
section, a client-configuration snippet for each supported client, and — if we want to be discoverable —
an entry in the official MCP registry. **Acceptance:** a technician can be sent one page and be running
it in five minutes.

---

## 11. Costs, honestly

- **Phases 0–2 are the cheap part** (≈4 days) and deliver the thing people actually ask for: "my
  assistant, my PSA". They need no new protocol beyond the two transports and no identity work.
- **Phase 3 is the expensive part** (≈5 days) and is *only* needed for hosted assistants. It is also the
  part where the specification has moved twice in a year, where Claude follows an older authorization
  revision than the current one, and where VS Code's and ChatGPT's registration expectations were not
  verifiable from primary sources (flagged UNCERTAIN in the research this plan is built on). Treat the
  estimate as a range and phase 3 as schedulable separately.
- **What it does not solve:** it does not make the RAG/agentic work in PLAN-011 happen (this is the
  *interface* to our functions, not the retrieval layer), it does not add any new business capability,
  and it does not remove the need for the assistant inside the UI — that stays the zero-setup path for
  somebody who has no MCP client.
- **What it inherits:** every permission decision, every proposal rule and every audit behaviour is the
  assistant's. If the assistant's tool surface is wrong, MCP will expose that more publicly, not less.

---

## 12. How it will be verified

Following the pattern the AI work already established:

1. **Probes first, per phase** (`apps/api/probe-mcp-*.mjs` / `apps/mcp/probe-*.mts`), asserting protocol
   behaviour with a stub client where the vendor would be, and real calls where the API is ours.
2. **The MCP Inspector** (`@modelcontextprotocol/inspector` 2.10.1) as the independent client that has no
   knowledge of our assumptions — it is the closest thing to a conformance check.
3. **Two real clients**, one stdio and one remote, driven by hand in a throwaway session.
4. **The persona battery**: the same call as an administrator, a technician and a read-only persona, to
   prove the refusal comes from the permission model rather than from the MCP layer.
5. **A negative pass**: a key with no permissions, a token for another audience, a retired key, an
   oversized argument, a tool named in a call that was never offered.
6. **The unchanged-ticket assertion** for every write path — the one that proves the approval layer still
   holds from the outside.

---

## 13. What would make this plan wrong

- **If the specification's authorization revision keeps moving** (three revisions in a year), phase 3
  should be re-decided against the spec of that day rather than implemented as written here.
- **If the clients converge on hosting the model server-side** with their own tool registries, the local
  stdio path loses most of its value and phase 2 matters more than phase 1.
- **If PLAN-003 (multi-tenancy) lands**, §8's "one server, many keys" needs re-reading: the key's owner
  carries a tenant today only implicitly, and an MCP client is a long-lived credential in a way a
  browser session is not.
- **If the action layer is ever loosened** (direct writes from an agent), this plan's safety argument
  collapses with it.

---

## 14. Related work

- **PLAN-011** (Bedrock agentic RAG assistant) — its phase 9 was "risk-classified action layer + MCP
  server"; the action layer shipped (2026.10.8.020) and this plan takes the MCP half. **PLAN-011 should be
  edited to hand phase 9 over** when this plan is picked up, so the same work is not scheduled twice.
- **PLAN-013 #7** — the competitive gap this closes.
- **PLAN-016** — a remote MCP endpoint wants the deployment's public origin and its WAF; phases 3+ depend
  on it.
- **PLAN-003** — multi-tenancy, which decides what an MCP key's identity means in a shared instance.
- **Not planned here:** C7NTAX as an MCP *client* (calling other people's MCP servers as connectors). That
  is a different trust direction and belongs in its own plan.
