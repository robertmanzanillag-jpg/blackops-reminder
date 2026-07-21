# AI Media Studio GitHub checkpoint — 2026-07-21

Purpose: preserve the current AI Media Studio delivery state in GitHub before the active Codex session loses context or credits. It does not deploy, apply migrations, call providers, post to social platforms, create live OAuth sessions, or touch secrets.

## Latest recovery checkpoint: PR11 OAuth policy hardening

- Branch: `codex/ai-media-studio-oauth-policy-hardening`, PR #85, stacked on PR #84 / `codex/ai-media-studio-managed-oauth-vault`.
- Scope: persist a provider-neutral `required_s256 | none` PKCE policy snapshot, omit PKCE for the currently documented TikTok/Meta/Google web-server flows, preserve Google's offline-consent parameters, reject `authorized` callbacks until an atomic claim/exchange/token-vault flow exists, strengthen redirect defense-in-depth, and add S3 object expiration metadata.
- Migration artifacts: `20260721_pr11_oauth_policy_forward.sql` and its application-only, data-preserving rollback. They are reviewed artifacts only and have not been applied.
- Focused OAuth/PR11 tests: 34/34 passing.
- TypeScript: `npx tsc --noEmit` passing.
- Production build: `npm run build` passing; existing bundle-size and local `yt-dlp` environment warnings remain unrelated to PR11.
- Codebase map: `npm run codebase:map` completed and refreshed the generated maps.
- Diff hygiene: `git diff --check` passing.
- Independent App QA: passing with no warnings; browser/click QA is not applicable because PR11 adds no route or UI.
- Independent checker: passing after fixes for exact migration preflight, alternate IPv4 literal rejection, and pre-await policy snapshot capture. SQL was reviewed statically and not applied to PostgreSQL.
- Explicit safety boundary: no token exchange, long-lived token vault, refresh/revocation, live OAuth route, provider call, migration apply, external post, spend or deployment.

## Current branch

