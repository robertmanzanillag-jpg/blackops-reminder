# Codebase Map

Generated: 2026-06-20T04:46:22.464Z
Repo: `/Users/robertmanzanilla/Documents/asistente`
Package: `rest-express`

## Guardrails
- Generated locally from Git-visible files only: tracked files plus untracked files that are not ignored.
- Skips credentials/, secrets/, .env files, node_modules/, build outputs, media folders, and large data exports.
- Does not index SQL files or filenames that look like dumps, backups, credentials, secrets, or tokens.
- Use this map to narrow exploration; verify behavior in source files before editing.

## Totals
| Git-visible files | Indexed files | Imports | Routes | Symbols |
| ---: | ---: | ---: | ---: | ---: |
| 350 | 300 | 1217 | 383 | 5744 |

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
| `client/src` | 107 | 106 | ui-component:55, client-page:22, client-component:20, client-lib:4 |
| `server` | 84 | 81 | server:84 |
| `tests` | 52 | 50 | test:52 |
| `script` | 23 | 21 | script:23 |
| `.` | 22 | 16 | other:14, docs:7, package:1 |
| `docs` | 11 | 11 | docs:11 |
| `server/replit_integrations` | 8 | 8 | server:8 |
| `client/public` | 13 | 2 | other:13 |
| `.agents/skills` | 2 | 1 | docs:1, other:1 |
| `.upm` | 1 | 1 | other:1 |
| `client` | 1 | 1 | other:1 |
| `shared` | 1 | 1 | shared:1 |
| `shared/models` | 1 | 1 | shared:1 |
| `scripts` | 3 | 0 | script:3 |

