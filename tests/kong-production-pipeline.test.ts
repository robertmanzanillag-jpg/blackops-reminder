import test from "node:test";
import assert from "node:assert/strict";
import { emptyProductionState, runProductionCycle, type EditorialTask, type ProductionDependencies, type ProductionState } from "../server/kong-production-pipeline";
import type { OnlineFootage } from "../server/kong-online-sources";
const now = new Date("2026-10-28T14:00:00Z"), sha = "a".repeat(64);
const rights = { evidenceUrl: "https://example.com/permission", confirmedBy: "Owner", expiresAt: "2026-11-10T00:00:00Z" };
const source: OnlineFootage = { id: "owner-one", provider: "owner", sourceUrl: "https://example.com/source", mediaUrl: "https://example.com/footage.mp4",
  author: "Owner", discoveredAt: now.toISOString(), rightsEvidence: "Owner written commercial licence", rightsExpiresAt: rights.expiresAt,
  allowedMediaOrigins: ["https://example.com"], attribution: "Owner", audioPolicy: "remove_source_audio", qaStatus: "pending" };
const task: EditorialTask = { id: "pov1", sourceIds: [source.id], layout: "pov", hook: "The group chat finally made it", durationSeconds: 12,
  title: "Night plans", caption: "Find your next night https://kongnightlife.com", family: "pov", footageRights: rights, musicRights: rights, authorizedForPublicDistribution: true };
const qa = { reviewedBy: "Independent reviewer", reviewedAt: now.toISOString(), officialWhiteLogo: true as const,
  noLogoBackgroundOrShadow: true as const, safeZones: true as const, audioChecked: true as const, spellingChecked: true as const, renderedSha256: sha };
