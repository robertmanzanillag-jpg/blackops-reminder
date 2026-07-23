import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { InMemoryAssetIngestRepository } from "../server/ai-media-studio/assets/in-memory-repository";
import { durableProviderArtifactRef } from "../server/ai-media-studio/assets/provider-artifact-identity";
import type { AvailableProductionAssetRuntime } from "../server/ai-media-studio/assets/production-runtime";
import type { AdmittedAuthorizedIdentity } from "../server/ai-media-studio/workers/admitted-render-contracts";
import type { AdmittedTerminalClaim } from "../server/ai-media-studio/workers/admitted-render-terminal-worker";
import type { AdmittedRenderTransactionalDatabase } from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";
import {
  createProductionAdmittedRenderRuntime,
  type CreateProductionAdmittedRenderRuntimeInput,
} from "../server/ai-media-studio/workers/production-admitted-render-runtime";
import { createVerifiedStaticHeyGenProductionRuntimeFactory } from "../server/ai-media-studio/workers/verified-static-heygen-production-runtime-factory";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import type { HeyGenV3AdmittedProviderOptions } from "../server/ai-media-studio/providers/heygen-v3-admitted-render-provider";
import type { RuntimeProviderCredentialIdentity } from "../server/ai-media-studio/provider-credentials/runtime-provider-credential-contracts";

const ids = {
  submitCapability: "11111111-1111-4111-8111-111111111111",
  reconcileCapability: "22222222-2222-4222-8222-222222222222",
  terminalCapability: "77777777-7777-4777-8777-777777777777",
  providerAccount: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
  reservation: "55555555-5555-4555-8555-555555555555",
  render: "66666666-6666-4666-8666-666666666666",
} as const;
const digest = `sha256:${"a".repeat(64)}` as Sha256Digest;

function artifactRef(ownerUserId = "owner-a"): string {
  return durableProviderArtifactRef({
    scope: { ownerUserId, workspaceId: "personal" },
    renderJobId: ids.render,
    providerAccountId: ids.providerAccount,
    providerKey: "heygen",
    providerJobId: "video-123",
  });
}

function databaseLane(counter: { calls: number }): AdmittedRenderTransactionalDatabase {
  const lane: AdmittedRenderTransactionalDatabase = {
    async execute() {
      counter.calls += 1;
      return { rows: [] };
    },
    async transaction(callback) {
      counter.calls += 1;
      return callback(lane);
    },
  };
  return lane;
}

function capturingDatabaseLane(params: unknown[][]): AdmittedRenderTransactionalDatabase {
  const dialect = new PgDialect();
  const lane: AdmittedRenderTransactionalDatabase = {
    async execute(query: SQL) {
      params.push(dialect.sqlToQuery(query).params);
      return { rows: [] };
    },
    async transaction(callback) { return callback(lane); },
  };
  return lane;
}

function assetRuntime(counters: { reader: number; storage: number }): AvailableProductionAssetRuntime {
  return {
    available: true,
    reader: {
      async open() {
        counters.reader += 1;
        throw new Error("artifact reader should not run in this test");
      },
    },
    storage: {
      async beginUpload() {
        counters.storage += 1;
        throw new Error("storage should not run in this test");
      },
    },
    signer: { async sign() { return "https://delivery.example.com/private.mp4"; } },
    sourcePolicy: {
      allowedHosts: new Set(["files.heygen.ai"]),
      requireHttps: true,
      requireStandardPort: true,
      maxRedirects: 1,
      async resolvePublicAddresses() { return ["93.184.216.34"]; },
    },
    limits: {
      maxArtifactBytes: 64 * 1024 * 1024,
      maxChunkBytes: 1024 * 1024,
      leaseDurationMs: 60_000,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 10,
    },
  };
}

