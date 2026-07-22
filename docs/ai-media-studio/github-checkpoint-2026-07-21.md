# AI Media Studio GitHub checkpoint — 2026-07-21

Purpose: preserve the current AI Media Studio delivery state in GitHub before the active Codex session loses context or credits. It does not deploy, apply migrations, call providers, post to social platforms, create live OAuth sessions, or touch secrets.

## Production KONG reader and source scheduler checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-kong-http-scheduler`, stacked on draft PR #173.
- Reader: production composition uses only the exact public HTTPS KONG feed from draft `kong-nightlife#117`. It rejects credentials, IP literals, non-443 ports, redirects, mixed/private DNS answers, non-JSON responses, oversized/chunked bodies, malformed v1 envelopes and non-canonical cursors. The selected public address is pinned while TLS retains the exact hostname.
- Durable automation: one tenant-scoped `ai_media_orchestration_runs` row stores the opaque server cursor and uses atomic `SKIP LOCKED` claims, leases, fencing, bounded retry/backoff, terminal dead-letter and replay-safe content hashes. A production-only 15-minute loop runs after server startup and resumes pages without browser input. Agent Control exposes only safe runtime state, page/cycle counters, attempts and failure codes; it never exposes the cursor.
- Draft-only effects: exact curated KONG rows receive content-hash-bound `owned`/`approved` attestation. After a complete feed cycle the existing server-owned source-to-batch service may persist deterministic draft scripts for the current 5–10 × 10 blocked plan. Script approval, render, outbox, HeyGen/video-provider calls, secret resolution, spend, publishing, migration application and deployment remain absent.
- Evidence: reader/scheduler/API regression passes 38/38, source-to-batch passes 12/12, Agent Control passes 6/6, TypeScript, production build, regenerated codebase map and diff hygiene pass. Independent checker and App QA rechecks report P0=P1=P2=P3=0. Git commit/push and the stacked draft PR remain before this checkpoint is preserved remotely.
- Release order: clear the separate KONG baseline CI repair, merge/review the feed, separately approve/rehearse the existing PostgreSQL migration chain, deploy KONG first and BlackOps second only after Robert approves each Replit deployment. Live HeyGen GET verification, maximum quote, exact one-video cost approval, one real generation, 5×10 spend and publishing remain separate approvals.

