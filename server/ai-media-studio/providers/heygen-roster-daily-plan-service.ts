import { createHash } from "node:crypto";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  createHeyGenRosterDailyPlanRequestSchema,
  heyGenRosterDailyPlanSchema,
  type CreateHeyGenRosterDailyPlanRequest,
  type HeyGenRosterDailyPlan,
} from "../../../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../core/resource-domain";
import { HeyGenRosterError } from "./heygen-roster-contracts";
import type { HeyGenRosterService } from "./heygen-roster-service";

function planId(rosterId: string, planDate: string, timeZone: string): string {
  return `plan_${createHash("sha256").update(`${rosterId}\0${planDate}\0${timeZone}`).digest("hex").slice(0, 24)}`;
}

function slotId(currentPlanId: string, memberId: string, videoNumber: number): string {
  return `slot_${createHash("sha256").update(`${currentPlanId}\0${memberId}\0${videoNumber}`).digest("hex").slice(0, 24)}`;
}

function dateInTimeZone(now: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultRequest(now: string, timeZone: string): CreateHeyGenRosterDailyPlanRequest {
  return { planDate: dateInTimeZone(now, timeZone), timeZone };
}

function parseRequest(input: unknown, now: string, timeZone: string): CreateHeyGenRosterDailyPlanRequest {
  try {
    return createHeyGenRosterDailyPlanRequestSchema.parse(input ?? defaultRequest(now, timeZone));
  } catch {
    throw new HeyGenRosterError("INVALID_REQUEST");
  }
}

/**
 * PR18 is a planning-only boundary. It deliberately never creates generation
 * jobs, reserves budget, enqueues render work, or contacts HeyGen.
 */
export class HeyGenRosterDailyPlanService {
  constructor(
    private readonly rosterService: HeyGenRosterService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly dailyPlanTimeZone = "UTC",
  ) {}

  async currentPlan(scope: TenantScope, unsafeInput?: unknown): Promise<HeyGenRosterDailyPlan | undefined> {
    const generatedAt = this.now();
    const request = parseRequest(unsafeInput, generatedAt, this.dailyPlanTimeZone);
    const roster = await this.rosterService.currentStatus(scope);
    if (!roster) return undefined;
    const currentPlanId = planId(roster.rosterId, request.planDate, request.timeZone);
    const blockers = [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS];
    const slots = roster.members.flatMap((member) => Array.from(
      { length: HEYGEN_ROSTER_VIDEOS_PER_AVATAR },
      (_, index) => ({
        slotId: slotId(currentPlanId, member.memberId, index + 1),
        planId: currentPlanId,
        rosterId: roster.rosterId,
        memberId: member.memberId,
        creatorName: member.name,
        videoNumber: index + 1,
        status: "not_queued" as const,
        blockers: [...blockers],
      }),
    ));
    const plannedVideoCount = roster.avatarCount * HEYGEN_ROSTER_VIDEOS_PER_AVATAR;
    if (slots.length !== plannedVideoCount) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    try {
      return heyGenRosterDailyPlanSchema.parse({
        planId: currentPlanId,
        rosterId: roster.rosterId,
        planDate: request.planDate,
        timeZone: request.timeZone,
        status: "blocked_before_generation",
        avatarCount: roster.avatarCount,
        videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
        plannedVideoCount,
        canGenerate: false,
        noSpendGuarantee: true,
        generatedAt,
        blockers,
        slots,
      });
    } catch {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
  }
}
