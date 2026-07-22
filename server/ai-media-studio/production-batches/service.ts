import {
  PRODUCTION_BATCH_GENERATOR_VERSION,
  approveProductionBatchRequestSchema,
  prepareProductionBatchRequestSchema,
  productionBatchSchema,
  type ProductionBatch,
} from "../../../shared/ai-media-studio-production-batches";
import type { TenantScope } from "../core/resource-domain";
import { DeterministicScriptService } from "../script-service";
import { ProductionBatchError, type ProductionBatchRepository, type ProductionScriptGenerator } from "./contracts";

export class ProductionBatchService {
  private readonly generator: ProductionScriptGenerator;

  constructor(
    private readonly repository: ProductionBatchRepository,
    deterministic = new DeterministicScriptService(),
  ) {
    this.generator = {
      version: PRODUCTION_BATCH_GENERATOR_VERSION,
      generate: (request) => deterministic.generate(request),
    };
  }

  async current(scope: TenantScope): Promise<ProductionBatch | undefined> {
    const batch = await this.repository.getCurrent(scope);
    return batch ? productionBatchSchema.parse(batch) : undefined;
  }

  async prepare(scope: TenantScope, unsafePlanId: unknown, unsafeRequest: unknown): Promise<ProductionBatch> {
    const planId = typeof unsafePlanId === "string" && /^plan_[a-f0-9]{24}$/u.test(unsafePlanId)
      ? unsafePlanId : undefined;
    if (!planId) throw new ProductionBatchError("INVALID_REQUEST");
    const request = prepareProductionBatchRequestSchema.parse(unsafeRequest);
    return productionBatchSchema.parse(await this.repository.prepare({
      scope,
      planId,
      idempotencyKey: request.idempotencyKey,
      variantCount: request.variantCount ?? 3,
      generator: this.generator,
    }));
  }


  async approve(scope: TenantScope, unsafePlanId: unknown, unsafeRequest: unknown): Promise<ProductionBatch> {
    const planId = typeof unsafePlanId === "string" && /^plan_[a-f0-9]{24}$/u.test(unsafePlanId)
      ? unsafePlanId : undefined;
    if (!planId) throw new ProductionBatchError("INVALID_REQUEST");
    const request = approveProductionBatchRequestSchema.parse(unsafeRequest);
    return productionBatchSchema.parse(await this.repository.approve({ scope, planId, ...request }));
  }
}
