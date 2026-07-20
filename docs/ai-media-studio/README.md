# AI Media Studio

AI Media Studio is Kong's provider-neutral content production domain. It owns the workflow from a script and influencer selection to a rendered, reusable media asset. Publishing, analytics, and event-driven automation will be added behind explicit release gates.

## Ownership

The AI Media Studio Lead owns the contracts, architecture decisions, roadmap, and integration gates in this directory. Backend, frontend, automation/data, and QA agents work in non-overlapping file areas and hand changes back to the Lead for integration.

## Current delivery slice

PR 1 proves one provider-neutral vertical workflow:

1. Open `/ai-media-studio`.
2. Select an influencer, voice, and language.
3. Submit a vertical `9:16` script.
4. Observe the job moving through its lifecycle.
5. Retry or cancel through the same provider-neutral API.

PR 1 uses a fake render provider by default. Persistence uses Drizzle whenever `DATABASE_URL` is configured; the in-memory repository is restricted to development/test, and production without a database fails closed with `503`. The migration has not been applied and is a hard deployment gate. HeyGen rendering and every publishing action are deny-by-default and require explicit configuration. No credentials belong in source or persisted Studio records.

## Documents

- [Architecture](./architecture.md)
- [ADR 0001: Provider-neutral modular boundary](./adr-0001-provider-neutral-boundary.md)
- [Delivery board](./kanban.md)
- [Source snapshot and script variants](./script-generation-contract.md)
- [Durable persistence readiness](./persistence.md)

## API contract

Shared Zod schemas and inferred TypeScript DTOs live in `shared/ai-media-studio.ts`. Frontend and backend must import those definitions rather than creating provider-specific response types.

The authenticated API root is `/api/ai-media-studio`. The only public path is the provider callback `/api/ai-media-studio/webhooks/providers/:providerKey`; public classification does not imply trust. The router must verify the provider HMAC before accepting a payload.

## Release guardrails

- Work is PR-first; never commit an agent-generated fix directly to `main`.
- A second agent must review the diff and run relevant checks.
- App QA route, click/link, API, error, and improvement scouts are release gates.
- Any QA warning blocks deployment.
- Replit deployment requires Robert's explicit approval after the PR/QA summary.
- Paid rendering, automatic publishing, external posting, or increased spend requires approval and a cost estimate.
