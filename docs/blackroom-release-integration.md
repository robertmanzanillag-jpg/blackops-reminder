# BlackRoom integration candidate — 2026-11-04

This branch integrates existing PR ancestry without duplicating patches:

- Base main:42dd770.
- PR305 downloader fallback:591f20d.
- PR308 local duration evidence/editor integration:8a34e76 (includes its existing upstream commits).
- PR309 daily public metadata scout:7467b7d.
- PR311 exact manual publication reconciliation:b593889.
- PR314 bounded observational next-clip trials:9846b64.

All five GitHub heads were verified before integration. PR314 contains PR311 and PR308; merge it once, then merge PR305 and PR309. No default-branch merge, deployment or agent restart is performed by this integration.

## Required runtime boundary

The website/Replit process is not the Mac editing worker. The deterministic editor reads BLACKROOM_YTDLP_PATH or defaults to /opt/homebrew/bin/yt-dlp; its supervisor, browser-backed exporter and local evidence files must be updated on the Mac separately after approval. A successful Replit build does not prove the Mac is running the new code, authenticated calendar reads work, or metrics are flowing. It also does not provide24/7 processing while the Mac is off. Previously accepted Metricool posts are a separate publication service.

The generic build optionally installs a Python yt-dlp bundle under dist/yt-dlp-python. That path is used by the generic radio-video downloader fallback, not the Mac editor binary path. If Python cannot import pip/expat or package download fails, the existing build prints a warning and continues. Do not hide this warning or equate exit0 with working cloud downloads. Record the actual outcome in the PR; live download verification remains a release gate.

## Verification and release

Maker checks on the combined tree:

- All BlackRoom and organic-peer test files:259/259PASS with repository-standard tsx runner.
- Exact AppQA scope (organic-peer hypotheses/scout, BlackRoom links/remote-control/remote-sync, AppQA agent):70/70PASS.
- Additional AppQA/developer-autopilot/wiring/health-inventory scope:69/69PASS (overlaps the scope above; not an additional unique-test total).
- TypeScript check:PASS. Build:exit0, with the optional Python downloader warning below.
- Initial native-strip runner had unsupported @shared aliases and denied localhost test-server access; standard tsx plus approved temporary localhost permission passed. No production code workaround was made.

Observed build warning: `optional yt-dlp bundle unavailable: python3 cannot import pip/xml.parsers.expat in this environment. python3 exited with1`. The build also noted no local Replit deployment domain for meta-tag injection. These are reported, not hidden. A warning-free production gate is not claimed.

Run repository-standard tsx tests (native stripping cannot resolve all @shared aliases), full TypeScript check and build. Local test-server permission is required by the scheduler-byte integration test. Production AppQA, browser authentication, actual calendar API entitlement, full provider identity-to-metrics flow, and updated Mac supervisor lifecycle still require post-approval validation.

No paid service, credentials, existing schedule or queue was changed. Missing metrics/API403 remain pending rather than fabricated learning. Public competitor proposals do not override winners; manual observations only choose bounded exploratory follow-ups, with existing quotas and network-consensus protections.

Rollback: revert the integration merge on main through a new reviewed PR and redeploy the prior application/local-worker revisions. Preserve evidence archives, receipts, scheduled provider IDs and the queue. Do not reset or delete historical state.
