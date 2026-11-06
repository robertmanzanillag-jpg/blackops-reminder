# Software factory

This adds a separately operated factory to Agents Office. Existing chat, Claude review and KONG audit tasks remain compatible. No live cloud factory is activated by installing this code.

## Operating boundary

The budget is 10,000 cents per calendar month, including declared hosting and other fixed costs, recorded usage and outstanding reservations. Initialize the month's fixed cost through the owner-only panel before admitting work. Configure provider-side spending caps separately; application accounting cannot stop a provider that ignores an execution limit. Unknown outcomes retain their reservations pending reconciliation.

Only trusted deployment configuration supplies execution adapters. Browser/API callers cannot upload executable adapters, approve their own review evidence or override the release policy. Code under test must execute in the isolated builder. Do not pass the web process environment, production database, authentication cookies or real third-party actions into test fixtures.

The factory reuses the project's App QA/developer responsibilities. New pipeline roles are responsibilities, not separate always-running paid model sessions. There is one global construction slot, a daily discovery schedule, bounded repairs, durable outcome records, fencing and a quarantined worker after uncertain execution.

## Deployment preparation

1. Run the targeted factory tests, typecheck, build and browser QA. The build emits `dist/software-factory-worker.cjs` and `dist/software-factory-schema.sql`.
2. Review and apply the prepared SQL migration to the intended PostgreSQL database. Building does not apply it. Do not share a production connection with the simulation processes.
3. Register project metadata and fixed hosting costs through authenticated owner controls. Register actual test/build commands, isolated fixture/staging endpoints and recovery procedures. Leave automatic release unavailable until trusted rehearsal and recovery evidence exists.
4. Supply trusted source-export, budget-enforced model, independent review, PR, browser fixture and deployment/recovery integrations. Provider support and unattended model access must be verified on the actual worker host; a local desktop subscription is not proof.
5. Set `SOFTWARE_FACTORY_ENABLED=true`, `SOFTWARE_FACTORY_OWNER_ID`, and an absolute `SOFTWARE_FACTORY_ADAPTER_MODULE` path in the deployment configuration. That trusted module exports `createFactoryWorkerOptions({store})` and passes the supplied store to its runtime composition. The entrypoint rejects a different returned store to prevent accounting and pipeline evidence from using different ledgers. Start `npm run factory:worker` separately from the web application. Use the entrypoint's explicit configuration checks. Missing adapters, uninitialized budget or unavailable storage must remain visible blockers.
6. Complete three real rehearsal cycles and one recovery rehearsal per application before enabling low-risk automatic release. Synthetic tests in this repository do not qualify a live application.

Changes involving authentication, permissions, payments, migrations/deletion, infrastructure, dependencies, important business behavior or uncertain risk remain human-reviewed. Exact candidate/base revisions, independent clean review, complete synthetic mobile/desktop simulation and fresh recovery evidence are required for automatic release. Existing manual deployment gates stay unchanged.

## Validation and recovery

`npm run test:factory` exercises policy, isolated builder, browser simulation, durable store, worker and pipeline behavior. The browser test uses loopback fixtures with synthetic state and no live third-party actions. Its seeded bug, repaired cycles and restoration demonstrate the test mechanism only.

A bad candidate is stopped before release. Post-release verification may request restoration through the trusted provider adapter; lack of verified recovery support blocks automatic release rather than pretending recovery succeeded. Pause stops admission to new work; uncertain in-flight work remains accounted for. To remove this feature, pause the worker, stop its service, retain its ledger/evidence tables for reconciliation, and revert the feature commit. Do not delete outstanding reservations or restore application data blindly.

## Remaining activation requirements

`createGitHubFactorySourceExporter` supplies the source-export portion of the
builder through a trusted authenticated GitHub client and repository allowlist.
It checks the exact commit/tree and each blob identity, excludes protected files
before download, and rejects special files and unsafe paths. It does not publish
PRs or grant GitHub permissions. Publication still requires a separate adapter
that applies the tested patch and reconciles uncertain branch/PR creation.

The worker keeps its process alive but stops database polling during confirmed
idle periods. It wakes hourly, schedules discovery and drains available funded
work without sleeping between stages. During active work, maintenance runs every
15 seconds; lease deadlines and cancellation remain enforced. A separate queue
inspection distinguishes genuine idle from another running lease, pending
verification/recovery, or an unknown outcome. Running/recovery states use short
rechecks; unknown execution quarantines and exits the loop for reconciliation.
Shutdown interrupts idle sleep promptly. Newly queued work during dormancy can
wait up to one hour unless an operator restarts the worker.

Idle periods do not write heartbeats: the existing 45-second liveness threshold
is unchanged. The dashboard must not interpret stale heartbeat evidence as a
live worker. Manual dashboard refreshes and other application queries can still
keep a shared database active.

Before choosing Replit production PostgreSQL, budget its active compute time,
including the provider's idle-suspension tail after every wake. Hourly dormancy
reduces idle queries but does not enforce a total $100 invoice limit. Long-running
work, recovery, other database users, hosting, storage and provider usage still
require verified costs and budget reservations. Do not treat the database as free
or assume it is included in the VM price.

