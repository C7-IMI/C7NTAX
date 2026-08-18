> **Plan ID:** PLAN-011
> **Title:** Bedrock Agentic RAG AI Assistant for PSA Plan
> **Source:** `PLAN-Bedrock-Agentic-RAG-AI-Assistant.md` (original remains in place)
> **Indexed:** 2026-08-18

# Bedrock Agentic RAG AI Assistant for PSA — Implementation Plan

**Plan Label:** Bedrock Agentic RAG AI Assistant for PSA Plan
**Status:** Proposed (plan only — no implementation yet)
**Date:** 2026-08-18

---

## 1. Goal

Build an AI assistant for the C7NTAX PSA platform that: triages tickets and
suggests fixes from historical ticket data (RAG), triggers web searches when
internal knowledge is insufficient, and batch-generates KB articles — all
natively in AWS using **Amazon Bedrock Agents + Knowledge Bases** so ticket
data never leaves the AWS environment and is never used to train base models.

## 2. Current state (verified in codebase)

| Area | What exists today |
|---|---|
| Inference service | `apps/api/src/services/inference/` — `LlmProvider.ts` (OpenAI-compatible endpoints, memoized prompt prefix, 6000-char excerpt, `INFERENCE_MODEL` env override), `Orchestrator.ts`, `PatternDetector.ts`, `SearchEngine.ts`, `types.ts` |
| Routes | `/api/inference` (`routes/inference.ts`) and `/api/kb` (`routes/kb.ts`) mounted in `index.ts` |
| KB storage | `knowledgeBaseArticle` Prisma model (seeded 4 articles) |
| Ticket data | `Ticket` + `TicketComment` models; snapshot export tooling already exists (`snapshot-capture.ts` → `src/snapshots/*.json`) |
| Multi-tenancy | PLAN-003: `Tenant` model + `Company.tenantId` (Phase 1 complete; middleware/isolation pending) |
| AWS infra | PLAN-010: dev/prod split (ECS, ALB ports, RDS dev/prod, Secrets Manager); PLAN-007 SOC 2 controls (KMS, WAF, PrivateLink, audit) |

The existing inference stack is provider-agnostic at the HTTP level, which
makes the Bedrock swap additive rather than a rewrite.

## 3. Architecture blueprint (per requirement)

```
Ticket UI ──▶ PSA API (/api/inference) ──▶ API Gateway (IAM-authed) ──▶ Bedrock Agent (Claude 3.5 Sonnet / Llama 3)
                                              │ InvokeAgent (session_id + ticket details)
                                              ├─ Knowledge Base (RAG): S3 ticket exports → Titan embeddings → OpenSearch Serverless
                                              │    └─ metadata filter: tenant_id (per PLAN-003)
                                              └─ Action Group: Lambda `search_web(query)` → Tavily / Brave / SerpApi → top-3 parsed results

KB generation (batch): EventBridge weekly cron → Step Functions → pull "Resolved" tickets by tag → Bedrock LLM
                       (strict SOP-extraction prompt) → Markdown article → PSA API (`POST /api/kb`)
```

- **Core LLM:** Amazon Bedrock Agents — Claude 3.5 Sonnet (default) or Llama 3
  for open-weight/compliance preference. No GPU management; data stays in AWS.
- **RAG:** sync PSA DB (RDS) → S3 (scheduled export; reuse the snapshot-capture
  JSON shape as the export format) → Bedrock Knowledge Base with Amazon Titan
  Embeddings → OpenSearch Serverless vector store → similarity search over past
  tickets feeds the LLM suggested fixes.
- **Web search:** Bedrock Action Group → Lambda → search API (Tavily/Brave/
  SerpApi); the agent autonomously writes the query, invokes the Lambda, reads
  results, synthesizes an answer when RAG returns nothing.
- **KB generation:** Step Functions + EventBridge weekly trigger; batch of
  "Resolved" tickets with a tag (e.g. "Network Outage") → strict prompt
  ("Extract root cause and standard operating procedure … output Markdown") →
  article written back to the PSA DB via the `/api/kb` API.

## 4. Mapping onto the existing codebase

- `LlmProvider.ts` → add `BedrockProvider` behind the same interface
  (`buildRequestBody` → `InvokeAgent` request; `INFERENCE_BASE_URL`/`INFERENCE_API_KEY`
  env vars per PLAN-010 §11; keep the OpenAI-compatible provider as dev fallback).
- `Orchestrator.ts` → becomes the agent session driver (session_id + streaming
  responses to the frontend).
- `SearchEngine.ts` → replaced/augmented by the Bedrock Action Group Lambda
  (kept as a local fallback for dev when Bedrock is not configured).
- `routes/inference.ts` → proxies to API Gateway with IAM auth; response
  streams back in real time (SSE) to the ticket UI.
- `routes/kb.ts` + `knowledgeBaseArticle` → ingestion endpoint for Step
  Functions KB articles (idempotent upsert by title/slug).
- Multi-tenant (PLAN-003): every KB sync/query includes `tenant_id` metadata;
  query-time metadata filter limits retrieval to the ticket's tenant.

## 5. Implementation phases (dependency-ordered — prerequisites first)

