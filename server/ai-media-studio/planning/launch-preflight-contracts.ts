import type { LaunchPreflight } from "../../../shared/ai-media-studio-launch-preflight";
import type { TenantScope } from "../core/resource-domain";

export type LaunchPreflightErrorCode = "INVALID_REQUEST" | "NOT_FOUND" | "UNAVAILABLE";

export class LaunchPreflightError extends Error {
  readonly statusCode: number;
  constructor(readonly code: LaunchPreflightErrorCode) {
    super(code);
    this.name = "LaunchPreflightError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "NOT_FOUND" ? 404 : 503;
  }
}

export interface LaunchPreflightRepository {
  /** A coherent, database-clock-owned, read-only observation. */
  observe(scope: TenantScope, publicPlanKey: string): Promise<LaunchPreflight | undefined>;
}
