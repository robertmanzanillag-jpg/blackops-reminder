# AI Media Studio reviewed migration runbook

These SQL files cover the incremental PR2, PR3, PR4, PR5, PR6, and PR8 schema deltas after the
PR1 AI Media Studio tables. PR2/PR3 have prior review evidence; PR4 and PR5 passed their
local independent checker/static App QA gates. They do not create the PR1
tables, and the migrations have not been applied to any database. Do not substitute `drizzle-kit push` or
`npm run db:push` for the reviewed SQL and release sequence below. Apply the
deltas strictly in PR2 -> PR3 -> PR4 -> PR5 -> PR6 -> PR8 order. PR7 has no
database migration in this directory.

## Required release sequence

1. Confirm the PR1 schema exists and record the deployed application revision.
2. Take and verify a restorable database backup.
3. Stop or drain AI Media Studio writers and queue workers.
4. Apply `20260720_pr2_core_forward.sql` to staging with an operator-reviewed
   PostgreSQL client invocation.
5. Verify row counts, foreign keys, indexes, tenant isolation, queue claiming,
   restart recovery, and rollback on staging.
6. Run the complete App QA release gate. Any warning or failure blocks release.
7. Obtain Robert's explicit approval before any Replit/production deployment.

The forward migration is transactional and idempotent. It backfills every new
required value before setting `NOT NULL`, fails rather than silently repairing
orphaned resource references, and builds replacement indexes before removing
the earlier definitions. Index builds and `ALTER TABLE` still take locks; the
five-second lock timeout intentionally aborts instead of waiting indefinitely.
Large tables can take longer than the statement timeout and require a separately
reviewed maintenance-window adjustment.

## Rollback

Roll back application code first, with writers/workers drained. Then run
`20260720_pr2_core_rollback.sql` only after a backup. The rollback restores PR1
foreign-key behavior and index shapes but retains additive PR2 columns and data.
It also makes the retained `canonical_key` nullable again because PR1 does not
write that column. It aborts if PR2-created rows conflict with the narrower PR1
uniqueness rules; those collisions require an explicit data decision before retrying.

After either direction, restart the service and prove queue/restart recovery.
Keeping the new columns is intentional: removing them is destructive and is not
part of the routine rollback. A later column purge would require its own backup,
retention approval, reviewed SQL, and recovery rehearsal.

## PR3 operations release

`20260720_pr3_operations_forward.sql` is the additive PR3 delta and has not
been applied to any database. It adds publishing evidence and recoverable queue
state, tenant-safe analytics indexes, source moderation/automation evidence,
and orchestration runs. Never substitute `drizzle-kit push` or `npm run db:push`.

After PR2 is deployed, repeat the hard gates above: verified backup, drained
writers/workers, staging application, tenant and lease/fencing checks, restart
recovery, full App QA, and Robert's explicit approval before Replit/production.
Confirm that automatic publishing remains disabled by policy and that approval
evidence references the exact immutable preview digest before queue dispatch.

The data-preserving PR3 rollback restores the PR2 dispatch and analytics index
shapes only. It intentionally retains the new table, columns, evidence, and
rows for recovery and audit. The rollback aborts if PR3 data cannot satisfy the
narrower PR2 analytics uniqueness rules; resolve those collisions explicitly,
then retry from a fresh backup.

## PR4 owned-assets release

`20260720_pr4_assets_forward.sql` is the additive PR4 delta and has not been
applied to any database. It adds the private provider-artifact ingest queue, an
owned output-asset link on render jobs, tenant/render ingest idempotency, queue
and completed-unlinked indexes, lease/fencing/retry/dead-letter fields, and
active tenant/kind/checksum uniqueness for canonical assets. The checked-in SQL
and DB-independent tests are not live PostgreSQL or storage evidence.

Apply PR4 only after PR2 and PR3 have passed their staging gates. Repeat the
verified backup and drain, obtain checker approval, apply the checked-in PR4
forward SQL, then prove:

1. Existing asset checksums contain no duplicate active tenant/workspace/kind rows.
2. Ingest claims, fenced completion/failure, lease recovery, dead letters and completed-unlinked scans behave under live PostgreSQL contention and restart.
3. Canonical asset and render-output linkage remains tenant scoped and idempotent after recovery.
4. A production bounded reader, object-storage adapter and short-lived signer pass sandbox tests without exposing provider URLs, storage keys or signed URLs in public DTOs/logs.
5. Full checker and App QA gates pass, followed by Robert's explicit approval before any Replit/production deployment.

The PR4 rollback is intentionally data preserving. It first restores a non-unique
tenant/workspace/kind/checksum lookup index and removes only the PR4 active-row
checksum uniqueness rule. It retains the ingest table, private artifact inputs,
owned object metadata, queue/fencing/error evidence, render-output link, foreign
key, indexes and all rows for recovery. Roll application code back first with
render/ingest workers drained; if multiple deltas must be rolled back, use PR4
before PR3 before PR2 after exports and a fresh verified backup.

## PR5 governance and quality release

`20260720_pr5_governance_forward.sql` is the additive PR5 delta and has not
been applied to any database. It adds append-only, tenant-scoped influencer
governance revisions and checksum-bound asset quality reviews. It also records
the exact governance profile and evidence digest used by a render job. Composite
foreign keys prevent cross-tenant identity, resource, asset/checksum, revision,
and render-profile references; tenant idempotency and per-aggregate version
uniqueness make retries and concurrent appends fail closed.

