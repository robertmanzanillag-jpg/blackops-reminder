import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type {
  AuthorizedLaunchAuthorityWrite,
  CreateLaunchAuthoritySnapshotCommand,
  LaunchAuthorityCapability,
  RecordContentApprovalCommand,
  RecordMaximumQuoteAttestationCommand,
  TrustedLaunchAuthorityPrincipal,
  TrustedLaunchSubject,
} from "../server/ai-media-studio/planning/launch-authority-contracts";
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
} as const;
const now = new Date("2026-07-21T12:00:00.000Z");
const expires = new Date("2026-07-21T12:20:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function trustedPrincipal(capability: LaunchAuthorityCapability, kind: "user" | "workload" = "user") {
  return {
    subjectId: kind === "user" ? "actor-1" : "workload-1", kind, capabilities: [capability],
    authenticationEvidenceDigest: digest("e"),
  } as unknown as TrustedLaunchAuthorityPrincipal;
}

const subjectBase = {
  scope, dailyPlanId: ids.plan, dailyPlanSlotId: ids.slot, slotAttempt: 1,
  planDigest: digest("1"), slotDigest: digest("2"), providerAccountId: ids.account,
  providerKey: "heygen", providerCredentialVersion: 3, scriptVariantId: ids.variant,
  scriptVariantChecksum: "3".repeat(64), governanceProfileId: ids.governance,
  governanceEvidenceDigest: digest("4"), governanceUse: "paid_ads", governanceTerritory: "US",
  contentCountry: "US",
};
const subject = {
  ...subjectBase,
  launchSubjectDigest: deriveLaunchSubjectDigest(subjectBase as never),
} as unknown as TrustedLaunchSubject;

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

function authorized<T>(operation: LaunchAuthorityOperation, command: T, principal: TrustedLaunchAuthorityPrincipal) {
  return {
    command, principal,
    inputDigest: launchAuthorityInputDigest(operation, command as never, principal),
  } as AuthorizedLaunchAuthorityWrite<T>;
}

function subjectRow(overrides: Record<string, unknown> = {}) {
  return {
    daily_plan_id: ids.plan, daily_plan_slot_id: ids.slot, plan_digest: subject.planDigest,
    slot_digest: subject.slotDigest, plan_date: "2026-07-21", accounting_time_zone: "UTC",
    plan_expires_at: new Date("2026-07-22T00:00:00.000Z"), influencer_id: ids.influencer,
    provider_account_id: ids.account, provider_key: "heygen", provider_credential_version: 3,
    script_variant_id: ids.variant, script_variant_checksum: subject.scriptVariantChecksum, language: "en",
    governance_profile_id: ids.governance, governance_evidence_digest: subject.governanceEvidenceDigest,
    governance_expires_at: new Date("2026-07-21T13:00:00.000Z"), credential_expires_at: null,
    ...overrides,
  };
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
    amount_micro_usd: kind === "maximum_quote" ? "1250000" : null,
    currency: kind === "maximum_quote" ? "USD" : null, revision: 1,
    evidence_digest: digest(kind === "content_approval" ? "5" : kind === "human_launch_approval" ? "6"
      : kind === "sandbox_proof" ? "7" : "8"), valid_from: now, expires_at: expires,
    input_digest: digest("9"), idempotency_key: `${kind}-idempotency`,
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
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { return undefined; } }, validityPolicy: { ttlSeconds: () => 600 },
  });
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
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { throw new Error("must not resolve"); } },
    validityPolicy: { ttlSeconds: () => 600 },
  });
  assert.equal((await repository.revisePolicy(input)).replayed, true);
  assert.equal(harness.calls.length, 2);

  const changedCommand = { ...command, allowedCountries: ["CA"] };
  const conflicting = authorized("revise_policy", changedCommand, principal);
  const conflictHarness = makeDb((call) => call === 2
    ? { rows: [{ id: ids.policy, input_digest: input.inputDigest }] } : { rows: [] });
  const conflictRepository = new DrizzleLaunchAuthorityRepository(conflictHarness.db, {
    subjectResolver: { async resolve() { throw new Error("must not resolve"); } },
    validityPolicy: { ttlSeconds: () => 600 },
  });
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
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { return undefined; } }, validityPolicy: { ttlSeconds: () => 600 },
  });
  await assert.rejects(repository.revisePolicy(input),
    (error: unknown) => error instanceof LaunchAuthorityPersistenceError && error.code === "AUTHORITY_DENIED");
  assert.equal(harness.calls.length, 0);
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
    if (call === 9) return { rows: [{ id: ids.created, input_digest: input.inputDigest }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { return subject; } }, validityPolicy: { ttlSeconds: () => 600 },
  });
  assert.equal((await repository.recordContentApproval(input)).kind, "content_approval");
  assert.ok(harness.calls[2].params.some((value) => String(value).includes("daily-admission:workspace")));
  assert.ok(harness.calls[4].params.some((value) => String(value).includes("ai-media-governance:profile")));
  const lockedSubject = sqlText(harness.calls[6]);
  assert.match(lockedSubject, /not exists.*newer.*newer\.version>governance\.version/i);
  assert.match(lockedSubject, /max\(previous\.attempt\)\+1/i);
  const previous = sqlText(harness.calls[7]);
  assert.match(previous, /order by revision desc limit 1 for update/i);
  assert.doesNotMatch(previous, /launch_subject_digest/i);
  const insert = sqlText(harness.calls[8]);
  assert.ok(harness.calls[8].params.includes("authenticated_workload"));
  assert.doesNotMatch(insert, /render_jobs|outbox|provider.*submit/i);
});

