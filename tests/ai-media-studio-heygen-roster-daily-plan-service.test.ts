import assert from "node:assert/strict";
import test from "node:test";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  heyGenRosterDailyPlanResponseSchema,
  heyGenRosterDailyPlanSchema,
  type HeyGenRosterStatus,
} from "../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import { HeyGenRosterError } from "../server/ai-media-studio/providers/heygen-roster-contracts";
import { HeyGenRosterDailyPlanService } from "../server/ai-media-studio/providers/heygen-roster-daily-plan-service";
import type { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;

function roster(count = 5): HeyGenRosterStatus {
  return {
    rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    status: "configured",
    avatarCount: count,
    videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    plannedVideoCount: count * HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    configuredAt: "2030-01-01T00:00:00.000Z",
    members: Array.from({ length: count }, (_, index) => ({
      memberId: `member_${String(index + 1).padStart(24, "0")}`,
      name: `Creator ${index + 1}`,
      language: "en-US",
      accent: "Neutral",
      gender: "unspecified" as const,
      videosPlanned: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    })),
  };
}

function rosterService(current: HeyGenRosterStatus | undefined): HeyGenRosterService {
  return {
    currentStatus: async (requestedScope: TenantScope) => {
      assert.deepEqual(requestedScope, scope);
      return current;
    },
  } as unknown as HeyGenRosterService;
}

test("daily plan expands the current 5-avatar roster into 50 not-queued slots with all launch blockers", async () => {
  const service = new HeyGenRosterDailyPlanService(
    rosterService(roster(5)),
    () => "2030-01-02T00:00:00.000Z",
  );
  const plan = await service.currentPlan(scope, { planDate: "2030-01-03", timeZone: "America/New_York" });

  assert.ok(plan);
  assert.match(plan.planId, /^plan_[a-f0-9]{24}$/u);
  assert.equal(plan.planDate, "2030-01-03");
  assert.equal(plan.timeZone, "America/New_York");
  assert.equal(plan.status, "blocked_before_generation");
  assert.equal(plan.avatarCount, 5);
  assert.equal(plan.videosPerAvatar, 10);
  assert.equal(plan.plannedVideoCount, 50);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
  assert.deepEqual(plan.blockers, [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS]);
  assert.equal(plan.slots.length, 50);
  assert.equal(plan.slots.every((slot) => slot.status === "not_queued"), true);
  assert.equal(plan.slots.every((slot) => slot.planId === plan.planId), true);
  assert.equal(new Set(plan.slots.map((slot) => slot.slotId)).size, 50);
  assert.deepEqual(plan.slots.slice(0, 10).map((slot) => slot.videoNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(plan.slots[0]?.memberId, "member_000000000000000000000001");
  assert.equal(plan.slots[10]?.memberId, "member_000000000000000000000002");
  assert.deepEqual(plan.slots[0]?.blockers, plan.blockers);
  assert.doesNotMatch(JSON.stringify(heyGenRosterDailyPlanResponseSchema.parse({ plan })), /avatarId|voiceId|providerAccount|native|generationId|jobId/iu);
});

test("daily plan scales only to the launch cap and does not make generation possible for 10 avatars", async () => {
  const service = new HeyGenRosterDailyPlanService(
    rosterService(roster(10)),
    () => "2030-01-02T00:00:00.000Z",
  );
  const plan = await service.currentPlan(scope, { planDate: "2030-01-03", timeZone: "UTC" });

  assert.ok(plan);
  assert.equal(plan.avatarCount, 10);
  assert.equal(plan.plannedVideoCount, 100);
  assert.equal(plan.slots.length, 100);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
});

test("daily plan is absent before roster setup, validates request shape, and fails closed on corrupt internal state", async () => {
  assert.equal(await new HeyGenRosterDailyPlanService(rosterService(undefined)).currentPlan(scope), undefined);

  await assert.rejects(
    () => new HeyGenRosterDailyPlanService(rosterService(roster(5))).currentPlan(scope, { planDate: "2030-13-99", timeZone: "UTC" }),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "INVALID_REQUEST",
  );
  await assert.rejects(
    () => new HeyGenRosterDailyPlanService(rosterService(roster(5))).currentPlan(scope, { planDate: "2030-01-03", timeZone: "Fake/Zone" }),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "INVALID_REQUEST",
  );

  const service = new HeyGenRosterDailyPlanService(
    rosterService(roster(5)),
    () => "not-a-date",
  );
  await assert.rejects(
    () => service.currentPlan(scope, { planDate: "2030-01-03", timeZone: "UTC" }),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
});

test("daily plan contract rejects queued/generated plans, unstable bindings, duplicate blockers and incomplete member slots", () => {
  const base = heyGenRosterDailyPlanSchema.parse({
    planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaa",
    rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    planDate: "2030-01-03",
    timeZone: "America/New_York",
    status: "blocked_before_generation",
    avatarCount: 5,
    videosPerAvatar: 10,
    plannedVideoCount: 50,
    canGenerate: false,
    noSpendGuarantee: true,
    generatedAt: "2030-01-02T00:00:00.000Z",
    blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
    slots: Array.from({ length: 5 }, (_, memberIndex) => Array.from(
      { length: 10 },
      (_, videoIndex) => ({
        slotId: `slot_${String(memberIndex * 10 + videoIndex + 1).padStart(24, "0")}`,
        planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaa",
        rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
        memberId: `member_${String(memberIndex + 1).padStart(24, "0")}`,
        creatorName: `Creator ${memberIndex + 1}`,
        videoNumber: videoIndex + 1,
        status: "not_queued",
        blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
      }),
    )).flat(),
  });

  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, canGenerate: true }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, noSpendGuarantee: false }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, slots: [{ ...base.slots[0], status: "queued" }] }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, slots: base.slots.map((slot, index) =>
    index === 0 ? { ...slot, planId: "plan_bbbbbbbbbbbbbbbbbbbbbbbb" } : slot) }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, blockers: [
    "script_batch_required",
    "script_batch_required",
    "budget_reservation_required",
    "sandbox_generation_required",
    "human_launch_approval_required",
  ] }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, slots: base.slots.map((slot, index) =>
    index === 0 ? { ...slot, videoNumber: 2 } : slot) }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, providerAccountId: "private-account" }).success, false);
});

test("daily plan IDs are stable for a roster date timezone tuple and change across dates", async () => {
  const service = new HeyGenRosterDailyPlanService(
    rosterService(roster(5)),
    () => "2030-01-02T00:00:00.000Z",
  );
  const first = await service.currentPlan(scope, { planDate: "2030-01-03", timeZone: "UTC" });
  const replay = await service.currentPlan(scope, { planDate: "2030-01-03", timeZone: "UTC" });
  const nextDay = await service.currentPlan(scope, { planDate: "2030-01-04", timeZone: "UTC" });

  assert.ok(first && replay && nextDay);
  assert.equal(replay.planId, first.planId);
  assert.deepEqual(replay.slots.map((slot) => slot.slotId), first.slots.map((slot) => slot.slotId));
  assert.notEqual(nextDay.planId, first.planId);
  assert.notDeepEqual(nextDay.slots.map((slot) => slot.slotId), first.slots.map((slot) => slot.slotId));
});
