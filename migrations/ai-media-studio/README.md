# AI Media Studio reviewed migration runbook

These SQL files cover the incremental PR2, PR3, and PR4 schema deltas after the
PR1 AI Media Studio tables. PR2/PR3 have prior review evidence; PR4 passed its
local independent checker/static App QA gate. They do not create the PR1
tables, and the migrations have not been applied to any database. Do not substitute `drizzle-kit push` or
`npm run db:push` for the reviewed SQL and release sequence below. Apply the
deltas strictly in PR2 -> PR3 -> PR4 order.

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
