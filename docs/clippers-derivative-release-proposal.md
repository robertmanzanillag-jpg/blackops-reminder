# Conditional derivative activation proposal — not configured

Current exact-slot mode remains unchanged. The current external Office cadence (15 minutes, an early-hour gate and a 180-minute raw interval) cannot reliably enter an exact 1–5 minute conditional window. Passing code tests does not make that schedule operational. No cadence, deployment, spending limit or runtime identity is changed by this proposal.

## Recommended release shape

Reuse an existing, owner-controlled, continuously running cloud worker for a deterministic one-minute **metadata-only due check**, rather than starting heavyweight rendering or a strong model on a repeating timer. First verify its actual cloud writer identity, shared PostgreSQL store, private temporary disk, ffmpeg/ffprobe, controlled GitHub staging access and read-only/dispatch Metricool permissions. Do not assume those capabilities exist on Replit or bypass the Mac single-writer fence. If the current runtime lacks them, return a concrete hosting/credential/cost comparison for owner approval; do not silently add infrastructure.

The due check should read only bounded approved pending records. Work happens only inside a valid owner window, under the shared pre-write lease, with at most five confirmed active receipts per network/day and distinct hours. Existing uncertain writes/source claims and drafts keep their reservations. The core final-file runner stays the only commercial derivative writer. The exact-slot path keeps its current contract; it must never silently fall back to an hour window.

A useful separate opt-in contract would be `owner_hour_window`: the authenticated owner approves one explicit New York hour window and the exact final/caption/source/rights/QA hashes, plus a deterministic dispatch policy. After fresh eligibility checks the server resolves a concrete future minute 1–5 minutes away **inside** that approved window and records it durably before the provider call. Approval binds the window and selection policy; the pending-write record binds the final chosen minute. Five windows must occupy five different hours. No spill into another hour/day is allowed.

An original exact-minute proposal cannot be converted to this mode without a new owner proposal/approval. No existing permission, clip or lease is extended. The chosen minute must remain inside membership/operational lease, license and campaign constraints. After any possibly started provider write there is no reselection, retiming, recreation or retry. Before any write, a failed unused staging attempt can be cleaned and a new minute selected only if that distinct mode's approved policy permits it and the original window is still open.

## Cost and operational checks before approval

- No LLM/API call is needed for cadence, rights checks, quota, byte hashes, audio reconstruction or status reconciliation. Existing $100 API budget is not increased or used for heartbeat polling.
- Show the actual host's incremental cost and timer availability first. A warm existing worker is preferred only if its measured incremental cost and single-writer identity are established. Do not promise free compute without evidence.
- Bound due checks, concurrent work, source/campaign reads and failure backoff; cache only immutable hash-bound artifacts under reviewed freshness rules. No download/render/model work for distant or ineligible records.
- Independently test DST/local hours, clock drift, queue/startup delays, missed windows, interrupted staging, shared writers, five-per-network coverage, campaign/membership expiration and provider paid-disclosure loss. Keep the commercial lane paused until actual provider reconciliation if disclosure is lost.
- Complete owner UI/API QA of the opt-in contract, Claude/checker review, CI and a read-only production capability/due-selection check. Only then present the concrete activation/configuration diff, measured cost and rollback for owner approval.
- Verify the first real exact UUID/native media/caption/slot and retained commercial flag. Count accepted active schedules separately from actual published posts, held drafts and uncertain deliveries. Do not infer a week's coverage from render counts or a manual NASA batch.

Rollback would disable only the new due dispatcher/opt-in mode, preserve exact-mode behavior, and retain all known/uncertain provider receipts, source claims and staging references for reconciliation. A timer change does not cancel already known Metricool schedules; those still require actual owner reconciliation/takedown.
