import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type {
  AuthorizedLaunchAuthorityWrite,
  CreateLaunchAuthoritySnapshotCommand,
  DeclareLaunchIntentCommand,
  LaunchAuthorityCapability,
  RecordContentApprovalCommand,
  RecordHumanLaunchApprovalCommand,
  RecordMaximumQuoteAttestationCommand,
  RecordSandboxAttestationCommand,
  TrustedLaunchAuthorityPrincipal,
  TrustedLaunchSubject,
} from "../server/ai-media-studio/planning/launch-authority-contracts";
import {
  deriveLaunchRenderSpecDigest,
  deriveMaximumQuoteKey,
} from "../server/ai-media-studio/planning/one-video-execution-control-contracts";
import {
  deriveLaunchSubjectDigest,
  DrizzleLaunchAuthorityRepository,
  LaunchAuthorityPersistenceError,
  type LaunchAuthorityDatabase,
  type LaunchAuthorityTransactionalDatabase,
} from "../server/ai-media-studio/planning/drizzle-launch-authority-repository";
import {
  launchAuthorityInputDigest,
  type LaunchAuthorityOperation,
} from "../server/ai-media-studio/planning/launch-authority-service";
import {
  productionApprovalInputDigest,
  productionCreativeDigest,
} from "../server/ai-media-studio/production-batches/metadata-integrity";

