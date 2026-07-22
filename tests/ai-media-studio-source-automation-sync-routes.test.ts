import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { sourceAutomationSyncResponseSchema } from "../shared/ai-media-studio-operations";
import { InMemoryAnalyticsRepository } from "../server/ai-media-studio/analytics/in-memory-repository";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { OperationsRepositories } from "../server/ai-media-studio/operations-runtime";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { InMemoryPublishingRepository } from "../server/ai-media-studio/publishing/in-memory";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import type { SourceAdapter } from "../server/ai-media-studio/sources/contracts";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const canonicalOrigin = "https://studio.example:8443";
const endpoint = "/api/ai-media-studio/automation/sources/sync";
const mutationHeaders = {
  "content-type": "application/json",
  "x-test-user": "owner-a",
  origin: canonicalOrigin,
  "sec-fetch-site": "same-origin",
};

function forceNoDevFallback(): () => void {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  return () => {
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  };
}

function operationsRepositories(sources: InMemorySourceRepository): OperationsRepositories {
  return {
    publishing: new InMemoryPublishingRepository(),
    analytics: new InMemoryAnalyticsRepository(),
    sources,
  };
}

function sourceAdapter(counters: { calls: number; scopes: string[]; limits: number[] }, failureMessage?: string): SourceAdapter {
  return {
    key: "kong-owned-catalog",
    categories: ["events", "restaurants"],
    async fetchSnapshot(scope, input) {
      counters.calls += 1;
      counters.scopes.push(`${scope.workspaceId}:${scope.ownerUserId}`);
      counters.limits.push(input.limit);
      if (failureMessage) throw new Error(failureMessage);
      return {
        capturedAt: "2026-07-22T14:00:00.000Z",
        nextCursor: "private-provider-cursor",
        items: [{
          providerExternalId: `private-event-${scope.ownerUserId}`,
          category: "events",
          canonicalUrl: "https://kong.example/events/weekend",
          title: "Weekend event",
          content: "Private source content",
          payload: { upstreamPrivateField: "never-return" },
        }],
      };
    },
  };
}

async function startHarness(options: {
  canonicalAppUrl?: string; includeAdapter?: boolean; adapterFailureMessage?: string; useInjectedKongReader?: boolean;
} = {}) {
  const restoreDevFallback = forceNoDevFallback();
  const sources = new InMemorySourceRepository();
  const counters = { calls: 0, scopes: [] as string[], limits: [] as number[] };
  const kongReaderCounters = { calls: 0 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: options.canonicalAppUrl ?? canonicalOrigin,
    operations: {
      repositories: operationsRepositories(sources),
      runtimeEnvironment: "test",
    },
    sourceAdapters: options.includeAdapter === false ? [] : [sourceAdapter(counters, options.adapterFailureMessage)],
    ...(options.useInjectedKongReader ? { kongSourceReader: {
      async read(scope, input) {
        kongReaderCounters.calls += 1;
        return { capturedAt: "2026-07-22T14:00:00.000Z", records: [{
          id: `kong-event-${scope.ownerUserId}`,
          category: "events" as const,
          title: "Kong-owned event",
          summary: `Bounded source read with limit ${input.limit}`,
        }] };
      },
    } } : {}),
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    counters,
    kongReaderCounters,
    sources,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        restoreDevFallback();
      }
    },
  };
}

test("an injected Kong reader registers the real provider-neutral adapter without construction I/O", async (t) => {
  const harness = await startHarness({ includeAdapter: false, useInjectedKongReader: true });
  t.after(harness.close);
  assert.equal(harness.kongReaderCounters.calls, 0);
  const response = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 10 }),
  });
  assert.equal(response.status, 200);
  const parsed = sourceAutomationSyncResponseSchema.parse(await response.json());
  assert.equal(parsed.createdCount, 1);
  assert.equal(harness.kongReaderCounters.calls, 1);
  assert.equal(parsed.effects.scriptsGenerated, false);
});

