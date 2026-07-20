import assert from "node:assert/strict";
import test from "node:test";
import {
  generateScriptVariantsRequestSchema,
  generateScriptVariantsResponseSchema,
  mediaSourceTypeSchema,
} from "../shared/ai-media-studio-scripts";

const sourceTypes = [
  "events",
  "restaurants",
  "hotels",
  "nightclubs",
  "deals",
  "travel_packages",
  "beach_clubs",
  "experiences",
] as const;

test("accepts every supported Kong media source type", () => {
  for (const type of sourceTypes) assert.equal(mediaSourceTypeSchema.parse(type), type);
});

test("normalizes a bounded snapshot and defaults to three variants", () => {
  const parsed = generateScriptVariantsRequestSchema.parse({
    source: {
      type: "events",
      id: "event-123",
      title: "Miami Rooftop Weekend",
      summary: "A public weekend event with live music and food.",
      facts: ["Doors open at 6 PM", "Reservation required"],
    },
    language: "en",
  });

  assert.equal(parsed.variantCount, 3);
  assert.equal(parsed.source.type, "events");
});

test("rejects unsupported sources and unbounded variant requests", () => {
  const base = {
    source: { type: "events", id: "event-123", title: "Title", summary: "Summary" },
    language: "en",
  };
  assert.equal(generateScriptVariantsRequestSchema.safeParse({ ...base, source: { ...base.source, type: "customers" } }).success, false);
  assert.equal(generateScriptVariantsRequestSchema.safeParse({ ...base, variantCount: 6 }).success, false);
});

test("validates the complete creative response without provider details", () => {
  const variant = {
    id: "variant-hidden-gem",
    angle: "Hidden Gem",
    title: "A Miami rooftop worth finding",
    hook: "You probably walked past this place.",
    script: "Here is the rooftop experience to save for this weekend.",
    cta: "Save this and share it with your weekend crew.",
    caption: "A rooftop plan for this weekend.",
    hashtags: ["Miami", "WeekendPlans"],
    seoKeywords: ["Miami rooftop", "Miami weekend events"],
  };
  const parsed = generateScriptVariantsResponseSchema.parse({
    scriptSet: {
      ...variant,
      id: "script-set-123",
      source: { type: "events", id: "event-123", title: "Miami Rooftop Weekend" },
      language: "en",
      variants: [variant],
    },
    generation: {
      mode: "deterministic",
      estimatedCostUsd: 0,
      generatedAt: "2026-07-20T20:00:00.000Z",
    },
  });

  assert.equal(parsed.generation.mode, "deterministic");
  assert.equal("providerKey" in parsed.generation, false);
});
