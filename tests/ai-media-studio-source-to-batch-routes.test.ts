import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { sourceToBatchAutomationResponseSchema } from "../shared/ai-media-studio-source-to-batch";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { ProductionBatchRepository } from "../server/ai-media-studio/production-batches/contracts";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

const canonicalOrigin = "https://studio.example:8443";
const endpoint = "/api/ai-media-studio/automation/sources/production-batch/prepare";
const key = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;

function batch(status: "not_started" | "draft_ready"): ProductionBatch {
  const prepared = status === "draft_ready";
  return {
    batchId: key("batch", prepared ? 2 : 1), planId: key("plan", 3), status,
    avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: 50,
    canGenerate: false, noSpend: true,
    preparedAt: prepared ? "2026-07-22T12:00:00.000Z" : null,
    approvedAt: null,
    blockers: [prepared ? "script_approval_required" : "script_batch_required",
      "governance_approval_required", "budget_reservation_required",
      "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, member) => ({
      memberId: key("member", member + 1), creatorName: `Creator ${member + 1}`,
      items: Array.from({ length: 10 }, (_, video) => ({
        slotId: key("slot", member * 10 + video + 1), videoNumber: video + 1,
        ...(prepared ? {
          preparation: "draft" as const,
          source: { title: `Kong source ${video + 1}`, category: "events" as const },
          script: {
            key: key("script", member * 10 + video + 1), title: `Video ${video + 1}`,
            status: "draft" as const, variantCount: 3,
            selectedVariant: {
              title: `Video ${video + 1}`, angle: "hidden gem", hook: "Start here",
              script: "Safe deterministic draft", cta: "Plan now", caption: "A safe caption",
              hashtags: ["#Kong"], seoKeywords: ["weekend"],
            },
          },
        } : { preparation: "pending" as const, source: null, script: null }),
      })),
    })),
  };
}

async function harness(initial: "not_started" | "draft_ready") {
  const previousFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  let current = batch(initial);
  const calls: string[] = [];
  const repository: ProductionBatchRepository = {
    async getCurrent(scope) { calls.push(`current:${scope.ownerUserId}:${scope.workspaceId}`); return current; },
    async prepare(input) {
      calls.push(`prepare:${input.sourceAdapterKey ?? "any"}`);
      assert.equal(input.sourceAdapterKey, "kong-owned-catalog");
      current = batch("draft_ready");
      return current;
    },
    async approve() { throw new Error("approval is outside this route"); },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake", runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: canonicalOrigin,
    productionBatchRepository: repository,
    operations: { runtimeEnvironment: "test" },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, calls,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
      else process.env.ALLOW_DEV_USER_FALLBACK = previousFallback;
    },
  };
}

const headers = {
  "content-type": "application/json",
  "x-test-user": "owner-a",
  origin: canonicalOrigin,
  "sec-fetch-site": "same-origin",
};

test("source-to-batch route persists deterministic drafts only from the server-owned Kong adapter", async (t) => {
  const server = await harness("not_started"); t.after(server.close);
  const response = await fetch(`${server.baseUrl}${endpoint}`, { method: "POST", headers, body: "{}" });
  assert.equal(response.status, 201);
  const text = await response.text();
  assert.doesNotMatch(text, /providerExternalId|contentHash|apiKey|secretRef|avatarId|voiceId/iu);
  const parsed = sourceToBatchAutomationResponseSchema.parse(JSON.parse(text));
  assert.equal(parsed.outcome, "prepared");
  assert.equal(parsed.batch.plannedVideoCount, 50);
  assert.equal(parsed.batch.canGenerate, false);
  assert.equal(parsed.batch.noSpend, true);
  assert.deepEqual(server.calls, ["current:owner-a:personal", "prepare:kong-owned-catalog"]);
});

test("source-to-batch route is replay-safe and rejects unauthenticated, cross-site and client-selected input", async (t) => {
  const server = await harness("draft_ready"); t.after(server.close);
  assert.equal((await fetch(`${server.baseUrl}${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  })).status, 401);
  assert.equal((await fetch(`${server.baseUrl}${endpoint}`, {
    method: "POST", headers: { ...headers, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}",
  })).status, 403);
  const { origin: _missingOrigin, ...headersWithoutOrigin } = headers;
  assert.equal((await fetch(`${server.baseUrl}${endpoint}`, {
    method: "POST", headers: headersWithoutOrigin, body: "{}",
  })).status, 403);
  assert.equal((await fetch(`${server.baseUrl}${endpoint}`, {
    method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}",
  })).status, 415);
  assert.equal((await fetch(`${server.baseUrl}${endpoint}?planId=${key("plan", 3)}`, {
    method: "POST", headers, body: "{}",
  })).status, 400);
  for (const rawQuery of ["?__proto__", "?toString"]) {
    assert.equal((await fetch(`${server.baseUrl}${endpoint}${rawQuery}`, {
      method: "POST", headers, body: "{}",
    })).status, 400, "any raw query delimiter must be rejected");
  }
  assert.equal((await fetch(`${server.baseUrl}${endpoint}`, {
    method: "POST", headers, body: JSON.stringify({ sourceIds: ["private"] }),
  })).status, 400);
  const replay = await fetch(`${server.baseUrl}${endpoint}`, { method: "POST", headers, body: "{}" });
  assert.equal(replay.status, 200);
  const parsed = sourceToBatchAutomationResponseSchema.parse(await replay.json());
  assert.equal(parsed.outcome, "already_prepared");
  assert.equal(parsed.effects.scriptsPersisted, false);
  assert.equal(parsed.effects.videoProviderCalled, false);
  assert.equal(parsed.effects.spendCommitted, false);
  assert.deepEqual(server.calls, ["current:owner-a:personal"]);
});
