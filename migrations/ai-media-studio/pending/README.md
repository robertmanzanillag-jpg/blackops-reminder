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

Disposable PostgreSQL 16 rehearsal:

```sh
npm run test:ai-media-heygen-static-postgres
```

The pair passed the exact PR1–PR27 chain, initial binding, rotation, and guarded
rollback rehearsal on 2026-07-22. It remains pending because promotion into the
hashed manifest and any non-disposable application require separate approval.
