# BlackRoom verified learning cycle

Status: implementation in progress; not deployed or verified live.

## Required completion evidence

- Fresh automatic analytics acquisition for TikTok, Facebook and YouTube, without a paid AI API. A parser watching Downloads is not automatic acquisition. Record source observation time separately from planner execution time. Stale/missing sources must be visible and must not drive changes.
- Exact, network-scoped publication identity joined to reservation, DJ, source segment, duration, orientation, language, hook, strategy, and scheduled/actual publication times. Ambiguous records remain unattributed.
- Durable actual observations near 24h, 72h, and 7d. Never label a current cumulative total a historical snapshot. Older posts without snapshots remain descriptive history.
- Network-isolated comparisons at the same age and with comparable treatment cohorts. Missing metrics are not zero. Require multiple independent clips and hold all but one experimental dimension constant.
- Five daily publications per network initially. No automatic volume increase to compensate for poor results. Audio validation, unique segments, and YouTube Shorts eligibility remain mandatory.
- Evidence-backed winner/loser allocation for future preparation, with reason, sample size, freshness, experiment identity and an audit trail. Two weeks of source/preparation inventory must not lock two weeks of unvalidated creative strategy.
- Dashboard displays source freshness, collection failures, attribution coverage, actual snapshot coverage, experiment results and actions. It must not say learning solely because a refresh ran.
- Regression tests, independent checker, App QA route/API/click/error/improvement checks, PR, approval, deployment, local worker verification and live end-to-end fresh import to decision verification.

## Verified initial gaps (2026-09-28)

Runtime CSV imports last changed July 31 and contain July exports. The planner refresh timestamp advances while using the same 163 imported records. Exact attribution is zero in all three networks; only 16 fallback matches exist. Current 24h/72h coverage measures post age, not point-in-time observations; no 7d observations are retained. No runtime evidence supports fresh September creative adaptation.

## Safety and rollout

Preserve existing uncommitted work in the primary checkout. Implement on an isolated PR branch. No production deployment before Robert reviews the PR/QA summary and approves. No paid model API, ad spend, credential edits, duplicate publication or deletion of user media as part of this change. Do not disable authentication to make import automation work.

## Implementation checkpoint

- Authoritative implementation is now branch `codex/blackroom-verified-learning` in `/private/tmp/blackroom-learning-20260928`, cloned from main `62ca26b5a8f17b03692c9c64b03ef2b4c8087f81`. The earlier Documents worktree is not authoritative; it encountered iCloud/ECANCELED failures.
- Added pure `server/blackroom-learning-observations.ts`: network-scoped actual source observations, fixed 24/72/168-hour windows (six-hour acquisition tolerance), immutable earliest snapshots and explicit freshness health.
- Added import-state snapshot persistence and source-time replay protection in `server/blackroom-remote-control.ts`. Null/empty optional metrics no longer become zero.
- Full BlackRoom regression: 218 tests passed, with local loopback server permission. Generated panel-script syntax test added and passed separately. Typecheck passed before the latest panel additions; rerun at release gate.
- Added dedicated WebKit acquisition, source-time plumbing, exact reference-to-platform joins, controlled hook comparison within DJ/set/daypart, and initial evidence panel. These are not yet deployed or live-validated. The dedicated login process remains open awaiting the user's login; do not equate that with authenticated export readiness.
- Independent checker identified source-set confounding. Comparison blocks now include sourceVideoId and a regression rejects separated source sets. Recheck requested. Different non-overlapping cuts remain a limitation, explicitly shown in provisional winner reasons.
- Remaining: live acquisition verification, complete per-network adaptive application beyond the initial shared hook experiment, decision/application audit trail, full collector-error and coverage UI, flexible preparation scheduling, complete App QA/review, PR and human approval, deployment, local-worker and end-to-end verification. Passing isolated tests does not satisfy the full goal.

## Live acquisition evidence (September 28)

- Owner-authorized dedicated browser exported 78 TikTok, 90 Facebook and 64 YouTube records at 20:50 UTC, with no collection errors.
- A separate non-login invocation reopened the persistent browser and exported the same three networks at 21:40 UTC without user interaction. No credential extraction or copying was used.
- In-memory import of the real export accepted all 232 records with publication and observation timestamps and captured six eligible age snapshots. This is local verification, not proof of production delivery or creative improvement.
- Current regression: 225 BlackRoom tests pass; TypeScript check passes. Production deployment and end-to-end decision application remain pending.
