# AI Media Studio Delivery Board

Flow: **Backlog -> Ready -> In progress -> Checker review -> App QA -> Done**. A blocked card records owner, evidence and its exact unblock condition. Only one maker owns a file at a time.

## Stack status

| Delivery | Branch / PR | State | Meaning |
| --- | --- | --- | --- |
| Foundation | PR #67, `codex/ai-media-studio` | Clean / mergeable | Provider-neutral vertical slice accepted as the base; no deployment implied |
| PR2 core | `codex/ai-media-studio-core` | Stacked on PR #67 | Durable core, owned media and operational APIs; review the PR2 delta after base merge/rebase |
| PR3 operations | Branch after PR2 | Backlog | Publishing, analytics feedback, autonomous sources and distributed scale |

## PR2 — durable core and owned media

| Card | Owner | State | Acceptance |
| --- | --- | --- | --- |
| AMS-201 Migration artifact and rollback | Data owner | Partial | Forward/rollback SQL and static tests passed independent review; backup, staging apply and rollback rehearsal remain unapplied. No production `db:push` |
| AMS-202 Durable runtime verification | Backend runtime owner | Partial | Runtime selects Drizzle with `DATABASE_URL`, returns `503` without it in production, and isolates dev/test memory; staging restart proof remains gated by AMS-201 |
| AMS-203 Outbox worker and durable queue | Queue owner | Done (code) | Lease fencing, bounded retry, dead-letter, recovery, quotas, cancel/submit races and idempotency tests pass; no worker loop has been deployed |
| AMS-204 Object-storage ingest | Asset owner | Ready | Stream allowlisted HTTPS MP4 into owned storage with redirect/size/MIME/checksum controls and recovery |
| AMS-205 Media library API | Backend media owner | Partial | Tenant-scoped asset listing, lifecycle state, relations, filters, pagination and redacted stable DTOs are integrated; detail and owned delivery URLs remain pending |
| AMS-206 Influencer CRUD and rights | Backend identity owner | Partial | Full provider-neutral CRUD, archive lifecycle and tenant tests are integrated; consent/provenance hard gate remains pending |
| AMS-207 Media library/influencer UI | Frontend owner | Done | Loading/empty/error/populated states, pagination/retry, async archive feedback and accessible field errors passed App QA |
| AMS-208 Dashboard durable metrics | Backend + frontend | Pending | Counts/activity/cost derive from durable records and remain correct after restart |
| AMS-209 Runtime/route integration | Lead | Done (code) | Single route mount composes core Drizzle/memory policy, durable execution mode and production fail-closed behavior; checker passed |
| AMS-210 PR2 contract/integration suite | Test owner | Partial | 123 focused domain/UI/auth/migration/HTTP/map tests, focused TypeScript and client/server bundles pass; staging restart remains blocked by AMS-201 |
| AMS-211 PR2 checker review | Independent checker | Done | Final delta review against PR #67 reported no P0-P3 findings |
| AMS-212 PR2 App QA | App QA | Done (static) | Route, link/click, API, errors, accessibility, responsive and improvement scouts passed; no live browser target was available |

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
| AMS-301 Publishing connector ports | Publishing owner | Backlog | TikTok, Instagram, Facebook and YouTube Shorts adapters pass provider contract tests |
| AMS-302 Manual/scheduled publishing | Publishing + approvals | Backlog | Immutable preview, explicit approval, timezone-safe scheduler and reconciliation |
| AMS-303 Automatic publishing policy | Trust/safety owner | Blocked | Robert approves autonomy; budget/rights/moderation gates and kill switch proven |
| AMS-304 Analytics ingestion | Analytics owner | Backlog | Normalized engagement/retention metrics with idempotent platform collection |
| AMS-305 Creative attribution | Analytics owner | Backlog | Rank avatar/hook/CTA/time/category and calculate cost per video/view from durable joins |
| AMS-306 Kong source adapters | Automation owner | Backlog | Event/restaurant/hotel/promotion/deal/travel triggers emit deduped snapshots |
| AMS-307 Automated content pipeline | Orchestration owner | Backlog | Idea -> script -> approval -> render -> ingest -> publish queue recovers after crash |
| AMS-308 Distributed workers | Platform owner | Backlog | Leases, quotas, backpressure, autoscaling and dead-letter operations pass load tests |
| AMS-309 Multi-country/language policy | Policy owner | Backlog | Locale, timezone, residency, rights and provider routing tested |
| AMS-310 10,000/day capacity gate | Performance owner | Backlog | Burst/load report, SLOs, provider quotas, cost envelope and disaster recovery approved |

### PR3 merge gates

- PR2 durable runtime and migration are already proven in staging.
- Every publishing platform passes OAuth/permission and sandbox review.
- Paid rendering/posting has a cost estimate and Robert's explicit approval.
- Rights, consent, moderation and emergency-stop tests pass.
- Analytics definitions and attribution windows are documented and reproducible.
- Load, recovery, checker and App QA evidence pass before any production deployment request.
