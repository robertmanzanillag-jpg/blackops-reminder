import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { InMemoryAssetIngestRepository } from "../server/ai-media-studio/assets/in-memory-repository";
import type { AvailableProductionAssetRuntime } from "../server/ai-media-studio/assets/production-runtime";
import type {
  ProductionAdmittedRenderBootstrapAdapters,
} from "../server/ai-media-studio/workers/production-admitted-render-bootstrap";
import {
  createProductionAdmittedRenderBootstrapDependencies,
} from "../server/ai-media-studio/workers/production-admitted-render-bootstrap";
import type { AdmittedRenderTransactionalDatabase } from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";
import type { ProductionAdmittedRenderRuntime } from "../server/ai-media-studio/workers/production-admitted-render-runtime";

const config = {
  DATABASE_URL: "postgresql://app_login:app-password@db.example.com/kong",
  AI_MEDIA_STUDIO_ADMITTED_OWNER_USER_ID: "owner-a",
  AI_MEDIA_STUDIO_ADMITTED_WORKSPACE_ID: "personal",
  AI_MEDIA_STUDIO_ADMITTED_SUBMIT_DATABASE_URL:
    "postgresql://submit_login:submit-password@db.example.com/kong",
  AI_MEDIA_STUDIO_ADMITTED_RECONCILE_DATABASE_URL:
    "postgresql://reconcile_login:reconcile-password@db.example.com/kong",
  AI_MEDIA_STUDIO_ADMITTED_SUBMIT_CAPABILITY_ID: "11111111-1111-4111-8111-111111111111",
  AI_MEDIA_STUDIO_ADMITTED_RECONCILE_CAPABILITY_ID: "22222222-2222-4222-8222-222222222222",
  AI_MEDIA_STUDIO_ADMITTED_TERMINAL_CAPABILITY_ID: "33333333-3333-4333-8333-333333333333",
  AI_MEDIA_STUDIO_ADMITTED_SUBMIT_WORKER_ID: "heygen-submit-1",
  AI_MEDIA_STUDIO_ADMITTED_TERMINAL_WORKER_ID: "heygen-terminal-1",
  AI_MEDIA_STUDIO_ADMITTED_ASSET_INGEST_WORKER_ID: "heygen-asset-1",
  AI_MEDIA_STUDIO_ADMITTED_LEASE_DURATION_MS: "60000",
} as const;

function assetRuntime(): AvailableProductionAssetRuntime {
  return {
    available: true,
    reader: { async open() { throw new Error("reader must remain idle"); } },
    storage: { async beginUpload() { throw new Error("storage must remain idle"); } },
    signer: { async sign() { throw new Error("signer must remain idle"); } },
    sourcePolicy: {
      allowedHosts: new Set(["files.heygen.ai"]),
      requireHttps: true,
      requireStandardPort: true,
      maxRedirects: 1,
      async resolvePublicAddresses() { throw new Error("DNS must remain idle"); },
    },
    limits: {
      maxArtifactBytes: 64 * 1024 * 1024,
      maxChunkBytes: 1024 * 1024,
      leaseDurationMs: 60_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 60_000,
    },
  };
}

function lane(): AdmittedRenderTransactionalDatabase {
  const value: AdmittedRenderTransactionalDatabase = {
    async execute() { throw new Error("database lane must remain idle"); },
    async transaction(callback) { return callback(value); },
  };
  return value;
}

function harness(runtime: AvailableProductionAssetRuntime | null = assetRuntime()) {
  const calls = {
    appDatabase: 0,
    lanes: [] as string[],
    repository: 0,
    assetRuntime: 0,
    runtimeFactory: 0,
  };
  const applicationDatabase = {
    async execute(_query: SQL) {
      calls.appDatabase += 1;
      return { rows: [] };
    },
    async transaction<T>(callback: (database: { execute(query: SQL): Promise<unknown> }) => Promise<T>) {
      calls.appDatabase += 1;
      return callback(applicationDatabase);
    },
  };
  const adapters: ProductionAdmittedRenderBootstrapAdapters = {
    applicationDatabase,
    createDatabaseLane(connectionString) {
      calls.lanes.push(connectionString);
      return lane();
    },
    createAssetRepository() {
      calls.repository += 1;
      return new InMemoryAssetIngestRepository();
    },
    createAssetRuntime() {
      calls.assetRuntime += 1;
      return runtime ?? undefined;
    },
    createRuntimeFactory() {
      calls.runtimeFactory += 1;
      return () => ({
        configured: true,
        autostart: false,
        providerKey: "heygen",
      }) as ProductionAdmittedRenderRuntime;
    },
  };
  return { adapters, calls };
}

