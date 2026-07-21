# AI Media Studio Requirements Matrix

This matrix maps the original AI Media Studio brief to repository evidence. Status describes implementation evidence on the current code/PR stack, not production deployment.

- **Proved**: implemented and covered by focused code/tests or an accepted PR review.
- **Partial**: a contract, schema, adapter, or UI exists, but an operational path or release gate is still missing.
- **Missing**: no implementation evidence exists yet.

PR #67 is the foundation. PR #70 lives on `codex/ai-media-studio-core`, PR #71 lives on `codex/ai-media-studio-operations`, and PR4 lives on `codex/ai-media-studio-quality`. Each is stacked on the preceding delivery. None of the PR2, PR3, or PR4 migrations has been applied.

## Platform foundation

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Independent AI Media Studio area inside Kong | Proved | `/ai-media-studio`, `server/ai-media-studio/**`, shared contracts, Dashboard entry | Keep module boundaries intact through PR2 |
| Provider-neutral business logic | Proved | `ports.ts`, `service.ts`, fake and HeyGen adapters; requests contain internal refs, not provider IDs | Contract tests required for every new provider |
| Replace HeyGen without changing use cases/UI | Proved | `VideoProvider` port and provider-neutral DTOs | Add a second production adapter before claiming operational portability |
| Independently deployable media platform | Partial | Domain is isolated but still shares the Express/React application deployment | Define service extraction trigger, ownership and data/API boundary before separate deployment |
| Enterprise-ready production operation | Missing | Architecture, schemas, render/ingest/outbox code, and production reader/S3-compatible adapter composition exist, but migrations, live storage, worker heartbeat, live SLOs, provider operation and load evidence are absent | Complete migration, staging, live-storage, worker, provider, QA and capacity gates below |

## Dashboard

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Videos generated today | Proved | Dashboard DTO/API/UI derives daily generation count | Validate against durable staging data and timezone policy |
| Videos published | Partial | Field exists and UI renders it; current API reports zero | Connect durable publications and platform reconciliation |
| Pending and failed jobs | Proved | Durable/domain status model, dashboard response and UI cards | Verify counts after restart in staging |
| Average generation time | Proved | API computes completed-job duration; UI renders it | Define percentile/SLO metrics for scale |
| Estimated cost | Proved | Per-job/shared cost fields and dashboard aggregate | Add provider billing reconciliation and budget alerts |
| Provider status | Proved | Provider health contract and dashboard UI | Add active polling/alerting and provider-specific SLOs |
| Current queue and rendering jobs | Proved | Queue snapshot/status cards, jobs list and durable render-claim adapter | Prove multi-worker operation and restart recovery in staging |
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
| Automatic generation directly from live Kong data | Partial | Bounded source-adapter contract, content-hash dedupe, tenant repositories and fake adapter exist | Live Kong/platform adapters, OAuth or trusted ingestion, outbox consumers and operational approval policy |

