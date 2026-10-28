import test from "node:test";
import assert from "node:assert/strict";
import { createKongCloudRuntime, readiness, type KongRuntimeOptions } from "../server/kong-cloud-autopilot";
import { emptyState, type State, type Asset, type Job } from "../server/kong-autopilot-core";
import { emptyProductionState, type EditorialTask } from "../server/kong-production-pipeline";
const now = new Date("2026-10-28T12:00:00Z"), hash = "a".repeat(64);
const rights = { evidenceUrl: "https://cdn.example.com/rights", confirmedBy: "Owner", expiresAt: "2026-11-15T00:00:00Z" };
const qa = { reviewedBy: "QA", reviewedAt: now.toISOString(), renderedSha256: hash, officialWhiteLogo: true as const,
  noLogoBackgroundOrShadow: true as const, safeZones: true as const, audioChecked: true as const, spellingChecked: true as const };
const asset: Asset = { id: "reviewed-one", sourceUrl: "https://cdn.example.com/source", mediaUrl: "https://cdn.example.com/render.mp4",
  sha256: hash, family: "pov", hook: "The group chat made it", caption: "Plan the night https://kongnightlife.com", title: "Night plans",
  durationSeconds: 12, width: 1080, height: 1920, footageRights: rights, musicRights: rights, qa };
const env = { DATABASE_URL: "injected-only", KONG_OWNER_USER_ID: "owner", KONG_MEDIA_ORIGINS: "https://cdn.example.com",
  METRICOOL_USER_TOKEN: "injected-test", METRICOOL_USER_ID: "test", KONG_AUTOPILOT_ENABLED: "true",
  KONG_AUTOPUBLISH_ENABLED: "true", KONG_METRICOOL_ACCOUNTS_VERIFIED: "tiktok,facebook", KONG_PRODUCTION_ENABLED: "true" };
