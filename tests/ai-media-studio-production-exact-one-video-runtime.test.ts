import assert from "node:assert/strict";
import test from "node:test";
import type { AvailableProductionAssetRuntime } from "../server/ai-media-studio/assets/production-runtime";
import type { ProductionExactOneVideoDatabase } from "../server/ai-media-studio/workers/production-exact-one-video-runtime";
import {
  createProductionExactOneVideoRuntime,
  type CreateProductionExactOneVideoRuntimeInput,
} from "../server/ai-media-studio/workers/production-exact-one-video-runtime";
import { createServerOwnedOneVideoRunAuthorization } from "../server/ai-media-studio/workers/server-owned-one-video-run-authorization";

const scope = Object.freeze({
  ownerUserId: "owner-a",
  workspaceId: "personal",
});

function setup() {
  const calls = {
    database: 0,
    authorization: 0,
    provider: 0,
    terminalProvider: 0,
    artifact: 0,
    reader: 0,
    storage: 0,
  };
  const database: ProductionExactOneVideoDatabase = {
    async execute() {
      calls.database += 1;
      return { rows: [] };
    },
    async transaction(callback) {
      calls.database += 1;
      return callback(database);
    },
  };
  const assetRuntime: AvailableProductionAssetRuntime = {
    available: true,
    reader: {
      async open() {
        calls.reader += 1;
        throw new Error("reader must remain inert during composition");
      },
    },
    storage: {
      async beginUpload() {
        calls.storage += 1;
        throw new Error("storage must remain inert during composition");
      },
    },
    signer: {
      async sign() {
        throw new Error("publishing/delivery is outside the exact runtime");
      },
    },
    sourcePolicy: {
      allowedHosts: new Set(["files.heygen.ai"]),
      requireHttps: true,
      requireStandardPort: true,
      maxRedirects: 1,
      async resolvePublicAddresses() {
        throw new Error("DNS must remain inert during composition");
      },
    },
    limits: {
      maxArtifactBytes: 64 * 1024 * 1024,
      maxChunkBytes: 1024 * 1024,
      leaseDurationMs: 60_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 60_000,
    },
  };
  const input: CreateProductionExactOneVideoRuntimeInput = {
    database,
    scope,
    authority: createServerOwnedOneVideoRunAuthorization({
      capabilityId: "11111111-1111-4111-8111-111111111111",
      actorUserId: "owner-a",
      target: {
        scope,
        budgetReservationId: "22222222-2222-4222-8222-222222222222",
        renderJobId: "33333333-3333-4333-8333-333333333333",
        dailyPlanSlotId: "44444444-4444-4444-8444-444444444444",
        slotAttempt: 1,
        workHandoffDigest: `sha256:${"a".repeat(64)}`,
      },
      action: "activate_and_submit",
      commandId: "exact-command-1",
    }),
    providerResolver: {
      async resolve() {
        calls.provider += 1;
        throw new Error("provider resolver must remain inert during composition");
      },
    },
    terminalProviderResolver: {
      async resolveTerminal() {
        calls.terminalProvider += 1;
        throw new Error("terminal resolver must remain inert during composition");
      },
    },
    providerArtifactResolver: {
      async resolveArtifact() {
        calls.artifact += 1;
        throw new Error("artifact resolver must remain inert during composition");
      },
    },
    assetRuntime,
    workerIds: {
      provider: "exact-provider-1",
      asset: "exact-asset-1",
    },
    leaseDurationMs: 60_000,
  };
  return { calls, input };
}

test("production exact one-video composition is inert and command-only", () => {
  const { calls, input } = setup();
  const runtime = createProductionExactOneVideoRuntime(input);

  assert.equal(runtime.configured, true);
  assert.equal(runtime.autostart, false);
  assert.equal(runtime.concurrency, 1);
  assert.equal(runtime.publishingAvailable, false);
  assert.equal(runtime.executor.autostart, false);
  assert.equal(runtime.executor.concurrency, 1);
  assert.equal(runtime.executor.publishingAvailable, false);
  assert.equal(typeof runtime.executor.run, "function");
  assert.deepEqual(calls, {
    database: 0,
    authorization: 0,
    provider: 0,
    terminalProvider: 0,
    artifact: 0,
    reader: 0,
    storage: 0,
  });
  assert.deepEqual(Object.keys(runtime).sort(), [
    "autostart",
    "concurrency",
    "configured",
    "executor",
    "publishingAvailable",
  ]);
  assert.equal("runNext" in runtime, false);
  assert.equal("start" in runtime, false);
  assert.equal("publish" in runtime, false);
  assert.equal("timer" in runtime, false);
});

test("invalid or incomplete exact production composition fails closed without I/O", () => {
  const cases: Array<Partial<CreateProductionExactOneVideoRuntimeInput>> = [
    { authority: { ...setup().input.authority, capabilityId: "not-a-capability" } },
    { workerIds: { provider: "same-worker", asset: "same-worker" } },
    { leaseDurationMs: 0 },
    { scope: { ownerUserId: "another owner", workspaceId: "personal" } },
    { providerArtifactResolver: undefined },
  ];

  for (const override of cases) {
    const { calls, input } = setup();
    assert.throws(
      () => createProductionExactOneVideoRuntime({
        ...input,
        ...override,
      } as CreateProductionExactOneVideoRuntimeInput),
      /exact one-video production composition is invalid/u,
    );
    assert.equal(Object.values(calls).reduce((sum, count) => sum + count, 0), 0);
  }
});
