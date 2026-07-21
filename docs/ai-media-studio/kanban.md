# AI Media Studio Delivery Board

Flow: **Backlog -> Ready -> In progress -> Checker review -> App QA -> Done**. A blocked card records owner, evidence and its exact unblock condition. Only one maker owns a file at a time.

## Stack status

| Delivery | Branch / PR | State | Meaning |
| --- | --- | --- | --- |
| Foundation | PR #67, `codex/ai-media-studio` | Clean / mergeable | Provider-neutral vertical slice accepted as the base; no deployment implied |
| PR2 core | PR #70, `codex/ai-media-studio-core` | Stacked on PR #67 | Durable core, owned media and operational APIs; review the PR2 delta after base merge/rebase |
| PR3 operations | PR #71, `codex/ai-media-studio-operations`, stacked on PR #70 | Ready for GitHub review | Publishing/analytics/intake/orchestration contracts, repositories, UI and worker operations passed checker/static App QA; no live operation implied |
| PR4 owned assets | `codex/ai-media-studio-quality`, stacked on PR #71 | Ready for GitHub review | Owned render ingest/delivery passed independent checker and static App QA; production reader/storage/signer, live migration and deployment remain absent |
| PR5–PR8 hardening | PRs #75, #77, #80 and #82 | Ready for GitHub review | Governance, account-scoped provider identity, production asset adapters and tenant/platform publishing-account isolation passed local gates; migrations remain unapplied |
| PR9 OAuth control plane | PR #83, `codex/ai-media-studio-social-oauth-foundation`, stacked on PR #82 | Ready for GitHub review | Durable one-time state, PKCE/vault ports and unverified credential lifecycle passed local gates; no live connector or route |
| PR10 managed OAuth vault | PR #84, `codex/ai-media-studio-managed-oauth-vault`, stacked on PR #83 | Checker findings | Internal S3-KMS PKCE vault, provider authorization URL builders and fail-closed runtime composition pass code/test and static App QA gates. Before readiness, resolve or explicitly split the checker findings for platform-specific PKCE allocation, authorized-flow verifier deletion, and DB redirect defense-in-depth. Routes, token exchange, refresh/revocation, sandbox proof and deployment remain absent |
| PR11 OAuth policy hardening | `codex/ai-media-studio-oauth-policy-hardening`, stacked on PR #84 | Ready for GitHub review | Provider-neutral PKCE snapshots, fail-closed authorized callback handling, trusted redirect DB fence and expiring S3 PKCE objects pass 34/34 focused tests, TypeScript, build, checker and static App QA. Migration is unapplied; token exchange/routes/provider sandbox/deployment remain absent |

## PR2 — durable core and owned media

| Card | Owner | State | Acceptance |
| --- | --- | --- | --- |
| AMS-201 Migration artifact and rollback | Data owner | Partial | Forward/rollback SQL and static tests passed independent review; backup, staging apply and rollback rehearsal remain unapplied. No production `db:push` |
| AMS-202 Durable runtime verification | Backend runtime owner | Partial | Runtime selects Drizzle with `DATABASE_URL`, returns `503` without it in production, and isolates dev/test memory; staging restart proof remains gated by AMS-201 |
| AMS-203 Outbox worker and durable queue | Queue owner | Done (code) | Lease fencing, bounded retry, dead-letter, recovery, quotas, cancel/submit races and idempotency tests pass; no worker loop has been deployed |
| AMS-204 Object-storage ingest | Asset owner | Partial (PR4 code) | PR4 adds bounded ingest, tenant content-addressed storage contract/fake, retry/DLQ/fencing and reconciliation; production reader/object storage and live operation remain pending |
| AMS-205 Media library API | Backend media owner | Partial (PR4 code) | Tenant-scoped listing and redacted DTOs plus authenticated short-lived owned-video delivery are integrated; production signer/storage and live delivery remain pending |
| AMS-206 Influencer CRUD and rights | Backend identity owner | Partial | Full provider-neutral CRUD, archive lifecycle and tenant tests are integrated; consent/provenance hard gate remains pending |
| AMS-207 Media library/influencer UI | Frontend owner | Done | Loading/empty/error/populated states, pagination/retry, async archive feedback and accessible field errors passed App QA |
| AMS-208 Dashboard durable metrics | Backend + frontend | Pending | Counts/activity/cost derive from durable records and remain correct after restart |
| AMS-209 Runtime/route integration | Lead | Done (code) | Single route mount composes core Drizzle/memory policy, durable execution mode and production fail-closed behavior; checker passed |
| AMS-210 PR2 contract/integration suite | Test owner | Partial | 123 focused domain/UI/auth/migration/HTTP/map tests, focused TypeScript and client/server bundles pass; staging restart remains blocked by AMS-201 |
| AMS-211 PR2 checker review | Independent checker | Done | Final delta review against PR #67 reported no P0-P3 findings |
| AMS-212 PR2 App QA | App QA | Done (static) | Route, link/click, API, errors, accessibility, responsive and improvement scouts passed; no live browser target was available |

