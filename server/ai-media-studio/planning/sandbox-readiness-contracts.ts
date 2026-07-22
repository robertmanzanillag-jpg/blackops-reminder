import type { SandboxReadiness } from "../../../shared/ai-media-studio-sandbox-readiness";
import type { TenantScope } from "../core/resource-domain";

export type SandboxReadinessErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "UNAVAILABLE";

export class SandboxReadinessError extends Error {
  readonly statusCode: number;
  constructor(readonly code: SandboxReadinessErrorCode) {
    super(code);
    this.name = "SandboxReadinessError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
  }
}

export interface SandboxReadinessRepository {
  /** One tenant-scoped, DB-clock-owned, repeatable-read/read-only observation. */
  observe(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<SandboxReadiness | undefined>;
}
