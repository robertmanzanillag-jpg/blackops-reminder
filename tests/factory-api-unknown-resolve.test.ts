import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NEWS_EXECUTION_ID, parseResolveArgs, planUnknownResolution, runUnknownResolution } from "../script/factory-api-unknown-resolve-core";
import { checkpointFactoryApiMonth, emptyFactoryApiState, factoryApiBudgetStatus, parseFactoryApiState, reserveFactoryApi,
  resolveFactoryApiUnknown, type FactoryApiState } from "../server/software-factory-api-budget";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";

const now = "2026-11-25T12:00:00.000Z";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const ev = sha("evidence"), newsKey = `office:${sha(NEWS_EXECUTION_ID)}`;
const exposure = { configured: true, fixedCents: 0, spentCents: 0, reservedCents: 0, unknown: false, parents: [] };
const grant = { id: "g1", accountScope: "openai-test", availableMicroUsd: 10_000_000, observedAt: "2026-11-19T00:00:00.000Z",
  expiresAt: "2026-12-31T00:00:00.000Z", verificationEvidenceId: "ev1" };
const sharedState = (status: "unknown" | "reserved" = "unknown"): SharedCreditState => ({ version: 1, grant, lastObservedAt: "2026-11-24T00:00:00.000Z",
  reservations: [{ key: newsKey, consumer: "office", requestSha256: ev, reservedMicroUsd: 40_000, createdAt: "2026-11-20T00:00:00.000Z", status,
    ...(status === "unknown" ? { unknownEvidenceId: "office-execution:x" } : {}) }] });
const withExternal = (): FactoryApiState => { const s = emptyFactoryApiState();
  checkpointFactoryApiMonth(s, exposure, { month: "2026-11", evidenceSha256: ev, reconciledAt: "2026-11-25T10:00:00.000Z",
    externalSpentMicroUsd: 0, externalReservedMicroUsd: 40_000, externalUnknownReservations: 1, complete: true }, now); return s; };
const apiUnknown = (): FactoryApiState => { const s = emptyFactoryApiState();
  checkpointFactoryApiMonth(s, exposure, { month: "2026-11", evidenceSha256: ev, reconciledAt: "2026-11-25T10:00:00.000Z",
    externalSpentMicroUsd: 0, externalReservedMicroUsd: 0, externalUnknownReservations: 0, complete: true }, now);
  reserveFactoryApi(s, exposure, { key: newsKey, requestSha256: ev, maximumMicroUsd: 70_000, consumer: "office" }, now);
  s.reservations[0].status = "unknown"; return s; };

function fakeShared(state: SharedCreditState) {
  let current = structuredClone(state);
  const ledger = createSharedOpenAiCreditLedger({ grant, now: () => new Date(now), maximumGrantObservationAgeMs: 60_000,
    transact: async mutate => { const draft = structuredClone(current); const r = mutate(draft); current = draft; return r; } });
  return { ledger, get: () => current };
}
async function apply(shared: ReturnType<typeof fakeShared> | null, api: FactoryApiState, holdId = NEWS_EXECUTION_ID) {
  const receipts: unknown[] = [];
  const plan = planUnknownResolution({ holdId, shared: shared?.get() ?? null, api });
  const out = await runUnknownResolution(plan, { apply: true, evidenceSha256: ev, at: now, appendReceipt: async r => { receipts.push(r); },
    settleShared: async s => { await shared!.ledger.settle({ ...s, reconciliation: { executionStopped: true } }); },
    resolveApi: async r => resolveFactoryApiUnknown(api, r, now) });
  return { out, receipts };
}

test("default hold is the News execution; evidence only hashed", () => {
  const a = parseResolveArgs([], "operator reviewed: News hold assumed spent in full");
  assert.equal(a.holdId, NEWS_EXECUTION_ID); assert.equal(a.apply, false); assert.match(a.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => parseResolveArgs([], "short"), /EVIDENCE_INVALID/);
  assert.throws(() => parseResolveArgs(["--hold-id=a b"], "x".repeat(30)), /HOLD_ID_INVALID/);
});

