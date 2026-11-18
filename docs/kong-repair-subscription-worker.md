# KONG repair subscription maker

This local worker consumes the private KONG repository's original, unedited,
owner-authored software repair issues. It uses the existing signed-in GitHub and
ChatGPT/Codex memberships. It does not need a new OpenAI API key or a local copy
of the server's HMAC credential. Existing HMAC RPC helpers are tested but are not
the enabled CLI transport.

## Admission and execution

The canonical source marker and SHA-256 digest must agree with the issue body,
the recomputed source task/error/generation repair key, company `kong`, exact
repository `robertmanzanillag-jpg/kong-nightlife`, and release branch
`codex/kong-production-recovery-20261117`. GitHub's `lastEditedAt` must be null.
The worker does not use GitHub `main`: its history is not the current production
release lineage. It checks the live release head against the approved immutable
source SHA before preparing, before invoking the model and before publication.
Changed release heads hold the generation instead of silently rebasing it.

An atomic create-only `codex/repair-claim/<repair-key-digest>` Git ref prevents
multiple makers from taking the same generation. The ref is never force-pushed
or deleted. Local 0600 journals record every potentially ambiguous write before
it occurs. Lost acknowledgements never trigger another model run or duplicate
PR. Other independent generations remain eligible. A stale lock or uncertain
journal requires reconciliation; do not delete either to force a replay.

The model receives a filtered source copy, without Git history, environment
files, credentials, nested worktrees or deployment configuration. Source files
containing recognizable credential patterns are omitted and cannot be replaced
by the maker. A named Codex
permission profile denies filesystem reads outside the workspace (except minimal
runtime paths), denies command network access, and keeps dependencies read-only.
A live OS sandbox probe must successfully write in the workspace and fail to
read a harmless outside canary before model execution. The signed-in CLI's
service traffic is separate from sandboxed command traffic.

Dependency preparation is a separate sandboxed deterministic stage: only
integrity-pinned HTTPS packages from `registry.npmjs.org`, with lifecycle scripts,
audit and funding requests disabled. The model has no GitHub or provider keys in
its environment, no inherited user configuration, and no live search. Nested
model agents, hooks and plugins are disabled for this bounded maker process.

Simple work uses explicitly selected `gpt-6-luna` with low reasoning. A bounded
security/auth/payment/concurrency repair uses `gpt-6.1-sol` with medium reasoning.
There is one model attempt per generation, a 15-minute model deadline, and at
most three reserved model runs per America/New_York calendar day. No stronger
model retry, API fallback, credit purchase or automatic budget increase exists.
The installed CLI catalog and sign-in were checked without making a model call;
catalog presence does not prove remaining subscription quota. CLI quota failures
remain failed work. No savings or productive improvement is inferred from them.

## PR and checking

Only bounded code, test and documentation changes can be copied to the checkout.
Package/config/policy/credential changes, symlinks and secret-like added content
are rejected. At least one changed regression test must run with Node 22 through
the same sandbox, with one or more passing test cases and zero failures. This is
a maker check, not an independent acceptance gate.

The host then opens a draft PR and re-reads its actual remote branch and head.
The issue's maker receipt references the exact repair key, PR and head. The
server independently validates these references. The resulting status is
`awaiting_checker`, never resolved or deployed. A separate reviewer, App QA,
approved deployment and observed production regression evidence are required by
the bridge before verified closure. This worker never merges or deploys.

## Review and activation

Before installation, run:

```sh
node --test tests/kong-repair-subscription-worker.test.mjs
node script/kong-repair-subscription-worker.mjs --readiness
node script/install-kong-repair-subscription-worker.mjs --plan
```

`--readiness` reports booleans only and does not consume or publish work. The
installer is plan-only unless explicitly invoked with the exact reviewed commit:

```sh
node script/install-kong-repair-subscription-worker.mjs --install --reviewed-sha <sha>
```

Installation requires a clean checkout on that exact commit and Node 22.23.0 at
the existing nvm path. It creates a separate runtime and one LaunchAgent with a
30-minute cadence, `RunAtLoad=false`, and no new credential. The output distinguishes
loaded from a verified first model run. Root coordination must review and approve
activation before invoking the installer. The worker has not been installed or
run against real repair work by these local tests.

To pause, `launchctl bootout` the exact installed plist. Preserve its journals,
claim refs and PRs for reconciliation; production rollback is outside this maker.
An existing installation is not silently replaced by this installer.

Official permission profile reference:
https://learn.chatgpt.com/docs/permissions
