import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";
import { sourceToBatchAutomationResponseSchema } from "../shared/ai-media-studio-source-to-batch";
import { ProductionBatchError } from "../server/ai-media-studio/production-batches/contracts";
import {
  SourceToBatchAutomationService,
  type SourceToBatchProductionService,
} from "../server/ai-media-studio/sources/source-to-batch-automation-service";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const key = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;

function batch(status: ProductionBatch["status"]): ProductionBatch {
  const draft = status === "draft_ready" || status === "approved_ready" || status === "stale";
  const approved = status === "approved_ready";
  return {
    batchId: key("batch", 1),
    planId: key("plan", 2),
    status,
    avatarCount: 5,
    videosPerAvatar: 10,
    plannedVideoCount: 50,
    canGenerate: false,
    noSpend: true,
    preparedAt: draft ? "2026-07-22T12:00:00.000Z" : null,
    approvedAt: approved ? "2026-07-22T13:00:00.000Z" : null,
    blockers: approved
      ? ["governance_approval_required", "budget_reservation_required", "sandbox_generation_required", "human_launch_approval_required"]
      : [status === "not_started" ? "script_batch_required" : status === "stale" ? "script_refresh_required" : "script_approval_required",
          "governance_approval_required", "budget_reservation_required", "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, memberIndex) => ({
      memberId: key("member", memberIndex + 10),
      creatorName: `Creator ${memberIndex + 1}`,
      items: Array.from({ length: 10 }, (_, slotIndex) => draft ? {
        slotId: key("slot", 100 + memberIndex * 10 + slotIndex),
        videoNumber: slotIndex + 1,
        preparation: "draft" as const,
        source: { title: `Accepted source ${slotIndex + 1}`, category: "experiences" as const },
        script: {
          key: key("script", 200 + memberIndex * 10 + slotIndex),
          title: `Script ${slotIndex + 1}`,
          status: approved ? "approved" as const : "draft" as const,
          variantCount: 3,
          selectedVariant: {
            title: `Script ${slotIndex + 1}`,
            angle: "Local guide",
            hook: "See this",
            script: "Review this exact script",
            cta: "Learn more",
            caption: "A review caption",
            hashtags: ["#kong"],
            seoKeywords: ["local guide"],
          },
        },
      } : {
        slotId: key("slot", 100 + memberIndex * 10 + slotIndex),
        videoNumber: slotIndex + 1,
        preparation: "pending" as const,
        source: null,
        script: null,
      }),
    })),
  };
}

class FakeProductionService implements SourceToBatchProductionService {
  prepareCalls: unknown[] = [];
  constructor(private readonly currentBatch: ProductionBatch | undefined, private readonly preparedBatch = batch("draft_ready")) {}
  async current() { return this.currentBatch; }
  async prepareFromAdapter(...args: Parameters<SourceToBatchProductionService["prepareFromAdapter"]>) {
    this.prepareCalls.push(args);
    return this.preparedBatch;
  }
}

test("source-to-batch automation prepares the current not-started batch with a server-owned idempotency key", async () => {
  const production = new FakeProductionService(batch("not_started"));
  const service = new SourceToBatchAutomationService(production);
  const response = sourceToBatchAutomationResponseSchema.parse(await service.run(scope));

  assert.equal(response.outcome, "prepared");
  assert.equal(response.batch.status, "draft_ready");
  assert.equal(response.batch.plannedVideoCount, 50);
  assert.equal(response.downstreamState, "blocked_before_render_admission");
  assert.equal(production.prepareCalls.length, 1);
  const prepareCall = production.prepareCalls[0] as Parameters<SourceToBatchProductionService["prepareFromAdapter"]>;
  assert.deepEqual(prepareCall[0], scope);
  assert.equal(prepareCall[1], key("plan", 2));
  assert.equal(prepareCall[2], "kong-owned-catalog");
  assert.match(prepareCall[3].idempotencyKey, /^ams-source-batch-[a-f0-9]{48}$/u);
  assert.equal(prepareCall[3].variantCount, 3);
  assert.deepEqual(response.effects, {
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
  });
});

test("source-to-batch automation replays already prepared and approved batches without preparing again", async () => {
  for (const [state, outcome] of [["draft_ready", "already_prepared"], ["approved_ready", "already_approved"]] as const) {
    const production = new FakeProductionService(batch(state));
    const response = sourceToBatchAutomationResponseSchema.parse(await new SourceToBatchAutomationService(production).run(scope));
    assert.equal(response.outcome, outcome);
    assert.equal(production.prepareCalls.length, 0);
    assert.equal(response.effects.eligibleSourcesConsumed, false);
    assert.equal(response.effects.scriptsPersisted, false);
    assert.equal(response.effects.videoProviderCalled, false);
    assert.equal(response.effects.spendCommitted, false);
  }
});

test("source-to-batch automation rejects missing, stale and invalid tenant state", async () => {
  await assert.rejects(new SourceToBatchAutomationService(new FakeProductionService(undefined)).run(scope),
    (error: unknown) => error instanceof ProductionBatchError && error.code === "NOT_FOUND");
  await assert.rejects(new SourceToBatchAutomationService(new FakeProductionService(batch("stale"))).run(scope),
    (error: unknown) => error instanceof ProductionBatchError && error.code === "SOURCE_REFRESHED");
  await assert.rejects(new SourceToBatchAutomationService(new FakeProductionService(batch("not_started"))).run({
    ownerUserId: "",
    workspaceId: "personal",
  }), (error: unknown) => error instanceof ProductionBatchError && error.code === "INVALID_REQUEST");
});
