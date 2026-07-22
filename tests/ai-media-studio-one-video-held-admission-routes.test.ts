import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const planId = key("plan", "1"); const slotId = key("slot", "2"); const batchId = key("batch", "3");
const quoteKey = key("quote", "4"); const renderSpecKey = key("render_spec", "5");
const canonicalOrigin = "https://app.example:8443";
const postBody = { expectedBatchId: batchId, expectedQuoteKey: quoteKey,
  expectedRenderSpecKey: renderSpecKey, expectedSlotAttempt: 1, idempotencyKey: "held-admission-0001" };

const readiness = {
  version: 1, source: "postgresql_read_only", subject: { planId, batchId, slotId, slotAttempt: 1 },
  observedAt: "2026-07-22T12:00:00.000Z", state: "available", postAvailable: true, reasonCodes: [],
  cas: { expectedBatchId: batchId, expectedQuoteKey: quoteKey,
    expectedRenderSpecKey: renderSpecKey, expectedSlotAttempt: 1 },
  effects: { providerCalled: false, secretResolved: false, externalSpendCommitted: false,
    renderArtifactCreated: false, publishingCreated: false },
  canGenerate: false, spendAuthorized: false,
} as const;

function receipt(outcome: "admitted" | "replayed") {
  const created = outcome === "admitted";
  return { outcome, admission: { planId, batchId, slotId, slotAttempt: 1, quoteKey, renderSpecKey,
    reservationKey: key("reservation", "6"), maximumQuoteMicroUsd: "1250000", currency: "USD",
    reservationExpiresAt: "2026-07-22T12:10:00.000Z", state: "held" },
  effects: { internal: { internalBudgetReserved: created, heldRenderCreated: created, heldOutboxCreated: created },
    external: { secretResolved: false, providerCalled: false, verificationPerformed: false,
      quoteRequested: false, activationAuthorized: false, externalSpendCommitted: false,
      providerSubmissionStarted: false, renderSubmitted: false, renderArtifactCreated: false,
      publishingCreated: false } }, canGenerate: false, spendAuthorized: false } as const;
}

async function harness(options: Readonly<{
  installRuntime?: boolean;
  canonicalAppUrl?: string;
  runtimeEnvironment?: string;
  readinessError?: Error;
  admissionError?: Error;
}> = {}) {
  const previousFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  const readinessCalls: any[] = []; const admissionCalls: any[] = [];
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const id = req.get("x-test-session-user");
    if (id) (req as Request & { user?: { id: string } }).user = { id }; next(); });
  const { createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes");
  const installRuntime = options.installRuntime ?? true;
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    ...(options.runtimeEnvironment === "production" ? {} : { providers: [new FakeVideoProvider()] }),
    runtimeEnvironment: options.runtimeEnvironment ?? "test", operations: { runtimeEnvironment: "test" },
    oneVideoHeldAdmissionCanonicalAppUrl: options.canonicalAppUrl ?? canonicalOrigin,
    ...(installRuntime ? {
      oneVideoHeldAdmissionReadiness: { async observe(...args: unknown[]) {
        readinessCalls.push(args); if (options.readinessError) throw options.readinessError; return readiness;
      } },
      oneVideoHeldAdmissionCoordinator: { async admit(input: unknown) {
        admissionCalls.push(input); if (options.admissionError) throw options.admissionError;
        return receipt(admissionCalls.length === 1 ? "admitted" : "replayed");
      } },
    } : {}),
  });
  app.use(runtime.router); const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { runtime, readinessCalls, admissionCalls, base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
      else process.env.ALLOW_DEV_USER_FALLBACK = previousFallback;
    } };
}

async function rawRequest(url: string, options: Readonly<{
  method?: string; headers?: Record<string, string>; body?: string;
}>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject); if (options.body) req.write(options.body); req.end();
  });
}

async function optionalHarness(t: TestContext, options?: Parameters<typeof harness>[0]) {
  try { return await harness(options); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return undefined;
    }
    throw error;
  }
}