function createInput(overrides: Partial<CreateProductionAdmittedRenderRuntimeInput> = {}) {
  const databaseCalls = { calls: 0 };
  const transportCalls = { calls: 0 };
  const adapterCalls = { reader: 0, storage: 0 };
  const bindingCalls = { calls: 0 };
  const input: CreateProductionAdmittedRenderRuntimeInput = {
    databaseLanes: {
      submit: databaseLane(databaseCalls),
      reconcile: databaseLane(databaseCalls),
    },
    databaseCapabilities: {
      scope: { ownerUserId: "owner-a", workspaceId: "personal" },
      submitCapabilityId: ids.submitCapability,
      reconcileCapabilityId: ids.reconcileCapability,
      terminalCapabilityId: ids.terminalCapability,
    },
    assetRepository: new InMemoryAssetIngestRepository(),
    assetRuntime: assetRuntime(adapterCalls),
    heyGen: {
      apiKey: "test-only-heygen-secret",
      providerAccountId: ids.providerAccount,
      providerCredentialVersion: 7,
      credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      async fetchImpl() {
        transportCalls.calls += 1;
        throw new Error("provider transport should not run in this test");
      },
    },
    workerIds: {
      submit: "heygen-submit-1",
      terminal: "heygen-terminal-1",
      assetIngest: "heygen-asset-1",
    },
    leaseDurationMs: 60_000,
    async resolveArtifactBinding(request) {
      bindingCalls.calls += 1;
      return {
        jobId: request.jobId,
        tenantId: request.tenantId,
        renderJobId: request.renderJobId,
        remoteArtifactRef: request.remoteArtifactRef,
        providerJobId: "video-123",
        scope: { ownerUserId: "owner-a", workspaceId: "personal" },
        providerAccountId: ids.providerAccount,
        providerKey: "heygen",
        providerCredentialVersion: 7,
        authorizationDigest: digest,
      };
    },
    ...overrides,
  };
  return { input, databaseCalls, transportCalls, adapterCalls, bindingCalls };
}

function authorization(overrides: Partial<AdmittedAuthorizedIdentity> = {}): AdmittedAuthorizedIdentity {
  return {
    id: ids.attempt,
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    providerAccountId: ids.providerAccount,
    providerKey: "heygen",
    providerCredentialVersion: 7,
    providerIdempotencyKey: "admit:slot-1:attempt-1",
    avatarExternalResourceId: "avatar-1",
    voiceExternalResourceId: "voice-1",
    sealedRequest: { script: "Approved script", aspectRatio: "9:16" },
    sealedRequestDigest: digest,
    fencingToken: 1n,
    authorizationDigest: digest,
    commitEvidenceDigest: digest,
    authorizedAt: "2026-07-21T22:00:00.000Z",
    ...overrides,
  };
}

function terminalClaim(overrides: Partial<AdmittedTerminalClaim> = {}): AdmittedTerminalClaim {
  return {
    terminalCheckId: "77777777-7777-4777-8777-777777777777",
    id: ids.attempt,
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    providerAccountId: ids.providerAccount,
    providerKey: "heygen",
    providerCredentialVersion: 7,
    authorizationDigest: digest,
    fencingToken: 1n,
    providerJobId: "video-123",
    terminalLeaseToken: "88888888-8888-4888-8888-888888888888",
    terminalLeaseExpiresAt: "2026-07-21T23:00:00.000Z",
    terminalFencingToken: 1n,
    ...overrides,
  };
}

test("production admitted composition performs zero I/O and starts no loop", () => {
  const setup = createInput();
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  assert.equal(runtime.configured, true);
  assert.equal(runtime.providerKey, "heygen");
  assert.equal(runtime.autostart, false);
  assert.equal(setup.databaseCalls.calls, 0);
  assert.equal(setup.transportCalls.calls, 0);
  assert.deepEqual(setup.adapterCalls, { reader: 0, storage: 0 });
  assert.equal(setup.bindingCalls.calls, 0);
});

