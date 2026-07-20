# Source Snapshot and Script Variant Contract

AI Media Studio accepts a bounded snapshot instead of reading another Kong domain's tables directly. Supported source types are `events`, `restaurants`, `hotels`, `nightclubs`, `deals`, `travel_packages`, `beach_clubs`, and `experiences`.

## Endpoint

`POST /api/ai-media-studio/scripts/generate`

The authenticated request contains:

- `source`: type, internal ID, title, factual summary, and optional bounded context;
- optional `influencerId`;
- output `language`;
- optional preferred `angle`;
- `variantCount`, default 3 and maximum 5.

The response contains a primary `scriptSet` with `title`, `hook`, `script`, `cta`, `caption`, `hashtags`, `seoKeywords`, and `angle`, plus stable-ID variants with the same creative fields. `generation` states whether the deterministic generator or a cost-gated strong model produced the result and reports estimated cost.

The executable contract is `shared/ai-media-studio-scripts.ts`.

## Execution policy

The deterministic generator is the default, costs `$0.00`, and must produce repeatable output from the same normalized input. A strong model is optional and remains disabled unless all of these are true:

1. the dedicated feature flag is explicitly enabled;
2. the request passes a dedicated media risk and cost-reservation policy;
3. the configured budget has capacity;
4. no publishing or paid-rendering action is implied.

Strong-model failure falls back to deterministic generation without silently charging another provider. Source snapshots must contain public/business facts only—never credentials, customer data, or arbitrary provider payloads.

The current `server/ai-router.ts` is only a web-chat routing classifier; it is not an execution or budget-reservation abstraction and is intentionally not called by this endpoint.

## Non-goals for this slice

- No database persistence or autonomous source ingestion.
- No render is automatically started from a generated script.
- No publishing or external posting.
- No claim that model-generated facts are verified; generated copy must stay grounded in the supplied snapshot.
