import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { SandboxReadinessRepository } from "../server/ai-media-studio/planning/sandbox-readiness-contracts";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { planId, sandboxPacket, slotId } from "./helpers/ai-media-studio-sandbox-readiness-fixture";

async function getWithBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "x-test-user": "owner-a", "content-type": "application/json",
      "content-length": "2" } }, (res) => { res.resume(); res.once("end", () => resolve(res.statusCode ?? 0)); });
    req.once("error", reject); req.end("{}");
  });
}

async function harness(repository?: SandboxReadinessRepository, production = false) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK; process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const runtime = createAiMediaStudioRuntime(repository ? {
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()], defaultProviderKey: "fake",
    runtimeEnvironment: "test", sandboxReadinessRepository: repository, operations: { runtimeEnvironment: "test" },
  } : { runtimeEnvironment: production ? "production" : "test", databaseUrl: "", operations: { runtimeEnvironment: "test" } });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("GET is authenticated, tenant-scoped, no-store, bodyless, and redacted", async (t) => {
  const calls: unknown[] = [];
  const server = await harness({ observe: async (...args) => { calls.push(args); return sandboxPacket(); } }); t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/sandbox-readiness/${slotId}`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-user": "owner-a" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /providerAccountId|credentialVersion|secretRef|externalResourceId|avatarId|voiceId|native/iu);
  assert.deepEqual(calls, [[{ ownerUserId: "owner-a", workspaceId: "personal" }, planId, slotId]]);
  assert.equal(await getWithBody(url), 400);
  assert.equal((await fetch(`${url}?providerAccountId=private`, { headers: { "x-test-user": "owner-a" } })).status, 400);
});

test("route safely maps missing, malformed, and unavailable observations", async (t) => {
  const missing = await harness({ observe: async () => undefined }); t.after(missing.close);
  const base = `${missing.base}/api/ai-media-studio/production-batches/${planId}/sandbox-readiness/${slotId}`;
  assert.equal((await fetch(base, { headers: { "x-test-user": "owner-a" } })).status, 404);
  assert.equal((await fetch(`${missing.base}/api/ai-media-studio/production-batches/bad/sandbox-readiness/${slotId}`,
    { headers: { "x-test-user": "owner-a" } })).status, 400);
  const unavailable = await harness(undefined, true); t.after(unavailable.close);
  assert.equal((await fetch(`${unavailable.base}/api/ai-media-studio/production-batches/${planId}/sandbox-readiness/${slotId}`,
    { headers: { "x-test-user": "owner-a" } })).status, 503);
});
