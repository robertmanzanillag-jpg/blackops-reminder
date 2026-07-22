# HeyGen V3 provider profile

Status: pinned for new AI Media Studio work on 2026-07-22. This document is a reviewed integration profile, not live-account evidence or spend authority.

## Official transport

- Provider key: `heygen`.
- Origin: `https://api.heygen.com` only.
- Authentication: server-side `X-Api-Key`; the key must come from the deployment secret manager and must never enter browser requests, API bodies, logs, evidence, or Git.
- Avatar-group inventory: `GET /v3/avatars`, paginated with `limit`, `token`, `has_more`, and `next_token`. A group represents the character and supplies supporting consent/status evidence; its ID is not the selected render `avatar_id`.
- Avatar-look inventory: `GET /v3/avatars/looks`, optionally filtered by `group_id`, plus `GET /v3/avatars/looks/{look_id}` for exact revalidation. The selected provider avatar resource must bind to the look ID because HeyGen defines that look ID as the `avatar_id` used by `POST /v3/videos`.
- Voice inventory: `GET /v3/voices`, paginated with `limit`, `token`, `has_more`, and `next_token`.
- Account/key verification: `GET /v3/users/me`.
- Create one avatar video: `POST /v3/videos`.
- Observe the same video: `GET /v3/videos/{video_id}`.
- Initial output: `aspect_ratio: "9:16"` and `output_format: "mp4"`.

Primary sources:

- https://developers.heygen.com/docs/api-key
- https://developers.heygen.com/reference/list-avatar-groups
- https://developers.heygen.com/reference/list-avatar-looks
- https://developers.heygen.com/reference/get-avatar-look
- https://developers.heygen.com/reference/list-voices
- https://developers.heygen.com/reference/create-video
- https://developers.heygen.com/reference/get-video

## Mutation and reconciliation policy

Every future `POST /v3/videos` must carry one exact `Idempotency-Key` bound to the tenant, selected public slot, attempt, provider account, credential version, avatar, voice, script, quote, approval, and admission authority. HeyGen documents replay for the same endpoint/key within 24 hours and a `409 request_in_progress` response while the original request is still running.

There is no reviewed read-only lookup by idempotency key. A timeout, malformed success, or ambiguous response must therefore remain ambiguous. The system must not resubmit merely to discover whether the first request succeeded. Only an independently bound provider video ID or provider-authoritative negative-finality mechanism can resolve the ambiguity.

`video_url` and webhook delivery URLs are delivery references, not durable asset identity. The durable identity is the provider video ID. Completed media must be downloaded into owned storage; an expired URL must be refreshed through `GET /v3/videos/{video_id}` for that same video.

The existing `HeyGenV3AdmittedRenderProvider` is the only candidate for new admitted rendering. The older `HeyGenVideoProvider` uses legacy V2 and must not be used by the one-video or production path.

## Verification requirements

A future explicitly approved read-only verification must prove all of the following for the exact static credential version:

1. `GET /v3/users/me` succeeds and returns a supported billing model.
2. Every selected provider avatar binds to an exact V3 avatar look returned by `GET /v3/avatars/looks` (and revalidated by its look endpoint); the selected look ID is the future video `avatar_id`. Its parent group is separately resolved and must provide completed/trained status and approved consent. Group identity alone can never satisfy render-resource verification.
3. Every selected voice appears in the V3 inventory and supports the intended language/locale.
4. Account-specific limits, concurrent-render capacity, output eligibility, wallet/subscription state, and rate-limit behavior are recorded as evidence rather than inferred from public documentation.
5. Credential rotation makes prior provider, resource, quote, approval, and admission evidence stale.

The read-only verification can contact HeyGen but cannot create a video. It requires a separate Robert approval because it resolves the secret and performs provider network requests.

## Cost policy

Public pricing is informational only. The studio must not convert a documentation price into spend authority. One maximum quote must be produced by a trusted server-side adapter, bound to the exact selected video and expiry, then approved explicitly by Robert. The maximum is reserved before submit and committed immediately before the irreversible provider request. Actual billed cost requires a separate durable settlement event; terminal completion alone does not prove the charge.

## Webhook policy

Webhooks are completion signals only. A production receiver must verify the raw-body signature and timestamp, deduplicate the provider event ID, bind the event to the exact account/video, and then fetch authoritative video state. The current legacy webhook-to-service path is not an admitted terminal path and must not be reused for the real one-video execution.

Polling `GET /v3/videos/{video_id}` remains the fallback when callback delivery is unavailable. Neither callback nor polling may create a second provider submission.

## Current hard stops

- No API key or live HeyGen account has been verified.
- Static credentials cannot yet transition from unverified to active with immutable provider-verification evidence.
- There is no exact one-shot executor that guarantees only the selected slot is submitted.
- Robert-bound approval authentication is not yet proven.
- Owned storage and callback readiness have not been verified against a deployed environment.
- Actual billed-cost settlement is not yet modeled.
- No migration, provider call, video generation, spend, publishing, or deployment is authorized by this profile.
