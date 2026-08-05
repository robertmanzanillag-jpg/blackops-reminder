# Clippers CEO runtime

The free local worker runs one guarded cycle every hour. It does not claim active work unless a subprocess actually runs and it writes an observable report for every completed or blocked cycle.

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

Install and start the hourly worker only from the merged primary checkout:

```sh
CLIPPERS_LAUNCH_AGENT_DRY_RUN=false npm run clippers:install-free-local-worker
```

Runtime authorization and provider credentials must remain in an existing selected project environment file. The installer intentionally does not copy them into the plist. Do not enable paid spend, paid AI, cleanup execution, or accounts outside the Clippers inventory.

## Current supply contract

Marketplace discovery consumes local snapshots documented in `docs/clippers-marketplace-intake.md`. A missing, stale, unjoined, expired, incompatible, or rights-unverified campaign blocks the cycle. The worker never fills the daily target with duplicates or unverified content.

## Rollback

Unload `com.blackops.clippers-free-worker`, restore the prior plist if one was backed up by operations, and revert this PR. Do not delete local MP4s or publication evidence as part of rollback.