- Worktree: `/Users/robertmanzanilla/Documents/asistente/.worktrees/ai-media-studio-pr4`
- Branch: `codex/ai-media-studio-managed-oauth-vault`
- Pull request: `#84`, stacked on `codex/ai-media-studio-social-oauth-foundation` (PR #83).
- Base commit at checkpoint start: `a6cd2f31 feat(ai-media-studio): add social oauth foundation`
- PR10 scope: managed production OAuth vault foundation, provider authorization URL builders, and fail-closed runtime composition.
- Explicit PR10 safety decision: keep OAuth routes unmounted until token exchange, token vaulting, account CAS binding, callback semantics, and provider sandbox proof are complete.

## Stacked PR history already preserved

| Slice | Branch / PR | Preserved state |
| --- | --- | --- |
| Foundation | PR #67, `codex/ai-media-studio` | Provider-neutral AI Media Studio vertical slice. |
| PR2 core | PR #70, `codex/ai-media-studio-core` | Durable core, media assets, influencers, runtime policy, and migration artifacts. |
| PR3 operations | PR #71, `codex/ai-media-studio-operations` | Publishing/analytics/intake/orchestration contracts, repositories, operations UI, and worker operations. |
| PR4 owned assets | PR #73, `codex/ai-media-studio-quality` | Owned render ingest/delivery path, authenticated delivery DTOs, production adapter boundaries. |
| PR5 governance | PR #75 | Governance/rights/quality gates. |
| PR6 provider identity | PR #77 | Account-scoped provider identity and webhook isolation. |
| PR8 production publishing accounts | PR #80 and PR #82 | Production asset/publishing-account isolation hardening. |
| PR9 OAuth foundation | PR #83, `codex/ai-media-studio-social-oauth-foundation` | Durable one-time OAuth state, PKCE/vault ports, unverified credential lifecycle, publishing readiness gate. |

PR9 local evidence recorded before this checkpoint:

- Full test suite: 360/360 passing.
- TypeScript: passing.
- Production build: passing.
- Independent checker: passing.
- Static App QA: passing.
- No live OAuth, provider exchange, external publish, migration apply, or deployment performed.

## Active PR10 design notes to preserve

### Decision

Use an S3 + SSE-KMS ephemeral vault for PKCE verifiers instead of one AWS Secrets Manager secret per OAuth session.

Reasoning:

- At 10,000+ sessions/day, a per-session Secrets Manager design creates avoidable secret-count, cleanup, recovery-window, and cost pressure.
- S3 with a dedicated private bucket/prefix, exact-object access, SSE-KMS, Bucket Keys, app-level expiration, and immediate object deletion is a better fit for short-lived PKCE verifier storage.
- Long-lived provider token bundles can still use a separate managed secret/token vault later.

### PR10 files now present

New implementation files:

- `server/ai-media-studio/oauth/s3-kms-pkce-vault.ts`
- `server/ai-media-studio/oauth/authorization-url.ts`
- `server/ai-media-studio/oauth/production-runtime.ts`

New tests:

- `tests/ai-media-studio-oauth-s3-kms-vault.test.ts`
- `tests/ai-media-studio-oauth-authorization-url.test.ts`
- `tests/ai-media-studio-production-oauth-runtime.test.ts`

Allowed existing files to modify:

- `server/ai-media-studio/oauth/index.ts`
- `server/ai-media-studio/oauth/platform-manifests.ts`

Files intentionally out of scope for the first PR10 code slice:

- Routes and public API handlers.
- Database schema/migrations.
- UI.
- Package/dependency changes.
- Live AWS/provider calls.
- Secrets or `.env` files.

## Security constraints captured for PR10

- Do not mount OAuth start/callback routes in this slice.
- No raw OAuth state in logs, metadata or persisted records. A future start response may contain it only inside the provider authorization URL, never as a separate field.
- State remains one-time, digest-only, platform-bound, tenant/workspace/actor/account-bound, and expiry-bound.
- PKCE verifier vault references must be opaque: `vault://ai-media-studio/oauth-pkce/v1/<uuid>`.
- S3 vault must:
  - use official AWS S3 endpoints only;
  - reject custom endpoints and static access-key configuration in app config;
  - use SSE-KMS with a fully qualified customer KMS key ARN;
  - set `BucketKeyEnabled`;
  - use `IfNoneMatch: "*"` when creating verifier objects;
  - read/delete only exact keys derived from validated vault refs;
  - validate encryption/KMS metadata and envelope contents on read;
  - enforce small bounded JSON bodies;
  - fail closed with generic errors;
  - avoid public URLs, ACLs, listing, plaintext fallback, and secret-bearing metadata.
- Authorization URL builders must:
  - use fixed official provider endpoints;
  - never accept arbitrary authorization endpoints;
  - validate redirect URIs as HTTPS, default port 443, no credentials, no query/fragment, no localhost/IP;
  - use audited scopes from manifests;
  - never include client secrets;
  - use Google PKCE S256 with offline/consent parameters;
  - omit PKCE for TikTok Web unless future official docs require it;
  - default Meta/Instagram to no PKCE unless explicitly documented/configured.
- Production runtime must be all-or-nothing:
  - absent config means OAuth production runtime unavailable;
  - partial or unknown `AI_MEDIA_STUDIO_OAUTH_*` config fails closed;
  - construction performs no network I/O;
  - AWS credentials come from the default provider chain, not static app env keys.

## PR10 local evidence recorded after code landed

- OAuth/PR9 regression set passed 31/31.
- Full AI Media Studio suite passed 374/374. The first sandboxed run produced only twelve `listen EPERM` infrastructure failures; the required rerun with local loopback binding passed all 374 tests.
- TypeScript: `npx tsc --noEmit` passed.
- Production build: `npm run build` passed. Existing bundle-size and local `yt-dlp` environment warnings remain unrelated to PR10.
- Codebase map: `npm run codebase:map` completed and refreshed both generated map files.
- Diff hygiene: `git diff --check` passed.
- No live AWS, provider, OAuth route, token exchange, social post, migration apply, or deployment was performed.

## Current blockers / not done

- Independent checker findings recorded after the GitHub checkpoint:
  - The PR9 start service still allocates a PKCE verifier for TikTok/Meta even though the PR10 authorization manifests omit PKCE for those web flows. This is inert while routes remain unmounted, but must be reconciled before a live connector to avoid needless secret objects.
  - An `authorized` consume deliberately retains the verifier for the future token exchange, while the current S3 adapter enforces read expiry but cannot itself prove physical deletion. The callback-safe exchange slice must read and delete immediately in a `finally` path and require a dedicated non-versioned bucket lifecycle as the last-resort cleanup boundary.
  - The database redirect check enforces HTTPS only; the trusted runtime policy additionally rejects credentials, query/fragment, non-default ports, localhost and IP literals. All writes currently pass through stricter server validation, but a reviewed migration should add equivalent database defense-in-depth before live OAuth.
- Static App QA passed because PR10 adds no route, UI, timer, worker or automatic network call. The checker findings above keep the slice out of merge/deploy-ready state.
- OAuth routes remain intentionally absent.
- Provider token exchange, refresh, revocation, sandbox account connection, and token vaulting remain future slices.
- No database migration for PR10 is planned in this first code slice.
- Independent checker/App QA evidence is still required before this PR10 slice is marked ready.
- No App QA/live browser evidence for PR10 exists yet; this slice has no mounted route or UI to click.
- No Replit deployment is requested or authorized.

## Next recovery steps if this Codex session stops

1. Continue on branch `codex/ai-media-studio-oauth-policy-hardening` and review only its delta from PR #84.
2. Preserve the stacked order: PR #83 -> PR #84 -> PR11 OAuth policy hardening.
3. Confirm GitHub PR status and execute the reviewed migration in an approved staging/PostgreSQL rehearsal before calling the database change production-ready.
4. Continue with a separate PR for callback-safe claim/exchange, long-lived token vaulting, account CAS binding, refresh/revocation and provider sandbox proof.
5. Do not mount OAuth routes, deploy, apply migrations or post externally without the required release gates and Robert’s explicit approval.

## PR12 checkpoint — durable OAuth callback saga

GitHub PR: #88, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/88`.

Branch: `codex/ai-media-studio-oauth-callback-saga`, stacked on PR #85 (`codex/ai-media-studio-oauth-policy-hardening`).

This slice adds a provider-neutral, fenced callback saga without mounting a route or making live provider calls. It separates authorization-code, PKCE, provider connector, and long-lived token-vault contracts; performs no database transaction across external I/O; claims work with leases and fencing; prevents automatic re-exchange after ambiguous provider I/O; and atomically binds a token-vault reference plus exact provider identity/provenance to the account with credential-version CAS.

Security and recovery properties captured:

- Raw authorization codes and tokens never enter the database, logs, callback errors, or durable session snapshots.
- Vault references are purpose-scoped and bound to tenant, workspace, actor, account, platform, session, digest/version and token-binding context.
- Stale workers cannot finalize, mark indeterminate, or clean vault material after a newer fence wins, including the pre-attach `putOnce` race.
- Candidate token substitution, unknown capabilities, missing `publish_video`, identity conflicts, expired credentials, replay and wrong actor/account/platform are rejected generically.
- Provider-account activation and callback completion occur in one short database transaction after all external I/O.
- The additive reviewed migration contains strict preflight, backfill, constraints, indexes and exact OAuth source-session provenance. It remains unapplied; rollback is application-only and data-preserving.

Evidence at checkpoint:

- Focused PR12 OAuth suite: 32/32 passed after the stale pre-attach race regression was added.
- TypeScript, production build and diff hygiene passed; the build retains only the pre-existing bundle-size and local `yt-dlp` warnings.
- Full AI Media Studio suite: authoritative unrestricted rerun passed 401/401.
- Independent security review found no P0/P1. Its only remaining P2 was packaging untracked files, resolved by staging the complete PR12 file set.
- Independent checker found the pre-attach stale cleanup race; it was fixed and regression-tested before GitHub preservation.
- Static App QA passed 51/51 OAuth regression tests and found no route, UI, timer, network, provider, migration-apply or deployment surface in this slice.

Intentionally not done:

- No production authorization-code or token-vault adapter is wired.
- No live TikTok, Google/YouTube, Meta, Instagram or Facebook connector is wired.
- No callback/start route is mounted.
- No migration was applied, no external content was posted and no deployment was requested.

Next safe slice: implement separate envelope-encrypted S3/KMS authorization-code and token-vault adapters plus immutable sandbox provider connectors; then add refresh, revocation and reconciliation. Routes remain blocked until provider sandbox proof and the normal checker/App QA gates pass.

## PR13 checkpoint — encrypted OAuth code and token vaults

GitHub PR: #89, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/89`.

Branch: `codex/ai-media-studio-encrypted-oauth-vaults`, stacked on PR #88.

Implemented:

- Added the official AWS KMS client dependency.
- Added a shared envelope layer using one fresh KMS `AES_256` data key per object, AES-256-GCM with a random 12-byte IV, full canonical context as AAD, a digest-only KMS encryption context and zeroization of plaintext data-key buffers.
- Added separate deterministic authorization-code and token vaults. Both use application ciphertext plus S3 SSE-KMS, Bucket Keys, `IfNoneMatch: "*"`, exact expected bucket owner, pinned official S3/KMS endpoints, bounded strict envelopes and generic errors.
- Code bindings include tenant, workspace, actor, provider account/platform, session, token binding, code digest and expiry. Reads recheck expiry after S3/KMS I/O.
- Token bindings additionally include target credential version. Descriptor and bundle are authenticated together; the callback saga gets no secret-reader capability.
- Exact retries recover after a 412 or ambiguous write; competing payloads, cross-context reads, raw/gateway 404s, `NoSuchBucket`, AEAD tampering, metadata collisions and KMS failures fail closed.

Evidence before GitHub preservation:

- Adapter tests: 13/13 passed.
- Adapter plus saga focused tests: 24/24 passed.
- Full AI Media Studio suite: authoritative unrestricted run passed 414/414.
- TypeScript and diff hygiene passed.
- `npm audit --omit=dev --audit-level=high` reached the registry and reported 16 advisories (7 high, 7 moderate, 2 low). Every reported package already exists in the PR12 base lockfile and none is the new AWS KMS client; remediation requires a separate tested dependency PR, including breaking Drizzle/Google upgrades where indicated. This is not production-clearance evidence.
- Independent checker and security recheck reported no remaining P0-P3 blockers.
- Static App QA passed 69/69 OAuth regressions with zero warnings and confirmed no route, UI, timer, migration, automatic network call or deployment surface.

Explicit pre-runtime blockers:

- The token-reader split is an API capability boundary, not yet a separate IAM role/service.
- Dedicated secret buckets/CMKs, unversioned-or-VersionId-aware deletion, Block Public Access, lifecycle, durable reconciliation, monitoring and key rotation are not configured or proven.
- Real connectors remain blocked by the target-selection, token-role, lifetime, scope/capability and multi-stage recovery changes captured in `oauth-provider-readiness.md`.
- No route is mounted, no migration is applied, no AWS/provider call is made, no content is posted and no deployment is authorized.

## PR14 checkpoint — OAuth vault operations

Branch: `codex/ai-media-studio-oauth-vault-operations`, stacked on PR #89. GitHub PR number will be recorded after the branch is pushed.

Implemented:

- Added a dedicated relational cleanup outbox whose PKCE/code/token obligations are created before their corresponding external vault writes can become orphaned.
- Added bounded PostgreSQL-clock claims with `FOR UPDATE SKIP LOCKED`, leases, fencing, retry/dead-letter evidence, exact source-context revalidation, conservative active-token protection and two exact delete passes separated by quiescence.
- Added an explicit `runOnce` cleanup worker with no timer or autostart and bounded AWS SDK operations.
- Added an inert S3/KMS infrastructure preflight over three distinct bucket/CMK planes. It validates exact policy digests, unversioned private buckets, encryption/lifecycle/ownership posture, CMK state/rotation/grants and requires two identical full snapshots before returning a short-lived identifier-free attestation.
- Added an additive reviewed migration and data-preserving rollback. The migration is checked in but unapplied.

Safety boundary: no route, runtime composition, timer, migration apply, live AWS/provider request, external post or deployment is included. Effective IAM/IaC, Access Analyzer, monitoring, migration rehearsal, real connectors, target selection, refresh/revocation and provider sandbox proof remain release gates.

Evidence before GitHub preservation:

- Full AI Media Studio suite: 423/435 passed in the restricted sandbox; the 12 local HTTP cases blocked only by `listen EPERM` were rerun outside the sandbox and passed 12/12, yielding 435/435 composed evidence.
- TypeScript, production build, codebase-map refresh and staged diff/whitespace checks passed.
- Independent checker found no remaining P0-P2; independent security review found no remaining P0-P3 after the crash/fencing and error-taxonomy fixes.
- Static App QA passed with no PR14 findings. Existing bundle-size and local `yt-dlp` build messages are baseline/environment advisories, not PR14 deltas.
- SQL and migration shape are tested statically but have not been executed against PostgreSQL; staging rehearsal remains mandatory.
