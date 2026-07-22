import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceScriptPreviewRequestSchema,
  sourceScriptPreviewResponseSchema,
} from "../shared/ai-media-studio-source-to-script";

test("source-to-script preview request accepts only source IDs and bounded script options", () => {
  const parsed = sourceScriptPreviewRequestSchema.parse({
    sourceItemId: "source_abc123",
    idempotencyKey: "source-script-preview-001",
  });
  assert.equal(parsed.language, "en");
  assert.equal(parsed.variantCount, 3);

  for (const body of [
    { sourceItemId: "source_abc123", idempotencyKey: "source-script-preview-001", providerExternalId: "private" },
    { sourceItemId: "source_abc123", idempotencyKey: "source-script-preview-001", source: { content: "client supplied" } },
    { sourceItemId: "source_abc123", idempotencyKey: "source-script-preview-001", variantCount: 6 },
    { sourceItemId: "source_abc123", idempotencyKey: "source-script-preview-001", cursor: "provider-cursor" },
  ]) {
    assert.equal(sourceScriptPreviewRequestSchema.safeParse(body).success, false);
  }
});

test("source-to-script preview response is provider-neutral and blocks every downstream effect", () => {
  const variant = {
    id: "variant_abc123",
    angle: "Hidden gem",
    title: "Hidden gem: Weekend guide",
    hook: "Hidden gem: Weekend guide.",
    script: "Hidden gem: Weekend guide. Owned details. Save this for your next visit.",
    cta: "Save this and follow Kong for more recommendations.",
    caption: "Weekend guide. Owned details.",
    hashtags: ["#Weekendguide", "#events", "#KongMedia"],
    seoKeywords: ["Weekend guide", "events"],
  };
  const parsed = sourceScriptPreviewResponseSchema.parse({
    source: {
      id: "source_abc123",
      category: "events",
      title: "Weekend guide",
      contentHash: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      rightsStatus: "owned",
      moderationStatus: "approved",
    },
    scriptSet: {
      ...variant,
      id: "scriptset_abc123",
      source: { type: "events", id: "source_abc123", title: "Weekend guide" },
      language: "en",
      variants: [variant],
    },
    previewDigest: `sha256:${"b".repeat(64)}`,
    downstreamState: "blocked_before_render_admission",
    generation: { mode: "deterministic", estimatedCostUsd: 0, generatedAt: "2026-07-22T15:00:00.000Z" },
    effects: {
      sourceRead: true,
      scriptPreviewGenerated: true,
      scriptPersisted: false,
      orchestrationRunCreated: false,
      renderQueued: false,
      outboxCreated: false,
      videoProviderCalled: false,
      secretResolved: false,
      spendCommitted: false,
      publishingCreated: false,
      migrationApplied: false,
      deploymentPerformed: false,
    },
  });
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /providerExternalId|providerAccountId|secretRef|cursor|HEYGEN_API_KEY/u);
  assert.equal(parsed.effects.sourceRead, true);
  assert.ok(Object.entries(parsed.effects).every(([key, value]) =>
    key === "sourceRead" || key === "scriptPreviewGenerated" ? value === true : value === false));
});

test("source-to-script preview response rejects sources that are not rights and moderation approved", () => {
  const base = {
    id: "source_abc123",
    category: "events",
    title: "Weekend guide",
    contentHash: `sha256:${"a".repeat(64)}`,
    status: "accepted",
    rightsStatus: "owned",
    moderationStatus: "approved",
  };
  for (const source of [
    { ...base, rightsStatus: "unknown" },
    { ...base, rightsStatus: "restricted" },
    { ...base, moderationStatus: "pending" },
    { ...base, status: "discovered" },
  ]) {
    assert.equal(sourceScriptPreviewResponseSchema.shape.source.safeParse(source).success, false);
  }
});
