# AI Media Studio

AI Media Studio is Kong's provider-neutral content production domain. It owns the workflow from source intake and script/influencer selection through rendering, reusable assets, approval-gated publishing records, and normalized analytics. External publishing and provider ingestion remain behind explicit release gates.

## Ownership

The AI Media Studio Lead owns the contracts, architecture decisions, roadmap, and integration gates in this directory. Backend, frontend, automation/data, and QA agents work in non-overlapping file areas and hand changes back to the Lead for integration.

## Current delivery stack

- PR #67 (`codex/ai-media-studio`) is the provider-neutral vertical foundation.
- PR2 (`codex/ai-media-studio-core`) is stacked on that foundation and adds the durable core and owned-media model.
- PR3 lives on `codex/ai-media-studio-operations`, stacked on PR2. Its GitHub review state is tracked outside this document.

The current PR3 code slice adds provider-neutral contracts, repositories, services, fake adapters, HTTP routes, and UI surfaces for manual/scheduled publishing drafts, server-generated immutable previews and approval, scheduling/reconciliation, normalized analytics and attribution/cost summaries, deduplicated source intake, guarded orchestration with compare-and-swap/outbox emissions, and reusable worker/outbox operations. The single Studio router now composes these APIs and remains fail-closed outside development/test when durable persistence is unavailable.

This is code and test evidence, not operational evidence. Focused AI Media Studio tests, TypeScript, independent checker review, security review, and static App QA cover the implemented slices. No live browser target was available. No real publishing OAuth or platform adapter is connected, no external post is authorized, and no live provider ingestion has run. The reviewed PR2 through PR6 plus PR8 migrations are checked in but unapplied; `db:push` has not run and must not be used as a substitute for reviewed migration execution. Live PostgreSQL, staging restart/recovery, real load, and live-environment QA remain pending.

The deterministic 10,000-job rehearsal exercises arithmetic and fake-provider assumptions only. It is explicitly not evidence of 10,000-video/day capacity.

The current production-assets slice adds a streaming Node HTTPS artifact reader, S3/R2-compatible multipart owned storage, short-lived S3-compatible delivery signing, and a strict `AI_MEDIA_STUDIO_ASSET_*` composition factory. Configuration is atomic and fail-closed: an empty namespace leaves delivery unavailable, while any partial or unsafe namespace rejects startup with a generic error. An explicitly injected signer takes precedence for controlled composition tests. The worker factory starts no timer, process, or network request, and repository presence is never treated as a worker heartbeat.

This remains local code/test evidence. No live artifact was downloaded, no object was uploaded or signed against a real account, no worker heartbeat exists, no migration was applied, and no deploy was performed. Production worker operation, lifecycle/retention configuration, staging restart/recovery, throughput, and provider/storage quota evidence remain release gates.

The publishing-account slice reuses the server-owned provider-account identity as a vault-reference-only social connection record. Durable readiness reads are tenant/workspace scoped, expose one internal connection ID at most, allow only four provider-neutral capabilities, and fail closed when accounts are incomplete or ambiguous. Publishing-job account references are constrained to the same tenant, workspace, and platform. No endpoint accepts a token or secret value, OAuth is not implemented, and automatic publishing remains disabled.

The PR9 control-plane slice adds provider-neutral, durable OAuth session contracts without enabling a provider flow. It generates 48-byte opaque state, persists only its SHA-256 digest, requires PKCE S256, stores the verifier only through a purpose/version-scoped vault reference, and atomically consumes an unexpired state once using only the digest plus platform fence. Sessions retain the exact tenant, actor, account, redirect and requested-scope snapshot behind a composite tenant/workspace/account/platform foreign key. Provider credential metadata defaults all legacy accounts to `unverified` and version zero; a social connection is unusable until a future approved connector records an active, versioned, unexpired credential.

The PR10 managed-OAuth-vault slice adds internal-only production composition for short-lived PKCE verifier storage and provider authorization URLs. The S3 PKCE vault stores only bounded JSON verifier envelopes under `vault://ai-media-studio/oauth-pkce/v1/<uuid>` references, writes exact keys with SSE-KMS, a customer KMS key ARN, S3 Bucket Keys and `IfNoneMatch: "*"`, validates encryption/metadata/envelope bindings on read, and deletes only exact validated objects. The authorization URL builder uses fixed audited endpoints/scopes from the platform manifests: TikTok Web has no PKCE parameter, while Meta/Instagram and the current Google confidential Web Server policy omit PKCE. Google still applies offline-consent parameters. The production runtime is all-or-nothing for `AI_MEDIA_STUDIO_OAUTH_*`; absent config leaves OAuth unavailable, while partial, unknown or unsafe config fails closed with a generic error. Construction performs no AWS, database or provider I/O.

PR12 adds the durable fenced callback saga and atomic credential-version/account binding without mounting it. PR13 adds inert authorization-code and long-lived token adapters with application-level KMS envelope encryption (AES-256-GCM) plus S3 SSE-KMS, immutable conditional writes, exact contextual AAD/KMS digests, deterministic recovery, strict absence/error handling and a separate token-secret reader capability. PR14 adds a dedicated durable cleanup outbox with fenced leases, exact source revalidation, two-pass deletion, conservative active-token retention, and an inert double-snapshot S3/KMS posture preflight. PR15 adds a separate provider-neutral staged-connection contract for exchange, discovery, explicit target selection and later activation, plus durable candidate and immutable selection evidence. It never selects the first provider result, derives capabilities locally from verified tasks, and persists only safe token-role/lifetime descriptors rather than tokens or vault references.

