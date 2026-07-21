# AI Media Studio staging migration rehearsal

Status: **NO-GO / preparation only**. Nothing in this runbook authorizes a
database connection, migration, credential change, provider call, spend,
publication, deployment, or production action.

The rehearsal exists to prove that the reviewed AI Media Studio database stack
can be installed, restarted, and rolled back on a disposable copy of staging
before one paid HeyGen sandbox video is considered. The launch target remains
5–10 avatars with exactly 10 videos per avatar (50–100), but every slot stays
blocked and not queued during this rehearsal.

## Current hard blockers

Stop before opening any database connection while any item below remains true:

1. The stacked AI Media Studio PR series is still draft/unmerged or its exact
   commit chain has not been recorded for the rehearsal.
2. The staging database target and owner have not been explicitly identified;
   a production hostname is never an acceptable substitute.
3. The PR1 `ai_media_*` baseline is not proven by catalog evidence. PR2 is a
   delta, not an initial-schema migration.
4. PR14 explicitly requires validated PR13 OAuth controls, but no PR13
   forward/rollback SQL exists in this directory. Stop after PR12 until the data
   owner inventories a separately reviewed PR13 artifact or adds and reviews it.
5. PR16 has Drizzle declarations but no reviewed forward/rollback SQL. Never
   bridge this gap with `drizzle-kit push`, `npm run db:push`, inferred SQL, or
   a production schema diff. A data owner must prove whether the later deltas
   require PR16 and either add reviewed SQL or document why it is not in the
   staging path.
6. A fresh backup has not been restored successfully into an isolated database.
7. PostgreSQL is older than 16 or `pgcrypto` is absent/untrusted.
8. The three PR26 NOLOGIN/NOINHERIT roles and separate LOGIN principals have no
   DBA-reviewed provisioning plan.
9. Writers, webhooks, schedulers, generic render workers, admitted workers,
   terminal observers, asset-ingest workers, publishers, and cleanup workers
   cannot all be drained and kept off through the rehearsal.
10. Robert has not explicitly approved the exact staging target, maintenance
   window, backup/restore plan, and operator. Replit/production approval is a
   separate later decision.

## Human approvals

Record each approval in the release evidence; do not infer it from a PR review.

| Gate | Required approver | What is authorized |
| --- | --- | --- |
| Read-only staging preflight | Robert + staging data owner | Catalog/version/role inspection on one named staging database |
| Backup and isolated restore | Robert + staging data owner | Snapshot/dump and restore into a named disposable database |
| Forward rehearsal | Robert + staging data owner | Apply the exact checked-in manifest only to the restored staging copy |
| Restart/recovery rehearsal | Robert + App QA | Restart the staging application with all provider workers disabled |
| Rollback rehearsal | Robert + staging data owner | Apply the exact reverse manifest to a fresh rehearsal copy |
| Real HeyGen sandbox | Robert | Not covered here; separately approve one video and its estimated maximum cost |
| Replit/production deploy | Robert | Not covered here; separately approve only after a clean App QA release gate |

## Immutable evidence header

Capture these values before preflight. Do not put credentials, connection
strings, private hostnames, raw SQL errors containing customer data, or secret
references in a public PR.

```text
rehearsal_id:
operator:
approved_by:
approval_timestamp:
staging_target_alias:
source_database_revision:
application_commit:
base_pr_chain:
postgres_version:
backup_artifact_id:
backup_sha256:
restore_target_alias:
restore_started_at:
restore_completed_at:
```

## Read-only preflight

An operator may translate the following into their approved database console
only after the read-only gate passes. These are templates, not commands run by
Codex and not authorization to connect.

1. Prove target identity, PostgreSQL 16+, UTC/database timezone expectations,
   active session count, and `pgcrypto` extension provenance.
2. Export table, column, constraint, index, trigger, function, schema, owner,
   grant, and role catalogs for every `ai_media_*` relation and
   `ai_media_worker_api` object.
3. Prove the PR1 baseline exists before PR2. If the baseline is partial,
   unexpected, or already contains a later object, stop and reconcile from a
   fresh restored copy.
4. Prove the named PR26 roles either do not exist yet or exactly match the
   reviewed attributes. Similar names or broader inherited roles are not valid.
5. Record row counts and orphan/duplicate preflight queries without repairing
   data. Any repair needs its own reviewed migration and approval.
6. Confirm every application/worker process is drained. A quiet queue is not
   proof that its consumer is stopped.

The PR26 role prerequisites are exact:

```text
ai_media_admitted_fn_owner             NOLOGIN NOINHERIT
ai_media_admitted_submit_executor      NOLOGIN NOINHERIT
ai_media_admitted_reconcile_executor   NOLOGIN NOINHERIT
```

