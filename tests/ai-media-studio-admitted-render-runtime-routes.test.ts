import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import type { ProductionAdmittedRenderRuntime } from "../server/ai-media-studio/workers/production-admitted-render-runtime";

const sentinelSecret = "must-never-serialize-admitted-render-secret";

function fakeRuntime(input: { autostart?: boolean; calls: { workers: number } }): ProductionAdmittedRenderRuntime {
  const worker = {
    sentinelSecret,
    async runNext() {
      input.calls.workers += 1;
      throw new Error("admitted render worker must remain stopped during route inspection");
    },
  };
  return {
    configured: true,
    providerKey: "heygen",
    autostart: input.autostart ?? false,
    submitWorker: worker,
    terminalWorker: worker,
    assetIngestWorker: worker,
    providerResolver: { sentinelSecret },
    terminalProviderResolver: { sentinelSecret },
    artifactResolver: { sentinelSecret },
  } as unknown as ProductionAdmittedRenderRuntime;
}

async function startRuntime(productionAdmittedRenderRuntime?: ProductionAdmittedRenderRuntime) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { user?: { id: string } }).user = { id: "user-a" };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    runtimeEnvironment: "test",
    operations: { runtimeEnvironment: "test" },
    ...(productionAdmittedRenderRuntime ? { productionAdmittedRenderRuntime } : {}),
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/api/ai-media-studio/runtime`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test("an absent admitted render runtime is unavailable without failing the runtime route", async (t) => {
  const server = await startRuntime();
  t.after(server.close);

  const response = await fetch(server.url);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-media-studio-admitted-render"), "unavailable");
  assert.deepEqual(JSON.parse(text).admittedRenderRuntime, {
    mode: "unavailable",
    available: false,
    durable: false,
    reason: "Admitted render runtime is not composed; workers remain stopped",
  });
  assert.equal(text.includes(sentinelSecret), false);
});

test("an injected admitted render runtime exposes only safe status and starts no worker", async (t) => {
  const calls = { workers: 0 };
  const server = await startRuntime(fakeRuntime({ calls }));
  t.after(server.close);

  const response = await fetch(server.url);
  const text = await response.text();
  const body = JSON.parse(text) as { admittedRenderRuntime: unknown };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-media-studio-admitted-render"), "injected");
  assert.deepEqual(body.admittedRenderRuntime, {
    mode: "injected",
    available: true,
    durable: false,
    reason: "Admitted HeyGen render runtime is composed with autostart disabled",
  });
  assert.equal(calls.workers, 0);
  assert.equal(text.includes("submitWorker"), false);
  assert.equal(text.includes("providerResolver"), false);
  assert.equal(text.includes(sentinelSecret), false);
});

test("an autostart admitted render runtime fails closed as unavailable", async (t) => {
  const calls = { workers: 0 };
  const server = await startRuntime(fakeRuntime({ autostart: true, calls }));
  t.after(server.close);

  const response = await fetch(server.url);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-media-studio-admitted-render"), "unavailable");
  assert.deepEqual(JSON.parse(text).admittedRenderRuntime, {
    mode: "unavailable",
    available: false,
    durable: false,
    reason: "Admitted render runtime configuration is invalid; workers remain stopped",
  });
  assert.equal(calls.workers, 0);
  assert.equal(text.includes(sentinelSecret), false);
});