PR16 is preserved as draft PR #97 on `codex/ai-media-studio-provider-activation-cas`. Its bounded scope adds an exact selected-target/account activation CAS, a role- and target-bound OAuth vault schema v2 with one secret per artifact role, and additive activation/binding/vault-operation schema declarations. The reviewed forward/rollback SQL and executable Drizzle activation adapter remain pending, so this is not migration-ready. This path is not composed into the runtime and makes no real AWS or provider call. It mounts no route, starts no worker, posts no content and performs no deployment. The legacy publishing-readiness path remains fail-closed until a later exact-target binding integration is reviewed. Effective IAM/IaC evidence, cleanup v2 runtime wiring, sandbox connectors, refresh/revocation and provider proof remain mandatory before any callback or publishing route is enabled.

PR17 is preserved as draft PR #99 on `codex/ai-media-studio-heygen-launch-roster`, stacked on PR #97. It adds a launch-only roster wizard for 5–10 HeyGen avatars, with 10 videos planned per avatar (50–100 total), durable tenant-scoped mappings, and draft provider-neutral influencer/resource records. The onboarding request is the one narrow boundary allowed to carry `avatar_id` and `voice_id`; responses, URLs, browser storage, logs, and public catalog DTOs omit those native identifiers. The inert render adapter now follows HeyGen Studio V2 (`POST /v2/video/generate`) and accepts only `data.video_id`. Roster setup does not enqueue or generate a video, spend credits, prove consent/rights, or authorize deployment. A unique active/verified server-side HeyGen account is still required; account/API-key provisioning, governance approval, cost admission, sandbox proof, and a separate launch approval remain blockers.

PR18 is preserved as draft PR #100 on `codex/ai-media-studio-roster-daily-plan`, stacked on PR #99. It derives a dated, server-timezone-bound daily preview from the active launch roster: 5–10 avatars create exactly 50–100 `not_queued` slots, 10 per avatar. Every slot carries the same launch blockers (`script_batch_required`, `governance_approval_required`, `budget_reservation_required`, `sandbox_generation_required`, `human_launch_approval_required`), `canGenerate=false`, and `noSpendGuarantee=true`. The client cannot choose the daily accounting date or timezone. This is a non-durable read model: the route and UI only preview planning state; they do not create scripts, reserve budget, enqueue render jobs, call HeyGen, publish, or deploy.

PR19 is preserved as draft PR #102 on `codex/ai-media-studio-durable-daily-admission`, stacked on PR #100. It adds provider-neutral pure admission contracts, four durable PostgreSQL table declarations, reviewed-but-unapplied forward/rollback SQL, and an unexported/unmounted reservation-only Drizzle transaction for daily plans, slots, micro-USD budget buckets, and immutable reservations. The transaction uses PostgreSQL wall-clock time, tenant/workspace and governance advisory locks, exact account/credential and row locks, idempotent replay, and one budget/reservation/slot CAS. Approval, sandbox, policy, quote, kill-switch, and governance evidence is digest-bound, but the non-governance evidence is not yet backed by a durable authority; therefore this repository is not runtime-ready. Reserved money moves to committed immediately before a future provider submission and cannot auto-refund after an ambiguous response. This slice mounts no route, creates no render job/outbox command, calls no provider, applies no migration, spends nothing, and deploys nothing.

## Documents

- [Architecture](./architecture.md)
- [ADR 0001: Provider-neutral modular boundary](./adr-0001-provider-neutral-boundary.md)
- [Delivery board](./kanban.md)
- [Requirements matrix](./requirements-matrix.md)
- [GitHub recovery checkpoint — 2026-07-21](./github-checkpoint-2026-07-21.md)
- [OAuth provider readiness and sandbox gate](./oauth-provider-readiness.md)
- [Source snapshot and script variants](./script-generation-contract.md)
- [Durable persistence readiness](./persistence.md)

## API contract

Foundation DTOs live in `shared/ai-media-studio.ts`; PR3 publishing, analytics, source, and policy DTOs live in `shared/ai-media-studio-operations.ts`; PR9/PR10 transient OAuth control-plane DTOs live in `shared/ai-media-studio-oauth.ts`. Frontend and backend must import those definitions rather than creating provider-specific response types.

The authenticated API root remains `/api/ai-media-studio`. Provider callbacks use `/api/ai-media-studio/webhooks/providers/:providerKey/accounts/:endpointKey`; the route is public only for reachability, resolves the opaque endpoint to exactly one tenant/provider account, and requires verified raw-body provider HMAC. Production does not use the legacy provider-only callback or process-global webhook secrets. PR3 adds mounted routes for publishing previews/jobs/connections, analytics summaries/attribution, sources, and the read-only automation policy. Mounted code is not deployment evidence: no real connector, migration, or external post is enabled.

## Release guardrails

- Work is PR-first; never commit an agent-generated fix directly to `main`.
- A second agent must review the diff and run relevant checks.
- App QA route, click/link, API, error, and improvement scouts are release gates.
- Any QA warning blocks deployment.
- Replit deployment requires Robert's explicit approval after the PR/QA summary.
- Paid rendering, automatic publishing, external posting, or increased spend requires Robert's approval and a cost estimate.
- Manual or scheduled publishing records never authorize a platform post without matching immutable-preview approval and a configured, approved connector.