const dialect = new PgDialect();
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const ids = {
  plan: "11111111-1111-4111-8111-111111111111",
  slot: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333",
  variant: "44444444-4444-4444-8444-444444444444",
  governance: "55555555-5555-4555-8555-555555555555",
  influencer: "66666666-6666-4666-8666-666666666666",
  policy: "77777777-7777-4777-8777-777777777777",
  kill: "88888888-8888-4888-8888-888888888888",
  content: "99999999-9999-4999-8999-999999999999",
  human: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sandbox: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  quote: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  created: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  intent: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  script: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  source: "12121212-1212-4212-8212-121212121212",
  avatar: "13131313-1313-4313-8313-131313131313",
  voice: "14141414-1414-4414-8414-141414141414",
  binding: "15151515-1515-4515-8515-151515151515",
} as const;
const now = new Date("2026-07-21T12:00:00.000Z");
const expires = new Date("2026-07-21T12:20:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const rawHash = (input: string) => createHash("sha256").update(input).digest("hex");
const productionPlanId = `plan_${"1".repeat(24)}`;
const productionSlotId = `slot_${"2".repeat(24)}`;
const productionBatchId = `batch_${"3".repeat(24)}`;

function trustedPrincipal(capability: LaunchAuthorityCapability, kind: "user" | "workload" = "user") {
  return {
    subjectId: kind === "user" ? "actor-1" : "workload-1", kind, capabilities: [capability],
    authenticationEvidenceDigest: digest("e"),
  } as unknown as TrustedLaunchAuthorityPrincipal;
}

const subjectBase = {
  scope, dailyPlanId: ids.plan, dailyPlanSlotId: ids.slot, slotAttempt: 1,
  planDigest: digest("1"), slotDigest: digest("2"), providerAccountId: ids.account,
  sourceRosterKey: "roster-1", sourceRosterDigest: digest("0"), sourceMemberKey: "member-1",
  providerKey: "heygen", providerCredentialVersion: 3, scriptVariantId: ids.variant,
  avatarResourceId: ids.avatar, voiceResourceId: ids.voice,
  scriptId: ids.script, scriptVariantChecksum: rawHash("Full selected script"), sourceType: "experiences",
  sourceItemId: ids.source, sourceContentHash: digest("6"), governanceProfileId: ids.governance,
  governanceEvidenceDigest: digest("4"), governanceUse: "paid_ads", governanceTerritory: "US",
  contentCountry: "US",
};
const subject = {
  ...subjectBase,
  launchIntentId: ids.intent, launchIntentDigest: digest("f"),
  renderSpecDigest: deriveLaunchRenderSpecDigest(subjectBase),
  launchSubjectDigest: deriveLaunchSubjectDigest({ ...subjectBase,
    launchIntentId: ids.intent, launchIntentDigest: digest("f") } as never),
} as unknown as TrustedLaunchSubject;

test("launch subject digest binds the durable launch intent identity", () => {
  assert.notEqual(deriveLaunchSubjectDigest({ ...subject, launchIntentId: ids.created } as never),
    subject.launchSubjectDigest);
  assert.notEqual(deriveLaunchSubjectDigest({ ...subject, launchIntentDigest: digest("a") } as never),
    subject.launchSubjectDigest);
});

type Rendered = ReturnType<PgDialect["sqlToQuery"]>;
function makeDb(handler: (call: number, query: Rendered) => { rows: unknown[] }) {
  let call = 0;
  const calls: Rendered[] = [];
  const execute = async (query: Parameters<LaunchAuthorityDatabase["execute"]>[0]) => {
    const rendered = dialect.sqlToQuery(query); calls.push(rendered); return handler(++call, rendered);
  };
  const db: LaunchAuthorityTransactionalDatabase = {
    execute,
    async transaction(callback) { return callback({ execute }); },
  };
  return { db, calls };
}

const sqlText = (query: Rendered) => query.sql.replace(/\s+/gu, " ").trim();
const allText = (calls: Rendered[]) => calls.map(sqlText).join(" ");
const options = (ttl = 600) => ({
  runtimeAttestationVerifier: { async verify() { return undefined; } },
  validityPolicy: { ttlSeconds: () => ttl },
});

function authorized<T>(operation: LaunchAuthorityOperation, command: T, principal: TrustedLaunchAuthorityPrincipal) {
  return {
    command, principal,
    inputDigest: launchAuthorityInputDigest(operation, command as never, principal),
  } as AuthorizedLaunchAuthorityWrite<T>;
}

function subjectRow(overrides: Record<string, unknown> = {}) {
  const creative = { title: "Selected title", angle: "Exact angle", hook: "Exact hook",
    script: "Full selected script", cta: "Exact CTA", caption: "Exact caption",
    hashtags: ["#kong"], seoKeywords: ["kong media"] };
  const base = {
    version: 1, batchId: productionBatchId, planId: productionPlanId, slotId: productionSlotId,
    scriptKey: `script_${"4".repeat(24)}`, idempotencyKey: "prepare-batch-0001",
    inputDigest: digest("5"), sourceContentHash: subject.sourceContentHash,
    sourceContentChecksum: rawHash("Exact source content"), sourceTitle: "Exact source title",
    sourceCategory: "experiences", generatorVersion: "deterministic-script-v1", variantCount: 1,
    preparedAt: "2026-07-21T11:00:00.000Z",
  };
  const approval = {
    version: 1, ...scope, batchId: productionBatchId, planId: productionPlanId,
    slotId: productionSlotId, scriptKey: base.scriptKey, selectedVariantChecksum: subject.scriptVariantChecksum,
    selectedCreativeDigest: productionCreativeDigest(creative),
    inputDigest: productionApprovalInputDigest({ ...scope, planId: productionPlanId,
      expectedBatchId: productionBatchId, idempotencyKey: "approve-batch-0001" }),
    idempotencyKey: "approve-batch-0001", approvedAt: "2026-07-21T11:30:00.000Z",
  };
  return {
    daily_plan_id: ids.plan, daily_plan_slot_id: ids.slot, plan_digest: subject.planDigest,
    public_plan_key: productionPlanId, plan_status: "planned", planned_slot_count: 50,
    public_slot_key: productionSlotId,
    slot_status: "planned",
    slot_digest: subject.slotDigest, plan_date: "2026-07-21", accounting_time_zone: "UTC",
    id: ids.intent, launch_intent_digest: subject.launchIntentDigest,
    launch_subject_digest: subject.launchSubjectDigest,
    source_roster_key: subject.sourceRosterKey, source_roster_digest: subject.sourceRosterDigest,
    source_member_key: subject.sourceMemberKey, script_id: ids.script, source_type: "experiences",
    source_item_id: ids.source, source_content_hash: subject.sourceContentHash,
    plan_expires_at: new Date("2026-07-22T00:00:00.000Z"), influencer_id: ids.influencer,
    provider_account_id: ids.account, provider_key: "heygen", provider_credential_version: 3,
    avatar_resource_id: ids.avatar, voice_resource_id: ids.voice,
    script_variant_id: ids.variant, script_variant_checksum: subject.scriptVariantChecksum, language: "en",
    script_title: creative.title, script_status: "approved", current_variant_id: ids.variant,
    script_metadata: { productionBatchV1: base, productionBatchApprovalV1: approval },
    selected_variant_id: ids.variant, selected_variant_version: 1, selected_variant_label: creative.title,
    selected_variant_content: creative.script, selected_variant_status: "approved",
    selected_variant_checksum: subject.scriptVariantChecksum,
    selected_variant_metadata: { productionBatchV1: { ...base, variantKey: `variant_${"7".repeat(24)}`,
      variantIndex: 0, selected: true }, productionCreativeV1: { ...creative,
      creativeDigest: approval.selectedCreativeDigest }, productionBatchApprovalV1: approval },
    variant_id: ids.variant, variant_version: 1, variant_label: creative.title,
    variant_content: creative.script, variant_status: "approved", variant_checksum: subject.scriptVariantChecksum,
    variant_metadata: { productionBatchV1: { ...base, variantKey: `variant_${"7".repeat(24)}`,
      variantIndex: 0, selected: true }, productionCreativeV1: { ...creative,
      creativeDigest: approval.selectedCreativeDigest }, productionBatchApprovalV1: approval },
    governance_profile_id: ids.governance, governance_evidence_digest: subject.governanceEvidenceDigest,
    governance_use: subject.governanceUse, governance_territory: subject.governanceTerritory,
    content_country: subject.contentCountry,
    governance_expires_at: new Date("2026-07-21T13:00:00.000Z"), credential_expires_at: null,
    ...overrides,
  };
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return { id: ids.source, source_type: "experiences", title: "Exact source title",
    content: "Exact source content", content_hash: subject.sourceContentHash, status: "ready",
    rights_status: "owned", moderation_status: "approved", ...overrides };
}

function planShapeRows() {
  return Array.from({ length: 50 }, (_, index) => ({
    source_member_key: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
    video_number: (index % 10) + 1, slot_status: "planned",
  }));
}

function evidenceRow(kind: "content_approval" | "human_launch_approval" | "sandbox_proof" | "maximum_quote") {
  const identity = { content_approval: ids.content, human_launch_approval: ids.human,
    sandbox_proof: ids.sandbox, maximum_quote: ids.quote }[kind];
  const decision = { content_approval: "approved", human_launch_approval: "approved",
    sandbox_proof: "passed", maximum_quote: "quoted" }[kind];
  return {
    id: identity, owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    daily_plan_slot_id: ids.slot, slot_attempt: 1, provider_account_id: ids.account,
    provider_key: "heygen", provider_credential_version: 3, script_variant_id: ids.variant,
    script_variant_checksum: subject.scriptVariantChecksum, governance_profile_id: ids.governance,
    governance_evidence_digest: subject.governanceEvidenceDigest, governance_use: subject.governanceUse,
    governance_territory: subject.governanceTerritory, content_country: subject.contentCountry,
    launch_subject_digest: subject.launchSubjectDigest, evidence_kind: kind, decision,
    launch_intent_id: ids.intent, launch_intent_digest: subject.launchIntentDigest,
    amount_micro_usd: kind === "maximum_quote" ? "1250000" : null,
    currency: kind === "maximum_quote" ? "USD" : null, revision: 1,
    evidence_digest: digest(kind === "content_approval" ? "5" : kind === "human_launch_approval" ? "6"
      : kind === "sandbox_proof" ? "7" : "8"), valid_from: now, expires_at: expires,
    input_digest: digest("9"), idempotency_key: `${kind}-idempotency`,
  };
}

function approvalBridgeRow(overrides: Record<string, unknown> = {}) {
  const human = evidenceRow("human_launch_approval");
  const quote = evidenceRow("maximum_quote");
  return {
    id: ids.binding, owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    daily_plan_slot_id: ids.slot, slot_attempt: 1, launch_subject_digest: subject.launchSubjectDigest,
    launch_intent_id: ids.intent, launch_intent_digest: subject.launchIntentDigest,
    human_launch_approval_evidence_id: human.id,
    human_launch_approval_evidence_revision: human.revision,
    human_launch_approval_evidence_digest: human.evidence_digest,
    maximum_quote_evidence_id: quote.id, maximum_quote_evidence_revision: quote.revision,
    maximum_quote_evidence_digest: quote.evidence_digest, maximum_quote_decision: "quoted",
    decision: "approved", amount_micro_usd: "1250000", currency: "USD",
    quote_expires_at: expires, render_spec_digest: subject.renderSpecDigest,
    approval_binding_digest: digest("a"), input_digest: digest("9"),
    human_evidence_kind: "human_launch_approval", maximum_quote_evidence_kind: "maximum_quote",
    ...overrides,
  };
}

test("policy revision uses DB time, exact chain, shared lock order, and server-derived digests", async () => {
  const principal = trustedPrincipal("policy:revise");
  const command = {
    scope, state: "active" as const, dailyBudgetMicroUsd: "5000000", totalConcurrency: 10,
    providerConcurrency: 5, tenantConcurrency: 5, allowedLanguages: ["en"],
    allowedCountries: ["US"], allowedTimeZones: ["UTC"], idempotencyKey: "policy-revision-0001",
  };
  const input = authorized("revise_policy", command, principal);
  const harness = makeDb((call) => call === 4 ? { rows: [{ generated_id: ids.created, database_now: now }] }
    : call === 6 ? { rows: [{ id: ids.created, input_digest: input.inputDigest }] } : { rows: [] });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, options());
  const result = await repository.revisePolicy(input);
  assert.equal(result.replayed, false);
  assert.equal(harness.calls.length, 6);
  assert.ok(harness.calls[0].params.some((value) => String(value).includes("idempotency")));
  assert.ok(harness.calls[2].params.some((value) => String(value).includes("daily-admission:workspace")));
  assert.match(sqlText(harness.calls[3]), /gen_random_uuid\(\).*clock_timestamp\(\)/i);
  assert.match(sqlText(harness.calls[4]), /order by revision desc limit 1 for update/i);
  const insert = sqlText(harness.calls[5]);
  assert.match(insert, /policy_digest,evidence_digest,actor_user_id,idempotency_key,input_digest/i);
  assert.ok(harness.calls[5].params.some((value) => value instanceof Date && value.toISOString() === now.toISOString()));
  assert.equal(harness.calls[5].params.filter((value) => /^sha256:[0-9a-f]{64}$/u.test(String(value))).length >= 3, true);
});

