# AI Media Studio Architecture

## Delivery stack

PR #67 (`codex/ai-media-studio`) is the provider-neutral foundation. PR #70 (`codex/ai-media-studio-core`) is the core layer stacked on that foundation, and PR #71 (`codex/ai-media-studio-operations`) is stacked on PR #70. PR4 lives on `codex/ai-media-studio-quality`, stacked on PR #71. PR5 lives on `codex/ai-media-studio-governance`, stacked on PR4, and its local AI Media Studio suite, independent checker, and App QA revalidation have passed. This stacking is a code-review strategy, not evidence that any PR2-PR5 migration has been applied and not deployment authorization.

## Boundary

AI Media Studio owns influencers, scripts, generation requests, render jobs, provider events, generated assets, media activity, publishing jobs, and media analytics. It does not own global authentication, Kong source records, the global secret vault, or deployment.

Source systems send stable identifiers and snapshots through an application port. Studio never reaches into another domain's tables from business logic. Provider SDKs and payloads remain inside adapters.

```text
Kong source event -> application use case -> durable job port -> provider adapter
                              |                       |
                              v                       v
                         media records <- signed webhook/reconciliation
                              |
                              v
                       asset storage port -> publishing port -> analytics ingest
```

## Layer contracts

### Frontend to HTTP API

The frontend sends business intent: influencer, voice, language, script, idempotency key, and `9:16` format. It never sends a HeyGen avatar ID or chooses an SDK operation. Create returns HTTP `202` with `{ generationId, jobId, job }`; detail, retry, and cancel return `{ job }`.

Scripts are capped at 5,000 characters to match the verified HeyGen v3 input limit. Client idempotency keys use 8–200 characters from letters, digits, `.`, `_`, `:`, and `-`; this intentionally stays inside HeyGen's wider 1–255-character allowance.

Dashboard returns `{ summary, providers, queue, recentActivity }`. Options returns `{ influencers, voices, languages }`. The source of truth is `shared/ai-media-studio.ts`.

PR3 adds `shared/ai-media-studio-operations.ts` for provider-neutral publishing previews/jobs, approval evidence, connections, analytics summaries/attribution, source intake, and read-only automation policy. The operations UI, client adapter, and authenticated Studio routes are wired through the existing single router. The server computes previews from tenant-owned ready assets; create rejects a stale or forged digest. No HTTP handler submits to a publishing provider.

Script generation accepts a bounded Kong source snapshot through `POST /api/ai-media-studio/scripts/generate`. Its provider-neutral contract lives in `shared/ai-media-studio-scripts.ts` and supports events, restaurants, hotels, nightclubs, deals, travel packages, beach clubs, and experiences. Deterministic grounded variants are the only enabled PR 1 mode. The existing AI router classifies web-chat work but is not a media execution or cost-reservation API, so it is not reused here. A future strong-model path requires a dedicated feature flag and media cost gate; it may not silently trigger rendering or publishing.

### Application to providers

Business use cases depend on capability ports such as `VideoProvider`, `AvatarCatalogProvider`, and `VoiceCatalogProvider`. HeyGen, Tavus, Captions, and fake/local implementations adapt those ports. Provider selection is policy-driven and deny-by-default when an adapter is not configured.

The first HeyGen adapter targets its v3 API (`POST /v3/videos` and `GET /v3/videos/:id`) using `X-Api-Key` and `Idempotency-Key`. A UI cancel is an internal state change because no verified render-cancel operation exists; permanent video deletion is not a substitute for cancellation. Provider download URLs are treated as temporary even when a TTL is not documented.

### Application to queue

The durable render repository stores the job ID, owner/tenant, provider, request, attempt and availability state in the existing render-job aggregate. Workers claim with atomic leases and fencing tokens, bounded exponential retry with jitter, an independent lease-recovery budget, dead-letter handling, and concurrency limits per provider and tenant.

