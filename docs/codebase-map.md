# Codebase Map

Generated: 2026-06-30T20:59:44.887Z
Repo: `/private/tmp/asistente-clippers-pr`
Package: `rest-express`

## Guardrails
- Generated locally from Git-visible files only: tracked files plus untracked files that are not ignored.
- Skips credentials/, secrets/, .env files, node_modules/, build outputs, media folders, and large data exports.
- Does not index SQL files or filenames that look like dumps, backups, credentials, secrets, or tokens.
- Use this map to narrow exploration; verify behavior in source files before editing.

## Totals
| Git-visible files | Indexed files | Imports | Routes | Symbols |
| ---: | ---: | ---: | ---: | ---: |
| 434 | 366 | 1382 | 99 | 9050 |

## Entrypoints
- `client/src/App.tsx`
- `client/src/main.tsx`
- `drizzle.config.ts`
- `package.json`
- `server/index.ts`
- `server/routes.ts`
- `shared/schema.ts`
- `vite.config.ts`

## Main Directories
| Directory | Visible | Indexed | Main kinds |
| --- | ---: | ---: | --- |
| `client/src` | 108 | 107 | ui-component:55, client-page:22, client-component:21, client-lib:4 |
| `server` | 95 | 91 | server:95 |
| `script` | 67 | 65 | script:67 |
| `tests` | 62 | 59 | test:62 |
| `.` | 24 | 17 | other:15, docs:8, package:1 |
| `docs` | 11 | 10 | docs:11 |
| `server/replit_integrations` | 8 | 8 | server:8 |
| `client/public` | 13 | 2 | other:13 |
| `.agents/skills` | 2 | 1 | docs:1, other:1 |
| `.upm` | 1 | 1 | other:1 |
| `client` | 1 | 1 | other:1 |
| `scripts` | 4 | 1 | script:4 |
| `shared` | 1 | 1 | shared:1 |
| `shared/models` | 1 | 1 | shared:1 |
| `tutorials/dropshipping-ceo-tutorial` | 8 | 1 | other:7, docs:1 |

## Routes Detected
- `client/src/App.tsx`: `/`, `/agents-office`, `/app-qa-agent`, `/assistant`, `/automations`, `/ceo`, `/clippers`, `/code-agent`, `/cybersecurity-agent`, `/dashboard`, `/dropshipping-ceo`, `/github-agent`, `/legal-compliance`, `/marketing-command-center`, `/portfolio`, `/portfolio/:symbol`, `/projects`, `/promo-video`, `/radio`, `/revenue-engine`, `/tools`
- `server/assistant.ts`: `/api/assistant/chat`, `/api/assistant/context`, `/api/assistant/transcribe`
- `server/index.ts`: `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`, `/dropshipping/legal/checkout-readiness`, `/dropshipping/legal/privacy`, `/dropshipping/legal/refund-policy`, `/dropshipping/legal/shipping-policy`, `/dropshipping/legal/terms`, `/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`, `/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt`
- `server/local-auth.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/register`
- `server/replit_integrations/chat/routes.ts`: `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`
- `server/replit_integrations/image/routes.ts`: `/api/generate-image`
- `server/shopify-routes.ts`: `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`
- `server/telegram-routes.ts`: `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/go-live/evidence`, `/api/ceo/readiness`, `/api/telegram/configure`, `/api/telegram/disconnect`, `/api/telegram/health`, `/api/telegram/setup-webhook`, `/api/telegram/status`, `/api/telegram/test`, `/api/telegram/test-ceo-brief`, `/api/telegram/toggle`, `/api/telegram/webhook`, `/api/telegram/webhook-status`
- `tests/clippers-tiktok-mvp-evidence-closeout.test.mjs`: `/api/clippers/apply-tiktok-mvp-evidence-closeout`, `/api/clippers/apply-tiktok-mvp-proof-intake-import`, `/api/clippers/apply-tiktok-mvp-proof-quick-fill`, `/api/clippers/create-tiktok-mvp-proof-links-drop-starter`, `/api/clippers/import-tiktok-mvp-proof-links-drop`, `/api/clippers/ingest-tiktok-mvp-proof-links-drop`, `/api/clippers/load-metricool-bridge-evidence-csv`, `/api/clippers/metricool-bridge-evidence-csv-status`, `/api/clippers/metricool-bridge-preview-gate`, `/api/clippers/operational-readiness`, `/api/clippers/parse-tiktok-mvp-proof-links-paste`, `/api/clippers/prepare-publisher-execution-queue`, `/api/clippers/prepare-tiktok-mvp-autopilot-boundary`, `/api/clippers/prepare-tiktok-mvp-closeout-wizard`, `/api/clippers/prepare-tiktok-mvp-local-verification`, `/api/clippers/prepare-tiktok-mvp-proof-doctor`, `/api/clippers/prepare-tiktok-mvp-proof-drop-kit`, `/api/clippers/prepare-tiktok-mvp-proof-handoff`, `/api/clippers/prepare-tiktok-mvp-proof-intake-pack`, `/api/clippers/prepare-tiktok-mvp-proof-refresh`, `/api/clippers/prepare-tiktok-mvp-proof-unblocker`, `/api/clippers/preview-metricool-bridge-evidence-batch`, `/api/clippers/preview-tiktok-mvp-evidence-closeout`, `/api/clippers/preview-tiktok-mvp-proof-intake-import`, `/api/clippers/preview-tiktok-mvp-proof-links`, `/api/clippers/record-metricool-bridge-evidence-batch`, `/api/clippers/save-tiktok-mvp-proof-links`, `/api/clippers/tiktok-mvp-autopilot-boundary`, `/api/clippers/tiktok-mvp-closeout-wizard`, `/api/clippers/tiktok-mvp-evidence-closeout`, `/api/clippers/tiktok-mvp-local-verification`, `/api/clippers/tiktok-mvp-proof-doctor`, `/api/clippers/tiktok-mvp-proof-drop-kit`, `/api/clippers/tiktok-mvp-proof-handoff`, `/api/clippers/tiktok-mvp-proof-intake-import`, `/api/clippers/tiktok-mvp-proof-links-drop-status`, `/api/clippers/tiktok-mvp-proof-quick-fill`, `/api/clippers/tiktok-mvp-proof-refresh`, `/api/clippers/tiktok-mvp-proof-unblocker`

