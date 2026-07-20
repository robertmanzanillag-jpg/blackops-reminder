# AI Media Studio Requirements Matrix

This matrix maps the original AI Media Studio brief to repository evidence. Status describes implementation evidence on the current code/PR stack, not production deployment.

- **Proved**: implemented and covered by focused code/tests or an accepted PR review.
- **Partial**: a contract, schema, adapter, or UI exists, but an operational path or release gate is still missing.
- **Missing**: no implementation evidence exists yet.

PR #67 is the clean, mergeable foundation. PR2 is stacked on it in `codex/ai-media-studio-core`; PR2 must be reviewed as the delta from PR #67, not as a replacement for its base.

## Platform foundation

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Independent AI Media Studio area inside Kong | Proved | `/ai-media-studio`, `server/ai-media-studio/**`, shared contracts, Dashboard entry | Keep module boundaries intact through PR2 |
| Provider-neutral business logic | Proved | `ports.ts`, `service.ts`, fake and HeyGen adapters; requests contain internal refs, not provider IDs | Contract tests required for every new provider |
| Replace HeyGen without changing use cases/UI | Proved | `VideoProvider` port and provider-neutral DTOs | Add a second production adapter before claiming operational portability |
| Independently deployable media platform | Partial | Domain is isolated but still shares the Express/React application deployment | Define service extraction trigger, ownership and data/API boundary before separate deployment |
| Enterprise-ready production operation | Missing | Architecture and schema anticipate it, but migration, distributed queue, object storage, SLOs and load evidence are absent | Complete PR2/PR3 gates below |

## Dashboard

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Videos generated today | Proved | Dashboard DTO/API/UI derives daily generation count | Validate against durable staging data and timezone policy |
| Videos published | Partial | Field exists and UI renders it; current API reports zero | Connect durable publications and platform reconciliation |
| Pending and failed jobs | Proved | Durable/domain status model, dashboard response and UI cards | Verify counts after restart in staging |
| Average generation time | Proved | API computes completed-job duration; UI renders it | Define percentile/SLO metrics for scale |
| Estimated cost | Proved | Per-job/shared cost fields and dashboard aggregate | Add provider billing reconciliation and budget alerts |
| Provider status | Proved | Provider health contract and dashboard UI | Add active polling/alerting and provider-specific SLOs |
| Current queue and rendering jobs | Proved | Queue snapshot/status cards and jobs list | Replace process-local worker queue before multi-worker operation |
| Recent activity | Proved | Dashboard activity response and UI | Back it with durable audit/history after migration |

## AI influencers

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Unlimited influencer CRUD | Partial | Authenticated provider-neutral CRUD, archive lifecycle, pagination, UI and tenant tests are integrated | Prove migrated durable operation and define retention policy |
| Name, avatar and voice | Partial | CRUD requires canonical same-tenant resources and generation validates the active links | Provider catalog synchronization, rights and owned delivery evidence |
| Accent, language, gender and age range | Proved | Strict shared contracts, domain validation, HTTP routes and complete editing UI | Preserve behavior through staging migration |
| Personality, tone and speaking style | Proved | Typed persistence, CRUD validation and editing UI are covered | Add provider capability/evaluation evidence |
| Categories, intro, outro and energy level | Proved | Typed persistence, CRUD API/UI and tests cover every field | Add rendering evaluation evidence |
| Facial expressions and brand colors | Proved | Provider-neutral typed fields, validation and UI controls are integrated | Add provider capability evidence |
| Influencer status | Proved | Draft/active/paused/archive lifecycle and active-generation rejection are tested | Add authorization policy beyond owner/workspace scope |
| Consent, provenance and usage rights | Partial | Architecture requires them | Enforced records and a render-time hard gate are missing |

