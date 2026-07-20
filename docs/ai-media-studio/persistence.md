# AI Media Studio durable persistence

This module defines the durable storage boundary for AI Media Studio. Its tables
are re-exported from the application's central schema and its repository is
selected by the runtime when `DATABASE_URL` is configured. The production
migration has not been applied.

## Scope

`shared/models/ai-media-studio-db.ts` exports Drizzle PostgreSQL tables for:

- influencers, scripts and script variants;
- video projects, video versions, render jobs and media assets;
- provider accounts and provider resources;
- webhook receipt/parking, publishing jobs and publications;
- analytics snapshots/events, generation history and the cost ledger;
- source intake and a transactional outbox.

The model is neutral with respect to video, voice, model, storage and publishing
providers. Provider-specific identifiers and JSON metadata are stored only at
the edges. Credentials are never persisted: `secret_ref` is an opaque locator
that a server-side secret resolver must exchange for credentials at execution
time.

Every table carries `owner_user_id` and `workspace_id`. The repository currently
defaults to the `personal` workspace to remain structurally compatible with the
existing `MediaJobRepository` port; a composition root can pass a workspace ID
today, and the port can add an explicit workspace argument later without a data
migration.

## Repository integration

`DrizzleMediaJobRepository` implements the current `MediaJobRepository` and is
wired into the backend composition root. When `DATABASE_URL` is present, the
runtime selects Drizzle. The in-memory repository is limited to development and
test; production without a database fails closed with HTTP `503`.

```ts
import { db } from "../db";
import { DrizzleMediaJobRepository } from "./ai-media-studio/persistence";

const mediaJobs = new DrizzleMediaJobRepository(db, { workspaceId: "personal" });
```

The tables are re-exported by `shared/schema.ts`, which is the entrypoint loaded
by `drizzle.config.ts`. This makes them discoverable for a future migration, but
**does not mean the tables exist in any database yet**. Generating, reviewing,
and applying the migration is a hard deployment gate; deploying the Drizzle
runtime before that would make generation requests fail on missing relations.

Do **not** use `db:push` against production. Generate and inspect SQL without
applying it, back up the database, apply the reviewed migration to staging, run
repository and restart/recovery tests, and only then promote through the normal
PR and App QA gates. Production deployment additionally requires a passing App
QA report and Robert's explicit approval.

Creation and updates write an outbox record in the same transaction. Webhook
deduplication uses `(provider_key, event_id)`. Unmatched callbacks are stored
under the non-user sentinel `unresolved:webhook`, then reassigned to the matching
job owner/workspace when consumed. Incoming webhook signature verification still
belongs to the HTTP adapter before `recordWebhook` is called.

## Operational invariants

- A render request is unique by owner, workspace and idempotency key.
- A provider callback is unique by provider and provider event ID.
- Provider job IDs are unique within a provider.
- Publishing, cost-ledger and outbox operations have durable idempotency keys.
- Publishing begins in `pending_approval`; storage does not authorize posting.
- Query paths are indexed by tenant, status and scheduling/capture timestamps.
- Media rows store storage keys/checksums and metadata, never the binary itself.

## Verification

The DB-independent test suite checks the exported table inventory, tenant
columns, absence of credential columns, critical unique indexes and the render
row-to-domain mapper:

```sh
node --import tsx --test tests/ai-media-studio-persistence.test.ts
```

It does not connect to a database or mutate schema.

## Rollback

Before migration, rollback is a code rollback to the preceding release. After
migration, roll the application back without selecting the in-memory repository
in production. Preserve the new tables during the observation window so queued
jobs and audit evidence remain recoverable. Only then use a separately reviewed
down migration to drop `ai_media_*` tables; export webhook, cost and publication
records before removal.
