import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DrizzleLaunchPreflightRepository,
  launchPreflightWindowIsCurrent,
} from "../server/ai-media-studio/planning/drizzle-launch-preflight-repository";
import { LaunchPreflightError } from "../server/ai-media-studio/planning/launch-preflight-contracts";
import type { LaunchPreflight } from "../shared/ai-media-studio-launch-preflight";

function text(query: unknown): string {
  const candidate = query as { queryChunks?: unknown[] };
  return (candidate.queryChunks ?? []).map((chunk: any) => typeof chunk === "string" ? chunk
    : typeof chunk?.value?.[0] === "string" ? chunk.value[0] : "?").join("");
}

test("repository uses a repeatable-read read-only snapshot and tenant-scoped SELECTs only", async () => {
  const queries: string[] = []; let config: unknown;
  const repository = new DrizzleLaunchPreflightRepository({
    transaction: async (callback, value) => { config = value; return callback({ execute: async (query) => {
      queries.push(text(query));
      return queries.length === 1 ? { rows: [{ observed_at: new Date("2026-07-22T00:00:00Z") }] } : { rows: [] };
    } }); },
    execute: async () => ({ rows: [] }),
  });
  assert.equal(await repository.observe({ ownerUserId: "owner-a", workspaceId: "workspace-a" }, `plan_${"a".repeat(24)}`), undefined);
  assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
  assert.ok(queries.every((query) => /^\s*SELECT/iu.test(query)));
  assert.ok(queries.every((query) => !/\b(?:INSERT|UPDATE|DELETE|FOR\s+UPDATE|LOCK|MERGE|CALL)\b/iu.test(query)));
  assert.match(queries[1], /owner_user_id=.*workspace_id=.*public_plan_key/isu);
});

test("repository source has no authority write, reservation, adapter, network, provider or secret surface", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/planning/drizzle-launch-preflight-repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /reserveAndAdmit|createAuthoritySnapshot|recordContentApproval|fetch\s*\(|axios|secretRef|externalResourceId|FOR UPDATE/iu);
  assert.match(source, /ORDER BY evidence\.revision DESC LIMIT 1/iu);
  assert.match(source, /credential_status='active'/u);
  assert.match(source, /snapshot_current/u);
  assert.match(source, /ORDER BY slots\.public_slot_key\s+LIMIT 101/u);
  assert.match(source, /slotRows\.length > 100/u);
  assert.match(source, /content\.valid_from AS content_valid_from/iu);
  assert.match(source, /snapshot\.valid_from AS snapshot_valid_from/iu);
  assert.match(source, /active\.state='committed'\s+OR \(active\.state='reserved' AND active\.expires_at>transaction_timestamp\(\)\)/iu);
  assert.match(source, /WHERE active\.provider_key=\$\{String\(value\(plan/iu);
});

test("future-dated and boundary-expired evidence/snapshots fail the DB-clock temporal window", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:59:59.999Z", "2026-07-22T12:00:00.001Z", now), true);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T12:00:00.001Z", "2026-07-22T13:00:00.000Z", now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", "2026-07-22T12:00:00.000Z", now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", null, now), false);
  assert.equal(launchPreflightWindowIsCurrent("2026-07-22T11:00:00.000Z", null, now, true), true);
});

type Derive = (scope: { ownerUserId: string; workspaceId: string }, planId: string, now: Date,
  plan: Record<string, unknown>, slots: Array<Record<string, unknown>>, variants: [], authority: [],
  policies: [], capacity: []) => LaunchPreflight;

const batchId = `batch_${"b".repeat(24)}`;
const planId = `plan_${"a".repeat(24)}`;
const digest = `sha256:${"c".repeat(64)}`;
const checksum = "d".repeat(64);

