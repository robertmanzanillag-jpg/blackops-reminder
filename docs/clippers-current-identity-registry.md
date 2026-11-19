# Current Clippers identities and immutable historical receipts

The reviewed current publication registry has four destinations: TikTok
`6431685/streamersus`, `6431687/streamersclipusa`, `6591612/news305miami`, and
Facebook `6591612/1193011863901514`. NY remains excluded: a stored Page ID does
not prove an active OAuth connection. KONG and BlackRoom remain outside this
registry. This code does not connect accounts, grant media rights or change flags.

The 2026-11-19 read-only scoped Metricool settings evidence binds owner and
provider identity hashes. Current TikTok analytics additionally returns the
old Nov 18 video IDs with current share handles and an `openId` hash equal to the
current settings `providerUserId` hash. The public Swagger describes `openId` as
the connected account owning the video. This establishes video continuity; the
registry does not rewrite a historical handle, receipt, grant or digest.

`findDestination` accepts reviewed historical tuples for immutable evidence.
`findPublishDestination` accepts only current tuples. Only current destinations
are enumerated for new work. The adapter checks scoped settings via GET with
both `blogId` and the existing authenticated `userId`, and compares exact owner,
provider ID hash, handle/Page ID and explicit disconnection flags. It repeats
this check before each dispatch. It fails closed on missing/conflicting evidence.
No production verifier override or test option exists. Synthetic adapter tests
load the same code against a wholly synthetic identity catalog.

Historical aliases are grouped with their current brand/network solely for
capacity and no-replay comparisons. They do not create additional five-per-day
budgets or publication targets. Existing unknown delivery records remain held.
Fresh calendar and public publication coverage still determine actual daily
capacity; a rename does not create free slots. Render/rights/source grants must
be newly approved for the exact current destination; no old packet is relabeled.

The owner report accepts a complete historical four-account snapshot or a complete
current snapshot, never a mixed or duplicate alias set. Historical snapshots are
retained; the new producer emits only current targets. No native-upload parser,
quarantined allocation, auth, credential loader, sender or runtime configuration
changes are included. Numeric native-expiry v3 remains a separate offline proposal.

Validation uses fake transports and local temporary media/workspaces. No provider
writes, model calls or production installation are part of this PR. Revert this
PR's code as rollback; do not modify durable ledgers to accommodate a rollback.
