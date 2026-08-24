# Clippers official YouTube uploader

`script/clippers-youtube-uploader.mjs` is the fail-closed final delivery step for the three YouTube lanes:

- `motivation_es`
- `motivation_en`
- `sleep`

It uses Google's OAuth refresh-token flow, verifies the authenticated identity with `channels.list?mine=true`, and uploads through the official YouTube Data API `videos.insert` resumable protocol. It never buys ads or invokes a paid AI/media service.

## Safety contract

Before making an OAuth or YouTube request, the uploader requires:

1. A workspace-contained regular MP4 (no symlinks or path traversal) whose SHA-256 exactly matches the item manifest.
2. Workspace-contained rights and QA JSON files whose own hashes exactly match the manifest.
3. Rights evidence matching the exact item id, file and media hash, with `owned` or `explicitly_authorized` rights and commercial use authorized.
4. QA evidence matching the exact item id, file and media hash, with playback, video, audio and format checks approved.
5. No active ledger row for the item id, media file or media hash.
6. A lane-specific expected YouTube channel ID and lane-specific OAuth refresh configuration.
7. An exact match between that expected ID and the channel returned by `channels.list(mine=true)`.

The default privacy is `private`. A public item requires both:

- `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=true`; and
- `publishAuthorization.public=true`, `authorizedBy`, and `authorizedAt` in that individual item.

An interrupted or non-successful media request after a resumable session has been created is recorded as `uncertain_outcome`. The same item/file/hash cannot be retried until an operator reconciles it in YouTube Studio and resolves the ledger. This avoids duplicate videos.

No access tokens, refresh tokens, client secrets or resumable session URLs are written to the result or ledger.

## Lane-specific runtime configuration

Set a complete, separate set for every lane being operated. Do not store values in item manifests or reports.

```text
CLIPPERS_YOUTUBE_ES_CHANNEL_ID
CLIPPERS_YOUTUBE_ES_CLIENT_ID
CLIPPERS_YOUTUBE_ES_CLIENT_SECRET
CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN

CLIPPERS_YOUTUBE_EN_CHANNEL_ID
CLIPPERS_YOUTUBE_EN_CLIENT_ID
CLIPPERS_YOUTUBE_EN_CLIENT_SECRET
CLIPPERS_YOUTUBE_EN_REFRESH_TOKEN

CLIPPERS_YOUTUBE_SLEEP_CHANNEL_ID
CLIPPERS_YOUTUBE_SLEEP_CLIENT_ID
CLIPPERS_YOUTUBE_SLEEP_CLIENT_SECRET
CLIPPERS_YOUTUBE_SLEEP_REFRESH_TOKEN
```

The OAuth grants must include YouTube upload permission (normally `https://www.googleapis.com/auth/youtube.upload`). Credentials remain externally managed; this script does not read `.env` or credential directories.

## Item and evidence contract

The item JSON has schema version 1 and includes `itemId`, `lane`, `file`, `sha256`, `title`, optional `description`, optional `privacyStatus`, and hashed references to `rightsEvidence` and `qaEvidence`. Rights evidence uses `assetType: youtube_video`. QA evidence uses `assetType: youtube_video_qa` and explicitly approves these checks: `playbackComplete`, `videoValid`, `audioValid`, and `formatAccepted`.

Use preflight before enabling any upload:

```bash
node script/clippers-youtube-uploader.mjs \
  --workspace /absolute/path/to/clippers-workspace \
  --item youtube/items/motivation-es-001.json \
  --preflight
```

Preflight performs the local file, hash, rights, QA and dedupe gates, reports missing lane configuration, and makes no network requests. Remove `--preflight` only after the expected channel and OAuth configuration are present. Keep new items private first and confirm them in YouTube Studio before granting item-level public authorization.

The ledger is written atomically at `reports/youtube-upload-ledger.json` with file mode `0600`. API cost and paid spend are always recorded as USD 0.