test("exact policy replay returns before workspace lock and a different valid command conflicts", async () => {
  const principal = trustedPrincipal("policy:revise");
  const command = { scope, state: "disabled" as const, dailyBudgetMicroUsd: "0", totalConcurrency: 0,
    providerConcurrency: 0, tenantConcurrency: 0, allowedLanguages: ["en"], allowedCountries: ["US"],
    allowedTimeZones: ["UTC"], idempotencyKey: "policy-replay-0001" };
  const input = authorized("revise_policy", command, principal);
  const harness = makeDb((call) => call === 2
    ? { rows: [{ id: ids.policy, input_digest: input.inputDigest }] } : { rows: [] });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, options());
  assert.equal((await repository.revisePolicy(input)).replayed, true);
  assert.equal(harness.calls.length, 2);

  const changedCommand = { ...command, allowedCountries: ["CA"] };
  const conflicting = authorized("revise_policy", changedCommand, principal);
  const conflictHarness = makeDb((call) => call === 2
    ? { rows: [{ id: ids.policy, input_digest: input.inputDigest }] } : { rows: [] });
  const conflictRepository = new DrizzleLaunchAuthorityRepository(conflictHarness.db, options());
  await assert.rejects(conflictRepository.revisePolicy(conflicting),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(conflictHarness.calls.length, 2);
});