test("terminal claims use the distinct terminal capability on the reconcile login lane", async () => {
  const setup = createInput();
  const terminalParams: unknown[][] = [];
  setup.input.databaseLanes.reconcile = capturingDatabaseLane(terminalParams);
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  const result = await runtime.terminalWorker.runNext();
  assert.equal(result.outcome, "idle");
  assert.equal(terminalParams.length, 1);
  assert.ok(terminalParams[0].includes(ids.terminalCapability));
  assert.ok(!terminalParams[0].includes(ids.reconcileCapability));
});

test("account and credential mismatches fail before provider I/O", async () => {
  const setup = createInput();
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  await assert.rejects(
    () => runtime.providerResolver.resolve(authorization({ providerCredentialVersion: 8 })),
    /does not match the admitted authorization/u,
  );
  await assert.rejects(
    () => runtime.providerResolver.resolve(authorization({ providerAccountId: "77777777-7777-4777-8777-777777777777" })),
    /does not match the admitted authorization/u,
  );
  await assert.rejects(
    () => runtime.providerResolver.resolve(authorization({ scope: { ownerUserId: "another-owner", workspaceId: "personal" } })),
    /does not match the admitted authorization/u,
  );
  await assert.rejects(
    () => runtime.terminalProviderResolver.resolveTerminal(terminalClaim({ scope: { ownerUserId: "owner-a", workspaceId: "another-workspace" } })),
    /does not match the admitted authorization/u,
  );
  assert.equal(setup.transportCalls.calls, 0);
  assert.equal(setup.databaseCalls.calls, 0);
});

test("asset ingest receives the durable HeyGen resolver and never falls back to a stale URL", async () => {
  const setup = createInput({
    async resolveArtifactBinding(request) {
      return {
        jobId: request.jobId,
        tenantId: request.tenantId,
        renderJobId: request.renderJobId,
        remoteArtifactRef: request.remoteArtifactRef,
        providerJobId: "video-123",
        scope: { ownerUserId: "another-owner", workspaceId: "personal" },
        providerAccountId: ids.providerAccount,
        providerKey: "heygen",
        providerCredentialVersion: 7,
        authorizationDigest: digest,
      };
    },
  });
  const tenantId = JSON.stringify(["personal", "another-owner"]);
  await setup.input.assetRepository.enqueue({
    id: "ingest-1",
    tenantId,
    renderJobId: ids.render,
    remoteArtifactRef: artifactRef("another-owner"),
    sourceUrl: "https://stale.example.com/video.mp4?expired=true",
    maxAttempts: 2,
    availableAtMs: 0,
  }, 0);
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  const result = await runtime.assetIngestWorker.runNext();
  assert.equal(result.outcome, "retry_scheduled");
  assert.equal(setup.transportCalls.calls, 0);
  assert.equal(setup.adapterCalls.reader, 0);
  assert.equal(setup.adapterCalls.storage, 0);
});

test("artifact binding is revalidated immediately before provider GET", async () => {
  let bindingCalls = 0;
  let providerCalls = 0;
  const setup = createInput({
    heyGen: {
      apiKey: "test-only-heygen-secret",
      providerAccountId: ids.providerAccount,
      providerCredentialVersion: 7,
      credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      async fetchImpl() {
        providerCalls += 1;
        throw new Error("provider transport must remain blocked");
      },
    },
    async resolveArtifactBinding(request) {
      bindingCalls += 1;
      return {
        jobId: request.jobId,
        tenantId: request.tenantId,
        renderJobId: request.renderJobId,
        remoteArtifactRef: request.remoteArtifactRef,
        providerJobId: "video-123",
        scope: { ownerUserId: "owner-a", workspaceId: "personal" },
        providerAccountId: ids.providerAccount,
        providerKey: "heygen",
        providerCredentialVersion: 7,
        authorizationDigest: (bindingCalls === 1 ? digest : `sha256:${"b".repeat(64)}`) as Sha256Digest,
      };
    },
  });
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  await assert.rejects(runtime.artifactResolver.resolveArtifact({
    jobId: ids.attempt,
    tenantId: JSON.stringify(["personal", "owner-a"]),
    renderJobId: ids.render,
    remoteArtifactRef: artifactRef(),
    expectedMimeType: "video/mp4",
  }), /no longer current/u);
  assert.equal(bindingCalls, 2);
  assert.equal(providerCalls, 0);
});

