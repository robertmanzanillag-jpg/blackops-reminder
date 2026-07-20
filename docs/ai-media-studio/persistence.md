# AI Media Studio durable persistence

This module defines the durable storage boundary for AI Media Studio. Its tables
are re-exported from the application's central schema and its repository is
selected by the relevant runtime when `DATABASE_URL` is configured. None of the
PR2, PR3, or PR4 migrations has been applied.

## Scope

`shared/models/ai-media-studio-db.ts` exports Drizzle PostgreSQL tables for:

- influencers, scripts and script variants;
- video projects, video versions, render jobs, media assets and asset-ingest jobs;
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
source, orchestration and durable outbox adapters and the PR4 ingest repository
take or enforce explicit tenant/workspace scope.

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

PR4 adds `DrizzleAssetIngestRepository` for the private provider-output import
queue. One ingest is idempotently associated with each tenant/workspace/render.
Due claims use `FOR UPDATE SKIP LOCKED`; completion and failure require the
matching unexpired lease, and independent attempt and lease-recovery bounds end
in dead letter. A successfully committed object whose catalog link failed stays
completed and appears in a deterministic bounded completed-unlinked scan.
Fakes cover the bounded reader, tenant content-addressed object store and
short-lived delivery signer contracts. Production implementations of all three
are still missing, and the runtime starts no ingest worker automatically.

```ts
import { db } from "../db";
import { DrizzleMediaJobRepository } from "./ai-media-studio/persistence";

const mediaJobs = new DrizzleMediaJobRepository(db, { workspaceId: "personal" });
```

The tables are re-exported by `shared/schema.ts`, which is the entrypoint loaded
by `drizzle.config.ts`. PR2, PR3, and PR4 forward/rollback SQL are checked in,
but **this does not mean any migration exists in a database**. Apply PR2 before
PR3 and PR3 before PR4. Deploying a Drizzle runtime before its migration would
produce missing relation or column failures.

Do **not** use `db:push` as an application path. Back up and verify the database,
apply the reviewed PR2 then PR3 then PR4 SQL to staging, run repository, contention,
restart/recovery and rollback rehearsals, and only then promote through the
normal PR and App QA gates. PR #71 and PR4 both passed final checker and static
App QA; live database and browser-environment
gates remain pending.
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
- Asset ingest is unique by owner, workspace and render job; a duplicate with different private input fails.
- Ingest completion/failure is fenced by an active unexpired lease; lease recovery has an independent terminal bound.
- An owned MP4 uses a tenant-scoped content-addressed key and a canonical active asset is unique by tenant, kind and checksum.
- Provider URLs stay private to the ingest queue; library/job DTOs expose neither them nor storage keys.
- Delivery URLs are short-lived, authenticated, tenant/status gated and minted on demand rather than persisted.
- Completed-but-unlinked ingests remain discoverable through a bounded reconciliation query.
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
PR4-focused suites additionally cover bounded MP4 ingest, content-addressed fake
storage, lease loss/recovery, completed-unlinked repair, canonical linkage,
redaction, authenticated delivery and client error handling.

```sh
node --import tsx --test tests/ai-media-studio-persistence.test.ts
```

They do not connect to PostgreSQL or mutate schema. PR #71's authoritative run
passed 203 non-HTTP and 9 HTTP AI Media Studio tests (212 total). PR4 adds focused
tests on top of that baseline; final aggregate/checker evidence belongs in the
PR review. Neither result proves migration behavior against live PostgreSQL,
real provider download, object-storage delivery, deployment or capacity.

## Rollback

Before migration, rollback is a code rollback to the preceding release. After
ordered staging migration, roll application code back without selecting memory
in production and preserve tables during the observation window so queue,
approval, analytics and audit evidence remain recoverable. PR3 rollback must run
before PR2 rollback; if PR4 was applied, run its data-preserving rollback before
PR3. PR4 keeps the ingest table, render output link, private references, queue
evidence and owned asset rows, removing only its active-checksum uniqueness rule
after restoring a lookup index. Only use separately reviewed rollback SQL after
exports and recovery checks; automatic publishing, external posting and
deployment stay disabled unless Robert explicitly approves them.
