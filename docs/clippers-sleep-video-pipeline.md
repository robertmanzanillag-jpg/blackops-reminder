# Clippers Sleep Video Pipeline

This local-only pipeline creates long-form sleep videos from deterministic mathematical audio synthesis and procedural FFmpeg visuals. It uses no network access, external samples, stock media, paid APIs, or credentials.

## Production generation

FFmpeg and ffprobe must be available on `PATH`.

```bash
node script/clippers-sleep-video-generator.mjs \
  --output clippers_workspace/sleep/deep-night-rest-8h.mp4 \
  --duration-seconds 29100 \
  --seed 20260824 \
  --title "Deep Night Rest — 8 Hours"
```

The default and recommended runtime is 29,100 seconds (8:05). Production mode refuses durations below 28,800 seconds (eight hours). The soundtrack is a continuous base composition with eight slowly crossfaded hourly harmonic evolutions, while the procedural visual changes its geometry once per chapter; it is not a short media loop stretched to eight hours. The generator writes the MP4 to a temporary partial path, verifies it, and only then moves it to the requested filename. The adjacent `.mp4.rights.json` records the SHA-256 digest, technical QA, deterministic seed and parameters, eight-chapter plan, provenance, absence of third-party inputs, and the requirement for human publication review.

This command **does not upload or publish anything**. The generated manifest documents provenance; it does not grant publication authorization.

## CI mode

Short videos are allowed only with explicit test mode and are capped at 30 seconds:

```bash
node script/clippers-sleep-video-generator.mjs \
  --output /tmp/clippers-sleep-ci.mp4 \
  --test-mode \
  --duration-seconds 2 \
  --width 320 \
  --height 180
```

Focused test command:

```bash
node --test tests/clippers-sleep-video-generator.test.mjs
```

## Fail-closed gates

- production duration is at least eight hours;
- output has one H.264 video stream at the requested resolution;
- output has 48 kHz stereo AAC audio;
- measured duration is not shorter than requested;
- audio samples at 0h, every hour, and the closing segment are neither silent nor clipping;
- a video frame is decoded and hashed at every QA sample point;
- an existing output is preserved unless `--overwrite` is explicit;
- failed encodes or failed QA never become the final output;
- a rights/provenance manifest is written only after successful media QA.

## YouTube readiness notes

Official YouTube Help currently states that verified accounts can upload videos longer than 15 minutes, with a documented maximum upload size of 256 GB or 12 hours, whichever is less:

- https://support.google.com/youtube/answer/171664
- https://support.google.com/youtube/answer/71673

Monetization risk is handled fail-closed: YouTube says monetizable content must be original, non-repetitious, and commercially authorized for all audio and visual elements. This pipeline therefore records no external samples/assets, a deterministic seed, chapter-level variation, and `publicationAuthorizedByThisManifest: false` so a human channel review still has to happen before upload:

- https://support.google.com/youtube/answer/2490020
- https://support.google.com/youtube/answer/1311392

Before publishing, a separate reviewer must listen for comfort and clipping, inspect the visual result, confirm the target YouTube channel and authorization, and approve the title, thumbnail, description, and audience settings.
