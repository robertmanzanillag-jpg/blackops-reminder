# Clippers streamer pages (cloud)

The NY News (6595747) and Miami News (6591612) Metricool brands are now streamer clip pages.
Page names come from the repository variable `CLIPPERS_CITY_PAGE_NAMES`, for example
`{"6591612":{"name":"<Miami page name>"},"6595747":{"name":"<NYC page name>"}}`. No name is hardcoded.
The local-news Metricool sender is retired (`CLIPPERS_LOCAL_NEWS_SENDER_ENABLED` must be `"true"` to resume it).
Its ledgers stay on disk and are read-only.

## Clip policy
- A creator is clipped unless they explicitly prohibit it: Twitch user description, YouTube channel description,
  `KNOWN_PROHIBITED_CREATORS`, or a takedown (`shared/clippers-streamer-policy.mjs`, Spanish and English patterns).
  Twitch panels are not exposed by the Helix API, so they are not checked automatically. Add them to the known list by hand.
- Every caption credits `@handle` and links the source. Clips are short (60 s or less) and edited. Full streams and VODs are never posted.
- `POST /api/clippers/streamers/takedown` (owner only) blocks a creator, group or clip forever and starts a 24 h removal clock.
  The office shows `takedown_overdue` once that clock runs out. Remove the live post in Metricool.

## Pipeline
| Stage | Where | Notes |
|---|---|---|
| Discovery | `.github/workflows/clippers-streamers.yml` → `script/clippers-streamer-discovery.mjs` | Twitch Helix (app token): top live, top categories, last-24 h clips. YouTube Data API: channel snippets, uploads, trending gaming. About 30–60 units per run, and `search.list` is never used. |
| State | PostgreSQL `agent_council_state`, namespace `clippers-streamers:<owner>` | Uses the existing council store. No new table. |
| Approval | `pending_actions` (`clippers.streamer_clip_publish`) | Shows in the existing pending-actions panel. `CLIPPERS_STREAMER_AUTO_PUBLISH=true` pre-approves rows. It is off by default. |
| Download | Cloud: `.github/workflows/clippers-streamers-publish.yml` → `script/clippers-streamer-cloud-worker.mjs` | Only approved rows (`approved`/`executed`). `yt-dlp` (`bin/yt-dlp`, or pip with `CLIPPERS_YTDLP_FROM_PIP=true`) downloads only the needed section. YouTube tries `--impersonate chrome` first (curl-cffi). Twitch clips are picked from the official Helix clip metadata. |
| Render | Cloud: `script/clippers-streamer-cloud-render.mjs` | ffmpeg only, with no shell, ImageMagick, zsh or BSD `stat`. The output is 1080×1920 with a blurred fill, the hook text and the `Créditos: @handle` credit burned in using the bundled `assets/fonts/DejaVuSans-Bold.ttf`, plus loudness normalization. It is at most 60 s (`CLIPPERS_STREAMER_CLIP_SECONDS`, default 45). Long YouTube videos are cut at the "most replayed" heatmap peak. ffprobe checks size, audio and duration. |
| Publish | Existing Metricool adapter `script/clippers-portfolio-metricool.mjs` | The policy is checked again at publish time: the stored policy, a live re-read of the creator's description, takedowns, the known list, the credit and the 60 s limit. It is checked once more inside the owner lock right before each write. The media is staged as a temporary asset on the `clippers-media-staging` prerelease of this repository and deleted only once Metricool holds its own SHA-verified copy or the slot is 2 h past. It is never deleted while a write is uncertain, and leftovers are swept after 48 h. The adapter verifies the destination identity and publish permission, enforces the daily cap of 5 and checks for slot, caption and media duplicates before each write. A write with an uncertain outcome is never sent again: it is reconciled read-only. |
| Learning | Same job, `script/clippers-streamer-cloud-learning.mjs` | Reads Metricool post analytics 24–48 h after the slot. It runs an A/B test on the burned hook (`title` vs `teaser`) per destination with the existing `evaluateExperiments`, and orders creators by relative median views. |
| Office | Orchestra role `clippers-streamers` + `GET /api/clippers/streamers/status` | Shows held reasons such as `missing_secret:TWITCH_CLIENT_ID`. `cloudPublish` lists the recent posts (use it to remove posts after a takedown) and the learning summary. |

