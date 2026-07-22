import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceToBatchAutomationRequestSchema,
  sourceToBatchAutomationResponseSchema,
} from "../shared/ai-media-studio-source-to-batch";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";

const publicKey = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;

function batch(status: ProductionBatch["status"] = "draft_ready"): ProductionBatch {
  return {
    batchId: publicKey("batch", 1),
    planId: publicKey("plan", 2),
    status,
    avatarCount: 5,
    videosPerAvatar: 10,
    plannedVideoCount: 50,
    canGenerate: false,
    noSpend: true,
    preparedAt: status === "not_started" ? null : "2026-07-22T12:00:00.000Z",
    approvedAt: status === "approved_ready" ? "2026-07-22T12:05:00.000Z" : null,
    blockers: status === "approved_ready"
      ? ["governance_approval_required", "budget_reservation_required", "sandbox_generation_required", "human_launch_approval_required"]
      : [status === "not_started" ? "script_batch_required" : status === "stale" ? "script_refresh_required" : "script_approval_required",
        "governance_approval_required", "budget_reservation_required", "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, member) => ({
      memberId: publicKey("member", member + 1),
      creatorName: `Creator ${member + 1}`,
      items: Array.from({ length: 10 }, (_, video) => ({
        slotId: publicKey("slot", member * 10 + video + 1),
        videoNumber: video + 1,
        ...(status === "not_started" ? { preparation: "pending" as const, source: null, script: null } : {
          preparation: "draft" as const,
          source: { title: `Source ${video + 1}`, category: "events" as const },
          script: {
            key: publicKey("script", member * 10 + video + 1),
            title: `Video ${video + 1}`,
            status: status === "approved_ready" ? "approved" as const : "draft" as const,
            variantCount: 3,
            selectedVariant: {
              title: `Video ${video + 1}`,
              angle: "hidden gem",
              hook: "Start here",
              script: "Safe deterministic draft",
              cta: "Plan now",
              caption: "A safe caption",
              hashtags: ["#Kong"],
              seoKeywords: ["weekend"],
            },
          },
        }),
      })),
    })),
  };
}

test("source-to-batch automation request is empty and rejects browser-controlled batch or provider fields", () => {
  assert.deepEqual(sourceToBatchAutomationRequestSchema.parse({}), {});
  for (const body of [
    { planId: publicKey("plan", 2) },
    { sourceIds: ["source-private"] },
    { idempotencyKey: "client-owned" },
    { providerExternalId: "native-private-id" },
    { renderQueued: true },
  ]) {
    assert.equal(sourceToBatchAutomationRequestSchema.safeParse(body).success, false);
  }
});

test("source-to-batch automation response exposes only a safe blocked batch projection", () => {
  const parsed = sourceToBatchAutomationResponseSchema.parse({
    outcome: "prepared",
    batch: batch("draft_ready"),
    downstreamState: "blocked_before_render_admission",
    effects: {
      productionBatchRead: true,
      eligibleSourcesConsumed: true,
      scriptsPersisted: true,
      scriptApprovalRecorded: false,
      renderQueued: false,
      outboxCreated: false,
      videoProviderCalled: false,
      secretResolved: false,
      spendCommitted: false,
      publishingCreated: false,
      migrationApplied: false,
      deploymentPerformed: false,
    },
  });
  assert.equal(parsed.batch.canGenerate, false);
  assert.equal(parsed.batch.noSpend, true);
  assert.equal(sourceToBatchAutomationResponseSchema.safeParse({
    ...parsed,
    effects: { ...parsed.effects, videoProviderCalled: true },
  }).success, false);
  assert.equal(sourceToBatchAutomationResponseSchema.safeParse({
    ...parsed,
    providerExternalId: "private",
  }).success, false);
  assert.equal(sourceToBatchAutomationResponseSchema.safeParse({
    ...parsed,
    batch: batch("approved_ready"),
  }).success, false);
});
