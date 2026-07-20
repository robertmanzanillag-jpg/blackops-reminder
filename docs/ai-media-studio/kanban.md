# AI Media Studio Delivery Board

Flow: **Backlog -> Ready -> In progress -> Checker review -> App QA -> Done**. A blocked card records owner, evidence, and the exact unblock condition. Only one agent edits a file at a time.

## Phase 0 — Foundation

| Card | Owner | State | Exit evidence |
| --- | --- | --- | --- |
| AMS-001 Boundary and ADR | Lead | Checker review | ADR and module ownership accepted |
| AMS-002 Shared HTTP DTOs | Lead | Checker review | Zod schemas consumed by UI/API |
| AMS-003 Provider ports/state model | Backend | Checker review | Fake provider contract tests |
| AMS-004 Security/cost gates | Backend + checker | Checker review | Deny-default flags, HMAC and replay tests |

## Phase 1 — First vertical PR

| Card | Owner | State | Exit evidence |
| --- | --- | --- | --- |
| AMS-101 Studio page and route | Frontend + Lead | Checker review | Authenticated `/ai-media-studio` renders |
| AMS-102 Dashboard/options/jobs UI | Frontend | Checker review | Loading, empty, error and populated states |
| AMS-103 Generation orchestrator | Backend | Checker review | Create returns `202`; provider-neutral state |
| AMS-104 Fake provider/local queue | Backend | Checker review | Deterministic create/retry/cancel tests |
| AMS-105 Signed provider webhook | Backend + Lead | Checker review | Invalid, expired and replayed HMAC rejected |
| AMS-106 Contract/integration tests | Backend + checker | Checker review | DTO, HTTP and lifecycle checks pass |
| AMS-107 App QA release gate | QA | Blocked | Re-run route, clicks, API, errors and improvements after fixes |
| AMS-108 Source snapshot contract | Lead | Checker review | Eight source types and bounded Zod input covered |
| AMS-109 Deterministic script variants | Backend | In progress | Grounded primary script and 1–5 variants at `$0.00` |
| AMS-110 Script variants UI | Frontend | In progress | Generate, select and copy/use a variant |
| AMS-111 Dashboard entry point | Lead | Checker review | Inbound `/ai-media-studio` link is keyboard accessible |

PR 1 acceptance: a signed-in user can create grounded script variants from a bounded source snapshot, select a script, submit a vertical fake render job, and retry/cancel through provider-neutral APIs. It performs no paid render, external post, or automatic publishing. With `DATABASE_URL`, the runtime selects Drizzle; in-memory storage is limited to development/test, and production without a database fails closed with `503`.

## Phase 2 — Durable core

| Card | State | Exit evidence |
| --- | --- | --- |
| AMS-201 Additive schema and migration strategy | Blocked | Schema is re-exported; reviewed SQL and staging migration are a hard deploy gate |
| AMS-202 Repository and generation history | Checker review | Drizzle is wired when `DATABASE_URL` exists; restart and tenant-isolation gates remain |
| AMS-203 Outbox and durable queue | Backlog | Lease/retry/dead-letter/idempotency tests |
| AMS-204 Object-storage asset ingest | Backlog | Checksum, limits, SSRF and signed URL tests |
| AMS-205 HeyGen adapter | Backlog | Sandbox contract test; cost approval gate |

The durable Drizzle models are re-exported from the central schema and the composition root selects `DrizzleMediaJobRepository` when `DATABASE_URL` is configured. In-memory storage is allowed only in development/test; production without a database returns `503`. No migration or `db:push` has run. Deployment is blocked until reviewed SQL, staging migration, restart recovery, tenant isolation, rollback evidence, App QA, and Robert's explicit approval all pass.

## Phase 3 — Content engine

Influencer CRUD and consent records; avatar/voice catalog; scripts, hooks, CTA, captions, hashtags, SEO and alternatives; reusable brand assets; moderation and quality scoring.

## Phase 4 — Publishing and analytics

TikTok, Instagram, Facebook and YouTube Shorts adapters; manual/scheduled queues first; automatic publishing only after approval controls. Ingest views, likes, shares, comments, CTR, retention, watch time, costs, and performance dimensions.

## Phase 5 — Autonomous source workflows

Pilot Radio Calendar events, then restaurants, hotels, deals and travel packages. Every trigger passes dedupe, rights, budget, moderation, quality and publishing-policy gates. New integrations create drafts by default.

## Phase 6 — Scale

Distributed workers, provider quotas, backpressure, partitioning, multi-country/language policy, SLO dashboards, disaster recovery and load tests at burst rates consistent with 10,000+ videos/day.

## Merge gates

1. PR on a `codex/` branch; no direct agent changes to `main`.
2. Targeted unit, contract, integration, typecheck and build evidence.
3. Independent checker reviews diff, routes/APIs, security, missing tests and rollback.
4. App QA route, link/click, API, error and improvement scouts pass without warnings.
5. PR summary states risk, files, checks, QA, deployment status and rollback.
6. Replit deployment waits for Robert's explicit approval.
