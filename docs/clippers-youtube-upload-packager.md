# Clippers YouTube upload packager

`clippers-youtube-upload-packager.mjs` is the offline, deterministic bridge from a completed `clippers-content-local-worker` report to the reviewed queue consumed by `clippers-youtube-publish-worker.mjs`. It never uploads, accesses credentials, uses the network, or incurs API cost.

## Owner authorization config

The config is an owner-controlled `0600` JSON file. Paths must resolve inside `workspaceRoot`. All three channel/privacy choices are mandatory even when a run has no candidate in a lane.

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "/Users/robertmanzanilla/.local/share/blackops/clippers-workspace",
  "sourceReport": "reports/content-worker/clippers-content-local-worker-latest.json",
  "authorization": {
    "blanketAuthorized": true,
    "authorizedBy": "Robert",
    "authorizedAt": "2026-08-24T15:00:00.000Z",
    "motivationShortsPerDayPerChannel": 5,
    "sleepVideosPerRollingSevenDays": 1
  },
  "channels": {
    "motivation_es": {
      "channelId": "UC_REPLACE_WITH_EXACT_ES_CHANNEL_ID",
      "privacyStatus": "private"
    },
    "motivation_en": {
      "channelId": "UC_REPLACE_WITH_EXACT_EN_CHANNEL_ID",
      "privacyStatus": "private"
    },
    "sleep": {
      "channelId": "UC_REPLACE_WITH_EXACT_SLEEP_CHANNEL_ID",
      "privacyStatus": "private"
    }
  }
}
```

Valid privacy choices are `private`, `unlisted`, and `public`. A public lane additionally requires a distinct explicit choice:

```json
"publicAuthorization": {
  "public": true,
  "authorizedBy": "Robert",
  "authorizedAt": "2026-08-24T15:30:00.000Z"
}
```

The packager copies this second authorization to both the uploader item and reviewed queue entry. The publish worker still requires its separate global `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=true` gate before a public upload, so a config file alone cannot publish anything.

## Gates

- Pins the exact completed content-worker report by SHA-256.
- Re-hashes every MP4 and its source manifest/provenance.
- Accepts motivation only when the source script and procedural audio are explicitly owned-original with no third-party source or asset.
- Accepts sleep only when the generator's rights manifest pins the output and owned generated visual, reports no external audio or paid service, and passed its production QA.
- Uses `ffprobe` to require an MP4 with valid video and audio streams, correct orientation, and lane duration.
- Fully decodes every video and audio stream with FFmpeg before setting `playbackComplete: true`; a sampling-only check is not sufficient.
- Enforces at most five Shorts per New York day in each language lane and one sleep upload per rolling seven days, including active ledger outcomes.
- Deduplicates item IDs, paths, and media hashes. An exact rerun preserves the already reviewed queue. A different report cannot replace a non-empty pending reviewed queue.

Only successfully gated candidates get a schema-valid item, `youtube_video` rights evidence, and `youtube_video_qa` evidence. Files are written atomically with owner-only mode. Native-language titles and descriptions come only from the approved source script or sleep manifest; the packager does not translate or invent source rights.

## Run

```sh
node script/clippers-youtube-upload-packager.mjs \
  --config /absolute/path/clippers-youtube-upload-packager.json
```

Outputs inside the workspace:

- `youtube/items/*.json`
- `youtube/rights/*.json`
- `youtube/qa/*.json`
- `youtube/reviewed-upload-queue.json`
- `reports/youtube-upload-packager-latest.json`

The reviewed queue is an input to the separate publish worker. Creating it performs no upload and no network request.
