# Codebase Map

Generated: 2026-06-30T16:06:33.819Z
Repo: `/private/tmp/asistente-pr55-fresh`
Package: `rest-express`

## Guardrails
- Generated locally from Git-visible files only: tracked files plus untracked files that are not ignored.
- Skips credentials/, secrets/, .env files, node_modules/, build outputs, media folders, and large data exports.
- Does not index SQL files or filenames that look like dumps, backups, credentials, secrets, or tokens.
- Use this map to narrow exploration; verify behavior in source files before editing.

## Totals
| Git-visible files | Indexed files | Imports | Routes | Symbols |
| ---: | ---: | ---: | ---: | ---: |
| 400 | 333 | 1318 | 449 | 7097 |

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
| `client/src` | 109 | 107 | ui-component:55, client-page:22, client-component:21, client-lib:5 |
| `server` | 94 | 90 | server:94 |
| `tests` | 59 | 57 | test:59 |
| `script` | 36 | 34 | script:36 |
| `.` | 24 | 17 | other:15, docs:8, package:1 |
| `docs` | 11 | 11 | docs:11 |
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
- `server/index.ts`: `/api/health`, `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`, `/dropshipping/legal/checkout-readiness`, `/dropshipping/legal/privacy`, `/dropshipping/legal/refund-policy`, `/dropshipping/legal/shipping-policy`, `/dropshipping/legal/terms`, `/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`, `/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt`
- `server/local-auth.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/register`
- `server/replit_integrations/chat/routes.ts`: `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`
- `server/replit_integrations/image/routes.ts`: `/api/generate-image`
- `server/routes.ts`: `/api/agent/actions`, `/api/agent/actions/:category`, `/api/agent/execute-batch`, `/api/agent/execute/:actionId`, `/api/agent/history`, `/api/ai-spend/monthly`, `/api/app-qa-agent/history`, `/api/app-qa-agent/scan`, `/api/app-qa-agent/status`, `/api/approval-history`, `/api/assistant/permissions`, `/api/assistant/permissions/:scope`, `/api/audit-logs`, `/api/automation-manager/summary`, `/api/automation-runs`, `/api/automations`, `/api/automations/:id`, `/api/automations/:id/pause`, `/api/automations/:id/resume`, `/api/automations/:id/run`, `/api/automations/:id/runs`, `/api/calendar/events`, `/api/calendar/status`, `/api/calendar/sync`, `/api/calendar/zoho/sync`, `/api/canva/auth`, `/api/canva/oauth/callback`, `/api/canva/status`, `/api/ceo-dashboard`, `/api/ceo/commitments`, `/api/ceo/commitments/:id`, `/api/ceo/communication-drafts`, `/api/ceo/decisions`, `/api/ceo/decisions/:id`, `/api/ceo/follow-ups`, `/api/ceo/follow-ups/:id/complete`, `/api/ceo/meetings/:id/prep`, `/api/ceo/meetings/prep`, `/api/ceo/people`, `/api/ceo/people/:id`, `/api/clippers/account-permission-readiness`, `/api/clippers/apply-external-closeout-evidence-import`, `/api/clippers/apply-ready-external-closeout-evidence-import`, `/api/clippers/bootstrap-accounts`, `/api/clippers/bootstrap-workspace`, `/api/clippers/external-closeout-evidence-import`, `/api/clippers/external-closeout-next-action`, `/api/clippers/external-closeout-operator-queue`, `/api/clippers/external-closeout-pack`, `/api/clippers/external-closeout-proof-todo`, `/api/clippers/external-closeout-repair-work-packet`, `/api/clippers/external-next-work-run`, `/api/clippers/import-credential-drop-files`, `/api/clippers/import-launch-evidence-drop-files`, `/api/clippers/import-metricool-approval-evidence`, `/api/clippers/import-source-drop-files`, `/api/clippers/ingest-metrics`, `/api/clippers/ingest-trends`, `/api/clippers/oauth/:platform/callback`, `/api/clippers/oauth/:platform/start`, `/api/clippers/operational-readiness`, `/api/clippers/prepare-100-clips-execution-sprint`, `/api/clippers/prepare-account-creation-pack`, `/api/clippers/prepare-account-evidence-vault`, `/api/clippers/prepare-account-identity-kit`, `/api/clippers/prepare-account-launch-kit`, `/api/clippers/prepare-account-permission-readiness`, `/api/clippers/prepare-account-setup-session`, `/api/clippers/prepare-analytics-reporting-pack`, `/api/clippers/prepare-app-review-demo-pack`, `/api/clippers/prepare-app-review-submission-pack`, `/api/clippers/prepare-automation-schedule`, `/api/clippers/prepare-blocker-resolution-pack`, `/api/clippers/prepare-command-center`, `/api/clippers/prepare-credential-doctor`, `/api/clippers/prepare-credential-drop-starter`, `/api/clippers/prepare-credential-setup`, `/api/clippers/prepare-developer-app-evidence-vault`, `/api/clippers/prepare-developer-application-drafts`, `/api/clippers/prepare-draft-specs`, `/api/clippers/prepare-drive-workspace`, `/api/clippers/prepare-dropzone-ready-pack`, `/api/clippers/prepare-external-account-permission-sprint`, `/api/clippers/prepare-external-closeout-pack`, `/api/clippers/prepare-external-connect-sprint`, `/api/clippers/prepare-external-execution-handoff`, `/api/clippers/prepare-external-execution-session`, `/api/clippers/prepare-external-launch-dossier`, `/api/clippers/prepare-external-next-work-run`, `/api/clippers/prepare-external-setup-queue`, `/api/clippers/prepare-go-live-autopilot-brief`, `/api/clippers/prepare-go-live-completion-audit`, `/api/clippers/prepare-go-live-evidence-bundle`, `/api/clippers/prepare-go-live-execution-pack`, `/api/clippers/prepare-go-live-operator-brief`, `/api/clippers/prepare-https-tunnel-plan`, `/api/clippers/prepare-intake-kit`, `/api/clippers/prepare-launch-evidence-fix-pack`, `/api/clippers/prepare-launch-lane-matrix`, `/api/clippers/prepare-legal-policy-pack`, `/api/clippers/prepare-manual-posting-pack`, `/api/clippers/prepare-metricool-approval-report`, `/api/clippers/prepare-metricool-approval-session`, `/api/clippers/prepare-metricool-execution-queue`, `/api/clippers/prepare-metricool-mvp-launch-pack`, `/api/clippers/prepare-metricool-publishing-plan`, `/api/clippers/prepare-oauth-connection-pack`, `/api/clippers/prepare-oauth-go-live`, `/api/clippers/prepare-official-permission-matrix`, `/api/clippers/prepare-official-permission-source-audit`, `/api/clippers/prepare-operational-readiness`, `/api/clippers/prepare-owner-connect-pack`, `/api/clippers/prepare-permission-request-pack`, `/api/clippers/prepare-permission-submission-dossier`, `/api/clippers/prepare-permission-tracker`, `/api/clippers/prepare-permissions`, `/api/clippers/prepare-platform-portal-checklist`, `/api/clippers/prepare-platform-readiness`, `/api/clippers/prepare-production-queue`, `/api/clippers/prepare-production-url-setup`, `/api/clippers/prepare-publisher-connectors`, `/api/clippers/prepare-publisher-execution-queue`, `/api/clippers/prepare-publishing-package`, `/api/clippers/prepare-rights-evidence-ledger`, `/api/clippers/prepare-rights-outreach`, `/api/clippers/prepare-robert-next-actions`, `/api/clippers/prepare-source-acquisition`, `/api/clippers/prepare-source-discovery-handoff`, `/api/clippers/prepare-source-hunt`, `/api/clippers/prepare-source-ingestion-sprint`, `/api/clippers/prepare-source-scout`, `/api/clippers/prepare-source-scout-daily-sprint`, `/api/clippers/prepare-source-scout-exact-url-kit`, `/api/clippers/prepare-source-scout-permission-pack`, `/api/clippers/prepare-source-scout-source-file-kit`, `/api/clippers/prepare-source-scout-work-queue`, `/api/clippers/prepare-source-supply-drop-kit`, `/api/clippers/prepare-trend-rights-outreach`, `/api/clippers/prepare-viral-discovery`, `/api/clippers/prepare-weekly-production-funnel`, `/api/clippers/preview-credential-secrets-batch`, `/api/clippers/preview-external-closeout-evidence-import`, `/api/clippers/preview-launch-evidence-batch`, `/api/clippers/record-account-evidence`, `/api/clippers/record-credential-secret`, `/api/clippers/record-credential-secrets-batch`, `/api/clippers/record-developer-app-evidence`, `/api/clippers/record-launch-evidence-batch`, `/api/clippers/record-metricool-account-evidence`, `/api/clippers/record-owner-connect-progress`, `/api/clippers/record-permission-status`, `/api/clippers/record-production-public-url`, `/api/clippers/record-source-intake-batch`, `/api/clippers/record-source-rights`, `/api/clippers/record-source-scout-intake`, `/api/clippers/record-trend-candidates-batch`, `/api/clippers/reload-credentials`, `/api/clippers/render-draft-videos`, `/api/clippers/reports/:id`, `/api/clippers/run-automation-cycle`, `/api/clippers/run-daily-plan`, `/api/clippers/run-external-connect-autopilot`, `/api/clippers/run-go-live-autopilot`, `/api/clippers/run-go-live-prep-sweep`, `/api/clippers/run-intake-refresh-sweep`, `/api/clippers/run-local-drop-sync`, `/api/clippers/run-post-connect-activation-sweep`, `/api/clippers/status`, `/api/clippers/verify-production-local-preflight`, `/api/clippers/verify-production-url`, `/api/code/apply`, `/api/code/files`, `/api/code/generate`, `/api/code/history`, `/api/code/query`, `/api/code/read`, `/api/code/schema`, `/api/code/structure`, `/api/code/table`, `/api/code/table/:name`, `/api/code/table/:name/column`, `/api/code/template/:id`, `/api/code/templates`, `/api/code/undo`, `/api/code/write`, `/api/cybersecurity-agent/import-missing-apps`, `/api/cybersecurity-agent/scan`, `/api/cybersecurity-agent/status`, `/api/developer-autopilot/handoff`, `/api/developer-autopilot/qa-gate`, `/api/developer-health/apps`, `/api/developer-health/apps/:id/overview`, `/api/developer-health/apps/:id/timeline`, `/api/developer-health/dashboard`, `/api/developer-health/incidents`, `/api/developer-health/incidents/:id`, `/api/developer-health/incidents/:id/investigate`, `/api/djs`, `/api/djs/:id`, `/api/djs/:id/message`, `/api/dropshipping-ceo`, `/api/dropshipping-ceo/approval-decisions`, `/api/dropshipping-ceo/approval-outbox-migration`, `/api/dropshipping-ceo/autopilot-product-hunter`, `/api/dropshipping-ceo/capital-plan`, `/api/dropshipping-ceo/execution-setup`, `/api/dropshipping-ceo/fulfillment`, `/api/dropshipping-ceo/growth-sprint`, `/api/dropshipping-ceo/launch-pack`, `/api/dropshipping-ceo/launch-pack-approval-preview`, `/api/dropshipping-ceo/launch-pack-approvals`, `/api/dropshipping-ceo/launch-plan`, `/api/dropshipping-ceo/launch-readiness`, `/api/dropshipping-ceo/learning-review`, `/api/dropshipping-ceo/ledger`, `/api/dropshipping-ceo/marketing-campaign`, `/api/dropshipping-ceo/operating-cycle`, `/api/dropshipping-ceo/order`, `/api/dropshipping-ceo/pending-approval`, `/api/dropshipping-ceo/product-research`, `/api/dropshipping-ceo/product-scout-batch`, `/api/dropshipping-ceo/product-scout-candidate`, `/api/dropshipping-ceo/product-scout-promote`, `/api/dropshipping-ceo/report-preview`, `/api/dropshipping-ceo/run-cycle`, `/api/dropshipping-ceo/send-report`, `/api/dropshipping-ceo/shopify-draft`, `/api/dropshipping-ceo/shopify-preflight`, `/api/dropshipping-ceo/social-analysis`, `/api/dropshipping-ceo/social-metrics`, `/api/dropshipping-ceo/social-post-batch`, `/api/dropshipping-ceo/social-publish`, `/api/dropshipping-ceo/supplier-review`, `/api/finance/history/:symbol`, `/api/finance/market`, `/api/finance/news`, `/api/finance/news/:symbol`, `/api/finance/news/market`, `/api/finance/price/:symbol`, `/api/finance/search`, `/api/github/repos`, `/api/github/repos/:owner/:repo/contents`, `/api/github/repos/:owner/:repo/file`, `/api/github/status`, `/api/google-drive/auth`, `/api/google-drive/oauth/callback`, `/api/google-drive/organize`, `/api/google-drive/status`, `/api/investments`, `/api/investments/:id`, `/api/legal-compliance/reports`, `/api/marketing-command-center`, `/api/marketing-command-center/run-day`, `/api/monthly-goals`, `/api/monthly-goals/:id`, `/api/monthly-goals/all`, `/api/pending-actions`, `/api/pending-actions/:id`, `/api/pending-actions/:id/approve`, `/api/pending-actions/:id/cancel`, `/api/pending-actions/:id/edit`, `/api/pending-actions/:id/events`, `/api/pending-actions/:id/execute`, `/api/pending-actions/:id/reject`, `/api/pending-actions/:id/snooze`, `/api/portfolio/gains/:period`, `/api/portfolio/history`, `/api/portfolio/margin`, `/api/portfolio/opportunities`, `/api/portfolio/rebalance`, `/api/portfolio/send-report`, `/api/portfolio/summary`, `/api/portfolio/test-notification`, `/api/portfolio/weekly-report`, `/api/price-alerts`, `/api/price-alerts/:id`, `/api/projects`, `/api/projects/:id`, `/api/projects/:id/check`, `/api/projects/:id/incidents`, `/api/projects/:id/logs`, `/api/projects/github-overview`, `/api/projects/import-github`, `/api/promo-video/auto-daily`, `/api/promo-video/generate`, `/api/promo-video/import-source`, `/api/promo-video/output/:filename`, `/api/promo-video/preview-options`, `/api/promo-video/source`, `/api/promo-video/status`, `/api/push/subscribe`, `/api/push/test`, `/api/push/test-evening`, `/api/push/test-insights`, `/api/push/test-morning`, `/api/push/test-news`, `/api/push/test-weekly`, `/api/push/unsubscribe`, `/api/push/vapid-key`, `/api/radio/analysis`, `/api/radio/import-djs`, `/api/radio/notify-slots`, `/api/radio/slots`, `/api/radio/templates/assets`, `/api/radio/templates/generate-today`, `/api/revenue-engine`, `/api/revenue-engine/agent-runs`, `/api/revenue-engine/approval-decisions`, `/api/revenue-engine/automation-agent-command`, `/api/revenue-engine/automation-intakes`, `/api/revenue-engine/automation-intakes/answer`, `/api/revenue-engine/automation-intakes/convert`, `/api/revenue-engine/automation-opportunities`, `/api/revenue-engine/automation-opportunities/close`, `/api/revenue-engine/automation-opportunities/delivery-workspace`, `/api/revenue-engine/automation-quote`, `/api/revenue-engine/daily-scout-sprint`, `/api/revenue-engine/daily-scout-sprint/submit`, `/api/revenue-engine/delivery-review`, `/api/revenue-engine/delivery-workspaces`, `/api/revenue-engine/delivery-workspaces/deliver`, `/api/revenue-engine/delivery-workspaces/github-handoff`, `/api/revenue-engine/delivery-workspaces/improvement-review`, `/api/revenue-engine/delivery-workspaces/qa`, `/api/revenue-engine/delivery-workspaces/release-gate`, `/api/revenue-engine/delivery-workspaces/trusted-deliver`, `/api/revenue-engine/expense-preflight`, `/api/revenue-engine/improvement-review`, `/api/revenue-engine/launch-readiness`, `/api/revenue-engine/lead-radar`, `/api/revenue-engine/leads`, `/api/revenue-engine/ledger`, `/api/revenue-engine/mockup`, `/api/revenue-engine/mockup-template-pack`, `/api/revenue-engine/money-sprint`, `/api/revenue-engine/money-sprint-preview`, `/api/revenue-engine/money-sprint/public-candidates`, `/api/revenue-engine/outreach-drafts`, `/api/revenue-engine/outreach-drafts/approve`, `/api/revenue-engine/outreach-outcome`, `/api/revenue-engine/outreach-send`, `/api/revenue-engine/plan`, `/api/revenue-engine/project-plan`, `/api/revenue-engine/proposal-email`, `/api/revenue-engine/public-lead-candidates`, `/api/revenue-engine/public-lead-candidates/approve`, `/api/revenue-engine/public-lead-candidates/batch`, `/api/revenue-engine/public-scout-agent-command`, `/api/revenue-engine/public-scout-evidence`, `/api/revenue-engine/sales-autopilot`, `/api/revenue-engine/scouting-mission`, `/api/revenue-engine/website-delivery-workspace`, `/api/revenue-engine/website-opportunities`, `/api/revenue-engine/website-opportunities/close`, `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`, `/api/tasks`, `/api/tasks/:id`, `/api/tasks/by-title/:title`, `/api/tasks/deduplicate`, `/api/transactions`, `/api/watchlist`, `/api/watchlist/:id`, `/api/weekly-summaries`, `/api/weekly-summaries/:id`, `/api/weekly-summaries/:weekStart`, `/api/weekly-tasks`, `/api/weekly-tasks/:id`, `/api/yearly-goals`, `/api/yearly-goals/:id`, `/api/zoho/auth`, `/api/zoho/callback`, `/clippers/external-portal-launcher`, `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`
- `server/shopify-routes.ts`: `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`
- `server/telegram-routes.ts`: `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/go-live/evidence`, `/api/ceo/readiness`, `/api/telegram/configure`, `/api/telegram/disconnect`, `/api/telegram/health`, `/api/telegram/setup-webhook`, `/api/telegram/status`, `/api/telegram/test`, `/api/telegram/test-ceo-brief`, `/api/telegram/toggle`, `/api/telegram/webhook`, `/api/telegram/webhook-status`
- `tests/clippers-owned-source-scripts.test.ts`: `/api/clippers/external-closeout-next-action`, `/api/clippers/external-closeout-operator-queue`, `/api/clippers/external-closeout-pack`, `/api/clippers/external-closeout-proof-todo`, `/api/clippers/external-closeout-repair-work-packet`, `/api/clippers/operational-readiness`, `/api/clippers/prepare-external-closeout-pack`, `/api/clippers/prepare-operational-readiness`, `/api/clippers/run-intake-refresh-sweep`, `/api/clippers/run-post-connect-activation-sweep`

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
- `tests/revenue-engine-delivery-qa.test.ts`
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
- `script/clippers-account-permission-readiness.mjs` (script; 82 symbols, 2 imports)
- `script/clippers-external-closeout-pack.mjs` (script; 249 symbols, 3 imports)
- `script/clippers-generate-owned-gap-sources.mjs` (script; 30 symbols, 3 imports)
- `script/clippers-generate-owned-meme-sources.ts` (script; 23 symbols, 3 imports)
- `script/clippers-generate-owned-sports-streamer-sources.ts` (script; 26 symbols, 3 imports)
- `script/clippers-generate-owned-weekly-backlog-sources.ts` (script; 34 symbols, 3 imports)
- `script/clippers-import-external-closeout-evidence.ts` (script; 117 symbols, 3 imports)
- `script/clippers-operational-readiness.mjs` (script; 51 symbols, 4 imports)
- `script/clippers-record-owned-meme-rights.ts` (script; 10 symbols, 1 imports)
- `script/clippers-record-owned-source-rights.mjs` (script; 88 symbols, 3 imports)
- `script/clippers-sync-metricool-source-readiness.mjs` (script; 28 symbols, 3 imports)
- `script/clippers-tiktok-preflight.ts` (script; 15 symbols, 1 imports)
- `script/codebase-map.ts` (script; 43 symbols, 3 imports)
- `script/configure-telegram.ts` (script; 5 symbols, 4 imports)
- `script/create-ceo-go-live-task.ts` (script; 13 symbols, 3 imports)
- `script/create-local-user.ts` (script; 5 symbols, 3 imports)
- `script/ensure-radio-tiktok-drive-folder.ts` (script; 4 symbols, 3 imports)
- `script/import-developer-health-inventory.ts` (script; 14 symbols, 4 imports)
- `script/metricool-plan.ts` (script; 3 symbols, 1 imports)
- `script/migrate-user.ts` (script; 16 symbols, 4 imports)
- `script/radio-local-youtube-worker.ts` (script; 25 symbols, 9 imports)
- `script/radio-video-edits.ts` (script; 12 symbols, 5 imports)
- `script/send-ceo-brief.ts` (script; 4 symbols, 2 imports)
- `script/telegram-webhook.ts` (script; 6 symbols, 3 imports)
- `script/upload-radio-edits-to-drive.ts` (script; 16 symbols, 5 imports)
- `scripts/create-dropshipping-tutorial.mjs` (script; 33 symbols, 3 imports)
- `server/agent-actions.ts` (server; 42 symbols, 9 imports)
- `server/ai-cost-notifications.ts` (server; 26 symbols)
- `server/ai-cost-policy.ts` (server; 35 symbols)
- `server/ai-router.ts` (server; 13 symbols)
- `server/app-qa-agent.ts` (server; 167 symbols, 11 imports)
- `server/assistant.ts` (server; 280 symbols, 24 imports, 3 routes)
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
- `server/claude-skill-bridge.ts` (server; 35 symbols, 2 imports)
- `server/cli-validation.ts` (server; 1 symbols, 1 imports)

## How Agents Should Use This
1. Read this map before broad repo exploration.
2. Pick the smallest set of files likely to answer the task.
3. Read source files directly before editing or making strong claims.
4. Regenerate with `npm run codebase:map` after major file moves, new pages, routes, tests, or server modules.
5. Do not paste `docs/codebase-map.json` into prompts; use it for local scripts or targeted lookups only.

