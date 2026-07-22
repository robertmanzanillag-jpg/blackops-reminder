import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleOneVideoHeldAdmissionContextLoader } from "../server/ai-media-studio/planning/drizzle-one-video-held-admission-context-loader";
import { OneVideoHeldAdmissionError } from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" };
const planId = key("plan", "1"); const slotId = key("slot", "2");
const control = {
  subject: { planId, batchId: key("batch", "3"), slotId, slotAttempt: 1 },
  binding: { state: "current" }, providerVerification: { state: "verified" },
  maximumQuote: { state: "quoted", amountMicroUsd: "1250000", currency: "USD",
    expiresAt: "2026-07-22T12:30:00.000Z", quoteKey: key("quote", "4"),
    renderSpecKey: key("render_spec", "5") },
  humanApproval: { state: "approved", approvedQuoteKey: key("quote", "4"),
    renderSpecKey: key("render_spec", "5") },
};
const row = { daily_plan_id: uuid("1"), daily_plan_slot_id: uuid("2"), budget_bucket_id: uuid("3"),
  slot_state_version: 4, bucket_state_version: 7, database_now: new Date("2026-07-22T12:00:00.000Z") };

function sqlText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("loader derives internal IDs, versions, money and bounded expiry without browser authority", async () => {
  const queries: string[] = [];
  const loader = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute(query) {
    queries.push(sqlText(query)); return { rows: [row] };
  } }, { async observe(receivedScope, receivedPlan, receivedSlot) {
    assert.deepEqual(receivedScope, scope); assert.equal(receivedPlan, planId); assert.equal(receivedSlot, slotId);
    return control as never;
  } }, { reservationTtlSeconds: 600 });
  const result = await loader.load(scope, planId, slotId);
  assert.deepEqual(result, {
    scope, planId: row.daily_plan_id, dailyPlanSlotId: row.daily_plan_slot_id,
    budgetBucketId: row.budget_bucket_id, publicPlanKey: planId, publicBatchKey: control.subject.batchId,
    publicSlotKey: slotId, publicQuoteKey: control.maximumQuote.quoteKey,
    publicRenderSpecKey: control.maximumQuote.renderSpecKey, slotAttempt: 1,
    expectedSlotStateVersion: 4, expectedBucketStateVersion: 7,
    maximumQuoteMicroUsd: "1250000", currency: "USD",
    quoteExpiresAt: "2026-07-22T12:30:00.000Z", reservationExpiresAt: "2026-07-22T12:10:00.000Z",
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /plans\.status='planned'/u);
  assert.match(queries[0]!, /slots\.status='planned'/u);
  assert.match(queries[0]!, /transaction_timestamp/u);
});

test("server TTL is clamped to the exact quote expiry", async () => {
  const loader = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { return { rows: [row] }; } },
    { async observe() { return { ...control, maximumQuote: { ...control.maximumQuote,
      expiresAt: "2026-07-22T12:04:00.000Z" } } as never; } }, { reservationTtlSeconds: 600 });
  assert.equal((await loader.load(scope, planId, slotId))?.reservationExpiresAt, "2026-07-22T12:04:00.000Z");
});

test("loader fails closed before SQL when quote, approval, verification, or exact binding is unavailable", async () => {
  const cases = [
    { maximumQuote: { ...control.maximumQuote, state: "missing" } },
    { humanApproval: { ...control.humanApproval, state: "revoked" } },
    { humanApproval: { ...control.humanApproval, approvedQuoteKey: key("quote", "9") } },
    { providerVerification: { state: "stale" } }, { binding: { state: "stale" } },
  ];
  for (const changed of cases) {
    let queries = 0;
    const loader = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { queries += 1; return { rows: [row] }; } },
      { async observe() { return { ...control, ...changed } as never; } }, { reservationTtlSeconds: 600 });
    await assert.rejects(loader.load(scope, planId, slotId),
      (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
    assert.equal(queries, 0);
  }
});

test("missing DB-owned state returns not found; ambiguity, invalid versions, and expired quote fail closed", async () => {
  const executionControl = { async observe() { return control as never; } };
  const missing = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { return { rows: [] }; } },
    executionControl, { reservationTtlSeconds: 600 });
  assert.equal(await missing.load(scope, planId, slotId), undefined);
  const ambiguous = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { return { rows: [row, row] }; } },
    executionControl, { reservationTtlSeconds: 600 });
  await assert.rejects(ambiguous.load(scope, planId, slotId),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
  const invalid = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() {
    return { rows: [{ ...row, slot_state_version: 0 }] };
  } }, executionControl, { reservationTtlSeconds: 600 });
  await assert.rejects(invalid.load(scope, planId, slotId),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
  const expired = new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { return { rows: [row] }; } },
    { async observe() { return { ...control, maximumQuote: { ...control.maximumQuote,
      expiresAt: "2026-07-22T12:00:00.000Z" } } as never; } }, { reservationTtlSeconds: 600 });
  await assert.rejects(expired.load(scope, planId, slotId),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
});

test("invalid server TTL is rejected at composition time", () => {
  for (const reservationTtlSeconds of [0, 29, 3601, 30.5]) {
    assert.throws(() => new DrizzleOneVideoHeldAdmissionContextLoader({ async execute() { return []; } },
      { async observe() { return undefined; } }, { reservationTtlSeconds }),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
  }
});
