# Owner-approved hour dispatch (inactive until release approval)

An exact conditional slot required dispatch one to five minutes before its minute. The existing external Office dispatcher creates opportunities about every 15 minutes, followed by variable workflow completion/runner latency. Replit Autoscale does not prove an always-warm minute timer. This opt-in reuses those existing opportunities without an LLM heartbeat, raw download, speech transcription or another timer.

An authenticated owner must propose and separately approve a new immutable manifest with:

```json
"dispatch": {
  "mode": "owner_hour_window",
  "timezone": "America/New_York",
  "startAt": "2026-11-23T15:00:00.000Z",
  "endAt": "2026-11-23T16:00:00.000Z"
}
```

`scheduledAt` must equal `startAt`. These UTC bounds must represent exactly one unambiguous New York local hour and fit inside the existing rights window, expiry and actual membership operational lease. Repeated fall-back hours are rejected. This example is a schema illustration, not a real permission or scheduled video. Existing exact manifests remain exact and cannot acquire this permission by changing a runtime flag.

After sealed-file/audio checks and fresh complete calendar/source receipts, the worker selects a minute about three to four minutes ahead inside the approved hour. It stores that exact minute and approved-manifest digest in the delivery before public staging. All final write fences, quotas, shared source claims, provider ACKs and subsequent read-only reconciliation bind that selected minute. If preparation crosses the hour or the final check misses its one-to-five-minute lead, it holds; it cannot move to another hour. No possibly-started write is retimed, retried or inferred successful. Proven unused prewrite failures can be checked again by a later ordinary opportunity inside the same approved hour.

Known exact reviewed deliveries still receive read-only copy/stage maintenance when the opt-in is on; they are never selected for new scheduling by the hour dispatcher.

The private review desk distinguishes the approved hour, selected exact minute, provider scheduling and final publication. A proposed/approved window or selected minute alone counts as zero scheduled coverage. Five different hours per connected account still require five exact acknowledged authorized videos; blocked or disconnected accounts remain held. Future conditional-campaign work needs a real recent authenticated Joined observation and explicit owner operational lease renewed daily; the public active predicate does not prove membership or a future campaign ending date. Conditional expiry is never invented.

The proposed workflow opt-in `CLIPPERS_REVIEWED_HOUR_WINDOW_ENABLED=true` replaces the normal raw/exact publishing job with the final-only job under the same workflow writer concurrency. Global publisher enable, kill, dry-run, repository and branch guards still apply. The final-only runner performs a deterministic read-only due/maintenance check before installing FFmpeg. It reuses existing DB/owner/Metricool/staging identities and never runs the raw publisher or 180-minute raw cadence. With the opt-in absent, the prior raw/exact workflow remains unchanged. No repository variable, timer, credential or deployment is changed by this PR.

Read-only operational evidence on 22 November 2026 found the repository public and eight consecutive Office opportunities about 15 minutes apart, with roughly 3–4 minute completion times; the current actual publisher job was skipped. These observations are not a future availability guarantee: factory work, queueing or GitHub delays can miss an hour, which remains held. [GitHub billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage) states standard hosted runner minutes are free for public repositories; existing DB/provider/staging storage is not asserted free. No AI model call or new storage purchase is introduced.

Release requires independent code/Claude review, owner HTTP/browser QA, final CI, and explicit human deployment/publishing approval. Afterwards, a controlled first actual ACK and fresh read-back must verify exact media/caption/selected time/UUID and paid disclosure before claiming operational delivery. Passing mocked service tests or local-byte QA does not establish real uploads or a full week's schedule.

Rollback: keep publishing disabled or remove only the hour-window opt-in; preserve all possibly-started delivery IDs, selected times, source claims, staged assets and private references until exact provider reconciliation. Revocation prevents new sends; it does not cancel already acknowledged schedules. No automatic cancellation monitor is claimed.

Reviewed finals are excluded from the legacy nearby-time source/creator/hook attribution and legacy follow-up counts. Mixed accounts also require exact raw platform identity or its own verified observation for legacy per-source metrics; a reviewed video’s unknown publication delay cannot be bounded by a nearby scheduled time. Raw-only accounts retain their existing fallback. Real whole-account provider totals and quota/source reservations remain intact. This is a protective exclusion, not a derivative analytics observer: until exact actual publication/UUID/public URL/age/metrics are independently bound, the reviewed lane reports metadata and delivery receipts only and makes no creator-learning or improvement claim.

The anonymous campaign response reader caps object/array nesting at40; primitive leaves at depth41 do not add another object level. A compact path-preserving fixture reconstructed from an actual public response tests that boundary, alongside the actual paused-campaign shape. Its source URL/hash/capture time are recorded without copying the full third-party page. Captured responses use their recorded time in regression tests; current eligibility still requires a fresh primary response and independently reviewed membership/rights.