test("GET readiness requires a strict session, rejects request data, is private/no-store and preserves identity", async (t) => {
  const server = await optionalHarness(t); if (!server) return; t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission-readiness/${slotId}`;
  assert.equal((await fetch(url, { headers: { "x-user-id": "fallback-owner" } })).status, 401);
  assert.equal((await fetch(`${url}?internal=true`, { headers: { "x-test-session-user": "owner-a" } })).status, 400);
  assert.equal((await rawRequest(url, { method: "GET", headers: { "x-test-session-user": "owner-a",
    "content-type": "application/json", "content-length": "2" }, body: "{}" })).status, 400);
  assert.equal((await rawRequest(url, { method: "GET", headers: { "x-test-session-user": "owner-a",
    "content-type": "application/json", "transfer-encoding": "chunked" }, body: "{}" })).status, 400);
  assert.equal((await fetch(`${server.base}/api/ai-media-studio/production-batches/native-plan/one-video-held-admission-readiness/native-slot`,
    { headers: { "x-test-session-user": "owner-a" } })).status, 400);
  assert.equal(server.readinessCalls.length, 0);
  const response = await fetch(url, { headers: { "x-test-session-user": "owner-a" } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-ai-media-studio-one-video-held-admission"), "injected");
  assert.deepEqual(await response.json(), { readiness });
  assert.deepEqual(server.readinessCalls, [[{ ownerUserId: "owner-a", workspaceId: "personal" }, planId, slotId]]);
});

test("POST requires exact canonical origin scheme, host, port and same-origin browser metadata", async (t) => {
  const server = await optionalHarness(t); if (!server) return; t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`;
  const baseHeaders = { "content-type": "application/json", "x-test-session-user": "owner-a" };
  for (const headers of [
    baseHeaders,
    { ...baseHeaders, origin: "http://app.example:8443", "sec-fetch-site": "same-origin" },
    { ...baseHeaders, origin: "https://sub.app.example:8443", "sec-fetch-site": "same-origin" },
    { ...baseHeaders, origin: "https://app.example", "sec-fetch-site": "same-origin" },
    { ...baseHeaders, origin: canonicalOrigin, "sec-fetch-site": "same-site" },
    { ...baseHeaders, origin: canonicalOrigin },
    { ...baseHeaders, origin: "https://attacker.example", "sec-fetch-site": "same-origin",
      host: "app.example:8443", "x-forwarded-host": "app.example:8443" },
  ]) {
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(postBody) })).status, 403);
  }
  assert.equal(server.admissionCalls.length, 0);
  const response = await fetch(url, { method: "POST", headers: { ...baseHeaders, origin: canonicalOrigin,
    "sec-fetch-site": "same-origin" }, body: JSON.stringify(postBody) });
  assert.equal(response.status, 201); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(server.admissionCalls.length, 1);
  assert.equal(server.admissionCalls[0].scope.ownerUserId, "owner-a");
  assert.equal(server.admissionCalls[0].scope.workspaceId, "personal");
  assert.equal(server.admissionCalls[0].authorizationContext.transport, "same-origin-browser");
  assert.equal(server.admissionCalls[0].authorizationContext.authenticatedUserId, "owner-a");
});

