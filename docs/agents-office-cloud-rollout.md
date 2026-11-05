# Agent office execution: rollout hold

This change prepares real subscription-based Claude analysis/PR review and authenticated read-only KONG operations. It does not establish production availability by itself.

## Preserve the published source

On 2026-11-05 the Daily Planner Replit workspace was on `publish/agents-world-reviewed-381ae4da`, commit `5ec46287d2617f008a5bb6e8d924867658178665`, 48 commits ahead of GitHub main. It contains the current 3D office and council. Do not deploy this older GitHub-based UI over it. Integrate the new modules and minimal wiring onto the current source, preserving its current work. Existing council timers and simulations are separate from this worker.

## Execution boundaries

- The web process persists accepted tasks only in cloud mode. A separate explicitly enabled worker claims durable PostgreSQL jobs. There is no local-file fallback in production.
- Schema SQL is exported by `createOfficeCloudSchemaSql()`. It is not applied automatically. Review and apply it through an approved migration, then verify actual PostgreSQL concurrency/locking before launch.
- Start the worker with `OFFICE_WORKER_ENABLED=true` and the approved Node/tsx runtime. Its entry point is `script/office-worker.ts`.
- Authenticate the official Claude Code CLI on the actual execution host using the owner's subscription. A PC login is not cloud authentication. Do not copy local OAuth credentials into source control or use a new paid API key.
- Configure `KONG_OFFICE_ADMIN_TOKEN` privately on the execution host. Its authenticated operations endpoint is fixed to `https://kongnightlife.com/api/admin/ceo/operations`. This audit reads state; it does not start city jobs or WhatsApp readers.
- `DEFAULT_USER_ID`, valid owner authentication, `PUBLIC_APP_URL`, PostgreSQL access, and the existing GitHub connection are required. Never expose these credentials in browser storage or responses.
- Claude runs without shell/file/network tools, hooks, or MCP extensions. PR approval requires the same current head and full diff hash, a fresh completed session, a passing verdict, and no findings. A newer blocking verdict revokes an earlier pass.
- Worker liveness and provider capability timestamps come from the actual execution host. Unknown/interrupted executions are not automatically retried. Permanent idempotency keys prevent duplicate dispatch.

## Required live checks

1. Verify owner-only HTTP access, same-origin writes, and rejection of forged execution evidence.
2. Verify real PostgreSQL migration, duplicate submission, concurrent claim fencing, worker interruption, lease expiry, and restart behavior on staging.
3. Obtain a real Claude response on the cloud execution host; verify a PR review against the exact current diff.
4. Obtain a fresh authenticated KONG audit. Confirm all 25 currently published cities, including Buenos Aires, and seven categories per city. Preserve newer zero-spend guards.
5. Repair and independently verify the separate Miami VIP `SAVE_FAILED` issue using the current source and safe database diagnostics. This office integration does not fix that fault.
6. Verify the current 3D office visually and run the required App QA checks. Existing Windows Chromium launch failures are unresolved release blockers.
7. Choose and approve continuous hosting resources/costs. The observed Autoscale deployment (1 vCPU, 0.5 GB) is not proof of a continuous worker and has not been resized here.
8. Present PR, review, QA evidence, remaining costs, and migration scope for explicit deployment approval. No merge, production migration, hosting purchase, or deployment has been performed.