With `DATABASE_URL`, generation uses durable execution mode: HTTP persists a due job and returns without provider submission, while the separately invoked worker performs the claim and submission. The factory intentionally starts no loop or network listener. Migration, deployed worker operation, observability, restart recovery and horizontal load evidence remain required before automated source ingestion is enabled.

PR3 adds a reusable no-autostart `WorkerLoop`: bounded concurrent `runOnce`, idle backoff, a separate reconciliation cadence, and AbortSignal-based drain for SIGTERM-friendly composition. Its CLI defaults to dry-run/run-once; continuous operation requires explicit configuration. No loop has been deployed.

The operations policy evaluates total/provider/tenant concurrency, language, country, timezone, and prospective daily spend. Durable admission/reservation must remain atomic at composition time; the pure policy function alone is not a distributed quota service.

The outbox port has an in-memory reference and a tenant/workspace-scoped Drizzle adapter. PostgreSQL claims use `FOR UPDATE SKIP LOCKED`; the monotonic fencing token, active lease, retry budget, and dead-letter state protect ack/nack and recovery. Transport dispatch carries the stable message ID for provider idempotency. No live PostgreSQL contention or crash-recovery run has been performed.

Queue-health/SLO snapshots are deterministic calculations over supplied measurements. They do not create telemetry or alerts by themselves.

### Owned render ingest and delivery

PR4 adds a provider-neutral ingest queue between a completed provider render and the canonical media library. Provider artifact URLs remain private worker inputs. A render remains in an artifact-ingest stage until a bounded worker has committed the MP4 into tenant-owned storage and linked a canonical media asset; the browser never receives the provider URL.

The ingest contracts require exact lowercase HTTPS host allowlists, the standard port, bounded redirects, public-address resolution on every hop, byte and chunk limits, MIME validation, an MP4 `ftyp` check, and a SHA-256 digest. Uploads begin under a temporary tenant key and atomically commit to a tenant-scoped content-addressed key. The production-assets slice implements those ports with a DNS-pinned streaming Node HTTPS reader and S3/R2-compatible multipart storage plus signing. Its strict `AI_MEDIA_STUDIO_ASSET_*` parser rejects partial, wildcard, non-HTTPS, malformed, or out-of-bound configuration without echoing values. Construction performs no network request.

The durable ingest repository deduplicates one job per tenant/workspace/render, claims due work with `FOR UPDATE SKIP LOCKED`, increments a fencing token, requires a matching unexpired lease for terminal writes, retries bounded transient failures, and dead-letters exhausted attempts or lease recoveries. If object commit succeeds but canonical catalog linkage fails, the job remains `completed` and discoverable through a bounded completed-unlinked reconciliation scan. Canonical asset materialization is idempotent by tenant/workspace/type/checksum and links both the ingest job and render job to the owned asset.

Reusable delivery is minted only by the authenticated `POST /api/ai-media-studio/media-assets/:id/delivery` route. The route enforces tenant ownership and ready status, then asks the explicitly injected signer or a fully configured S3-compatible production signer for a five-minute HTTPS URL. Library/list/job DTOs redact storage keys, provider URLs, persisted delivery URLs, credentials, and storage configuration. With no complete configuration the route remains unavailable (`503`); production never selects an in-memory/fake signer.

`createProductionAssetIngestWorker` composes the same bounded reader/storage policy with an existing repository and completion hooks, but deliberately starts no timer or network operation. A deployed worker process must report readiness through the separate heartbeat/readiness dependency; neither adapter construction nor repository availability infers that heartbeat. No live S3/R2 operation, provider download, lifecycle policy, staging restart, or throughput run has been performed.

### Publishing, analytics, intake, and orchestration

Publishing drafts support manual and scheduled modes. The canonical preview digest binds media, caption, platform, title/hashtags, schedule, and timezone; approval or rejection evidence must match that immutable digest. Scheduler and reconciliation services can claim due work, retry bounded failures, and dead-letter exhausted jobs through fake/provider-neutral ports. Automatic mode stays disabled. Real TikTok, Instagram, Facebook, and YouTube Shorts OAuth/connectors are missing, so no platform post is possible from this slice.

