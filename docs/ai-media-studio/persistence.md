# AI Media Studio durable persistence

This module defines the durable storage boundary for AI Media Studio. Its tables
are re-exported from the application's central schema and its repository is
selected by the relevant runtime when `DATABASE_URL` is configured. Neither the
PR2 nor PR3 migration has been applied.

## Scope

`shared/models/ai-media-studio-db.ts` exports Drizzle PostgreSQL tables for:

- influencers, scripts and script variants;
- video projects, video versions, render jobs and media assets;
- provider accounts and provider resources;
- webhook receipt/parking, publishing jobs and publications;
- analytics snapshots/events, generation history and the cost ledger;
- source intake, orchestration runs and a transactional outbox.

The model is neutral with respect to video, voice, model, storage and publishing
providers. Provider-specific identifiers and JSON metadata are stored only at
the edges. Credentials are never persisted: `secret_ref` is an opaque locator
that a server-side secret resolver must exchange for credentials at execution
time.

Every table carries `owner_user_id` and `workspace_id`. Core compatibility paths
may default to the `personal` workspace, while PR3 publishing, analytics,
source, orchestration and durable outbox adapters take or enforce explicit
tenant/workspace scope.

## Repository integration

`DrizzleMediaJobRepository` implements the current `MediaJobRepository` and is
wired into the backend composition root. When `DATABASE_URL` is present, the
runtime selects Drizzle. The in-memory repository is limited to development and
test; production without a database fails closed with HTTP `503`.

PR3 adds Drizzle repositories for publishing, analytics, source intake,
orchestration CAS/outbox emissions, and outbox dispatch. The operations runtime
loads these adapters lazily and uses in-memory implementations only in
development/test. The Studio router mounts the operations APIs, but this remains
code-level evidence rather than proof of a deployed workflow or live database.

```ts
import { db } from "../db";
import { DrizzleMediaJobRepository } from "./ai-media-studio/persistence";

const mediaJobs = new DrizzleMediaJobRepository(db, { workspaceId: "personal" });
```

The tables are re-exported by `shared/schema.ts`, which is the entrypoint loaded
by `drizzle.config.ts`. PR2 and PR3 forward/rollback SQL are checked in, but
**this does not mean either migration exists in a database**. PR2 must be applied
before PR3. Deploying either Drizzle runtime before its migration would produce
missing relation or column failures.

Do **not** use `db:push` as an application path. Back up and verify the database,
apply the reviewed PR2 then PR3 SQL to staging, run repository, contention,
restart/recovery and rollback rehearsals, and only then promote through the
normal PR and App QA gates. PR3's final checker and static App QA pass, but live
database and browser-environment gates remain pending.
Production deployment additionally requires Robert's explicit approval.

Creation and updates write an outbox record in the same transaction. Webhook
deduplication uses `(provider_key, event_id)`. Unmatched callbacks are stored
under the non-user sentinel `unresolved:webhook`, then reassigned to the matching
job owner/workspace when consumed. Incoming webhook signature verification still
belongs to the HTTP adapter before `recordWebhook` is called.

The PR3 source orchestrator persists expected state/version compare-and-swap
updates and outbox emissions in the same transaction. Duplicate transition keys
are idempotent; stale state/version updates conflict.

The durable outbox dispatcher is scoped to one owner/workspace. Claims use
`FOR UPDATE SKIP LOCKED`, increment a non-null integer fencing token, and attach
an expiring lease. Ack/nack requires the matching active token and lease;
failures retry to a configured bound and then dead-letter. Reconciliation
recovers expired leases or dead-letters exhausted attempts. The stable message
ID is the transport idempotency identity. These invariants have fake-database
SQL-shape coverage, not live PostgreSQL contention or restart evidence.

## Operational invariants

- A render request is unique by owner, workspace and idempotency key.
- A provider callback is unique by provider and provider event ID.
- Provider job IDs are unique within a provider.
- Publishing, cost-ledger and outbox operations have durable idempotency keys.
- Publishing begins in `pending_approval`; storage does not authorize posting.
- Approval evidence is bound to the immutable publishing-preview digest.
- Scheduled work stores the UTC instant and named timezone; reconciliation owns missed due work.
- Orchestration state changes use expected state/version and emit through the same transaction.
- Outbox ack/nack is fenced by owner, workspace, lease expiry and monotonic token.
- Query paths are indexed by tenant, status and scheduling/capture timestamps.
- Media rows store storage keys/checksums and metadata, never the binary itself.

## Verification

DB-independent suites cover exported table shape, tenant columns, absence of
credential columns, migration ordering/static safety, row mapping, repository
SQL shape, CAS, fencing, retry/dead-letter and deterministic domain behavior.

```sh
node --import tsx --test tests/ai-media-studio-persistence.test.ts
```

They do not connect to PostgreSQL or mutate schema. The authoritative integrated
local run passes 203 non-HTTP and 9 HTTP AI Media Studio tests (212 total), plus
focused TypeScript, client/server bundles, codebase-map validation and diff
hygiene. This is not evidence that a migration works against live PostgreSQL.

## Rollback

Before migration, rollback is a code rollback to the preceding release. After
ordered staging migration, roll application code back without selecting memory
in production and preserve tables during the observation window so queue,
approval, analytics and audit evidence remain recoverable. PR3 rollback must run
before PR2 rollback. Only use the separately reviewed rollback SQL after exports
and recovery checks; automatic publishing, external posting and deployment stay
disabled unless Robert explicitly approves them.