They must not be superusers and must not have `CREATEROLE`, `CREATEDB`,
`REPLICATION`, `BYPASSRLS`, owner membership, or cross-lane membership. Separate
LOGIN principals must receive only the corresponding executor membership and
must use distinct database connections. Role creation, LOGIN credentials, and
capability-row issuance happen outside the checked-in migrations and require a
private DBA change record.

## Backup and restore proof

1. Take a provider-native staging snapshot and, where policy permits, a logical
   dump with ownership/ACL handling decided by the data owner.
2. Hash the artifact and record its retention/expiry policy privately.
3. Restore into a new isolated rehearsal database with outbound provider and
   storage access disabled.
4. Run catalog and row-count comparisons. A completed restore job without these
   comparisons is not restore proof.
5. Destroy neither the source backup nor the pre-rehearsal copy. Cleanup occurs
   only after the evidence retention gate.

## Forward manifest

Use the exact files below, one transaction/file at a time, in this order. Record
the Git blob/SHA-256 and client exit status for each. Stop on the first nonzero
status, lock timeout, statement timeout, warning treated as an error, unexpected
row repair, or catalog drift. Do not skip ahead and do not use glob order.

1. `migrations/ai-media-studio/20260720_pr2_core_forward.sql`
2. `migrations/ai-media-studio/20260720_pr3_operations_forward.sql`
3. `migrations/ai-media-studio/20260720_pr4_assets_forward.sql`
4. `migrations/ai-media-studio/20260720_pr5_governance_forward.sql`
5. `migrations/ai-media-studio/20260720_pr6_provider_identity_forward.sql`
6. `migrations/ai-media-studio/20260721_pr8_publishing_accounts_forward.sql`
7. `migrations/ai-media-studio/20260721_pr9_oauth_foundation_forward.sql`
8. `migrations/ai-media-studio/20260721_pr11_oauth_policy_forward.sql`
9. `migrations/ai-media-studio/20260721_pr12_oauth_callback_saga_forward.sql`
10. **PR13 reviewed-SQL/baseline gate — currently missing; stop here.**
11. `migrations/ai-media-studio/20260721_pr14_oauth_vault_operations_forward.sql`
12. `migrations/ai-media-studio/20260721_pr15_provider_connection_stages_forward.sql`
13. **PR16 reviewed-SQL decision gate — currently missing; stop here.**
14. `migrations/ai-media-studio/20260721_pr19_daily_admission_forward.sql`
15. `migrations/ai-media-studio/20260721_pr20_launch_authorities_forward.sql`
16. `migrations/ai-media-studio/20260721_pr22_launch_intents_forward.sql`
17. `migrations/ai-media-studio/20260721_pr23_admission_held_handoff_forward.sql`
18. `migrations/ai-media-studio/20260721_pr24_held_activation_forward.sql`
19. `migrations/ai-media-studio/20260721_pr25_admitted_worker_forward.sql`
20. `migrations/ai-media-studio/20260721_pr26_db_capability_forward.sql`
21. `migrations/ai-media-studio/20260721_pr27_heygen_terminal_forward.sql`

PR7, PR10, PR13, PR17, PR18, and PR21 have no standalone SQL file in this
directory. That fact is not permission to infer or generate a migration. The
operator must record the reviewed reason each is schema-neutral or covered by a
later reviewed delta. PR13 is not schema-neutral for this manifest because PR14
explicitly requires its validated controls. PR13 and PR16 are mandatory stops.

An approved operator invocation should be equivalent to the following shape,
with the connection supplied by their private secret mechanism:

```sh
psql "<APPROVED_REHEARSAL_DATABASE>" -X -v ON_ERROR_STOP=1 \
  -f migrations/ai-media-studio/<EXACT_FORWARD_FILE>.sql
```

Never paste a connection string into this repository, a PR, a test fixture, or
the Codex chat. Do not wrap scripts that already contain `BEGIN`/`COMMIT` in an
unreviewed transaction wrapper.

## Verification after each forward step

For every migration, capture:

- client exit status and bounded/redacted output;
- elapsed time, lock wait/timeout, and transaction state;
- expected new/changed objects versus catalog diff;
- row counts and invariant queries named in
  `migrations/ai-media-studio/README.md`;
- cross-tenant rejection and same-tenant idempotency evidence;
- absence of secret material in tables, errors, logs, and DTOs;
- the exact application revision compatible with that schema point.

Additional gates for PR19–PR27:

1. Prove budget/admission contention, immutable authority chains, held work,
   activation fencing, commit-before-submit, ambiguous reconciliation, exact
   capacity release, terminal evidence, and completed-only ingest under live
   PostgreSQL 16.
2. Prove submit and reconcile connections use separate LOGIN principals and
   cannot directly read/write protected tables.
3. Prove a capability is exact-scope, exact-lane, bounded, expiring, and can be
   revoked only one way.