test("repository enforces the exact authenticated principal kind as well as capability", async () => {
  const principal = trustedPrincipal("policy:revise", "workload");
  const command = { scope, state: "disabled" as const, dailyBudgetMicroUsd: "0", totalConcurrency: 0,
    providerConcurrency: 0, tenantConcurrency: 0, allowedLanguages: ["en"], allowedCountries: ["US"],
    allowedTimeZones: ["UTC"], idempotencyKey: "policy-wrong-principal-kind" };
  const input = authorized("revise_policy", command, principal);
  const harness = makeDb(() => ({ rows: [] }));
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, options());
  await assert.rejects(repository.revisePolicy(input),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "AUTHORITY_DENIED");
  assert.equal(harness.calls.length, 0);
});

test("human launch intent derives and freezes the exact current database subject", async () => {
  const principal = trustedPrincipal("launch_intent:declare", "user");
  const command: DeclareLaunchIntentCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    governanceUse: "paid_ads", governanceTerritory: "US", contentCountry: "US",
    idempotencyKey: "launch-intent-declare-0001" };
  const input = authorized("declare_launch_intent", command, principal);
  const harness = makeDb((call) => {
    if (call === 5) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 7) return { rows: [{ generated_id: ids.intent, database_now: now }] };
    if (call === 8) return { rows: [subjectRow()] };
    if (call === 9) return { rows: planShapeRows() };
    if (call === 10) return { rows: [sourceRow()] };
    if (call === 11) return { rows: [{ id: ids.intent, input_digest: input.inputDigest }] };
    return { rows: [] };
  });
  const result = await new DrizzleLaunchAuthorityRepository(harness.db, options()).declareLaunchIntent(input);
  assert.equal(result.kind, "launch_intent");
  assert.match(sqlText(harness.calls[7]), /source_roster_key.*source_member_key.*current_variant_id/i);
  assert.match(sqlText(harness.calls[7]), /not exists.*newer.*version>governance\.version/i);
  assert.match(sqlText(harness.calls[7]), /sources\.status in \('accepted','ready'\).*rights_status in \('owned','licensed'\)/i);
  assert.match(sqlText(harness.calls[7]), /jsonb_build_array\(\$\d+::text\).*jsonb_build_array\(\$\d+::text\)/i);
  assert.match(sqlText(harness.calls[8]), /for update/i);
  assert.match(sqlText(harness.calls[9]), /for update/i);
  const insert = sqlText(harness.calls[10]);
  assert.match(insert, /insert into .*ai_media_launch_intents/i);
  assert.match(insert, /launch_subject_digest,launch_intent_digest,actor_user_id,input_digest/i);
  assert.doesNotMatch(JSON.stringify(command), /planDigest|providerAccountId|scriptVariantId|sourceItemId/i);
});

