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
5. Set `SOFTWARE_FACTORY_ENABLED=true`, `SOFTWARE_FACTORY_OWNER_ID`, and an absolute `SOFTWARE_FACTORY_ADAPTER_MODULE` path in the deployment configuration. That trusted module exports `createFactoryWorkerOptions()` and composes the store/pipeline/provider adapters. Start `npm run factory:worker` separately from the web application. Use the entrypoint's explicit configuration checks. Missing adapters, uninitialized budget or unavailable storage must remain visible blockers.
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
existing Replit subscription. All costs attributable to the factory still count,
including persistent hosting, database, isolated runners, AI usage and recovery.
Shared account credits are not a dedicated factory budget. Do not enable account
auto-reload or treat an account-wide spending control as a factory-only cap.

A real cloud host and its fixed cost, a budget-enforced unattended coding provider, actual repository/PR credentials on that host, isolated app launch configuration, and a deployment provider with verified restoration must be configured. This change does not purchase hosting, alter secrets, migrate live data or claim production rehearsals.

The builder runs source mounts read-only for checks. Configure commands/image to write build output and caches to `/tmp` or an explicitly isolated artifact directory. The digest-pinned image must already contain dependencies; network installation during checks is disabled.
