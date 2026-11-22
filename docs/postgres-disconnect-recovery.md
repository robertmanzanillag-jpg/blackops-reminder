# PostgreSQL disconnect handling

`observePostgresPool` attaches listeners to the existing pool and its clients. It does not wrap queries, reconnect a checked-out session, retry work, or settle financial reservations. Idle errors are handled by pg-pool's normal removal and lazy replacement. Failed active queries retain the driver's rejection.

A dedicated Office ownership session is different: its disconnect aborts the worker. Startup awaits check cancellation before the next protocol check or provider probe, and the ownership verifier never treats a replacement session as the original advisory lock holder.

Diagnostics contain a fixed error code and bounded pool role only. Driver error text, stack, client and connection settings are excluded. Session-store pools retain their existing session middleware handlers. Readiness checks retain their existing semantics; containing an idle error does not itself establish database readiness.

The regression tests use the real pg client against a loopback synthetic server to close actual sockets during idle, checked-out and pending-query states. The financial regression retains an unknown reservation and refuses replay after a disconnect. Tests perform no live database/provider work.

Releasing this change requires the normal PR, independent review, CI, App QA and human Replit deployment approval. After deployment, verify the health endpoint, normal authenticated read and worker ownership/abort status. Do not simulate a production database failure or replay an uncertain job. Roll back by reverting the PR and deploying the prior reviewed build; no schema or ledger rollback is needed.
