import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { ProductionBatchRepository } from "../server/ai-media-studio/production-batches/contracts";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import {
  requireAuthenticatedProductionBatchMutationBeforeBody,
  sanitizeProductionBatchJsonParserError,
} from "../server/user-context";
import type { ProductionBatch } from "../shared/ai-media-studio-production-batches";

const publicKey = (prefix: string, value: number) => `${prefix}_${value.toString(16).padStart(24, "0")}`;
const canonicalOrigin = "https://studio.example:8443";
const mutationHeaders = {
  "content-type": "application/json",
  "x-test-user": "user-a",
  origin: canonicalOrigin,
  "sec-fetch-site": "same-origin",
};

async function rawRequest(url: string, options: Readonly<{
  method: string; headers: Record<string, string>; body?: string | Buffer;
}>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

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
  const app = express();
  app.use((req, _res, next) => { const id = req.get("x-test-user"); if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  app.use(requireAuthenticatedProductionBatchMutationBeforeBody);
  app.use(express.json({ limit: "1kb" }));
  app.use(sanitizeProductionBatchJsonParserError);
  const runtime = createAiMediaStudioRuntime(repository ? {
    repository: new InMemoryMediaJobRepository(), providers: [new FakeVideoProvider()], defaultProviderKey: "fake",
    runtimeEnvironment: "test", aiMediaStudioCanonicalAppUrl: canonicalOrigin,
    productionBatchRepository: repository, operations: { runtimeEnvironment: "test" },
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
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "prepare-batch-1", variantCount: 2 }),
  });
  assert.equal(prepare.status, 200);
  assert.deepEqual(calls[1], ["prepare", { ownerUserId: "user-a", workspaceId: "personal" }, publicKey("plan", 2), "prepare-batch-1", 2]);
  const spoofed = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/prepare-scripts`, {
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "prepare-batch-2", sourceIds: ["private"] }),
  });
  assert.equal(spoofed.status, 400);
  assert.equal(calls.length, 2);

  const approve = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/approve-scripts`, {
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "approve-batch-1", expectedBatchId: publicKey("batch", 1) }),
  });
  assert.equal(approve.status, 200);
  assert.deepEqual(calls[2], ["approve", { ownerUserId: "user-a", workspaceId: "personal" }, publicKey("plan", 2),
    "approve-batch-1", publicKey("batch", 1)]);
  const unsafeApproval = await fetch(`${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/approve-scripts`, {
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "approve-batch-2", expectedBatchId: publicKey("batch", 1), allowSpend: true }),
  });
  assert.equal(unsafeApproval.status, 400);
  assert.equal(calls.length, 3);
});

test("production batch pre-body boundary mirrors Express case and trailing-slash routing", async (t) => {
  const calls: unknown[] = [];
  const repository: ProductionBatchRepository = {
    getCurrent: async () => pendingBatch(),
    prepare: async (input) => { calls.push(["prepare", input.scope, input.planId]); return pendingBatch(); },
    approve: async (input) => { calls.push(["approve", input.scope, input.planId]); return pendingBatch(); },
  };
  const server = await harness(repository); t.after(server.close);
  const planId = publicKey("plan", 2);
  const prepare = await fetch(`${server.baseUrl}/API/AI-MEDIA-STUDIO/PRODUCTION-BATCHES/${planId}/PREPARE-SCRIPTS/`, {
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "prepare-case-route", variantCount: 2 }),
  });
  assert.equal(prepare.status, 200);
  const approve = await fetch(`${server.baseUrl}/API/AI-MEDIA-STUDIO/PRODUCTION-BATCHES/${planId}/APPROVE-SCRIPTS/`, {
    method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ idempotencyKey: "approve-case-route", expectedBatchId: publicKey("batch", 1) }),
  });
  assert.equal(approve.status, 200);
  assert.deepEqual(calls, [
    ["prepare", { ownerUserId: "user-a", workspaceId: "personal" }, planId],
    ["approve", { ownerUserId: "user-a", workspaceId: "personal" }, planId],
  ]);
});

