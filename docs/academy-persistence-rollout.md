# Academy persistence rollout

Prepared, not deployed. The existing Autoscale office has its execution worker disabled. Code changes alone do not establish an always-running academy.

## Durable council state

`AGENT_COUNCIL_STORAGE=postgres` selects the owner-scoped PostgreSQL store. Apply `councilSchemaSql` from `server/agent-council-store.ts` as a reviewed migration first. No request creates tables and no database failure falls back to an empty local file. Local mode remains compatible for development.

Before switching, stop council writers, back up the current owner state, validate it, and import it into `agent_council_state` with the SHA-256 owner key used by the adapter. Do not start with an empty row when an existing academy has careers, orders or trainees. Confirm the imported counts and contents before enabling the scheduler. Keep the original backup unchanged for rollback.

All mutations acquire an owner-scoped transaction lock and read the latest state after locking. Reads bypass process caches in durable mode. Failed writes do not update the local cache. Slow provider executions must run outside the transaction, with durable assignment reservations and fenced completion. External Trust Center proposal submission is not atomic with this store: an ambiguous commit still requires reconciliation rather than blind external retry.

## Required verification before activation

- Verify real PostgreSQL concurrent writer, rollback, owner separation and restart tests on the target database; unit tests use a simulated transactional database and are not production database evidence.
- Confirm the existing approved execution host, subscription authentication and capacity. Do not purchase hosting or enable paid model calls implicitly.
- Preserve training reservations and results across restart; expired uncertain executions must not silently be repeated.
- Run a supported read-only benchmark through the real host, inspect artifacts and compare against the incumbent. Keep unsupported roles explicitly blocked.
- Verify release QA and obtain deployment approval before production migration or publication.

Rollback: stop new scheduling, preserve the database and artifacts, revert the release, and restore the previously backed-up configuration/state only after reconciling any assignments completed since the backup. Do not revert to a stale file while work is running.

## Narrow reviewer qualification (not promotion)

`OFFICE_ACADEMY_PREPARATION_ENABLED=true` enables bounded incumbent/challenger preparation. `OFFICE_ACADEMY_EXECUTION_ENABLED=true` enables the dedicated office worker's reviewer qualification adapter only when `AGENT_COUNCIL_STORAGE=postgres` and the existing continuous-worker requirements hold. Both switches remain off by default. No environment was changed by this patch.

The worker checks at most every 15 minutes and reserves at most one paired trial per owner per rolling 24 hours. A trial calls the existing authenticated subscription Claude CLI twice with tools/hooks/MCP disabled: incumbent guidance and the candidate's curriculum on the same immutable code fixture. There are three fixture types (authorization, SQL injection, secret logging). The deterministic rubric evaluates structured findings; equal-quality challengers do not qualify as better. This is a narrow competency check, not evidence that every real review is better. Other roles remain blocked until a verified role-specific execution adapter exists.

Reservations commit before provider execution; provider calls occur outside database locks. Matching assignment/generation/curriculum and an unexpired reservation are required for completion. Expired/uncertain attempts are quarantined without automatic retries. The exact bounded outputs, sessions, fixture and assignment are retained under a reproducible SHA-256 artifact digest. The recorded zero cost denotes **incremental API charges on the subscription-only route**, not free subscriptions or measured total compute cost.

Three successful fixture comparisons can mark a trainee qualified but **cannot graduate, replace a live runtime, clear a replacement hold or install a new production policy**. Live task comparison, policy activation and task/context handoff remain separate unimplemented release requirements. Evidence supplied through the generic benchmark reconciler also needs trusted immutable assignments and usage records; it is not a public evidence-writing API.

## Source reconciliation hold

This draft starts from `codex/office-cloud-current-20261105` (`59c19da`). Subsequent read-only Replit inspection reported a different current working tree and additional persistence work. Reconcile against the exact published source before merging; do not overwrite newer production logic with this branch. No target database migration, production runner test, host provisioning or deployment has been performed.
