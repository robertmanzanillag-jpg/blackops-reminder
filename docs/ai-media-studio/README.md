# AI Media Studio

AI Media Studio is Kong's provider-neutral content production domain. It owns the workflow from source intake and script/influencer selection through rendering, reusable assets, approval-gated publishing records, and normalized analytics. External publishing and provider ingestion remain behind explicit release gates.

## Ownership

The AI Media Studio Lead owns the contracts, architecture decisions, roadmap, and integration gates in this directory. Backend, frontend, automation/data, and QA agents work in non-overlapping file areas and hand changes back to the Lead for integration.

## Current delivery stack

- PR #67 (`codex/ai-media-studio`) is the provider-neutral vertical foundation.
- PR2 (`codex/ai-media-studio-core`) is stacked on that foundation and adds the durable core and owned-media model.
- PR3 lives on `codex/ai-media-studio-operations`, stacked on PR2. Its GitHub review state is tracked outside this document.

The current PR3 code slice adds provider-neutral contracts, repositories, services, fake adapters, HTTP routes, and UI surfaces for manual/scheduled publishing drafts, server-generated immutable previews and approval, scheduling/reconciliation, normalized analytics and attribution/cost summaries, deduplicated source intake, guarded orchestration with compare-and-swap/outbox emissions, and reusable worker/outbox operations. The single Studio router now composes these APIs and remains fail-closed outside development/test when durable persistence is unavailable.

This is code and test evidence, not operational evidence. The final independent checker and static App QA pass with no P0-P3 findings or warnings, backed by 212 focused AI Media Studio tests, focused TypeScript, and client/server bundles. No live browser target was available. No real publishing OAuth or platform adapter is connected, no external post is authorized, and no live provider ingestion has run. The PR2 and PR3 migrations are both checked in but unapplied; `db:push` has not run and must not be used as a substitute for reviewed migration execution. Live PostgreSQL, staging restart/recovery, real load, and live-environment QA remain pending.

The deterministic 10,000-job rehearsal exercises arithmetic and fake-provider assumptions only. It is explicitly not evidence of 10,000-video/day capacity.

## Documents

- [Architecture](./architecture.md)
- [ADR 0001: Provider-neutral modular boundary](./adr-0001-provider-neutral-boundary.md)
- [Delivery board](./kanban.md)
- [Requirements matrix](./requirements-matrix.md)
- [Source snapshot and script variants](./script-generation-contract.md)
- [Durable persistence readiness](./persistence.md)

## API contract

Foundation DTOs live in `shared/ai-media-studio.ts`; PR3 publishing, analytics, source, and policy DTOs live in `shared/ai-media-studio-operations.ts`. Frontend and backend must import those definitions rather than creating provider-specific response types.

The authenticated API root remains `/api/ai-media-studio`. Provider callbacks use `/api/ai-media-studio/webhooks/providers/:providerKey/accounts/:endpointKey`; the route is public only for reachability, resolves the opaque endpoint to exactly one tenant/provider account, and requires verified raw-body provider HMAC. Production does not use the legacy provider-only callback or process-global webhook secrets. PR3 adds mounted routes for publishing previews/jobs/connections, analytics summaries/attribution, sources, and the read-only automation policy. Mounted code is not deployment evidence: no real connector, migration, or external post is enabled.

## Release guardrails

- Work is PR-first; never commit an agent-generated fix directly to `main`.
- A second agent must review the diff and run relevant checks.
- App QA route, click/link, API, error, and improvement scouts are release gates.
- Any QA warning blocks deployment.
- Replit deployment requires Robert's explicit approval after the PR/QA summary.
- Paid rendering, automatic publishing, external posting, or increased spend requires Robert's approval and a cost estimate.
- Manual or scheduled publishing records never authorize a platform post without matching immutable-preview approval and a configured, approved connector.
