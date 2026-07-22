import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INITIAL_CREATOR_CANARY_PROFILE,
  initialCreatorCanaryProfileSchema,
  isInitialCreatorCanaryShape,
} from "../shared/ai-media-studio-launch-plan-profile";
import {
  HEYGEN_ROSTER_MAX_AVATARS,
  HEYGEN_ROSTER_MAX_PLANNED_VIDEOS,
  HEYGEN_ROSTER_MIN_AVATARS,
  HEYGEN_ROSTER_MIN_PLANNED_VIDEOS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
} from "../shared/ai-media-studio-heygen-roster";
import {
  PRODUCTION_BATCH_CONTENT_PLAN_STRATEGY,
  PRODUCTION_BATCH_MAX_AVATARS,
  PRODUCTION_BATCH_MAX_VIDEOS,
  PRODUCTION_BATCH_MIN_AVATARS,
  PRODUCTION_BATCH_MIN_VIDEOS,
  PRODUCTION_BATCH_SOURCE_TOPIC_COUNT,
  PRODUCTION_BATCH_VIDEOS_PER_AVATAR,
} from "../shared/ai-media-studio-production-batches";

test("initial creator canary profile is strict, provider-neutral, exact and deeply immutable", () => {
  assert.deepEqual(initialCreatorCanaryProfileSchema.parse(INITIAL_CREATOR_CANARY_PROFILE), {
    version: 1,
    key: "initial_creator_canary_v1",
    scope: "provider_neutral",
    creators: { minimum: 5, maximum: 10, videosPerCreator: 10 },
    slots: { minimum: 50, maximum: 100 },
    contentDeck: {
      strategy: "topic_deck_by_video_number",
      topicCount: 10,
      reuseAcrossCreators: true,
    },
    safety: { blocked: true, canGenerate: false, noSpend: true },
    admission: "one_video_then_canary",
  });
  assert.equal(Object.isFrozen(INITIAL_CREATOR_CANARY_PROFILE), true);
  assert.equal(Object.isFrozen(INITIAL_CREATOR_CANARY_PROFILE.creators), true);
  assert.equal(Object.isFrozen(INITIAL_CREATOR_CANARY_PROFILE.slots), true);
  assert.equal(Object.isFrozen(INITIAL_CREATOR_CANARY_PROFILE.contentDeck), true);
  assert.equal(Object.isFrozen(INITIAL_CREATOR_CANARY_PROFILE.safety), true);
  assert.equal(JSON.stringify(INITIAL_CREATOR_CANARY_PROFILE).toLowerCase().includes("heygen"), false);

  assert.equal(initialCreatorCanaryProfileSchema.safeParse({
    ...INITIAL_CREATOR_CANARY_PROFILE,
    provider: "forbidden",
  }).success, false);
  assert.equal(initialCreatorCanaryProfileSchema.safeParse({
    ...INITIAL_CREATOR_CANARY_PROFILE,
    creators: { ...INITIAL_CREATOR_CANARY_PROFILE.creators, extra: true },
  }).success, false);
});

test("legacy launch constants remain exact aliases of the canonical profile", () => {
  const { creators, slots, contentDeck } = INITIAL_CREATOR_CANARY_PROFILE;
  assert.deepEqual([
    HEYGEN_ROSTER_MIN_AVATARS, HEYGEN_ROSTER_MAX_AVATARS, HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    HEYGEN_ROSTER_MIN_PLANNED_VIDEOS, HEYGEN_ROSTER_MAX_PLANNED_VIDEOS,
  ], [creators.minimum, creators.maximum, creators.videosPerCreator, slots.minimum, slots.maximum]);
  assert.deepEqual([
    PRODUCTION_BATCH_MIN_AVATARS, PRODUCTION_BATCH_MAX_AVATARS, PRODUCTION_BATCH_VIDEOS_PER_AVATAR,
    PRODUCTION_BATCH_MIN_VIDEOS, PRODUCTION_BATCH_MAX_VIDEOS,
    PRODUCTION_BATCH_SOURCE_TOPIC_COUNT, PRODUCTION_BATCH_CONTENT_PLAN_STRATEGY,
  ], [
    creators.minimum, creators.maximum, creators.videosPerCreator, slots.minimum, slots.maximum,
    contentDeck.topicCount, contentDeck.strategy,
  ]);
  assert.equal(contentDeck.topicCount, creators.videosPerCreator);
});

test("initial shape accepts 5-to-50 and 10-to-100 while rejecting off-profile creator and video counts", () => {
  assert.equal(isInitialCreatorCanaryShape({ creatorCount: 5, videosPerCreator: 10, slotCount: 50 }), true);
  assert.equal(isInitialCreatorCanaryShape({ creatorCount: 10, videosPerCreator: 10, slotCount: 100 }), true);
  for (const candidate of [
    { creatorCount: 4, videosPerCreator: 10, slotCount: 40 },
    { creatorCount: 11, videosPerCreator: 10, slotCount: 110 },
    { creatorCount: 5, videosPerCreator: 9, slotCount: 45 },
    { creatorCount: 5, videosPerCreator: 11, slotCount: 55 },
  ]) assert.equal(isInitialCreatorCanaryShape(candidate), false);
});

test("the launch profile does not redefine durable database capacity as a permanent platform cap", () => {
  const databaseModel = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");
  assert.match(databaseModel, /plannedSlotCount[\s\S]*BETWEEN 1 AND 100000/u);
  assert.equal(INITIAL_CREATOR_CANARY_PROFILE.slots.maximum, 100);
  assert.equal("platformCapacity" in INITIAL_CREATOR_CANARY_PROFILE, false);
  assert.equal("databaseCapacity" in INITIAL_CREATOR_CANARY_PROFILE, false);
});