test("invalid lanes, worker identities, asset runtime and HeyGen credentials fail closed", () => {
  const sharedCounter = { calls: 0 };
  const sharedLane = databaseLane(sharedCounter);
  const sameLanes = createInput({ databaseLanes: { submit: sharedLane, reconcile: sharedLane } });
  assert.throws(() => createProductionAdmittedRenderRuntime(sameLanes.input), /lanes must be distinct/u);

  const duplicateWorker = createInput({ workerIds: { submit: "same-worker", terminal: "same-worker", assetIngest: "asset-worker" } });
  assert.throws(() => createProductionAdmittedRenderRuntime(duplicateWorker.input), /composition is invalid/u);

  const duplicateCapability = createInput({ databaseCapabilities: {
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    submitCapabilityId: ids.submitCapability,
    reconcileCapabilityId: ids.reconcileCapability,
    terminalCapabilityId: ids.reconcileCapability,
  } });
  assert.throws(() => createProductionAdmittedRenderRuntime(duplicateCapability.input), /composition is invalid/u);

  const unavailableAssets = createInput({ assetRuntime: { available: false, reason: "not_configured" } as never });
  assert.throws(() => createProductionAdmittedRenderRuntime(unavailableAssets.input), /composition is invalid/u);

  const invalidCredential = createInput({ heyGen: { apiKey: " ", providerAccountId: ids.providerAccount, providerCredentialVersion: 7 } });
  assert.throws(() => createProductionAdmittedRenderRuntime(invalidCredential.input), /API credential/u);
});


function createMaterializedInput(
  materialize: (identity: RuntimeProviderCredentialIdentity) => Promise<HeyGenV3AdmittedProviderOptions | undefined>,
) {
  const setup = createInput();
  const input = {
    ...setup.input,
    heyGen: undefined,
    heyGenCredentialMaterializer: { materialize },
  } as unknown as CreateProductionAdmittedRenderRuntimeInput;
  return { ...setup, input };
}

test("runtime credential materialization is lazy and invalid identities fail before it", async () => {
  const materializerCalls = { calls: 0 };
  const setup = createMaterializedInput(async () => {
    materializerCalls.calls += 1;
    return {
      apiKey: "lazy-test-secret",
      providerAccountId: ids.providerAccount,
      providerCredentialVersion: 7,
      credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      async fetchImpl() {
        setup.transportCalls.calls += 1;
        throw new Error("expected test transport failure");
      },
    };
  });
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  assert.equal(materializerCalls.calls, 0);
  await assert.rejects(
    () => runtime.providerResolver.resolve(authorization({ scope: { ownerUserId: "wrong-owner", workspaceId: "personal" } })),
    /does not match the admitted authorization/u,
  );
  assert.equal(materializerCalls.calls, 0);

  const resolved = await runtime.providerResolver.resolve(authorization());
  assert.equal(materializerCalls.calls, 1);
  assert.equal(setup.transportCalls.calls, 0);
  await resolved.provider.submit(
    { script: "Approved script", aspectRatio: "9:16" },
    {
      ...resolved.capability,
      providerIdempotencyKey: "admit:slot-1:attempt-1",
      avatarExternalResourceId: "avatar-1",
      voiceExternalResourceId: "voice-1",
    },
  );
  assert.equal(setup.transportCalls.calls, 1);
});