The trusted adapter module can use `createTrustedFactoryWorkerOptions` from
`server/software-factory-runtime.ts` to compose the eight real stage callbacks
with the durable store. It validates reservations, requires initialized costs,
and scopes persisted jobs and evidence to the configured owner. The worker
entrypoint rejects partial executor configurations before processing any jobs.
This composition does not supply provider credentials or substitute test doubles
for real execution, review, deployment or recovery.

Robert clarified that the $100 monthly factory ceiling is incremental to the
existing Replit subscription and Kong. All costs attributable to the factory still count,
including persistent hosting, database, isolated runners, AI usage and recovery.
Shared account credits are not a dedicated factory budget. Do not enable account
auto-reload or treat an account-wide spending control as a factory-only cap.

A real cloud host and its fixed cost, a budget-enforced unattended coding provider, actual repository/PR credentials on that host, isolated app launch configuration, and a deployment provider with verified restoration must be configured. This change does not purchase hosting, alter secrets, migrate live data or claim production rehearsals.

The builder runs source mounts read-only for checks. Configure commands/image to write build output and caches to `/tmp` or an explicitly isolated artifact directory. The digest-pinned image must already contain dependencies; network installation during checks is disabled.

## Optional object ledger (not activated)

`createSoftwareFactoryObjectStore` provides the store contract using one private
object and conditional generation writes. It requires explicit initialization,
an operator-verified synchronized clock and a bounded clock-error allowance.
Missing, malformed or inconsistent state blocks execution; it never silently
creates a replacement budget. Mutation receipts reconcile lost acknowledgments;
unconfirmed writes stop rather than replay. Reservations, global execution
leases, recovery escrow and rehearsal evidence remain persistent. Space is
reserved for in-flight outcomes and recovery before admitting more work.

`createGcsFactoryTransport` pins downloads to the metadata generation and checks
size and checksum. Only a precondition failure is a write conflict. Authentication
is supplied by the trusted host, never by project input. Requests and payloads
are bounded, and the adapter itself performs no retries. Store and transport
size limits must agree. Neither module selects itself as the live backend.

Web controls, pipeline composition and the worker share a lazy store selector.
The default remains PostgreSQL. Selecting `SOFTWARE_FACTORY_STORAGE_BACKEND=object`
requires an absolute `SOFTWARE_FACTORY_STORE_MODULE` path exporting
`createFactoryStore()`. The trusted module supplies authentication, clock and
the same bucket/object/ledger identity on both hosts. Selection is frozen on
first use until process restart; invalid configuration, provider initialization
failure or missing methods never fall back to PostgreSQL. Runtime startup does
not initialize a blank ledger or register a new monthly budget.

Before activation, verify conditional writes on the actual Replit bucket,
configure the same backend in both the worker and owner controls, verify host
clock synchronization, and account for requests, transfer and retained records.
The ledger retains receipts and financial history; capacity exhaustion requires
an operator-reviewed archival migration. Replit App Storage does not provide
object versioning, so a separately verified backup and recovery procedure is
also required. Never restore an older ledger over outstanding commitments.
This backend removes the need for factory ledger SQL queries only once wired
into the live service; it is not a provider-enforced spending cap.

Monthly admission also includes outstanding reservations from earlier months
and the full cost of older jobs settled in the current month. The original
escrow remains available for recovery. Because execution cannot be reliably
split at midnight, settlement is conservatively counted in both the original
admission month and the settlement month, once within each month's view.
Stopped unknown jobs receive a settlement timestamp when reconciled; their
actual cost replaces the carried reservation. Settled old costs stop counting
in later months. New-month fixed hosting costs must still be configured and
funded; this accounting does not provide a provider billing ceiling or an
automatic monthly budget initializer.

### Replit development storage proof (2026-11-06)

An isolated temporary runtime using `@replit/object-storage` 1.0.0 and its
`@google-cloud/storage` 7.22.0 dependency verified create-only writes, successful
generation changes, rejection of a stale write with HTTP 412, and exactly one
winner between concurrent writes using the same generation. A separate Node
process confirmed persistence. The synthetic object was at most 126 bytes;
11 GCS requests completed with automatic retries disabled. The estimated test
cost was below $0.00007, not an observed billing charge. No production database
queries or application dependency changes were needed.

The probe accessed the underlying bucket via the SDK's internally typed
`getBucket()` method. This establishes bucket/authentication behavior but is not
a production integration contract. The live adapter still needs a supported
authenticated transport, verified clock and backup/recovery procedures.

The subscription dispatch probe remains blocked: `@codex review` on PR 327
received a bot response requesting account connection, despite settings showing
the correct GitHub account connected and the repository enabled. Renewing the
existing connection and repeating the request from GitHub's UI produced the
same response. A published private cloud environment and passing setup tests
do not prove unattended GitHub dispatch. No worker was activated on that basis.
