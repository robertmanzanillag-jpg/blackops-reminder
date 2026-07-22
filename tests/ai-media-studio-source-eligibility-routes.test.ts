import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { sourceEligibilityReviewResponseSchema } from "../shared/ai-media-studio-source-eligibility";
import { InMemoryAnalyticsRepository } from "../server/ai-media-studio/analytics/in-memory-repository";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { OperationsRepositories } from "../server/ai-media-studio/operations-runtime";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { InMemoryPublishingRepository } from "../server/ai-media-studio/publishing/in-memory";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const origin = "https://studio.example:8443";
const hash = `sha256:${"a".repeat(64)}` as const;
const headers = {
  "content-type": "application/json",
  "x-test-user": "owner-a",
  origin,
  "sec-fetch-site": "same-origin",
};

function repositories(sources: InMemorySourceRepository): OperationsRepositories {
  return {
    publishing: new InMemoryPublishingRepository(),
    analytics: new InMemoryAnalyticsRepository(),
    sources,
  };
}

async function startHarness() {
  const previousFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const sources = new InMemorySourceRepository();
  const source = (await sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-1",
    category: "events",
    title: "Kong weekend",
    content: "Private owned details",
    contentHash: hash,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: { privateField: "never-return" },
  })).item;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  app.use(createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: origin,
    operations: { repositories: repositories(sources), runtimeEnvironment: "test" },
  }).router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/api/ai-media-studio/automation/sources/${source.id}/eligibility-review`,
    source,
    sources,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        if (previousFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
        else process.env.ALLOW_DEV_USER_FALLBACK = previousFallback;
      }
    },
  };
}

function raw(url: string, requestHeaders: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: requestHeaders }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("authenticated same-origin exact-content review exposes only the safe eligibility projection", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const body = JSON.stringify({
    decision: "approve", expectedContentHash: hash, idempotencyKey: "review-event-1", rightsStatus: "owned",
  });
  const response = await fetch(harness.url, { method: "POST", headers, body });
  assert.equal(response.status, 201);
  const text = await response.text();
  assert.doesNotMatch(text, /private-event|Private owned|privateField|never-return|actorUserId/u);
  const parsed = sourceEligibilityReviewResponseSchema.parse(JSON.parse(text));
  assert.equal(parsed.downstreamState, "eligible_for_script_batch");
  assert.equal(parsed.effects.scriptsGenerated, false);
  assert.ok(Object.entries(parsed.effects).every(([key, value]) => key === "sourceReviewPersisted" ? value : value === false));

  const replay = sourceEligibilityReviewResponseSchema.parse(await (await fetch(harness.url, {
    method: "POST", headers, body,
  })).json());
  assert.equal(replay.review.replayed, true);
  assert.deepEqual(await harness.sources.list({ ownerUserId: "owner-b", workspaceId: "personal" }), []);
});

test("auth, origin, JSON shape, query and transfer encoding fail before source mutation", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const body = JSON.stringify({
    decision: "approve", expectedContentHash: hash, idempotencyKey: "review-event-1", rightsStatus: "owned",
  });
  assert.equal((await fetch(harness.url, { method: "POST", headers: { ...headers, "x-test-user": "" }, body })).status, 401);
  assert.equal((await fetch(harness.url, { method: "POST", headers: { ...headers, origin: "https://attacker.example",
    "sec-fetch-site": "cross-site" }, body })).status, 403);
  assert.equal((await fetch(harness.url, { method: "POST", headers: { ...headers,
    "content-type": "application/x-www-form-urlencoded" }, body: "decision=approve" })).status, 415);
  assert.equal((await fetch(`${harness.url}?providerCursor=private`, { method: "POST", headers, body })).status, 400);
  assert.equal(await raw(harness.url, { ...headers, "transfer-encoding": "chunked" }, body), 400);
  assert.equal((await fetch(harness.url, { method: "POST", headers, body: JSON.stringify({
    decision: "approve", expectedContentHash: hash, idempotencyKey: "review-event-1", rightsStatus: "owned",
    providerExternalId: "private",
  }) })).status, 400);
  const stored = await harness.sources.get({ ownerUserId: "owner-a", workspaceId: "personal" }, harness.source.id);
  assert.deepEqual([stored?.status, stored?.rightsStatus, stored?.moderationStatus], ["discovered", "unknown", "pending"]);
});

test("stale content and cross-tenant source IDs fail closed with stable responses", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const stale = await fetch(harness.url, { method: "POST", headers, body: JSON.stringify({
    decision: "approve", expectedContentHash: `sha256:${"b".repeat(64)}`,
    idempotencyKey: "review-event-1", rightsStatus: "owned",
  }) });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: "Source content changed; review the current version", code: "SOURCE_REFRESHED" });
  const otherTenant = await fetch(harness.url, { method: "POST", headers: { ...headers, "x-test-user": "owner-b" }, body: JSON.stringify({
    decision: "approve", expectedContentHash: hash, idempotencyKey: "review-event-1", rightsStatus: "owned",
  }) });
  assert.equal(otherTenant.status, 404);
  assert.deepEqual(await otherTenant.json(), { error: "Source item not found", code: "NOT_FOUND" });
});