test("POST accepts exactly five public CAS fields, redacts internals and returns 201 then 200 replay", async (t) => {
  const server = await optionalHarness(t); if (!server) return; t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`;
  const headers = { "content-type": "application/json", "x-test-session-user": "owner-a",
    origin: canonicalOrigin, "sec-fetch-site": "same-origin" };
  for (const unsafe of [{ ...postBody, maximumQuoteMicroUsd: "1" }, { ...postBody, providerAccountId: "private" },
    { ...postBody, authorityDigest: `sha256:${"a".repeat(64)}` }, { ...postBody, reservationExpiresAt: new Date().toISOString() }]) {
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(unsafe) })).status, 400);
  }
  assert.equal((await fetch(`${url}?authoritySnapshotId=private`, { method: "POST", headers,
    body: JSON.stringify(postBody) })).status, 400);
  assert.equal(server.admissionCalls.length, 0);
  const admitted = await fetch(url, { method: "POST", headers, body: JSON.stringify(postBody) });
  assert.equal(admitted.status, 201); const admittedText = await admitted.text();
  assert.doesNotMatch(admittedText, /dailyPlanSlotId|budgetBucketId|authoritySnapshotId|authorityDigest|providerAccountId|providerKey/iu);
  assert.match(admittedText, /"externalSpendCommitted":false/u);
  assert.match(admittedText, /"activationAuthorized":false/u);
  const replay = await fetch(url, { method: "POST", headers, body: JSON.stringify(postBody) });
  assert.equal(replay.status, 200); assert.match(await replay.text(), /"internalBudgetReserved":false/u);
  assert.equal(server.admissionCalls.length, 2);
  assert.deepEqual(Object.keys(server.admissionCalls[0]).sort(), ["authorizationContext", "expectedBatchId",
    "expectedQuoteKey", "expectedRenderSpecKey", "expectedSlotAttempt", "idempotencyKey", "publicPlanKey",
    "publicSlotKey", "scope"].sort());
});

test("x-user fallback never authorizes POST and non-JSON is denied before the coordinator", async (t) => {
  const server = await optionalHarness(t); if (!server) return; t.after(server.close);
  const url = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`;
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json",
    "x-user-id": "fallback-owner", origin: canonicalOrigin, "sec-fetch-site": "same-origin" },
  body: JSON.stringify(postBody) })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "text/plain",
    "x-test-session-user": "owner-a", origin: canonicalOrigin, "sec-fetch-site": "same-origin" },
  body: JSON.stringify(postBody) })).status, 415);
  assert.equal(server.admissionCalls.length, 0);
});

test("missing runtime or canonical origin fails closed and runtime status remains generic", async (t) => {
  const missingRuntime = await optionalHarness(t, { installRuntime: false }); if (!missingRuntime) return;
  t.after(missingRuntime.close);
  const path = `/api/ai-media-studio/production-batches/${planId}/one-video-held-admission-readiness/${slotId}`;
  assert.equal((await fetch(`${missingRuntime.base}${path}`, { headers: { "x-test-session-user": "owner-a" } })).status, 503);
  const postPath = `/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`;
  assert.equal((await fetch(`${missingRuntime.base}${postPath}`, { method: "POST", headers: {
    "content-type": "application/json", origin: canonicalOrigin, "sec-fetch-site": "same-origin",
  }, body: JSON.stringify(postBody) })).status, 401);
  assert.equal((await fetch(`${missingRuntime.base}${postPath}`, { method: "POST", headers: {
    "content-type": "application/json", "x-test-session-user": "owner-a",
    origin: "https://attacker.example", "sec-fetch-site": "cross-site",
  }, body: JSON.stringify(postBody) })).status, 403);
  assert.equal((await fetch(`${missingRuntime.base}${postPath}`, { method: "POST", headers: {
    "content-type": "application/json", "x-test-session-user": "owner-a",
    origin: canonicalOrigin, "sec-fetch-site": "same-origin",
  }, body: JSON.stringify(postBody) })).status, 503);
  assert.equal(missingRuntime.runtime.oneVideoHeldAdmissionPersistence.available, false);
  const missingOrigin = await harness({ canonicalAppUrl: "" }); t.after(missingOrigin.close);
  assert.equal((await fetch(`${missingOrigin.base}${path}`, { headers: { "x-test-session-user": "owner-a" } })).status, 503);
  const runtimeResponse = await fetch(`${missingOrigin.base}/api/ai-media-studio/runtime`, {
    headers: { "x-test-session-user": "owner-a" },
  });
  const runtimeText = await runtimeResponse.text();
  assert.match(runtimeText, /oneVideoHeldAdmission/u);
  assert.doesNotMatch(runtimeText, /postgresql:\/\/|secret|stack|invalid\.internal/iu);

  const insecureProduction = await optionalHarness(t, { canonicalAppUrl: "http://127.0.0.1:4444",
    runtimeEnvironment: "production" }); if (!insecureProduction) return; t.after(insecureProduction.close);
  assert.equal(insecureProduction.runtime.oneVideoHeldAdmissionPersistence.available, false);
});