test("launch intent denies legacy or tampered production metadata before inserting authority", async () => {
  const principal = trustedPrincipal("launch_intent:declare", "user");
  const command: DeclareLaunchIntentCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    governanceUse: "paid_ads", governanceTerritory: "US", contentCountry: "US",
    idempotencyKey: "launch-intent-tampered-metadata" };
  const input = authorized("declare_launch_intent", command, principal);
  const row = subjectRow({ script_metadata: {} });
  const harness = makeDb((call) => {
    if (call === 5) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 7) return { rows: [{ generated_id: ids.intent, database_now: now }] };
    if (call === 8) return { rows: [row] };
    if (call === 9) return { rows: planShapeRows() };
    if (call === 10) return { rows: [sourceRow()] };
    return { rows: [] };
  });
  await assert.rejects(new DrizzleLaunchAuthorityRepository(harness.db, options()).declareLaunchIntent(input),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "AUTHORITY_DENIED");
  assert.equal(harness.calls.length, 10);
  assert.doesNotMatch(allText(harness.calls), /insert into .*ai_media_launch_intents/i);
});

test("opaque runtime handle denies when the injected verifier cannot authenticate it", async () => {
  const principal = trustedPrincipal("sandbox:attest", "workload");
  const command: RecordSandboxAttestationCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    attestationHandle: "forged-sandbox-handle", idempotencyKey: "sandbox-forged-handle-0001" };
  const input = authorized("record_sandbox_attestation", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    return { rows: [] };
  });
  await assert.rejects(new DrizzleLaunchAuthorityRepository(harness.db, options()).recordSandboxAttestation(input),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "AUTHORITY_DENIED");
  assert.equal(harness.calls.length, 9, "verification denies before evidence-chain read or insert");
});