function database(initial: State = emptyState()) {
  let stored = structuredClone(initial), locked = false, rejectSave: ((state: State) => boolean) | undefined;
  const query = async (sql: string, args?: any[]) => {
    if (sql.includes("pg_try_advisory_lock")) { if (locked) return { rows: [{ locked: false }] }; locked = true; return { rows: [{ locked: true }] }; }
    if (sql.includes("pg_advisory_unlock")) { locked = false; return { rows: [] }; }
    if (sql.startsWith("SELECT state")) return { rows: [{ state: structuredClone(stored) }] };
    if (sql.startsWith("INSERT INTO")) { const next = JSON.parse(args![0]); if (rejectSave?.(next)) throw Error("db_failed"); stored = next; }
    return { rows: [] };
  };
  return { pool: { query, connect: async () => ({ query, release() {} }), end: async () => {} } as unknown as NonNullable<KongRuntimeOptions["pool"]>,
    state: () => structuredClone(stored), isLocked: () => locked, reject: (fn: (state: State) => boolean) => { rejectSave = fn; } };
}
function transport() {
  const created = new Map<string, string>();
  return { created, delivery: { find: async (job: Job) => created.get(job.id), create: async (job: Job) => { created.set(job.id, `receipt-${job.id}`); } },
    verifyMedia: async () => ({ verifiedUrl: asset.mediaUrl, bytes: 12, sha256: hash }) };
}
test("catalog outage still schedules durable reviewed production assets", async () => {
  const state = emptyState(); state.production = emptyProductionState(); state.production.assets = [asset];
  const db = database(state), t = transport();
  const runtime = createKongCloudRuntime({ ...env, KONG_CATALOG_URL: "https://cdn.example.com/catalog.json" }, {
    pool: db.pool, now: () => now, ...t, fetch: async () => { throw Error("outage"); } });
  await runtime.cycle();
  assert.equal(t.created.size, 2); assert.equal(db.state().catalogError, "catalog_unavailable");
  assert.equal(db.state().production?.assets.length, 1); assert.equal(db.isLocked(), false);
});
test("read-only receipt reconciliation works with publish off and source absent", async () => {
  const state = emptyState(); state.jobs.push({ id: "uncertain", day: "2026-10-28", network: "tiktok", slot: 0,
    at: "2026-10-28T12:15:00-04:00", asset, attempts: 1, state: "uncertain" });
  const db = database(state); let mutations = 0;
  const runtime = createKongCloudRuntime({ ...env, KONG_AUTOPUBLISH_ENABLED: "false" }, { pool: db.pool, now: () => now,
    delivery: { find: async () => "existing-remote", create: async () => { mutations++; } } });
  await runtime.cycle(); assert.equal(db.state().jobs[0].receipt, "existing-remote"); assert.equal(mutations, 0);
});
function production(db: ReturnType<typeof database>, calls: { uploads: number }): NonNullable<KongRuntimeOptions["production"]> {
  const task: EditorialTask = { ...asset, id: "task", sourceIds: ["owner-one"], layout: "pov", authorizedForPublicDistribution: true };
  return { tasks: async () => [task], dependencies: {
    discover: async cursor => ({ nextCursor: cursor + 1, candidates: [{ id: "owner-one", provider: "owner", sourceUrl: asset.sourceUrl,
      mediaUrl: "https://cdn.example.com/source.mp4", author: "Owner", discoveredAt: now.toISOString(), rightsEvidence: "Owner authorized social promotion",
      rightsExpiresAt: rights.expiresAt, allowedMediaOrigins: ["https://cdn.example.com"], attribution: "Owner", audioPolicy: "remove_source_audio", qaStatus: "pending" }] }),
    render: async () => ({ outputPath: "/tmp/cloud-output.mp4", sha256: hash, width: 1080, height: 1920, durationSeconds: 12,
      sourceAudioDiscarded: true, logoSha256: "b".repeat(64) }), artifactExists: async () => true,
    upload: async () => { assert.equal(db.isLocked(), true); assert.equal(db.state().production?.jobs[0].stage, "upload_intent"); calls.uploads++;
      return { fileId: "file-receipt", mediaUrl: asset.mediaUrl, sha256: hash, verifiedAt: now.toISOString() }; },
  } };
}
test("production persists under lease; new runtime restores pending QA then schedules reviewed output", async () => {
  const db = database(), calls = { uploads: 0 }, p = production(db, calls), t = transport();
  await createKongCloudRuntime(env, { pool: db.pool, now: () => now, production: p, ...t }).cycle();
  assert.equal(calls.uploads, 1); assert.equal(db.state().production?.jobs[0].stage, "qa_pending"); assert.equal(t.created.size, 0);
  p.dependencies.review = async () => qa;
  await createKongCloudRuntime(env, { pool: db.pool, now: () => now, production: p, ...t }).cycle();
  assert.equal(calls.uploads, 1); assert.equal(db.state().production?.assets.length, 1); assert.equal(t.created.size, 2);
});
test("failed persistence halts cycle before upload or publishing", async () => {
  const db = database(), calls = { uploads: 0 }, p = production(db, calls), t = transport();
  db.reject(state => state.production?.jobs.some(j => j.stage === "upload_intent") || false);
  const runtime = createKongCloudRuntime(env, { pool: db.pool, now: () => now, production: p, ...t });
  await runtime.cycle(); assert.equal(calls.uploads, 0); assert.equal(t.created.size, 0); assert.equal(db.isLocked(), false);
  assert.match((await runtime.status()).lastError || "", /cycle_failed/);
});
test("public uploads and posts remain disabled without publish flag or verified account", async () => {
  for (const config of [{ ...env, KONG_AUTOPUBLISH_ENABLED: "false" }, { ...env, KONG_METRICOOL_ACCOUNTS_VERIFIED: "" }]) {
    const db = database(), calls = { uploads: 0 }, p = production(db, calls), t = transport();
    await createKongCloudRuntime(config, { pool: db.pool, now: () => now, production: p, ...t }).cycle();
    assert.equal(calls.uploads, 0); assert.equal(t.created.size, 0);
  }
});
test("readiness distinguishes absent adapters and configured production", () => {
  assert.equal(readiness(env).rendering, "not_configured");
  assert.deepEqual(readiness(env).sourceBlockers, ["production_not_configured"]);
  const db = database(); const ready = readiness(env, production(db, { uploads: 0 }));
  assert.equal(ready.productionEnabled, true); assert.equal(ready.rendering, "adapter_configured");
  assert.equal(ready.review, "pending_review_adapter");
});