### Platforms
YouTube answers GitHub-hosted runner IPs with "Sign in to confirm you're not a bot", even with `--impersonate chrome` and a working curl-cffi. That was verified on 2026-11-19. The cloud lane therefore takes **Twitch clips only** (`CLIPPERS_STREAMER_CLOUD_PLATFORMS`, default `twitch`).
While the cloud publisher is on, discovery creates approval rows only for those platforms, so unpublishable YouTube approvals don't fill the open-approval budget.
A YouTube bot check is reported as `SOURCE_BOT_CHECK`, and the run stops trying other YouTube clips. Every failed clip prints a log-safe line: `clip diagnostics: {platform, step, impersonate, exitCode, detail}`. The detail is the last stderr line, with URLs, paths, e-mails and long tokens removed.

### Destinations and schedule
The adapter allowlist (`script/clippers-portfolio-metricool.mjs`) matches the live Metricool identities (getBrandSettings, 2026-11-19): `6431685/tiktok/streamersus` (memes), `6431687/tiktok/streamersclipusa` (SPORT), `6591612/tiktok/news305miami` and `6591612/facebook/1193011863901514`.
Ledger rows written under the old account names `streamersclips` and `ynb4b6r6` still resolve to the same destination through `LEGACY_ACCOUNT_ALIASES`, so they keep counting toward the caps and duplicate checks.
By default this lane posts only to the **three TikTok accounts**. Add Facebook by listing it in `CLIPPERS_STREAMER_CLOUD_DESTINATIONS`, for example `6431685:tiktok:streamersus,6431687:tiktok:streamersclipusa,6591612:tiktok:news305miami,6591612:facebook:1193011863901514`.
`6595747` (NY, Facebook only) stays held until it is added to that allowlist.
The default slots are 11:00, 13:30, 16:00, 18:30 and 21:00 America/New_York (`CLIPPERS_STREAMER_CLOUD_SLOTS`). Destinations are staggered by 7 minutes. There are at most 5 posts per destination per day (all lanes, enforced by Metricool preflight) and 2 clips per run (`CLIPPERS_STREAMER_CLOUD_CLIPS_PER_RUN`, max 5). The job runs after the office worker, between 09:00 and 19:59 New York time, at most once every 3 h (`CLIPPERS_STREAMER_CLOUD_MIN_INTERVAL_MINUTES`). The repository is public, so standard runners cost $0. A run takes a few minutes and has a 30-minute timeout.

### Enable / pause
1. Add the repository Actions secrets `METRICOOL_USER_TOKEN` and `METRICOOL_USER_ID`. These are the same names the Metricool adapter already uses. The Twitch/YouTube secrets are listed below.
2. Set `CLIPPERS_CITY_PAGE_NAMES`. Test with `CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED=true` plus a manual dispatch with `dry_run` checked: the renders are kept as a 1-day artifact, nothing is uploaded or posted, and no clip state is written (approvals stay queued).
3. Go live by leaving `CLIPPERS_STREAMER_CLOUD_DRY_RUN` unset. Approvals still come from the pending-actions panel unless `CLIPPERS_STREAMER_AUTO_PUBLISH=true`.
4. Kill switch: `CLIPPERS_STREAMER_CLOUD_KILL_SWITCH=true` stops every later run (the job `if` and the script start both check it). A run that is already in progress cannot see variable changes, so cancel it in Actions. Each run takes no new clip after 20 min (`CLIPPERS_STREAMER_CLOUD_RUN_DEADLINE_MINUTES`). `CLIPPERS_STREAMERS_CLOUD_ENABLED=false` pauses discovery and publishing together.

`node --import tsx script/clippers-streamer-discovery.mjs --export-local-queue` still prints the approved queue for a manual Mac run.

Secrets (repository Actions): `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `YOUTUBE_API_KEY`, plus `METRICOOL_USER_TOKEN` and `METRICOOL_USER_ID` for publishing. The workflows also use
`OFFICE_DATABASE_URL` and `OFFICE_OWNER_ID`, which already exist. Set the `CLIPPERS_STREAMERS_CLOUD_ENABLED=false` variable to pause.
