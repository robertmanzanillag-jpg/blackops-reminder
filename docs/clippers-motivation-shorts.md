# Clippers Motivation Shorts

This zero-cost local lane renders original Spanish motivational scripts into 20–40 second, 9:16 MP4 drafts. It never publishes. Production is capped at one rendered Short per America/New_York day and five per rolling seven days.

## Fail-closed inputs

Every draft requires a version 1 JSON manifest and an audio-only local voice recording. The manifest must declare an original, owned script with no third-party quotes, speeches, or sources. The separate voice evidence JSON must match the short ID, relative file path, and SHA-256, and must document speaker consent and commercial-use authorization. Remote TTS, web audio, attributed speeches, missing evidence, symlinks, path traversal, and mismatched hashes are rejected.

Example manifest:

```json
{
  "schemaVersion": 1,
  "shortId": "motiva-001",
  "language": "es",
  "format": "youtube_short_9x16",
  "script": {
    "hook": "No necesitas sentirte listo para comenzar.",
    "beats": ["Da hoy un paso pequeño.", "Cumple la promesa que te hiciste."],
    "close": "Empieza ahora.",
    "originality": {
      "status": "owned_original",
      "author": "Equipo Clippers",
      "thirdPartyQuotes": false,
      "thirdPartySpeeches": false,
      "sources": []
    },
    "structure": { "conflict": "hook", "idea": "beats", "action": "close" }
  },
  "voice": {
    "sourceType": "local_recording",
    "file": "input/motiva-001.wav",
    "rightsEvidenceFile": "rights/motiva-001-voice.json",
    "sha256": "<64 lowercase hex characters>"
  },
  "style": { "backgroundColor": "#111827" },
  "contentSafety": {
    "celebrities": false,
    "podcasts": false,
    "clonedVoices": false,
    "thirdPartyQuotes": false,
    "wealthPromises": false,
    "healthPromises": false
  }
}
```

The voice evidence schema is:

```json
{
  "schemaVersion": 1,
  "assetType": "voice_recording",
  "shortId": "motiva-001",
  "file": "input/motiva-001.wav",
  "sha256": "<same SHA-256 as the manifest>",
  "rightsStatus": "owned",
  "speakerConsent": true,
  "commercialUseAuthorized": true,
  "provenance": "local_recording",
  "verifiedBy": "Robert",
  "verifiedAt": "2026-08-24T12:00:00.000Z"
}
```

`rightsStatus` may be `owned` or `explicitly_authorized`.

## Run

```bash
node script/clippers-motivation-shorts.mjs \
  --workspace /absolute/path/to/clippers-workspace \
  --manifest manifests/motiva-001.json
```

The editorial structure is explicit: conflict in the hook, core idea in the beats, and one practical action in the close. Celebrity or podcast material, cloned voices, third-party quotes, and wealth or health promises are explicitly excluded.

The renderer uses only local `ffmpeg`/`ffprobe`, embeds deterministic Spanish subtitles, verifies audio plus 1080×1920 video and duration, and extracts start/middle/end evidence frames. Provenance is stored under `evidence-drop/motivation/<short-id>/`; deduplication records are stored in `reports/clippers-motivation-ledger.json`. API cost is always USD 0 and `publishEnabled` is always false.

No package script was added; integration may call the `.mjs` entrypoint directly or add a package command separately.