## Video generation and providers

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Select influencer/avatar and voice | Proved | Workbench selection and internal resource mapping contract | Replace sample catalogs with durable CRUD/provider sync |
| Submit script and create vertical `9:16` job | Proved | `POST /generations`, shared schema, service and route tests | Staging proof using migrated durable repository |
| Track progress, retry and cancel | Proved | Lifecycle service/API/UI and regression protections | Prove restart recovery and multi-worker concurrency |
| Receive signed provider webhook | Proved | Narrow public route, raw-body HMAC, replay/event dedupe and tests | Provider sandbox callback evidence |
| HeyGen adapters and terminal evidence | Partial | Legacy V2 remains mounted; reviewed PR27 adds the unmounted V3 admitted adapter/terminal evidence, and local PR29 composes its function-only DB lanes, exact fixed-account capability, terminal observer, renewable artifact resolver and production ingest worker without autostart or construction I/O. Mismatches fail before network and durable ingest never falls back to a stale URL | Complete independent PR29 review, provision separate production DB roles/configuration without committing secrets, apply/restart/rollback on staging, prove real credentials, quota, webhook-as-signal and billing, run one separately approved one-video sandbox, then a 5×10 canary under human cost/deploy approval |
| Initial HeyGen avatar roster | Partial | Authenticated wizard and durable transaction accept 5–10 private avatar/voice mappings and plan exactly 10 videos each without enqueueing | Provision one verified server account and real credentials; complete rights/governance, quota/billing and cost admission; run an approved one-video sandbox before a 5×10 canary and obtain human launch/deployment approval |
| Durable daily roster plan | Partial | The roster/catalog transaction uses PostgreSQL time and a server-owned timezone to persist one blocked plan plus exactly 10 blocked slots per avatar (50–100), with exact replay, tenant/account/credential/resource binding, a public-safe durable GET and zero budget/render/outbox/provider side effects. Owned ephemeral PostgreSQL 16 proves 5→50, 10→100, concurrent replay, tenant isolation and rollback; checker/App QA are P0=P1=P2=0 | Preserve the reviewed GitHub checkpoint; then bind source/script batches, governance proofs, atomic budget reservation, sandbox evidence and human launch approval before queueing |
| Dedicated AI Media Studio Agent | Partial | Authenticated read-only control pane and Agents Office room expose the 5–10 × 10 launch, owners, PR/evidence, blockers, next actions and human gates; typed safety fields keep spend, deployment, migration application and live provider calls false | Replace the static delivery snapshot with durable PR/checker/App QA status only after the GitHub handoff and release-gate adapters are independently reviewed; keep all mutation and launch authority server-side |
| Durable daily budget admission | Partial | PR19–PR22 keep provider-neutral plans/slots, exact micro-USD buckets, capability-separated append-only authorities, immutable exact launch intents/snapshots, opaque runtime attestation handles, shared governance locking, globally serialized count-based admission and atomic budget/reservation/slot CAS unmounted and provider-free; the PostgreSQL 16 harness proves the checked-in PR19/PR20/PR22 SQL and selected contention/immutability invariants | Compose production RBAC and durable distributed attestation verification, provision buckets, add scale counters, rehearse a staging-copy migration/restart, then atomically create non-claimable jobs/outbox work only after every gate passes |
| Tavus, Captions, open-source and future adapters | Missing | Port supports them, implementations do not exist | Provider contract suite must pass per adapter |
| Download MP4 automatically | Partial | A no-autostart ingest worker and DNS-pinned Node HTTPS reader stream provider output through exact-host/HTTPS/redirect/address/byte/chunk/MIME/MP4/checksum controls and redact the source URL | Approved live provider download, deployed worker heartbeat and recovery evidence |
| Save video and metadata | Partial | S3/R2-compatible multipart storage, tenant content-addressed keys, durable fenced ingest, canonical checksum-deduplicated linkage, retry/DLQ and reconciliation are covered in code/tests | Live bucket/lifecycle proof, staging migration, restart/recovery and transaction/contention evidence |
| Reusable provider-independent asset URL | Partial | Authenticated tenant/status-gated delivery route selects an explicit signer first or a fully configured S3-compatible signer; empty config stays `503`, and public DTOs redact provider/storage/config internals | Real-account signing, retention/lifecycle policy and live delivery evidence |

## Media library

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Reusable videos and scripts | Partial | Tenant-scoped library API/UI, search/cursor pagination, owned-video delivery, and strict S3/R2-compatible adapter composition are integrated | Live bucket/signer evidence, script versioning and staging persistence proof |
| Voices and avatars | Partial | Canonical resources drive options and influencer validation without provider IDs | Catalog sync, previews, rights and availability operations |
| B-roll, images, music, logos, subtitles and thumbnails | Partial | Nine typed classes are exposed through the redacted library API/UI; PR4 owned ingest is video/MP4 only | Upload/ingest, transformations and owned delivery for every non-video class |
| Asset provenance, checksum and metadata | Partial | Owned render ingest computes SHA-256/size, creates or reuses a canonical same-tenant video asset, and now has streaming HTTPS plus S3/R2-compatible production adapters while keeping provider URLs private | Live provider-to-bucket proof, richer provenance policy and staging integrity evidence |