## Routes Detected
- `client/src/App.tsx`: `/`, `/agents-office`, `/app-qa-agent`, `/assistant`, `/automations`, `/ceo`, `/clippers`, `/code-agent`, `/cybersecurity-agent`, `/dashboard`, `/dropshipping-ceo`, `/github-agent`, `/legal-compliance`, `/marketing-command-center`, `/portfolio`, `/portfolio/:symbol`, `/projects`, `/promo-video`, `/radio`, `/revenue-engine`, `/tools`
- `server/assistant.ts`: `/api/assistant/chat`, `/api/assistant/context`, `/api/assistant/transcribe`
- `server/index.ts`: `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`, `/dropshipping/legal/checkout-readiness`, `/dropshipping/legal/privacy`, `/dropshipping/legal/refund-policy`, `/dropshipping/legal/shipping-policy`, `/dropshipping/legal/terms`, `/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`, `/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt`
- `server/local-auth.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/register`
- `server/replit_integrations/chat/routes.ts`: `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`
- `server/replit_integrations/image/routes.ts`: `/api/generate-image`
- `server/routes.ts`: `/api/agent/actions`, `/api/agent/actions/:category`, `/api/agent/execute-batch`, `/api/agent/execute/:actionId`, `/api/agent/history`, `/api/app-qa-agent/history`, `/api/app-qa-agent/scan`, `/api/app-qa-agent/status`, `/api/approval-history`, `/api/assistant/permissions`, `/api/assistant/permissions/:scope`, `/api/audit-logs`, `/api/automation-manager/summary`, `/api/automation-runs`, `/api/automations`, `/api/automations/:id`, `/api/automations/:id/pause`, `/api/automations/:id/resume`, `/api/automations/:id/run`, `/api/automations/:id/runs`, `/api/calendar/events`, `/api/calendar/status`, `/api/calendar/sync`, `/api/calendar/zoho/sync`, `/api/canva/auth`, `/api/canva/oauth/callback`, `/api/canva/status`, `/api/ceo-dashboard`, `/api/ceo/commitments`, `/api/ceo/commitments/:id`, `/api/ceo/communication-drafts`, `/api/ceo/decisions`, `/api/ceo/decisions/:id`, `/api/ceo/follow-ups`, `/api/ceo/follow-ups/:id/complete`, `/api/ceo/meetings/:id/prep`, `/api/ceo/meetings/prep`, `/api/ceo/people`, `/api/ceo/people/:id`, `/api/clippers/bootstrap-accounts`, `/api/clippers/bootstrap-workspace`, `/api/clippers/import-credential-drop-files`, `/api/clippers/import-launch-evidence-drop-files`, `/api/clippers/import-source-drop-files`, `/api/clippers/ingest-metrics`, `/api/clippers/ingest-trends`, `/api/clippers/oauth/:platform/callback`, `/api/clippers/oauth/:platform/start`, `/api/clippers/prepare-account-creation-pack`, `/api/clippers/prepare-account-evidence-vault`, `/api/clippers/prepare-account-identity-kit`, `/api/clippers/prepare-account-launch-kit`, `/api/clippers/prepare-account-setup-session`, `/api/clippers/prepare-analytics-reporting-pack`, `/api/clippers/prepare-app-review-demo-pack`, `/api/clippers/prepare-app-review-submission-pack`, `/api/clippers/prepare-automation-schedule`, `/api/clippers/prepare-blocker-resolution-pack`, `/api/clippers/prepare-command-center`, `/api/clippers/prepare-credential-doctor`, `/api/clippers/prepare-credential-drop-starter`, `/api/clippers/prepare-credential-setup`, `/api/clippers/prepare-developer-app-evidence-vault`, `/api/clippers/prepare-developer-application-drafts`, `/api/clippers/prepare-draft-specs`, `/api/clippers/prepare-drive-workspace`, `/api/clippers/prepare-dropzone-ready-pack`, `/api/clippers/prepare-external-connect-sprint`, `/api/clippers/prepare-external-execution-handoff`, `/api/clippers/prepare-external-execution-session`, `/api/clippers/prepare-external-launch-dossier`, `/api/clippers/prepare-external-setup-queue`, `/api/clippers/prepare-go-live-autopilot-brief`, `/api/clippers/prepare-go-live-completion-audit`, `/api/clippers/prepare-go-live-evidence-bundle`, `/api/clippers/prepare-go-live-execution-pack`, `/api/clippers/prepare-go-live-operator-brief`, `/api/clippers/prepare-https-tunnel-plan`, `/api/clippers/prepare-intake-kit`, `/api/clippers/prepare-launch-evidence-fix-pack`, `/api/clippers/prepare-launch-lane-matrix`, `/api/clippers/prepare-legal-policy-pack`, `/api/clippers/prepare-manual-posting-pack`, `/api/clippers/prepare-oauth-connection-pack`, `/api/clippers/prepare-oauth-go-live`, `/api/clippers/prepare-official-permission-matrix`, `/api/clippers/prepare-official-permission-source-audit`, `/api/clippers/prepare-owner-connect-pack`, `/api/clippers/prepare-permission-request-pack`, `/api/clippers/prepare-permission-submission-dossier`, `/api/clippers/prepare-permission-tracker`, `/api/clippers/prepare-permissions`, `/api/clippers/prepare-platform-portal-checklist`, `/api/clippers/prepare-platform-readiness`, `/api/clippers/prepare-production-queue`, `/api/clippers/prepare-production-url-setup`, `/api/clippers/prepare-publisher-connectors`, `/api/clippers/prepare-publisher-execution-queue`, `/api/clippers/prepare-publishing-package`, `/api/clippers/prepare-rights-outreach`, `/api/clippers/prepare-robert-next-actions`, `/api/clippers/prepare-source-acquisition`, `/api/clippers/prepare-source-discovery-handoff`, `/api/clippers/prepare-source-hunt`, `/api/clippers/prepare-source-ingestion-sprint`, `/api/clippers/prepare-source-supply-drop-kit`, `/api/clippers/prepare-trend-rights-outreach`, `/api/clippers/prepare-viral-discovery`, `/api/clippers/preview-credential-secrets-batch`, `/api/clippers/preview-launch-evidence-batch`, `/api/clippers/record-account-evidence`, `/api/clippers/record-credential-secret`, `/api/clippers/record-credential-secrets-batch`, `/api/clippers/record-developer-app-evidence`, `/api/clippers/record-launch-evidence-batch`, `/api/clippers/record-owner-connect-progress`, `/api/clippers/record-permission-status`, `/api/clippers/record-production-public-url`, `/api/clippers/record-source-intake-batch`, `/api/clippers/record-source-rights`, `/api/clippers/record-trend-candidates-batch`, `/api/clippers/reload-credentials`, `/api/clippers/render-draft-videos`, `/api/clippers/reports/:id`, `/api/clippers/run-automation-cycle`, `/api/clippers/run-daily-plan`, `/api/clippers/run-external-connect-autopilot`, `/api/clippers/run-go-live-autopilot`, `/api/clippers/run-go-live-prep-sweep`, `/api/clippers/run-intake-refresh-sweep`, `/api/clippers/run-local-drop-sync`, `/api/clippers/run-post-connect-activation-sweep`, `/api/clippers/status`, `/api/clippers/verify-production-url`, `/api/code/apply`, `/api/code/files`, `/api/code/generate`, `/api/code/history`, `/api/code/query`, `/api/code/read`, `/api/code/schema`, `/api/code/structure`, `/api/code/table`, `/api/code/table/:name`, `/api/code/table/:name/column`, `/api/code/template/:id`, `/api/code/templates`, `/api/code/undo`, `/api/code/write`, `/api/cybersecurity-agent/import-missing-apps`, `/api/cybersecurity-agent/scan`, `/api/cybersecurity-agent/status`, `/api/developer-autopilot/handoff`, `/api/developer-autopilot/qa-gate`, `/api/developer-health/apps`, `/api/developer-health/apps/:id/overview`, `/api/developer-health/apps/:id/timeline`, `/api/developer-health/dashboard`, `/api/developer-health/incidents`, `/api/developer-health/incidents/:id`, `/api/developer-health/incidents/:id/investigate`, `/api/djs`, `/api/djs/:id`, `/api/djs/:id/message`, `/api/dropshipping-ceo`, `/api/dropshipping-ceo/approval-decisions`, `/api/dropshipping-ceo/approval-outbox-migration`, `/api/dropshipping-ceo/capital-plan`, `/api/dropshipping-ceo/execution-setup`, `/api/dropshipping-ceo/fulfillment`, `/api/dropshipping-ceo/growth-sprint`, `/api/dropshipping-ceo/launch-pack`, `/api/dropshipping-ceo/launch-pack-approval-preview`, `/api/dropshipping-ceo/launch-pack-approvals`, `/api/dropshipping-ceo/launch-plan`, `/api/dropshipping-ceo/launch-readiness`, `/api/dropshipping-ceo/learning-review`, `/api/dropshipping-ceo/ledger`, `/api/dropshipping-ceo/marketing-campaign`, `/api/dropshipping-ceo/operating-cycle`, `/api/dropshipping-ceo/order`, `/api/dropshipping-ceo/pending-approval`, `/api/dropshipping-ceo/product-research`, `/api/dropshipping-ceo/product-scout-batch`, `/api/dropshipping-ceo/product-scout-candidate`, `/api/dropshipping-ceo/product-scout-promote`, `/api/dropshipping-ceo/report-preview`, `/api/dropshipping-ceo/run-cycle`, `/api/dropshipping-ceo/send-report`, `/api/dropshipping-ceo/shopify-draft`, `/api/dropshipping-ceo/shopify-preflight`, `/api/dropshipping-ceo/social-analysis`, `/api/dropshipping-ceo/social-metrics`, `/api/dropshipping-ceo/social-post-batch`, `/api/dropshipping-ceo/social-publish`, `/api/dropshipping-ceo/supplier-review`, `/api/finance/history/:symbol`, `/api/finance/market`, `/api/finance/news`, `/api/finance/news/:symbol`, `/api/finance/news/market`, `/api/finance/price/:symbol`, `/api/finance/search`, `/api/github/repos`, `/api/github/repos/:owner/:repo/contents`, `/api/github/repos/:owner/:repo/file`, `/api/github/status`, `/api/google-drive/auth`, `/api/google-drive/oauth/callback`, `/api/google-drive/organize`, `/api/google-drive/status`, `/api/investments`, `/api/investments/:id`, `/api/legal-compliance/reports`, `/api/marketing-command-center`, `/api/marketing-command-center/run-day`, `/api/monthly-goals`, `/api/monthly-goals/:id`, `/api/monthly-goals/all`, `/api/pending-actions`, `/api/pending-actions/:id`, `/api/pending-actions/:id/approve`, `/api/pending-actions/:id/cancel`, `/api/pending-actions/:id/edit`, `/api/pending-actions/:id/events`, `/api/pending-actions/:id/execute`, `/api/pending-actions/:id/reject`, `/api/pending-actions/:id/snooze`, `/api/portfolio/gains/:period`, `/api/portfolio/history`, `/api/portfolio/margin`, `/api/portfolio/opportunities`, `/api/portfolio/rebalance`, `/api/portfolio/send-report`, `/api/portfolio/summary`, `/api/portfolio/test-notification`, `/api/portfolio/weekly-report`, `/api/price-alerts`, `/api/price-alerts/:id`, `/api/projects`, `/api/projects/:id`, `/api/projects/:id/check`, `/api/projects/:id/incidents`, `/api/projects/:id/logs`, `/api/projects/github-overview`, `/api/projects/import-github`, `/api/promo-video/auto-daily`, `/api/promo-video/generate`, `/api/promo-video/import-source`, `/api/promo-video/output/:filename`, `/api/promo-video/preview-options`, `/api/promo-video/source`, `/api/promo-video/status`, `/api/push/subscribe`, `/api/push/test`, `/api/push/test-evening`, `/api/push/test-insights`, `/api/push/test-morning`, `/api/push/test-news`, `/api/push/test-weekly`, `/api/push/unsubscribe`, `/api/push/vapid-key`, `/api/radio/analysis`, `/api/radio/import-djs`, `/api/radio/notify-slots`, `/api/radio/slots`, `/api/radio/templates/assets`, `/api/radio/templates/generate-today`, `/api/revenue-engine`, `/api/revenue-engine/agent-runs`, `/api/revenue-engine/approval-decisions`, `/api/revenue-engine/automation-agent-command`, `/api/revenue-engine/automation-intakes`, `/api/revenue-engine/automation-intakes/answer`, `/api/revenue-engine/automation-intakes/convert`, `/api/revenue-engine/automation-opportunities`, `/api/revenue-engine/automation-opportunities/close`, `/api/revenue-engine/automation-opportunities/delivery-workspace`, `/api/revenue-engine/automation-quote`, `/api/revenue-engine/delivery-review`, `/api/revenue-engine/delivery-workspaces`, `/api/revenue-engine/delivery-workspaces/deliver`, `/api/revenue-engine/delivery-workspaces/improvement-review`, `/api/revenue-engine/delivery-workspaces/qa`, `/api/revenue-engine/expense-preflight`, `/api/revenue-engine/improvement-review`, `/api/revenue-engine/launch-readiness`, `/api/revenue-engine/lead-radar`, `/api/revenue-engine/leads`, `/api/revenue-engine/ledger`, `/api/revenue-engine/mockup`, `/api/revenue-engine/mockup-template-pack`, `/api/revenue-engine/outreach-drafts`, `/api/revenue-engine/outreach-send`, `/api/revenue-engine/plan`, `/api/revenue-engine/project-plan`, `/api/revenue-engine/proposal-email`, `/api/revenue-engine/sales-autopilot`, `/api/revenue-engine/scouting-mission`, `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`, `/api/tasks`, `/api/tasks/:id`, `/api/tasks/by-title/:title`, `/api/tasks/deduplicate`, `/api/transactions`, `/api/watchlist`, `/api/watchlist/:id`, `/api/weekly-summaries`, `/api/weekly-summaries/:id`, `/api/weekly-summaries/:weekStart`, `/api/weekly-tasks`, `/api/weekly-tasks/:id`, `/api/yearly-goals`, `/api/yearly-goals/:id`, `/api/zoho/auth`, `/api/zoho/callback`, `/clippers/external-portal-launcher`, `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`
- `server/shopify-routes.ts`: `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`
- `server/telegram-routes.ts`: `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/go-live/evidence`, `/api/ceo/readiness`, `/api/telegram/configure`, `/api/telegram/disconnect`, `/api/telegram/health`, `/api/telegram/setup-webhook`, `/api/telegram/status`, `/api/telegram/test`, `/api/telegram/test-ceo-brief`, `/api/telegram/toggle`, `/api/telegram/webhook`, `/api/telegram/webhook-status`