## Script generator

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Events, restaurants, hotels, nightclubs, deals, travel packages, beach clubs and experiences | Proved | Eight-value source enum, bounded snapshot schema, contract tests and workbench selector | Replace manual snapshots with authenticated Kong source adapters |
| Title, hook, script, CTA and caption | Proved | Shared Zod response, deterministic service and UI selection/editing | Persist approved script sets after migration |
| Hashtags and SEO keywords | Proved | Shared contract and deterministic service output | Add quality/duplicate rules and analytics feedback |
| Alternative versions and different angles | Proved | Stable-ID 1–5 variants; UI generates and selects three | Add experiment identity and performance attribution |
| Named angles such as Hidden Gem and Worth the Hype | Proved | Deterministic default angle catalog | Make catalog configurable by brand/country |
| Strong-model script generation | Missing | Existing AI router is only a web-chat classifier; deterministic mode is the only enabled path | Dedicated media feature flag, budget reservation, evals, fallback and approval evidence |
| Automatic generation directly from live Kong data | Missing | Snapshot contract exists; intake is manual | Source adapters, dedupe, outbox consumer and approval policy |

## Video generation and providers

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Select influencer/avatar and voice | Proved | Workbench selection and internal resource mapping contract | Replace sample catalogs with durable CRUD/provider sync |
| Submit script and create vertical `9:16` job | Proved | `POST /generations`, shared schema, service and route tests | Staging proof using migrated durable repository |
| Track progress, retry and cancel | Proved | Lifecycle service/API/UI and regression protections | Prove restart recovery and multi-worker concurrency |
| Receive signed provider webhook | Proved | Narrow public route, raw-body HMAC, replay/event dedupe and tests | Provider sandbox callback evidence |
| HeyGen v3 adapter | Partial | v3 submit/status/parser/resource resolver exist and are deny-by-default | Sandbox generation, webhook and billing evidence with approved spend |
| Tavus, Captions, open-source and future adapters | Missing | Port supports them, implementations do not exist | Provider contract suite must pass per adapter |
| Download MP4 automatically | Missing | Completed jobs may retain an allowlisted remote URL | Streaming ingest with timeout, redirect, size, MIME and checksum enforcement |
| Save video and metadata | Partial | Media-asset tables and job output metadata exist | Object-storage adapter, durable ingest transaction and recovery tests |
| Reusable provider-independent asset URL | Missing | No owned object-storage delivery path | Signed internal URLs and retention/lifecycle policy |

## Media library

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Reusable videos and scripts | Partial | Tenant-scoped library API/UI, search and cursor pagination are integrated | Owned delivery, script versioning and staging persistence proof |
| Voices and avatars | Partial | Canonical resources drive options and influencer validation without provider IDs | Catalog sync, previews, rights and availability operations |
| B-roll, images, music, logos, subtitles and thumbnails | Partial | Nine typed classes are exposed through the redacted library API/UI | Upload/ingest, transformations and owned delivery URLs |
| Asset provenance, checksum and metadata | Partial | Schema/architecture include these concepts | Enforced ingest pipeline and integrity tests |

## Publishing

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| TikTok, Instagram, Facebook and YouTube Shorts | Missing | Publishing tables are provider-neutral; no Studio platform adapters | OAuth/permission review, adapters and sandbox evidence per platform |
| Manual publishing | Missing | `pending_approval` storage invariant exists | Approval UI, immutable preview and explicit execute action |
| Scheduled publishing | Missing | Publishing schedule columns exist | Durable scheduler, timezone policy and missed-run recovery |
| Automatic publishing | Missing | Explicitly disabled | Separate Robert approval, policy engine, spend/risk review and kill switch |
| Publishing queue management | Partial | Durable publishing/outbox models exist | Operational worker/API/UI, retry/dead-letter and reconciliation |

