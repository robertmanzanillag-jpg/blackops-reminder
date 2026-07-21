import assert from "node:assert/strict";
import test from "node:test";
import {
  HEYGEN_ROSTER_MAX_AVATARS,
  HEYGEN_ROSTER_MAX_PLANNED_VIDEOS,
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  HEYGEN_ROSTER_MIN_AVATARS,
  HEYGEN_ROSTER_MIN_PLANNED_VIDEOS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  createHeyGenRosterRequestSchema,
  heyGenRosterDailyPlanSchema,
  heyGenRosterStatusSchema,
} from "../shared/ai-media-studio-heygen-roster";

function member(index: number) {
  return {
    name: `Avatar ${index}`,
    avatarId: `heygen-avatar-${index}`,
    voiceId: "shared-voice",
    language: "es-US",
    accent: "Latino",
    gender: "female" as const,
  };
}

test("launch constants bound the initial roster to 5-10 avatars and 50-100 videos", () => {
  assert.equal(HEYGEN_ROSTER_MIN_AVATARS, 5);
  assert.equal(HEYGEN_ROSTER_MAX_AVATARS, 10);
  assert.equal(HEYGEN_ROSTER_VIDEOS_PER_AVATAR, 10);
  assert.equal(HEYGEN_ROSTER_MIN_PLANNED_VIDEOS, 50);
  assert.equal(HEYGEN_ROSTER_MAX_PLANNED_VIDEOS, 100);
});

test("request accepts 5-10 unique avatars while allowing a shared voice", () => {
  for (const count of [5, 10]) {
    const parsed = createHeyGenRosterRequestSchema.parse({
      members: Array.from({ length: count }, (_, index) => member(index)),
      idempotencyKey: `launch-roster-${count}`,
    });
    assert.equal(parsed.members.length, count);
    assert.equal(new Set(parsed.members.map((item) => item.voiceId)).size, 1);
  }
});

test("request rejects counts outside launch bounds, duplicate avatars, and unknown secret fields", () => {
  assert.equal(createHeyGenRosterRequestSchema.safeParse({ members: Array.from({ length: 4 }, (_, i) => member(i)), idempotencyKey: "launch-roster-4" }).success, false);
  assert.equal(createHeyGenRosterRequestSchema.safeParse({ members: Array.from({ length: 11 }, (_, i) => member(i)), idempotencyKey: "launch-roster-11" }).success, false);
  assert.equal(createHeyGenRosterRequestSchema.safeParse({ members: [member(0), member(0), ...Array.from({ length: 3 }, (_, i) => member(i + 1))], idempotencyKey: "duplicate-avatar" }).success, false);
  assert.equal(createHeyGenRosterRequestSchema.safeParse({ members: Array.from({ length: 5 }, (_, i) => member(i)), idempotencyKey: "unknown-field", apiKey: "must-not-pass" }).success, false);
  assert.equal(createHeyGenRosterRequestSchema.safeParse({ members: [{ ...member(0), token: "must-not-pass" }, ...Array.from({ length: 4 }, (_, i) => member(i + 1))], idempotencyKey: "nested-secret" }).success, false);
  const inherited = Object.create({ apiKey: "must-not-pass" }) as Record<string, unknown>;
  Object.assign(inherited, { members: Array.from({ length: 5 }, (_, i) => member(i)), idempotencyKey: "prototype-field" });
  assert.equal(createHeyGenRosterRequestSchema.safeParse(inherited).success, false);
});

test("public status schema has no provider account, avatar, or voice identifiers", () => {
  const status = heyGenRosterStatusSchema.parse({
    rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    status: "configured",
    avatarCount: 5,
    videosPerAvatar: 10,
    plannedVideoCount: 50,
    members: Array.from({ length: 5 }, (_, index) => ({
      memberId: `member_${String(index).padStart(24, "0")}`,
      name: `Avatar ${index}`,
      language: "es-US",
      accent: "Latino",
      gender: "female",
      videosPlanned: 10,
    })),
    configuredAt: "2030-01-01T00:00:00.000Z",
  });
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /avatarId|voiceId|providerAccountId|apiKey|secret|token/iu);
});

test("daily plan schema requires exactly 10 blocked no-spend slots per avatar", () => {
  const blockers = [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS];
  const planId = "plan_bbbbbbbbbbbbbbbbbbbbbbbb";
  const plan = {
    planId,
    rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
    planDate: "2030-01-01",
    timeZone: "America/New_York",
    status: "blocked_before_generation",
    avatarCount: 5,
    videosPerAvatar: 10,
    plannedVideoCount: 50,
    canGenerate: false,
    noSpendGuarantee: true,
    generatedAt: "2030-01-01T00:00:00.000Z",
    blockers,
    slots: Array.from({ length: 50 }, (_, index) => ({
      slotId: `slot_${String(index + 1).padStart(24, "0")}`,
      planId,
      rosterId: "roster_aaaaaaaaaaaaaaaaaaaaaaaa",
      memberId: `member_${String(Math.floor(index / 10) + 1).padStart(24, "0")}`,
      creatorName: `Creator ${Math.floor(index / 10) + 1}`,
      videoNumber: (index % 10) + 1,
      status: "not_queued",
      blockers,
    })),
  };
  assert.equal(heyGenRosterDailyPlanSchema.safeParse(plan).success, true);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...plan, canGenerate: true }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...plan, blockers: blockers.toReversed() }).success, false);
  assert.equal(heyGenRosterDailyPlanSchema.safeParse({ ...plan, slots: plan.slots.slice(0, 49) }).success, false);
});
