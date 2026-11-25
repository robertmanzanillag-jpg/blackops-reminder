import assert from "node:assert/strict";
import test from "node:test";
import { decideResume, runResume } from "../script/factory-resume-core";

const clean = { paused: true, unknownJobs: 0, apiUnknown: false, unknownHolds: { apiReservations: 0, externalCheckpoint: 0, factoryJobUnknown: false } };
const recorder = () => { const calls: boolean[] = []; return { calls, setPaused: async (p: boolean) => { calls.push(p); } }; };

test("refuses while a job or API hold is unknown", async () => {
  for (const bad of [{ ...clean, unknownJobs: 1 }, { ...clean, unknownHolds: { ...clean.unknownHolds, factoryJobUnknown: true } },
    { ...clean, apiUnknown: true }, { ...clean, unknownHolds: { ...clean.unknownHolds, apiReservations: 1 } },
    { ...clean, unknownHolds: { ...clean.unknownHolds, externalCheckpoint: 1 } }]) {
    const r = recorder(), out = await runResume({ ...bad, apply: true, setPaused: r.setPaused });
    assert.equal(out.applied, false); assert.match(out.refusal!, /UNKNOWN/); assert.deepEqual(r.calls, []);
  }
});

test("resumes when clean, via setPaused(false) only", async () => {
  const r = recorder(), out = await runResume({ ...clean, apply: true, setPaused: r.setPaused });
  assert.equal(out.applied, true); assert.equal(out.refusal, null); assert.deepEqual(r.calls, [false]);
  const r2 = recorder(), idle = await runResume({ ...clean, paused: false, apply: true, setPaused: r2.setPaused });
  assert.equal(idle.applied, false); assert.equal(idle.alreadyRunning, true); assert.deepEqual(r2.calls, []);
});

test("dry run is read-only", async () => {
  const r = recorder(), out = await runResume({ ...clean, apply: false, setPaused: r.setPaused });
  assert.equal(out.applied, false); assert.equal(out.wouldResume, true); assert.deepEqual(r.calls, []);
  assert.equal(decideResume(clean).wouldResume, true);
});
