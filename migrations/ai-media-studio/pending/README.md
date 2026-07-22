# Pending AI Media Studio migrations

Files in this directory are review artifacts, not part of the authoritative
hashed migration manifest. They must not be applied or copied into the active
chain until a dedicated PostgreSQL 16 rehearsal, cross-agent review, and
explicit migration approval have all completed.

The PR28 pair prepares static HeyGen secret-reference bindings only. It performs
no provider verification, network request, spend, worker start, or deployment.

Disposable PostgreSQL 16 rehearsal:

```sh
npm run test:ai-media-heygen-static-postgres
```

The pair passed the exact PR1–PR27 chain, initial binding, rotation, and guarded
rollback rehearsal on 2026-07-22. It remains pending because promotion into the
hashed manifest and any non-disposable application require separate approval.
