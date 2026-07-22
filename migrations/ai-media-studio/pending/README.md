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

Disposable PostgreSQL 16 rehearsal:

```sh
npm run test:ai-media-heygen-static-postgres
```

The pair passed the exact PR1–PR27 chain, initial binding, rotation, and guarded
rollback rehearsal on 2026-07-22. It remains pending because promotion into the
hashed manifest and any non-disposable application require separate approval.
