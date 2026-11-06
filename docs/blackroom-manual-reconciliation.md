# Manual BlackRoom publication observations

The local evidence CLI now performs bounded **read-only** calendar checks before
writing its descriptive manual-delivery report. It reuses the scheduler GET
endpoint and existing `METRICOOL_USER_TOKEN` / `METRICOOL_USER_ID` configuration
already used by the publication bridge. It does not provision credentials,
purchase an API subscription, create posts, or modify the schedule.

The existing recurring CSV-export cycle invokes this CLI. The standalone
`refreshLocalBlackRoomEvidence` function remains offline unless its caller
explicitly selects `collectPublications: true`.

## Data flow

1. Read `agentDir/manual-planner-receipts.json` and up to 15 regular JSON files
   under the owner's `Documents/black room/output` with the exact workflow names
   `blackroom-observaciones-YYYY-MM-DD.json` or
   `blackroom-recibos-YYYY-MM-DD[-suffix].json`. An existing explicit
   `BLACKROOM_MANUAL_RECEIPTS_PATH` overrides discovery. Symlinks are not read;
   each receipt file is capped at 2 MB. No general Documents scan occurs.
2. Keep normalized creative metadata in `manual-clip-registry.json` for 90 days
   so rolling file discovery does not discard prior attribution. No caption or
   handwritten `publicationEvidence` is trusted as a publication receipt.
3. Request at most four eligible calendar days per cycle, fixed brand 6585226,
   last 30 days only, GET only, 6-second timeout each, no redirected credentials.
   Success and attempt timestamps are separate; failed days have a six-hour
   cooldown. A refusal preserves old confirmed mappings and a visible error.
4. Only `PUBLISHED` providers with matching official provider ID and HTTPS public
   URL can join an exact planner ID and network. Conflicting/reused identities
   are quarantined. Persist these in `publication-receipts.json`.
5. Join confirmed platform IDs to genuine CSV observations. Preserve actual
   publication/measurement times and the existing 24/72/168-hour snapshots.
   Missing metrics remain `awaiting-metrics`, never zero. Measured duration
   contradictions are quarantined.
6. Add `manualObservations` to `local-ceo-report.json` with DJ, source segment,
   duration, planned time, official ID, status and genuine observations. This is
   **descriptive only**: manual posts are not silently assigned to the controlled
   hook/duration test and cannot manufacture a winner in the editor.

## Deployment limits

Tests with an injected authenticated-response fixture validate the complete
collector-to-report path, not live credential entitlement or uptime. If Metricool
returns 401/403, this path stays pending with an error; do not represent that as
automatic learning and do not buy or bypass access. Existing confirmed receipts
remain usable. A powered local worker is still required; this change is not
24/7 cloud migration. Replit deployment requires approval after the QA summary.

Rollback: revert the reconciliation commit and restore the previous worker build.
No publication queue or media is deleted by this change. New metadata/report
files may remain inert; do not remove actual scheduling receipts.
