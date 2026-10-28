# KONG cloud publication lane

This adds a real recurring publication lane to the existing server, disabled until deployment configuration is supplied. It is **not yet the requested end-to-end discovery/editing/learning agent**. No paid AI or new hosting service is invoked. It needs an always-running existing VM and its PostgreSQL database; a sleeping/autoscaled deployment cannot promise continuous work.

## What runs

Every 15 minutes (also on server start), one database-advisory-lock owner reads a remote reviewed catalog and fills a rolling 14-day plan, five distinct creatives per day per network for TikTok and Facebook Reels. Each network has independent slots. Repeated video hashes/hooks are excluded for 14 days, consecutive families vary, at most two of each family per day. Seed hours are hypotheses, not learned optimal hours. Missing supply remains an explicit coverage gap. Instagram and YouTube are excluded, including older persisted jobs and accidentally configured account names; existing remote posts are not modified by this scope change.

Jobs and confirmed Metricool receipt IDs are saved in PostgreSQL. The scheduler records an intent **before** any create call. Timeouts/lost responses become reconcile-only jobs, never blind duplicate submissions. Safe read/preflight failures retry on later cycles. The provider calendar must confirm the exact caption, time, timezone, network and non-draft state before a job is marked scheduled. Scheduled is not proof of successful public publication or views.

This runtime neither scans a Mac nor reuses the BlackRoom brand, caption, account or schedule method. It reuses only the generic MCP transport/timezone conversion. KONG brand is pinned to 6475033. TikTok own-brand commercial disclosure is on. No bio/profile changes, deletions, boosts or spending occur.

## Deployment configuration (operator-owned secrets; do not commit values)

- Existing `DATABASE_URL`, `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID`.
- `KONG_OWNER_USER_ID`: authenticated owner allowed to read status.
- `KONG_CATALOG_URL`: HTTPS JSON catalog hosted online.
- `KONG_MEDIA_ORIGINS`: comma-separated exact trusted HTTPS origins for catalog and media. Configure only operator-controlled public origins (never private network hosts or hosts whose DNS others control).
- `KONG_METRICOOL_ACCOUNTS_VERIFIED=tiktok,facebook`: list only accounts actually confirmed in brand 6475033. `tiktok` alone enables that network while Facebook remains blocked. Unsupported networks are ignored.
- `KONG_AUTOPILOT_ENABLED=true`: start recurring planner.
- `KONG_AUTOPUBLISH_ENABLED=true`: execute standing owner authorization for automatic publication. There is no recurring approval queue in this lane.

The authenticated owner can GET `/api/kong-autopilot/status`. It exposes missing configuration, source/discovery/render/learning stage availability, prepared versus scheduled counts for 14 days, uncertainty, cycle health and receipts. GET does not create tables or run cycles. No public mutation endpoint exists. Set autopublishing false to stop new submissions; disable autopilot to stop the runtime. Already scheduled remote posts remain scheduled.

## Catalog contract

See `assetSchema` and `catalogSchema` in `server/kong-autopilot-core.ts`; invalid catalog is rejected, not interpreted as empty. Version 1 has `assets`. Each asset is an already rendered online 1080x1920 MP4, 3–90 seconds (the conservative existing Facebook Reel adapter range), SHA-256 bound to human QA, unique hook/title/caption, family, source URL, footage and music rights evidence with reviewer and expiry. QA records official white gorilla without background/shadow, safe zones, audio and spelling. This is a trusted editor attestation, not an automated visual/audio inspection. The runtime re-downloads bytes (100 MB cap) and checks their hash before submitting. Use immutable media URLs: the provider fetches them separately after submission.

Event, app, table, guestlist, yacht and car claims require a source URL, verified timestamp, and valid-until timestamp. Verification must be within 24 hours at planning/submission, and valid-until and rights must cover the scheduled time. Captions must link to https://kongnightlife.com and pass brand copy constraints. No access/availability promises may be fabricated to fill inventory. Coverage is explicitly local ledger coverage, not a fresh remote calendar audit; the status reports remote coverage unverified.

## Remaining activation work

