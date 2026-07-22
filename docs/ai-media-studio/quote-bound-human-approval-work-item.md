# Quote-bound human approval work item

Status: active implementation checkpoint; no migration, provider call, generation, spend, publishing, or deployment is authorized.

Branch: `codex/ai-media-studio-quote-bound-approval`

Stack base: draft PR #161 (`codex/ai-media-studio-secure-heygen-setup-runtime`).

## Goal

Replace the ambiguous statement “Robert approved this slot” with durable evidence that Robert approved one exact maximum quote, for one exact render specification, before its exact expiry.

## Required invariant

An approval is current only when all of these facts still match the latest durable quote:

- tenant, plan slot, and attempt;
- launch intent and launch subject;
- provider account and credential version;
- approved script and slot-bound avatar/voice selection;
- fixed one-video output (`avatar_video`, `9:16`, `mp4`);
- quote evidence identity, revision, digest, amount, USD currency, and source-clamped expiry.

A new quote revision, credential rotation, changed subject/render specification, expiry, rejection, revocation, or tenant mismatch makes the old approval stale. No legacy unbound approval is accepted or backfilled.

## Maker/checker ownership

- Schema maker: pending PR30 append-only quote↔human bridge, exact foreign keys, immutability, and migration tests.
- Authority maker: strict command normalization, quote compare-and-set under lock, source expiry clamping, render-spec binding, snapshot/read-model enforcement, and focused tests.
- Route/UI maker: authenticated same-origin JSON action and explicit review dialog; this starts only after the authority contract is stable.
- Security checker: authorization, cross-tenant isolation, replay/idempotency, stale quote, expiry, race, and no-effect review.
- App QA: route/click path, accessibility, exact evidence display, and permanent execution-disable gate.

No two makers own the same files concurrently.

## Deliberate non-goals

- No fabricated or public-price-based HeyGen quote.
- No API key or secret resolution.
- No HeyGen request.
- No budget reservation or spend authorization.
- No render/job/outbox/publishing creation.
- No `POST /v3/videos` and no one-shot executor.
- No migration application, merge, or Replit deployment.

## Evidence gate

Before the checkpoint can be saved as a draft PR:

1. strict contracts and focused authority tests pass;
2. PostgreSQL proves exact quote/approval binding and mixed-pair rejection;
3. a newer quote invalidates the prior approval;
4. effects remain zero for provider, secret, reservation, render, outbox, spend, and publishing;
5. independent checker, security review, and App QA report no unresolved blockers;
6. rollback notes preserve durable evidence and the migration remains pending/unapplied.
