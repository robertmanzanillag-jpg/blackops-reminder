# PR16 provider activation remediation plan

Status: **NO-GO / design evidence only**. This plan does not authorize a
database connection, migration, secret or vault operation, provider call,
spend, deployment, or runtime mounting.

## Audit conclusion

PR16 cannot be converted directly from its current Drizzle declarations into a
release migration. It needs two separately reviewed, stacked PRs: first exact
schema and relational integrity, then the durable activation/CAS repository.
The staging rehearsal must continue to stop between PR15 and PR19 until both
slices and their PostgreSQL evidence pass.

## Missing reviewed SQL

The current model contains no forward/rollback SQL for these PR16 declarations:

- the provider-account `oauth_role_v2` provenance check and partial token-binding
  uniqueness;
- the `activation_indeterminate` attempt state and stronger token-artifact
  metadata policy;
- exact selected-target uniqueness;
- `ai_media_oauth_credential_artifacts`;
- `ai_media_provider_account_credential_bindings`;
- `ai_media_oauth_vault_operations_v2`.

The source inventory is in `shared/models/ai-media-studio-db.ts`. `db:push`,
schema-diff generation, and inferred SQL are forbidden substitutes.

## Relational blockers

1. PR15's persisted stage constraint rejects `activation_indeterminate`, even
   though the application contract can produce that terminal uncertainty.
2. An active `oauth_role_v2` provider account is not required by the database
   to reference one exact credential binding backed by real artifacts.
3. Binding and artifact rows do not relationally preserve the exact attempt,
   selection, token binding, manifest revision, credential versions, selection
   digest, eligibility digest, scopes, and capabilities validated in memory.
4. The database does not require the complete platform artifact-role set:
   TikTok/YouTube need exactly `operational_access` plus `refresh`; Meta needs
   exactly `operational_access`.
5. PR15's database token-metadata filter is weaker than the application policy
   and does not provide a structural allowlist for role/lifetime metadata.
6. Attempts, bindings, artifacts, and cleanup-v2 obligations lack complete
   immutable-evidence and legal-transition guards.
7. No durable repository creates cleanup obligations before external vault I/O
   and then performs fenced activation/finality CAS. A crash could otherwise
   leave an untracked external secret.

## PR16A — schema and integrity

Ownership: database/schema maker. No repository, route, worker, provider, vault,
or runtime composition in this slice.

Required work:

1. Preflight the exact PR12/PR14/PR15 objects, validated constraints, unique
   account key, and absence of every PR16 object.
2. Replace PR15 attempt-stage and metadata checks without an unvalidated gap.
3. Add exact selection identity/uniqueness needed by downstream foreign keys.
4. Add artifact, binding, and cleanup-v2 tables with tenant-exact composite
   references and strict lifecycle checks.
5. Bind artifacts and bindings to the exact attempt/selection evidence rather
   than duplicated unconstrained values.
6. Enforce platform role cardinality and prevent an active account without its
   exact binding/artifact set. Use deferred constraints only where the atomic
   transaction cycle requires them.
7. Add immutable evidence and fenced transition guards.
8. Provide a conservative, evidence-preserving rollback compatible with the
   prior application revision.
9. Keep SQL/Drizzle parity tests and execute the actual files on isolated
   PostgreSQL 16 with trusted `pgcrypto`.

## PR16B — durable activation and CAS

Ownership: repository maker after PR16A passes. Keep the repository unmounted.

Required work:

1. Create the cleanup obligation durably before any external vault write.
2. Stage artifacts and bind them to one exact attempt/selection under ordered
   locks and PostgreSQL time.
3. Atomically activate the account and terminalize the attempt with exact
   expected versions, fencing, and compare-and-swap evidence.
4. Preserve `activation_indeterminate` when provider/vault finality is unknown;
   never infer success or delete evidence prematurely.
5. Make identical replay idempotent and conflicting replay fail closed.
6. Ensure every losing, stale, partial, or crashed path retains a valid cleanup
   obligation without weakening tenant isolation.

## Required PostgreSQL evidence

- Apply the real chain through PR15 and then PR16A; verify the exact catalog,
  validated constraints, indexes, triggers, functions, owners, and grants.
- Accept the legal `activation_in_progress` to `activation_indeterminate`
  transition; reject illegal transitions, stale versions, and stale fences.
- Reject cross-tenant/account/session references and any altered token,
  manifest, version, selection, eligibility, scope, or capability evidence.
- Reject active account without binding, binding without the complete exact
  artifact set, partial/duplicate roles, foreign vault references, and
  inconsistent cleanup lifecycle.
- Run two concurrent activations for one expected version and prove exactly one
  wins.
- Prove identical replay, conflicting replay, expired lease, restart recovery,
  and crash behavior at vault → artifact → binding → account → attempt boundaries.
- Prove evidence immutability, fenced retry/verify/delete/dead-letter lifecycle,
  secret-metadata negative cases, and rollback compatibility.

## Exit gate

PR16 remains blocked until PR16A and PR16B each have a maker/checker cycle,
focused/static tests, live isolated PostgreSQL 16 evidence, full AI Media Studio
regressions, TypeScript/build evidence, and App QA at P0=P1=P2=0. Only then may
the staging runbook replace its PR16 stop with reviewed filenames. Robert's
staging, spend, HeyGen sandbox, and Replit/production approvals remain separate.