## Publishing

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| TikTok, Instagram, Facebook and YouTube Shorts | Partial | Provider-neutral contracts/ports, strict tenant-scoped durable account readiness, composite job/account/platform isolation, digest-only one-time OAuth sessions, persisted per-platform PKCE policy, fenced callback saga, application-envelope-encrypted code/token vault adapters, durable two-pass cleanup obligations, inert infrastructure preflight, explicit discovered-target/selection evidence, frozen scope allowlists, locally derived capabilities, safe role/lifetime descriptors, and fixed provider authorization manifests cover all four platforms. Local PR16 work in progress adds exact selected-target/account activation CAS, one-secret-per-role vault v2 contexts, and additive artifact/binding/operation persistence without enabling runtime use | Apply/rehearse the migrations; complete cleanup v2 composition, effective IAM/IaC/operations proof, mounted routes, real exchange/identity adapters, refresh/revocation, app review, ingestion and sandbox evidence per platform. Legacy publishing readiness remains fail-closed until exact-target binding integration |
| Manual publishing | Partial | Server-generated immutable preview, explicit approval/rejection evidence, authenticated routes, repository/service, client API and UI are integrated | Configured real provider execution and sandbox evidence; Robert approval before external posting |
| Scheduled publishing | Partial | Authenticated routes, timezone-bound schedule, due claim, bounded retry/dead-letter and reconciliation code exist | Deploy an approved worker and prove missed-run/restart behavior against live PostgreSQL |
| Automatic publishing | Missing | Explicitly disabled | Separate Robert approval, policy engine, spend/risk review and kill switch |
| Publishing queue management | Partial | Authenticated routes, durable publishing/outbox repositories, UI, scheduler, fencing, retry/dead-letter and reconciliation code exist | Deployed worker, live PostgreSQL contention/restart and real connector evidence |

## Analytics

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Views, likes, shares, comments and CTR | Partial | Normalized metric contracts, tenant repositories, summary service, fake ingestion and UI exist | Real platform ingestion adapters and metric-definition validation |
| Retention and watch time | Partial | Normalized watch-time/retention snapshots and summary UI exist | Real time-series ingestion and retention-curve validation |
| Best avatar, hook, CTA, posting time and category | Partial | Attribution records, dimensions, filtered queries and UI rankings exist | Validate durable joins and performance ranking against real publication metrics |
| Cost per video | Partial | Generation cost joins and normalized USD summary are implemented | Provider invoice/billing reconciliation and currency policy evidence |
| Cost per view | Partial | Summary calculates nullable cost-per-view from cost and normalized views | Real ingestion, invoice reconciliation and attribution-window validation |

## Automation

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Trigger on new event, restaurant, hotel, promotion, deal or travel package | Partial | Category-aware source snapshots, stable content hashing, tenant dedupe repositories and fake adapter exist | Live domain event producers/consumers, OAuth/trusted ingestion and operational scheduling |
| Analyze data and generate ideas/scripts/titles/captions/hashtags | Partial | Deterministic snapshot-to-variants flow works manually | Automatic consumer, quality rules and approval state |
| Automatically render, download, store and queue publishing | Partial | Orchestration gates and CAS/outbox persist; guarded ingest/linkage now has strict production HTTPS/S3-compatible composition with retry, dead-letter and reconciliation | Deployed consumers/heartbeat, real connectors and live end-to-end crash recovery |
| No-manual-work mode | Missing | Deliberately disabled | Production policy, emergency stop and Robert-approved autonomy level |

