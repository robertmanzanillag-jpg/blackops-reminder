# Canonical API budget source integrity v7

This is a **read-only integrity inventory**, not an installable backport or a deployment package.
Its explicit 39-source boundary covers the earlier public authority/transport sources, current
cache accounting helpers, the guarded Factory/Office callers and the shared monetary ledgers.
The active SHA-256 entries are maintained in reviewed pull requests whenever those sources
change. Adding or removing inventory entries requires review of the explicit verifier inventory;
a missing, duplicate, extra or mismatched entry fails the normal test suite.

The entire historical v6 package remains byte-for-byte frozen. Its 15 portable Python tests
run unchanged against test-only public postimages from exact commit
`96aae6c6718b437321031c4d3a418c94236020d5`; no historical configuration or private guard contents
are exported. Four original create payloads are reused without duplication. The legacy Clips
adaptation remains subject to the unchanged v6 exception and pinned reversible contexts.
A separate regression injects current SDK bytes into a synthetic v6 staging target and proves
that v6 refuses the drift without source writes or backups. Thus historical tests do not assert
that old v6 covers newer cache accounting, while current code retains exact integrity checks.

No release-gate control, known-failure allowance, original v6 file, provider configuration,
receipt, credential or runtime is changed by this inventory. Passing it does not reconcile
billing, approve prices, authorize an unknown replay, or establish production compatibility.
A selective deployment still requires fresh actual target preimages, review, QA and owner approval.
