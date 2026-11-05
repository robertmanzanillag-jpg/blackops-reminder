# BlackRoom office integration candidate

## Scope and ownership

Built in an isolated branch on office PR 320 at c350bded, integrating BlackRoom PRs 316/317 at 13a32f8. No default branch, production instance, credentials, or concurrent KONG work is modified. Only generated codebase maps conflicted during integration and were regenerated.

New BlackRoom operations modules read persisted worker and analytics evidence. The existing council and owner-only panel consume that adapter. Existing company life, academy, explicit pause overrides, and approval gates remain in place. Supervision is enabled by default, but this does not start a publisher.

## Safeguards

- No second publisher or additional AI API calls.
- Queue totals do not prove current calendar coverage or completed work.
- Missing/stale/ambiguous metrics do not prove learning.
- Activity does not award career points without a durable single-use completion integration.
- The daily policy is 3–5 clips; proposals are not executed repairs or schedule mutations.
- Existing deletion and publication safeguards are unchanged.

## Release gate and remaining work

This is a supervision integration, not completion of always-on production. Current calendar reconciliation, unattended worker hosting, and automatic execution of recovery proposals require separate verification and implementation. No 24/7 claim is made. The existing local rendering/browser worker still needs its host online.

Replit deployment requires independent QA and Robert's approval after the final summary. Do not overwrite a newer office/KONG branch: fetch and reconcile the latest work first, then rerun checks.

Rollback: restore the prior deployment artifact. The adapter introduces no database migration or queue mutations; reverting its wiring removes supervision without deleting media or scheduled posts.
