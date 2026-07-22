import { launchPreflightGateCodes, launchPreflightSchema, type LaunchPreflight } from "../../../shared/ai-media-studio-launch-preflight";
import type { TenantScope } from "../core/resource-domain";
import { LaunchPreflightError, type LaunchPreflightRepository } from "./launch-preflight-contracts";

const PLAN_KEY = /^plan_[0-9a-f]{24}$/u;

export class LaunchPreflightService {
  constructor(private readonly repository: LaunchPreflightRepository) {
    if (!repository) throw new LaunchPreflightError("UNAVAILABLE");
  }

  async observe(scope: TenantScope, unsafePlanId: unknown): Promise<LaunchPreflight> {
    if (!scope || typeof scope.ownerUserId !== "string" || !scope.ownerUserId.trim()
      || typeof scope.workspaceId !== "string" || !scope.workspaceId.trim()
      || typeof unsafePlanId !== "string" || !PLAN_KEY.test(unsafePlanId)) {
      throw new LaunchPreflightError("INVALID_REQUEST");
    }
    let candidate: LaunchPreflight | undefined;
    try {
      candidate = await this.repository.observe(Object.freeze({
        ownerUserId: scope.ownerUserId.trim(), workspaceId: scope.workspaceId.trim(),
      }), unsafePlanId);
    } catch (error) {
      if (error instanceof LaunchPreflightError) throw error;
      throw new LaunchPreflightError("UNAVAILABLE");
    }
    if (!candidate) throw new LaunchPreflightError("NOT_FOUND");
    const parsed = launchPreflightSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.subject.planId !== unsafePlanId
      || parsed.data.gates.some((gate, index) => gate.code !== launchPreflightGateCodes[index])
      || parsed.data.summary.requiredSlots !== parsed.data.subject.plannedVideoCount
      || parsed.data.summary.totalGates !== parsed.data.gates.length
      || parsed.data.canGenerate || parsed.data.sandboxExecutionAllowed || parsed.data.spendAuthorized
      || !parsed.data.noSpend || parsed.data.authoritativeForAdmission
      || Object.values(parsed.data.effects).some(Boolean)) {
      throw new LaunchPreflightError("UNAVAILABLE");
    }
    return Object.freeze(parsed.data);
  }
}
