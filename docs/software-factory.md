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

### Responses API alternative

`createOpenAiFactoryTextProvider` supplies bounded, stateless text generation
through the regular Responses API. The operator must inject authenticated
requests with no retries, an exact dated model, verified upper-bound token
prices with an expiry, and a maximum input size for that pricing tier. The
provider counts the exact prompt before generation and checks the maximum
output cost against an already durable reservation. Credits do not reduce
the ledger charge. Ambiguous requests retain the full reservation; reported
usage is accepted only for a terminal, matching response within its limits.

`createOpenAiFactoryPatchGenerator` connects this provider to the existing
builder using an operator-owned per-repository file allowlist. It reads only
bounded, regular UTF-8 files from the exact source export, rejects credential
paths and special files, and preserves the returned patch for isolated tests
and publication. The workspace must remain private and immutable during model
context collection. Ambiguous generation keeps its reservation; a known failed
response returns its actual conservative cost and no usable patch.

These adapters do not themselves activate the worker, establish release evidence, or enforce the
cloud hosting bill. Live pricing, authentication, credit availability, stage
wiring, and end-to-end rehearsal remain deployment requirements.

A live development probe on 2026-11-06 downloaded and verified the provider at
commit `35aeece4841b389b3666ad9bcc25b4ecd729eb7d`. With a dedicated restricted
Responses key in Replit Secrets, input counting and generation completed in
two requests: 23 input tokens, 2 output tokens, response `READY`. The manual
probe reserved one cent and conservatively charged that cent in its report.
It used synthetic text only, not production data. This verifies the API path,
not a running production worker. Deployment secrets still require synchronization
when the dedicated factory deployment is prepared.

All 24 builder, Responses-provider and patch-generator tests passed on Replit
Linux against six individually SHA-256-verified files from commit
`a7f26ad8e056c10f01c7f560314f6cfb8fc930c5`. The test process inherited only PATH,
a temporary HOME and TMPDIR, not application credentials. These include mocked
Docker command-envelope and cleanup tests; they do not prove Docker support in
a published Reserved VM. Full local TypeScript checking also passed.

The hosting inspection still found the existing application on Autoscale.
Published local files are not a durable SQLite store. Docker was verified in
development only, not in a published Reserved VM. Replit's documented spending
shutdown applies to the account/workspace, with no verified factory-only hard
cap; applying it globally could interrupt unrelated applications. The factory
worker remains disabled pending supported execution, durable storage and a
verified total-cost configuration. API connectivity is no longer the blocker.

### Exact GitHub candidate publication

`createGitHubFactoryPullRequestPublisher` now publishes verified patches using
an injected GitHub client and an operator-owned repository/base-branch allowlist.
It verifies source blobs and reconstructs the complete Git tree, creates a
commit with the exact base as its sole parent, and opens a draft PR on a
deterministic factory branch. Existing branches/PRs must match the same identity;
ambiguous results remain unconfirmed rather than being retried as free work.
It never updates existing references or merges. Supported patches modify
existing LF UTF-8 text files only; BOM, creation/deletion, renames, binary and
mode changes are rejected. Seven synthetic tests pass, including lost-ack
reconciliation and byte-preservation regressions. Live GitHub publication is
not yet wired into an unattended worker.

### Dedicated hosting probe, 2026-11-06

A separate empty Replit application was created to avoid modifying Daily Planner
or Kong. The reviewed dependency-free probe at commit 8897b98 was downloaded
with SHA-256 verification. It started in development and was published on a
private Reserved VM, 0.5 vCPU / 2 GiB. The UI quoted $15/month ($0.0208/hour).
Deployment dfa70b3a-ff8b-4311-a365-2528ea66f624 reached success after transient
startup health-check errors. The published process returned factoryActive=false
and docker=unavailable. This establishes that the default published environment
does not expose a working Docker command/daemon to this probe; it does not prove
that every possible Replit runner configuration is unsupported. The factory
was not enabled. The account also displays exhausted credits and a grace-period
warning for existing publications. No shared account cap or recharge setting
was changed, and Kong was untouched.

