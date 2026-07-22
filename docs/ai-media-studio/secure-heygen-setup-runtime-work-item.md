# Secure HeyGen setup runtime work item

## Goal

Make the initial 5–10 avatar launch operable so Robert later supplies only:

- `AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY` in the deployment secret manager;
- one HeyGen avatar-look ID and voice ID for each of 5–10 creators.

The setup materializes exactly ten blocked video slots per creator. It does not authorize a render.

## Agent ownership

| Area | Owner | Write boundary |
| --- | --- | --- |
| Secure reference registration | HeyGen onboarding agent | New provider-credential backend modules and focused tests |
| Explicit live verification | HeyGen verification agent | New GET-only coordinator/context modules and focused tests |
| Guided action center | AI Media Studio UI agent | Core Studio client modules and UI tests |
| Integration | Root maker | Shared public contracts, route/runtime wiring, agent pane and documentation |
| Review gate | Independent checker + security + App QA | Read-only diff, tests, routes and UI review |

Agents must not edit the same files concurrently or revert another owner's work.

## Ordered gates

1. Store the API key outside the browser and repository.
2. Register the allowlisted secret reference. This action does not resolve the secret or call HeyGen.
3. Enter 5–10 avatar-look and voice pairs. This creates 50–100 blocked slots.
4. Obtain separate approval for live read-only verification.
5. Verify the exact account, avatar looks, parent groups and voices through pinned HeyGen V3 GET endpoints.
6. Persist immutable verification evidence and keep generation blocked.
7. Prepare a durable account-specific maximum quote in a later PR.
8. Approve that exact quote in a later, quote-bound human approval.
9. Generate one selected canary only after separate cost approval.

## Non-effects in this work item

- no provider video POST;
- no quote or human spend approval;
- no budget reservation, render job or publishing;
- no migration application;
- no Replit deployment.

## Acceptance

- HTTP request bodies cannot contain a key, secret reference, provider account ID or provider-native IDs during reference registration.
- The server selects the single internal HeyGen account and fixed allowlisted secret reference.
- Registration is tenant-bound, idempotent, concurrency-safe and performs no network call or secret resolution.
- Sensitive POST actions require an authenticated same-origin JSON request.
- Verification is unavailable unless a trusted server-side authorizer is injected.
- Verification resolves all identities server-side and permits only the pinned GET-only provider verifier.
- Exact verification replay returns immutable evidence before secret resolution or provider I/O.
- Safe responses contain no API key, secret reference, provider-native ID or raw provider body.
- Focused, PostgreSQL where applicable, typecheck, build, checker, security and App QA gates pass before the draft PR is reported ready.
