import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryHeyGenRosterRepository } from "../server/ai-media-studio/providers/heygen-roster-in-memory";
import { HeyGenRosterDailyPlanService } from "../server/ai-media-studio/providers/heygen-roster-daily-plan-service";
import { HeyGenRosterService } from "../server/ai-media-studio/providers/heygen-roster-service";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  heyGenRosterDailyPlanSchema,
} from "../shared/ai-media-studio-heygen-roster";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;

function rosterRequest(count: number) {
  return {
    members: Array.from({ length: count }, (_, index) => ({
      name: `Creator ${index + 1}`,
      avatarId: `native-avatar-${index + 1}`,
      voiceId: "native-voice-shared",
      language: "es-US",
      accent: "Latino",
      gender: "unspecified",
    })),
    idempotencyKey: `daily-plan-roster-${count}`,
  };
}

test("daily plan derives 10 blocked no-spend slots per configured avatar", async () => {
  const rosterService = new HeyGenRosterService(
    new InMemoryHeyGenRosterRepository(),
    { resolve: async () => ({ providerAccountId: "private-account", credentialVersion: 1 }) },
    () => "2030-01-01T00:00:00.000Z",
  );
  await rosterService.configure(scope, rosterRequest(7));

  const planner = new HeyGenRosterDailyPlanService(rosterService, () => "2030-01-02T00:00:00.000Z");
  const plan = heyGenRosterDailyPlanSchema.parse(await planner.currentPlan(scope));

  assert.equal(plan.avatarCount, 7);
  assert.equal(plan.videosPerAvatar, 10);
  assert.equal(plan.plannedVideoCount, 70);
  assert.equal(plan.canGenerate, false);
  assert.equal(plan.noSpendGuarantee, true);
  assert.deepEqual(plan.blockers, [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS]);
  assert.equal(plan.slots.length, 70);
  assert.equal(plan.slots.filter((slot) => slot.memberId === plan.slots[0]!.memberId).length, 10);
  assert.deepEqual([...new Set(plan.slots.map((slot) => slot.status))], ["not_queued"]);
  assert.doesNotMatch(JSON.stringify(plan), /native-avatar|native-voice|private-account|avatarId|voiceId|providerAccountId/iu);
});

test("daily plan is absent before roster configuration", async () => {
  const rosterService = new HeyGenRosterService(
    new InMemoryHeyGenRosterRepository(),
    { resolve: async () => ({ providerAccountId: "private-account", credentialVersion: 1 }) },
  );
  const planner = new HeyGenRosterDailyPlanService(rosterService);
  assert.equal(await planner.currentPlan(scope), undefined);
});