test("trusted quote is the only evidence method that carries exact micro-USD", async () => {
  const principal = trustedPrincipal("quote:attest", "workload");
  const command = {
    scope, dailyPlanSlotId: ids.slot, slotAttempt: 1, idempotencyKey: "maximum-quote-0001",
    attestation: { attestationId: "quote-attestation-1", decision: "quoted" as const,
      maximumQuoteMicroUsd: "1250000", currency: "USD" as const, sourceEvidenceDigest: digest("a") },
  } as unknown as RecordMaximumQuoteAttestationCommand;
  const input = authorized("record_maximum_quote_attestation", command, principal);
  const harness = makeDb((call) => {
    if (call === 4) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 6) return { rows: [{ generated_id: ids.created, database_now: now }] };
    if (call === 7) return { rows: [subjectRow()] };
    if (call === 9) return { rows: [{ id: ids.created, input_digest: input.inputDigest }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { return subject; } }, validityPolicy: { ttlSeconds: () => 600 },
  });
  await repository.recordMaximumQuoteAttestation(input);
  const insert = harness.calls[8];
  assert.ok(insert.params.includes("maximum_quote"));
  assert.ok(insert.params.includes("provider_quote_adapter"));
  assert.ok(insert.params.includes("1250000"));
  assert.ok(insert.params.includes("USD"));
  assert.doesNotMatch(JSON.stringify(command), /providerAccountId|governanceProfileId|launchSubjectDigest/);
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
    if (call === 8) return { rows: [policy] };
    if (call === 9) return { rows: [kill] };
    if (call >= 10 && call <= 13) return { rows: [evidence[call - 10]] };
    if (call === 14) return { rows: [{ id: ids.created, input_digest: input.inputDigest,
      authority_digest: digest("d"), admission_digest: digest("e") }] };
    return { rows: [] };
  });
  const repository = new DrizzleLaunchAuthorityRepository(harness.db, {
    subjectResolver: { async resolve() { return subject; } }, validityPolicy: { ttlSeconds: () => 300 },
  });
  const result = await repository.createAuthoritySnapshot(input);
  assert.equal(result.replayed, false);
  for (const query of harness.calls.slice(9, 13)) {
    const text = sqlText(query);
    assert.match(text, /order by revision desc limit 1 for update/i);
    assert.doesNotMatch(text, /launch_subject_digest/i);
  }
  const insert = harness.calls[13];
  assert.match(sqlText(insert), /insert into .*ai_media_launch_authority_snapshots/i);
  assert.ok(insert.params.includes("1250000"));
  assert.ok(insert.params.some((value) => value instanceof Date
    && value.toISOString() === "2026-07-21T12:05:00.000Z"));
  assert.doesNotMatch(allText(harness.calls), /insert into .*render_jobs|insert into .*outbox/i);
});
