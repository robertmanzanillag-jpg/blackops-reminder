# OAuth Provider Readiness

This is the durable provider-connection gate for AI Media Studio. It records what must be true before any OAuth callback route, real connector, refresh worker, revocation worker, or external publishing action is enabled. Current vault and saga code remains inert.

## Shared staged-connection contract

- Persist an immutable selected external target. Never select the first Page, Instagram professional account, or YouTube channel returned by a provider.
- Represent token artifacts by role rather than pretending every provider has an access/refresh pair. At minimum distinguish operational access, refresh, and grant-level user access artifacts.
- Represent lifetime as a discriminated value plus a mandatory revalidation horizon. Do not invent an expiry for provider-reported non-expiring Meta Page tokens.
- Validate `required scopes ⊆ actual grants ⊆ immutable provider allowlist`. Capabilities and manifest revision are derived locally from a frozen manifest and verified account tasks, never from provider JSON.
- Separate exchange, identity discovery/selection, activation, refresh, revoke and reconciliation into fenced durable stages. A token exchange that may have reached the provider is never retried automatically.
- Refresh always writes a new token-binding/credential-version candidate. Account CAS activates it before old material is scheduled for deletion.

PR15 implements the first six items as provider-neutral domain and persistence contracts through the explicit-selection handoff (`activation_pending`). It does not activate a provider account, store role-specific vault references, delete candidate tokens, mount a route, or call a provider. Refresh/revoke/reconciliation, vault schema v2 and final account CAS integration remain required before runtime wiring.

## TikTok Web

- Exact endpoints: TikTok authorization, `open.tiktokapis.com/v2/oauth/token/`, user-info identity and revoke endpoints only; HTTPS/443 and zero redirects.
- Web flow uses no PKCE verifier. Request only the scopes needed by the implemented publishing path; Direct Post requires `video.publish`, while `video.upload` is a separate inbox flow.
- Bind the exact returned `open_id`, actual scopes, Bearer token kind and bounded expiries.
- Refresh tokens may rotate and the new value must atomically replace the old value through a new credential version.
- Revoke is indeterminate after ambiguous transport failure; never report success merely because the request was sent.

## Google / YouTube Shorts

- Exact endpoints: Google authorization/token/revoke plus YouTube `channels.list(part=id,mine=true)` for identity. No provider-controlled URL or redirect following.
- Current confidential Web Server contract does not use a PKCE verifier. DPoP is a separate key/nonce lifecycle and remains disabled by policy.
- A new unattended publishing binding must obtain `youtube.upload` and a refresh token.
- Zero channels is not connectable. Multiple channels require an exact previously selected target; never choose the first.
- Refresh responses commonly omit `refresh_token`; omission preserves the existing value, while a returned non-empty value replaces it. Empty is invalid, not omission.
- Revocation can invalidate a project-wide grant, so shared-grant blast radius must be shown and approved.

## Meta: Facebook and Instagram with Facebook Login

- Facebook Login and Instagram-with-Facebook-Login are explicit grant families. They must never be mixed with Instagram Login scopes or endpoints.
- Keep Meta connectors blocked until one current Graph version is pinned and proven in a developer/test app. The existing v23 authorization manifest is not production approval evidence; v25 is the current sandbox-validation candidate recorded by the provider audit.
- Exchange yields a User grant, then bounded discovery returns Pages, Page tasks/tokens and linked Instagram professional identities. Activation requires an exact selected Page or Instagram ID and verified publishing tasks.
- Store the Page token as the operational artifact. Retain a grant-level User token only when an explicit lifecycle requirement justifies its broader blast radius.
- Meta has no generic refresh-token contract equivalent to TikTok/Google for this flow. Model revalidation/reauthorization rather than inventing refresh behavior.
- Local disconnect of one credential is distinct from grant-wide deauthorization, which may affect several Page/Instagram accounts.

## HTTP and sandbox gate

- Fixed scheme, host, path and method; HTTPS/443; zero redirects; no endpoint/proxy override; strict form bodies and redacted telemetry.
- Total connector deadline, bounded decoded streams, exact content type/status/schema and zero automatic retry for authorization-code exchange.
- Deterministic transport tests cover redirects, host substitution, oversized/chunked bodies, malformed JSON, partial scopes, identity ambiguity and secret redaction.
- Developer/test-app evidence must cover success, denial, partial consent, reused code, wrong client, zero/multiple/exact target, refresh semantics, revoke semantics and post-revoke failure.
- No code, token or client secret may appear in the database, logs, URLs, errors, snapshots or test output.

## Vault and infrastructure gate

- Authorization codes and long-lived tokens use application envelope encryption plus S3 SSE-KMS; PKCE remains a separate short-lived vault.
- Dedicated secret buckets/CMKs by environment and classification, exact bucket owner, Block Public Access, BucketOwnerEnforced, TLS-only, overwrite/list/copy denial and least-privilege roles.
- Buckets must be unversioned, or references/deletion must become exact-VersionId aware with noncurrent-version cleanup. A delete marker is not secret deletion.
- S3 `Expires` is metadata, not deletion. A durable bounded reconciler plus lifecycle fallback must remove expired code/PKCE orphans and terminal unreferenced token candidates without deleting active credentials.
- PR14 implements that reconciler as an explicit, non-autostarting worker with a relational obligation outbox, source revalidation, leases/fencing and two-pass exact deletion. Its migration remains unapplied and no production worker is wired.
- PR14 also provides an inert double-snapshot S3/KMS preflight. An attestation is necessary but not sufficient: reviewed IaC, effective IAM/Access Analyzer evidence, alarms and recovery drills are still required.
- The token secret reader is currently a soft TypeScript capability boundary. Production refresh/publisher workers need a separately scoped role/service before runtime wiring.
- CloudTrail/KMS alarms, inventory/config drift checks, key rotation/rewrap proof and recovery drills remain release gates.

No item in this document authorizes a live provider call, external post, migration apply or deployment.
