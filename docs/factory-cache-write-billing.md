# Bounded OpenAI cache-write billing

This change adds code coverage, not pricing activation or a reconciliation checkpoint.
It creates no provider/key/model selection, credit, migration, or live request.
The existing unknown News execution and every historical hold remain unchanged.

## Explicit profile migration

OpenAI SDK/fetch callers require one complete,
operator-reviewed exact-model profile before any paid provider operation:

- `inputNanoUsdPerToken`, `outputNanoUsdPerToken`;
- `cachedInputNanoUsdPerToken` (explicit nonnegative rate);
- `cacheWrite30mNanoUsdPerToken`, `cacheWrite12hNanoUsdPerToken` (positive rates);
- `model`, `maxInputTokens`, `validUntil`, `evidenceSha256`.

No cache rate is inferred from another model or from ordinary input pricing.
For example, the operator must verify Sol's cached-read rate separately from Astra's.
OpenAI documents the dimensions and applicable TTL pricing in its
[prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).
An evidence digest is a required binding, not proof that somebody reviewed a quote.
OpenAI-compatible integration proxies are held before dispatch with
`FACTORY_API_INTEGRATION_PROTOCOL_UNVERIFIED`: an ordinary model/price match does
not establish their usage fields, service-tier behavior or cache billing protocol.
They need a separately reviewed provider-specific adapter; configuring a price
alone cannot create accumulating unknown paid attempts.

A complete explicit supplied profile remains pinned. Legacy Office callers that
supply only ordinary input/output pricing can migrate through a complete
`FACTORY_API_PRICING_CONFIG` row for the same provider/model, with exactly matching
ordinary input/output rates and every explicitly supplied cache rate/input tier. The entire catalog row is selected; fields and evidence
are never mixed with a partial profile. Ambiguous/missing rows or rate mismatches
fail closed. SDK/router clients without a supplied profile use the exact catalog row.
The Factory passes that same selected profile into its secondary cents accounting.
Office shared credits use the same profile, full serialized-request input bound and
privately correlated response cache counters; public Office usage metadata remains
unchanged. Token quotas still receive the original prompt size.

Until this migration is deliberately configured, affected paid callers report
`FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED`, `FACTORY_API_PRICING_PROFILE_MISMATCH`
or `FACTORY_OPENAI_CACHE_PRICING_REQUIRED` before dispatch. This is an explicit
hold, not a free fallback. Subscription, deterministic and local-model paths are unchanged.
DeepSeek retains its separate no-cache-write protocol; unexpected positive writes
are unpriced and cannot be silently settled. Gemini remains held as before.

## Up-front bound and immutable request

Request snapshots pin `service_tier: default` for covered OpenAI/integration calls.
Streaming, hosted tools, remote state and cache TTL overrides remain unsupported;
request fields cannot select another tier or retention policy behind the quote.
Because the reviewed text request permits no TTL override, the reservation covers
both documented write lifetimes: it uses the most expensive approved ordinary,
cached-read, 30-minute-write or 12-hour-write rate for the full existing conservative
input-token maximum (encoded request bytes plus 1,024 formatting tokens), plus the
configured output-token cap. That full input bound must fit the profile's explicit
`maxInputTokens` tier limit before dispatch; a short-context quote cannot silently
cover a long-context request. Measured input beyond that priced tier is unknown.
The input maximum is not the likely token count.
Missing any required rate stops before reservation/SDK/HTTP dispatch.

The Factory's free count still uses its narrow endpoint. Before generation, its
secondary grant checks the most expensive covered input bucket for the measured
count plus maximum output. The monetary authority independently reserves against
its byte bound and live parent escrow; a count does not grant paid admission.

## Verified usage and receipts

Covered responses require explicit `cached_tokens` and `cache_write_tokens`.
Positive writes require both `ttl_30m_tokens` and `ttl_12h_tokens`, whose sum must
match total writes. An explicit measured write total of zero can prove zero TTL
writes when the split is absent; absent totals cannot become zero. Reads plus
writes must not exceed input tokens. Unknown TTL fields, positive nontext dimensions,
missing/inconsistent counters, changed models, explicit non-default returned tiers
and unconfirmed responses retain the
unknown reservation and cannot be retried as free work.

Ordinary input is total input minus cached reads minus both write buckets. Each
bucket is priced once. Integer nanodollar arithmetic rounds the entire sum to
microUSD once; the historical Factory cents outcome rounds that measured amount
up to cents. The SDK result is detached before asynchronous settlement so a
provider-owned alias cannot later change the returned usage. Request evidence binds the complete profile, covered TTL policy,
input/output bound and parent fence. Settlement evidence also binds the exact
normalized usage, raw input-details digest, model and response ID.

No store methods or persisted authority schema change. Existing rows and receipts
are preserved. Full application builds must include the new cost/usage modules.
The frozen `script/office-api-budget-v6` copy does not acquire these changes and
must not be reused to claim cache-write coverage; use a separately reviewed updated
code bundle. Do not update that frozen package or initialize a new ledger to hide
an outstanding liability.

## Validation and remaining gates

Offline tests use explicit synthetic profiles, fake SDK/HTTP and synthetic monetary
stores. They do not establish current live rates or real model identity/usage.
Paid activation still requires complete historical attribution/checkpoint, reviewed
exact pricing, the existing workload/grant permissions, current deployment review,
and observation of the first authorized non-idle receipts. Reverting code never
permits deleting newer monetary evidence or releasing an unknown hold.

The conservative bound can legitimately exceed an existing small stage escrow.
For example, the current default write scope lists 721 paths; a 500-character
order produces 27,864 bytes of file-list text alone. At the documented Sol example
12-hour write rate of 5,000 nanoUSD/token plus 1,024 maximum output tokens at
10,000 nanoUSD/token, the minimum byte reservation is 154,680 microUSD before
instructions/schema. The approved discovery escrow remains 100,000 microUSD.
That case holds before paid dispatch; this patch never increases stage budgets.
The separately documented [exact free-count adapter](factory-counted-input-admission.md)
can tighten the input maximum with a private one-use exact-prompt/parent-fence-bound
receipt, without weakening the historical reconciliation gate.
