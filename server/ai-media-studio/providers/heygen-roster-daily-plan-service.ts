import {
  heyGenRosterDailyPlanSchema,
  type HeyGenRosterDailyPlan,
} from "../../../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../core/resource-domain";
import { HeyGenRosterError } from "./heygen-roster-contracts";
import type { HeyGenRosterService } from "./heygen-roster-service";

/** Public projection over a plan that was materialized with the roster transaction. */
export class HeyGenRosterDailyPlanService {
  constructor(private readonly rosterService: HeyGenRosterService) {}

  async currentPlan(scope: TenantScope): Promise<HeyGenRosterDailyPlan | undefined> {
    try {
      const plan = await this.rosterService.currentDailyPlan(scope);
      return plan ? heyGenRosterDailyPlanSchema.parse(plan) : undefined;
    } catch (error) {
      if (error instanceof HeyGenRosterError) throw error;
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }
}
