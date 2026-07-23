# One-video HeyGen sandbox execution chain

Status: design checkpoint only. No executor route, provider call, spend,
migration, publishing, or deployment is authorized.

## Current reviewed components

1. Secure static secret reference and GET-only HeyGen verification.
2. Exact plan/slot, approved script, avatar look, voice, governance, account,
   credential version, vertical MP4 render-spec, and immutable evidence binding.
3. Exact maximum-quote-to-human-approval bridge.
4. Provider-neutral quote-readiness projection shared by launch preflight and
   exact one-video execution control. For the current HeyGen adapter it reports
   `provider_terms_required` because no authoritative account-specific
   pre-generation quote is available; it performs no provider request or effect.
5. Daily admission repository that can atomically create a budget reservation,
   render job, and held outbox work after a complete authority snapshot.
6. Strict authenticated, exact-origin one-slot held-admission coordinator and
   HTTP boundary. It creates held work only and cannot activate or call HeyGen.
7. Held-work activation repository with a branded activation principal.
8. Admitted submit, terminal observation, renewable artifact resolution, and
   owned-storage ingest workers, composed with `autostart: false`.
9. Provider-neutral one-video run-once orchestration contract with an exact
   reservation/render/slot/attempt/handoff target, trusted server authorization,
   required durable fencing, process concurrency one, one stage per invocation,
   uncertain-outcome sealing, no global `runNext`, no publishing surface, and
   `autostart: false`. It is intentionally not mounted to HTTP or a live runtime.

## Missing dependency order

1. Authoritative account-specific maximum quote terms or provider quote.
2. Durable maximum-quote coordinator and trusted attestation source.
3. Current exact quote approval and authority snapshot.
4. Real PostgreSQL observation/replay rehearsal for the mounted held-admission
   boundary before its draft PR can merge.
5. Operator-authorized held-work activation coordinator.
6. Production runtime binding for the static HeyGen secret, account and
   credential version, database capability lanes, owned object storage, and
   artifact binding resolver.
7. Exact-claim database functions/adapters for submit, ambiguous reconciliation,
   terminal observation, ingest and asset linking. They must select the exact
   slot attempt/render target; the current global queue claims are not allowed
   behind the run-once boundary.
8. Durable implementation of the run-once fence and trusted Robert-bound
   authorization adapter.
9. Explicit production binding of those exact ports. This is the first step
   allowed to perform provider I/O and therefore requires a separate Robert
   approval and exact cost approval.

## Non-bypass rules

- A browser never supplies money, internal UUIDs, provider credentials,
  authority digests, reservation data, or activation capabilities.
- Public pricing, wallet balance, and script length are not quote evidence.
- Admission is not generation: provider I/O remains disabled after a held work
  item is created until a separate operator authorization activates and runs it.
- No automatic retry may resubmit an ambiguous provider request. Reconciliation
  must use the same provider idempotency key.
- A completed provider URL is ephemeral; the durable artifact identity is
  resolved again and copied into owned storage before delivery.
- Publishing remains a separate approval and connector boundary after ingest.
- The run-once contract cannot accept the existing global `runNext()` workers.
  A production binding is incomplete until every stage has an exact durable
  claim and returns the same reservation, render, slot, attempt and handoff
  identity supplied to the executor.