test("content evidence derives exact subject and chain after workspace plus governance locks", async () => {
  const principal = trustedPrincipal("content:decide", "workload");
  const command: RecordContentApprovalCommand = {
    scope, dailyPlanSlotId: ids.slot, slotAttempt: 1, decision: "approved", idempotencyKey: "content-approval-0001",
  };
  const input = authorized("record_content_approval", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    if (call === 11) return { rows: [{ id: ids.created, input_digest: input.inputDigest }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, options());
  assert.equal((await repository.recordContentApproval(input)).kind, "content_approval");
  assert.ok(harness.calls[2].params.some((value) => String(value).includes("daily-admission:workspace")));
  assert.ok(harness.calls[4].params.some((value) => String(value).includes("ai-media-governance:profile")));
  const lockedSubject = sqlText(harness.calls[6]);
  assert.match(lockedSubject, /not exists.*newer.*newer\.version>governance\.version/i);
  assert.match(lockedSubject, /max\(previous\.attempt\)\+1/i);
  assert.match(lockedSubject, /jsonb_build_array\(intents\.governance_use::text\).*jsonb_build_array\(intents\.governance_territory::text\)/i);
  const previous = sqlText(harness.calls[9]);
  assert.match(previous, /order by revision desc limit 1 for update/i);
  assert.doesNotMatch(previous, /launch_subject_digest/i);
  const insert = sqlText(harness.calls[10]);
  assert.ok(harness.calls[10].params.includes("authenticated_workload"));
  assert.ok(!harness.calls[10].params.includes(principal.authenticationEvidenceDigest),
    "human/workload authentication evidence is actor-bound in evidenceDigest, not persisted as runtime attestation evidence");
  assert.doesNotMatch(insert, /render_jobs|outbox|provider.*submit/i);
});

test("exact-subject relock revalidates production metadata before appending evidence", async () => {
  const principal = trustedPrincipal("content:decide", "workload");
  const command: RecordContentApprovalCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    decision: "approved", idempotencyKey: "content-approval-tampered-metadata" };
  const input = authorized("record_content_approval", command, principal);
  const row = subjectRow();
  (row.variant_metadata as Record<string, unknown>).untrustedExtension = true;
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [row] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    return { rows: [] };
  });
  await assert.rejects(new DrizzleLaunchAuthorityRepository(harness.db, options()).recordContentApproval(input),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "AUTHORITY_DENIED");
  assert.equal(harness.calls.length, 9);
  assert.doesNotMatch(allText(harness.calls), /insert into .*ai_media_launch_evidence/i);
});

test("trusted quote is the only evidence method that carries exact micro-USD", async () => {
  const providerQuoteExpiry = new Date("2026-07-21T12:03:00.000Z");
  const principal = trustedPrincipal("quote:attest", "workload");
  const command = {
    scope, dailyPlanSlotId: ids.slot, slotAttempt: 1, idempotencyKey: "maximum-quote-0001",
    attestationHandle: "quote-attestation-handle-1",
  } as unknown as RecordMaximumQuoteAttestationCommand;
  const input = authorized("record_maximum_quote_attestation", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    if (call === 11) return { rows: [{ id: ids.created, input_digest: input.inputDigest }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    runtimeAttestationVerifier: { async verify() { return {
      kind: "maximum_quote" as const, attestationId: "quote-attestation-1", decision: "quoted" as const,
      maximumQuoteMicroUsd: "1250000", currency: "USD" as const, sourceEvidenceDigest: digest("a"),
      quoteExpiresAt: providerQuoteExpiry.toISOString(),
    } as never; } }, validityPolicy: { ttlSeconds: () => 600 },
  });
  await repository.recordMaximumQuoteAttestation(input);
  const insert = harness.calls[10];
  assert.match(sqlText(insert), /source_attestation_id,source_evidence_digest,evidence_digest/i);
  assert.ok(insert.params.includes("maximum_quote"));
  assert.ok(insert.params.includes("provider_quote_adapter"));
  assert.ok(insert.params.includes("1250000"));
  assert.ok(insert.params.includes("USD"));
  assert.ok(insert.params.some((value) => value instanceof Date
    && value.toISOString() === providerQuoteExpiry.toISOString()), "provider quote expiry clamps authority TTL");
  assert.doesNotMatch(JSON.stringify(command), /providerAccountId|governanceProfileId|launchSubjectDigest/);
});

test("human decision CAS atomically appends exact evidence and quote/render bridge", async () => {
  const principal = trustedPrincipal("human_launch:decide", "user");
  const quote = evidenceRow("maximum_quote");
  const expectedQuoteKey = deriveMaximumQuoteKey({ evidenceId: String(quote.id),
    evidenceRevision: Number(quote.revision), evidenceDigest: quote.evidence_digest,
    amountMicroUsd: "1250000", currency: "USD", expiresAt: expires,
    renderSpecDigest: subject.renderSpecDigest });
  const command: RecordHumanLaunchApprovalCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    decision: "approved", expectedQuoteKey, idempotencyKey: "quote-bound-human-approval-0001" };
  const input = authorized("record_human_launch_approval", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ human_evidence_id: ids.human, approval_binding_id: ids.binding,
      database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    if (call === 10) return { rows: [quote] };
    if (call === 12) return { rows: [{ id: ids.human, input_digest: input.inputDigest }] };
    if (call === 13) return { rows: [approvalBridgeRow({ input_digest: input.inputDigest })] };
    return { rows: [] };
  });
  const result = await new DrizzleLaunchAuthorityRepository(harness.db, options(900))
    .recordHumanLaunchApproval(input);
  assert.equal(result.replayed, false);
  assert.match(sqlText(harness.calls[9]), /evidence_kind='maximum_quote'.*order by revision desc limit 1 for update/i);
  assert.match(sqlText(harness.calls[11]), /insert into .*ai_media_launch_evidence/i);
  assert.match(sqlText(harness.calls[12]), /insert into .*ai_media_quote_bound_human_approvals/i);
  assert.ok(harness.calls[12].params.includes(subject.renderSpecDigest));
  assert.ok(harness.calls[12].params.includes("1250000"));
  assert.doesNotMatch(JSON.stringify(command), /evidenceId|digest|amount|currency|renderSpec/iu);
  assert.doesNotMatch(allText(harness.calls), /render_jobs|outbox|insert\s+into\s+.*budget_reservations|provider.*submit/i);
});

