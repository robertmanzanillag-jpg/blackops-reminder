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

`server/kong-content-learning.ts` now provides a pure, tested learning component, **not yet wired to this runtime**. It preserves unavailable metrics separately from zero, deduplicates snapshots, compares networks separately at 24–26h, 72–78h and 168–180h, and requires at least three group posts plus five comparison posts. Creative recommendations reserve at least 40% for exploration. These descriptive comparisons do not prove causality or guarantee virality. A provider adapter and durable snapshot collection are still needed; old lifetime totals cannot become historical 24-hour snapshots.

1. Configure a cloud catalog with real licensed footage **and music** and verified current offers. Finding public viral clips alone does not establish reuse rights.
2. Build/wire online discovery, deterministic editing and fresh event ingestion; this lane expects already edited clips and honestly reports those stages as unavailable.
3. Connect provider analytics with 24-hour/72-hour/7-day observations, per-network scoring, tests and future-creative replacement. This lane does not claim learning.
4. Verify the actual TikTok/Facebook account connection, adapter response shape, one controlled scheduled post and eventual publication in the production Metricool account. No live mutation was used in unit tests.
5. Add actionable monitoring for no-supply, database outage and uncertain provider outcomes. Current status endpoint makes failures visible but does not send notifications.
6. PR review and explicit Replit deployment approval remain required. No deployment/activation is performed by this patch.

Run `node --import tsx --test tests/kong-autopilot.test.ts`. Roll back startup registration or set both KONG enable flags false; preserve the database ledger for reconciliation.

## Existing infrastructure evidence and remaining source/render blockers

The repository's `.replit` declares a VM deployment and PostgreSQL module. `replit.nix` declares ffmpeg, yt-dlp and ImageMagick, so the repository has a possible no-new-service render host, but these declarations do not prove the running deployment contains usable binaries or spare capacity. No production availability claim is made from configuration alone.

On 2026-10-28, the Replit connector reported Daily Planner deployed successfully at `https://robertwebsites.com` and br-website-ai at `https://blackroomus.com`. A read-only **Daily Planner development workspace** probe confirmed ffmpeg/ffprobe and presence (not values) of database and Metricool configuration. Pexels API, KONG catalog and media-origin configuration were absent. The public health probe redirected to Replit Shield, so live health, production capacity and production configuration remain unverified. No paid Replit Agent request, deployment or credentials change was made.

`script/blackroom-deterministic-editor.ts` has reusable editing logic but defaults its binaries to `/opt/homebrew/bin` and uses BlackRoom-specific source/render folders and queue/ledger. It is not connected to this KONG server runtime. Merely having the script does not make cloud KONG editing operational.

`server/blackroom-control-routes.ts` serves uploads from an OS temporary directory and keeps their index in memory. That transport is not a durable KONG source library: restarts can lose its lookup and cleanup expires files. A durable, immutable online catalog/media location still needs verification/configuration before this publication lane can run continuously. No storage credentials were read or changed during this inspection.