## Analytics

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Views, likes, shares, comments and CTR | Partial | Analytics tables can store snapshots/events | Platform ingestion adapters and normalized metric definitions |
| Retention and watch time | Partial | Analytics model is extensible | Time-series ingestion, retention curve schema and UI |
| Best avatar, hook, CTA, posting time and category | Missing | No attribution/aggregation engine | Stable creative IDs, experiment joins and ranking queries |
| Cost per video | Partial | Estimated/actual job cost fields exist | Provider invoice reconciliation |
| Cost per view | Missing | Cost and view domains are not joined | Durable attribution query with currency/time-window policy |

## Automation

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Trigger on new event, restaurant, hotel, promotion, deal or travel package | Missing | Source intake/outbox schema and snapshot contract exist | Domain event producers/consumers with dedupe and tenant isolation |
| Analyze data and generate ideas/scripts/titles/captions/hashtags | Partial | Deterministic snapshot-to-variants flow works manually | Automatic consumer, quality rules and approval state |
| Automatically render, download, store and queue publishing | Missing | Individual contracts/tables exist; no safe end-to-end automation | Durable orchestration, budget/rights/moderation gates and recovery tests |
| No-manual-work mode | Missing | Deliberately disabled | Production policy, emergency stop and Robert-approved autonomy level |

## Queue and scale

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Pending, rendering, completed, failed and cancelled states | Proved | Shared/domain state machine plus durable worker projection tests | Prove deployed worker recovery in staging |
| Retry | Proved | Bounded retry path with retry-specific idempotency | Provider sandbox and restart evidence |
| Durable jobs, webhook dedupe and outbox | Partial | Drizzle repository, webhook receipts and transactional outbox are wired with `DATABASE_URL` | Migration, staging restart/recovery and outbox worker evidence |
| Thousands of jobs and parallel rendering | Partial | Durable lease/fencing repository enforces global, provider and tenant quotas | Deploy workers, add backpressure/observability and run load tests |
| 10,000+ videos/day | Missing | Architectural target only | Capacity model, burst test, quotas, SLOs and cost envelope |
| Multiple countries and languages | Partial | Language is modeled; country/policy execution is not | Locale, timezone, residency, rights and provider-routing policies |
| Cloud rendering and horizontal workers | Partial | Provider adapters and a no-side-effect durable worker factory exist with atomic lease claims | Deploy loop, autoscaling, observability and disaster recovery |

## Database, design, quality and release safety

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Models for influencers, scripts, videos, providers, publishing, analytics, assets and history | Proved | Central re-export of 18 Drizzle tables and DB-independent schema tests | Apply reviewed migration before production |
| Production persistence selection | Proved | Drizzle selected with `DATABASE_URL`; production without DB returns `503`; memory limited to dev/test | Staging database/restart evidence |
| Database migration applied | Missing | Reviewed forward/rollback SQL is checked in and statically tested; no migration or `db:push` has run | Backup, staging apply, restart/recovery and rollback rehearsal; hard deploy gate |
| Dark, modern, minimal Kong UI | Proved | Studio shell, dashboard, workbench, jobs and responsive styles | Visual regression evidence remains required for later UI changes |
| Natural movement, eye contact, speech, lighting and realism | Missing | Provider quality goals are documented only | Provider scorecard, sample set, human review and minimum thresholds |
| Consistent branding and high-quality vertical output | Partial | Brand-neutral vertical workbench and `9:16` contract exist | Brand kit enforcement and rendered sample QA |
| Secrets and provider IDs isolated | Proved | Secret refs/env usage, provider boundary and public DTO tests | Vault rotation runbook for production |
| Deployment readiness | Missing | PR #67 is mergeable; PR2 checker and static App QA pass, and reviewed migration/rollback artifacts exist | Staging apply, live environment QA, backup/rollback evidence and Robert approval |

## Release interpretation

- **PR #67**: clean and mergeable foundation; it is not production deployment approval.
- **PR2 — `codex/ai-media-studio-core`**: stacked core work for durable data, media ownership and operational APIs. Review only its delta after PR #67 is merged/rebased.
- **PR3**: publishing, analytics feedback, source automation and distributed scale. Paid rendering or posting remains separately approval-gated.
