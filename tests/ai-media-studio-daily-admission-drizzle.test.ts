import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DailyAdmissionPersistenceError,
  DrizzleDailyAdmissionRepository,
  type DailyAdmissionDatabase,
  type DailyAdmissionTransactionalDatabase,
  type ReserveAndAdmitRequest,
  type UnsignedReserveAndAdmitRequest,
} from "../server/ai-media-studio/planning/drizzle-daily-admission-repository";

const dialect = new PgDialect();
const ids = {
  plan: "11111111-1111-4111-8111-111111111111",
  slot: "22222222-2222-4222-8222-222222222222",
  bucket: "33333333-3333-4333-8333-333333333333",
  snapshot: "44444444-4444-4444-8444-444444444444",
  reservation: "55555555-5555-4555-8555-555555555555",
  influencer: "66666666-6666-4666-8666-666666666666",
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const databaseNow = new Date("2026-07-21T12:00:00.000Z");
const authorityDigest = `sha256:${"a".repeat(64)}` as const;
const admissionDigest = `sha256:${"b".repeat(64)}` as const;

function unsigned(overrides: Partial<UnsignedReserveAndAdmitRequest> = {}): UnsignedReserveAndAdmitRequest {
  return {
    scope,
    planId: ids.plan,
    slotId: ids.slot,
    budgetBucketId: ids.bucket,
    authoritySnapshotId: ids.snapshot,
    authorityDigest,
    expectedSlotStateVersion: 2,
    expectedBucketStateVersion: 7,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    idempotencyKey: "daily-admission-slot-1-attempt-1",
    ...overrides,
  };
}

function request(repository: DrizzleDailyAdmissionRepository, overrides: Partial<UnsignedReserveAndAdmitRequest> = {}): ReserveAndAdmitRequest {
  const input = unsigned(overrides);
  return { ...input, inputDigest: repository.inputDigest(input) };
}

function reservationRow(input: ReserveAndAdmitRequest, overrides: Record<string, unknown> = {}) {
  return {
    id: ids.reservation,
    budget_bucket_id: ids.bucket,
    daily_plan_slot_id: ids.slot,
    attempt: 3,
    state: "reserved",
    submission_state: "not_started",
    amount_micro_usd: "1250000",
    idempotency_key: input.idempotencyKey,
    input_digest: input.inputDigest,
    admission_digest: admissionDigest,
    authority_snapshot_id: input.authoritySnapshotId,
    authority_digest: input.authorityDigest,
    reserved_at: databaseNow,
    expires_at: new Date(input.reservationExpiresAt),
    database_now: databaseNow,
    replay_budget_date: "2026-07-21",
    replay_accounting_time_zone: "America/New_York",
    ...overrides,
  };
}

type Rendered = ReturnType<PgDialect["sqlToQuery"]>;

function makeDb(handler: (call: number, query: Rendered) => { rows: unknown[] }) {
  let call = 0;
  let transactions = 0;
  const calls: Rendered[] = [];
  const execute = async (query: Parameters<DailyAdmissionDatabase["execute"]>[0]) => {
    const rendered = dialect.sqlToQuery(query);
    calls.push(rendered);
    return handler(++call, rendered);
  };
  const db: DailyAdmissionTransactionalDatabase = {
    execute,
    async transaction(callback) {
      transactions += 1;
      return callback({ execute });
    },
  };
  return { db, calls, transactionCount: () => transactions };
}

const normalized = (query: Rendered) => query.sql.replace(/\s+/gu, " ").trim();
const assertCode = (code: DailyAdmissionPersistenceError["code"]) =>
  (error: unknown) => error instanceof DailyAdmissionPersistenceError && error.code === code;

test("PR20 admission repository remains unexported and request has no self-certified authority", () => {
  const barrel = readFileSync(new URL("../server/ai-media-studio/planning/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(barrel, /drizzle-daily-admission-repository/u);
  const repository = new DrizzleDailyAdmissionRepository(makeDb(() => ({ rows: [] })).db, {
    accountingTimeZone: "America/New_York",
  });
  const keys = Object.keys(request(repository)).sort();
  assert.deepEqual(keys, [
    "authorityDigest", "authoritySnapshotId", "budgetBucketId", "expectedBucketStateVersion",
    "expectedSlotStateVersion", "idempotencyKey", "inputDigest", "planId", "reservationExpiresAt",
    "scope", "slotId",
  ]);
  for (const forbidden of [
    "providerAccountId", "providerKey", "providerCredentialVersion", "influencerId", "governanceProfileId",
    "governanceUse", "governanceTerritory", "planDigest", "slotDigest", "scriptVariantChecksum", "attempt",
    "amountMicroUsd", "admissionDigest", "quoteDigest", "quoteExpiresAt", "contentApprovalGranted",
    "humanLaunchApprovalGranted", "policyAllowed", "killSwitchActive", "sandboxPassed", "providerIdempotencyKey",
  ]) assert.ok(!keys.includes(forbidden), `${forbidden} must not be caller supplied`);
});

test("locks exact durable authority, derives money/provider facts, and writes no activation effects", async () => {
  let input!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => {
    if (call === 5) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 7) return { rows: [{ database_now: databaseNow, budget_date: "2026-07-21" }] };
    if (call === 8) return { rows: [{ authority_snapshot_id: ids.snapshot, amount_micro_usd: "1250000" }] };
    if (call === 9) return { rows: [reservationRow(input)] };
    return { rows: [] };
  });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  input = request(repository);
  const result = await repository.reserveAndAdmit(input);

  assert.equal(harness.transactionCount(), 1);
  assert.equal(harness.calls.length, 9);
  assert.equal(result.reservation.amountMicroUsd, "1250000");
  assert.equal(result.replayed, false);
  assert.deepEqual(result.effects, {
    renderJobCreated: false, outboxCreated: false, eventCreated: false, providerCalled: false,
  });

  assert.match(normalized(harness.calls[2]), /global-concurrency/i);
  assert.ok(harness.calls[3].params.some((value) => String(value).includes("daily-admission:workspace")));
  assert.match(normalized(harness.calls[4]), /select slots\.influencer_id/i);
  assert.ok(harness.calls[5].params.some((value) => String(value).includes("ai-media-governance:profile")));
  assert.match(normalized(harness.calls[6]), /clock_timestamp\(\)/i);
  const gate = normalized(harness.calls[7]);
  for (const table of [
    "ai_media_launch_authority_snapshots", "ai_media_launch_evidence", "ai_media_admission_policy_revisions",
    "ai_media_kill_switch_revisions", "ai_media_daily_plans", "ai_media_daily_plan_slots",
    "ai_media_budget_buckets", "ai_media_provider_accounts", "ai_media_governance_profiles",
  ]) assert.match(gate, new RegExp(table, "i"));
  assert.match(gate, /for update of snapshots, content, human, sandbox, quotes, policy, kill/i);
  assert.match(gate, /content\.decision='approved'.*human\.decision='approved'.*sandbox\.decision='passed'.*quotes\.decision='quoted'/i);
  assert.match(gate, /policy\.state='active'.*kill\.active=false/i);
  assert.match(gate, /not exists.*newer.*revision>content\.revision/i);
  assert.match(gate, /not exists.*newer_policy.*revision>policy\.revision/i);
  assert.match(gate, /not exists.*newer_kill.*revision>kill\.revision/i);
  assert.match(gate, /snapshots\.maximum_quote_micro_usd=quotes\.amount_micro_usd/i);
  assert.match(gate, /buckets\.limit_micro_usd=policy\.daily_budget_micro_usd/i);
  assert.match(gate, /policy\.allowed_countries @> jsonb_build_array\(snapshots\.content_country\)/i);
  assert.match(gate, /count\(\*\).*policy\.total_concurrency.*count\(\*\).*policy\.provider_concurrency.*count\(\*\).*policy\.tenant_concurrency/i);
  assert.doesNotMatch(JSON.stringify(harness.calls[7].params), /1250000/u, "amount is not a request parameter");

  const mutation = normalized(harness.calls[8]);
  assert.match(mutation, /^with fresh_clock as materialized .*clock_timestamp\(\)/i);
  assert.match(mutation, /final_guard as materialized/i);
  for (const alias of ["snapshots", "content", "human", "sandbox", "quotes", "policy", "kill"]) {
    assert.match(mutation, new RegExp(alias, "i"));
  }
  assert.match(mutation, /reserved_micro_usd=buckets\.reserved_micro_usd\+final_guard\.amount_micro_usd/i);
  assert.match(mutation, /authority_snapshot_id,authority_digest/i);
  assert.match(mutation, /provider_idempotency_key/i);
  assert.ok(harness.calls[8].params.some((value) => /^admit:[0-9a-f]{64}$/u.test(String(value))));
  assert.match(mutation, /render_job_id,dispatch_outbox_id/i);
  assert.match(mutation, /null,null/i);
  assert.doesNotMatch(mutation, /insert into .*ai_media_render_jobs|insert into .*ai_media_outbox|insert into .*ai_media.*events?/i);
});

test("exact snapshot-bound replay returns before authority locks or writes", async () => {
  let input!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => call === 2 ? { rows: [reservationRow(input)] } : { rows: [] });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  input = request(repository);
  const result = await repository.reserveAndAdmit(input);
  assert.equal(result.replayed, true);
  assert.equal(harness.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(harness.calls), /launch_authority_snapshots|daily-admission:workspace/i);
});