The PR2, PR3, and PR4 migrations remain unapplied. No `db:push`, live PostgreSQL validation, staging restart, or rollback rehearsal has occurred.

### PR2 integration order

1. **Backend makers finish ports and services** without editing the shared composition files.
2. **Data/queue/asset adapters land** with isolated contract tests; migration remains unapplied.
3. **Lead integrates runtime** in `server/ai-media-studio/routes.ts`: Drizzle for configured DB, durable queue/asset ports when configured, fail closed in production.
4. **Lead integrates top-level routes** through the single existing `registerAiMediaStudioRoutes(app)` call in `server/routes.ts`; no second mount.
5. **Frontend maker finishes sections** behind shared DTOs. Lead updates `client/src/pages/ai-media-studio.tsx` only after those exports stabilize.
6. **Lead updates Studio navigation** in `client/src/features/ai-media-studio/navigation.ts` for Influencers and Library; preserve the existing Dashboard inbound link and single `/ai-media-studio` App route.
7. **Migration owner generates SQL for review**, applies only to staging after approval, then runs restart/recovery and rollback rehearsal.
8. **Checker then App QA run**. Any warning returns the card to In progress. Replit deployment still requires Robert's explicit approval.

### PR2 merge gates

- PR #67 merged or PR2 cleanly rebased onto its merge commit.
- Diff reviewed against PR #67/base, not against a stale local `main`.
- No secrets, provider credentials or customer data in code, logs, fixtures or snapshots.
- Focused unit/contract/HTTP tests, typecheck and build pass.
- Reviewed migration SQL, staging apply, restart recovery, backup and rollback evidence exist.
- Independent checker reports no blocking findings.
- App QA reports no warnings or failures.
- PR summary includes files, commands, risks, migration state and rollback.
- Merge does not authorize deployment; Replit deployment waits for Robert.

## PR3 — publishing, learning and autonomous scale

| Card | Owner | State | Acceptance |
| --- | --- | --- | --- |
| AMS-301 Publishing connector ports | Publishing owner | Partial (code) | Provider-neutral port and fake provider exist; real TikTok, Instagram, Facebook and YouTube Shorts OAuth/adapters and sandbox proof are missing |
| AMS-302 Manual/scheduled publishing | Publishing + approvals | Done (code) | Server preview, future-only atomic scheduling, immutable approval/rejection, routes, repositories, scheduler/reconcile, client API and UI passed checker/static App QA; live provider execution remains pending |
| AMS-303 Automatic publishing policy | Trust/safety owner | Blocked | Robert approves autonomy; budget/rights/moderation gates and kill switch proven |
| AMS-304 Analytics ingestion | Analytics owner | Partial (code) | Normalized metric contracts, repositories and fake ingestion exist; real platform collection is missing |
| AMS-305 Creative attribution | Analytics owner | Partial (code/UI) | Avatar/hook/CTA/time/category attribution and cost summaries exist; real data validation and billing reconciliation are missing |
| AMS-306 Kong source adapters | Automation owner | Partial (code) | Bounded snapshot, content-hash dedupe, repositories and fake adapter exist; live Kong/platform ingestion and OAuth are missing |
| AMS-307 Automated content pipeline | Orchestration owner | Partial (code) | Guarded state machine, idempotent CAS persistence and transactional outbox emissions exist; no autonomous consumer or end-to-end live recovery |
| AMS-308 Distributed workers | Platform owner | Partial (code) | No-autostart loop, durable/in-memory outbox, fencing, retry/DLQ, health snapshot and render quotas exist; no deployment, autoscaling or real load proof |
| AMS-309 Multi-country/language policy | Policy owner | Partial (code) | Admission evaluates provider/tenant limits, language, country, timezone and daily budget; residency/rights/provider-routing operations remain missing |
| AMS-310 10,000/day capacity gate | Performance owner | Blocked on real environment | Deterministic 10k fake-provider rehearsal exists and is not capacity proof; burst/load, SLO telemetry, provider quotas, cost envelope and DR remain required |
| AMS-311 OAuth/vault control plane | Identity owner | Checker review | Durable digest-only state, provider-neutral persisted PKCE policy snapshots, opaque purpose-scoped vault references, exact account binding, legacy-unverified lifecycle, S3-KMS PKCE vault, provider authorization URL builders and fail-closed runtime composition are preserved in the stacked PR branches; authorized claim/exchange, mounted routes, token vault, refresh/revocation and sandbox proof remain blocked |