### Online source, production pipeline and learning integration

`kong-cloud-renderer.ts` renders actual 1080x1920 H.264/AAC MP4 files with POV, reveal and 3–6-clip montage layouts, bounded subprocesses and a verified logo hash. It uses PATH ffmpeg/ffprobe and ImageMagick to measure and rasterize every text block before compositing. Oversized text is rejected. It drops source audio and requires a separately authorized soundtrack. Synthetic smoke tests generated three distinct files and validated codecs, duration and geometry. Technical checks are **not visual/audio approval**; the result explicitly requires visual QA.

`kong-production-pipeline.ts` now connects discovery, rendering, durable uploads and hash-bound review through a persisted state machine. `createKongCloudRuntime(env, options)` accepts production adapters and a task provider, persisting their state under the same PostgreSQL lease as scheduling. Enable production separately with `KONG_PRODUCTION_ENABLED=true`; public upload also requires publishing authorization and verified accounts. Missing adapters are reported, never silently simulated. The default server registration has no production configuration yet. Upload intent is saved before making media publicly accessible; uncertain writes are reconciled, not blindly retried. Review remains required before the asset can become a social post. Catalog failure does not suppress previously reviewed production assets or receipt reconciliation.

`kong-editorial-planner.ts` supplies deterministic rolling 14-day planning (up to 70 dated tasks) with distinct sources/hooks, three layouts, optional verified event facts and explicit footage/music/distribution authorization. Configure `options.production.editorial` to use it directly in the runtime, or provide a custom `tasks` callback. `plannedDay` survives production QA and restricts scheduling to that day. Failed-source tasks are replaced using different sources. Rights must cover the target day, while source/fact freshness always uses actual current time. This is not yet a trend scout, learning-driven selector or autonomous visual reviewer; experimental labels are planned tests, not proven novelty/winners, and reveal phrases can repeat across days.

Rendering persists attempts before execution and quarantines a clip after three failures, with 15/30-minute backoff. Candidate cache expires after seven days while job snapshots retain provenance. `kong-production-archive.ts` moves terminal production jobs older than 30 days to an append-only PostgreSQL table before trimming active state, preserving full evidence and protecting unresolved scheduler references. Failed archive/trim writes retain recoverability. The 500 active-job cap remains a safety limit; a large unresolved backlog is still a condition requiring attention rather than silent deletion.

`kong-online-sources.ts` supports the current Pexels video-search API with rotating queries, used-source IDs, provenance and license references. It requires an explicitly configured API key and makes no request without it. An alternative owner-authorized online manifest requires rights evidence and expiry. Discovery is not visual clearance: remove source audio, check depiction/brand restrictions and review the finished creative before publication. No arbitrary social-video download is authorized by this adapter.

`kong-media-store.ts` reuses existing Google Drive upload/sharing helpers, copies hash-bound bytes into a hash-named temporary file, and checks the complete anonymous MP4 response against the render hash. The scheduler uses this verifier, permitting only exact configured origins through at most four redirects. Drive upload/sharing calls are bounded, but a timeout is an **unknown write outcome**: reconcile the hash filename before any retry. The production pipeline persists upload intent and receipt. A working Drive connection, quota, reconciliation adapter and zero incremental cost remain unverified.

The local codebase map refresh was attempted in the isolated archive and could not run because it requires a Git checkout. Regenerate it in the PR checkout before merge; no inaccurate replacement map was generated.

`server/kong-content-learning.ts` preserves unavailable metrics separately from zero, deduplicates snapshots, compares networks separately at 24–26h, 72–78h and 168–180h, and requires at least three group posts plus five comparison posts. `kong-metricool-learning.ts` maps verified Metricool fields and runtime persists one observation per post/window. Collection is gated by a verified public-post registry, which is not yet automatically populated: a scheduler receipt is not a public post ID. Missing retention, clicks and followers remain missing. These descriptive comparisons do not prove causality or guarantee virality; old lifetime totals cannot become historical 24-hour snapshots. Recommendations are not yet connected to automatic future-creative replacement.