test("runtime credential materialization failures and binding mismatches fail closed", async (t) => {
  const cases: Array<{
    name: string;
    materialize: () => Promise<HeyGenV3AdmittedProviderOptions | undefined>;
  }> = [
    { name: "undefined", materialize: async () => undefined },
    { name: "throw", materialize: async () => { throw new Error("private materializer detail"); } },
    {
      name: "account mismatch",
      materialize: async () => ({
        apiKey: "lazy-test-secret",
        providerAccountId: "77777777-7777-4777-8777-777777777777",
        providerCredentialVersion: 7,
        credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      }),
    },
    {
      name: "version mismatch",
      materialize: async () => ({
        apiKey: "lazy-test-secret",
        providerAccountId: ids.providerAccount,
        providerCredentialVersion: 8,
        credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      }),
    },
    {
      name: "expired",
      materialize: async () => ({
        apiKey: "lazy-test-secret",
        providerAccountId: ids.providerAccount,
        providerCredentialVersion: 7,
        credentialExpiresAt: "2020-01-01T00:00:00.000Z",
      }),
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const setup = createMaterializedInput(item.materialize);
      const runtime = createProductionAdmittedRenderRuntime(setup.input);
      await assert.rejects(
        () => runtime.providerResolver.resolve(authorization()),
        (error: Error) => error.message === "HeyGen production credential is unavailable",
      );
    });
  }
});

test("terminal and artifact resolvers use the lazy credential path only when invoked", async () => {
  const calls = { materialize: 0, fetch: 0 };
  const setup = createMaterializedInput(async () => {
    calls.materialize += 1;
    return {
      apiKey: "lazy-test-secret",
      providerAccountId: ids.providerAccount,
      providerCredentialVersion: 7,
      credentialExpiresAt: "2099-01-01T00:00:00.000Z",
      async fetchImpl() {
        calls.fetch += 1;
        return new Response(JSON.stringify({
          data: {
            id: "video-123",
            status: "completed",
            video_url: "https://files.heygen.ai/private.mp4",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    };
  });
  const runtime = createProductionAdmittedRenderRuntime(setup.input);
  assert.deepEqual(calls, { materialize: 0, fetch: 0 });

  await runtime.terminalProviderResolver.resolveTerminal(terminalClaim());
  assert.deepEqual(calls, { materialize: 1, fetch: 0 });

  const tenantId = JSON.stringify(["personal", "owner-a"]);
  const result = await runtime.artifactResolver.resolveArtifact({
    jobId: "ingest-1",
    tenantId,
    renderJobId: ids.render,
    remoteArtifactRef: artifactRef(),
    expectedMimeType: "video/mp4",
  });
  assert.equal(result.sourceUrl, "https://files.heygen.ai/private.mp4");
  assert.deepEqual(calls, { materialize: 2, fetch: 1 });
});

test("production composition requires exactly one static or lazy credential source", () => {
  const neither = createInput({ heyGen: undefined } as never);
  assert.throws(() => createProductionAdmittedRenderRuntime(neither.input), /composition is invalid/u);

  const both = createInput({
    heyGenCredentialMaterializer: { async materialize() { return undefined; } },
  } as never);
  assert.throws(() => createProductionAdmittedRenderRuntime(both.input), /composition is invalid/u);
});

test("verified server-only factory composes the lazy runtime with zero database or secret I/O", () => {
  const setup = createInput();
  let databaseCalls = 0;
  let artifactDatabaseCalls = 0;
  const {
    heyGen: _staticCredential,
    resolveArtifactBinding: _testBinding,
    ...runtime
  } = setup.input;
  const factory = createVerifiedStaticHeyGenProductionRuntimeFactory({
    runtime,
    credentialDatabase: {
      async execute() {
        databaseCalls += 1;
        return { rows: [] };
      },
    },
    artifactBindingDatabase: {
      async execute() {
        artifactDatabaseCalls += 1;
        return { rows: [] };
      },
    },
    secretResolverOptions: {
      env: { AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY_RUNTIME: "must-remain-unread" },
    },
  });
  assert.equal(databaseCalls, 0);
  assert.equal(artifactDatabaseCalls, 0);
  const composed = factory({ assetHooks: {} });
  assert.equal(databaseCalls, 0);
  assert.equal(artifactDatabaseCalls, 0);
  assert.equal(composed.configured, true);
  assert.equal(composed.autostart, false);
});
