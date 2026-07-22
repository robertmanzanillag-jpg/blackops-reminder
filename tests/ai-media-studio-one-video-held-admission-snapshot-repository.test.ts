import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleOneVideoHeldAdmissionSnapshotRepository } from "../server/ai-media-studio/planning/drizzle-one-video-held-admission-snapshot-repository";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionContext,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const digest = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const context: OneVideoHeldAdmissionContext = {
  scope,
  planId: uuid("1"),
  dailyPlanSlotId: uuid("2"),
  budgetBucketId: uuid("3"),
  publicPlanKey: key("plan", "1"),
  publicBatchKey: key("batch", "2"),
  publicSlotKey: key("slot", "3"),
  publicQuoteKey: key("quote", "4"),
  publicRenderSpecKey: key("render_spec", "5"),
  slotAttempt: 1,
  expectedSlotStateVersion: 4,
  expectedBucketStateVersion: 7,
  maximumQuoteMicroUsd: "1250000",
  currency: "USD",
  quoteExpiresAt: "2026-07-22T12:30:00.000Z",
  reservationExpiresAt: "2026-07-22T12:10:00.000Z",
};
const row = {
  authority_snapshot_id: uuid("4"),
  authority_digest: digest("a"),
  admission_digest: digest("b"),
  daily_plan_slot_id: context.dailyPlanSlotId,
  slot_attempt: 1,
  observed_at: new Date("2026-07-22T12:00:00.000Z"),
};

function sqlText(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("snapshot repository returns one exact current snapshot using only a read-only DB-clock query", async () => {
  const queries: string[] = [];
  const repository = new DrizzleOneVideoHeldAdmissionSnapshotRepository({ async execute(query) {
    queries.push(sqlText(query));
    return { rows: [row] };
  } });
  const result = await repository.loadCurrent({ scope, context });
  assert.deepEqual(result, {
    authoritySnapshotId: row.authority_snapshot_id,
    authorityDigest: row.authority_digest,
    admissionDigest: row.admission_digest,
    dailyPlanSlotId: context.dailyPlanSlotId,
    slotAttempt: 1,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(queries.length, 1);
  const query = queries[0]!;
  assert.match(query, /WITH db_clock AS MATERIALIZED/u);
  assert.match(query, /transaction_timestamp/u);
  assert.match(query, /snapshot\.daily_plan_id=/u);
  assert.match(query, /snapshot\.daily_plan_slot_id=/u);
  assert.match(query, /snapshot\.slot_attempt=/u);
  assert.match(query, /snapshot\.admission_digest/u);
  assert.match(query, /content\.evidence_kind='content_approval'/u);
  assert.match(query, /human\.evidence_kind='human_launch_approval'/u);
  assert.match(query, /sandbox\.evidence_kind='sandbox_proof'/u);
  assert.match(query, /quote\.evidence_kind='maximum_quote'/u);
  assert.match(query, /NOT EXISTS/u);
  assert.match(query, /LIMIT 2/u);
  assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|FOR UPDATE)\b/iu);
});

test("missing snapshot is absent while duplicate or malformed authority fails closed", async () => {
  const missing = new DrizzleOneVideoHeldAdmissionSnapshotRepository({ async execute() { return { rows: [] }; } });
  assert.equal(await missing.loadCurrent({ scope, context }), undefined);

  for (const rows of [
    [row, row],
    [{ ...row, authority_snapshot_id: "not-a-uuid" }],
    [{ ...row, authority_digest: "bad" }],
    [{ ...row, admission_digest: "bad" }],
    [{ ...row, daily_plan_slot_id: uuid("9") }],
    [{ ...row, slot_attempt: 2 }],
    [{ ...row, observed_at: "not-an-instant" }],
  ]) {
    await assert.rejects(
      new DrizzleOneVideoHeldAdmissionSnapshotRepository({ async execute() { return { rows }; } })
        .loadCurrent({ scope, context }),
      unavailable,
    );
  }
});

test("snapshot repository rejects mismatched context before SQL and hides database failures", async () => {
  let calls = 0;
  const repository = new DrizzleOneVideoHeldAdmissionSnapshotRepository({ async execute() {
    calls += 1;
    throw new Error("private database failure");
  } });
  await assert.rejects(repository.loadCurrent({
    scope,
    context: { ...context, scope: { ownerUserId: "owner-b", workspaceId: "personal" } },
  }), unavailable);
  assert.equal(calls, 0);
  await assert.rejects(repository.loadCurrent({ scope, context }), unavailable);
  assert.equal(calls, 1);
});

function unavailable(error: unknown): boolean {
  return error instanceof OneVideoHeldAdmissionError
    && error.code === "UNAVAILABLE"
    && !error.message.includes("private database failure");
}
