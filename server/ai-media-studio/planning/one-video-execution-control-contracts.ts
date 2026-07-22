import type { OneVideoExecutionControl } from "../../../shared/ai-media-studio-one-video-execution-control";
import type { TenantScope } from "../core/resource-domain";

export type OneVideoExecutionControlErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "UNAVAILABLE";

export class OneVideoExecutionControlError extends Error {
  readonly statusCode: number;
  constructor(readonly code: OneVideoExecutionControlErrorCode) {
    super(code); this.name = "OneVideoExecutionControlError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
  }
}

export interface OneVideoExecutionControlRepository {
  /** One exact tenant slot, observed with PostgreSQL time in a repeatable-read/read-only transaction. */
  observe(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoExecutionControl | undefined>;
}
