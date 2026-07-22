import type { GenerateScriptVariantsResponse, MediaSourceSnapshot } from "../../../shared/ai-media-studio-scripts";
import type { ProductionBatch } from "../../../shared/ai-media-studio-production-batches";
import type { TenantScope } from "../core/resource-domain";

export type ProductionBatchErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "SOURCE_INELIGIBLE"
  | "SOURCE_REFRESHED"
  | "BATCH_UNAVAILABLE";

export class ProductionBatchError extends Error {
  readonly statusCode: number;

  constructor(readonly code: ProductionBatchErrorCode) {
    super(code);
    this.name = "ProductionBatchError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404
      : code === "BATCH_UNAVAILABLE" ? 503 : 409;
  }
}

export interface ProductionScriptGenerator {
  readonly version: string;
  generate(input: {
    source: MediaSourceSnapshot;
    influencerId: string;
    language: string;
    variantCount: number;
  }): GenerateScriptVariantsResponse;
}

export interface PrepareProductionBatchInput {
  scope: TenantScope;
  planId: string;
  idempotencyKey: string;
  variantCount: number;
  generator: ProductionScriptGenerator;
}

export interface ProductionBatchRepository {
  getCurrent(scope: TenantScope): Promise<ProductionBatch | undefined>;
  prepare(input: PrepareProductionBatchInput): Promise<ProductionBatch>;
}