test("production batch mutations are auth-first and reject untrusted or ambiguous requests before service calls", async (t) => {
  const calls: string[] = [];
  const repository: ProductionBatchRepository = {
    getCurrent: async () => { calls.push("get"); return pendingBatch(); },
    prepare: async () => { calls.push("prepare"); return pendingBatch(); },
    approve: async () => { calls.push("approve"); return pendingBatch(); },
  };
  const server = await harness(repository); t.after(server.close);
  const routes = [
    {
      endpoint: `${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/prepare-scripts`,
      routeVariant: `${server.baseUrl}/API/AI-MEDIA-STUDIO/PRODUCTION-BATCHES/${publicKey("plan", 2)}/PREPARE-SCRIPTS/`,
      body: JSON.stringify({ idempotencyKey: "prepare-batch-secure", variantCount: 2 }),
      invalidBody: JSON.stringify({ idempotencyKey: "prepare-batch-secure", variantCount: 2, sourceIds: ["private"] }),
    },
    {
      endpoint: `${server.baseUrl}/api/ai-media-studio/production-batches/${publicKey("plan", 2)}/approve-scripts`,
      routeVariant: `${server.baseUrl}/API/AI-MEDIA-STUDIO/PRODUCTION-BATCHES/${publicKey("plan", 2)}/APPROVE-SCRIPTS/`,
      body: JSON.stringify({ idempotencyKey: "approve-batch-secure", expectedBatchId: publicKey("batch", 1) }),
      invalidBody: JSON.stringify({ idempotencyKey: "approve-batch-secure", expectedBatchId: publicKey("batch", 1), allowSpend: true }),
    },
  ] as const;

  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  for (const route of routes) {
    assert.equal((await fetch(route.endpoint, { method: "POST", headers: {
      "content-type": "text/plain", "x-user-id": "user-a",
    }, body: route.body })).status, 401, "authentication must run before transport validation");
    for (const body of ["{\"private-fragment\":", JSON.stringify({ value: "x".repeat(2_000) })]) {
      const response = await fetch(route.routeVariant, { method: "POST", headers: {
        "content-type": "application/json", origin: canonicalOrigin, "sec-fetch-site": "same-origin",
      }, body });
      assert.equal(response.status, 401, "unauthenticated bodies must be rejected before parsing");
      assert.doesNotMatch(await response.text(), /private-fragment|Unexpected|too large/iu);
    }
    for (const headers of [
      { "content-type": "application/json", "x-test-user": "user-a", "sec-fetch-site": "same-origin" },
      { ...mutationHeaders, "sec-fetch-site": "same-site" },
      { ...mutationHeaders, "sec-fetch-site": "none" },
      { ...mutationHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      { ...mutationHeaders, origin: "https://attacker.example", host: "studio.example:8443",
        "x-forwarded-host": "studio.example:8443" },
    ]) {
      assert.equal((await fetch(route.endpoint, { method: "POST", headers, body: route.body })).status, 403);
    }
    assert.equal((await fetch(route.endpoint, { method: "POST", headers: {
      ...mutationHeaders, "content-type": "application/x-www-form-urlencoded",
    }, body: "idempotencyKey=unsafe" })).status, 415);
    assert.equal((await fetch(`${route.endpoint}?ownerUserId=attacker`, {
      method: "POST", headers: mutationHeaders, body: route.body,
    })).status, 400);
    for (const rawQuery of ["?__proto__", "?toString"]) {
      assert.equal((await fetch(`${route.endpoint}${rawQuery}`, {
        method: "POST", headers: mutationHeaders, body: route.body,
      })).status, 400, "any raw query delimiter must be rejected");
    }
    assert.equal((await rawRequest(route.endpoint, {
      method: "POST", headers: { ...mutationHeaders, "transfer-encoding": "chunked" }, body: route.body,
    })).status, 400);
    assert.equal((await fetch(route.endpoint, {
      method: "POST", headers: mutationHeaders, body: route.invalidBody,
    })).status, 400);

    const malformed = await fetch(route.endpoint, {
      method: "POST", headers: mutationHeaders, body: "{\"private-fragment\":",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: "Production batch JSON body is invalid", code: "INVALID_JSON_BODY",
    });

    const oversized = await fetch(route.endpoint, {
      method: "POST", headers: mutationHeaders, body: JSON.stringify({ privateFragment: "x".repeat(2_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: "Production batch JSON body is too large", code: "JSON_BODY_TOO_LARGE",
    });

    for (const headers of [
      { ...mutationHeaders, "content-type": "application/json; charset=iso-8859-1" },
      { ...mutationHeaders, "content-encoding": "caller-controlled-encoding" },
    ]) {
      const unsupported = await fetch(route.routeVariant, {
        method: "POST", headers, body: route.body,
      });
      assert.equal(unsupported.status, 415);
      assert.deepEqual(await unsupported.json(), {
        error: "Production batch JSON body is unsupported", code: "UNSUPPORTED_JSON_BODY",
      });
    }

    for (const contentEncoding of ["gzip", "deflate"]) {
      const corruptCompressed = await rawRequest(route.routeVariant, {
        method: "POST",
        headers: { ...mutationHeaders, "content-encoding": contentEncoding },
        body: Buffer.from(`corrupt-${contentEncoding}-caller-detail`, "utf8"),
      });
      assert.equal(corruptCompressed.status, 400);
      assert.deepEqual(JSON.parse(corruptCompressed.text), {
        error: "Production batch JSON body is invalid", code: "INVALID_JSON_BODY",
      });
      assert.doesNotMatch(corruptCompressed.text, /incorrect header|corrupt-|caller-detail/iu);
    }
  }
  assert.deepEqual(calls, [], "denied requests must not reach production-batch persistence");
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
