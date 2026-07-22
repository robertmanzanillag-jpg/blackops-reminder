import { oneVideoExecutionControlSchema, type OneVideoExecutionControl } from "../../../shared/ai-media-studio-one-video-execution-control";
import type { TenantScope } from "../core/resource-domain";
import { OneVideoExecutionControlError, type OneVideoExecutionControlRepository } from "./one-video-execution-control-contracts";

const PLAN_KEY = /^plan_[0-9a-f]{24}$/u;
const SLOT_KEY = /^slot_[0-9a-f]{24}$/u;

export class OneVideoExecutionControlService {
  constructor(private readonly repository: OneVideoExecutionControlRepository) {
    if (!repository) throw new OneVideoExecutionControlError("UNAVAILABLE");
  }

  async observe(scope: TenantScope, unsafePlanId: unknown, unsafeSlotId: unknown): Promise<OneVideoExecutionControl> {
    if (!scope || typeof scope.ownerUserId !== "string" || !scope.ownerUserId.trim()
      || typeof scope.workspaceId !== "string" || !scope.workspaceId.trim()
      || typeof unsafePlanId !== "string" || !PLAN_KEY.test(unsafePlanId)
      || typeof unsafeSlotId !== "string" || !SLOT_KEY.test(unsafeSlotId)) {
      throw new OneVideoExecutionControlError("INVALID_REQUEST");
    }
    let candidate: OneVideoExecutionControl | undefined;
    try {
      candidate = await this.repository.observe(Object.freeze({
        ownerUserId: scope.ownerUserId.trim(), workspaceId: scope.workspaceId.trim(),
      }), unsafePlanId, unsafeSlotId);
    } catch (error) {
      if (error instanceof OneVideoExecutionControlError) throw error;
      throw new OneVideoExecutionControlError("UNAVAILABLE");
    }
    if (!candidate) throw new OneVideoExecutionControlError("NOT_FOUND");
    const parsed = oneVideoExecutionControlSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.subject.planId !== unsafePlanId || parsed.data.subject.slotId !== unsafeSlotId
      || parsed.data.execute.state !== "disabled" || parsed.data.execute.postAvailable
      || !parsed.data.execute.reasonCodes.includes("one_shot_executor_not_installed")
      || parsed.data.authoritativeForAdmission || parsed.data.canGenerate || parsed.data.spendAuthorized
      || Object.values(parsed.data.effects).some(Boolean)) throw new OneVideoExecutionControlError("UNAVAILABLE");
    return Object.freeze(parsed.data);
  }
}