| # | Item | Depends on | Risk if prerequisite is skipped |
|---|---|---|---|
| 1 | **Data foundation:** S3 bucket + scheduled RDS→S3 ticket export (DMS or Lambda ETL reusing snapshot JSON); OpenSearch Serverless collection; Bedrock Knowledge Base pointed at S3; Titan embeddings; KB↔OpenSearch sync | PLAN-010 #1/#2 (VPC + RDS in AWS) | No vector store → RAG can't retrieve; agent has no historical context and returns generic answers. |
| 2 | **Bedrock Agent:** create agent, assign Claude 3.5 Sonnet (or Llama 3), strict PSA system instructions (triage, suggest fixes, ask clarifying questions, use WebSearch when lacking internal data), link Knowledge Base from #1 | #1 | Agent has no knowledge source; triage quality collapses to model priors. |
| 3 | **Web search Action Group:** Lambda `search_web(query)` (Python) hitting Tavily/Brave/SerpApi, returning top-3 parsed results; OpenAPI schema for the function; attach to the agent as an Action Group | #2 (agent must exist) | Unknown error codes can't be researched; agent hallucinates or dead-ends. |
| 4 | **API integration:** API Gateway in front of `InvokeAgent`, IAM so only authenticated app users can invoke; PSA backend (`BedrockProvider` + `/api/inference` proxy) sends session_id + ticket details and streams the reply | #2, #3; PLAN-010 #4 (app in AWS VPC) | Frontend can't reach the agent; or unauthenticated invocation leaks ticket data. |
| 5 | **Frontend integration:** ticket detail AI panel (streamed responses, suggested fixes, clarifying questions) | #4 | Users have no UI surface; feature invisible. |
| 6 | **KB batch generation:** EventBridge weekly cron → Step Functions; pull "Resolved" tickets by tag; strict SOP-extraction prompt; push Markdown article back via `/api/kb` (idempotent upsert) | #1 (data), #4 (authenticated API write path) | Articles can't be produced or can't be stored; manual KB upkeep burden returns. |
| 7 | **Security hardening:** Bedrock Guardrails (prompt-injection blocking, no harmful output, no prompt-instruction leakage); tenant_id metadata filter on all KB queries; PrivateLink/VPC endpoints for app→API GW, Lambda→OpenSearch (no public internet); PII redaction before prompts; CloudTrail/audit of every invocation | #1 (KB), #4 (invocation path); PLAN-007/PLAN-010 security sections | Ticket data could traverse public networks; cross-tenant retrieval leaks one client's tickets to another; prompt injection could exfiltrate instructions. |
| 8 | **Validation & runbook:** end-to-end rehearsal (triage a seeded ticket, web-search path, KB batch), cost/latency budget check, rollback runbook | #1–#7 | Untested agent ships to technicians; no recovery path if Bedrock misbehaves. |

All phases are additive; the existing dev inference provider keeps working
until #4 switches environments via env config.

## 6. Security & performance considerations (from requirement + PLAN-007)

- **VPC Endpoints (PrivateLink):** app servers, Lambda, and OpenSearch
  communicate via VPC endpoints — ticket data never traverses the public
  internet.
- **Data partitioning (multi-tenant):** `tenant_id` metadata on every vector;
  query-time metadata filter scopes retrieval to the ticket's client
  organization (aligns with PLAN-003 Phase 2/3).
- **Prompt-injection protection:** Bedrock Guardrails block malicious inputs
  attempting harmful outputs or instruction leakage; add PII redaction layer
  before prompts leave the app.
- **Perf:** embedding batch on export; cache frequent KB queries; cap search
  results (top 3); monitor Bedrock latency/limits (429 backoff like the email
  connector plan).

## 7. Rollback plan

- **Instant stop:** set `BEDROCK_ENABLED=false` (or clear `INFERENCE_BASE_URL`)
  — `/api/inference` falls back to the existing OpenAI-compatible provider;
  no user-visible outage.
- **Infra rollback:** delete/detach the Action Group or disable the Knowledge
  Base; the PSA app is untouched.
- **KB articles:** generated articles are normal `knowledgeBaseArticle` rows —
  remove via the existing KB UI/API if unwanted.
- **Code rollback:** `BedrockProvider` and the API-Gateway proxy are additive
  files/routes; revert restores the previous inference path.

## 8. Verification plan

- **RAG quality:** seed a ticket resembling a known historical fix; agent must
  cite the retrieved ticket's solution (tenant filter verified: cross-tenant
  query returns nothing).
- **Web search:** ticket with an unknown error code → agent invokes
  `search_web`, returns cited top-3 sources.
- **KB batch:** run the Step Function manually → article appears in
  `/api/kb` and KB page with correct Markdown.
- **Security:** Guardrails block a prompt-injection attempt; CloudTrail shows
  the invocation; no cross-tenant retrieval.
- **Regression:** existing inference endpoints, KB page, boot pipeline, and
  typecheck baselines unchanged.

## 9. Open decisions to confirm before implementation

1. Model: Claude 3.5 Sonnet vs Llama 3 (compliance preference).
2. Embeddings: Amazon Titan vs Cohere Embed on Bedrock.
3. Search provider: Tavily vs Brave vs SerpApi (cost/terms).
4. RDS→S3 sync mechanism: DMS vs scheduled Lambda ETL (reuse snapshot JSON).
5. Batch cadence + target tag set for KB generation.
6. Cost ceiling / throttling for Bedrock invocations.
