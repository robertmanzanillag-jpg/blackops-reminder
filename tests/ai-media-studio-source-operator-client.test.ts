import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { operationsApi } from "../client/src/features/ai-media-studio/operations/api.ts";
import { createSourceActionIdempotencyKey } from "../client/src/features/ai-media-studio/operations/types.ts";

const operationsRoot = resolve(process.cwd(), "client/src/features/ai-media-studio/operations");
const readOperationsSource = (name: string) => readFile(resolve(operationsRoot, name), "utf8");
const hash = `sha256:${"a".repeat(64)}`;

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

test("operator UI gates explicit decisions and exposes only compact preview fields", async () => {
  const api = await readOperationsSource("api.ts");
  const automation = await readOperationsSource("automation.tsx");
  const hooks = await readOperationsSource("hooks.ts");
  assert.match(automation, /source\.status === "discovered" && source\.rightsStatus === "unknown" && source\.moderationStatus === "pending"/);
  assert.match(automation, /source\.status === "accepted" && \(source\.rightsStatus === "owned" \|\| source\.rightsStatus === "licensed"\) && source\.moderationStatus === "approved"/);
  for (const label of ["Approve owned", "Approve licensed", "Reject source", "Preview script"]) assert.match(automation, new RegExp(label));
  for (const field of ["firstVariant.title", "firstVariant.hook", "firstVariant.caption"]) assert.match(automation, new RegExp(field.replace(".", "\\.")));
  assert.doesNotMatch(automation, /firstVariant\.script|providerExternalId|providerAccountId|secretRef/);
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
});

test("client-generated action keys are bounded, canonical and stable across exact retries", () => {
  const first = createSourceActionIdempotencyKey("owned", "source-1", hash);
  const second = createSourceActionIdempotencyKey("owned", "source-1", hash);
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  assert.ok(first.length <= 128);
  assert.equal(first, second);
  assert.notEqual(first, createSourceActionIdempotencyKey("licensed", "source-1", hash));
  assert.notEqual(first, createSourceActionIdempotencyKey("owned", "source-2", hash));
});
