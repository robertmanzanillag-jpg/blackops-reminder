# Clippers CEO runtime

Three independent local LaunchAgents keep TikTok operations, original YouTube content rendering, and health checks from blocking each other:

- `com.blackops.clippers-content-worker` prepares the ES/EN motivation lanes and the weekly sleep artifact at 4:00 AM local time.
- `com.blackops.clippers-free-worker` runs the guarded Marketplace/Metricool/TikTok cycle at 7:00 AM.
- `com.blackops.clippers-daily-watchdog` checks both reports at 10:00 AM.

No job claims active work unless it writes a fresh observable report. The content worker has no network, credentials, upload, publish, paid-service, Marketplace, Metricool, or TikTok access.

## Cycle

1. Normalize fresh local marketplace snapshots and verify rights evidence.
2. Reuse or upload approved MP4 media to the configured public media provider.
3. Build the daily CEO decision and Metricool queue, capped at five posts and USD 0.
4. Deduplicate and schedule only proof-backed items on the authorized Metricool blog/account.
5. Reconcile scheduled rows with an exact public TikTok URL and explicit metrics.
6. Keep cleanup non-destructive unless its separate execute flag is explicitly enabled.

The worker stops at the first failed gate. Inspect `GET /api/clippers/runtime-status` for a safe status and next action, and the local report under `clippers_workspace/reports/free-local-worker/latest.json` for operator detail.

## Activation after merge and QA

Preview the LaunchAgent without installing it:

```sh
npm run clippers:install-free-local-worker
```

Before installation, create the explicit owner-only content configuration at:

`/Users/robertmanzanilla/.local/share/blackops/clippers-workspace/config/clippers-content-worker.json`

The schema and example are documented in `docs/clippers-content-local-worker.md`. Keep the file at mode `600`; the installer rejects a missing, symlinked, group-readable, or world-readable configuration. The installer does not invent channel approvals or rights gates.

Install the daily workers only from a clean runtime exactly at `origin/main`:

```sh
CLIPPERS_LAUNCH_AGENT_DRY_RUN=false npm run clippers:install-free-local-worker
```

Runtime authorization and provider credentials must remain in an existing selected project environment file. The installer intentionally does not copy them into the plist. Do not enable paid spend, paid AI, cleanup execution, or accounts outside the Clippers inventory.

The content worker writes `reports/content-worker/clippers-content-local-worker-latest.json`. The watchdog reports freshness plus planned/rendered/shortfall counts independently for Spanish motivation, English motivation, and sleep. Planned or rendered content is explicitly not treated as publication proof, and the watchdog never claims a YouTube upload.

## Current supply contract

Marketplace discovery consumes local snapshots documented in `docs/clippers-marketplace-intake.md`. A missing, stale, unjoined, expired, incompatible, or rights-unverified campaign blocks the cycle. The worker never fills the daily target with duplicates or unverified content.

## Rollback

Unload `com.blackops.clippers-content-worker`, `com.blackops.clippers-free-worker`, and `com.blackops.clippers-daily-watchdog`; restore prior plists if operations backed them up; then revert this PR. Do not delete local MP4s or publication evidence as part of rollback.
