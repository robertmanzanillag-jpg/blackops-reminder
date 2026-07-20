# ADR 0001: Provider-neutral modular boundary

- Status: Accepted for PR 1
- Date: 2026-07-20

## Context

Kong needs an AI media platform that can start with HeyGen but replace or combine providers without changing business workflows. The existing application is an Express/React monolith, so a separate service would add operational cost before the first workflow is proven.

## Decision

Build AI Media Studio as an isolated domain module inside the current repository. HTTP handlers call application use cases; use cases call provider, queue, repository, clock, ID, and asset-storage ports. Only adapters know provider payloads and identifiers.

The UI and shared DTOs expose provider-neutral jobs. Provider health may identify an adapter by key for operations, but generation requests do not choose a provider. A selection policy chooses an enabled provider with the required capabilities.

PR 1 uses a fake provider and process-local state by default. HeyGen and publishing flags are deny-by-default. PR 2 must add durable persistence/outbox/queue semantics before autonomous source workflows are enabled.

## Consequences

- A provider can be replaced without rewriting UI or application use cases.
- Contract tests can run against fake and real adapters.
- The first PR remains reviewable and carries no database migration risk.
- Restarting PR 1 loses jobs; it must not be described or deployed as durable production execution.
- Provider-specific features require capability negotiation instead of leaking fields into common DTOs.

## Rejected alternatives

- Calling HeyGen directly from Express routes or React components: creates lock-in and spreads provider concepts.
- Building a separate distributed platform in PR 1: adds operational surface before validating the contract.
- Reusing pending approvals as the render queue: its lifecycle and guarantees do not match rendering jobs.
