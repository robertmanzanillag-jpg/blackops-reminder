# Clippers YouTube publish worker

This worker is the reviewed bridge between the offline content renderer and `clippers-youtube-uploader.mjs`. It never renders media and never stores credentials. Run it as a separate process with lane-specific OAuth variables supplied by the service manager.

It requires one owner-reviewed queue inside the Clippers workspace. The queue pins the completed content-worker report by SHA-256 and pins each approved uploader item to an exact rendered result. Every uploader item must already use the rights and QA evidence contract documented in `docs/clippers-youtube-uploader.md`.

```json
{
  "schemaVersion": 1,
  "reviewed": true,
  "reviewedBy": "Robert",
  "reviewedAt": "2026-08-24T14:00:00.000Z",
  "sourceReport": {
    "file": "reports/content-worker/clippers-content-local-worker-latest.json",
    "sha256": "64_HEX_CHARACTERS"
  },
  "items": [
    {
      "itemFile": "youtube/items/motiva-d01-01.json",
      "approved": true,
      "approvedBy": "Robert",
      "approvedAt": "2026-08-24T14:00:00.000Z",
      "source": { "type": "motivation_short", "language": "es", "shortId": "motiva-d01-01" }
    }
  ]
}
```

For sleep, use `"source": { "type": "sleep_long" }`; the item file must match the generated output in the pinned report. Public items additionally require a reviewed `publicAuthorization` on the queue entry, the matching authorization in the uploader item, and `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=true`. Otherwise privacy defaults to `private`.

Run:

```sh
node script/clippers-youtube-publish-worker.mjs \
  --queue youtube/reviewed-upload-queue.json
```

The worker enforces at most five active upload outcomes per New York calendar day for each motivation lane and at most one sleep upload per rolling seven days. Uploaded, started, and uncertain ledger rows all consume capacity. Existing or uncertain item IDs, files, and hashes are never retried automatically. Missing channels, lane-specific OAuth, evidence, review approval, or exact source-report linkage fail closed before the uploader is called.

The atomic owner-only report is `reports/youtube-publish-worker-latest.json`. It contains statuses and real returned YouTube video IDs/URLs only; it never contains OAuth values, access tokens, or resumable session URLs. API cost and paid spend remain USD 0.