## Test Inventory
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
- `tests/code-agent-security.test.ts`
- `tests/cybersecurity-agent.test.ts`
- `tests/db-config.test.ts`
- `tests/developer-autopilot-wiring.test.ts`
- `tests/developer-autopilot.test.ts`
- `tests/dropshipping-ceo.test.ts`
- `tests/env-loader-core.test.ts`
- `tests/github-client-security.test.ts`
- `tests/google-drive-folder-command.test.ts`
- `tests/google-drive-oauth.test.ts`
- `tests/legal-compliance-agent.test.ts`
- `tests/local-auth-cli.test.ts`
- `tests/local-auth.test.ts`
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
- `client/src/pages/assistant.tsx` (client-page; 47 symbols, 7 imports)
- `client/src/pages/auth.tsx` (client-page; 44 symbols, 8 imports)
- `client/src/pages/automation-manager.tsx` (client-page; 13 symbols, 8 imports)
- `client/src/pages/ceo-dashboard.tsx` (client-page; 40 symbols, 10 imports)
- `client/src/pages/code-agent.tsx` (client-page; 21 symbols, 7 imports)
- `client/src/pages/cybersecurity-agent.tsx` (client-page; 11 symbols, 8 imports)
- `client/src/pages/dashboard.tsx` (client-page; 25 symbols, 25 imports)
- `client/src/pages/dropshipping-ceo.tsx` (client-page; 70 symbols, 13 imports)
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
- `script/build.ts` (script; 5 symbols, 3 imports)
- `script/ceo-db-check.ts` (script; 8 symbols, 3 imports)
- `script/ceo-doctor.ts` (script; 3 symbols, 1 imports)
- `script/ceo-go-live.ts` (script; 9 symbols, 2 imports)
- `script/ceo-handoff.mjs` (script; 1 imports)
- `script/ceo-readiness.ts` (script; 10 symbols, 8 imports)
- `script/ceo-restore.ts` (script; 9 symbols, 4 imports)
- `script/ceo-smoke.ts` (script; 29 symbols, 15 imports)
- `script/ceo-verify-local.mjs` (script; 2 symbols, 1 imports)
- `script/clippers-tiktok-preflight.ts` (script; 15 symbols, 1 imports)
- `script/codebase-map.ts` (script; 43 symbols, 3 imports)
- `script/configure-telegram.ts` (script; 5 symbols, 4 imports)
- `script/create-ceo-go-live-task.ts` (script; 13 symbols, 3 imports)
- `script/create-local-user.ts` (script; 5 symbols, 3 imports)
- `script/ensure-radio-tiktok-drive-folder.ts` (script; 4 symbols, 3 imports)
- `script/metricool-plan.ts` (script; 3 symbols, 1 imports)
- `script/migrate-user.ts` (script; 16 symbols, 4 imports)
- `script/radio-video-edits.ts` (script; 12 symbols, 5 imports)
- `script/send-ceo-brief.ts` (script; 4 symbols, 2 imports)
- `script/telegram-webhook.ts` (script; 6 symbols, 3 imports)
- `script/upload-radio-edits-to-drive.ts` (script; 16 symbols, 5 imports)
- `server/agent-actions.ts` (server; 42 symbols, 9 imports)
- `server/app-qa-agent.ts` (server; 131 symbols, 9 imports)
- `server/assistant.ts` (server; 212 symbols, 18 imports, 3 routes)
- `server/automation-registry.ts` (server; 20 symbols, 3 imports)
- `server/blackroom-links.ts` (server; 68 symbols, 1 imports)
- `server/calendar-sync.ts` (server; 10 symbols, 2 imports)
- `server/canva-oauth.ts` (server; 38 symbols, 4 imports)
- `server/ceo-brief-cli.ts` (server; 6 symbols, 1 imports)
- `server/ceo-brief-format.ts` (server; 44 symbols)
- `server/ceo-briefing.ts` (server; 14 symbols, 6 imports)
- `server/ceo-conversation-history.ts` (server; 10 symbols, 2 imports)
- `server/ceo-conversation-title.ts` (server; 4 symbols)
- `server/ceo-db-check-cli.ts` (server; 8 symbols)
- `server/ceo-doctor-cli.ts` (server; 27 symbols)
- `server/ceo-go-live-cli.ts` (server; 37 symbols, 1 imports)
- `server/ceo-operational-health.ts` (server; 15 symbols, 1 imports)
- `server/ceo-readiness-cli.ts` (server; 7 symbols, 1 imports)
- `server/ceo-readiness.ts` (server; 4 symbols)
- `server/ceo-smoke-cli.ts` (server; 16 symbols, 5 imports)
- `server/cli-validation.ts` (server; 1 symbols, 1 imports)
- `server/code-agent.ts` (server; 50 symbols, 4 imports)
- `server/code-generator.ts` (server; 47 symbols, 4 imports)
- `server/cybersecurity-agent.ts` (server; 60 symbols, 5 imports)
- `server/database-url.ts` (server; 1 symbols, 1 imports)
- `server/db.ts` (server; 2 symbols, 3 imports)
- `server/developer-autopilot.ts` (server; 57 symbols, 4 imports)
- `server/dropshipping-ceo.ts` (server; 498 symbols, 5 imports)
- `server/env-loader-core.ts` (server; 17 symbols, 2 imports)
- `server/env-loader.ts` (server; 1 imports)
- `server/finance.ts` (server; 57 symbols, 1 imports)
- `server/gemini-client.ts` (server; 2 symbols, 2 imports)
- `server/github-client.ts` (server; 40 symbols, 1 imports)
- `server/google-calendar.ts` (server; 26 symbols, 1 imports)
- `server/google-drive-folder-command.ts` (server; 28 symbols, 2 imports)
- `server/google-drive-oauth.ts` (server; 44 symbols, 6 imports)
- `server/google-drive.ts` (server; 40 symbols, 8 imports)
- `server/health-check.ts` (server; 28 symbols, 5 imports)

## How Agents Should Use This
1. Read this map before broad repo exploration.
2. Pick the smallest set of files likely to answer the task.
3. Read source files directly before editing or making strong claims.
4. Regenerate with `npm run codebase:map` after major file moves, new pages, routes, tests, or server modules.
5. Do not paste `docs/codebase-map.json` into prompts; use it for local scripts or targeted lookups only.

