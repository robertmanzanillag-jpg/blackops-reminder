import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { assessLocalBlackRoomExports, emptyEvidence, preferFreshLocalEvidence } from "../server/blackroom-local-evidence";
import { BLACKROOM_HOOK_TEST_ID } from "../server/blackroom-verified-learning";
import { refreshLocalBlackRoomEvidence } from "../script/blackroom-local-evidence";

const ref = "BR-111111111111";
const seen = new Date("2026-11-04T12:00:00Z");
const sample = { id: "https://youtube.com/shorts/clip1", views: 150, durationSeconds: 15, observedAt: seen.toISOString(), publishedAt: "2026-11-03T12:00:00Z", learningReference: ref };
const receipt = { metricoolId: "scheduler1", network: "youtube", reservationId: "r", dj: "A", sourceVideoId: "set", durationSeconds: 15,
  format: "vertical", language: "en", creativeStrategy: "drop_first", learningTestId: BLACKROOM_HOOK_TEST_ID, learningReference: ref, slot: "12:00" } as const;
const assess = (samples: object[], previous = emptyEvidence(), now = seen) =>
  assessLocalBlackRoomExports(previous, [{ network: "youtube", samples }], [receipt] as any, now);

test("verified exports join one actual post, preserving age-matched evidence on replay and restart", () => {
  const first = assess([sample]);
  const decision = first.report.decisions.youtube;
  assert.equal(decision.exactIdentities, 1);
  assert.equal(decision.matchedSnapshots, 1);
  assert.equal(decision.winner, null);
  assert.deepEqual(first.report.observedDurationCohorts, [{network:"youtube",windowHours:24,durationBand:"1-15s",posts:1,medianViews:150}]);
  const replay = assess([sample, { ...sample, observedAt: "2036-01-01T00:00:00Z" }], first.archive, new Date("2026-11-06T12:00:00Z"));
  assert.equal(replay.report.decisions.youtube.status, "stale");
  assert.equal(replay.report.decisions.youtube.sourceObservedAt, seen.toISOString());
  assert.deepEqual(replay.archive, first.archive);
});

test("scheduler ids, missing views, untimed and ambiguous observations never qualify as experimental results", () => {
  assert.equal(assess([{...sample, id: receipt.metricoolId, learningReference: undefined}]).report.decisions.youtube.exactIdentities, 0);
  assert.equal(assess([{...sample, views:null}, {...sample, observedAt:undefined}]).archive.posts.length, 0);
  const first = assess([sample]);
  assert.equal(assess([{...sample, id:"different"}], first.archive).report.decisions.youtube.exactIdentities, 0);
});

test("only a newer, fresh decision of the same test overlays the in-memory editorial input", () => {
  const local = assess([sample]).report.decisions;
  const remote = structuredClone(local);
  remote.youtube.sourceObservedAt = "2026-11-04T10:00:00Z";
  assert.equal(preferFreshLocalEvidence(remote, local, seen)?.youtube, local.youtube);
  assert.equal(remote.youtube.sourceObservedAt, "2026-11-04T10:00:00Z");
  assert.equal(preferFreshLocalEvidence(undefined, local, seen), undefined);
  assert.equal(preferFreshLocalEvidence(remote, local, new Date("2026-11-07"))?.youtube, remote.youtube);
  assert.equal(preferFreshLocalEvidence(local, remote, seen)?.youtube, local.youtube);
});

test("a conflicting measured duration vetoes exact reference attribution across exports", () => {
  const bad = assess([{ ...sample, durationSeconds: 60 }]);
  assert.equal(bad.report.decisions.youtube.exactIdentities, 0);
  assert.equal(bad.report.decisions.youtube.matchedSnapshots, 0);
  const later = new Date("2026-11-04T13:00:00Z");
  const missing = assess([{ ...sample, observedAt: later.toISOString(), durationSeconds: undefined }], bad.archive, later);
  assert.equal(missing.report.decisions.youtube.matchedSnapshots, 0);
  const contradicts = assess([{ ...sample, observedAt: later.toISOString(), durationSeconds: 15 }], bad.archive, later);
  assert.equal(contradicts.report.decisions.youtube.exactIdentities, 0);
  assert.equal(assess([{ ...sample, durationSeconds:16 }]).report.decisions.youtube.exactIdentities, 1);
});

test("local archive is crash-safe on invalid input; repeated refreshes do not touch publishing or mark remote import", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "br-local-evidence-test-"));
  try {
    await writeFile(path.join(dir, "queue.json"), '{"enabled":false}');
    const receiptJson = JSON.stringify({entries:[{ status:"confirmed", networkReceipts:{youtube:"scheduler1"}, ...receipt, videoId:"set" }]});
    await writeFile(path.join(dir, "worker-ledger.json"), receiptJson);
    await writeFile(path.join(dir,"latest-export.json"), JSON.stringify({imports:[{network:"youtube",samples:[sample]}]}));
    await writeFile(path.join(dir,"manual-planner-receipts.json"), JSON.stringify({brandId:"6585226",state:"scheduled_not_published",rows:[
      { plannerId:"1234", networks:["youtube","tiktok","tiktok"] }]}));
    const report = await refreshLocalBlackRoomEvidence(dir, dir, seen);
    assert.equal(report.decisions.youtube.matchedSnapshots, 1);
    assert.equal(report.unverifiedManualDeliveries, 2);
    assert.equal(report.decisions.tiktok.matchedSnapshots, 0);
    const replay = await refreshLocalBlackRoomEvidence(dir, dir, seen);
    assert.equal(replay.snapshotCount, 1);
    assert.equal((replay as any).lastCompleteImportAt, undefined);
    assert.equal(await readFile(path.join(dir,"queue.json"),"utf8"), '{"enabled":false}');
    assert.equal(await readFile(path.join(dir,"worker-ledger.json"),"utf8"), receiptJson);
    await writeFile(path.join(dir,"local-ceo-evidence.json"), "{bad");
    await assert.rejects(refreshLocalBlackRoomEvidence(dir, dir, seen));
    assert.equal(await readFile(path.join(dir,"local-ceo-evidence.json"),"utf8"), "{bad");
  } finally { await rm(dir, { recursive:true, force:true }); }
});
