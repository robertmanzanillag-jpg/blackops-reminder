# Clippers Content Local Worker

This standalone local orchestrator prepares the new YouTube content lanes without networking, uploads, publishing, credentials, paid services, Marketplace, Metricool, or TikTok. It runs the fact-only content-learning CEO, then renders at most five approved motivation candidates for each independent Spanish and English channel. Sleep generation is capped at one artifact per rolling seven days.

## Configuration

The worker accepts exactly one explicit configuration file. Production should use:

`/Users/robertmanzanilla/.local/share/blackops/clippers-workspace/config/clippers-content-worker.json`

All operational paths must remain inside `workspaceRoot`. The configuration must be a regular, readable file rather than a symlink.

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "/Users/robertmanzanilla/.local/share/blackops/clippers-workspace",
  "metricsLedger": "reports/clippers-content-publication-metrics.json",
  "reportDir": "reports/content-worker",
  "operationTimeoutMs": 50400000,
  "motivation": {
    "es": {
      "channelId": "motivation-es",
      "manifestFiles": ["motivation/manifests/es-001.json"],
      "gates": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    },
    "en": {
      "channelId": "motivation-en",
      "manifestFiles": ["motivation/manifests/en-001.json"],
      "gates": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    }
  },
  "learning": {
    "maximumMetricsAgeHours": 72,
    "laneGates": {
      "sleep_long": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    }
  },
  "sleep": {
    "enabled": true,
    "jobs": [
      {
        "output": "sleep/rendered/2026-08-24-rainy-bedroom-8h05.mp4",
        "durationSeconds": 29100,
        "seed": 20260824,
        "title": "Rainy Bedroom Sleep — 8 Hours",
        "visualSource": "sleep/source-assets/rainy-bedroom.png",
        "visualSha256": "REPLACE_WITH_64_CHARACTER_SHA256",
        "visualRightsEvidence": "sleep/source-assets/rainy-bedroom.rights.json"
      },
      {
        "output": "sleep/rendered/2026-08-31-deep-rain-8h05.mp4",
        "durationSeconds": 29100,
        "seed": 20260831,
        "title": "Deep Rain for Sleep — 8 Hours",
        "visualSource": "sleep/source-assets/deep-rain.png",
        "visualSha256": "REPLACE_WITH_64_CHARACTER_SHA256",
        "visualRightsEvidence": "sleep/source-assets/deep-rain.rights.json"
      }
    ]
  }
}
```

Candidate manifests still pass every rights, voice, media, quality, channel-language, daily-volume, and deduplication gate in `clippers-motivation-shorts.mjs`. A plan of five does not bypass those gates. On later days the worker walks the configured queue, skips already-rendered candidates, and continues until it renders the daily target or exhausts the approved queue; it never fills with an unapproved candidate. The report records exact rendered shortfalls against five for each channel.

Run:

```sh
node script/clippers-content-local-worker.mjs --config /absolute/path/clippers-content-worker.json
```

The production atomic owner-only report is `reports/content-worker/clippers-content-local-worker-latest.json`. The live lock is beside it as `clippers-content-local-worker.lock`; a live PID always wins regardless of lock age. The owner-only sleep generation ledger is also beside it as `clippers-content-sleep-ledger.json`. Each sleep job has a unique explicit output, title, seed, visual hash, and evidence path. After the seven-day cap expires the worker selects the next unused job rather than overwriting the previous week's artifact. When the rolling cap is already satisfied, the report preserves `requestedByCeo: 1` but records an effective `planned: 0`, `shortfall: 0`, and a `deduplicated` result so monitoring does not raise a false daily alert. Default operation timeout is 14 hours and can be configured from one minute up to 24 hours.