async function rawRequest(url: string, options: Readonly<{
  method: string; headers: Record<string, string>; body?: string;
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

test("source sync is tenant-scoped, bounded, deduplicated and publicly redacted", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const body = JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 25 });
  const firstResponse = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST", headers: mutationHeaders, body,
  });
  assert.equal(firstResponse.status, 200);
  const firstText = await firstResponse.text();
  assert.doesNotMatch(firstText, /private-event|private-provider-cursor|upstreamPrivateField|kong\.example|Private source content/u);
  const first = sourceAutomationSyncResponseSchema.parse(JSON.parse(firstText));
  assert.deepEqual([first.createdCount, first.duplicateCount, first.items.length], [1, 0, 1]);
  assert.equal(first.downstreamState, "blocked");
  assert.equal(first.effects.sourceAdapterCalled, true);
  assert.ok(Object.entries(first.effects).every(([key, value]) => key === "sourceAdapterCalled" ? value : value === false));

  const replay = sourceAutomationSyncResponseSchema.parse(await (await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST", headers: mutationHeaders, body,
  })).json());
  assert.deepEqual([replay.createdCount, replay.duplicateCount], [0, 1]);

  const otherTenant = sourceAutomationSyncResponseSchema.parse(await (await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST",
    headers: { ...mutationHeaders, "x-test-user": "owner-b" },
    body,
  })).json());
  assert.equal(otherTenant.createdCount, 1);
  assert.notEqual(first.items[0]?.id, otherTenant.items[0]?.id);
  assert.deepEqual(harness.counters.scopes, ["personal:owner-a", "personal:owner-a", "personal:owner-b"]);
  assert.deepEqual(harness.counters.limits, [25, 25, 25]);
  assert.equal((await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" })).length, 1);
  assert.equal((await harness.sources.list({ ownerUserId: "owner-b", workspaceId: "personal" })).length, 1);
});

test("source sync is auth-first and denies unsafe transport before adapter or persistence", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  const url = `${harness.baseUrl}${endpoint}`;
  const body = JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 25 });

  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json",
    "x-user-id": "owner-a", origin: canonicalOrigin, "sec-fetch-site": "same-origin" }, body })).status, 401);
  for (const headers of [
    { "content-type": "application/json", "x-test-user": "owner-a", "sec-fetch-site": "same-origin" },
    { ...mutationHeaders, "sec-fetch-site": "same-site" },
    { ...mutationHeaders, "sec-fetch-site": "none" },
    { ...mutationHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    { ...mutationHeaders, origin: "https://attacker.example", host: "studio.example:8443",
      "x-forwarded-host": "studio.example:8443" },
  ]) {
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 403);
  }
  assert.equal((await fetch(url, { method: "POST", headers: { ...mutationHeaders,
    "content-type": "application/x-www-form-urlencoded" }, body: "adapterKey=kong-owned-catalog" })).status, 415);
  assert.equal((await fetch(`${url}?cursor=private`, { method: "POST", headers: mutationHeaders, body })).status, 400);
  assert.equal((await rawRequest(url, { method: "POST", headers: { ...mutationHeaders,
    "transfer-encoding": "chunked" }, body })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 25, providerExternalId: "private" }) })).status, 400);
  assert.equal(harness.counters.calls, 0);
  assert.deepEqual(await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" }), []);
});

test("unknown or unconfigured adapters fail closed without source or video-provider effects", async (t) => {
  const harness = await startHarness({ includeAdapter: false });
  t.after(harness.close);
  const response = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 25 }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Source automation adapter is unavailable",
    code: "ADAPTER_UNAVAILABLE",
  });
  assert.equal(harness.counters.calls, 0);
  assert.deepEqual(await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" }), []);
});

test("adapter exceptions become stable redacted 503 responses and never reach generic logging", async (t) => {
  const marker = "private-token-value https://private.example/path";
  const harness = await startHarness({ adapterFailureMessage: marker });
  t.after(harness.close);
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
  try {
    const response = await fetch(`${harness.baseUrl}${endpoint}`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ adapterKey: "kong-owned-catalog", limit: 25 }),
    });
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), {
      error: "Source automation adapter is unavailable",
      code: "ADAPTER_UNAVAILABLE",
    });
    assert.doesNotMatch(text, /private-token|private\.example/u);
    assert.equal(logged.some((line) => line.includes(marker)), false);
    assert.deepEqual(await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" }), []);
  } finally {
    console.error = originalError;
  }
});
