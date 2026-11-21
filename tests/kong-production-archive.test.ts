import test from "node:test";
import assert from "node:assert/strict";
import { appendProductionArchive, archiveProductionHistory, planProductionArchive, type ProductionArchiveRecord } from "../server/kong-production-archive";
import { emptyProductionState, type ProductionJob } from "../server/kong-production-pipeline";
import type { Asset, Job } from "../server/kong-autopilot-core";
const now = new Date("2026-10-28T12:00:00Z");
function fixture() {
  const state = emptyProductionState();
  // The archive must preserve snapshots without reconstructing or revalidating historical evidence.
  state.jobs.push({ id: "old", stage: "ready", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z",
    task: { id: "editorial", rights: "original evidence" }, sources: [{ id: "source", rightsEvidence: "original copyright record" }],
    artifact: { sha256: "a".repeat(64) }, receipt: { fileId: "remote-receipt" } } as unknown as ProductionJob);
  state.assets.push({ id: "old", sha256: "a".repeat(64) } as Asset);
  state.errors.push({ at: "2026-09-01T00:00:00Z", jobId: "old", code: "historic_retry" });
  return state;
}
test("pure plan preserves complete job/evidence and never mutates original", () => {
  const original = fixture(), before = structuredClone(original);
  const plan = planProductionArchive(original, [], now);
  assert.equal(plan.records.length, 1); assert.deepEqual(plan.records[0].payload.job, before.jobs[0]);
  assert.deepEqual(plan.records[0].payload.errors, before.errors);
  assert.equal(plan.remaining.jobs.length, 0); assert.equal(plan.remaining.assets.length, 0);
  assert.deepEqual(original, before);
});
test("archive failure cannot trim active jobs or lose provenance", async () => {
  const state = fixture(); let saves = 0;
  await assert.rejects(archiveProductionHistory(state, [], { archive: async () => { throw Error("db_archive_failed"); },
    saveActive: async () => { saves++; } }, now), /db_archive_failed/);
  assert.equal(saves, 0); assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].sources[0].rightsEvidence, "original copyright record");
});
test("crash after archive but before trim safely repeats immutable archive ID", async () => {
  let active = fixture(); const records = new Map<string, ProductionArchiveRecord>(); let fail = true;
  const deps = { archive: async (rows: ProductionArchiveRecord[]) => { for (const row of rows) if (!records.has(row.archiveId)) records.set(row.archiveId, row); },
    saveActive: async (state: typeof active) => { assert.ok(records.size); if (fail) throw Error("trim_failed"); active = structuredClone(state); } };
  await assert.rejects(archiveProductionHistory(active, [], deps, now), /trim_failed/);
  assert.equal(active.jobs.length, 1); assert.equal(records.size, 1);
  fail = false; await archiveProductionHistory(active, [], deps, new Date(+now + 86400_000));
  assert.equal(active.jobs.length, 0); assert.equal(records.size, 1);
});
test("all unresolved production stages and recent terminal jobs remain active", () => {
  for (const stage of ["queued", "rendering", "rendered", "upload_intent", "upload_uncertain", "qa_pending"] as const) {
    const state = fixture(); state.jobs[0].stage = stage;
    assert.equal(planProductionArchive(state, [], now).records.length, 0);
  }
  const state = fixture(); state.jobs[0].updatedAt = "2026-10-10T00:00:00Z";
  assert.equal(planProductionArchive(state, [], now).records.length, 0);
  state.jobs[0].updatedAt = "invalid"; assert.equal(planProductionArchive(state, [], now).records.length, 0);
});
test("nonterminal scheduler job protects asset identity and hash even with past uncertain slot", () => {
  const state = fixture();
  for (const status of ["planned", "submitting", "uncertain"] as const) {
    const job = { state: status, at: "2026-09-01T00:00:00Z", asset: { id: "old", sha256: "b".repeat(64) } } as Job;
    assert.equal(planProductionArchive(state, [job], now).records.length, 0);
    job.asset = { id: "different-id", sha256: "a".repeat(64) } as Asset;
    assert.equal(planProductionArchive(state, [job], now).records.length, 0);
  }
});
test("SQL storage is append only and payload key ordering gives stable IDs", async () => {
  const state = fixture(), first = planProductionArchive(state, [], now).records[0];
  const reversed = JSON.parse(JSON.stringify(state)); reversed.jobs[0] = Object.fromEntries(Object.entries(reversed.jobs[0]).reverse());
  assert.equal(planProductionArchive(reversed, [], now).records[0].archiveId, first.archiveId);
  const sql: string[] = [], stored = new Set<string>();
  const db = { query: async (query: string, args?: unknown[]) => { sql.push(query); if (query.startsWith("INSERT")) stored.add(String(args![0])); } };
  await appendProductionArchive(db, [first]); await appendProductionArchive(db, [first]);
  assert.equal(stored.size, 1); assert.ok(sql.every(q => !/UPDATE|DELETE/.test(q)));
  assert.ok(sql.some(q => q.includes("ON CONFLICT(archive_id) DO NOTHING")));
});
