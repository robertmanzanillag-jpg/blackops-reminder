import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { OneVideoCostApprovalError } from "../server/ai-media-studio/planning/one-video-cost-approval-contracts";

const key = (prefix: string, digit: number) => `${prefix}_${digit.toString(16).padStart(24, "0")}`;
const planId = key("plan", 1); const batchId = key("batch", 1); const slotId = key("slot", 1);
const quoteKey = key("quote", 1); const renderSpecKey = key("render_spec", 1);

async function harness(coordinator?: { record(input: never): Promise<unknown> }) {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const { createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes");
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()],
    runtimeEnvironment: "test", operations: { runtimeEnvironment: "test" },
    oneVideoCostApprovalCoordinator: coordinator as never,
  });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { base: `http://127.0.0.1:${address.port}`, close: async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK; else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  } };
}

test("cost-approval POST is auth-first, same-origin JSON-only, strict, redacted, and status-correct", async (t) => {
  const calls: any[] = [];
  let server: Awaited<ReturnType<typeof harness>>;
  try {
    server = await harness({ async record(input) {
      calls.push(input); return { outcome: calls.length === 1 ? "recorded" : "replayed",
        approval: { planId, batchId, slotId, decision: "approved", approvedQuoteKey: quoteKey, renderSpecKey },
        effects: { providerCalled: false, secretResolved: false, verificationPerformed: false,
          quoteRequested: false, approvalRecorded: calls.length === 1, reservationCreated: false,
          renderCreated: false, outboxCreated: false, spendCommitted: false, publishingCreated: false },
        canGenerate: false, spendAuthorized: false };
    } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-cost-approval/${slotId}`;
  const body = { expectedBatchId: batchId, expectedQuoteKey: quoteKey, decision: "approved",
    idempotencyKey: "approval_000000000000000000000001" };
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
  const headers = { "content-type": "application/json", "x-test-user": "owner-a" };
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://attacker.example",
    "sec-fetch-site": "cross-site" }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded",
    "x-test-user": "owner-a" }, body: "decision=approved" })).status, 415);
  assert.equal(calls.length, 0);

  const recorded = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(recorded.status, 201); assert.equal(recorded.headers.get("cache-control"), "private, no-store");
  const text = await recorded.text();
  assert.doesNotMatch(text, /providerAccountId|dailyPlanSlotId|evidenceDigest|amountMicroUsd|secret/iu);
  assert.match(text, /"approvalRecorded":true/u);
  const replayed = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(replayed.status, 200); assert.match(await replayed.text(), /"approvalRecorded":false/u);
  assert.equal(calls[0].scope.ownerUserId, "owner-a"); assert.equal(calls[0].scope.workspaceId, "personal");
  assert.ok(calls[0].authorizationContext);

  for (const unsafe of [{ ...body, amountMicroUsd: "1" }, { ...body, providerAccountId: "private" }]) {
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(unsafe) })).status, 400);
  }
  assert.equal((await fetch(`${url}?amountMicroUsd=1`, { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
  assert.equal((await fetch(`${server.base}/api/ai-media-studio/production-batches/native-plan/one-video-cost-approval/native-slot`, {
    method: "POST", headers, body: JSON.stringify(body),
  })).status, 400);
  assert.equal(calls.length, 2);
});

test("cost approval is unavailable without an injected authorized coordinator", async (t) => {
  let server: Awaited<ReturnType<typeof harness>>;
  try { server = await harness(); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  t.after(server.close);
  const response = await fetch(`${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-cost-approval/${slotId}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify({ expectedBatchId: batchId, expectedQuoteKey: quoteKey, decision: "approved",
      idempotencyKey: "approval_000000000000000000000001" }),
  });
  assert.equal(response.status, 503);
});

test("configured durable runtime composes the server-authorized approval coordinator lazily", async (t) => {
  let createAiMediaStudioRuntime: typeof import("../server/ai-media-studio/routes")["createAiMediaStudioRuntime"];
  try {
    ({ createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  let factoryCalls = 0; let recordCalls = 0;
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()],
    runtimeEnvironment: "test", operations: { runtimeEnvironment: "test" },
    databaseUrl: "postgresql://runtime-selection.invalid/ai_media",
    createDurableOneVideoCostApprovalCoordinator: () => {
      factoryCalls += 1;
      return { async record() { recordCalls += 1; throw new OneVideoCostApprovalError("UNAVAILABLE"); } };
    },
  });
  assert.equal(factoryCalls, 1);
  assert.equal(recordCalls, 0);
  assert.ok(runtime.oneVideoCostApproval);
  assert.deepEqual(runtime.oneVideoCostApprovalPersistence, {
    mode: "drizzle", available: true, durable: true,
    reason: "PostgreSQL/Drizzle server-authorized one-video cost approval selected",
  });
});

test("cost approval returns a redacted 409 when the exact batch or quote changed", async (t) => {
  let server: Awaited<ReturnType<typeof harness>>;
  try {
    server = await harness({ async record() { throw new OneVideoCostApprovalError("STALE_OR_CONFLICT"); } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  t.after(server.close);
  const response = await fetch(`${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-cost-approval/${slotId}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": "owner-a" },
    body: JSON.stringify({ expectedBatchId: batchId, expectedQuoteKey: quoteKey, decision: "approved",
      idempotencyKey: "approval_000000000000000000000001" }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The batch or quote changed; refresh before deciding",
    code: "STALE_OR_CONFLICT",
  });
});