PR8 adds a read-only social publishing-account boundary over `ai_media_provider_accounts`. It queries only the four supported social provider keys inside the authenticated tenant/workspace, maps a strict capability allowlist, and never returns the credential secret reference, external account identity, provider configuration, webhook material, or token values. A connection is ready only when exactly one active account has a non-empty vault reference and `publish_video`; zero accounts is not connected, and any duplicate or incomplete state requires attention. The durable publishing-job reference is additionally fenced by a composite `(owner, workspace, account, platform)` foreign key. PR8 does not create OAuth callbacks, accept credentials, select a live provider, or enable the publishing policy.

PR9 introduces a separate OAuth control plane rather than placing authorization inside publishing execution. A start service verifies the exact tenant/workspace/account/platform binding, takes redirect URIs and scopes only from trusted server policy, generates opaque state plus PKCE S256, writes the verifier to a purpose-scoped vault, and persists only the state digest and opaque reference. The callback claim is a single conditional update by digest and platform against pending, unconsumed, unexpired state; it never accepts tenant, actor or account identity from callback input. Vault-reference validation rejects echo, URL, wrong-purpose and malformed values before persistence, with compensating deletion when session creation fails. Credential lifecycle metadata leaves all legacy rows unverified, and readiness additionally requires active versioned credentials with a future expiry.

PR10 adds the first production OAuth composition boundary without mounting a public flow. Short-lived PKCE verifiers use an S3 object vault under a fixed prefix and opaque `vault://ai-media-studio/oauth-pkce/v1/<uuid>` reference. The vault pins the official AWS S3 endpoint, requires a fully qualified customer KMS key ARN in the configured region, writes with SSE-KMS, Bucket Keys, JSON content type and `IfNoneMatch: "*"`, validates encryption/KMS/metadata/envelope bindings before returning a verifier, bounds response bodies, and deletes only exact validated objects. Provider authorization URLs are built from immutable manifests with fixed endpoints, audited scopes, strict HTTPS redirect validation and no client secrets. Current policies omit PKCE for TikTok Web, Meta/Instagram and Google confidential Web Server flows; Google retains offline-consent parameters. Runtime composition is inert: an empty `AI_MEDIA_STUDIO_OAUTH_*` namespace leaves OAuth unavailable, while partial or unknown config fails closed without echoing values.

PR12 adds a durable callback saga with leases, fencing, deterministic code/token bindings, no automatic re-exchange after ambiguous provider I/O, and one short transaction for provider-account credential CAS plus session completion. PR13 supplies the previously abstract authorization-code and long-lived token vaults. It encrypts each secret payload with a fresh KMS data key and AES-256-GCM authenticated by the full canonical context, stores only ciphertext under deterministic immutable S3 keys, and also requires S3 SSE-KMS, the exact CMK account/bucket owner, official AWS endpoints, strict envelopes and generic errors. Token descriptors and bundles are authenticated together; only a separate reader capability returns the bundle. These adapters remain unmounted. Dedicated IAM roles, bucket/versioning/lifecycle policy, durable orphan reconciliation, selected provider target, multi-stage connectors and sandbox proof remain hard gates.

Analytics accepts normalized snapshots for views, impressions, likes, comments, shares, clicks, watch time, CTR, and retention. Tenant-scoped repositories calculate summaries, direct/last-touch attribution dimensions, and USD cost-per-video/view from durable joins. The fake ingestion adapter proves the port shape only; platform collectors, billing reconciliation, and real attribution validation are missing.

Source intake accepts bounded provider-neutral snapshots, computes canonical content hashes, and deduplicates within tenant/workspace. Fake adapters cover the contract. Live Kong/platform feeds, OAuth, polling/webhooks, and production ingestion are not implemented.

The source orchestrator applies idempotent state transitions with rights, moderation, immutable approval, budget reservation, and kill-switch evidence. The Drizzle repository uses state/version compare-and-swap and writes emissions to the transactional outbox. This proves guarded state-machine and repository behavior in code; no autonomous end-to-end consumer is running.