## Test Inventory
- `tests/ai-cost-notifications.test.ts`
- `tests/ai-router-cost-override.test.ts`
- `tests/app-qa-agent.test.ts`
- `tests/assistant-chat-flow.test.ts`
- `tests/automation-registry.test.ts`
- `tests/blackroom-links.test.ts`
- `tests/ceo-backup-check-cli.test.ts`
- `tests/ceo-brief-cli.test.ts`
- `tests/ceo-briefing.test.ts`
- `tests/ceo-conversation-history.test.ts`
- `tests/ceo-db-check-cli.test.ts`
- `tests/ceo-doctor-cli.test.ts`
- `tests/ceo-go-live-cli.test.ts`
- `tests/ceo-operability.test.ts`
- `tests/ceo-operational-health.test.ts`
- `tests/ceo-ownership.test.ts`
- `tests/ceo-readiness-cli.test.ts`
- `tests/ceo-readiness.test.ts`
- `tests/ceo-smoke-cli.test.ts`
- `tests/clippers-agent.test.ts`
- `tests/clippers-owned-source-scripts.test.ts`
- `tests/clippers-tiktok-mvp-proof-links.test.ts`
- `tests/code-agent-security.test.ts`
- `tests/cybersecurity-agent.test.ts`
- `tests/db-config.test.ts`
- `tests/developer-autopilot-wiring.test.ts`
- `tests/developer-autopilot.test.ts`
- `tests/developer-health-inventory.test.ts`
- `tests/dropshipping-ceo.test.ts`
- `tests/env-loader-core.test.ts`
- `tests/github-client-security.test.ts`
- `tests/google-connector.test.ts`
- `tests/google-drive-folder-command.test.ts`
- `tests/google-drive-oauth.test.ts`
- `tests/legal-compliance-agent.test.ts`
- `tests/local-auth-cli.test.ts`
- `tests/local-auth.test.ts`
- `tests/local-youtube-worker-queue.test.ts`
- `tests/marketing-command-center.test.ts`
- `tests/metricool-tracking.test.ts`
- `tests/radio-template-agent.test.ts`
- `tests/radio-video-edit-agent.test.ts`
- `tests/radio-youtube-command.test.ts`
- `tests/rate-limit.test.ts`
- `tests/reminder-scheduler.test.ts`
- `tests/revenue-engine.test.ts`
- `tests/session-config.test.ts`
- `tests/shopify-oauth.test.ts`
- `tests/telegram-chat-flow.test.ts`
- `tests/telegram-chat-handler.test.ts`
- `tests/telegram-command.test.ts`
- `tests/telegram-config-cli.test.ts`
- `tests/telegram-readiness.test.ts`
- `tests/telegram-split.test.ts`
- `tests/telegram-webhook-cli.test.ts`
- `tests/telegram-webhook-dedupe.test.ts`
- `tests/telegram-webhook-runtime.test.ts`
- `tests/user-context.test.ts`
- `tests/user-migration-plan.test.ts`

