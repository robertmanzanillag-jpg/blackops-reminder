import test from "node:test";
import assert from "node:assert/strict";
import { createSharedOpenAiCreditLedger, type CreditTransaction, type SharedCreditState, type VerifiedCreditGrant } from "../server/shared-openai-credit-ledger";
import { runFactoryModelCall, type FactoryModelRoute } from "../server/software-factory-model-routes";
import { FactoryApiBudgetError } from "../server/factory-api-invocation";
import { factoryOnceFailure, unclassifiedShape } from "../server/software-factory-diagnostics";
import { runSoftwareFactoryOnce } from "../server/software-factory-once";

const grant: VerifiedCreditGrant = { id: "grant-1", accountScope: "openai-project-1", availableMicroUsd: 5_000_000,
  observedAt: "2026-11-06T12:00:00.000Z", expiresAt: "2026-11-20T00:00:00.000Z", verificationEvidenceId: "operator-proof-1" };
const model = "fixture-model-2026-11-01";
const apiPrice = { model, inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 4000, cachedInputNanoUsdPerToken: 100, cacheWrite30mNanoUsdPerToken: 1250, cacheWrite12hNanoUsdPerToken: 2000, maxInputTokens: 1_049_600, validUntil: "2026-12-01T00:00:00Z", evidenceSha256: "a".repeat(64) };
const count = () => new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 100 }));

async function ledgerFixture() {
  let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  let tail: Promise<unknown> = Promise.resolve();
  const transact: CreditTransaction = async change => {
    const op = tail.then(() => { const copy = structuredClone(state), result = change(copy); state = copy; return result; });
    tail = op.catch(() => {}); return op;
  };
  const ledger = createSharedOpenAiCreditLedger({ grant, transact, now: () => new Date(grant.observedAt), maximumGrantObservationAgeMs: 60_000 });
  await ledger.initialize();
  return { ledger, state: () => structuredClone(state) };
}
const routeWith = (ledger: ReturnType<typeof createSharedOpenAiCreditLedger>, submit: () => Promise<Response>): FactoryModelRoute[] => [{
  provider: "openai", ledger, model: { model, apiPrice, inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 4000, pricingValidUntil: "2026-12-01T00:00:00Z",
    now: () => new Date("2026-11-06T12:00:00Z"), maxInputTokens: 10000,
    request: async (url: string) => url.endsWith("/input_tokens") ? count() : submit() } as never,
}];
const call = (routes: FactoryModelRoute[], key: string) => runFactoryModelCall(routes, { key, unknownError: "FACTORY_MODEL_OUTCOME_UNKNOWN",
  input: { instructions: "build", text: "synthetic retry order", maxOutputTokens: 100, maxCostCents: 100, signal: new AbortController().signal },
  requestSha256: () => "b".repeat(64), evidenceId: sha => `factory-model:${sha}` });

test("retry-key build: monetary gate failure after reservation but before dispatch never leaves the shared $1 hold unknown", async () => {
  // Same shape as run 45571409095: build stage of a `:retry:1` company order, 100-cent hold.
  const f = await ledgerFixture(), key = "factory:" + "c".repeat(64);
  const out = await call(routeWith(f.ledger, async () => { throw new FactoryApiBudgetError("FACTORY_API_EXECUTION_UNCONFIRMED", false); }), key);
  assert.equal(out.result.status, "blocked");
  assert.equal((out.result as { reason: string }).reason, "FACTORY_OPENAI_NOT_DISPATCHED");
  const row = f.state().reservations.find(r => r.key === key)!;
  assert.equal(row.status, "settled");
  assert.equal((await f.ledger.status()).uncertain ?? false, false);
  // The Office can still admit work (no RECONCILIATION_REQUIRED).
  assert.equal((await f.ledger.reserve({ key: "office-next", consumer: "office", requestSha256: "d".repeat(64), maximumMicroUsd: 10_000 })).admitted, true);
});

test("a dispatched failure still keeps the hold unknown (no paid replay)", async () => {
  const f = await ledgerFixture(), key = "factory:" + "e".repeat(64);
  await assert.rejects(call(routeWith(f.ledger, async () => { throw new FactoryApiBudgetError("FACTORY_API_EXECUTION_UNCONFIRMED", true); }), key), /CREDIT_EXECUTION_UNCONFIRMED/);
  assert.equal(f.state().reservations.find(r => r.key === key)!.status, "unknown");
});

class ZodError extends Error {}
test("unclassified errors log only class name and first frame file:line", () => {
  const secret = "owner order text postgres://u:p@h/db";
  const report = factoryOnceFailure(new ZodError(secret), "execution", "tick-quarantined") as Record<string, unknown>;
  assert.equal(report.code, "FACTORY_ONCE_UNAVAILABLE");
  assert.equal(report.errorClass, "CLASS_ZodError");
  assert.match(String(report.frame), /^software-factory-predispatch-release\.test\.ts:\d+$/);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes("/"), false);
  assert.deepEqual(unclassifiedShape(new TypeError(secret)).errorClass, "CLASS_TypeError");
  assert.deepEqual(unclassifiedShape(undefined), {});
  assert.equal("errorClass" in factoryOnceFailure(Error("CREDIT_EXECUTION_UNCONFIRMED"), "execution"), false);
});

test("tick-quarantined reports the worker's recorded cause instead of nothing", async () => {
  const logs: Record<string, unknown>[] = [];
  const timers = { setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 2, clearInterval: () => {} };
  const worker = { schedule: async () => {}, maintain: async () => {}, stop: () => {}, tick: async () => ({ kind: "quarantined" as const }),
    lastFailure: () => Error("CREDIT_EXECUTION_UNCONFIRMED") };
  const result = await runSoftwareFactoryOnce(worker as never, { signal: new AbortController().signal, maxStages: 2, durationMs: 11 * 60 * 1000, now: () => 0, clock: timers as never,
    onFailure: (stage, error) => logs.push(factoryOnceFailure(error, "execution", stage)) });
  assert.equal(result.reason, "quarantined");
  assert.equal(logs[0].stage, "tick-quarantined");
  assert.equal(logs[0].code, "CREDIT_EXECUTION_UNCONFIRMED");
});
