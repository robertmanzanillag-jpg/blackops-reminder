import { sandboxReadinessGateCodes, sandboxReadinessSchema, type SandboxReadiness } from "../../../shared/ai-media-studio-sandbox-readiness";
import type { TenantScope } from "../core/resource-domain";
import { SandboxReadinessError, type SandboxReadinessRepository } from "./sandbox-readiness-contracts";

const PLAN_KEY = /^plan_[0-9a-f]{24}$/u;
const SLOT_KEY = /^slot_[0-9a-f]{24}$/u;

export class SandboxReadinessService {
  constructor(private readonly repository: SandboxReadinessRepository) {
    if (!repository) throw new SandboxReadinessError("UNAVAILABLE");
  }

  async observe(scope: TenantScope, unsafePlanId: unknown, unsafeSlotId: unknown): Promise<SandboxReadiness> {
    if (!scope || typeof scope.ownerUserId !== "string" || !scope.ownerUserId.trim()
      || typeof scope.workspaceId !== "string" || !scope.workspaceId.trim()
      || typeof unsafePlanId !== "string" || !PLAN_KEY.test(unsafePlanId)
      || typeof unsafeSlotId !== "string" || !SLOT_KEY.test(unsafeSlotId)) {
      throw new SandboxReadinessError("INVALID_REQUEST");
    }
    let candidate: SandboxReadiness | undefined;
    try {
      candidate = await this.repository.observe(Object.freeze({
        ownerUserId: scope.ownerUserId.trim(), workspaceId: scope.workspaceId.trim(),
      }), unsafePlanId, unsafeSlotId);
    } catch (error) {
      if (error instanceof SandboxReadinessError) throw error;
      throw new SandboxReadinessError("UNAVAILABLE");
    }
    if (!candidate) throw new SandboxReadinessError("NOT_FOUND");
    const parsed = sandboxReadinessSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.subject.planId !== unsafePlanId || parsed.data.subject.slotId !== unsafeSlotId
      || parsed.data.gates.some((gate, index) => gate.code !== sandboxReadinessGateCodes[index])
      || parsed.data.canGenerate || parsed.data.sandboxExecutionAllowed || parsed.data.spendAuthorized
      || !parsed.data.noSpend || parsed.data.authoritativeForAdmission
      || Object.values(parsed.data.effects).some(Boolean)) throw new SandboxReadinessError("UNAVAILABLE");
    return Object.freeze(parsed.data);
  }
}
