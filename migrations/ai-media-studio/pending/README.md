# Pending AI Media Studio migrations

Files in this directory are review artifacts, not part of the authoritative
hashed migration manifest. They must not be applied or copied into the active
chain until a dedicated PostgreSQL 16 rehearsal, cross-agent review, and
explicit migration approval have all completed.

The PR28 pair prepares static HeyGen secret-reference bindings only. It performs
no provider verification, network request, spend, worker start, or deployment.

The PR29 pair adds immutable, verified-only account and roster-resource evidence
on top of PR28. The PR30 pair then adds an append-only bridge between one exact
human launch decision, one exact quoted amount/expiry, and one render-spec
digest. PR30 intentionally does not bind or backfill legacy human approvals.
PR28 and PR29 are exact prerequisites for PR30; all three pairs remain pending
and outside `manifest.json`. None may be applied without its own PostgreSQL 16
rehearsal, cross-agent review, and explicit migration approval.

The PR31 pair prepares the fail-closed, database-clock expiration of an exact
admitted-held handoff that was never activated or submitted. Its append-only
evidence binds the reservation, bucket, render, outbox, slot, tenant, provider
credential version, amount, expiry, and sealed request. The atomic transition
expires the reserved/not-started reservation and slot, moves the render to
`admission_expired`, cancels the held outbox, and releases only that reservation
from the bucket counter. Its only executable grant is the precreated,
table-blind `ai_media_held_expiry_executor`; every call additionally needs one
unexpired, unrevoked, tenant-bound, single-use capability for the session
principal. No role membership or capability row is provisioned by PR31. It has
no provider I/O, worker start, spend, publication, backfill, deployment, or
migration application.

The PR32 pair prepares a table-blind, single-command durable fence for the
unmounted exact one-video executor. A precreated NOLOGIN/NOINHERIT executor role
can call only three SECURITY DEFINER functions. Every capability is bound to the
session principal, tenant, actor, reservation, render, slot, attempt, handoff,
action, command and digest. The fence provides concurrency one, opaque lease
tokens, monotonic fencing, replay of completed commands, and terminal uncertain
sealing. It contains no exact worker claim implementation, provider I/O,
publishing, spend, deployment, migration application, or public route.

The PR33 pair stacks on PR32 and prepares four table-blind submit functions for
one exact live `activate_and_submit` execution: claim, authorize, record
confirmed, and record ambiguous. Every call binds the PR32 execution/lease/fence,
command digest, actor, tenant, reservation, render, slot, attempt, and handoff,
then requires exactly one matching live PR26 admitted-submit capability. The
claim is direct-target only and never scans or drains the global queue.
Authorization and outcomes retain the PR26 atomic budget, capacity, event, and
fencing transitions. PR33 performs no provider/network request, spend beyond an
already approved reservation, publication, worker start, deployment, migration
application, or public-route mount.

The PR34 pair stacks on PR32, PR26, and PR27 and prepares seven table-blind,
direct-target functions for one exact `reconcile_submission` or
`observe_terminal` execution. Reconciliation can claim only the ambiguity
bound to the exact reservation/render/slot/attempt/handoff, release an unknown
observation, record a confirmed provider job, or finalize a linearizable
no-submit result. Terminal observation can claim only the exact confirmed
submission, release a nonterminal observation, or atomically record the exact
provider terminal result. Every finalizer requires the live PR32 run lease and
the live inner reconciliation or terminal-check lease before invoking the
reviewed PR26/PR27 atomic transition. If that inner transition commits before
the outer PR32 fence is completed, the same live command may replay only exact
equivalent durable reconciliation or terminal evidence; mismatched evidence is
rejected without mutation. A completed terminal observation only
creates the existing durable ingest handoff; PR34 performs no provider/network
request, media download, ingest worker claim, publication, worker start,
deployment, migration application, or public-route mount.

The PR35 pair stacks on PR27 and PR32 and prepares a table-blind, direct-target
surface for the exact `ingest_asset` and `link_asset` commands. It can claim
only the ingest job already bound to the completed provider-terminal event and
the exact reservation/render/slot/attempt/handoff. Lease recovery is bounded;
completion and safe-code failure results are fenced and exact-replay aware.
The separate link command loads only that completed owned-object handoff, then
accepts only a ready, undeleted, tenant-matching canonical video whose checksum,
owned storage key, and render identity match before atomically completing the
render projection. PR35 does not download media, access a provider or object
store, create canonical media, publish, start a worker, spend, deploy, apply a
migration, or mount a public route.

The PR36 pair stacks on PR35 and adds one read-only, table-blind target lookup
for exact asset commands. The caller never supplies an ingest-job id: the
SECURITY DEFINER function derives the unique job from the live PR32 lease and
the completed terminal render's reservation, slot, attempt, and handoff tuple.
It grants only EXECUTE to the exact executor role and performs no provider,
network, storage, spend, publishing, startup, deploy, or migration-application I/O.

Disposable PostgreSQL 16 rehearsal:

```sh
npm run test:ai-media-heygen-static-postgres
```

The pair passed the exact PR1–PR27 chain, initial binding, rotation, and guarded
rollback rehearsal on 2026-07-22. It remains pending because promotion into the
hashed manifest and any non-disposable application require separate approval.