function malformedSlots(memberCount: number, videosPerMember: number, duplicateMember = false): Array<Record<string, unknown>> {
  const slots: Array<Record<string, unknown>> = [];
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
    for (let videoIndex = 0; videoIndex < videosPerMember; videoIndex += 1) {
      const ordinal = memberIndex * videosPerMember + videoIndex;
      slots.push({
        source_member_key: `member_${String(duplicateMember && memberIndex === memberCount - 1
          ? memberIndex : memberIndex + 1).padStart(24, "0")}`,
        influencer_id: `influencer-${memberIndex + 1}`,
        video_number: videoIndex + 1,
        script_metadata: { productionBatchV1: {
          version: 1, batchId, planId, slotId: `slot_${String(ordinal + 1).padStart(24, "0")}`,
          scriptKey: `script_${String(ordinal + 1).padStart(24, "0")}`,
          idempotencyKey: `shape-test-${ordinal + 1}`, inputDigest: digest,
          sourceContentHash: digest, sourceContentChecksum: checksum, sourceTitle: "Shape test source",
          sourceCategory: "events", generatorVersion: "shape-test-v1", variantCount: 1,
          preparedAt: "2026-07-22T11:00:00.000Z",
        } },
      });
    }
  }
  return slots;
}

for (const [label, slots] of [
  ["4x10", malformedSlots(4, 10)],
  ["5x9", malformedSlots(5, 9)],
  ["duplicate member", malformedSlots(5, 10, true)],
] as const) {
  test(`repository returns a structured fail-closed report for an identifiable ${label} batch`, () => {
    const repository = new DrizzleLaunchPreflightRepository({} as never);
    const derive = (repository as unknown as { derive: Derive }).derive.bind(repository);
    const observed = derive({ ownerUserId: "owner-a", workspaceId: "workspace-a" }, planId,
      new Date("2026-07-22T12:00:00.000Z"), { planned_slot_count: 50 }, [...slots], [], [], [], []);
    assert.deepEqual(observed.subject, { planId, batchId, avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: 50 });
    assert.equal(observed.status, "blocked");
    assert.deepEqual(observed.summary, { totalGates: 14, passedGates: 0, blockedGates: 1,
      pendingExternalGates: 0, pendingHumanGates: 0, unavailableGates: 13, readySlots: 0, requiredSlots: 50 });
    assert.deepEqual(observed.gates[0], { code: "batch_integrity", state: "blocked", readySlots: 0,
      requiredSlots: 50, reasonCode: "batch_shape_invalid", nextActionCode: "repair_batch" });
    assert.ok(observed.gates.slice(1).every((entry) => entry.state === "unavailable"
      && entry.readySlots === 0 && entry.reasonCode === "observation_unavailable"
      && entry.nextActionCode === "retry_observation"));
    assert.ok(Object.values(observed.effects).every((effect) => effect === false));
  });
}

test("repository keeps unrepresentable plans and missing or ambiguous batch identity unavailable", () => {
  const repository = new DrizzleLaunchPreflightRepository({} as never);
  const derive = (repository as unknown as { derive: Derive }).derive.bind(repository);
  const argumentsBeforeSlots = [{ ownerUserId: "owner-a", workspaceId: "workspace-a" }, planId,
    new Date("2026-07-22T12:00:00.000Z")] as const;
  assert.throws(() => derive(...argumentsBeforeSlots, { planned_slot_count: 40 }, malformedSlots(4, 10), [], [], [], []),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "UNAVAILABLE");

  const missing = malformedSlots(5, 10);
  missing[0]!.script_metadata = {};
  assert.throws(() => derive(...argumentsBeforeSlots, { planned_slot_count: 50 }, missing, [], [], [], []),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "UNAVAILABLE");

  const ambiguous = malformedSlots(5, 10);
  (ambiguous[0]!.script_metadata as { productionBatchV1: { batchId: string } }).productionBatchV1.batchId
    = `batch_${"e".repeat(24)}`;
  assert.throws(() => derive(...argumentsBeforeSlots, { planned_slot_count: 50 }, ambiguous, [], [], [], []),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "UNAVAILABLE");
});
