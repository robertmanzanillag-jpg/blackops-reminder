# AI Media Studio GitHub checkpoint — 2026-07-21

Purpose: preserve the current AI Media Studio delivery state in GitHub before the active Codex session loses context or credits. It does not deploy, apply migrations, call providers, post to social platforms, create live OAuth sessions, or touch secrets.

## Current branch

- Worktree: `/Users/robertmanzanilla/Documents/asistente/.worktrees/ai-media-studio-pr4`
- Branch: `codex/ai-media-studio-managed-oauth-vault`
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
- No raw OAuth state in logs, docs, responses, metadata, or persisted records.
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

- Focused OAuth tests: `node --import tsx --test tests/ai-media-studio-oauth-s3-kms-vault.test.ts tests/ai-media-studio-oauth-authorization-url.test.ts tests/ai-media-studio-production-oauth-runtime.test.ts tests/ai-media-studio-oauth-service.test.ts tests/ai-media-studio-oauth-crypto.test.ts` passed 24/24.
- TypeScript: `npm run check` passed.
- `npm test` was attempted but this repo has no `test` script; the project-specific Node test runner above is the authoritative focused test command.
- No live AWS, provider, OAuth route, token exchange, social post, migration apply, or deployment was performed.

## Current blockers / not done

- OAuth routes remain intentionally absent.
- Provider token exchange, refresh, revocation, sandbox account connection, and token vaulting remain future slices.
- No database migration for PR10 is planned in this first code slice.
- Independent checker/App QA evidence is still required before this PR10 slice is marked ready.
- No App QA/live browser evidence for PR10 exists yet; this slice has no mounted route or UI to click.
- No Replit deployment is requested or authorized.

## Next recovery steps if this Codex session stops

1. Continue on branch `codex/ai-media-studio-managed-oauth-vault`.
2. Re-run independent checker and App QA review before telling Robert PR10 is ready.
3. Push any follow-up fixes to the stacked PR10 branch against PR #83’s branch.
4. Do not deploy or apply migrations without Robert’s explicit approval.