The temporary probe was unpublished after Robert confirmed deletion: Replit's
unpublish dialog explicitly deletes its saved domain and deployment history.
Pausing would not cancel billing. Its quoted rate while published was $0.0208/hour;
this is a probe only, not a production factory. No factory credentials were
copied to the new application. The source code remains available for a later
supported runner test. Full TypeScript checking passed after the publisher
addition. Remaining production requirements include a supported isolated runner,
real independent review/QA/deploy/rollback adapters, three verified rehearsal
cycles, durable ledger authentication and bounded storage/hosting expenditure.

### Alternative isolated runner verified

The bounded, credential-free GitHub Actions probe passed on the public
repository at commit 00da2eab6af3d5730fe28868d532914d9daa3d77:
https://github.com/robertmanzanillag-jpg/blackops-reminder/actions/runs/42194734935
The workflow uses ubuntu-24.04, no token permissions, no checkout, a fixed
five-minute job limit and the previously pinned official Node image. It asserts
non-root execution, no non-loopback interfaces, no Docker socket, no inherited
credential variables and denied root-filesystem writes. This provides a viable
runner direction independent of Replit's published Docker availability.
GitHub documents standard public-repository runners as free:
https://docs.github.com/en/actions/reference/runners/github-hosted-runners
Private repositories and larger runners must not inherit that zero-cost
assumption. The probe is not connected to builder/simulator execution yet.
No automatic job schedule was installed. Replit's connector now reports no
publication for the temporary host probe, confirming its withdrawal.

### GitHub candidate checks connected, 2026-11-06

`createGitHubActionsFactoryBuilder` now composes source export, patch generation,
two-phase candidate publication, exact GitHub Actions verification and draft PR
finalization. An operator-pinned workflow hash must match both base and candidate.
The verifier checks repository visibility, workflow ID/path, commit, branch,
first attempt, runner, test/build step success and evidence freshness. Failed,
cancelled, duplicate or ambiguous runs cannot open a PR; uncertain external work
retains its reservation. Unit integration tests use synthetic clients and do not
establish unattended operation.

The real credential-free workflow passed tests and application build at commit
5bb716289ecec6ce9cd02fe5659cc54e89a80ee5:
https://github.com/robertmanzanillag-jpg/blackops-reminder/actions/runs/42198027098
The checks run in separate bounded containers with no network or production
credentials. Dependency installation disables package lifecycle scripts. The
read-only package mount preserves Node resolution; bounded temporary filesystems
permit executable test fixtures and Vite's generated configuration cache.
These checks cover the portable factory suite, not live browser rehearsals or
PostgreSQL integration. The workflow corrections received independent review.

The production worker remains disabled. Still required: dedicated runtime
credentials/configuration, real discovery and independent review, browser QA,
exact-version deployment and rollback, three staging rehearsals, durable storage
cost bounds and monthly budget initialization. The ten-minute worker lease also
needs coordination with bounded remote checks and workflow queue delays before
activation. No fake callbacks or inferred low-risk approval are installed.
Replit's agent currently refuses work because account credits are exhausted.
Its documented MCP publish operation publishes latest app changes; an unattended
exact-commit release/rollback interface has not been verified. A factory-only
provider hard spending cap has not been verified either. Do not apply an account
shutdown limit that could interrupt Kong. No publication, balance reload, shared
billing limit or Kong configuration was changed during this integration.
### Browser recovery checks verified, 2026-11-06

Run 42204443040 passed portable tests, application build and isolated browser
recovery/panel checks at commit 8c65332:
https://github.com/robertmanzanillag-jpg/blackops-reminder/actions/runs/42204443040
The official Playwright 1.61.1 Noble image is pinned to registry manifest digest
sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48,
matching package-lock.json. Browser tests detect a seeded defect, verify three
synthetic repair cycles, detect regression and restore the synthetic fixture.
They exercise actual Chromium in a container without external networking or
production credentials. They do not establish a Replit deployment rollback.

GitHub evidence profiles now require a distinct browserStep. Missing, skipped or
duplicate browser steps cannot satisfy candidate checks, even if the overall
job reports success. Sixteen targeted tests and full TypeScript checking passed
independent review.

Current Replit documentation exposes publish_app(replId), not an exact-commit
or rollback argument. SSH can prepare a project, but its keys apply to the whole
account, not one app. An isolated account is being discussed with Robert before
provisioning unattended access or a shutdown budget. No new credentials or
account-wide spending changes have been made. Sources:
https://docs.replit.com/platforms/mcp-server
https://docs.replit.com/features/workspace-tools/ssh
https://docs.replit.com/billing/managing-spend