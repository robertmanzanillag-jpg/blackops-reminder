import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { launchPreflightGateCodes, launchPreflightSchema } from "../shared/ai-media-studio-launch-preflight";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import type { LaunchPreflightRepository } from "../server/ai-media-studio/planning/launch-preflight-contracts";

const planId = `plan_${"a".repeat(24)}`;
function report() {
  return launchPreflightSchema.parse({ version: 1, source: "derived_read_only",
    subject: { planId, batchId: `batch_${"b".repeat(24)}`, avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: 50 },
    observedAt: "2026-07-22T00:00:00.000Z", status: "blocked", canGenerate: false,
    sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true, authoritativeForAdmission: false,
    effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
      renderCreated: false, outboxCreated: false, providerCalled: false },
    summary: { totalGates: 14, passedGates: 0, blockedGates: 14, pendingExternalGates: 0,
      pendingHumanGates: 0, unavailableGates: 0, readySlots: 0, requiredSlots: 50 },
    gates: launchPreflightGateCodes.map((code) => ({ code, state: "blocked", readySlots: 0, requiredSlots: 50,
      reasonCode: "observation_unavailable", nextActionCode: "retry_observation" })) });
}

async function harness(repository?: LaunchPreflightRepository, production = false) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK; process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user"); if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const runtime = createAiMediaStudioRuntime(repository ? {
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()], defaultProviderKey: "fake",
    runtimeEnvironment: "test", launchPreflightRepository: repository, operations: { runtimeEnvironment: "test" },
  } : { runtimeEnvironment: production ? "production" : "test", databaseUrl: "", operations: { runtimeEnvironment: "test" } });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("GET preflight is authenticated, tenant-scoped, no-store, provider-neutral and has no request body", async (t) => {
  const calls: unknown[] = [];
  const server = await harness({ observe: async (...args) => { calls.push(args); return report(); } }); t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/launch-preflight`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-user": "owner-a" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /providerAccountId|credentialVersion|secretRef|externalResourceId|native|authorityDigest|UUID/iu);
  assert.deepEqual(calls, [[{ ownerUserId: "owner-a", workspaceId: "personal" }, planId]]);
});

test("preflight returns indistinguishable 404 and generic 503 when durable observation is unavailable", async (t) => {
  const missing = await harness({ observe: async () => undefined }); t.after(missing.close);
  const missingResponse = await fetch(`${missing.base}/api/ai-media-studio/production-batches/${planId}/launch-preflight`,
    { headers: { "x-test-user": "owner-a" } });
  assert.equal(missingResponse.status, 404); assert.equal(missingResponse.headers.get("cache-control"), "private, no-store");
  const unavailable = await harness(undefined, true); t.after(unavailable.close);
  const unavailableResponse = await fetch(`${unavailable.base}/api/ai-media-studio/production-batches/${planId}/launch-preflight`,
    { headers: { "x-test-user": "owner-a" } });
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), { error: "AI Media Studio launch preflight persistence unavailable", code: "persistence_unavailable" });
});
