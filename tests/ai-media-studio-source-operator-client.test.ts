import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { OperationsApiError, operationsApi } from "../client/src/features/ai-media-studio/operations/api.ts";
import {
  createReusableScriptSaveIdempotencyKey,
  createSourceActionIdempotencyKey,
} from "../client/src/features/ai-media-studio/operations/types.ts";

const operationsRoot = resolve(process.cwd(), "client/src/features/ai-media-studio/operations");
const readOperationsSource = (name: string) => readFile(resolve(operationsRoot, name), "utf8");
const hash = `sha256:${"a".repeat(64)}`;
const previewHash = `sha256:${"b".repeat(64)}`;
const assetId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";

const reusableAsset = {
  id: assetId,
  title: "Weekend guide",
  source: { id: "source-1", category: "events", contentHash: hash },
  language: "en",
  status: "draft",
  currentVariantId: variantId,
  variants: [{
    id: variantId,
    version: 1,
    angle: "hidden gem",
    title: "Weekend guide",
    hook: "Start here",
    script: "Safe reusable script",
    cta: "Plan now",
    caption: "A safe caption",
    hashtags: ["#Kong"],
    seoKeywords: ["weekend"],
    checksum: hash,
  }],
  createdAt: "2026-07-22T12:00:00.000Z",
  updatedAt: "2026-07-22T12:00:00.000Z",
};

