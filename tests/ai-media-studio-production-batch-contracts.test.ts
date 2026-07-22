import assert from "node:assert/strict";
import test from "node:test";
import {
  approveProductionBatchRequestSchema,
  prepareProductionBatchRequestSchema,
  productionBatchSchema,
  type ProductionBatch,
} from "../shared/ai-media-studio-production-batches";

const hex = (value: number) => value.toString(16).padStart(24, "0").slice(-24);

function pendingBatch(): ProductionBatch {
  return {
    batchId: `batch_${hex(1)}`, planId: `plan_${hex(2)}`, status: "not_started",
    avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: 50,
    canGenerate: false, noSpend: true, preparedAt: null, approvedAt: null,
    blockers: ["script_batch_required", "governance_approval_required", "budget_reservation_required",
      "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, member) => ({
      memberId: `member_${hex(member + 10)}`, creatorName: `Creator ${member + 1}`,
      items: Array.from({ length: 10 }, (_, video) => ({
        slotId: `slot_${hex(member * 10 + video + 100)}`, videoNumber: video + 1,
        preparation: "pending" as const, source: null, script: null,
      })),
    })),
  };
}

test("production batch request is strict and server-owned source fields cannot enter HTTP", () => {
  assert.deepEqual(prepareProductionBatchRequestSchema.parse({ idempotencyKey: "batch-key-1" }), {
    idempotencyKey: "batch-key-1",
  });
  for (const unsafe of [
    { idempotencyKey: "batch-key-1", sourceIds: ["private"] },
    { idempotencyKey: "batch-key-1", contentHash: `sha256:${"a".repeat(64)}` },
    { idempotencyKey: "batch-key-1", providerAccountId: "private" },
    [], null,
  ]) assert.equal(prepareProductionBatchRequestSchema.safeParse(unsafe).success, false);
});

test("batch approval request binds one exact public batch and rejects launch or spend controls", () => {
  const request = { idempotencyKey: "approval-key-1", expectedBatchId: `batch_${hex(9)}` };
  assert.deepEqual(approveProductionBatchRequestSchema.parse(request), request);
  for (const unsafe of [
    { ...request, slotIds: [`slot_${hex(1)}`] },
    { ...request, allowSpend: true },
    { ...request, providerKey: "heygen" },
    { idempotencyKey: "short", expectedBatchId: `batch_${hex(9)}` },
  ]) assert.equal(approveProductionBatchRequestSchema.safeParse(unsafe).success, false);
});

test("not-started production batches expose real pending slots with zero invented source/script placeholders", () => {
  const parsed = productionBatchSchema.parse(pendingBatch());
  const items = parsed.groups.flatMap((group) => group.items);
  assert.equal(items.length, 50);
  assert.ok(items.every((item) => item.preparation === "pending" && item.source === null && item.script === null));
  assert.doesNotMatch(JSON.stringify(parsed), /HeyGen|providerAccountId|sourceId|contentHash|native/iu);
});

test("production readiness and blocker projections are exact", () => {
  const invalid = pendingBatch();
  invalid.blockers = ["script_approval_required", ...invalid.blockers.slice(1)] as ProductionBatch["blockers"];
  assert.equal(productionBatchSchema.safeParse(invalid).success, false);
});
