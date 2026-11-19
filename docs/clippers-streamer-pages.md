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
| Download | Mac (yt-dlp) | `node --import tsx script/clippers-streamer-discovery.mjs --export-local-queue` prints approved work. Twitch has no official third-party clip download. `CLIPPERS_TWITCH_CLOUD_DOWNLOAD=probe` only HEAD-checks the unofficial thumbnail-derived mp4 URL. |
| Render | Mac (existing renderer) | The cloud renderer still needs a bundled font and must avoid zsh/BSD stat. |
| Publish | Existing Metricool path after approval | Nothing in this lane calls Metricool. |
| Office | Orchestra role `clippers-streamers` + `GET /api/clippers/streamers/status` | Shows held reasons such as `missing_secret:TWITCH_CLIENT_ID`. |

Secrets (repository Actions): `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `YOUTUBE_API_KEY`. The workflow also uses
`OFFICE_DATABASE_URL` and `OFFICE_OWNER_ID`, which already exist. Set the `CLIPPERS_STREAMERS_CLOUD_ENABLED=false` variable to pause.
