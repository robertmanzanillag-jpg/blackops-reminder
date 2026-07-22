import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";
import type { ApproveProductionBatchInput, PrepareProductionBatchInput, ProductionBatchRepository } from "../server/ai-media-studio/production-batches/contracts";
import { ProductionBatchService } from "../server/ai-media-studio/production-batches/service";

const key = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;
function readyBatch(): ProductionBatch {
  return {
    batchId: key("batch", 1), planId: key("plan", 2), status: "draft_ready", avatarCount: 5,
    videosPerAvatar: 10, plannedVideoCount: 50, canGenerate: false, noSpend: true,
    preparedAt: "2026-07-21T12:00:00.000Z", approvedAt: null,
    blockers: ["script_approval_required", "governance_approval_required", "budget_reservation_required",
      "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, member) => ({ memberId: key("member", member + 10), creatorName: `Creator ${member + 1}`,
      items: Array.from({ length: 10 }, (_, video) => ({ slotId: key("slot", 100 + member * 10 + video), videoNumber: video + 1,
        preparation: "draft" as const,
        source: { title: `Source ${video + 1}`, category: "experiences" as const },
        script: { key: key("script", 200 + member * 10 + video), title: `Script ${video + 1}`, status: "draft" as const,
          variantCount: 3, selectedVariant: { title: `Script ${video + 1}`, angle: "Local guide", hook: "See this", script: "Review this exact script",
            cta: "Learn more", caption: "A review caption", hashtags: ["#kong"], seoKeywords: ["local guide"] } },
      })) })),
  };
}

class CapturingRepository implements ProductionBatchRepository {
  input?: PrepareProductionBatchInput;
  approval?: ApproveProductionBatchInput;
  constructor(private readonly batch: ProductionBatch) {}
  async getCurrent() { return this.batch; }
  async prepare(input: PrepareProductionBatchInput) { this.input = input; return this.batch; }
  async approve(input: ApproveProductionBatchInput) { this.approval = input; return this.batch; }
}

test("production batch service defaults to three deterministic zero-cost variants", async () => {
  const repository = new CapturingRepository(readyBatch());
  const service = new ProductionBatchService(repository);
  const result = await service.prepare({ ownerUserId: "user-a", workspaceId: "workspace-a" }, key("plan", 2), {
    idempotencyKey: "prepare-batch-1",
  });
  assert.equal(result.noSpend, true);
  assert.equal(repository.input?.variantCount, 3);
  assert.equal(repository.input?.generator.version, "deterministic-script-v1");
  const generated = repository.input!.generator.generate({
    source: { id: "opaque-source", type: "experiences", title: "A source", summary: "Exact source content" },
    influencerId: "opaque-member", language: "en-US", variantCount: 3,
  });
  assert.equal(generated.generation.mode, "deterministic");
  assert.equal(generated.generation.estimatedCostUsd, 0);
  assert.equal(generated.scriptSet.variants.length, 3);
});

test("production batch service rejects malformed plan IDs and client source snapshots", async () => {
  const service = new ProductionBatchService(new CapturingRepository(readyBatch()));
  await assert.rejects(() => service.prepare({ ownerUserId: "user-a", workspaceId: "workspace-a" }, "not-a-plan", {
    idempotencyKey: "prepare-batch-1",
  }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "INVALID_REQUEST"));
  await assert.rejects(() => service.prepare({ ownerUserId: "user-a", workspaceId: "workspace-a" }, key("plan", 2), {
    idempotencyKey: "prepare-batch-1", sourceSnapshots: [{ title: "spoofed" }],
  }));
});

test("production batch service sends only the exact atomic approval binding", async () => {
  const repository = new CapturingRepository(readyBatch());
  const service = new ProductionBatchService(repository);
  const scope = { ownerUserId: "user-a", workspaceId: "workspace-a" };
  await service.approve(scope, key("plan", 2), {
    idempotencyKey: "approve-batch-1", expectedBatchId: key("batch", 1),
  });
  assert.deepEqual(repository.approval, {
    scope, planId: key("plan", 2), idempotencyKey: "approve-batch-1", expectedBatchId: key("batch", 1),
  });
  await assert.rejects(() => service.approve(scope, key("plan", 2), {
    idempotencyKey: "approve-batch-2", expectedBatchId: key("batch", 1), slotIds: [key("slot", 1)],
  }));
});