### PR3 current integration evidence

- Shared contracts, domain services, in-memory/Drizzle repositories, fake adapters, operations UI/client modules, migration SQL, orchestration/outbox, and worker utilities exist in the branch workspace.
- The operations HTTP routes/composition are integrated. The final checker reported no P0-P3 findings and static App QA reported no warnings; no live browser target was available.
- The authoritative local run passed 203 non-HTTP and 9 HTTP AI Media Studio tests (212 total), focused TypeScript, client/server bundles, codebase-map validation, and diff hygiene.
- No live PostgreSQL, OAuth, provider ingestion, external publishing, staging restart, real load, or production deployment evidence exists.

### PR3 merge gates

- PR2 and PR3 migration order is reviewed for this slice; PR4 follows them. All three migrations must be proven in staging and none is applied.
- Every publishing platform passes OAuth/permission and sandbox review.
- Paid rendering/posting has a cost estimate and Robert's explicit approval.
- Rights, consent, moderation and emergency-stop tests pass.
- Analytics definitions and attribution windows are documented and reproducible.
- Load, recovery, checker and App QA evidence pass before any production deployment request.
- Automatic publishing, external posting, deployment, and additional spend remain blocked without Robert's explicit approval.

## PR4 — owned render ingest and delivery

| Card | Owner | State | Acceptance |
| --- | --- | --- | --- |
| AMS-401 Ingest/storage contracts | Asset owner | Done (code) | Exact-host HTTPS/address/redirect and byte/chunk contracts, tenant temporary upload and content-addressed commit exist with fakes; production reader/object storage are missing |
| AMS-402 Durable ingest queue | Data/queue owner | Done (code) | Tenant/render idempotency, `SKIP LOCKED` claim, lease fencing, bounded retry, dead-letter and lease recovery have DB-independent SQL-shape tests; no live PostgreSQL proof |
| AMS-403 Canonical asset linkage | Runtime owner | Done (code) | Completed ingest materializes/reuses one checksum-addressed tenant video asset, links ingest/render, and reconciles bounded completed-unlinked work; migration remains unapplied |
| AMS-404 Authenticated delivery | API/UI owner | Done (code) | Tenant/ready-status-gated POST route signs for five minutes, clients request on demand, and public DTOs redact provider/storage URLs; signer and storage are fake/injected only |
| AMS-405 PR4 migration | Data owner | Partial | Additive forward/data-preserving rollback SQL and static tests exist; backup, ordered staging apply after PR2/PR3 and rollback rehearsal remain pending |
| AMS-406 Production asset adapters | Platform owner | Blocked on environment/approval | Implement and configure a real bounded reader, owned object store and signer, then prove provider sandbox ingest/delivery without leaking signed URLs |
| AMS-407 PR4 checker review | Independent checker | Done | Final PR #71 delta review found no P0-P3 issues after tenant isolation, SSRF/size defenses, fencing, reconciliation, redaction and migration checks |
| AMS-408 PR4 App QA | App QA | Done (static) | Route/link/click/API/loading/error/accessibility review passed after thumbnail redaction and per-instance ARIA ID fixes; live delivery QA still requires staging |

### PR4 current integration evidence

- Provider completion queues one private ingest input and does not expose or mark the render completed until canonical owned-asset linkage succeeds.
- Code/tests cover the bounded worker, content-addressed fake storage, durable repository SQL shape, retry/dead-letter/fencing, completed-unlinked repair, redacted DTOs, authenticated short-lived delivery, client failure states and PR4 SQL shape.
- The authoritative local run passed 255 AI Media Studio tests, global TypeScript, client/server isolated bundles, codebase-map validation and diff hygiene. Independent checker and static App QA found no remaining P0-P3 issues or warnings.
- The runtime starts no ingest loop. No real provider artifact was downloaded, no production object store/signer was called, and no external post, migration, deployment or capacity run occurred.

### PR4 merge gates

- Review only the PR4 delta from PR #71; preserve the stacked PR #67 -> PR #70 -> PR #71 -> PR4 order.
- Production reader tests prove DNS pinning, every redirect, exact host/HTTPS/port enforcement, timeouts, byte/chunk bounds, MP4/MIME/checksum validation and sanitized errors.
- Production object storage proves tenant isolation, atomic content-addressed commit/idempotency, lifecycle/retention and recovery from partial upload.
- Production signer proves authenticated short-TTL delivery without persisting or logging signed URLs.
- PR2, PR3, then PR4 SQL passes backup/staging/restart/recovery/rollback gates; none is currently applied.
- Independent checker and App QA report no warnings or failures. Replit/production deployment still requires Robert's explicit approval.
