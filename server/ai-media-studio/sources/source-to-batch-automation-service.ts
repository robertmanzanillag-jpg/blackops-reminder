import { createHash } from "node:crypto";
import {
  sourceToBatchAutomationResponseSchema,
  type SourceToBatchAutomationResponse,
} from "../../../shared/ai-media-studio-source-to-batch";
import type { ProductionBatch } from "../../../shared/ai-media-studio-production-batches";
import type { TenantScope } from "../core/resource-domain";
import { ProductionBatchError } from "../production-batches/contracts";
import { KONG_OWNED_SOURCE_ADAPTER_KEY } from "./kong-owned-source-adapter";

export interface SourceToBatchProductionService {
  current(scope: TenantScope): Promise<ProductionBatch | undefined>;
  prepareFromAdapter(
    scope: TenantScope,
    unsafePlanId: unknown,
    unsafeAdapterKey: unknown,
    unsafeRequest: unknown,
  ): Promise<ProductionBatch>;
}

export class SourceToBatchAutomationService {
  constructor(private readonly productionBatches: SourceToBatchProductionService) {
    if (!productionBatches || typeof productionBatches.current !== "function"
      || typeof productionBatches.prepareFromAdapter !== "function") {
      throw new ProductionBatchError("BATCH_UNAVAILABLE");
    }
  }

  async run(scope: TenantScope): Promise<SourceToBatchAutomationResponse> {
    if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()) {
      throw new ProductionBatchError("INVALID_REQUEST");
    }
    const current = await this.productionBatches.current(scope);
    if (!current) throw new ProductionBatchError("NOT_FOUND");
    if (current.status === "draft_ready") return response("already_prepared", current);
    if (current.status === "approved_ready") return response("already_approved", current);
    if (current.status === "stale") throw new ProductionBatchError("SOURCE_REFRESHED");
    try {
      const prepared = await this.productionBatches.prepareFromAdapter(
        scope,
        current.planId,
        KONG_OWNED_SOURCE_ADAPTER_KEY,
        {
          idempotencyKey: serverOwnedIdempotency(scope, current),
          variantCount: 3,
        },
      );
      return response("prepared", prepared);
    } catch (error) {
      if (error instanceof ProductionBatchError) throw error;
      throw new ProductionBatchError("BATCH_UNAVAILABLE");
    }
  }
}

function response(
  outcome: SourceToBatchAutomationResponse["outcome"],
  batch: ProductionBatch,
): SourceToBatchAutomationResponse {
  const prepared = outcome === "prepared";
  return sourceToBatchAutomationResponseSchema.parse({
    outcome,
    batch,
    downstreamState: "blocked_before_render_admission",
    effects: {
      productionBatchRead: true,
      eligibleSourcesConsumed: prepared,
      scriptsPersisted: prepared,
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
}

function serverOwnedIdempotency(scope: TenantScope, batch: ProductionBatch): string {
  return `ams-source-batch-${createHash("sha256").update(JSON.stringify({
    ownerUserId: scope.ownerUserId,
    workspaceId: scope.workspaceId,
    planId: batch.planId,
    notStartedBatchId: batch.batchId,
    plannedVideoCount: batch.plannedVideoCount,
    generator: "deterministic-script-v1",
    variantCount: 3,
  })).digest("hex").slice(0, 48)}`;
}