test("absent, partial, and unknown admitted config stays unavailable without lane or DB work", () => {
  for (const environment of [
    {},
    { AI_MEDIA_STUDIO_ADMITTED_OWNER_USER_ID: "owner-a" },
    { ...config, AI_MEDIA_STUDIO_ADMITTED_AUTOSTART: "true" },
  ]) {
    const setup = harness();
    const result = createProductionAdmittedRenderBootstrapDependencies(environment, setup.adapters);
    assert.equal(result.createProductionAdmittedRenderRuntime, undefined);
    assert.deepEqual(setup.calls.lanes, []);
    assert.equal(setup.calls.repository, 0);
    assert.equal(setup.calls.appDatabase, 0);
  }
});

test("every missing admitted key fails the all-or-nothing gate", () => {
  for (const name of Object.keys(config).filter((key) => key.startsWith("AI_MEDIA_STUDIO_ADMITTED_"))) {
    const environment = { ...config } as Record<string, string | undefined>;
    delete environment[name];
    const setup = harness();
    const result = createProductionAdmittedRenderBootstrapDependencies(environment, setup.adapters);
    assert.equal(result.createProductionAdmittedRenderRuntime, undefined, name);
    assert.deepEqual(setup.calls.lanes, [], name);
  }
});

test("duplicate principals, capabilities, workers, and malformed values fail before adapters", () => {
  const invalid = [
    { ...config, AI_MEDIA_STUDIO_ADMITTED_RECONCILE_DATABASE_URL:
      "postgresql://submit_login:other@db.example.com/kong" },
    { ...config, AI_MEDIA_STUDIO_ADMITTED_TERMINAL_CAPABILITY_ID:
      config.AI_MEDIA_STUDIO_ADMITTED_RECONCILE_CAPABILITY_ID },
    { ...config, AI_MEDIA_STUDIO_ADMITTED_TERMINAL_WORKER_ID:
      config.AI_MEDIA_STUDIO_ADMITTED_SUBMIT_WORKER_ID },
    { ...config, AI_MEDIA_STUDIO_ADMITTED_LEASE_DURATION_MS: "0" },
    { ...config, AI_MEDIA_STUDIO_ADMITTED_OWNER_USER_ID: " owner-a" },
  ];
  for (const environment of invalid) {
    const setup = harness();
    const result = createProductionAdmittedRenderBootstrapDependencies(environment, setup.adapters);
    assert.equal(result.createProductionAdmittedRenderRuntime, undefined);
    assert.deepEqual(setup.calls.lanes, []);
    assert.equal(setup.calls.repository, 0);
  }
});

test("full config composes one inert runtime without DB, HeyGen secret, worker, or transport I/O", () => {
  let heyGenSecretReads = 0;
  const environment: Record<string, string | undefined> = { ...config };
  Object.defineProperty(environment, "AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY", {
    enumerable: true,
    get() {
      heyGenSecretReads += 1;
      return "must-remain-unread";
    },
  });
  const setup = harness();
  const result = createProductionAdmittedRenderBootstrapDependencies(environment, setup.adapters);
  assert.equal(typeof result.createProductionAdmittedRenderRuntime, "function");
  assert.equal(heyGenSecretReads, 0);
  assert.equal(setup.calls.appDatabase, 0);
  assert.equal(setup.calls.repository, 1);
  assert.equal(setup.calls.runtimeFactory, 1);
  assert.equal(setup.calls.lanes.length, 2);
  assert.notEqual(setup.calls.lanes[0], setup.calls.lanes[1]);

  const runtime = result.createProductionAdmittedRenderRuntime!({ assetHooks: {} });
  assert.equal(runtime.configured, true);
  assert.equal(runtime.autostart, false);
  assert.equal(runtime.providerKey, "heygen");
  assert.equal(heyGenSecretReads, 0);
  assert.equal(setup.calls.appDatabase, 0);
});

test("missing or invalid production asset runtime suppresses admitted composition safely", () => {
  const setup = harness(null);
  const result = createProductionAdmittedRenderBootstrapDependencies(config, setup.adapters);
  assert.equal(result.createProductionAdmittedRenderRuntime, undefined);
  assert.deepEqual(result.productionAssetEnvironment, {});
  assert.deepEqual(setup.calls.lanes, []);
  assert.equal(setup.calls.repository, 0);
  assert.equal(setup.calls.appDatabase, 0);
});