### Governance and quality gates

PR5 introduces tenant-scoped, append-only influencer governance profiles and asset quality reviews. A new profile or review extends an immutable revision chain; an idempotency key may replay only the same input digest. Durable appends validate tenant ownership, serialize competing revisions with a PostgreSQL advisory transaction lock, and never update or delete prior evidence. Public records omit internal bindings, proof digests, actors, tenant scope, and idempotency fields.

Render policy checks consent/rights basis, validity window, revocation, exact influencer/avatar/voice bindings, allowed use, territory, and required/prohibited brand terms. Generation checks before persistence, retry checks again, and both inline and durable execution revalidate immediately before provider submission so queued work cannot rely on stale authorization.

Quality reviews score natural movement, eye contact, speech quality, lighting, realism, brand consistency, and vertical quality. The service derives `approved`, `needs_review`, or `rejected`; durable evidence is bound to the exact tenant-owned asset checksum. Publishing preview, draft creation, approval, operator retry, and the worker's final provider submission all fail closed unless current influencer governance and an approved current-checksum review pass the server-side gate. Every `PublishingWorker` composition must receive the runtime's mandatory `publishingSubmissionGate`; there is no permissive default. Client governance, review, render-readiness, and publishing guidance are operator surfaces only; they do not replace server enforcement.

This slice does not contain a legal-document or legal-proof vault and does not establish that a proof digest corresponds to a reviewed contract. It also does not perform automated video analysis: quality scores are human-entered evidence, and PR5 persistence accepts only the `human` evaluator type.

### Provider webhook

`POST /api/ai-media-studio/webhooks/providers/:providerKey/accounts/:endpointKey` is exempt from application-user authentication so an external provider can reach it, but the opaque account endpoint must resolve server-side to exactly one tenant/provider account. Production has no provider-only fallback URL and no process-global webhook secret path; development/test may inject a provider-only compatibility harness only for local tests.

HeyGen verification uses HMAC-SHA256 over the exact raw request body and checks active plus unexpired previous secret candidates resolved from server-side secret references. Replay identity and occurrence time are accepted only from signed JSON body fields; if the body has no event id, the route uses a stable raw-body SHA-256 digest as the fallback id. Unsigned request headers such as timestamp or event id are deliberately ignored for HeyGen routing, dedupe, and ordering.

Render job lookup, webhook dedupe, parked callbacks, and worker submission projection are scoped by `(providerAccountId, providerKey, providerJobId/eventId)`. Provider-controlled error text is sanitized before it reaches stored job state or public responses.

Webhook processing is idempotent and fast. The system must not trust remote artifact URLs without allowlisting, redirect limits, size limits, and SSRF protection; reconciliation covers missing callbacks.

## Lifecycle

```text
pending -> rendering -> completed
   |          |
   +----------+-> failed -> retry -> pending
   +----------+-> cancelled
```

Adapters may keep finer internal stages such as submitting, downloading, or retry-scheduled. They map those stages to the shared status while preserving `stage` for display and diagnostics.

## Persistence and automation roadmap

The schema and repositories cover the PR2 core, PR3 source intake/orchestration/publishing/analytics/cost/outbox fields, the PR4 asset-ingest queue and canonical render-output link, PR5 append-only governance/quality evidence plus render-governance snapshots, PR6 account-scoped provider identity, and PR8 publishing-account tenant/platform isolation. In-memory implementations remain development/test references; production is designed to fail closed without configured persistence. Six forward/rollback migration pairs are checked in under `migrations/ai-media-studio/`, but none has been applied and `db:push` has not run. Local adapter composition is not proof of a configured production bucket, social connection, or worker. Backup, ordered staging application, restart/recovery, rollback rehearsal, live storage checks, and live-browser App QA remain hard deployment gates.

