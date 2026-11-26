# KONG DJ invitation coordinator

The company now has one **Invitaciones a DJs** desk in KONG Growth. Its career is
the same `kong:dj_invitations` record used by the company and the factory's full
life roster. It is an external local coordinator, not an office cloud worker.
The original Apps Script remains the only sender. Opening the desk, importing a
receipt or running the office never sends mail or starts another coordinator.

The authenticated owner opens **Invitaciones a DJs** in `/agents-office` and
pastes a metadata receipt. The form saves and independently rereads the exact
stored receipt hash through the normal owner-only route. The existing council
transaction store persists it; no new credential, service or database migration
is introduced. Receipts contain no artist names, recipient addresses or message bodies.

The receipt binds the existing coordinator owner, sender account, Apps Script and workbook hash. It separates
reviewed, pending, excluded, admitted and actually sent counts. Sends require a
distinct Gmail receipt hash per invitation and original-time-driven provenance.
The endpoint validates metadata consistency, not Gmail contents: this is an
owner-attested result with a manifest retained by the coordinator, not a claim
that the office independently accessed Gmail or validated a legal basis.

Sequence and previous hash provide an append fence. Exact retries are no-ops;
conflicting retries, old run IDs, repeated send-receipt hashes across runs, backwards
source cursors/fences/revisions and future/stale observations or completed work
fail closed. Importing a receipt cannot change another agent's career or life.
History is append-only; at 1,000 receipts
the importer stops for an explicit archive protocol rather than deleting it.

New completed review/admission/send work with distinct evidence can score once
through the existing company rules. Pure hashes, readiness and heartbeat checks
earn no points. This external desk has no verified server-executable turn, so
configuration or transport downtime does not subtract life. It is never shown
as executing now merely because a receipt or schedule exists. Existing academy,
life-zero review, permissions and independent review rules remain in force.

This change supplies reporting and company/factory registration only. Actual
recipient qualification, fresh all-folder suppressions, approved append-only
admission, compatible resume and real original-clock Gmail receipts remain the
local coordinator's responsibility. There is no claim of cloud 24/7 operation.

Rollback: revert this integration's files together. Preserve the optional
`kongInvitations`/`kongInvitationHistory` fields in stored council history;
rollback must not delete them or resend any invitation.
