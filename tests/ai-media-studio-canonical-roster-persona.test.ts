import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalRosterPersona,
  repairCanonicalRosterPersona,
} from "../server/ai-media-studio/core/canonical-roster-persona";
import { createInfluencerRequestSchema } from "../shared/ai-media-studio-core";

function input(index = 1) {
  return {
    name: `Creator ${index}`,
    language: "es-US",
    accent: "Latino",
    gender: "unspecified" as const,
    avatarResourceId: `avatar-${index}`,
    voiceResourceId: `voice-${index}`,
  };
}

test("canonical roster personas satisfy the complete provider-neutral influencer contract", () => {
  const persona = buildCanonicalRosterPersona(input());

  assert.deepEqual(createInfluencerRequestSchema.parse(persona), persona);
  assert.equal(persona.status, "draft");
  assert.equal(persona.avatarResourceId, "avatar-1");
  assert.equal(persona.voiceResourceId, "voice-1");
  assert.ok(persona.personality.length > 0);
  assert.ok(persona.tone.length > 0);
  assert.ok(persona.categories.length > 0);
  assert.ok(persona.intro.trim().length > 0);
  assert.ok(persona.outro.trim().length > 0);
  assert.ok(persona.facialExpressions.length > 0);
  assert.ok(persona.brandColors.length > 0);
  assert.doesNotMatch(JSON.stringify(persona), /heygen/iu, "canonical persona output stays provider-neutral");
});

test("a five-member launch roster yields five deterministic valid personas for fifty planned slots", () => {
  const first = Array.from({ length: 5 }, (_, index) => buildCanonicalRosterPersona(input(index + 1)));
  const replay = Array.from({ length: 5 }, (_, index) => buildCanonicalRosterPersona(input(index + 1)));

  assert.deepEqual(replay, first);
  assert.equal(first.length * 10, 50);
  assert.equal(new Set(first.map((persona) => persona.avatarResourceId)).size, 5);
  assert.equal(new Set(first.map((persona) => persona.voiceResourceId)).size, 5);
  for (const persona of first) createInfluencerRequestSchema.parse(persona);
});

test("canonical roster persona construction fails closed for incomplete member data", () => {
  assert.throws(() => buildCanonicalRosterPersona({ ...input(), name: "" }));
  assert.throws(() => buildCanonicalRosterPersona({ ...input(), avatarResourceId: "" }));
  assert.throws(() => buildCanonicalRosterPersona({ ...input(), language: "x" }));
});

test("repair preserves valid editorial choices, repairs only invalid colors, and rebinds canonical resources", () => {
  const existing = {
    ...buildCanonicalRosterPersona(input()),
    name: "Editorial Creator",
    avatarResourceId: "old-valid-avatar",
    voiceResourceId: "old-valid-voice",
    personality: ["editorial-bold"],
    tone: ["editorial-premium"],
    speakingStyle: "Editorial custom delivery",
    categories: ["editorial-category"],
    intro: "Editorial intro",
    outro: "Editorial outro",
    energyLevel: 9,
    facialExpressions: ["editorial-expression"],
    brandColors: [],
    status: "active" as const,
  };

  const repaired = repairCanonicalRosterPersona(existing, input(2));
  assert.deepEqual(createInfluencerRequestSchema.parse(repaired), repaired);
  assert.equal(repaired.name, "Editorial Creator");
  assert.deepEqual(repaired.personality, ["editorial-bold"]);
  assert.deepEqual(repaired.tone, ["editorial-premium"]);
  assert.equal(repaired.speakingStyle, "Editorial custom delivery");
  assert.deepEqual(repaired.categories, ["editorial-category"]);
  assert.equal(repaired.intro, "Editorial intro");
  assert.equal(repaired.outro, "Editorial outro");
  assert.equal(repaired.energyLevel, 9);
  assert.deepEqual(repaired.facialExpressions, ["editorial-expression"]);
  assert.deepEqual(repaired.brandColors, ["#34D399"]);
  assert.equal(repaired.status, "active");
  assert.equal(repaired.avatarResourceId, "avatar-2");
  assert.equal(repaired.voiceResourceId, "voice-2");
});

test("repair never reactivates an archived editorial persona", () => {
  const existing = {
    ...buildCanonicalRosterPersona(input()),
    personality: ["archived-editorial"],
    brandColors: [],
    status: "archived" as const,
  };

  const repaired = repairCanonicalRosterPersona(existing, input(3));
  assert.equal(repaired.status, "archived");
  assert.deepEqual(repaired.personality, ["archived-editorial"]);
  assert.deepEqual(repaired.brandColors, ["#34D399"]);
  assert.equal(repaired.avatarResourceId, "avatar-3");
  assert.equal(repaired.voiceResourceId, "voice-3");
});
