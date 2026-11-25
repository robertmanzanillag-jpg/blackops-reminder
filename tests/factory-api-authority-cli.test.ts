import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkpointRefusal, describeCheckpoint, newsHoldNeedles, parseCheckpointArgs, parseMonthInitArgs,
  shapeApiAuthority, summarizeNewsHold, usdToMicro } from "../script/factory-api-authority-cli";
import { checkpointFactoryApiMonth, emptyFactoryApiState, factoryApiBudgetStatus } from "../server/software-factory-api-budget";

const now = new Date("2026-11-25T12:00:00.000Z");
const evidence = "OpenAI usage dashboard, factory project, 2026-11-01..2026-11-25: $12.34 (read 2026-11-25)";
const args = ["--month=2026-11", "--external-spent-usd=12.34", "--external-reserved-usd=0.5", "--external-unknown-count=1"];
const exposure = { configured: true, fixedCents: 0, spentCents: 0, reservedCents: 0, unknown: false, parents: [] };

test("usdToMicro is exact and rejects floats/garbage", () => {
  assert.equal(usdToMicro("12.34", "X"), 12_340_000);
  assert.equal(usdToMicro("0.000001", "X"), 1);
  assert.equal(usdToMicro("100", "X"), 100_000_000);
  for (const bad of ["", "-1", "1e3", "1.0000001", "1,5", "$3"]) assert.throws(() => usdToMicro(bad, "X"), /X_INVALID/);
});

test("checkpoint args: digest of evidence, current month only, exact amounts", () => {
  const { checkpoint, evidenceChars, apply } = parseCheckpointArgs(args, evidence, now);
  assert.equal(apply, false);
  assert.equal(evidenceChars, evidence.length);
  assert.deepEqual(checkpoint, { month: "2026-11", evidenceSha256: createHash("sha256").update(evidence).digest("hex"),
    reconciledAt: now.toISOString(), externalSpentMicroUsd: 12_340_000, externalReservedMicroUsd: 500_000,
    externalUnknownReservations: 1, complete: true });
  assert.equal(parseCheckpointArgs([...args, "--apply"], evidence, now).apply, true);
  assert.throws(() => parseCheckpointArgs(["--month=2026-10", ...args.slice(1)], evidence, now), /MONTH_NOT_CURRENT/);
  assert.throws(() => parseCheckpointArgs(args, "short", now), /EVIDENCE_INVALID/);
  assert.throws(() => parseCheckpointArgs(args.slice(0, 3), evidence, now), /EXTERNAL_UNKNOWN_COUNT_REQUIRED/);
  assert.throws(() => parseCheckpointArgs([...args, "--evidence=x"], evidence, now), /ARGUMENT_INVALID/);
  // The built input is accepted by the real store logic.
  const state = emptyFactoryApiState();
  checkpointFactoryApiMonth(state, exposure, parseCheckpointArgs(args, evidence, now).checkpoint, now.toISOString());
  const status = factoryApiBudgetStatus(state, exposure, now.toISOString());
  assert.equal(status.reason, "FACTORY_API_UNKNOWN_HOLD");
  assert.equal(status.paidAdmissionReady, false);
});

test("month-init args: whole cents within the US$100 limit", () => {
  assert.deepEqual(parseMonthInitArgs(["--month=2026-11", "--fixed-usd=0"], now), { month: "2026-11", fixedCents: 0, apply: false });
  assert.equal(parseMonthInitArgs(["--month=2026-11", "--fixed-usd=20.5", "--apply"], now).fixedCents, 2050);
  assert.throws(() => parseMonthInitArgs(["--month=2026-11", "--fixed-usd=100.01"], now), /OVER_LIMIT/);
  assert.throws(() => parseMonthInitArgs(["--month=2026-11", "--fixed-usd=0.001"], now), /SUB_CENT/);
  assert.throws(() => parseMonthInitArgs(["--month=2026-11"], now), /FIXED_USD_REQUIRED/);
});

test("News hold is detected by any spelling and reported as booleans/counts only", () => {
  const [raw, digest, officeKey] = newsHoldNeedles();
  assert.equal(officeKey, `office:${digest}`);
  const summary = summarizeNewsHold([{ reservations: [{ key: officeKey, status: "unknown" }, { key: "office:other", status: "unknown" }] },
    { reservations: [{ key: "x", unknownEvidenceId: `news-${raw}`, status: "settled" }] }, null]);
  assert.deepEqual(summary, { found: true, rows: 2, stillUnknown: true, settledRows: 1 });
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(`${raw}|${digest}`));
  assert.deepEqual(summarizeNewsHold([]), { found: false, rows: 0, stillUnknown: false, settledRows: 0 });
});

test("refusals: uninitialized month, unknown job, immutability, unrecorded News hold", () => {
  const { checkpoint } = parseCheckpointArgs(args, evidence, now);
  const news = summarizeNewsHold([{ reservations: [{ key: newsHoldNeedles()[2], status: "unknown" }] }]);
  const base = { checkpoint, monthInitialized: true, factoryUnknownJob: false, existingCheckpoint: undefined, newsHold: news };
  assert.equal(checkpointRefusal(base), null);
  assert.equal(checkpointRefusal({ ...base, monthInitialized: false }), "FACTORY_MONTH_UNINITIALIZED");
  assert.equal(checkpointRefusal({ ...base, factoryUnknownJob: true }), "FACTORY_UNKNOWN_JOB_PRESENT");
  assert.equal(checkpointRefusal({ ...base, existingCheckpoint: { ...checkpoint, externalSpentMicroUsd: 1 } }), "FACTORY_API_CHECKPOINT_IMMUTABLE");
  assert.equal(checkpointRefusal({ ...base, existingCheckpoint: { ...checkpoint } }), null);
  assert.equal(checkpointRefusal({ ...base, checkpoint: { ...checkpoint, externalUnknownReservations: 0 } }), "NEWS_HOLD_MUST_BE_RECORDED_AS_EXTERNAL_UNKNOWN");
  const clear = summarizeNewsHold([]);
  assert.equal(checkpointRefusal({ ...base, newsHold: clear, checkpoint: { ...checkpoint, externalUnknownReservations: 0, externalReservedMicroUsd: 0 } }), null);
  assert.equal(checkpointRefusal({ ...base, newsHold: clear, checkpoint: { ...checkpoint, externalReservedMicroUsd: 0 } }), "EXTERNAL_UNKNOWN_REQUIRES_RESERVED_AMOUNT");
  assert.equal(describeCheckpoint(checkpoint, 10).blocksPaidAdmissionPermanently, true);
  assert.doesNotMatch(JSON.stringify(describeCheckpoint(checkpoint, 10)), /OpenAI usage/);
});

test("status block: no checkpoint means null remaining and RECONCILIATION_REQUIRED", () => {
  const state = emptyFactoryApiState();
  const status = factoryApiBudgetStatus(state, exposure, now.toISOString());
  const block = shapeApiAuthority({ tablePresent: true, stateRowExists: false, monthInitialized: true, factoryUnknownJob: false,
    status, state, newsHold: summarizeNewsHold([]) });
  assert.equal(block.checkpointPresent, false);
  assert.equal(block.remainingMicroUsd, null);
  assert.equal(block.reason, "FACTORY_API_RECONCILIATION_REQUIRED");
  assert.deepEqual(block.unknownHolds, { apiReservations: 0, externalCheckpoint: 0, factoryJobUnknown: false });
});
