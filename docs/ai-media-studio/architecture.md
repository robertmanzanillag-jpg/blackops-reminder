# AI Media Studio Architecture

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

Script generation accepts a bounded Kong source snapshot through `POST /api/ai-media-studio/scripts/generate`. Its provider-neutral contract lives in `shared/ai-media-studio-scripts.ts` and supports events, restaurants, hotels, nightclubs, deals, travel packages, beach clubs, and experiences. Deterministic grounded variants are the only enabled PR 1 mode. The existing AI router classifies web-chat work but is not a media execution or cost-reservation API, so it is not reused here. A future strong-model path requires a dedicated feature flag and media cost gate; it may not silently trigger rendering or publishing.

### Application to providers

Business use cases depend on capability ports such as `VideoProvider`, `AvatarCatalogProvider`, and `VoiceCatalogProvider`. HeyGen, Tavus, Captions, and fake/local implementations adapt those ports. Provider selection is policy-driven and deny-by-default when an adapter is not configured.

The first HeyGen adapter targets its v3 API (`POST /v3/videos` and `GET /v3/videos/:id`) using `X-Api-Key` and `Idempotency-Key`. A UI cancel is an internal state change because no verified render-cancel operation exists; permanent video deletion is not a substitute for cancellation. Provider download URLs are treated as temporary even when a TTL is not documented.

### Application to queue

The future durable job envelope contains a schema version, job ID, owner/tenant ID, job type, aggregate ID, idempotency key, attempt count, availability timestamp, and correlation ID. Workers require leases, bounded retries with exponential backoff and jitter, dead-letter handling, and concurrency limits per provider and tenant.

The repository and transactional outbox can be durable through Drizzle, but the current worker queue still does not claim distributed leases, dead-letter processing, or horizontal-worker guarantees. Those queue gates must pass before automated source ingestion is enabled.

### Provider webhook

`POST /api/ai-media-studio/webhooks/providers/:providerKey` is exempt from application-user authentication so an external provider can reach it. The module must still reject a missing, invalid, expired, or replayed signature. HeyGen verification uses the raw body and `Heygen-Signature`, `Heygen-Timestamp`, and `Heygen-Event-Id`, with an approximately five-minute tolerance and event-ID dedupe.

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

This PR includes Drizzle models and a durable repository adapter for providers, influencers, scripts, generations, jobs, provider events, media assets, and generation history. The tables are re-exported from the central schema, and the composition root selects Drizzle whenever `DATABASE_URL` is configured. In-memory persistence is restricted to development/test; production without a database fails closed with `503`. No migration or `db:push` has run, so reviewed SQL and a successful staging migration remain hard deployment gates. Later additive slices introduce publishing jobs and analytics. Binary assets live in object storage; records keep internal URI, checksum, MIME type, size, duration/dimensions, provenance, rights, and timestamps.

The repository currently uses Drizzle push rather than checked-in versioned migrations. The code exposes the schema but has not altered any database. Before deployment, the team must generate and review SQL, apply it to staging, prove restart/recovery and rollback, pass App QA, and obtain Robert's explicit approval.

The first source pilot should be a Radio Calendar event because the repository already has calendar and radio boundaries. A source event creates ideas/drafts first; it does not render or publish until budget, quality, rights, and approval policies pass. Automatic publishing remains disabled until dedicated connector and App QA gates exist.

## Scale, security, and cost

Ten thousand videos per day is an architectural target, not a PR 1 capability. Readiness requires durable queues, horizontal workers, backpressure, provider quotas, idempotency, reconciliation, object storage, observability, cost controls, and per-country policy enforcement.

- Secrets are environment/vault references and are never returned or logged.
- Avatar and voice records require provenance, consent, and usage rights.
- Provider callbacks require HMAC and replay protection.
- Remote downloads require SSRF defenses and content validation.
- Estimated and actual costs attach to every generation; retries share its budget.
- Automatic publishing and paid rendering default off.