## Queue and scale

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Pending, rendering, completed, failed and cancelled states | Proved | Shared/domain state machine plus durable worker projection tests | Prove deployed worker recovery in staging |
| Retry | Proved | Bounded retry path with retry-specific idempotency | Provider sandbox and restart evidence |
| Durable jobs, webhook dedupe and outbox | Partial | Drizzle render/ingest/outbox repositories, webhook receipts, CAS emissions, `SKIP LOCKED` claims, fencing, retry/DLQ and completed-unlinked reconciliation code exist | Apply all three migrations, then prove live restart/recovery and contention |
| Thousands of jobs and parallel rendering | Partial | Durable leases plus provider/tenant quotas and a bounded no-autostart worker loop exist | Deploy workers, add telemetry/backpressure/autoscaling and run real load tests |
| 10,000+ videos/day | Missing | A deterministic 10k fake-provider rehearsal exists only; it is explicitly not capacity proof | Burst/load test, provider quota evidence, SLO telemetry, cost envelope and disaster recovery |
| Multiple countries and languages | Partial | Admission policy evaluates language, country and timezone with tenant/provider quotas and daily budgets | Residency, rights, provider routing and operational locale tests |
| Cloud rendering and horizontal workers | Partial | Provider ports, durable atomic claims, fencing, graceful drain and reconciliation cadence exist in code | Deploy loop, prove SIGTERM/restart behavior, autoscaling, observability and DR |

## Database, design, quality and release safety

| Requirement | Status | Current evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Models for influencers, scripts, videos, providers, publishing, analytics, assets, asset ingest, sources, orchestration, outbox and history | Proved | Central Drizzle table inventory and DB-independent schema/migration tests | Apply PR2 then PR3 then PR4 reviewed migrations before production |
| Production persistence selection | Proved | Drizzle selected with `DATABASE_URL`; production without DB returns `503`; memory limited to dev/test | Staging database/restart evidence |
| Database migration applied | Missing | The reviewed-local PR1 foundation plus every later delta form 22 forward/rollback pairs, with exact order and SHA-256 provenance in `migrations/ai-media-studio/manifest.json`; the no-go staging runbook checks the full chain. PR16A and PR16B have clean independent checker/App QA and isolated PostgreSQL evidence. No staging database connection, migration or `db:push` has run, and PR1 rollback is empty-baseline-only | Merge/review the exact stack, identify staging, prove backup restore and manifest/catalog compatibility, provision separate least-privilege principals, obtain explicit approval, then run ordered forward/restart/reverse rehearsal with App QA as a hard deploy gate. Never use PR1 rollback to erase evidence retained by later rollbacks. Prove PR13 external storage readiness separately before restart/runtime/sandbox |
| Dark, modern, minimal Kong UI | Proved | Studio shell, dashboard, workbench, jobs and responsive styles | Visual regression evidence remains required for later UI changes |
| Natural movement, eye contact, speech, lighting and realism | Missing | Provider quality goals are documented only | Provider scorecard, sample set, human review and minimum thresholds |
| Consistent branding and high-quality vertical output | Partial | Brand-neutral vertical workbench and `9:16` contract exist | Brand kit enforcement and rendered sample QA |
| Secrets and provider IDs isolated | Proved | Secret refs/env usage, provider boundary and public DTO tests | Vault rotation runbook for production |
| Deployment readiness | Missing | PR #71 and PR4 passed independent checker/static App QA; PR4 adds code/test evidence for owned asset ingest/delivery only, while all three migrations remain unapplied | GitHub review, ordered staging apply, live QA, restart/load/storage evidence, backup/rollback and Robert approval |

## Release interpretation

- **PR #67**: clean and mergeable foundation; it is not production deployment approval.
- **PR #70 — `codex/ai-media-studio-core`**: stacked core work for durable data, media ownership and operational APIs. Review only its delta after PR #67 is merged/rebased.
- **PR #71 — `codex/ai-media-studio-operations`**: stacked integration branch for publishing, analytics, source automation, orchestration and worker operations. Code/test evidence is not live-operation evidence.
- **PR4 — `codex/ai-media-studio-quality`**: stacked owned-render ingest/delivery slice. Its reader, object store and signer are contracts/fakes; no real provider artifact, production storage, deployment or capacity has been proven.
- Automatic publishing, external posting, deployment, and increased spend remain separately gated by Robert's explicit approval.