4. Keep every provider/asset worker disabled. Database proof must not make a
   HeyGen request or download an artifact.

## Restart/recovery rehearsal

After the full authorized forward manifest is available and passes:

1. Start the application revision matching the migrated stack with admitted,
   terminal, ingest, publishing, OAuth cleanup, and automation loops disabled.
2. Verify authentication, `/api/ai-media-studio/runtime`, the read-only
   `/api/ai-media-studio/agent`, dashboard/library/influencer reads, and safe
   `503` behavior for intentionally unavailable live capabilities.
3. Restart the application at least twice and prove counts/state/evidence remain
   durable. No dev/test in-memory fallback is acceptable in staging.
4. Run App QA route, link/click, API, error, and improvement scouts. Any warning
   or failure is a stop; do not deploy and create a follow-up PR-first fix.

## Reverse rehearsal

Run rollback only on a fresh rehearsal copy after first rolling application code
back to the compatible revision and draining all writers/workers again. Use the
reverse order below; retain evidence-preserving tables/columns where each
rollback explicitly says it is application-only or data preserving.

1. `20260721_pr27_heygen_terminal_rollback.sql`
2. `20260721_pr26_db_capability_rollback.sql`
3. `20260721_pr25_admitted_worker_rollback.sql`
4. `20260721_pr24_held_activation_rollback.sql`
5. `20260721_pr23_admission_held_handoff_rollback.sql`
6. `20260721_pr22_launch_intents_rollback.sql`
7. `20260721_pr20_launch_authorities_rollback.sql`
8. `20260721_pr19_daily_admission_rollback.sql`
9. **PR16 rollback decision gate — currently missing; stop here.**
10. `20260721_pr15_provider_connection_stages_rollback.sql`
11. `20260721_pr14_oauth_vault_operations_rollback.sql`
12. **PR13 rollback/baseline gate — currently missing; stop here.**
13. `20260721_pr12_oauth_callback_saga_rollback.sql`
14. `20260721_pr11_oauth_policy_rollback.sql`
15. `20260721_pr9_oauth_foundation_rollback.sql`
16. `20260721_pr8_publishing_accounts_rollback.sql`
17. `20260720_pr6_provider_identity_rollback.sql`
18. `20260720_pr5_governance_rollback.sql`
19. `20260720_pr4_assets_rollback.sql`
20. `20260720_pr3_operations_rollback.sql`
21. `20260720_pr2_core_rollback.sql`

Do not assume rollback removes evidence or restores weakened uniqueness/foreign
keys. Several reviewed rollback files deliberately preserve evidence and require
roll-forward recovery. PR23–PR27 rollback files have additional zero-evidence,
unused-activation, capability-revocation, or forward-fix conditions. If real
held/activated/submission/capacity/terminal evidence exists, keep the app
drained and prepare a reviewed forward fix instead of forcing destructive
rollback. Never drop retained tables/columns manually.

After the reverse SQL completes, restart the exact application revision that is
compatible with the retained rollback schema, still with every provider and
queue worker disabled. Repeat the authenticated runtime/agent/dashboard reads,
safe-unavailable checks, durable row/evidence comparisons, and at least one
additional restart. Then rerun checker and the complete App QA route, link/click,
API, error, and improvement gate. Any warning, failed invariant, lost evidence,
memory fallback, or incompatible API response means the rollback rehearsal
failed; preserve the copy for review and do not mark the evidence pack complete.

## Stop conditions

The operator stops immediately and preserves the database for review if any of
these occurs:

- target identity is ambiguous or resembles production;
- backup restore or hash verification fails;
- PR1/PR13/PR16/schema provenance is incomplete;
- a preflight detects orphan, duplicate, cross-tenant, unexpected role/grant,
  extension, trigger, function, constraint, or index state;
- a SQL client returns nonzero, a transaction remains open/aborted, or a timeout
  occurs;
- any worker starts, any external request occurs, or any cost is observed;
- application restart selects memory fallback, loses evidence, or reports an
  unavailable capability as ready;
- checker or App QA reports any warning/failure;
- rollback would delete evidence or requires an undocumented manual repair.

## Exit evidence and next gate

The rehearsal is complete only when the evidence pack contains the immutable
header, approvals, backup/restore proof, exact file hashes, forward and reverse
catalog diffs, invariant results, forward and post-rollback restart evidence,
checker report, App QA report, risks, and rollback notes. Completion authorizes
nothing beyond the rehearsal.

Only then may the team prepare a separate request to Robert for one HeyGen
sandbox video. That request must name the avatar/voice/script, exact credential
account, maximum micro-USD cost, quota, kill switch, owned-storage destination,
expected callbacks, stop/rollback behavior, and must receive explicit approval
before any provider call.