test("replay conflicts when authority snapshot or digest differs", async () => {
  let original!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => call === 2 ? { rows: [reservationRow(original)] } : { rows: [] });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  original = request(repository);
  const changed = request(repository, { authorityDigest: `sha256:${"c".repeat(64)}` });
  await assert.rejects(repository.reserveAndAdmit(changed), assertCode("IDEMPOTENCY_CONFLICT"));
  assert.equal(harness.calls.length, 2);
});

test("request identities, versions, digests, and canonical expiry validate before transaction", async () => {
  const harness = makeDb(() => ({ rows: [] }));
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  const valid = request(repository);
  for (const invalid of [
    { ...valid, slotId: "not-a-uuid" },
    { ...valid, authoritySnapshotId: "not-a-uuid" },
    { ...valid, authorityDigest: "sha256:wrong" },
    { ...valid, expectedSlotStateVersion: 0 },
    { ...valid, reservationExpiresAt: "2026-07-21T12:10:00Z" },
    { ...valid, inputDigest: `sha256:${"0".repeat(64)}` },
  ]) await assert.rejects(repository.reserveAndAdmit(invalid as ReserveAndAdmitRequest), assertCode("INVALID_INPUT"));
  assert.equal(harness.transactionCount(), 0);
});

test("missing authority denies and a failed CAS cannot report admission", async () => {
  const denied = makeDb(() => ({ rows: [] }));
  const deniedRepository = new DrizzleDailyAdmissionRepository(denied.db, { accountingTimeZone: "America/New_York" });
  await assert.rejects(deniedRepository.reserveAndAdmit(request(deniedRepository)), assertCode("ADMISSION_DENIED"));
  assert.equal(denied.calls.length, 5);

  const cas = makeDb((call) => {
    if (call === 5) return { rows: [{ influencer_id: ids.influencer }] };
    if (call === 7) return { rows: [{ database_now: databaseNow, budget_date: "2026-07-21" }] };
    if (call === 8) return { rows: [{ authority_snapshot_id: ids.snapshot }] };
    return { rows: [] };
  });
  const casRepository = new DrizzleDailyAdmissionRepository(cas.db, { accountingTimeZone: "America/New_York" });
  await assert.rejects(casRepository.reserveAndAdmit(request(casRepository)), assertCode("INVARIANT_VIOLATION"));
  assert.equal(cas.calls.length, 9);
});