PR2 through PR6 and PR8 each have checked-in, operator-run migration artifacts instead of relying on `drizzle-kit push`. The SQL has not altered any database. Before deployment, the team must take and verify a backup, drain writers/workers, apply PR2 then PR3 then PR4 then PR5 then PR6 then PR8 to staging, prove restart/recovery and rollback, rerun App QA against that environment, and obtain Robert's explicit approval.

The first source pilot should be a Radio Calendar event because the repository already has calendar and radio boundaries. A source event creates ideas/drafts first; it does not render or publish until budget, quality, rights, and approval policies pass. Automatic publishing remains disabled until dedicated connector and App QA gates exist.

## PR3 integration seams

- `server/ai-media-studio/routes.ts` remains the single HTTP adapter/composition root and now mounts PR3 operations routes; no second router mount is allowed.
- `server/routes.ts` keeps exactly one `registerAiMediaStudioRoutes(app)` call. New core endpoints belong in the Studio router, not the global route file.
- Runtime selection remains fail-closed: Drizzle with `DATABASE_URL`, memory only in development/test, and unavailable outside those modes without a database. The operations runtime imports durable repositories lazily and does not open a pool at module import.
- `client/src/pages/ai-media-studio.tsx` and navigation compose Publishing, Analytics, and Automation surfaces through the shared operations DTOs. UI integration does not enable posting.
- PR3 worker/outbox modules are explicit composition dependencies and never autostart from import.
- PR2 must be applied before PR3 in staging. Both remain unapplied until backup and staging approval, followed by restart/recovery and rollback rehearsal.

## PR4 integration seams

- `server/ai-media-studio/assets/**` owns the ingest queue, bounded-reader, owned-storage, delivery-signer, and worker contracts. Fake adapters are development/test evidence only.
- `server/ai-media-studio/routes.ts` composes ingest hooks that materialize one canonical tenant asset and update the render projection. The factory still starts no worker loop and performs no provider download on import.
- Completed-unlinked reconciliation is explicit and bounded; it repairs catalog/render linkage without downloading or uploading the already committed object again.
- Public library and job responses redact provider artifact URLs and storage internals. The authenticated delivery route creates short-lived URLs on demand and fails closed without a configured signer.
- PR4 must be applied after PR2 and PR3 in staging. All three migrations remain unapplied until backup and staging approval, followed by restart/recovery and rollback rehearsal.

## PR5 integration seams

- `shared/ai-media-studio-governance.ts` is the public request/response contract; internal bindings and evidence remain server-owned.
- `server/ai-media-studio/governance/**` owns append-only repositories, evidence digests, profile/review services, and render/publish gate decisions.
- `server/ai-media-studio/routes.ts` remains the single authenticated composition root. Governance persistence follows the existing fail-closed runtime policy and is never selected from client-supplied evidence.
- Render authorization is revalidated adjacent to provider submission, including retries; a UI readiness result is informational and can become stale.
- A quality decision is valid only for the exact current asset checksum. Publishing approval and the immutable publishing-preview digest remain separate required evidence.
- PR5 must be applied after PR4. PR2, PR3, PR4, and PR5 remain unapplied; staging/live-browser App QA and Robert deployment approval remain separate release gates.

## Scale, security, and cost

Ten thousand videos per day remains an architectural target. PR3 includes a deterministic 10,000-job fake-provider rehearsal to exercise arithmetic assumptions; it is not a load test, benchmark, provider-quota proof, storage-throughput proof, or capacity claim. The production-assets adapters add no capacity evidence. Readiness still requires live PostgreSQL contention, horizontal render and ingest workers, backpressure, real provider and storage quotas, observability, cost controls, failure injection, restart testing, country-specific policy evidence, a live browser pass, and staging/deployment proof.

- Secrets are environment/vault references and are never returned or logged.
- Avatar and voice records require provenance, consent, and usage rights.
- Provider callbacks require HMAC and replay protection.
- Remote downloads require SSRF defenses and content validation.
- Estimated and actual costs attach to every generation; retries share its budget.
- Automatic publishing and paid rendering default off.