## Durable source-to-batch automation checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-source-to-batch-automation`, draft PR [#173](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/173), stacked on draft PR #172.
- Implemented locally: strict source automation endpoint `POST /api/ai-media-studio/automation/sources/production-batch/prepare` that reads the current 5–10 creator production batch and, only when it is `not_started`, invokes the existing durable production batch preparation with a server-owned idempotency key.
- Safety: the browser sends an empty JSON body only. It cannot choose plan IDs, source IDs, provider IDs, cursors, idempotency keys, render/spend/publish flags or adapter configuration. The server constrains source selection to `kong-owned-catalog` rows that are accepted/ready, owned/licensed and moderation-approved.
- Effects remain blocked: the endpoint may persist deterministic draft scripts and selected variants for blocked slots. It records no script approval, render job, outbox command, video-provider/HeyGen call, secret resolution, spend, publishing job, migration application or deployment.
- Evidence so far: source-to-batch focused group 12/12; production-batch/source/source-to-script regression 110/110; TypeScript pass; production build pass; codebase map and diff hygiene pass. The build retains inherited warnings for large Clippers chunk and local yt-dlp/Python packaging.
- Independent final checker: P0=P1=P2=P3=0 after explicit missing-Origin and non-JSON route coverage. The curated upstream KONG feed is preserved separately in draft PR [kong-nightlife#117](https://github.com/robertmanzanillag-jpg/kong-nightlife/pull/117), also with independent P0=P1=P2=P3=0 and 8/8 focused tests.
- Remaining gates: fail-closed HTTP reader/composition, durable scheduler/cursor loop, PostgreSQL rehearsal and every HeyGen/spend/publishing/migration/deploy approval remain separate.

## Tenant-safe source automation sync checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-source-automation-sync`, preserved in draft PR [#171](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/171) and stacked on draft PR #170.
- Boundary: strict authenticated exact-origin JSON POST synchronizes only a server-registered adapter key and a 1–100 limit. Provider cursor/native configuration never enters or leaves the browser. Tenant identity comes from the sealed session principal.
- Data behavior: the complete snapshot is validated and copied into plain DTOs before any content-hash upsert. Replays deduplicate within one tenant and the public result exposes only Studio-owned IDs, category and blocked governance states.
- Review corrections: private adapter/repository errors are normalized to redacted 503 responses without generic logging; impossible dates cannot create partial writes; mutable adapter configuration, getters and nested payloads are copied in one pass before persistence.
- Evidence: root final 44/44; checker 26/26 plus HTTP 4/4; security recheck 17/17; App QA 36/36; P0=P1=P2=P3=0; TypeScript, production build, codebase map and diff hygiene pass.
- Safety and next gates: no production reader or scheduler was activated. The sync creates no scripts, render/outbox, video-provider/HeyGen call, secret resolution, spend, publishing, migration or deployment. The stacked source-to-script slice adds an injected provider-neutral Kong adapter boundary; a production reader, durable server-side cursor/scheduler and durable source-to-batch consumer remain separate reviewed slices.

## Source eligibility and script preview checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-kong-source-to-script`, preserved in draft PR [#172](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/172) and stacked on draft PR #171.
- Implemented locally: an injected provider-neutral Kong reader adapter for all eight source categories, exact-content source eligibility review, deterministic source-to-script preview over persisted Studio sources and the operator UI for those safe actions.
- Safety: review requires strict real-session exact-origin JSON, current `contentHash`, tenant scope and idempotency. Script preview accepts only Studio source IDs and bounded script options, and rejects sources unless they are accepted plus owned/licensed and moderation-approved.
- Effects remain blocked: no durable script insert, orchestration run, render/outbox, video-provider/HeyGen call, secret resolution, spend, publishing, migration application or deployment.
- Evidence: 75/75 focused non-HTTP checks and 18/18 authenticated HTTP checks pass; TypeScript, production build, codebase map and diff hygiene pass. Independent checker/App QA reports P0=P1=P2=P3=0 and no remaining actionable finding.
- Remaining gates: keep PR #172 draft and unmerged, then separately implement and rehearse the production Kong reader, durable scheduler and source-to-batch consumer. HeyGen verification, generation, spend, publishing, migrations and deployment remain separately approved gates.

## HeyGen roster mutation hardening checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-roster-mutation-hardening`, preserved in draft PR [#170](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/170) and stacked on draft PR #169.
- Boundary: roster POST now requires a real authenticated session, explicit server-owned exact origin, `same-origin` browser metadata and JSON before onboarding readiness or persistence. Tenant identity comes from the sealed principal; fallback identities, cross-origin requests, query/transfer transport and unknown private fields fail closed.
- Compatibility correction: held admission retains its dedicated canonical origin when both held-specific and general Studio origins are configured. Independent review found and closed this P2 before the PR was opened.
- Robert handoff: the UI lists only the exact secret variable name `AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY`, 5–10 creator names, one avatar-look and voice ID per creator, adjustable language/accent/gender defaults, and exactly 10 blocked no-spend videos per avatar. The secret value never belongs in chat, GitHub or UI fields.
- Evidence: root focused suite 41/41; checker correction recheck 14/14 with P0=P1=P2=P3=0; App QA 43/43 plus 17/17 correction recheck; TypeScript, production build, codebase map and diff hygiene pass.
- Safety and next gates: no secret value, provider call, generation, spend, publication, migration application or deployment occurred. Keep PR #170 draft and unmerged; real PostgreSQL rehearsal, live GET-only verification, authoritative quote, exact one-video approval, canary generation, batch spend and Replit deployment remain separate approvals.

## Active local work: one-video sandbox readiness

- Branch: `codex/ai-media-studio-one-video-sandbox-readiness`, preserved in draft PR [#147](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/147) and stacked on draft PR #146.
- Read boundary: authenticated `GET /api/ai-media-studio/production-batches/:planId/sandbox-readiness/:slotId` returns one exact approved plan/batch/slot packet. It contains a `9:16` vertical preview, six local readiness gates and five external pre-execution requirements. Generation, sandbox execution, provider submission, admission, spend and every effect remain structurally false.
- UI and preflight boundary: the workbench requires an explicit approved-slot selection and exposes no Execute, Generate or Spend action; a browser test covers the selection/click path. Malformed 5–10 × 10 preflight data returns a structured fail-closed repair outcome rather than a misleading launch observation.
- Offline runtime evidence: an owned disposable PostgreSQL 16 cluster applies the exact manifest-bound 22-pair chain, seeds a genuine 5-avatar × 10-slot batch with all 50 scripts approved, and runs exactly one slot through the real admission, held activation, terminal and ingest workflow with an injected fake provider. The proof records exactly one fake submit, a completed terminal result, durable canonical asset/render linkage and zero publishing jobs/publications. PostgreSQL 16 fixes cover casts, advisory-lock JSON input and the complete PR27 projection.
- Honest proof boundary: the fake provider proves the local durable pipeline only. It does not prove HeyGen connectivity, live billing/quota, external object storage/callbacks, production capacity, migration application or deployment.
- Final evidence: focused checks pass 59/59; authenticated routes pass 4/4; browser passes 1/1; PostgreSQL 16 passes 1/1; TypeScript, production build and diff hygiene pass. The full suite ran 812 cases: 811 passed and only the inherited PR26 wording-regex case failed. Independent checker, security and App QA report P0=P1=P2=P3=0 after correction of one P3 test gap.
- Safety boundary: no real API, secret, network/provider call, credit spend, migration application, deployment or publication occurred or is authorized.
- Next gates: keep draft PR #147 unmerged; then Robert supplies the HeyGen API key through the approved secret manager plus 5–10 avatar and voice IDs. Complete live provider verification, a maximum quote, owned-storage and callback readiness, and explicit one-video cost approval before generating one real video. Only after that proof may the 5 × 10 canary proceed under separate batch-spend and Replit deployment approvals.

## Secure HeyGen onboarding checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-heygen-onboarding-readiness`, preserved in draft PR [#148](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/148) and stacked on draft PR #147.
- Added: secret-manager-reference-only credential binding; exact rotation; read-only onboarding status; pending 5–10 avatar/voice intake; exactly ten blocked slots per avatar; inactive/non-selectable pending resources.
- Safety: no key value in HTTP/database/logs, no HeyGen/network call, no provider verification, no migration apply, no generation, no credit spend, no publishing and no deployment.
- Evidence: final App QA targeted 44/44, PostgreSQL 16 pending PR28 rehearsal 1/1, TypeScript/build/map/diff pass, checker/security/App QA P0=P1=P2=P3=0.
- Next gates: place the API key only in the deployment secret manager, supply 5–10 avatar/voice ID pairs, and separately approve read-only live verification. Quote, one-video cost, 5 × 10 spend, publishing and Replit deployment remain separate approvals.

## Held one-video admission checkpoint (2026-07-22)

- Branch: `codex/ai-media-studio-one-video-held-admission`, preserved in draft PR [#169](https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/169) and stacked on `codex/ai-media-studio-quote-readiness`.
- Mounted boundary: authenticated no-store GET readiness and strict authenticated same-origin JSON POST admission are mounted. The POST accepts exactly five public CAS fields, revalidates the tenant and every server-owned gate, and can create only an internal held reservation/render/outbox tuple. It cannot activate work or contact HeyGen.
- Durable replay: an identical authenticated retry reads the original tenant-bound held tuple before the planned-only loader, returns the same opaque reservation receipt with every per-call creation effect false, and creates no duplicate rows. Changed tenant, public CAS, slot attempt or idempotency binding fails closed. GET continues to show held or expired state after admission without turning either state into generation authority.
- Initial launch shape: readiness requires one approved 5–10 creator batch with exactly ten slots per creator, or 50–100 planned videos. The work remains provider-neutral; HeyGen is present only as an unavailable account-specific quote adapter until later approved setup and verification.
- Evidence: the maker's final 83/83 integral held-admission, strict-origin and isolated browser tests pass, including authenticated HTTP, replay isolation, read-only PostgreSQL projections, UI/client contracts, pending PR31 expiry artifacts and server-owned authorization. The independent checker separately passed 62/62 focused cases; App QA passed its corrected client/UI/HTTP gate 13/13 for a draft checkpoint. TypeScript, production build and diff hygiene pass. The missing real-PostgreSQL query rehearsal remains an explicit pre-merge caveat.
- Safety: no API key or secret was stored, no provider request or generation occurred, no external spend was committed, no publication was created, no migration was applied and no deployment was performed. PR31 remains pending and unapplied.
- Next gates: keep PR #169 draft and unmerged; add a real PostgreSQL opt-in/rehearsal for the two new Drizzle observation queries before merge; obtain review of the stacked chain; separately approve the named migration rehearsal; then Robert stores `AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY` only in the deployment secret manager and supplies 5–10 avatar-look/voice ID pairs. Read-only HeyGen verification, authoritative maximum quote, exact one-video cost approval, one canary generation, 5 × 10 batch spend and Replit deployment each remain separate approvals.

## Active local work: offline launch preflight

- Branch: `codex/ai-media-studio-offline-launch-preflight`, draft PR #146, stacked exactly on draft PR #144.
- PR #144 bridge: the authenticated production-batch workbench now requires one explicit review confirmation per creator, covering all ten selected scripts for each of the exact 5–10 creators. Only the resulting exact `approved_ready` plan/batch identity enables the preflight read.
- Read boundary: `GET /api/ai-media-studio/production-batches/:planId/launch-preflight` derives one coherent PostgreSQL-clock observation with exactly 14 ordered gates: batch integrity, plan window, source eligibility, local provider binding, governance coverage, launch intent, content approval, policy/kill switch, live provider verification, maximum quote, sandbox proof, human launch approval, authority snapshot, and budget/admission capacity. Every gate preserves the 5–10 × 10 shape (50–100 slots) and returns only bounded state, reason, counts and safe next-action codes.
- Safety boundary: the response is `source=derived_read_only`, `canGenerate=false`, `sandboxExecutionAllowed=false`, `spendAuthorized=false`, `noSpend=true` and `authoritativeForAdmission=false`. All seven effect flags are false. The GET creates no intent, evidence, snapshot, reservation, render or outbox row; it calls no provider and cannot apply a migration, spend, publish or deploy.
- UI boundary: the 14 gates appear only after exact batch approval, with per-gate state, progress and safe in-page recovery guidance. Refresh remains a credentialed GET with no automatic retry or focus refetch. Script approval is explicitly not launch approval.
- Review corrections: source eligibility now requires the persisted source title, future `valid_from` policy/kill-switch revisions do not pass the observation, and budget/concurrency capacity follows admission-aligned active-capacity semantics. Creator confirmation changes only `confirmedMemberIds`; approval success/focus remain sequenced by the approval transition, and the mutation resets only after an external batch identity change.
- Final evidence: focused checks pass 54/54; authenticated route checks pass 2/2; the owned PostgreSQL 16 exact-chain check passes 1/1; TypeScript and production build pass. The final full AI Media Studio run contains 791 tests: 749 pass, 1 inherited PR26 wording-regex failure and 41 skip; this branch does not modify that baseline test.
- Remaining gates: preserve and review the draft GitHub handoff; keep all 22 migration pairs unapplied until an explicitly approved staging rehearsal; complete real provider verification, governance/launch evidence, quote, sandbox, human approval and budget admission through their separate controlled capabilities; then obtain separate spend and Replit deployment approval. No external setup, provider call, migration, spend or deployment is requested here.

## Active local work: durable script review and launch readiness

- Branch: `codex/ai-media-studio-launch-readiness`, preserved as draft PR #144 and stacked on mergeable draft PR #141. Local checker, security and App QA gates are complete.
- Review boundary: every selected variant exposes its full persisted video title, angle, hook, script, CTA, caption, hashtags and SEO keywords in the authenticated production-batch workbench. Approval requires an explicit acknowledgement and covers the exact complete batch atomically: 5–10 creators × exactly 10 scripts each (50–100).
- Durable transition: one tenant-scoped, database-locked transaction binds the expected batch, selected-variant content checksum and canonical full-creative digest (including Video Title), records exact approval metadata and PostgreSQL time, promotes all scripts and only their selected/current variants plus their plan/slots together, and rejects partial, stale, ineligible, conflicting or cross-tenant work. Unselected alternatives remain `draft` without approval metadata. Replay is exact; the public projection remains provider-neutral and keeps `canGenerate=false` and `noSpend=true` after approval.
- Safety boundary: this approval is content readiness only. It issues no governance/content authority, human launch authority, launch intent, sandbox or quote attestation; reserves no budget; creates no render job or outbox command; calls no provider; spends nothing; applies no migration; publishes and deploys nothing.
- Evidence complete for the local slice: focused service/repository/contract/client/UI checks pass 20/20, authenticated HTTP checks pass 2/2, the owned PostgreSQL 16 harness passes 1/1 after applying the exact manifest-bound 22-pair chain, and TypeScript plus production build pass. PostgreSQL coverage includes approval-time source rights/moderation/status revocation, post-approval CTA/Video Title/current-variant-pointer tamper rejection, and proof that 100 selected variants are approved while all 400 alternatives in a 10-avatar × 10-slot × 5-variant fixture remain draft without approval metadata. The final full AI Media Studio run records 722 passed, one inherited PR26 wording-regex mismatch and 40 controlled PostgreSQL-only skips out of 763. The owned HeyGen/client set passes 13/13. Independent checker, security and App QA are clean at P0=P1=P2=P3=0; App QA reports no slice warning.
- Exact remaining gates: draft GitHub handoff and later reviewed merge; named staging backup/apply/restart/rollback rehearsal for the still-unapplied migrations; server-side governance/content approval and launch-intent/snapshot authority; provisioned budget plus quote/sandbox attestations; verified HeyGen credentials/account/quota/billing; one separately cost-approved one-video sandbox; then separate batch-spend and Replit deployment approvals.

## Reviewed checkpoint: durable production script batch

- Branch: `codex/ai-media-studio-durable-script-batch`, commit `258b969f`, preserved as mergeable draft PR #141 and stacked on reviewed draft PR #136.
- Target: select exactly ten tenant-eligible Kong sources, persist deterministic draft scripts for every one of the 50–100 blocked slots, and expose a provider-neutral production-batch workbench.
- Safety boundary: plan and slots remain blocked; no budget reservation, launch intent, render job, outbox command, provider submission, network call, spend, publication, migration application, secret change or deployment is authorized.
- Evidence complete: focused contracts/routes/UI and legacy-bypass checks pass; owned PostgreSQL 16 applies the exact 22-pair chain and proves 5→50, 10→100, replay/concurrency, tenant isolation, source refresh, late rollback and zero launch side effects; TypeScript, production build and the refreshed codebase map pass. Independent checker and App QA are P0=P1=P2=0 after two fixed UI error-message findings. The inherited Clippers chunk warning remains a deployment-only blocker; no merge or deployment is requested.

## Active local checkpoint: durable 5–10 avatar roster plan bridge

- Branch: `codex/ai-media-studio-durable-roster-plan-bridge`, preserved as draft PR #136 and stacked on draft PR #131. No merge, migration application, provider activation or deployment is implied.
- Scope: one account-row-locked roster transaction persists the private catalog bindings, one blocked daily plan and exactly 10 blocked slots per avatar in the existing PR19 tables. The initial 5-avatar configuration yields 50 slots and the launch cap of 10 yields 100.
- Authority boundary: PostgreSQL supplies the timestamp; the server supplies the canonical IANA accounting timezone. Tenant, provider account, credential version, roster, member, influencer, avatar and voice bindings are checked on write and durable read. Exact replay does not duplicate the plan or slots, while a changed payload conflicts.
- Safety boundary: the public plan keeps only opaque keys and `not_queued`, `canGenerate=false`, `noSpendGuarantee=true`. No budget reservation, render job, outbox command, provider submission, HeyGen/network call, migration application, spend, publication, secret change or deploy is introduced.
- Current evidence: focused service, in-memory, Drizzle and dedicated-agent checks pass; authenticated HTTP routes pass 2/2; TypeScript, production build, generated codebase map and diff hygiene pass. An owned ephemeral PostgreSQL 16 harness verifies every SHA in the 22-migration manifest and passes 1/1 for concurrent exact replay, 5→50, 10→100, cross-tenant isolation, late-failure rollback and zero budget/render/outbox/provider-submission rows. Independent checker and App QA pass at P0=P1=P2=0 with no warnings from this change. The full suite records 700 pass, 38 controlled skips and one inherited no-diff PR26 message-regex mismatch (`otherwise forward-fix` versus `otherwise stop and forward-fix`); both baseline files are unchanged by this branch.

## Active local checkpoint: reviewed PR1 foundation and full migration chain

- Scope: `20260720_pr1_foundation_forward.sql` and its guarded rollback close
  the missing local baseline artifact. The source is pinned to foundation commit
  `8b30f184`, blob `4678f3b60595fe272ce11999806a4634317edb03` and
  source SHA-256 `560ac47625eb1a14297a5a5d127be7cc267d5de3c1943d51ea7e19640be1972d`;
  `migrations/ai-media-studio/manifest.json`
  records the exact SHA-256 provenance and order of all 22 forward/rollback
  pairs through PR27.
- Rollback boundary: PR1 rollback is empty-baseline-only. It runs last, fails
  closed if later state or evidence remains, and cannot erase evidence preserved
  by any later data-preserving rollback.
- Review evidence: the focused PR1/runbook checks pass 8/8, including exact
  source provenance, 18-table/20-foreign-key/38-index shape and guarded
  empty-baseline rollback. The manifest/full-chain command passes 7/7: four
  exact inventory/hash/security checks plus live disposable PostgreSQL proof of
  PR1-only rollback, all 22 forward pairs through PR27, and the mandatory
  evidence-preserving reverse stop before PR26. Before that final rollback
  hardening, the complete AI Media Studio suite passed 699 with 0 failures and
  36 controlled skips out of 735; the final delta then passed the 14 focused
  contracts, PR26 PostgreSQL 7/7 and TypeScript. Production build, generated
  codebase map and diff hygiene pass. Final independent checker/App QA remain
  pending for the combined diff.
- Status: **NO-GO**. Local provenance does not authorize staging access or prove
  compatibility with a named restored catalog. No migration, `db:push`, role,
  provider call, spend, publication, secret change or deployment occurred.
- Launch boundary: 5–10 HeyGen avatars with exactly 10 videos each (50–100)
  remains blocked behind staging evidence, one separately approved one-video
  sandbox, App QA, explicit batch-cost approval and separate Replit approval.

## Active local checkpoint: PR16A provider activation integrity

- Branch: `codex/ai-media-studio-pr16-schema-integrity`, draft PR #121, stacked on draft PR #118. Initial checkpoint commit: `e7b2b7ab`; no merge, migration or deployment is implied.
- Scope: one additive, unapplied forward/rollback pair binds provider account, attempt, exact selection, target, role-specific artifacts and cleanup obligations. A database-derived canonical authorization digest matches the TypeScript contract, non-retained cleanup stays actionable, and ambiguous/abandoned evidence remains immutable.
- Provider proof: isolated PostgreSQL 16 accepts the exact TikTok role pair and the Meta `grant_user_access` exchange to one target `operational_access` artifact transformation. It rejects partial roles, altered scopes, arbitrary authorization digests, inert cleanup deadlines, contradictory lifecycle pairs and null/invalid token lifetimes.
- Evidence: focused checker suite 36/36, PostgreSQL 16 harness 7/7, final full suite 674 passed/0 failed/31 skipped of 705, TypeScript and production build pass. Combined with the seven separately executed PR16A PostgreSQL cases, final evidence is 681 passed and 24 older PostgreSQL-only skips. Independent checker and App QA are P0=P1=P2=0.
- Safety boundary: PR16A is unmounted and unapplied. PR16B is now preserved in draft PR #124 with clean review evidence, but it too remains unmounted and unapplied. No database outside the destroyed local harness, secret, provider, spend, publication or deployment was touched.

## Active local checkpoint: PR30 staging rehearsal runbook

- Branch: `codex/ai-media-studio-staging-rehearsal-runbook`, draft PR #118, stacked on draft PR #116. Initial checkpoint commit: `bdd1f2fd`. This is documentation/static validation only; it does not authorize or perform a database connection.
- Runbook: `docs/ai-media-studio/staging-rehearsal-runbook.md` defines named approvals, immutable evidence, read-only preflight, backup/isolated restore, one-file-at-a-time forward order, restart with provider workers off, exact reverse order, stop conditions and the separately approved one-video handoff.
- SQL inventory: the reviewed-local PR1 baseline expands the manifest to 22 checked-in forward files and 22 rollback files in exact order. `manifest.json` binds their source provenance and SHA-256 digests; `db:push` and inferred SQL are forbidden.
- Critical audit result: the chain remains NO-GO. PR1 is locally reconstructed and PR16A/PR16B have clean review evidence, but every pair is unapplied. The named staging target, catalog compatibility, restorable backup, maintenance window and separate DB principals/capabilities are still unproven/unapproved.
- Corrected provenance: a dedicated commit/file audit proved PR13 intentionally changes application adapters only and is schema-neutral. PR14's database controls come from PR12; its mislabeled preflight now names those exact prerequisites. This correction does not prove PR13 S3/KMS/IAM runtime readiness, which remains a separate gate.
- Preserved PR16 handoff: `docs/ai-media-studio/pr16-remediation-plan.md` records every missing schema group, the relational/CAS blockers, the PR16A schema and PR16B repository split, required PostgreSQL concurrency/crash/rollback evidence, and the exit gate. It authorizes no implementation or environment access.
- Current PR30 evidence remains historical: its runbook inventory tests passed 3/3 and its PR16A evidence passed the recorded local gates. The new exact manifest and disposable-local full-chain command now passes 7/7, including the fail-before-mutation PR27→PR26 reverse preservation stop; this is still not approved restored-staging, restart, rollback-rehearsal or deployment evidence.
- Safety boundary: no database was opened, no backup was taken, no role/capability was created, no SQL was applied, no service restarted, no credential touched, no provider/storage call made, no money spent and no deployment requested.

## Active local checkpoint: PR29 inert HeyGen V3 production composition

- Branch: `codex/ai-media-studio-production-composition`, draft PR #116, stacked on draft PR #115. Initial checkpoint commit: `948a1a6c`; no merge or deployment is implied.
- Composition boundary: one internal factory creates the function-only Drizzle submit/reconcile repository, terminal repository, fixed-account HeyGen V3 provider/resolvers and production asset ingest worker. It returns explicit run-on-demand workers and `autostart=false`; it mounts no route, timer, listener or loop.
- Exact binding: submit and terminal capabilities must match the configured provider account and credential version. Renewable artifact resolution additionally binds the ingest job, structured tenant, render job, durable artifact reference, provider job, account, credential version and authorization digest before any HeyGen GET or reader I/O.
- Stale-URL prevention: `createProductionAssetIngestWorker` now accepts and passes the provider artifact resolver. A durable `provider-artifact://` job with a missing or mismatched resolver becomes retryable `source_unavailable`; it cannot use the persisted signed URL as fallback.
- Current evidence: focused tenant/composition/asset regressions pass 29/29; the full AI Media Studio suite passes 666 with 0 failures and 24 PostgreSQL-only skips out of 690; TypeScript and production build pass under the documented temporary rename/restore of the six unrelated iCloud dataless placeholders. The independent checker found two tenant-scope P1s; exact database-scope and structured-tenant guards plus regressions closed both. Checker and staged-packaging App QA rechecks are clean at P0=P1=P2=0.
- Safety boundary: construction performs zero database, provider, DNS, storage or binding-lookup I/O. No migration is applied, no credential file is changed, no worker method is called, no video is generated, no budget is reserved or spent and no deployment is requested.

## Active local checkpoint: PR28 dedicated AI Media Studio Agent

- Branch: `codex/ai-media-studio-agent-control`, draft PR #115, stacked on draft PR #112. Initial checkpoint commit: `dfa4aa13`. The next checkpoint will add inert production composition; it is intentionally kept out of this control-plane slice.
- Dedicated area: authenticated route `/ai-media-studio-agent` presents the delivery mission, exact launch target, work-state totals, owners, acceptance criteria, merge gates, evidence, blockers, branches/PRs and next actions. Studio navigation links to it without replacing the product dashboard.
- Dedicated agent: Agents Office now registers `AI Media Studio Agent`, places it in its own `Media Studio` room and describes its scope as roster, scripts, HeyGen, ingest, QA and approvals for the 5×10 launch. Existing saved office layouts merge the new default room and agent location without discarding user customization.
- API boundary: authenticated `GET /api/ai-media-studio/agent` returns a strict typed snapshot only. Its safety literals require `spendAuthorized=false`, `deploymentAuthorized=false`, `migrationsApplied=false` and `liveProviderCallsEnabled=false`; there is no write endpoint.
- Launch shape: the control pane fixes the initial range at 5–10 avatars, exactly 10 videos each and 50–100 blocked slots. The 5×10 canary remains behind reviewed composition, staging, one approved one-video sandbox, App QA and Robert's explicit batch cost approval.
- Current evidence: the new control contract/UI checks pass 5/5 and the existing HTTP route regressions pass 4/4 (9/9 combined); the full AI Media Studio suite passes 662 with 0 failures and 24 PostgreSQL-only skips out of 686. TypeScript and production build pass after the six unrelated iCloud dataless duplicate placeholders are temporarily renamed and restored intact; the untracked `launch-authority-contracts 3.ts` placeholder remains preserved and excluded from Git. Browser QA confirms the control pane plus Agents Office entry with no browser warning/error. Independent checker and App QA both rechecked the clarified evidence and report no remaining P0-P2.
- Safety boundary: this slice performs no provider, storage or database I/O beyond its authenticated read-only snapshot. It applies no migration, changes no secret, reserves no budget, creates no render job, publishes nothing and deploys nothing.

## Active local checkpoint: PR27 HeyGen terminal evidence

- Branch: `codex/ai-media-studio-heygen-terminal-evidence`, draft PR #112, stacked on draft PR #109; initial implementation is preserved at commit `3119d017` and the review corrections are preserved as an incremental follow-up.
- Provider boundary: an unmounted HeyGen V3 adapter submits one exact authorized request with the persisted idempotency key, treats every transport/invalid/409 result as ambiguous, and obtains provider-authoritative status only by the confirmed `video_id`. HeyGen never mints exact negative-submission finality and never triggers an automatic refund.
- Terminal boundary: a separate leased/fenced worker polls accepted jobs. PostgreSQL records one append-only terminal event and atomically releases active capacity; completed jobs enqueue one private MP4 ingest handoff in the same transaction, while failed jobs create no ingest. Committed money is not changed.
- Recovery and isolation: terminal checks/events bind exact owner, workspace, attempt, account, provider, credential version, provider job and send authorization. Replay is distinguished from conflict. Review closed the legacy `release_terminal_capacity_v1` bypass by revoking the historical upgrade capability, made completed/failed lifecycle projection exact (including the idempotent second attach), retained the rollback ACL needed by preserved guards, persisted bounded backoff/retry evidence, and brought the Drizzle checks into parity with PostgreSQL.
- Artifact safety: the ingest queue has an exact tenant/workspace/render foreign key and a durable provider artifact reference. An expired delivery URL must be renewed through an exact tenant/job/account/credential/provider binding before any reader I/O; stale persisted URLs cannot bypass that resolver. Provider response bodies are streamed under an incremental 256 KiB limit rather than buffered without a bound.
- Final evidence: focused adapter/worker/repository/migration checks pass 67/67; static migration checks pass 8/8; the isolated PostgreSQL 16 harness passes 4/4; the complete AI Media Studio suite passes 657 with 0 failures and 24 PostgreSQL-only skips out of 681; `npm run check`, production build, generated codebase map and diff hygiene pass. The build emits only the baseline bundle-chunk and unavailable local Python `yt-dlp` warnings. Independent checker corrections were rerun, and App QA is clean at P0=0, P1=0 and P2=0.
- Safety boundary: PR27 remains absent from routes, public barrels, timers and runtime composition. The migration is unapplied; there is no real HeyGen request, webhook authority, live provider/storage I/O, spend, publication, secret change or deployment. The initial 5–10 avatars × exactly 10 videos each remains blocked: production still needs composition and durable resolver injection, staging migration/restart/rollback proof, real credentials plus quota/webhook/billing evidence, one separately approved one-video sandbox, then a 5×10 canary, and Robert's explicit cost and deployment approvals.

## Active local checkpoint: PR26 database capability and race proof

- Branch: `codex/ai-media-studio-db-capability-races`, draft PR #109, stacked on draft PR #108; preserved in GitHub through incremental commits while validation continues.
- Database boundary: the admitted-worker adapter is function-only. Separate submit and reconciliation database lanes call versioned `ai_media_worker_api` functions; every capability is bound to `SESSION_USER`, exact owner plus workspace, lane, operation, timezone and bounded lease/batch limits. Executors have no direct table privileges, function ownership is NOLOGIN, `PUBLIC` execution is revoked and fixed `pg_catalog` search paths plus fully qualified relations close shadowing paths.
- Exactness: returned claims and authorizations are bound back to the requested scope and immutable work identity before COMMIT. Invalid payloads, multiple rows, cross-owner `personal` workspaces, decorated submit objects, stale fences and structurally forged reconciliation claims fail closed.
- Capacity and money: active render capacity is durable state separate from committed money. Ambiguous or confirmed-but-not-terminal work remains capacity-held; exact negative finality releases capacity and refunds once, while an exact provider terminal result releases capacity without pretending committed provider cost disappeared. Retry requires a new reservation/capacity admission.
- Current evidence: function-only/security checks pass 15/15, migration checks pass 8/8, the full AI Media Studio suite passes 615 checks with 20 PostgreSQL-only skips, the inherited isolated PostgreSQL 16 suite passes 13/13 and PR26 passes 7/7 across ACL/search-path controls, same-workspace tenant isolation, two-claimer exclusion, stale-fence reclaim, ambiguous/unknown recovery, concurrent exact no-submit refund, terminal capacity release and live fail-closed rollback. TypeScript, production build, generated codebase map and diff hygiene pass. The independent SQL checker found no P0/P1 and corrected one P2 submit-authorization shape guard; independent App QA passes with no P0-P2 and confirms that PR26 exposes no route, UI, runtime or provider path.
- Safety boundary: the SQL is checked in but unapplied. No route, barrel, timer, runtime composition, provider call, terminal webhook, real reservation/commit, credit spend, publication, secret change or deployment is enabled. Production additionally requires DBA-controlled safe role/login provisioning, separate submit/reconcile connections, exact HeyGen reconciliation/terminal evidence, an approved small sandbox and Robert's explicit spend/deployment approval.
- Launch shape remains 5–10 configured HeyGen avatars with exactly 10 planned videos each (50–100 slots). PR26 makes that batch safer to admit later; it does not generate it or contact HeyGen.

## Preserved checkpoint: PR25 dedicated admitted worker

- Branch: `codex/ai-media-studio-admitted-worker`, draft PR #108, stacked on draft PR #107; preserved as an inert GitHub checkpoint.
- Scope: a provider-neutral admitted-worker contract, dedicated Drizzle repository, append-only submission-attempt/event ledgers, guarded forward/rollback SQL, and an orchestration loop with no timer or runtime composition.
- Money and submission boundary: claim leases without spending; authorization revalidates the full current database authority graph and atomically moves the exact reservation from reserved to committed before returning the sealed request and persisted provider idempotency key. The injected provider port can be called only once per authorization. Every uncertain outcome is permanently non-retriable and enters reconciliation.
- Refund boundary: only an exact provider capability carrying linearizable negative-finality evidence may prove that an idempotency key was not accepted and can never be accepted later. Timeout, HTTP status, eventual absence and ordinary 404 responses can never release committed funds. No HeyGen implementation of that capability exists.
- Evidence: 7 focused worker/migration checks, the full AI Media Studio suite with 596 passed and 13 PostgreSQL-only cases skipped, isolated PostgreSQL 16 with 13/13 passed, TypeScript, production build, generated codebase map and diff hygiene passed. Independent security review is P0-P2 clean and App QA passed with no PR25-specific warning or failure. Six unrelated iCloud `dataless` duplicate `.ts` placeholders were temporarily renamed and restored intact so TypeScript could complete; none belongs to or will be staged with PR25.
- Safety boundary: no route, public barrel, timer, runtime composition, real provider adapter, network request, migration application, real reservation/commit, credit spend, publication, secret change or deployment is enabled. Production remains gated on least-privilege SQL roles/functions, additional real-PostgreSQL concurrency/revocation/crash races, independent HeyGen reconciliation-contract evidence, a small approved sandbox and Robert's explicit spend/deployment approval.
- Launch shape remains 5–10 configured avatars with exactly 10 planned videos each (50–100 slots); PR25 does not generate those videos or change the onboarding UI.

## Active checkpoint: PR24 fenced held-work activation

- Branch: `codex/ai-media-studio-held-activation`, draft PR #107, stacked on draft PR #106; preserved as an inert GitHub checkpoint.
- Scope: append-only activation evidence plus one exact database transaction for the held reservation/render/outbox/slot handoff. Activation changes internal queue state only and leaves the micro-USD reservation uncommitted.
- Structural no-spend boundary: generic render and outbox claim SQL exclude every budget-bound admitted artifact. The activated outbox is internal wake/audit work only and has no provider capability. The PR24 repository remains absent from routes, public barrels and runtime composition.
- Verification evidence: 23 focused security checks, the full AI Media Studio suite with 589 passed and 13 PostgreSQL-only cases skipped, isolated socket-only PostgreSQL 16 with 13/13 passed, TypeScript, production build, generated codebase map and diff hygiene passed. Independent security review found no P0-P2 findings and App QA passed with no PR24-specific warning or failure.
- Residual hardening note: production authentication/RBAC must mint the trusted activation capability, direct SQL writers must remain restricted, and a future principal representation should be normalized before inclusion in the activation digest. None of these boundaries is mounted by this checkpoint.
- Next gate: PR25 must implement a dedicated admitted-worker claim, last-mile authority revalidation, atomic commit-before-submit, stable persisted provider idempotency, and non-retriable ambiguous reconciliation before any approved HeyGen sandbox.
- Safety boundary: migration artifacts remain unapplied; no route, timer or worker is enabled; no provider call, committed spend, publication, secret change or deployment is authorized. Existing build advisories for bundle size and unavailable local Python `yt-dlp` bundling are baseline environment warnings, so no deployment is requested.

## Active local checkpoint: PR23 immutable admitted-held work handoff

- Branch: `codex/ai-media-studio-admitted-held-work`, draft PR #106, stacked on draft PR #105.
- Scope: a successful exact daily admission now atomically creates one budget reservation, one render job at `stage='admission_held'`, and one outbox command at `status='held'`. The reservation, job and command freeze the exact tenant, slot/attempt, influencer, avatar, voice, script/source, provider credential, authority snapshot, launch intent and admission identities.
- Sealing: PostgreSQL derives the provider-neutral generation request only from locked durable rows, verifies the approved script checksum, and binds the request plus reservation/job/outbox identities into `sealed_request_digest` and `work_handoff_digest` values. Exact tenant-scoped deferred FKs make the cyclic triplet all-or-nothing.
- Non-activation guarantee: render and outbox claim SQL continue to select only `queued|retry_wait` and `pending|retry_wait`. Database triggers reject every update/delete while the rows are held; replay requires the exact untouched triplet and fails closed on a missing, leased, submitted or digest-mismatched artifact.
- Safety boundary: PR23 remains unexported and unmounted. It does not activate a worker, call HeyGen, commit or spend budget, apply a migration, publish, change secrets or deploy. A later reviewed PR must replace the held triggers, revalidate every authority at database time, commit reserved budget immediately before provider submission and use the reservation idempotency identity.
- Verification evidence: 25 focused checks, full AI Media Studio suite 582 passed with 11 isolated-PostgreSQL-only cases skipped, isolated socket-only PostgreSQL 16 harness 11/11, TypeScript, production build and diff hygiene passed. The PostgreSQL harness executes the real admission repository CTE, forces deferred constraints before rollback, and found three DB-only defects (a polymorphic trigger field, an untyped JSONB parameter and an undeclared digest dependency) that were corrected before checkpointing. Independent checker reports no P0–P2 findings; static App QA passes with no warnings.
- Remaining gates: production RBAC/durable distributed attestation verification, bucket provisioning, migration rehearsal on a staging copy, activation/commit-before-submit design, a separately approved small HeyGen sandbox, and Robert's explicit spend/deployment approval.

## Preserved checkpoint: PR22 exact launch intent and runtime attestations

- Branch: `codex/ai-media-studio-launch-intent-attestations`, draft PR #105, stacked on draft PR #104.
- Scope: immutable tenant/slot/attempt launch intents bind exact current plan, roster member, provider credential, approved script/source and governance facts. Evidence, snapshots and both admission guards require the same intent identity.
- Runtime boundary: sandbox and maximum-quote commands carry only opaque handles. Verification occurs after the exact subject is locked and PostgreSQL time is read. The bundled process-local issuer/verifier is least-privilege reference/test composition only and is not durable across restarts or suitable for distributed production.
- Source boundary: non-manual sources require a canonical content hash, accepted/ready state, approved moderation and owned/licensed rights. Admission locks the exact source row through its final guard; a content refresh remains allowed but invalidates the stale intent. Runtime attestation ID/digest fields remain in append-only evidence for audit reconstruction.
- Safety boundary: migration artifacts are unapplied and the repository remains absent from routes/public barrels/runtime composition. No HeyGen call, render job, outbox work, credit spend, post, migration application, secret change or deployment is enabled.
- Verification evidence: 43 focused checks, the full AI Media Studio suite (576 passed, 9 PostgreSQL-only skipped), isolated PostgreSQL 16 (9/9), TypeScript, production build, generated codebase map and diff hygiene pass before the final review cycle.
- Remaining gates: production RBAC/authenticator composition, durable distributed runtime attestation verification, budget-bucket provisioning, production-scale counters, staging-copy migration/restart rehearsal, a separately approved small HeyGen sandbox, and Robert's explicit spend/deployment approval.

## Preserved checkpoint: PR21 authenticated authority issuers

- Branch: `codex/ai-media-studio-authority-issuers`, draft PR #104, stacked on draft PR #103.
- Scope: server-only, capability-separated policy, kill-switch, content approval, human launch approval, sandbox, maximum-quote and snapshot issuers; append-only Drizzle persistence; shared authority/governance locks; and an isolated PostgreSQL test harness.
- Trust boundary: authenticated principals and adapter attestations are injected branded server dependencies. Human commands cannot select actor/source/time/revision/provider/governance/country/money/digests. The service and repository are absent from routes and public barrels.
- PostgreSQL evidence: a fresh socket-only PostgreSQL 16.14 cluster applied the exact checked-in PR19 then PR20 forward SQL over a minimal test-only prerequisite schema; 7/7 integration checks covered schema controls, tenant rejection, immutability, exact reservation authority, concurrent revision/idempotency conflicts, retained evidence and fail-closed reapplication. No user database, `DATABASE_URL`, `db:push` or Homebrew cluster was touched.
- Safety boundary: no migration was applied outside the disposable harness; no render job, outbox command, provider call, credit spend, post, secret change or deployment is enabled.
- Review evidence: full AI Media Studio suite 558 passed with the seven PostgreSQL-only cases safely skipped, isolated PostgreSQL 7/7, focused integration 27/27, TypeScript, production build, diff hygiene, independent checker and static App QA pass. Security found no P0/P1 and approved only the inert checkpoint boundary.
- Remaining gates: production RBAC/authenticator composition, runtime-minted sandbox/quote attestations (TypeScript brands are not authentication), a durable source of launch intent for governance use/territory/content country, budget-bucket provisioning, production-scale concurrency counters, staging-copy migration/restart rehearsal, sandbox generation and Robert's explicit spend/deployment approval.

## Preserved checkpoint: PR20 durable launch authorities

- Branch: `codex/ai-media-studio-durable-authorities`, draft PR #103, stacked on draft PR #102.
- Scope: append-only workspace admission-policy and kill-switch revisions, exact per-slot approval/sandbox/maximum-quote evidence chains, immutable launch-authority snapshots, and reservation binding to the exact snapshot/digest.
- Trust boundary: the reservation caller can no longer provide provider identity, governance facts, approvals, sandbox result, quote/money, policy decision, kill-switch state, or provider idempotency. The unmounted repository derives and revalidates them from locked database rows.
- Safety boundary: forward/rollback SQL remains unapplied; no authority writer, route, render job, outbox command, provider call, spend, external post, migration application, or deployment is enabled.
- Evidence: full AI Media Studio suite 543/543, focused PR20 tests, TypeScript, production build, diff hygiene, independent checker and static App QA passed. Security findings were corrected and re-reviewed by the final checker.
- Remaining gates: authenticated authority issuers, production-scale concurrency counters, and live PostgreSQL migration/rollback/contention proof. The inert scaffold currently serializes count-based concurrency admission with a global advisory lock.

## Active local checkpoint: PR19 durable daily admission

- Branch: `codex/ai-media-studio-durable-daily-admission`, draft PR #102, stacked on draft PR #100.
- Scope: provider-neutral plans/slots, exact bigint micro-USD domain math, durable budget buckets, immutable reservation evidence, and an unmounted reservation-only Drizzle transaction.
- Database authority: accounting date/timezone, locks, account/credential version, governance, policy, quote, approval, sandbox, and reservation state must be revalidated in one PostgreSQL transaction.
- Ambiguous side effects: committed money cannot expire or auto-refund after a timeout or uncertain provider response; only definitive reconciliation may release or settle it.
- Safety boundary: SQL is reviewed artifact only and remains unapplied. No route, render job, outbox command, provider call, spend, external post, migration application, or deployment is enabled.
- Current evidence: full AI Media Studio suite 536/536, focused admission suite 31/31, TypeScript, production build, generated codebase map, diff hygiene, independent checker, security review, and static App QA pass.
- Remaining authority gap: governance is revalidated from locked durable revisions, but approval, sandbox, quote, policy, and kill-switch inputs are digest-bound internal evidence rather than independent durable source rows. The repository must remain unmounted until those authorities and real PostgreSQL contention/restart behavior are proven.
- Review disposition: safe to preserve as an inert draft checkpoint; not ready to merge, apply, activate, spend, or deploy. No live PostgreSQL migration/contention rehearsal or browser target was used.

## Active recovery checkpoint: PR18 roster daily plan

- Branch: `codex/ai-media-studio-roster-daily-plan`, draft PR #100, stacked on draft PR #99.
- Launch size: the configured 5–10 avatar roster expands to exactly 10 visible slots per avatar, or 50–100 slots total.
- Safety: all slots are `not_queued`; the plan is `blocked_before_generation`, `canGenerate=false`, and `noSpendGuarantee=true`.
- Calendar authority: the server owns the daily timezone (UTC by default). Query parameters cannot change the accounting date or timezone.
- Persistence boundary: this PR is a derived, non-durable preview. It does not create a daily-plan row, reserve budget, create scripts/jobs/outbox messages, call HeyGen, publish, apply a migration, spend credits, or deploy.
- Local evidence: full AI Media Studio suite 513/513, focused plan tests, TypeScript, production build, diff hygiene, independent checker and static App QA pass. Browser-visual QA was not run because no live target was used.
- Required next: reviewed durable plan/slot and atomic budget-reservation schema, transaction-time calendar semantics, governance and human approval digests, sandbox proof, and separate spend/deployment approval.

## Latest recovery checkpoint: PR17 HeyGen launch roster

- Branch: `codex/ai-media-studio-heygen-launch-roster`, draft PR #99, stacked on PR #97 / `codex/ai-media-studio-provider-activation-cas`.
- Launch boundary: 5–10 avatars, 10 planned videos per avatar, 50–100 planned videos total. This is planning/onboarding evidence, not rendered output or capacity evidence.
- UI/API: authenticated GET/POST roster boundary plus a dedicated wizard for name, HeyGen `avatar_id`, HeyGen `voice_id`, language, accent, and gender. Native IDs are request-only and never appear in public responses, URLs, browser storage, or logs.
- Persistence: one account-row-locked transaction stores idempotency evidence, private provider resources, and draft provider-neutral influencers. The roster cap does not limit the global catalog.
- Provider correction: inert HeyGen submission uses the official Studio V2 `/v2/video/generate` payload, strict `data.video_id`, scripts shorter than 5,000 characters, official-origin pinning, and no V3 fallback or automatic submit retry.
- Safety boundary: no HeyGen request, render enqueue, generation, credit spend, migration apply, publishing action, deployment, or secret change was performed.
- Required before use: exactly one active/verified server-owned HeyGen account, governance/rights approval, atomic daily cost admission, sandbox evidence, final checker/App QA, and Robert's separate deployment/spend approval.

## Earlier recovery checkpoint: PR11 OAuth policy hardening

- Branch: `codex/ai-media-studio-oauth-policy-hardening`, PR #85, stacked on PR #84 / `codex/ai-media-studio-managed-oauth-vault`.
- Scope: persist a provider-neutral `required_s256 | none` PKCE policy snapshot, omit PKCE for the currently documented TikTok/Meta/Google web-server flows, preserve Google's offline-consent parameters, reject `authorized` callbacks until an atomic claim/exchange/token-vault flow exists, strengthen redirect defense-in-depth, and add S3 object expiration metadata.
- Migration artifacts: `20260721_pr11_oauth_policy_forward.sql` and its application-only, data-preserving rollback. They are reviewed artifacts only and have not been applied.
- Focused OAuth/PR11 tests: 34/34 passing.
- TypeScript: `npx tsc --noEmit` passing.
- Production build: `npm run build` passing; existing bundle-size and local `yt-dlp` environment warnings remain unrelated to PR11.
- Codebase map: `npm run codebase:map` completed and refreshed the generated maps.
- Diff hygiene: `git diff --check` passing.
- Independent App QA: passing with no warnings; browser/click QA is not applicable because PR11 adds no route or UI.
- Independent checker: passing after fixes for exact migration preflight, alternate IPv4 literal rejection, and pre-await policy snapshot capture. SQL was reviewed statically and not applied to PostgreSQL.
- Explicit safety boundary: no token exchange, long-lived token vault, refresh/revocation, live OAuth route, provider call, migration apply, external post, spend or deployment.

## Current branch

- Worktree: `/Users/robertmanzanilla/Documents/asistente/.worktrees/ai-media-studio-pr4`
- Branch: `codex/ai-media-studio-managed-oauth-vault`
- Pull request: `#84`, stacked on `codex/ai-media-studio-social-oauth-foundation` (PR #83).
- Base commit at checkpoint start: `a6cd2f31 feat(ai-media-studio): add social oauth foundation`
- PR10 scope: managed production OAuth vault foundation, provider authorization URL builders, and fail-closed runtime composition.
- Explicit PR10 safety decision: keep OAuth routes unmounted until token exchange, token vaulting, account CAS binding, callback semantics, and provider sandbox proof are complete.

## Stacked PR history already preserved

| Slice | Branch / PR | Preserved state |
| --- | --- | --- |
| Foundation | PR #67, `codex/ai-media-studio` | Provider-neutral AI Media Studio vertical slice. |
| PR2 core | PR #70, `codex/ai-media-studio-core` | Durable core, media assets, influencers, runtime policy, and migration artifacts. |
| PR3 operations | PR #71, `codex/ai-media-studio-operations` | Publishing/analytics/intake/orchestration contracts, repositories, operations UI, and worker operations. |
| PR4 owned assets | PR #73, `codex/ai-media-studio-quality` | Owned render ingest/delivery path, authenticated delivery DTOs, production adapter boundaries. |
| PR5 governance | PR #75 | Governance/rights/quality gates. |
| PR6 provider identity | PR #77 | Account-scoped provider identity and webhook isolation. |
| PR8 production publishing accounts | PR #80 and PR #82 | Production asset/publishing-account isolation hardening. |
| PR9 OAuth foundation | PR #83, `codex/ai-media-studio-social-oauth-foundation` | Durable one-time OAuth state, PKCE/vault ports, unverified credential lifecycle, publishing readiness gate. |

PR9 local evidence recorded before this checkpoint:

- Full test suite: 360/360 passing.
- TypeScript: passing.
- Production build: passing.
- Independent checker: passing.
- Static App QA: passing.
- No live OAuth, provider exchange, external publish, migration apply, or deployment performed.

## Active PR10 design notes to preserve

### Decision

Use an S3 + SSE-KMS ephemeral vault for PKCE verifiers instead of one AWS Secrets Manager secret per OAuth session.

Reasoning:

- At 10,000+ sessions/day, a per-session Secrets Manager design creates avoidable secret-count, cleanup, recovery-window, and cost pressure.
- S3 with a dedicated private bucket/prefix, exact-object access, SSE-KMS, Bucket Keys, app-level expiration, and immediate object deletion is a better fit for short-lived PKCE verifier storage.
- Long-lived provider token bundles can still use a separate managed secret/token vault later.

### PR10 files now present

New implementation files:

- `server/ai-media-studio/oauth/s3-kms-pkce-vault.ts`
- `server/ai-media-studio/oauth/authorization-url.ts`
- `server/ai-media-studio/oauth/production-runtime.ts`

New tests:

- `tests/ai-media-studio-oauth-s3-kms-vault.test.ts`
- `tests/ai-media-studio-oauth-authorization-url.test.ts`
- `tests/ai-media-studio-production-oauth-runtime.test.ts`

Allowed existing files to modify:

- `server/ai-media-studio/oauth/index.ts`
- `server/ai-media-studio/oauth/platform-manifests.ts`

Files intentionally out of scope for the first PR10 code slice:

- Routes and public API handlers.
- Database schema/migrations.
- UI.
- Package/dependency changes.
- Live AWS/provider calls.
- Secrets or `.env` files.

## Security constraints captured for PR10

- Do not mount OAuth start/callback routes in this slice.
- No raw OAuth state in logs, metadata or persisted records. A future start response may contain it only inside the provider authorization URL, never as a separate field.
- State remains one-time, digest-only, platform-bound, tenant/workspace/actor/account-bound, and expiry-bound.
- PKCE verifier vault references must be opaque: `vault://ai-media-studio/oauth-pkce/v1/<uuid>`.
- S3 vault must:
  - use official AWS S3 endpoints only;
  - reject custom endpoints and static access-key configuration in app config;
  - use SSE-KMS with a fully qualified customer KMS key ARN;
  - set `BucketKeyEnabled`;
  - use `IfNoneMatch: "*"` when creating verifier objects;
  - read/delete only exact keys derived from validated vault refs;
  - validate encryption/KMS metadata and envelope contents on read;
  - enforce small bounded JSON bodies;
  - fail closed with generic errors;
  - avoid public URLs, ACLs, listing, plaintext fallback, and secret-bearing metadata.
- Authorization URL builders must:
  - use fixed official provider endpoints;
  - never accept arbitrary authorization endpoints;
  - validate redirect URIs as HTTPS, default port 443, no credentials, no query/fragment, no localhost/IP;
  - use audited scopes from manifests;
  - never include client secrets;
  - use Google PKCE S256 with offline/consent parameters;
  - omit PKCE for TikTok Web unless future official docs require it;
  - default Meta/Instagram to no PKCE unless explicitly documented/configured.
- Production runtime must be all-or-nothing:
  - absent config means OAuth production runtime unavailable;
  - partial or unknown `AI_MEDIA_STUDIO_OAUTH_*` config fails closed;
  - construction performs no network I/O;
  - AWS credentials come from the default provider chain, not static app env keys.

## PR10 local evidence recorded after code landed

- OAuth/PR9 regression set passed 31/31.
- Full AI Media Studio suite passed 374/374. The first sandboxed run produced only twelve `listen EPERM` infrastructure failures; the required rerun with local loopback binding passed all 374 tests.
- TypeScript: `npx tsc --noEmit` passed.
- Production build: `npm run build` passed. Existing bundle-size and local `yt-dlp` environment warnings remain unrelated to PR10.
- Codebase map: `npm run codebase:map` completed and refreshed both generated map files.
- Diff hygiene: `git diff --check` passed.
- No live AWS, provider, OAuth route, token exchange, social post, migration apply, or deployment was performed.

## Current blockers / not done

- Independent checker findings recorded after the GitHub checkpoint:
  - The PR9 start service still allocates a PKCE verifier for TikTok/Meta even though the PR10 authorization manifests omit PKCE for those web flows. This is inert while routes remain unmounted, but must be reconciled before a live connector to avoid needless secret objects.
  - An `authorized` consume deliberately retains the verifier for the future token exchange, while the current S3 adapter enforces read expiry but cannot itself prove physical deletion. The callback-safe exchange slice must read and delete immediately in a `finally` path and require a dedicated non-versioned bucket lifecycle as the last-resort cleanup boundary.
  - The database redirect check enforces HTTPS only; the trusted runtime policy additionally rejects credentials, query/fragment, non-default ports, localhost and IP literals. All writes currently pass through stricter server validation, but a reviewed migration should add equivalent database defense-in-depth before live OAuth.
- Static App QA passed because PR10 adds no route, UI, timer, worker or automatic network call. The checker findings above keep the slice out of merge/deploy-ready state.
- OAuth routes remain intentionally absent.
- Provider token exchange, refresh, revocation, sandbox account connection, and token vaulting remain future slices.
- No database migration for PR10 is planned in this first code slice.
- Independent checker/App QA evidence is still required before this PR10 slice is marked ready.
- No App QA/live browser evidence for PR10 exists yet; this slice has no mounted route or UI to click.
- No Replit deployment is requested or authorized.

## Next recovery steps if this Codex session stops

1. Continue on branch `codex/ai-media-studio-oauth-policy-hardening` and review only its delta from PR #84.
2. Preserve the stacked order: PR #83 -> PR #84 -> PR11 OAuth policy hardening.
3. Confirm GitHub PR status and execute the reviewed migration in an approved staging/PostgreSQL rehearsal before calling the database change production-ready.
4. Continue with a separate PR for callback-safe claim/exchange, long-lived token vaulting, account CAS binding, refresh/revocation and provider sandbox proof.
5. Do not mount OAuth routes, deploy, apply migrations or post externally without the required release gates and Robert’s explicit approval.

## PR12 checkpoint — durable OAuth callback saga

GitHub PR: #88, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/88`.

Branch: `codex/ai-media-studio-oauth-callback-saga`, stacked on PR #85 (`codex/ai-media-studio-oauth-policy-hardening`).

This slice adds a provider-neutral, fenced callback saga without mounting a route or making live provider calls. It separates authorization-code, PKCE, provider connector, and long-lived token-vault contracts; performs no database transaction across external I/O; claims work with leases and fencing; prevents automatic re-exchange after ambiguous provider I/O; and atomically binds a token-vault reference plus exact provider identity/provenance to the account with credential-version CAS.

Security and recovery properties captured:

- Raw authorization codes and tokens never enter the database, logs, callback errors, or durable session snapshots.
- Vault references are purpose-scoped and bound to tenant, workspace, actor, account, platform, session, digest/version and token-binding context.
- Stale workers cannot finalize, mark indeterminate, or clean vault material after a newer fence wins, including the pre-attach `putOnce` race.
- Candidate token substitution, unknown capabilities, missing `publish_video`, identity conflicts, expired credentials, replay and wrong actor/account/platform are rejected generically.
- Provider-account activation and callback completion occur in one short database transaction after all external I/O.
- The additive reviewed migration contains strict preflight, backfill, constraints, indexes and exact OAuth source-session provenance. It remains unapplied; rollback is application-only and data-preserving.

Evidence at checkpoint:

- Focused PR12 OAuth suite: 32/32 passed after the stale pre-attach race regression was added.
- TypeScript, production build and diff hygiene passed; the build retains only the pre-existing bundle-size and local `yt-dlp` warnings.
- Full AI Media Studio suite: authoritative unrestricted rerun passed 401/401.
- Independent security review found no P0/P1. Its only remaining P2 was packaging untracked files, resolved by staging the complete PR12 file set.
- Independent checker found the pre-attach stale cleanup race; it was fixed and regression-tested before GitHub preservation.
- Static App QA passed 51/51 OAuth regression tests and found no route, UI, timer, network, provider, migration-apply or deployment surface in this slice.

Intentionally not done:

- No production authorization-code or token-vault adapter is wired.
- No live TikTok, Google/YouTube, Meta, Instagram or Facebook connector is wired.
- No callback/start route is mounted.
- No migration was applied, no external content was posted and no deployment was requested.

Next safe slice: implement separate envelope-encrypted S3/KMS authorization-code and token-vault adapters plus immutable sandbox provider connectors; then add refresh, revocation and reconciliation. Routes remain blocked until provider sandbox proof and the normal checker/App QA gates pass.

## PR13 checkpoint — encrypted OAuth code and token vaults

GitHub PR: #89, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/89`.

Branch: `codex/ai-media-studio-encrypted-oauth-vaults`, stacked on PR #88.

Implemented:

- Added the official AWS KMS client dependency.
- Added a shared envelope layer using one fresh KMS `AES_256` data key per object, AES-256-GCM with a random 12-byte IV, full canonical context as AAD, a digest-only KMS encryption context and zeroization of plaintext data-key buffers.
- Added separate deterministic authorization-code and token vaults. Both use application ciphertext plus S3 SSE-KMS, Bucket Keys, `IfNoneMatch: "*"`, exact expected bucket owner, pinned official S3/KMS endpoints, bounded strict envelopes and generic errors.
- Code bindings include tenant, workspace, actor, provider account/platform, session, token binding, code digest and expiry. Reads recheck expiry after S3/KMS I/O.
- Token bindings additionally include target credential version. Descriptor and bundle are authenticated together; the callback saga gets no secret-reader capability.
- Exact retries recover after a 412 or ambiguous write; competing payloads, cross-context reads, raw/gateway 404s, `NoSuchBucket`, AEAD tampering, metadata collisions and KMS failures fail closed.

Evidence before GitHub preservation:

- Adapter tests: 13/13 passed.
- Adapter plus saga focused tests: 24/24 passed.
- Full AI Media Studio suite: authoritative unrestricted run passed 414/414.
- TypeScript and diff hygiene passed.
- `npm audit --omit=dev --audit-level=high` reached the registry and reported 16 advisories (7 high, 7 moderate, 2 low). Every reported package already exists in the PR12 base lockfile and none is the new AWS KMS client; remediation requires a separate tested dependency PR, including breaking Drizzle/Google upgrades where indicated. This is not production-clearance evidence.
- Independent checker and security recheck reported no remaining P0-P3 blockers.
- Static App QA passed 69/69 OAuth regressions with zero warnings and confirmed no route, UI, timer, migration, automatic network call or deployment surface.

Explicit pre-runtime blockers:

- The token-reader split is an API capability boundary, not yet a separate IAM role/service.
- Dedicated secret buckets/CMKs, unversioned-or-VersionId-aware deletion, Block Public Access, lifecycle, durable reconciliation, monitoring and key rotation are not configured or proven.
- Real connectors remain blocked by the target-selection, token-role, lifetime, scope/capability and multi-stage recovery changes captured in `oauth-provider-readiness.md`.
- No route is mounted, no migration is applied, no AWS/provider call is made, no content is posted and no deployment is authorized.

## PR14 checkpoint — OAuth vault operations

GitHub PR: #92, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/92`.

Branch: `codex/ai-media-studio-oauth-vault-operations`, stacked on PR #89.

Implemented:

- Added a dedicated relational cleanup outbox whose PKCE/code/token obligations are created before their corresponding external vault writes can become orphaned.
- Added bounded PostgreSQL-clock claims with `FOR UPDATE SKIP LOCKED`, leases, fencing, retry/dead-letter evidence, exact source-context revalidation, conservative active-token protection and two exact delete passes separated by quiescence.
- Added an explicit `runOnce` cleanup worker with no timer or autostart and bounded AWS SDK operations.
- Added an inert S3/KMS infrastructure preflight over three distinct bucket/CMK planes. It validates exact policy digests, unversioned private buckets, encryption/lifecycle/ownership posture, CMK state/rotation/grants and requires two identical full snapshots before returning a short-lived identifier-free attestation.
- Added an additive reviewed migration and data-preserving rollback. The migration is checked in but unapplied.

Safety boundary: no route, runtime composition, timer, migration apply, live AWS/provider request, external post or deployment is included. Effective IAM/IaC, Access Analyzer, monitoring, migration rehearsal, real connectors, target selection, refresh/revocation and provider sandbox proof remain release gates.

Evidence before GitHub preservation:

- Full AI Media Studio suite: 423/435 passed in the restricted sandbox; the 12 local HTTP cases blocked only by `listen EPERM` were rerun outside the sandbox and passed 12/12, yielding 435/435 composed evidence.
- TypeScript, production build, codebase-map refresh and staged diff/whitespace checks passed.
- Independent checker found no remaining P0-P2; independent security review found no remaining P0-P3 after the crash/fencing and error-taxonomy fixes.
- Static App QA passed with no PR14 findings. Existing bundle-size and local `yt-dlp` build messages are baseline/environment advisories, not PR14 deltas.
- SQL and migration shape are tested statically but have not been executed against PostgreSQL; staging rehearsal remains mandatory.

## PR15 checkpoint — provider connection stages

GitHub PR: #94, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/94`.

Branch: `codex/ai-media-studio-provider-connection-stages`, stacked on PR #92 (`codex/ai-media-studio-oauth-vault-operations`).

Implemented:

- Added provider-neutral durable stages for exchange, target discovery, explicit target selection and the later activation handoff.
- Added exact target compatibility for TikTok users, YouTube channels, Facebook Pages and Instagram professional accounts. Zero targets terminalizes as not connectable; one or many targets always require explicit actor selection.
- Added frozen grant scope allowlists, local verified-task capability derivation and safe role/lifetime descriptors without tokens, secrets, provider JSON or vault references.
- Models Google refresh tokens without a reported expiry as revocation-bound with mandatory revalidation, and forbids treating a Meta grant-level User token as provider-non-expiring.
- Added additive attempt/candidate/immutable-selection tables with exact tenant, actor, provider-account, platform, OAuth-session and discovered-candidate provenance.
- Preserved DB-clock leases/fencing and data-preserving rollback policy. The migration is checked in but unapplied.

Safety boundary: this staged path is not wired into the older callback saga or production runtime. It does not activate an account, mount a route, start a timer, call AWS/a provider, apply a migration, post content or deploy. Role-specific vault references/cleanup v2, activation/account CAS integration, real connectors, refresh/revoke and sandbox evidence remain later gates.

Evidence at first local checkpoint before GitHub preservation:

- Focused PR15 tests passed 31/31:
  - provider connection contracts
  - in-memory repository parity
  - Drizzle repository SQL-shape/state transitions
  - PR15 additive migration and data-preserving rollback
  - durable table export/persistence coverage
- `git diff --check` passed.
- `npm run check` was started but intentionally interrupted after it produced no errors or diagnostics for more than 90 seconds, because Robert asked to preserve the work in GitHub before the session/credits ran out.
- Independent domain maker reported its four-file slice passed focused tests, TypeScript and diff hygiene before handoff.
- Independent persistence maker/reviewer evidence was still pending at this checkpoint, so PR15 must remain WIP/draft until full checker, security and App QA gates complete.

Final PR15 hardening checkpoint:

- Capabilities now require both a locally allowlisted verified task and its exact effective publishing scope; TikTok `video.upload` never grants direct-publish capability.
- Meta exchange accepts only the expiring grant-level User descriptor. Discovery stores no Page token; activation/vault v2 must obtain and bind one operational artifact only after exact target selection.
- Provider manifest revisions are resolved from the frozen local platform registry, candidate and selection evidence are append-only, and in-memory behavior matches global token-binding, bounded-lease and attempt-expiry controls.
- Focused PR15/persistence tests pass 33/33. A targeted strict TypeScript compile of all changed server/shared modules passes, as do diff hygiene checks.
- The full AI Media Studio run produced 449/461 passes inside the restricted sandbox; the 12 failures were only `listen EPERM` and all affected HTTP tests passed outside the sandbox, yielding 461/461 composed evidence before the final isolated hardening. The affected focused suite was rerun after hardening.
- Production build exits successfully. Existing Vite chunk-size and unavailable local `yt-dlp` Python runtime warnings still block deployment under App QA policy; no deployment is requested.
- Independent security re-review reports no remaining P0-P3. Static App QA reports no PR15 UI, route, timer, network, provider/AWS, posting, migration-apply or customer-visible regression.
- Full-project `npm run check` remained abnormally long and was interrupted without diagnostics; the PR remains draft while that global gate lacks completed evidence.

## PR16 checkpoint — provider activation CAS foundation

GitHub PR: #97, `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/97`.

Branch: `codex/ai-media-studio-provider-activation-cas`, stacked on PR #94.

This is an intentionally incomplete GitHub-preservation checkpoint. It adds exact
selected-target activation contracts and an in-memory account/version CAS, plus a
separate S3/KMS vault v2 that stores one opaque secret object per artifact role.
The authorization digest is bound to immutable selection/artifact/version evidence,
not a worker lease or retry timestamp, so an exact retry can reconcile a lost
response without accepting a different target or credential candidate.

The additive Drizzle schema draft models role-specific credential artifacts,
immutable provider-account bindings and v2 cleanup obligations. It is not yet a
release migration: reviewed forward/rollback SQL and the executable Drizzle staging
and activation transaction remain pending. Cleanup v2 composition also remains
pending, so no runtime is allowed to write these role-token objects yet.

Evidence before preservation:

- Focused provider connection, activation, vault and persistence tests: 45/45 passed.
- `git diff --check` passed.
- The full-project TypeScript command again ran abnormally long without diagnostics
  and was interrupted; a direct isolated invocation was blocked by the repository's
  pre-existing duplicate `@types/* 2` directories. PR16 therefore remains draft.
- No route, worker, real AWS/provider call, migration apply, external post or deploy.
- Legacy publishing remains fail-closed until exact target/binding integration.

Independent review after preservation:

- App QA passed 124 focused regressions and confirmed there is no route, UI, timer,
  runtime composition or external call in this delta.
- Replay reconciliation was hardened to validate artifact lifetime at the original
  authorization time while retaining the original `authorizedAt`.
- Artifact evidence and vault AAD now bind the exact manifest revision, v2 roles and
  platform/lifetime semantics. Vault and secret reader are returned as separate frozen
  capabilities so the ordinary vault object cannot elevate itself to read secrets.
- Relation-exact artifact/binding provenance and cleanup-vs-activation fencing remain
  explicit runtime blockers for the migration/Drizzle transaction slice.

Recovery plan: finish independent review of the local additive migration, then
implement prewrite-safe artifact/cleanup staging and the single-transaction durable
activation CAS as PR16B, compose cleanup v2 without a delete-vs-activation race, and
repeat checker, security and App QA gates before any runtime wiring.

### Local PR16A follow-up — schema/integrity branch

The PR16A branch adds its reviewed forward/rollback migration pair after PR15
and before PR19. It encodes exact artifact, binding, selection and v2
cleanup relations, platform role cardinality, lifecycle/immutability guards and a
deferred active-account graph. Static parity coverage and an isolated PostgreSQL 16
harness provide local integrity evidence. It is preserved in draft PR #121 and
nothing has been applied to staging. PR16B's durable activation repository,
prewrite cleanup obligation and fenced activation/finality CAS are now preserved
in reviewed draft PR #124, still unmounted and unapplied. The initial launch
remains exactly 5–10 avatars with 10 videos each
(50–100), after a separately approved one-video sandbox.

### Local PR16B follow-up — durable activation and cleanup

The current branch `codex/ai-media-studio-pr16-durable-activation` is stacked on
PR16A commit `c9cd255c`. It adds an unapplied PR16B forward/rollback pair,
PostgreSQL-owned canonical selection time/digest, a secret-free staged
binding/artifact/cleanup graph, exact durable activation and replay CAS,
expired-staging abandonment to `activation_indeterminate`, a separate fenced
two-pass role-token-v2 cleanup subsystem, and a dedicated stable-double-snapshot
AWS v2 preflight. Every component remains unmounted and no real vault, provider,
database, spend, post or deployment was touched.

Final local evidence is 14/14 focused tests and 3/3 tests against an owned,
socket-only PostgreSQL cluster created under `/private/tmp` and destroyed after
the run. The PostgreSQL suite proves canonical JS/SQL selection digest parity,
prewrite graph staging, exact replay, cross-tenant rejection, concurrent
finalization with one `activated` and one `replayed`, expired staged recovery,
cleanup gating and evidence-preserving rollback. The complete suite passes 688
with 0 failures and 34 PostgreSQL-only skips out of 722; together with the three
separately executed PR16B PostgreSQL cases, composed evidence is 691 passed and
31 older PostgreSQL-only skips. TypeScript, production build, generated map and
diff hygiene pass. Independent checker and App QA are clean at P0=P1=P2=0 after
closing an expired-lease staged-replay race. Commit and push are preserved in
draft PR #124; staging and the one-video HeyGen sandbox still require Robert's
separate explicit approvals.
