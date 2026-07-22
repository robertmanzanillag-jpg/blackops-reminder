import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { ProductionBatchRepository } from "../server/ai-media-studio/production-batches/contracts";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";

const publicKey = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;
function pendingBatch(): ProductionBatch {
  return {
    batchId: publicKey("batch", 1), planId: publicKey("plan", 2), status: "not_started", avatarCount: 5,
    videosPerAvatar: 10, plannedVideoCount: 50, canGenerate: false, noSpend: true, preparedAt: null, approvedAt: null,
    blockers: ["script_batch_required", "governance_approval_required", "budget_reservation_required",
      "sandbox_generation_required", "human_launch_approval_required"],
    groups: Array.from({ length: 5 }, (_, member) => ({ memberId: publicKey("member", member + 10), creatorName: `Creator ${member + 1}`,
      items: Array.from({ length: 10 }, (_, video) => ({ slotId: publicKey("slot", member * 10 + video + 100), videoNumber: video + 1,
        preparation: "pending" as const, source: null, script: null })) })),
  };
}

async function harness(repository?: ProductionBatchRepository) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user"); if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const runtime = createAiMediaStudioRuntime(repository ? {
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()], defaultProviderKey: "fake",
    runtimeEnvironment: "test", productionBatchRepository: repository, operations: { runtimeEnvironment: "test" },
  } : { runtimeEnvironment: "production", databaseUrl: "" });
  app.use(runtime.router);
  const server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("production batch routes are authenticated, strict, tenant scoped and provider-neutral", async (t) => {
  const calls: unknown[] = [];
  const repository: ProductionBatchRepository = {
    getCurrent: async (scope) => { calls.push(["get", scope]); return pendingBatch(); },
    prepare: async (input) => { calls.push(["prepare", input.scope, input.planId, input.idempotencyKey, input.variantCount]); return pendingBatch(); },
    approve: async (input) => { calls.push(["approve", input.scope, input.planId, input.idempotencyKey, input.expectedBatchId]); return pendingBatch(); },
  };
  const server = await harness(repository); t.after(server.close);
  const endpoint = `${server.baseUrl}/api/ai-media-studio/production-batches/current`;
  assert.equal((await fetch(endpoint)).status, 401);
  const current = await fetch(endpoint, { headers: { "x-test-user": "user-a" } });
  assert.equal(current.status, 200);
  assert.doesNotMatch(await current.text(), /providerAccountId|avatarId|voiceId|sourceId|contentHash|native/iu);
  const prepare = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/prepare-scripts`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "user-a" },
    body: JSON.stringify({ idempotencyKey: "prepare-batch-1", variantCount: 2 }),
  });
  assert.equal(prepare.status, 200);
  assert.deepEqual(calls[1], ["prepare", { ownerUserId: "user-a", workspaceId: "personal" }, publicKey("plan", 2), "prepare-batch-1", 2]);
  const spoofed = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/prepare-scripts`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "user-a" },
    body: JSON.stringify({ idempotencyKey: "prepare-batch-2", sourceIds: ["private"] }),
  });
  assert.equal(spoofed.status, 400);
  assert.equal(calls.length, 2);

  const approve = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/approve-scripts`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "user-a" },
    body: JSON.stringify({ idempotencyKey: "approve-batch-1", expectedBatchId: publicKey("batch", 1) }),
  });
  assert.equal(approve.status, 200);
  assert.deepEqual(calls[2], ["approve", { ownerUserId: "user-a", workspaceId: "personal" }, publicKey("plan", 2),
    "approve-batch-1", publicKey("batch", 1)]);
  const unsafeApproval = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/approve-scripts`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "user-a" },
    body: JSON.stringify({ idempotencyKey: "approve-batch-2", expectedBatchId: publicKey("batch", 1), allowSpend: true }),
  });
  assert.equal(unsafeApproval.status, 400);
  assert.equal(calls.length, 3);
});

test("legacy direct generation and retry fail with admission-required before service parsing or lookup", async (t) => {
  const server = await harness();
  t.after(server.close);
  const headers = { "content-type": "application/json", "x-test-user": "user-a" };
  const generation = await fetch(`${server.baseUrl}/api/ai-media-studio/generations`, { method: "POST", headers, body: "{}" });
  assert.equal(generation.status, 409);
  assert.equal((await generation.json() as { code: string }).code, "PLAN_ADMISSION_REQUIRED");
  const retry = await fetch(`${server.baseUrl}/api/ai-media-studio/jobs/does-not-exist/retry`, { method: "POST", headers, body: "{}" });
  assert.equal(retry.status, 409);
  assert.equal((await retry.json() as { code: string }).code, "PLAN_ADMISSION_REQUIRED");
});