test("source review client sends the exact content identity and no private or downstream fields", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    captured = { input: String(input), init };
    return new Response(JSON.stringify({
      source: { id: "source-1", category: "events", contentHash: hash, status: "accepted", rightsStatus: "owned", moderationStatus: "approved", updatedAt: "2026-07-22T12:00:00.000Z" },
      review: { decision: "approve", replayed: false, reviewedAt: "2026-07-22T12:00:00.000Z" },
      downstreamState: "eligible_for_script_batch",
      effects: { sourceReviewPersisted: true, scriptsGenerated: false, renderQueued: false, outboxCreated: false, videoProviderCalled: false, secretResolved: false, spendCommitted: false, publishingCreated: false, migrationApplied: false, deploymentPerformed: false },
    }), { status: 201 });
  }) as typeof fetch;
  try {
    await operationsApi.reviewSourceEligibility({ sourceItemId: "source-1", decision: "approve", expectedContentHash: hash, idempotencyKey: "review-click-1", rightsStatus: "owned" });
    assert.equal(captured?.input, "/api/ai-media-studio/automation/sources/source-1/eligibility-review");
    assert.equal(captured?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), { decision: "approve", expectedContentHash: hash, idempotencyKey: "review-click-1", rightsStatus: "owned" });
    assert.doesNotMatch(String(captured?.init?.body), /provider|secret|render|spend|publish/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("script preview client stays deterministic and validates the redacted public projection", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    captured = { input: String(input), init };
    const variant = { id: "variant-1", angle: "hidden gem", title: "Weekend guide", hook: "Start here", script: "Safe script", cta: "Plan now", caption: "A safe caption", hashtags: ["#Kong"], seoKeywords: ["weekend"] };
    return new Response(JSON.stringify({
      source: { id: "source-1", category: "events", title: "Weekend guide", contentHash: hash, status: "accepted", rightsStatus: "owned", moderationStatus: "approved" },
      scriptSet: { ...variant, id: "script-set-1", source: { type: "events", id: "source-1", title: "Weekend guide" }, language: "en", variants: [variant] },
      previewDigest: hash,
      downstreamState: "blocked_before_render_admission",
      generation: { mode: "deterministic", estimatedCostUsd: 0, generatedAt: "2026-07-22T12:00:00.000Z" },
      effects: { sourceRead: true, scriptPreviewGenerated: true, scriptPersisted: false, orchestrationRunCreated: false, renderQueued: false, outboxCreated: false, videoProviderCalled: false, secretResolved: false, spendCommitted: false, publishingCreated: false, migrationApplied: false, deploymentPerformed: false },
    }));
  }) as typeof fetch;
  try {
    const result = await operationsApi.previewSourceScript({ sourceItemId: "source-1", idempotencyKey: "preview-click-1", language: "en", variantCount: 3 });
    assert.equal(captured?.input, "/api/ai-media-studio/automation/sources/scripts/preview");
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), { sourceItemId: "source-1", idempotencyKey: "preview-click-1", language: "en", variantCount: 3 });
    assert.equal(result.downstreamState, "blocked_before_render_admission");
    assert.equal(result.generation.estimatedCostUsd, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source clients reject provider-bearing responses instead of exposing them to the operator", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    source: { id: "source-1", category: "events", contentHash: hash, status: "accepted", rightsStatus: "owned", moderationStatus: "approved", updatedAt: "2026-07-22T12:00:00.000Z", providerExternalId: "private-id" },
    review: { decision: "approve", replayed: false, reviewedAt: "2026-07-22T12:00:00.000Z" },
    downstreamState: "eligible_for_script_batch",
    effects: { sourceReviewPersisted: true, scriptsGenerated: false, renderQueued: false, outboxCreated: false, videoProviderCalled: false, secretResolved: false, spendCommitted: false, publishingCreated: false, migrationApplied: false, deploymentPerformed: false },
  }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(operationsApi.reviewSourceEligibility({
      sourceItemId: "source-1",
      decision: "approve",
      expectedContentHash: hash,
      idempotencyKey: "review-click-private-response",
      rightsStatus: "owned",
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reusable script client saves only preview identity and loads the tenant catalog", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    captured.push({ input: String(input), init });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        asset: reusableAsset,
        replayed: false,
        downstreamState: "blocked_before_render_admission",
        effects: { sourceRead: true, scriptPreviewGenerated: true, scriptPersisted: true, orchestrationRunCreated: false, renderQueued: false, outboxCreated: false, videoProviderCalled: false, secretResolved: false, spendCommitted: false, publishingCreated: false, migrationApplied: false, deploymentPerformed: false },
      }), { status: 201 });
    }
    return new Response(JSON.stringify({ items: [reusableAsset], nextCursor: null, hasMore: false }));
  }) as typeof fetch;
  try {
    const previewRequest = { sourceItemId: "source-1", idempotencyKey: "preview-click-1", language: "en", variantCount: 3 };
    const saveIdempotencyKey = createReusableScriptSaveIdempotencyKey("source-1", hash, previewHash, "variant-1");
    const saved = await operationsApi.saveReusableScriptAsset({
      previewRequest,
      expectedSourceContentHash: hash,
      expectedPreviewDigest: previewHash,
      selectedVariantId: "variant-1",
      saveIdempotencyKey,
    });
    const listed = await operationsApi.reusableScriptAssets({ status: "draft", limit: 10 });
    assert.equal(captured[0]?.input, "/api/ai-media-studio/automation/sources/scripts/assets");
    assert.equal(captured[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(captured[0]?.init?.body)), {
      previewRequest,
      expectedSourceContentHash: hash,
      expectedPreviewDigest: previewHash,
      selectedVariantId: "variant-1",
      saveIdempotencyKey,
    });
    assert.doesNotMatch(String(captured[0]?.init?.body), /"script"|"hook"|"cta"|"caption"|provider|secret|render|spend|publish/iu);
    assert.equal(captured[1]?.input, "/api/ai-media-studio/automation/sources/scripts/assets?status=draft&limit=10");
    assert.equal(saved.asset.id, assetId);
    assert.equal(listed.items[0]?.variants[0]?.script, "Safe reusable script");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reusable script client preserves bounded status and code for stale-preview recovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: "Preview no longer matches the source",
    code: "PREVIEW_STALE",
  }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(
      operationsApi.saveReusableScriptAsset({
        previewRequest: { sourceItemId: "source-1", idempotencyKey: "preview-click-1", language: "en", variantCount: 3 },
        expectedSourceContentHash: hash,
        expectedPreviewDigest: previewHash,
        selectedVariantId: "variant-1",
        saveIdempotencyKey: "save-click-1",
      }),
      (error: unknown) => error instanceof OperationsApiError
        && error.status === 409
        && error.code === "PREVIEW_STALE"
        && error.message === "Preview no longer matches the source",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operator UI gates decisions, reviews every complete variant, and saves explicitly", async () => {
  const api = await readOperationsSource("api.ts");
  const automation = await readOperationsSource("automation.tsx");
  const hooks = await readOperationsSource("hooks.ts");
  assert.match(automation, /source\.status === "discovered" && source\.rightsStatus === "unknown" && source\.moderationStatus === "pending"/);
  assert.match(automation, /\(source\.status === "accepted" \|\| source\.status === "ready"\) && \(source\.rightsStatus === "owned" \|\| source\.rightsStatus === "licensed"\) && source\.moderationStatus === "approved"/);
  for (const label of ["Approve owned", "Approve licensed", "Reject source", "Preview script"]) assert.match(automation, new RegExp(label));
  for (const field of ["variant.title", "variant.hook", "variant.script", "variant.cta", "variant.caption"]) assert.match(automation, new RegExp(field.replace(".", "\\.")));
  assert.match(automation, /<fieldset/);
  assert.match(automation, /type="radio"/);
  assert.match(automation, /Save reusable draft — no credits/);
  assert.match(automation, /disabled=\{!selectedVariantId \|\| saving\}/);
  assert.match(automation, /aria-live="polite"/);
  assert.match(automation, /Saved scripts/);
  assert.match(automation, /Load more saved scripts/);
  assert.match(automation, /PREVIEW_STALE/);
  assert.ok(
    automation.lastIndexOf("{saveErrors[source.id] &&") > automation.lastIndexOf("</article>}"),
    "stale-save alert must remain visible after the preview is cleared",
  );
  assert.doesNotMatch(automation, /providerExternalId|providerAccountId|secretRef/);
  assert.match(automation, /role="alert"/);
  assert.match(automation, /aria-label=/);
  assert.match(hooks, /invalidateQueries/);
  assert.match(hooks, /"sources"/);
  assert.match(api, /post<unknown>\("\/automation\/sources\/production-batch\/prepare", \{\}\)/);
  assert.match(api, /sourceToBatchAutomationResponseSchema\.parse/);
  assert.match(automation, /Prepare durable batch — no credits/);
  assert.match(automation, /disabled=\{prepareBatch\.isPending\}/);
  assert.match(automation, /render, HeyGen, spend and publishing stay blocked/);
  assert.match(hooks, /"core", "production-batch"/);
  assert.match(hooks, /"reusable-scripts"/);
  assert.match(hooks, /saveReusableScriptAsset/);
  assert.match(api, /reusableScriptAssetSaveResponseSchema\.parse/);
  assert.match(api, /reusableScriptAssetListResponseSchema\.parse/);
});

test("client-generated action keys are bounded, canonical and stable across exact retries", () => {
  const first = createSourceActionIdempotencyKey("owned", "source-1", hash);
  const second = createSourceActionIdempotencyKey("owned", "source-1", hash);
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  assert.ok(first.length <= 128);
  assert.equal(first, second);
  assert.notEqual(first, createSourceActionIdempotencyKey("licensed", "source-1", hash));
  assert.notEqual(first, createSourceActionIdempotencyKey("owned", "source-2", hash));

  const save = createReusableScriptSaveIdempotencyKey("source-1", hash, previewHash, "variant-1");
  assert.match(save, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  assert.ok(save.length <= 128);
  assert.equal(save, createReusableScriptSaveIdempotencyKey("source-1", hash, previewHash, "variant-1"));
  assert.notEqual(save, createReusableScriptSaveIdempotencyKey("source-1", hash, previewHash, "variant-2"));
});