test("shared + external hold settles at full amount, unblocks admission, idempotent", async () => {
  const shared = fakeShared(sharedState()), api = withExternal();
  assert.equal(factoryApiBudgetStatus(api, exposure, now).reason, "FACTORY_API_UNKNOWN_HOLD");
  const { out, receipts } = await apply(shared, api);
  assert.equal(out.applied, true); assert.equal(receipts.length, 2);
  const row = shared.get().reservations[0];
  assert.equal(row.status, "settled"); assert.equal(row.actualMicroUsd, 40_000); assert.equal(row.reconciled, true);
  assert.equal(api.resolutions![0].settledMicroUsd, 40_000);
  const status = factoryApiBudgetStatus(api, exposure, now);
  assert.equal(status.reason, "FACTORY_API_READY"); assert.equal(status.reservedMicroUsd, 40_000); // still counted, never released
  assert.equal(reserveFactoryApi(api, exposure, { key: "new", requestSha256: ev, maximumMicroUsd: 1, consumer: "office" }, now).admitted, true);
  const again = await apply(shared, api);
  assert.equal(again.out.applied, false); assert.equal(again.out.alreadyResolved, true); assert.equal(again.receipts.length, 0);
  assert.equal(api.resolutions!.length, 1);
});

test("API-ledger unknown resolves at full maximum; spent, not reserved; repeat is no-op", async () => {
  const api = apiUnknown();
  assert.equal(factoryApiBudgetStatus(api, exposure, now).reason, "FACTORY_API_UNKNOWN_HOLD");
  await apply(null, api);
  const s = factoryApiBudgetStatus(api, exposure, now);
  assert.equal(s.reason, "FACTORY_API_READY"); assert.equal(s.spentMicroUsd, 70_000); assert.equal(s.reservedMicroUsd, 0);
  assert.equal(api.reservations[0].status, "unknown"); // row untouched (append-only receipt)
  const r = api.resolutions![0];
  assert.equal(resolveFactoryApiUnknown(api, { holdSha256: r.holdSha256, source: r.source, reservationKey: r.reservationKey, settledMicroUsd: r.settledMicroUsd, evidenceSha256: ev }, now).resolved, false);
  assert.throws(() => resolveFactoryApiUnknown(api, { holdSha256: r.holdSha256, source: r.source, reservationKey: r.reservationKey, settledMicroUsd: 1, evidenceSha256: ev }, now), /CONFLICT/);
  assert.doesNotThrow(() => parseFactoryApiState(structuredClone(api)));
});

test("cannot resolve non-unknown rows or at less than full amount", () => {
  const api = apiUnknown(); api.reservations[0].status = "reserved";
  assert.equal(planUnknownResolution({ holdId: NEWS_EXECUTION_ID, shared: null, api }).refusal, "HOLD_NOT_UNKNOWN");
  assert.throws(() => resolveFactoryApiUnknown(api, { holdSha256: ev, source: "api-reservation", reservationKey: newsKey, settledMicroUsd: 70_000, evidenceSha256: ev }, now), /NOT_UNKNOWN/);
  const u = apiUnknown();
  assert.throws(() => resolveFactoryApiUnknown(u, { holdSha256: ev, source: "api-reservation", reservationKey: newsKey, settledMicroUsd: 1, evidenceSha256: ev }, now), /NOT_FULL_AMOUNT/);
  assert.throws(() => resolveFactoryApiUnknown(emptyFactoryApiState(), { holdSha256: ev, source: "external-checkpoint", checkpointMonth: "2026-11", settledMicroUsd: 1, evidenceSha256: ev }, now), /NOT_UNKNOWN/);
  assert.equal(planUnknownResolution({ holdId: "other-hold-id", shared: sharedState(), api: withExternal() }).refusal, "HOLD_NOT_FOUND");
  assert.equal(planUnknownResolution({ holdId: NEWS_EXECUTION_ID, shared: sharedState("reserved"), api: emptyFactoryApiState() }).refusal, "HOLD_NOT_UNKNOWN");
});

test("dry run writes nothing", async () => {
  const api = withExternal(), before = JSON.stringify(api), shared = sharedState();
  const plan = planUnknownResolution({ holdId: NEWS_EXECUTION_ID, shared, api });
  assert.deepEqual(plan.steps.map(s => s.ledger), ["shared-credit", "external-checkpoint"]);
  const fail = async () => { throw Error("WRITE_IN_DRY_RUN"); };
  const out = await runUnknownResolution(plan, { apply: false, evidenceSha256: ev, at: now, appendReceipt: fail, settleShared: fail, resolveApi: fail });
  assert.equal(out.applied, false); assert.equal(JSON.stringify(api), before);
  assert.ok(!JSON.stringify(out).includes(NEWS_EXECUTION_ID) && !JSON.stringify(out).includes(newsKey));
});
