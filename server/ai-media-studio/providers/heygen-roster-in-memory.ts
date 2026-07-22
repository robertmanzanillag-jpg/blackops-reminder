import { createHash } from "node:crypto";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  heyGenRosterDailyPlanSchema,
  type HeyGenRosterDailyPlan,
} from "../../../shared/ai-media-studio-heygen-roster";
import { INITIAL_CREATOR_CANARY_PROFILE } from "../../../shared/ai-media-studio-launch-plan-profile";
import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenRosterError,
  type HeyGenRosterConfigurationInput,
  type HeyGenRosterRecord,
  type HeyGenRosterRepository,
} from "./heygen-roster-contracts";

function scopeKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\0${scope.workspaceId}`;
}

function clone(record: HeyGenRosterRecord): HeyGenRosterRecord {
  return structuredClone(record);
}

function publicKey(prefix: "plan" | "slot", seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function dateInZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function materializePlan(input: HeyGenRosterConfigurationInput): HeyGenRosterDailyPlan {
  const planDate = dateInZone(input.configuredAt, input.accountingTimeZone);
  const currentPlanId = publicKey("plan", `${input.rosterId}\0${planDate}\0${input.accountingTimeZone}`);
  const slots = input.members.flatMap((member) => Array.from(
    { length: HEYGEN_ROSTER_VIDEOS_PER_AVATAR },
    (_, index) => ({
      slotId: publicKey("slot", `${currentPlanId}\0${member.memberId}\0${index + 1}`),
      planId: currentPlanId,
      rosterId: input.rosterId,
      memberId: member.memberId,
      creatorName: member.name,
      videoNumber: index + 1,
      status: "not_queued" as const,
      blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
    }),
  ));
  return heyGenRosterDailyPlanSchema.parse({
    planId: currentPlanId,
    rosterId: input.rosterId,
    planDate,
    timeZone: input.accountingTimeZone,
    status: "blocked_before_generation",
    avatarCount: input.members.length,
    videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    plannedVideoCount: slots.length,
    canGenerate: INITIAL_CREATOR_CANARY_PROFILE.safety.canGenerate,
    noSpendGuarantee: INITIAL_CREATOR_CANARY_PROFILE.safety.noSpend,
    generatedAt: input.configuredAt,
    blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
    slots,
  });
}

export class InMemoryHeyGenRosterRepository implements HeyGenRosterRepository {
  private readonly byRosterId = new Map<string, HeyGenRosterRecord>();
  private readonly byIdempotencyKey = new Map<string, HeyGenRosterRecord>();
  private readonly currentByScope = new Map<string, HeyGenRosterRecord>();
  private readonly dailyPlanByRoster = new Map<string, HeyGenRosterDailyPlan>();

  async configure(input: HeyGenRosterConfigurationInput): Promise<HeyGenRosterRecord> {
    const idempotencyStorageKey = `${scopeKey(input.scope)}\0${input.idempotencyKey}`;
    const existing = this.byIdempotencyKey.get(idempotencyStorageKey);
    if (existing) {
      if (existing.requestDigest !== input.requestDigest
        || existing.providerAccountId !== input.providerAccountId
        || existing.credentialVersion !== input.credentialVersion
        || this.dailyPlanByRoster.get(`${scopeKey(input.scope)}\0${existing.rosterId}`)?.timeZone !== input.accountingTimeZone) {
        throw new HeyGenRosterError("IDEMPOTENCY_CONFLICT");
      }
      if (!this.dailyPlanByRoster.has(`${scopeKey(input.scope)}\0${existing.rosterId}`)) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }
      return clone(existing);
    }

    const { accountingTimeZone: _accountingTimeZone, ...rosterInput } = input;
    const record = clone(rosterInput);
    const plan = materializePlan(input);
    if (plan.slots.length !== input.members.length * HEYGEN_ROSTER_VIDEOS_PER_AVATAR
      || plan.slots.some((slot) => slot.status !== "not_queued")) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    this.byIdempotencyKey.set(idempotencyStorageKey, record);
    this.byRosterId.set(`${scopeKey(input.scope)}\0${input.rosterId}`, record);
    this.currentByScope.set(scopeKey(input.scope), record);
    this.dailyPlanByRoster.set(`${scopeKey(input.scope)}\0${input.rosterId}`, structuredClone(plan));
    return clone(record);
  }

  async getCurrent(scope: TenantScope): Promise<HeyGenRosterRecord | undefined> {
    const record = this.currentByScope.get(scopeKey(scope));
    return record ? clone(record) : undefined;
  }

  async get(scope: TenantScope, rosterId: string): Promise<HeyGenRosterRecord | undefined> {
    const record = this.byRosterId.get(`${scopeKey(scope)}\0${rosterId}`);
    return record ? clone(record) : undefined;
  }

  async getCurrentDailyPlan(scope: TenantScope): Promise<HeyGenRosterDailyPlan | undefined> {
    const roster = this.currentByScope.get(scopeKey(scope));
    if (!roster) return undefined;
    const plan = this.dailyPlanByRoster.get(`${scopeKey(scope)}\0${roster.rosterId}`);
    return plan ? structuredClone(plan) : undefined;
  }
}
