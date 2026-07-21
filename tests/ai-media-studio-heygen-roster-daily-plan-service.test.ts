import assert from "node:assert/strict";
import test from "node:test";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  heyGenRosterDailyPlanResponseSchema,
  heyGenRosterDailyPlanSchema,
} from "../shared/ai-media-studio-heygen-roster";
import { InMemoryHeyGenRosterRepository } from "../server/ai-media-studio/providers/heygen-roster-in-memory";
import { HeyGenRosterDailyPlanService } from "../server/ai-media-studio/providers/heygen-roster-daily-plan-service";
import { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";
import { HeyGenRosterError } from "../server/ai-media-studio/providers/heygen-roster-contracts";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;

function request(count: number, idempotencyKey = `daily-roster-${count}`) {
  return {
    idempotencyKey,
    members: Array.from({ length: count }, (_, index) => ({
      name: `Creator ${index + 1}`, avatarId: `native-avatar-${index + 1}`,
      voiceId: "native-voice-shared", language: "en-US", accent: "Neutral",
      gender: "unspecified" as const,
    })),
  };
}

async function configured(count: number, timeZone = "America/New_York") {
  const repository = new InMemoryHeyGenRosterRepository();
  const roster = new HeyGenRosterService(
    repository,
    { resolve: async () => ({ providerAccountId: "private-account", credentialVersion: 3 }) },
    () => "2030-01-03T02:00:00.000Z",
    timeZone,
  );
  await roster.configure(scope, request(count));
  return { repository, roster, planner: new HeyGenRosterDailyPlanService(roster) };
}

test("durable daily-plan read returns exactly 10 blocked public slots for each of 5 avatars", async () => {
  const { planner } = await configured(5);
  const plan = await planner.currentPlan(scope);
  assert.ok(plan);
  assert.equal(plan.planDate, "2030-01-02");
  assert.equal(plan.timeZone, "America/New_York");
  assert.equal(plan.avatarCount, 5);
  assert.equal(plan.plannedVideoCount, 50);
  assert.equal(plan.slots.length, 50);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
  assert.deepEqual(plan.blockers, [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS]);
  for (const memberId of new Set(plan.slots.map((slot) => slot.memberId))) {
    assert.deepEqual(plan.slots.filter((slot) => slot.memberId === memberId).map((slot) => slot.videoNumber), [1,2,3,4,5,6,7,8,9,10]);
  }
  assert.equal(plan.slots.every((slot) => slot.status === "not_queued"), true);
  assert.doesNotMatch(JSON.stringify(heyGenRosterDailyPlanResponseSchema.parse({ plan })), /native-avatar|native-voice|private-account|providerAccount|credential|influencerId|avatarId|voiceId/iu);
});

test("durable daily-plan creation reaches the 10-avatar cap without enabling spend", async () => {
  const { planner } = await configured(10, "UTC");
  const plan = await planner.currentPlan(scope);
  assert.ok(plan);
  assert.equal(plan.avatarCount, 10);
  assert.equal(plan.slots.length, 100);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
});

test("daily-plan reads stored state and is absent before roster configuration", async () => {
  const repository = new InMemoryHeyGenRosterRepository();
  const roster = new HeyGenRosterService(repository, {
    resolve: async () => ({ providerAccountId: "private-account", credentialVersion: 1 }),
  });
  assert.equal(await new HeyGenRosterDailyPlanService(roster).currentPlan(scope), undefined);

  const runtime = await configured(5, "UTC");
  const first = await runtime.planner.currentPlan(scope);
  const replay = await runtime.planner.currentPlan(scope);
  assert.deepEqual(replay, first);
});

test("daily-plan service fails closed when the repository projection is corrupt", async () => {
  const roster = {
    currentDailyPlan: async () => ({ canGenerate: true }),
  } as unknown as HeyGenRosterService;
  await assert.rejects(
    () => new HeyGenRosterDailyPlanService(roster).currentPlan(scope),
    (error: unknown) => error instanceof HeyGenRosterError && error.code === "ROSTER_UNAVAILABLE",
  );
});

test("daily plan contract rejects queued/generated plans, unstable bindings and incomplete member slots", () => {
  const slots = Array.from({ length: 5 }, (_, memberIndex) => Array.from({ length: 10 }, (_, videoIndex) => ({
    slotId: `slot_${String(memberIndex * 10 + videoIndex + 1).padStart(24, "0")}`,
    planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaa", rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    memberId: `member_${String(memberIndex + 1).padStart(24, "0")}`,
    creatorName: `Creator ${memberIndex + 1}`, videoNumber: videoIndex + 1,
    status: "not_queued", blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
  }))).flat();
  const base = heyGenRosterDailyPlanSchema.parse({
    planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaa", rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    planDate: "2030-01-03", timeZone: "UTC", status: "blocked_before_generation",
    avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: 50, canGenerate: false,
    noSpendGuarantee: true, generatedAt: "2030-01-02T00:00:00.000Z",
    blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS], slots,
  });
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, canGenerate: true }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, slots: base.slots.slice(1) }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...base, providerAccountId: "private" }).success, false);
});