## Key Files
- `client/src/pages/agents-office.tsx` (client-page; 146 symbols, 8 imports)
- `client/src/pages/app-qa-agent.tsx` (client-page; 11 symbols, 8 imports)
- `client/src/pages/assistant.tsx` (client-page; 49 symbols, 7 imports)
- `client/src/pages/auth.tsx` (client-page; 44 symbols, 8 imports)
- `client/src/pages/automation-manager.tsx` (client-page; 13 symbols, 8 imports)
- `client/src/pages/ceo-dashboard.tsx` (client-page; 40 symbols, 10 imports)
- `client/src/pages/code-agent.tsx` (client-page; 21 symbols, 7 imports)
- `client/src/pages/cybersecurity-agent.tsx` (client-page; 11 symbols, 8 imports)
- `client/src/pages/dashboard.tsx` (client-page; 25 symbols, 26 imports)
- `client/src/pages/dropshipping-ceo.tsx` (client-page; 76 symbols, 13 imports)
- `client/src/pages/github-agent.tsx` (client-page; 29 symbols, 7 imports)
- `client/src/pages/investment-detail.tsx` (client-page; 41 symbols, 9 imports)
- `client/src/pages/legal-compliance.tsx` (client-page; 5 symbols, 7 imports)
- `client/src/pages/marketing-command-center.tsx` (client-page; 10 symbols, 9 imports)
- `client/src/pages/not-found.tsx` (client-page; 2 imports)
- `client/src/pages/portfolio.tsx` (client-page; 35 symbols, 14 imports)
- `client/src/pages/projects.tsx` (client-page; 14 symbols, 15 imports)
- `client/src/pages/promo-video.tsx` (client-page; 22 symbols, 11 imports)
- `client/src/pages/radio.tsx` (client-page; 19 symbols, 12 imports)
- `client/src/pages/revenue-engine.tsx` (client-page; 79 symbols, 12 imports)
- `client/src/pages/tools.tsx` (client-page; 2 symbols, 6 imports)
- `package.json` (package)
- `script/build.ts` (script; 11 symbols, 4 imports)
- `script/ceo-db-check.ts` (script; 8 symbols, 3 imports)
- `script/ceo-doctor.ts` (script; 3 symbols, 1 imports)
- `script/ceo-go-live.ts` (script; 9 symbols, 2 imports)
- `script/ceo-handoff.mjs` (script; 1 imports)
- `script/ceo-readiness.ts` (script; 10 symbols, 8 imports)
- `script/ceo-restore.ts` (script; 9 symbols, 4 imports)
- `script/ceo-smoke.ts` (script; 29 symbols, 15 imports)
- `script/ceo-verify-local.mjs` (script; 2 symbols, 1 imports)
- `script/clippers-account-permission-readiness.mjs` (script; 162 symbols, 2 imports)
- `script/clippers-external-closeout-pack.mjs` (script; 268 symbols, 3 imports)
- `script/clippers-generate-owned-gap-sources.mjs` (script; 30 symbols, 3 imports)
- `script/clippers-generate-owned-meme-sources.ts` (script; 23 symbols, 3 imports)
- `script/clippers-generate-owned-sports-streamer-sources.ts` (script; 26 symbols, 3 imports)
- `script/clippers-generate-owned-weekly-backlog-sources.ts` (script; 34 symbols, 3 imports)
- `script/clippers-goal-completion-audit.mjs` (script; 74 symbols, 2 imports)
- `script/clippers-import-external-closeout-evidence.ts` (script; 120 symbols, 3 imports)
- `script/clippers-metricool-current-batch-session-packet.mjs` (script; 50 symbols, 2 imports)
- `script/clippers-metricool-current-batch-upload-pack.mjs` (script; 77 symbols, 2 imports)
- `script/clippers-metricool-mcp-preflight.ts` (script; 29 symbols, 3 imports)
- `script/clippers-metricool-operator-handoff.mjs` (script; 159 symbols, 3 imports)
- `script/clippers-operational-readiness.mjs` (script; 53 symbols, 4 imports)
- `script/clippers-record-owned-meme-rights.ts` (script; 10 symbols, 1 imports)
- `script/clippers-record-owned-source-rights.mjs` (script; 91 symbols, 3 imports)
- `script/clippers-sync-metricool-source-readiness.mjs` (script; 28 symbols, 3 imports)
- `script/clippers-tiktok-batch-closeout-verifier.mjs` (script; 47 symbols, 2 imports)
- `script/clippers-tiktok-batch-evidence-sync.mjs` (script; 96 symbols, 4 imports)
- `script/clippers-tiktok-batch-runbook.mjs` (script; 54 symbols, 2 imports)
- `script/clippers-tiktok-batch-tracker.mjs` (script; 82 symbols, 2 imports)
- `script/clippers-tiktok-evidence-checklist.mjs` (script; 38 symbols, 2 imports)
- `script/clippers-tiktok-external-closeout-session.mjs` (script; 56 symbols, 2 imports)
- `script/clippers-tiktok-launch-control.mjs` (script; 63 symbols, 2 imports)
- `script/clippers-tiktok-mvp-autopilot-boundary.mjs` (script; 44 symbols, 3 imports)
- `script/clippers-tiktok-mvp-closeout-wizard.mjs` (script; 45 symbols, 3 imports)
- `script/clippers-tiktok-mvp-evidence-closeout.mjs` (script; 68 symbols, 3 imports)
- `script/clippers-tiktok-mvp-go-live-packet.mjs` (script; 46 symbols, 3 imports)
- `script/clippers-tiktok-mvp-local-verification.mjs` (script; 25 symbols, 3 imports)
- `script/clippers-tiktok-mvp-operating-refresh.ts` (script; 20 symbols, 5 imports)
- `script/clippers-tiktok-mvp-proof-doctor.mjs` (script; 49 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-drop-kit.mjs` (script; 59 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-handoff.mjs` (script; 55 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-intake-import.mjs` (script; 69 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-intake-pack.mjs` (script; 36 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-quick-fill.mjs` (script; 53 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-refresh.mjs` (script; 20 symbols, 3 imports)
- `script/clippers-tiktok-mvp-proof-unblocker.mjs` (script; 41 symbols, 3 imports)
- `script/clippers-tiktok-mvp-readiness-verifier.mjs` (script; 47 symbols, 2 imports)
- `script/clippers-tiktok-next-action.mjs` (script; 60 symbols, 2 imports)
- `script/clippers-tiktok-operator-cockpit-preflight.mjs` (script; 75 symbols, 2 imports)
- `script/clippers-tiktok-operator-cockpit.mjs` (script; 28 symbols, 2 imports)
- `script/clippers-tiktok-post-schedule-verifier.mjs` (script; 38 symbols, 2 imports)
- `script/clippers-tiktok-preflight.ts` (script; 15 symbols, 1 imports)
- `script/codebase-map.ts` (script; 43 symbols, 3 imports)
- `script/configure-telegram.ts` (script; 5 symbols, 4 imports)
- `script/create-ceo-go-live-task.ts` (script; 13 symbols, 3 imports)
- `script/create-local-user.ts` (script; 5 symbols, 3 imports)
- `script/ensure-radio-tiktok-drive-folder.ts` (script; 4 symbols, 3 imports)
- `script/import-developer-health-inventory.ts` (script; 14 symbols, 4 imports)

## How Agents Should Use This
1. Read this map before broad repo exploration.
2. Pick the smallest set of files likely to answer the task.
3. Read source files directly before editing or making strong claims.
4. Regenerate with `npm run codebase:map` after major file moves, new pages, routes, tests, or server modules.
5. Do not paste `docs/codebase-map.json` into prompts; use it for local scripts or targeted lookups only.

