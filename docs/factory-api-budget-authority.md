# Factory API monetary authority — storage contract

The Factory allowance is US$100 per UTC calendar month, not a provider deposit.
`initializeMonth` remains explicit and immutable. This change does not initialize
any month, create a checkpoint, apply SQL, provision credits, or call a provider.

This is the **storage foundation**, not completed transport coverage. Provider SDK
wrappers and legacy/integration fallback admission must be connected in the next
change before enabling this authority for paid operation. Do not create a live
checkpoint from this PR alone. The unchanged legacy Factory path remains usable
without a new checkpoint; once an authority checkpoint exists its new positive
job escrows share the monetary limit with API reservations.

## Exact amounts and historical constraints

New API reservations and verified settlements use integer microUSD (1 USD =
1,000,000 microUSD). Existing Factory fixed/spent/reserved cents remain historical
constraints at their published precision. They are multiplied by 10,000, without
claiming reconstructed sub-cent usage. A parent Factory escrow includes child API
usage; children do not create another global debit. Parent settlement must cover
verified child costs and cannot release escrow with an unsettled/unknown child.
The existing parent outcome remains at its original cents precision.

The owner GET `/api/software-factory` keeps the legacy cents projection and adds
`apiBudget`: period, limit, fixed/spent/reserved microUSD, nullable remaining,
readiness, unknown hold, reason and reconciliation evidence digest. No checkpoint
means remaining is **null**, not US$100 or the legacy remaining balance. This
projection does not imply that historical provider charges have been reconciled.

## Manual reconciliation boundary

`checkpointApiMonth(owner, checkpoint)` is an internal operator method, not a new
HTTP mutation endpoint. SQL requires the prepared schema migration to be applied
by an operator; neither startup nor a request applies it. Object storage preserves
existing version-1 ledgers and adds an optional authority section using the same
conditional write and immutable receipt mechanism. Custom external store modules
must implement the new methods before updating the store-provider contract.

A checkpoint requires an already initialized current UTC month and an immutable
SHA-256 evidence manifest, reconciliation timestamp, exact external spent/reserved
microUSD and external unknown-reservation count. The manifest must establish all
attributable historical charges and open liabilities **outside** this Factory/API
ledger, with exact original IDs/receipts and a documented cutover coverage boundary.
Do not reimport charges already represented in the Factory or API ledger. External
reserved/unknown entries remain durable across months; a new checkpoint must not
repeat those same holds and cannot clear them. Resolving such liabilities uses only
the reviewed, append-only `api-unknown-resolve` action below. Neither
CSV aggregates, missing rows, current provider balance nor absence of a request is
proof of completeness. No automatic migration or import exists in this change.

News execution `2763c249-cd43-4ead-b6a0-111f6d76715a` remains quarantined. Its shared
hold must not be released, voided, replayed or presumed accounted by this budget.
If it is still externally unknown at reconciliation, record the external hold and
nonzero unknown count; new paid admission remains blocked. Deterministic work and
subscription work do not become paid API charges.

## Transactions and recovery

SQL API mutations use the same advisory transaction lock as Factory jobs. Object
mutations use the same generation-fenced CAS. Atomic admission combines the current
Factory budget, all prior-month open Factory/API holds, old Factory costs settled
this month, external liabilities, and API settled usage. Cross-month holds do not
expire. SQL's existing cents status/admission now also carry old Factory liabilities,
matching object storage; reconciliation records its settlement timestamp.

A stable reservation key plus request digest grants dispatch exactly once. A
previous reservation returns `admitted:false`, including after lost acknowledgment.
Ordinary settlement is idempotent only for the exact cost/evidence pair. Unknown
outcomes retain their full hold and require a separate reviewed recovery; there is
no API unknown-release helper here. Verified usage above its reservation records
an unknown overrun, preserves the reported amount/evidence and blocks new paid
admission instead of rolling back the evidence or silently freeing capacity.

Do not settle unverified usage as zero. Provider grants/token quotas remain extra
constraints and cannot increase this monthly allowance. SDK retries, streaming,
images/audio, missing pricing and fallback paths need explicit transport coverage
or a pre-dispatch hold in the integration change.

## Validation and rollback

Tests use in-memory CAS and fresh local PostgreSQL clusters over private Unix
sockets, never a production connection string. They cover concurrency, cross-month
holds, missing checkpoint, exact micro settlement/idempotency, parent escrow,
external unknown and Factory/API contention. No paid/model/network calls occur.

Roll back code before activating paid transports; preserve any existing authority
rows/objects and receipts. Never delete authority history or restore an old object
snapshot over newer financial records. An older external object adapter lacking the
new methods must fail selection rather than silently use a different budget.

## Operator actions (factory-ops)

- `status` now includes `apiAuthority`: month initialized, checkpoint present, fixed/spent/reserved
  microUSD, unknown-hold counts and `newsExecutionHold` (booleans/counts only; ids stay in code).
- `api-month-init` (dry run; `confirm=APLICAR` applies) calls the explicit immutable `initializeMonth`.
- `api-checkpoint` (dry run; `confirm=APLICAR` applies) builds the `checkpointApiMonth` input from
  `api_month`, `api_external_spent_usd`, `api_external_reserved_usd`, `api_external_unknown_count`
  and `api_evidence` (only its SHA-256 is stored or printed). It refuses while the News hold is
  still unknown unless that hold is recorded with a nonzero external unknown count and reserved amount.
  A checkpoint with a nonzero unknown count keeps paid admission blocked (`FACTORY_API_UNKNOWN_HOLD`)
  until `api-unknown-resolve` appends a reviewed resolution receipt for that hold.

## External unknown resolution (`api-unknown-resolve`)

Reviewed, operator-only and append-only. Dry run by default; writes only with `confirm=APLICAR`.
It targets ONE hold: the code-owned News execution id, or `api_hold_id`, which must match an
existing hold. It looks in every place the hold can live: the shared OpenAI credit ledger
(`agent_council_state`, Office key `office:<sha256(id)>`), the API authority reservations, and
external-checkpoint unknowns (a checkpoint reconciled after the shared row was created that still
has an unresolved unknown count). The amount always comes from an exact stored row, never from input.

- The hold is settled CONSERVATIVELY at its full reserved amount (assumed spent). It is never
  released, voided, refunded, replayed or settled for less; an overrun keeps its reported amount.
- Shared ledger: the ledger's own `settle(..., reconciliation: {executionStopped: true})` path.
- API reservation: the row is not edited; a receipt in `resolutions` makes it count as spent at
  its full amount instead of reserved and drops it from the unknown count.
- External checkpoint: the checkpoint stays immutable and its external reserved amount keeps
  counting every month; the receipt only reduces the effective unknown count by one.
- Each step first appends an immutable receipt (hold SHA-256, ledger, microUSD, evidence SHA-256
  from `api_evidence`, timestamp, policy) to `factory-api-unknown-resolution-receipts-v1`; API
  receipts are also stored in the authority state. Logs show digests and amounts only.
- Idempotent: a repeat finds the receipt and writes nothing; a different receipt for the same hold
  is `FACTORY_API_RESOLUTION_CONFLICT`. Reserved/settled (non-unknown) holds are refused.
- Admission uses the effective unknown count (`effectiveFactoryApiUnknown`), which excludes
  resolved holds. Factory jobs in `unknown` still block. Code that predates `resolutions`
  rejects the new state (fails closed); external store adapters must add `resolveApiUnknown`.