test("human decision rejects stale quote CAS before any evidence or bridge insert", async () => {
  const principal = trustedPrincipal("human_launch:decide", "user");
  const command: RecordHumanLaunchApprovalCommand = { scope, dailyPlanSlotId: ids.slot, slotAttempt: 1,
    decision: "approved", expectedQuoteKey: `quote_${"0".repeat(24)}`,
    idempotencyKey: "quote-bound-human-stale-0001" };
  const input = authorized("record_human_launch_approval", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ human_evidence_id: ids.human, approval_binding_id: ids.binding,
      database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    if (call === 10) return { rows: [evidenceRow("maximum_quote")] };
    return { rows: [] };
  });
  await assert.rejects(new DrizzleLaunchAuthorityRepository(harness.db, options()).recordHumanLaunchApproval(input),
    (error: unknown) => error?.constructor?.name === "LaunchAuthorityQuoteChangedError");
  assert.doesNotMatch(allText(harness.calls), /insert into .*ai_media_(?:launch_evidence|quote_bound_human_approvals)/i);
});

test("snapshot chooses latest whole chains, validates gates, and derives bounded immutable digests", async () => {
  const principal = trustedPrincipal("snapshot:create", "workload");
  const command: CreateLaunchAuthoritySnapshotCommand = {
    scope, dailyPlanSlotId: ids.slot, slotAttempt: 1, idempotencyKey: "authority-snapshot-0001",
  };
  const input = authorized("create_authority_snapshot", command, principal);
  const policy = { id: ids.policy, revision: 1, state: "active", policy_digest: digest("b"),
    valid_from: now, expires_at: null, allowed_languages: ["en"], allowed_countries: ["US"],
    allowed_time_zones: ["UTC"] };
  const kill = { id: ids.kill, revision: 1, active: false, evidence_digest: digest("c"),
    valid_from: now, expires_at: null };
  const evidence = [evidenceRow("content_approval"), evidenceRow("human_launch_approval"),
    evidenceRow("sandbox_proof"), evidenceRow("maximum_quote")];
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 8) return { rows: planShapeRows() };
    if (call === 9) return { rows: [sourceRow()] };
    if (call === 10) return { rows: [policy] };
    if (call === 11) return { rows: [kill] };
    if (call >= 12 && call <= 15) return { rows: [evidence[call - 12]] };
    if (call === 16) return { rows: [approvalBridgeRow()] };
    if (call === 17) return { rows: [{ id: ids.created, input_digest: input.inputDigest,
      authority_digest: digest("d"), admission_digest: digest("e") }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, options(300));
  const result = await repository.createAuthoritySnapshot(input);
  assert.equal(result.replayed, false);
  for (const query of harness.calls.slice(11, 15)) {
    const text = sqlText(query);
    assert.match(text, /order by revision desc limit 1 for update/i);
    assert.doesNotMatch(text, /launch_subject_digest/i);
  }
  assert.match(sqlText(harness.calls[15]), /ai_media_quote_bound_human_approvals/i);
  const insert = harness.calls[16];
  assert.match(sqlText(insert), /insert into .*ai_media_launch_authority_snapshots/i);
  assert.ok(insert.params.includes("1250000"));
  assert.ok(insert.params.some((value) => value instanceof Date
    && value.toISOString() === "2026-07-21T12:05:00.000Z"));
  assert.doesNotMatch(allText(harness.calls), /insert into .*render_jobs|insert into .*outbox/i);
});