test("unexpected runtime failures become stable 503 responses without leaking internals", async (t) => {
  const privateMessage = "postgresql://private.internal secret stack";
  const server = await optionalHarness(t, { readinessError: new Error(privateMessage),
    admissionError: new Error(privateMessage) }); if (!server) return; t.after(server.close);
  const getUrl = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission-readiness/${slotId}`;
  const getResponse = await fetch(getUrl, { headers: { "x-test-session-user": "owner-a" } });
  assert.equal(getResponse.status, 503); assert.doesNotMatch(await getResponse.text(), /private\.internal|secret|stack/iu);
  const postUrl = `${server.base}/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`;
  const postResponse = await fetch(postUrl, { method: "POST", headers: { "content-type": "application/json",
    "x-test-session-user": "owner-a", origin: canonicalOrigin, "sec-fetch-site": "same-origin" },
  body: JSON.stringify(postBody) });
  assert.equal(postResponse.status, 503); assert.doesNotMatch(await postResponse.text(), /private\.internal|secret|stack/iu);
});

test("configured durable factory is selected inertly without provider, activation or admission calls", async (t) => {
  let createAiMediaStudioRuntime: typeof import("../server/ai-media-studio/routes")["createAiMediaStudioRuntime"];
  try { ({ createAiMediaStudioRuntime } = await import("../server/ai-media-studio/routes")); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      t.skip("optional route dependency is not installed in this worktree"); return;
    }
    throw error;
  }
  let factoryCalls = 0; let readinessCalls = 0; let admissionCalls = 0;
  const runtime = createAiMediaStudioRuntime({ repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()], runtimeEnvironment: "test", operations: { runtimeEnvironment: "test" },
    databaseUrl: "postgresql://runtime-selection.invalid/ai-media",
    oneVideoHeldAdmissionCanonicalAppUrl: canonicalOrigin,
    createDurableOneVideoHeldAdmissionRuntime: () => { factoryCalls += 1; return {
      readiness: { async observe() { readinessCalls += 1; return readiness; } },
      coordinator: { async admit() { admissionCalls += 1; return receipt("admitted"); } },
    }; },
  });
  assert.equal(factoryCalls, 1); assert.equal(readinessCalls, 0); assert.equal(admissionCalls, 0);
  assert.equal(runtime.oneVideoHeldAdmissionPersistence.mode, "drizzle");
  assert.equal(runtime.oneVideoHeldAdmissionPersistence.durable, true);

  const loopbackWithSlash = createAiMediaStudioRuntime({ repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()], runtimeEnvironment: "test", operations: { runtimeEnvironment: "test" },
    oneVideoHeldAdmissionCanonicalAppUrl: "http://127.0.0.1:4567/",
    oneVideoHeldAdmissionReadiness: { async observe() { return readiness; } },
    oneVideoHeldAdmissionCoordinator: { async admit() { return receipt("admitted"); } },
  });
  assert.equal(loopbackWithSlash.oneVideoHeldAdmissionPersistence.available, true);
});

test("route source keeps held admission isolated from fallback auth and activation/provider dependencies", () => {
  const source = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
  const start = source.indexOf("function createDefaultDurableOneVideoHeldAdmissionRuntime");
  const end = source.indexOf("type OneVideoHeldAdmissionSelection", start);
  const composition = source.slice(start, end);
  assert.match(source, /one-video-held-admission-readiness\/:slotId/u);
  assert.match(source, /one-video-held-admission\/:slotId/u);
  assert.match(source, /resolveAuthenticatedUserId/u);
  assert.match(source, /heldAdmissionPrincipal/u);
  assert.match(source, /private, no-store/u);
  assert.doesNotMatch(composition, /HeyGenVideoProvider|activation|publish|fetch\s*\(/u);
});