1. Configure a cloud catalog with real licensed footage **and music** and verified current offers. Finding public viral clips alone does not establish reuse rights.
2. Provision and pass actual production adapters at startup: online source credentials, authorized soundtrack, official logo, font, Drive authorization/reconciliation and genuine review, plus the explicit editorial policy. Wire current event ingestion. Rolling backfill and durable archival have injected integration tests, not a verified production run. No credentials are included in this change.
3. Populate the verified public-post registry from actual publication evidence and configure genuinely controlled candidate supply. New-slot selection is wired, but baseline production is not a closed-loop optimizer; automatic creative replacement remains incomplete. No learning result is claimed without observations.
4. Verify the actual TikTok/Facebook account connection, adapter response shape, one controlled scheduled post and eventual publication in the production Metricool account. No live mutation was used in unit tests.
5. Add actionable monitoring for no-supply, database outage and uncertain provider outcomes. Current status endpoint makes failures visible but does not send notifications.
6. PR review and explicit Replit deployment approval remain required. No deployment/activation is performed by this patch.

Run `node --import tsx --test tests/kong-autopilot.test.ts`. Roll back startup registration or set both KONG enable flags false; preserve the database ledger for reconciliation.

## Measured selection and experiment provenance

`kong-calendar-audit.ts` reads the scoped Metricool scheduler after writes or hourly, persists a 14-day remote audit, and separates scheduled posts from verified video counts. Drafts, errors, past dates, wrong brands and unsupported networks cannot satisfy coverage. Unknown media, pagination, conflicting records and read failures do not become zeroes. Cached results retain the inspected networks and expire after one hour; adding a network forces a new read. This does not prove eventual publication/distribution, send alerts, or automatically replace externally removed posts. Runtime exposes the audit separately from the local ledger.

`kong-learning-selection.ts` is wired into new-slot planning. It uses adequately sampled, network-specific 72h/7d descriptive evidence, reserves at least 40 percent explicit exploration in a controlled pool, and rejects variations with weak primary outcomes (including TikTok shares). It never changes already assigned public posts. Material decision transitions are append-only; identical repeated gap decisions do not inflate the log. Missing evidence or baseline/unclassified supply retains baseline selection with an explicit reason, not an optimization claim.

Built-in planning records baseline metadata, actual source IDs, layout and a descriptive hypothesis through task, render/restart and reviewed asset. Optional hook protocols label only exact matching hook/layout/duration candidates; they do not control footage/audio or prove causality. The previous ordinal exploration labels were removed. No protocol or publication registry is automatically configured in production. The complete targeted suite passes 95 tests including a synthetic ffmpeg render; full repository typecheck remains unverified because the isolated dependencies lack required node/react/react-dom/vite type definitions.

## Existing infrastructure evidence and remaining source/render blockers

The repository's `.replit` declares a VM deployment and PostgreSQL module. `replit.nix` declares ffmpeg, yt-dlp and ImageMagick, so the repository has a possible no-new-service render host, but these declarations do not prove the running deployment contains usable binaries or spare capacity. No production availability claim is made from configuration alone.

On 2026-10-28, the Replit connector reported Daily Planner deployed successfully at `https://robertwebsites.com` and br-website-ai at `https://blackroomus.com`. A read-only **Daily Planner development workspace** probe confirmed ffmpeg/ffprobe and presence (not values) of database and Metricool configuration. Pexels API, KONG catalog and media-origin configuration were absent. The public health probe redirected to Replit Shield, so live health, production capacity and production configuration remain unverified. No paid Replit Agent request, deployment or credentials change was made.

`script/blackroom-deterministic-editor.ts` has reusable editing logic but defaults its binaries to `/opt/homebrew/bin` and uses BlackRoom-specific source/render folders and queue/ledger. It is not connected to this KONG server runtime. Merely having the script does not make cloud KONG editing operational.

`server/blackroom-control-routes.ts` serves uploads from an OS temporary directory and keeps their index in memory. That transport is not a durable KONG source library: restarts can lose its lookup and cleanup expires files. A durable, immutable online catalog/media location still needs verification/configuration before this publication lane can run continuously. No storage credentials were read or changed during this inspection.