Apply PR5 only after PR4 passes its staging gates. With writers and workers
drained, take and verify a restorable backup, obtain checker approval, apply the
checked-in forward SQL to staging, and prove:

1. Cross-tenant influencer, avatar, voice, asset/checksum, previous-revision,
   and render-profile references are rejected by PostgreSQL.
2. Same-key/same-input retries return the original record while same-key/different-input
   requests conflict, and concurrent version appends cannot create two canonical revisions.
3. Revoked, not-yet-valid, expired, use/territory-disallowed, brand-policy-failing,
   missing-review, rejected-review, and checksum-mismatched renders/publications fail closed.
4. Render rows retain the exact immutable governance evidence digest used at dispatch.
5. Full checker and App QA gates pass, followed by Robert's explicit approval before
   any Replit/production deployment.

The PR5 rollback is intentionally data preserving: it retains both new tables,
all evidence and revision chains, composite constraints and indexes, and render
snapshot columns. Roll application code back first with writers/workers drained.
For multiple deltas, use PR5 before PR4 before PR3 before PR2 after a fresh
verified backup. Destructive evidence purging requires a separate retention
approval, reviewed migration, and recovery rehearsal.

## PR6 provider-account identity release

`20260720_pr6_provider_identity_forward.sql` is the additive PR6 delta and has
not been applied to any database. It scopes provider submissions and webhook
events to the exact provider account, adds tenant/provider composite foreign
keys, and replaces global provider job/event uniqueness with account-scoped
definitions. It also permits multiple accounts for the same provider in one
tenant and stores only opaque webhook endpoint and secret references, including
a bounded previous-secret rotation window. It never stores secret material.

Apply PR6 only after PR5 passes its staging gates. Drain render and webhook
writers first, take and verify a restorable backup, and run the checked-in SQL
with an operator-reviewed PostgreSQL invocation. The migration deterministically
backfills identity only through an exact tenant/provider account or render job.
It aborts on unresolved submitted jobs, unmatched parked callbacks, cross-tenant
references, or within-account duplicates; reconcile those records explicitly
and retry from the untouched transaction instead of assigning a guessed account.

Before enabling live callbacks, prove on staging that:

1. The same provider job/event id on two accounts remains isolated and same-account duplicates fail.
2. Cross-tenant and provider-mismatched account references are rejected by PostgreSQL.
3. Parked callbacks can only be claimed by their exact provider account and job.
4. Endpoint lookup resolves one account and active opaque secret reference; previous-secret acceptance expires at the recorded deadline.
5. Full checker and App QA gates pass, followed by Robert's explicit approval before any Replit/production deployment.

The PR6 rollback is intentionally data preserving and does not restore the old
global uniqueness or one-account-per-provider rule, because valid PR6 rows may
conflict with those assumptions. It retains all account identity, endpoint
references, rotation metadata, composite constraints, indexes, and rows. Roll
application code back only to a revision that understands account-scoped
identity; otherwise roll forward after correcting the release issue.

## PR8 publishing-account isolation release

`20260721_pr8_publishing_accounts_forward.sql` is the additive PR8 delta and has
not been applied to any database. Apply it only after PR6. It replaces the loose
id-only `SET NULL` publishing-job account reference with a composite foreign key
that requires every non-null account binding to match the job's owner, workspace,
and platform (`platform = provider_key`). The platform remains required, while
`provider_account_id` remains nullable for intentionally unbound drafts.

Drain publishing writers and workers, take and verify a restorable backup, and
apply the checked-in SQL to staging with an operator-reviewed PostgreSQL client.
The migration preflights both tables, every required identity column, and the
valid PR6 composite unique index. It aborts on orphaned, cross-tenant, or
platform-mismatched non-null bindings. It does not infer or backfill an account.

Before release, prove on staging that:

1. A publishing job may reference an account only inside its exact tenant and workspace.
2. The job platform must equal the provider account's `provider_key`.
3. Nullable unbound drafts remain valid and `platform` remains non-null.
4. Existing valid account-bound jobs remain attached when an account deletion is attempted.
5. Full checker and App QA gates pass, followed by Robert's explicit approval before any Replit/production deployment.

The PR8 rollback is application-only and intentionally retains the composite
constraint, PR6 candidate key, columns, and all rows. Restoring the id-only
`SET NULL` foreign key would weaken isolation and silently detach publishing
intent. Roll code back only to a revision compatible with the retained nullable
account column and composite identity; otherwise correct the release and roll forward.

## PR9 OAuth/vault foundation release

`20260721_pr9_oauth_foundation_forward.sql` is an additive, unapplied control-plane
migration. It stores globally unique SHA-256 state digests, exact tenant/actor/account/
platform bindings, allowlisted redirect and scope snapshots, S256 challenges, and only
opaque PKCE vault references. Raw state, authorization codes, PKCE verifiers, client
secrets, and access or refresh tokens are never database fields. Provider accounts gain
credential lifecycle metadata, with every existing account remaining `unverified`.

Apply only after PR6 and PR8 pass staging. Drain account-connection writers, take and
verify a restorable backup, then prove global state uniqueness, the composite account
foreign key, the 15-minute maximum lifetime, atomic one-time consumption, exact callback
binding, redirect allowlisting, and vault compensation. No provider endpoint, token
exchange, OAuth application, publishing worker, or production deployment is enabled by
this migration. Full checker and App QA gates plus Robert's explicit deployment approval
remain mandatory.

The rollback is application-only and preserves sessions, opaque references, lifecycle
metadata, constraints, and audit evidence. Roll code back to a compatible version or
correct the release and roll forward; destructive retention needs a separate review.