function fixture() {
  let stored = emptyProductionState(), uploads = 0, renders = 0;
  stored.candidates.push(source);
  const deps: ProductionDependencies = {
    save: async state => { stored = structuredClone(state); },
    artifactExists: async () => true,
    render: async () => { renders++; return { outputPath: "/tmp/kong-production-test/output.mp4", sha256: sha, width: 1080, height: 1920,
      durationSeconds: 12, logoSha256: "b".repeat(64), sourceAudioDiscarded: true }; },
    upload: async job => { uploads++; assert.equal(stored.jobs.find(j => j.id === job.id)?.stage, "upload_intent");
      return { fileId: "uploaded-one", mediaUrl: "https://example.com/rendered.mp4", sha256: sha, verifiedAt: now.toISOString() }; },
  };
  return { deps, state: () => structuredClone(stored), uploads: () => uploads, renders: () => renders };
}
test("real render receipt stays QA pending until explicit hash-bound review", async () => {
  const f = fixture();
  let state = await runProductionCycle(f.state(), [task, task], f.deps, { now });
  assert.equal(state.jobs.length, 1); assert.equal(f.uploads(), 1); assert.equal(state.jobs[0].stage, "qa_pending");
  assert.equal(state.assets.length, 0); assert.equal(state.jobs[0].sources[0].rightsEvidence, source.rightsEvidence);
  state = await runProductionCycle(state, [], { ...f.deps, review: async () => qa }, { now });
  assert.equal(state.jobs[0].stage, "ready"); assert.equal(state.assets.length, 1); assert.equal(f.uploads(), 1);
});
test("failed save of upload intent prevents public upload", async () => {
  const f = fixture(), save = f.deps.save;
  f.deps.save = async state => { if (state.jobs.some(j => j.stage === "upload_intent")) throw Error("db_down"); await save(state); };
  await assert.rejects(runProductionCycle(f.state(), [task], f.deps, { now }), /db_down/);
  assert.equal(f.uploads(), 0); assert.equal(f.state().jobs[0].stage, "rendered");
});
test("restart after upload receipt save failure only reconciles; never repeats upload", async () => {
  const f = fixture(), save = f.deps.save;
  f.deps.save = async state => { if (state.jobs.some(j => j.stage === "qa_pending")) throw Error("db_down"); await save(state); };
  await assert.rejects(runProductionCycle(f.state(), [task], f.deps, { now }), /db_down/);
  assert.equal(f.uploads(), 1); assert.equal(f.state().jobs[0].stage, "upload_intent");
  f.deps.save = save;
  let state = await runProductionCycle(f.state(), [], f.deps, { now });
  assert.equal(state.jobs[0].stage, "upload_uncertain"); assert.equal(f.uploads(), 1);
  state = await runProductionCycle(state, [], { ...f.deps, reconcileUpload: async () => ({ fileId: "uploaded-one",
    mediaUrl: "https://example.com/rendered.mp4", sha256: sha, verifiedAt: now.toISOString() }) }, { now });
  assert.equal(state.jobs[0].stage, "qa_pending"); assert.equal(f.uploads(), 1);
});
test("unknown upload exception does not retry even when render file disappears", async () => {
  const f = fixture(); let attempts = 0;
  const deps = { ...f.deps, upload: async () => { attempts++; throw Error("timeout"); } };
  let state = await runProductionCycle(f.state(), [task], deps, { now });
  state = await runProductionCycle(state, [], { ...deps, artifactExists: async () => false, reconcileUpload: async () => null }, { now });
  assert.equal(attempts, 1); assert.equal(f.renders(), 1); assert.equal(state.jobs[0].stage, "upload_uncertain");
});
test("missing preupload temporary file is rerendered on restart", async () => {
  const f = fixture(), save = f.deps.save;
  f.deps.save = async state => { if (state.jobs.some(j => j.stage === "upload_intent")) throw Error("db_down"); await save(state); };
  await assert.rejects(runProductionCycle(f.state(), [task], f.deps, { now }));
  f.deps.save = save;
  const state = await runProductionCycle(f.state(), [], { ...f.deps, artifactExists: async () => false }, { now });
  assert.equal(f.renders(), 2); assert.equal(f.uploads(), 1); assert.equal(state.jobs[0].stage, "qa_pending");
});
test("source outage preserves reviewed assets and continues eligible existing queue", async () => {
  const f = fixture();
  const state = await runProductionCycle(f.state(), [task], { ...f.deps, review: async () => qa }, { now });
  const next = await runProductionCycle(state, [], { ...f.deps, discover: async () => { throw Error("provider_down"); } }, { now });
  assert.equal(next.assets.length, 1); assert.equal(next.errors.at(-1)?.code, "source_discovery_failed");
  assert.equal(f.uploads(), 1);
});
test("missing authorization, expired source and missing claim evidence cannot render/upload", async () => {
  for (const invalid of [{ ...task, authorizedForPublicDistribution: false }, { ...task, family: "lineup" as const },
    { ...task, sourceIds: ["missing"] }, { ...task, musicRights: { ...rights, expiresAt: "2020-01-01" } }]) {
    const f = fixture(); const state = await runProductionCycle(f.state(), [invalid], f.deps, { now });
    assert.equal(state.jobs[0].stage, "blocked"); assert.equal(f.renders(), 0); assert.equal(f.uploads(), 0);
  }
});
test("bad QA and duplicate rendered hashes never create second publishable asset", async () => {
  const f = fixture();
  let state = await runProductionCycle(f.state(), [task, { ...task, id: "pov2", hook: "Another night" }], f.deps, { now });
  assert.equal(f.uploads(), 1); assert.equal(state.jobs[1].error, "duplicate_render_hash");
  state = await runProductionCycle(state, [], { ...f.deps, review: async () => ({ ...qa, renderedSha256: "c".repeat(64) }) }, { now });
  assert.equal(state.assets.length, 0); assert.equal(state.jobs[0].stage, "qa_pending");
});
test("reveal copy cannot bypass prohibited terms or claim evidence", async () => {
  for (const reveal of ["Join guestlist tonight", "Complimentary entry tonight", "FREE tonight"]) {
    const f = fixture();
    const state = await runProductionCycle(f.state(), [{ ...task, layout: "reveal", reveal }], f.deps, { now });
    assert.equal(state.jobs[0].stage, "blocked");
    assert.equal(f.renders(), 0); assert.equal(f.uploads(), 0);
  }
});
