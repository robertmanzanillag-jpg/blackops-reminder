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
  account: "44444444-4444-4444-8444-444444444444",
  governance: "55555555-5555-4555-8555-555555555555",
  reservation: "66666666-6666-4666-8666-666666666666",
  influencer: "77777777-7777-4777-8777-777777777777",
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const databaseNow = new Date("2026-07-21T12:00:00.000Z");
const sha = (character: string) => `sha256:${character.repeat(64)}` as const;

function unsigned(overrides: Partial<UnsignedReserveAndAdmitRequest> = {}): UnsignedReserveAndAdmitRequest {
  return {
    scope,
    planId: ids.plan,
    slotId: ids.slot,
    budgetBucketId: ids.bucket,
    providerAccountId: ids.account,
    providerKey: "video-provider",
    providerCredentialVersion: 4,
    influencerId: ids.influencer,
    governanceProfileId: ids.governance,
    governanceUse: "commercial",
    governanceTerritory: "US",
    planDigest: sha("a"),
    slotDigest: sha("b"),
    scriptVariantChecksum: "9".repeat(64),
    expectedSlotStateVersion: 2,
    expectedBucketStateVersion: 7,
    budgetPolicyVersion: 3,
    attempt: 1,
    amountMicroUsd: 1_250_000n,
    idempotencyKey: "daily-admission-slot-1-attempt-1",
    admissionDigest: sha("c"),
    quoteDigest: sha("d"),
    quoteExpiresAt: "2026-07-21T12:30:00.000Z",
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    contentApprovalGranted: true,
    contentApprovalDigest: sha("e"),
    contentApprovalExpiresAt: "2026-07-21T12:20:00.000Z",
    humanLaunchApprovalGranted: true,
    humanLaunchApprovalDigest: sha("f"),
    humanLaunchApprovalExpiresAt: "2026-07-21T12:20:00.000Z",
    governanceEvidenceDigest: sha("1"),
    policyAllowed: true,
    policyDigest: sha("2"),
    killSwitchActive: false,
    killSwitchEvidenceDigest: sha("3"),
    sandboxPassed: true,
    sandboxEvidenceDigest: sha("4"),
    sandboxExpiresAt: "2026-07-21T12:20:00.000Z",
    providerIdempotencyKey: "provider-slot-1-attempt-1",
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
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    budget_bucket_id: ids.bucket,
    daily_plan_slot_id: ids.slot,
    provider_account_id: ids.account,
    provider_key: input.providerKey,
    provider_credential_version: input.providerCredentialVersion,
    attempt: input.attempt,
    state: "reserved",
    submission_state: "not_started",
    amount_micro_usd: String(input.amountMicroUsd),
    idempotency_key: input.idempotencyKey,
    input_digest: input.inputDigest,
    admission_digest: input.admissionDigest,
    script_variant_checksum: input.scriptVariantChecksum,
    quote_digest: input.quoteDigest,
    quote_expires_at: new Date(input.quoteExpiresAt),
    content_approval_digest: input.contentApprovalDigest,
    human_launch_approval_digest: input.humanLaunchApprovalDigest,
    governance_profile_id: input.governanceProfileId,
    governance_evidence_digest: input.governanceEvidenceDigest,
    policy_digest: input.policyDigest,
    kill_switch_evidence_digest: input.killSwitchEvidenceDigest,
    sandbox_evidence_digest: input.sandboxEvidenceDigest,
    provider_idempotency_key: input.providerIdempotencyKey,
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
    call += 1;
    return handler(call, rendered);
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

function normalized(query: Rendered): string {
  return query.sql.replace(/\s+/gu, " ").trim();
}

function assertCode(code: DailyAdmissionPersistenceError["code"]) {
  return (error: unknown) => error instanceof DailyAdmissionPersistenceError && error.code === code;
}

test("reservation scaffold is not exported through the runtime planning barrel", () => {
  const barrel = readFileSync(new URL("../server/ai-media-studio/planning/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(barrel, /drizzle-daily-admission-repository/u);
});

test("reserveAndAdmit locks exact authority and performs one event-free reservation transaction", async () => {
  let input!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => {
    if (call === 5) return { rows: [{ database_now: databaseNow, budget_date: "2026-07-21" }] };
    if (call === 6) return { rows: [{ plan_id: ids.plan, slot_id: ids.slot, bucket_id: ids.bucket }] };
    if (call === 7) return { rows: [reservationRow(input)] };
    return { rows: [] };
  });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  input = request(repository);
  const result = await repository.reserveAndAdmit(input);

  assert.equal(harness.transactionCount(), 1);
  assert.equal(harness.calls.length, 7);
  assert.equal(result.replayed, false);
  assert.equal(result.budgetDate, "2026-07-21");
  assert.equal(result.accountingTimeZone, "America/New_York");
  assert.equal(result.reservation.amountMicroUsd, "1250000");
  assert.deepEqual(result.effects, {
    renderJobCreated: false, outboxCreated: false, eventCreated: false, providerCalled: false,
  });

  assert.match(normalized(harness.calls[0]), /pg_advisory_xact_lock.*daily-admission:idempotency/i);
  assert.match(normalized(harness.calls[1]), /clock_timestamp\(\).*from .*ai_media_budget_reservations.*inner join .*ai_media_budget_buckets.*idempotency_key.*for update of .*reservations.*buckets/i);
  assert.match(normalized(harness.calls[2]), /pg_advisory_xact_lock.*daily-admission:workspace/i);
  assert.match(normalized(harness.calls[3]), /pg_advisory_xact_lock.*ai-media-governance:profile/i);
  assert.ok(harness.calls[3].params.includes(ids.influencer));
  assert.match(normalized(harness.calls[4]), /select observed_at as database_now.*at time zone.*from \(select clock_timestamp\(\)/i);

  const gates = normalized(harness.calls[5]);
  for (const table of ["ai_media_daily_plans", "ai_media_daily_plan_slots", "ai_media_budget_buckets",
    "ai_media_provider_accounts", "ai_media_governance_profiles"]) {
    assert.match(gates, new RegExp(table, "i"));
  }
  assert.match(gates, /for update of .*plans.*slots.*buckets.*accounts.*governance/i);
  assert.doesNotMatch(gates, /skip locked/i);
  for (const gate of ["credential_status", "credential_version", "governance.evidence_digest", "allowed_uses",
    "territories", "clock_timestamp", "timestamptz", "=true", "=false"]) assert.match(gates, new RegExp(gate, "i"));
  assert.match(gates, /slots\.influencer_id=/i);
  assert.match(gates, /select max\(previous\.attempt\)\+1.*daily_plan_slot_id=slots\.id/i);
  assert.match(gates, /not exists \( select 1 from .*ai_media_governance_profiles.*version>governance\.version/i);
  assert.match(gates, /variants\.status=.*approved.*variants\.checksum=/i);
  assert.ok(harness.calls[5].params.includes(ids.influencer));
  assert.ok(harness.calls[5].params.some((parameter) => String(parameter).includes("US")));
  const gateParameters = JSON.stringify(harness.calls[5].params);
  for (const evidence of [input.quoteExpiresAt, input.contentApprovalExpiresAt,
    input.humanLaunchApprovalExpiresAt, input.sandboxExpiresAt, input.governanceEvidenceDigest]) {
    assert.match(gateParameters, new RegExp(evidence.replaceAll(".", "\\.")));
  }
  assert.match(gates, /reserved_micro_usd\+buckets\.committed_micro_usd/i);

  const mutation = normalized(harness.calls[6]);
  assert.match(mutation, /^with fresh_clock as materialized .*clock_timestamp\(\)/i);
  assert.match(mutation, /final_guard as \( select .*from .*ai_media_daily_plans.*ai_media_daily_plan_slots.*ai_media_budget_buckets/i);
  assert.match(mutation, /plans\.plan_date=fresh_clock\.budget_date/i);
  assert.match(mutation, /buckets\.budget_date=fresh_clock\.budget_date/i);
  assert.match(mutation, /credential_expires_at>fresh_clock\.observed_at/i);
  assert.match(mutation, /governance\.expires_at>fresh_clock\.observed_at/i);
  assert.equal((mutation.match(/::timestamptz>fresh_clock\.observed_at/giu) ?? []).length, 5,
    "final guard revalidates quote, reservation, content, human, and sandbox expiry");
  for (const expiry of [input.quoteExpiresAt, input.reservationExpiresAt, input.contentApprovalExpiresAt,
    input.humanLaunchApprovalExpiresAt, input.sandboxExpiresAt]) assert.ok(harness.calls[6].params.includes(expiry));
  assert.match(mutation, /territories.*worldwide.*variants\.status=.*approved.*variants\.checksum=/i);
  assert.match(mutation, /bucket_update as \( update .*ai_media_budget_buckets/i);
  assert.match(mutation, /reservation_insert as \( insert into .*ai_media_budget_reservations/i);
  assert.match(mutation, /slot_update as \( update .*ai_media_daily_plan_slots/i);
  assert.match(mutation, /status=.*reserved.*state_version=state_version\+1.*updated_at=reservation\.reserved_at/i);
  assert.doesNotMatch(mutation, /transaction_timestamp\(\)/i);
  assert.match(mutation, /render_job_id,dispatch_outbox_id/i);
  assert.match(mutation, /null,null/i);
  assert.doesNotMatch(mutation, /insert into .*ai_media_render_jobs/i);
  assert.doesNotMatch(mutation, /insert into .*ai_media_outbox/i);
  assert.doesNotMatch(mutation, /ai_media.*event/i);
});

test("same idempotency key and exact digest replays before workspace lock or writes", async () => {
  let input!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => {
    if (call === 2) return { rows: [reservationRow(input, { database_now: new Date("2026-07-22T12:00:00.000Z") })] };
    return { rows: [] };
  });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  input = request(repository);
  const result = await repository.reserveAndAdmit(input);
  assert.equal(result.replayed, true);
  assert.equal(result.budgetDate, "2026-07-21", "replay reports the original locked bucket day, not today's day");
  assert.equal(harness.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(harness.calls), /daily-admission:workspace/i);
  assert.equal(result.reservation.id, ids.reservation);
});

test("same idempotency key with a changed digest conflicts without writes", async () => {
  const oldUnsigned = unsigned();
  let oldRequest!: ReserveAndAdmitRequest;
  const harness = makeDb((call) => {
    if (call === 2) return { rows: [reservationRow(oldRequest)] };
    return { rows: [] };
  });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  oldRequest = { ...oldUnsigned, inputDigest: repository.inputDigest(oldUnsigned) };
  const changed = request(repository, { amountMicroUsd: 1_300_000n });
  await assert.rejects(repository.reserveAndAdmit(changed), assertCode("IDEMPOTENCY_CONFLICT"));
  assert.equal(harness.calls.length, 2);
});

test("all identities, digests, integer money, and canonical instants validate before a transaction", async () => {
  const harness = makeDb(() => ({ rows: [] }));
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  const valid = request(repository);
  for (const invalid of [
    { ...valid, slotId: "not-a-uuid" },
    { ...valid, admissionDigest: "sha256:wrong" },
    { ...valid, scriptVariantChecksum: "not-a-checksum" },
    { ...valid, amountMicroUsd: "1.25" },
    { ...valid, amountMicroUsd: 9_000_000_000_000_001n },
    { ...valid, quoteExpiresAt: "2026-07-21T12:30:00Z" },
    { ...valid, governanceTerritory: "worldwide" },
    { ...valid, inputDigest: sha("0") },
  ]) {
    await assert.rejects(repository.reserveAndAdmit(invalid as ReserveAndAdmitRequest), assertCode("INVALID_INPUT"));
  }
  assert.equal(harness.transactionCount(), 0);
  assert.equal(harness.calls.length, 0);
  assert.throws(() => new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "Fake/Client_Zone" }), assertCode("INVALID_INPUT"));
});

test("a missing exact locked gate denies before the write CTE", async () => {
  const harness = makeDb((call) => call === 5
    ? { rows: [{ database_now: databaseNow, budget_date: "2026-07-21" }] }
    : { rows: [] });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  await assert.rejects(repository.reserveAndAdmit(request(repository, { killSwitchActive: true })), assertCode("ADMISSION_DENIED"));
  assert.equal(harness.calls.length, 6);
  assert.doesNotMatch(JSON.stringify(harness.calls), /reservation_insert/i);
});

test("a failed bucket or slot CAS aborts instead of reporting admission", async () => {
  const harness = makeDb((call) => {
    if (call === 5) return { rows: [{ database_now: databaseNow, budget_date: "2026-07-21" }] };
    if (call === 6) return { rows: [{ plan_id: ids.plan, slot_id: ids.slot, bucket_id: ids.bucket }] };
    return { rows: [] };
  });
  const repository = new DrizzleDailyAdmissionRepository(harness.db, { accountingTimeZone: "America/New_York" });
  await assert.rejects(repository.reserveAndAdmit(request(repository)), assertCode("INVARIANT_VIOLATION"));
  assert.equal(harness.calls.length, 7);
});
