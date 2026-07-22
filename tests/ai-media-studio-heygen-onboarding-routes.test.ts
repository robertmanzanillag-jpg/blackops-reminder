import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import type { HeyGenOnboardingReadinessRepository } from "../server/ai-media-studio/providers/heygen-onboarding-readiness";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

const observation = {
  observedAt: "2026-07-22T12:00:00.000Z",
  accounts: [{ id: "10000000-0000-4000-8000-000000000001", status: "disconnected", credentialStatus: "unverified", credentialVersion: 1, credentialSource: "static_api_key" }],
  plans: [],
} as const;

async function getWithBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "x-test-user": "owner-a", "content-type": "application/json", "content-length": "2" } }, (res) => {
      res.resume(); res.once("end", () => resolve(res.statusCode ?? 0));
    });
    req.once("error", reject); req.end("{}");
  });
}

async function harness(repository?: HeyGenOnboardingReadinessRepository, production = false) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id };
    next();
  });
  const runtime = createAiMediaStudioRuntime(repository ? {
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()], defaultProviderKey: "fake",
    runtimeEnvironment: "test", heyGenOnboardingReadinessRepository: repository,
    operations: { runtimeEnvironment: "test" },
  } : { runtimeEnvironment: production ? "production" : "test", databaseUrl: "", operations: { runtimeEnvironment: "test" } });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("onboarding GET is authenticated, tenant scoped, no-store, bodyless, queryless, and redacted", async (t) => {
  const calls: unknown[] = [];
  const server = await harness({ observe: async (...args) => { calls.push(args); return observation; } });
  t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/provider-configurations/heygen/onboarding-readiness`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-user": "owner-a" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /apiKey|secretRef|token|providerAccountId|credentialVersion|avatarId|voiceId|externalResourceId/iu);
  assert.deepEqual(calls, [[{ ownerUserId: "owner-a", workspaceId: "personal" }]]);
  assert.equal(await getWithBody(url), 400);
  assert.equal((await fetch(`${url}?secretRef=private`, { headers: { "x-test-user": "owner-a" } })).status, 400);
});

test("onboarding route fails closed when durable readiness is unavailable", async (t) => {
  const server = await harness(undefined, true); t.after(server.close);
  const response = await fetch(`${server.base}/api/ai-media-studio/provider-configurations/heygen/onboarding-readiness`, { headers: { "x-test-user": "owner-a" } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "HeyGen onboarding readiness persistence unavailable",
    code: "persistence_unavailable",
  });
});
