import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import {
  ExactAssetStageRunner,
  type ExactAssetStageRepository,
  type ExactAssetStageTargetLoader,
} from "../server/ai-media-studio/assets/exact-stage-runner";
import {
  FakeBoundedArtifactReader,
  InMemoryOwnedObjectStorage,
} from "../server/ai-media-studio/assets/fakes";
import type {
  ArtifactReadStream,
  AssetIngestErrorCode,
  ExactHostSsrfPolicy,
  ProviderArtifactResolver,
} from "../server/ai-media-studio/assets/contracts";
import type {
  ExactAssetIngestClaim,
  ExactAssetIngestClaimResult,
  ExactAssetIngestFailureResult,
  ExactAssetLinkClaim,
} from "../server/ai-media-studio/assets/drizzle-exact-asset-ingest-repository";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoStageContext,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (char: string) => `sha256:${char.repeat(64)}` as Sha256Digest;
const sha = (char: string) => char.repeat(64);
const ids = {
  execution: "10000000-0000-4000-8000-000000000001",
  lease: "20000000-0000-4000-8000-000000000002",
  reservation: "30000000-0000-4000-8000-000000000003",
  render: "40000000-0000-4000-8000-000000000004",
  slot: "50000000-0000-4000-8000-000000000005",
  ingest: "60000000-0000-4000-8000-000000000006",
  media: "70000000-0000-4000-8000-000000000007",
} as const;
const scope = Object.freeze({ ownerUserId: "owner-1", workspaceId: "workspace-1" });
const baseTarget = Object.freeze({
  scope,
  budgetReservationId: ids.reservation,
  renderJobId: ids.render,
  dailyPlanSlotId: ids.slot,
  slotAttempt: 1,
  workHandoffDigest: digest("b"),
});
const lease = Object.freeze({
  executionId: ids.execution,
  commandId: "exact-asset-command",
  commandDigest: digest("a"),
  fencingToken: 3n,
  leaseToken: ids.lease,
}) as ExactOneVideoRunLease;
const ingestContext = Object.freeze({
  target: baseTarget,
  action: "ingest_asset",
  commandId: "exact-asset-command",
  commandDigest: digest("a"),
  actorUserId: "robert",
  lease,
}) as ExactOneVideoStageContext;
const linkContext = Object.freeze({
  ...ingestContext,
  action: "link_asset",
}) as ExactOneVideoStageContext;

const publicSourcePolicy: ExactHostSsrfPolicy = {
  allowedHosts: new Set(["cdn.provider.example"]),
  requireHttps: true,
  requireStandardPort: true,
  maxRedirects: 2,
  async resolvePublicAddresses() { return ["93.184.216.34"]; },
};
const mp4 = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
]);

function stream(overrides: Partial<ArtifactReadStream> = {}): ArtifactReadStream {
  return {
    finalUrl: "https://cdn.provider.example/fresh.mp4",
    mimeType: "video/mp4",
    declaredSizeBytes: mp4.byteLength,
    chunks: (async function* () { yield mp4.subarray(0, 7); yield mp4.subarray(7); })(),
    abort: () => undefined,
    ...overrides,
  };
}

function claim(overrides: Partial<ExactAssetIngestClaim> = {}): ExactAssetIngestClaim {
  return Object.freeze({
    ingestJobId: ids.ingest,
    scope,
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    providerKey: "heygen",
    remoteArtifactRef: "provider-artifact://stable-ref",
    sourceUrl: "https://cdn.provider.example/stale.mp4?signature=expired",
    expectedMimeType: "video/mp4",
    attempt: 1,
    maxAttempts: 3,
    leaseOwner: "exact-asset-worker",
    leaseToken: "80000000-0000-4000-8000-000000000008",
    leaseExpiresAt: "2026-07-23T20:01:00.000Z",
    fencingToken: 4n,
    ...overrides,
  });
}

function linkClaim(overrides: Partial<ExactAssetLinkClaim> = {}): ExactAssetLinkClaim {
  return Object.freeze({
    ingestJobId: ids.ingest,
    scope,
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    linkState: "completed_unlinked",
    ownedObjectKey: "ai-media-studio/workspace-1/owner-1/video.mp4",
    sha256: sha("c"),
    sizeBytes: 4096,
    ingestFencingToken: 4n,
    createdAt: "2026-07-23T19:55:00.000Z",
    updatedAt: "2026-07-23T20:00:00.000Z",
    ...overrides,
  });
}

class Targets implements ExactAssetStageTargetLoader {
  ingestCalls = 0;
  linkCalls = 0;
  ingestJobId: string | undefined = ids.ingest;
  linkJobId: string | undefined = ids.ingest;
  async loadIngestTarget(context: ExactOneVideoStageContext) {
    this.ingestCalls += 1;
    assert.equal(context.action, "ingest_asset");
    return this.ingestJobId ? { ingestJobId: this.ingestJobId } : undefined;
  }
  async loadLinkTarget(context: ExactOneVideoStageContext) {
    this.linkCalls += 1;
    assert.equal(context.action, "link_asset");
    return this.linkJobId ? { ingestJobId: this.linkJobId } : undefined;
  }
}

class Repository implements ExactAssetStageRepository {
  claims: Array<{ context: ExactOneVideoStageContext; ingestJobId: string; workerId: string; leaseDurationMs: number }> = [];
  completions: Array<{ context: ExactOneVideoStageContext; claim: ExactAssetIngestClaim; ownedObjectKey: string; sha256: string; sizeBytes: number }> = [];
  failures: Array<{ context: ExactOneVideoStageContext; claim: ExactAssetIngestClaim; errorCode: AssetIngestErrorCode; retryable: boolean; retryAt: string }> = [];
  linkLoads: Array<{ context: ExactOneVideoStageContext; ingestJobId: string }> = [];
  links: Array<{ context: ExactOneVideoStageContext; claim: ExactAssetLinkClaim; mediaAssetId: string }> = [];
  claimResult: ExactAssetIngestClaimResult = { kind: "claimed", claim: claim() };
  completeApplied = true;
  failResult: ExactAssetIngestFailureResult = { applied: true, state: "retry_wait" };
  linkClaim: ExactAssetLinkClaim | undefined = linkClaim();
  linkApplied = true;
  linkError: Error | undefined;
  async claimExactIngest(
    context: ExactOneVideoStageContext,
    input: { ingestJobId: string; workerId: string; leaseDurationMs: number },
  ) {
    this.claims.push({ context, ...input });
    return this.claimResult;
  }
  async completeExactIngest(
    context: ExactOneVideoStageContext,
    exactClaim: ExactAssetIngestClaim,
    outcome: { ownedObjectKey: string; sha256: string; sizeBytes: number },
  ) {
    this.completions.push({ context, claim: exactClaim, ...outcome });
    return this.completeApplied;
  }
  async failExactIngest(
    context: ExactOneVideoStageContext,
    exactClaim: ExactAssetIngestClaim,
    outcome: { errorCode: AssetIngestErrorCode; retryable: boolean; retryAt: string },
  ) {
    this.failures.push({ context, claim: exactClaim, ...outcome });
    return this.failResult;
  }
  async loadExactLink(context: ExactOneVideoStageContext, input: { ingestJobId: string }) {
    this.linkLoads.push({ context, ingestJobId: input.ingestJobId });
    return this.linkClaim;
  }
  async recordExactLink(
    context: ExactOneVideoStageContext,
    exactClaim: ExactAssetLinkClaim,
    input: { mediaAssetId: string },
  ) {
    this.links.push({ context, claim: exactClaim, mediaAssetId: input.mediaAssetId });
    if (this.linkError) throw this.linkError;
    return this.linkApplied;
  }
}

function runner(input: {
  repository?: Repository;
  targets?: Targets;
  reader?: FakeBoundedArtifactReader;
  storage?: InMemoryOwnedObjectStorage;
  providerArtifactResolver?: ProviderArtifactResolver;
  hooks?: ConstructorParameters<typeof ExactAssetStageRunner>[0]["hooks"];
} = {}) {
  const repository = input.repository ?? new Repository();
  const targets = input.targets ?? new Targets();
  const reader = input.reader ?? new FakeBoundedArtifactReader(() => stream());
  const storage = input.storage ?? new InMemoryOwnedObjectStorage();
  const providerArtifactResolver = input.providerArtifactResolver ?? {
    async resolveArtifact(request) {
      return {
        remoteArtifactRef: request.remoteArtifactRef,
        sourceUrl: "https://cdn.provider.example/fresh.mp4",
        mediaType: "video/mp4" as const,
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get" as const,
      };
    },
  };
  return {
    repository,
    targets,
    reader,
    storage,
    runner: new ExactAssetStageRunner({
      workerId: "exact-asset-worker",
      repository,
      targets,
      reader,
      providerArtifactResolver,
      sourcePolicy: publicSourcePolicy,
      storage,
      leaseDurationMs: 60_000,
      maxArtifactBytes: 1_000,
      maxChunkBytes: 100,
      retry: { baseDelayMs: 100, maxDelayMs: 1_000 },
      clock: { now: () => 1_000 },
      hooks: input.hooks,
    }),
  };
}

test("construction is inert and exposes no global queue, scan, publishing, or autostart surface", () => {
  const targets = new Targets();
  const h = runner({ targets });
  assert.equal(h.runner.autostart, false);
  assert.equal(h.runner.publishingAvailable, false);
  assert.equal("runNext" in h.runner, false);
  assert.equal("claimDue" in h.runner, false);
  assert.equal("listCompletedUnlinked" in h.runner, false);
  assert.equal("publish" in h.runner, false);
  assert.equal(targets.ingestCalls, 0);
  assert.equal(targets.linkCalls, 0);
});

test("ingest stage claims only the exact target and resolves a fresh artifact URL before streaming", async () => {
  const order: string[] = [];
  const reader = new FakeBoundedArtifactReader((request) => {
    order.push(`open:${request.url}`);
    return stream({ finalUrl: request.url });
  });
  const providerArtifactResolver: ProviderArtifactResolver = {
    async resolveArtifact(request) {
      order.push("resolve");
      assert.equal(request.jobId, ids.ingest);
      assert.equal(request.renderJobId, ids.render);
      assert.equal(request.remoteArtifactRef, "provider-artifact://stable-ref");
      assert.equal(request.expectedMimeType, "video/mp4");
      return {
        remoteArtifactRef: request.remoteArtifactRef,
        sourceUrl: "https://cdn.provider.example/fresh.mp4?signature=current",
        mediaType: "video/mp4",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
      };
    },
  };
  const h = runner({ reader, providerArtifactResolver });

  const result = await h.runner.ingestAssetExact(ingestContext);

  assert.deepEqual(result, { target: baseTarget, action: "ingest_asset", outcome: "asset_completed_unlinked" });
  assert.deepEqual(order, ["resolve", "open:https://cdn.provider.example/fresh.mp4?signature=current"]);
  assert.deepEqual(h.repository.claims.map(call => ({
    ingestJobId: call.ingestJobId,
    workerId: call.workerId,
    leaseDurationMs: call.leaseDurationMs,
    action: call.context.action,
  })), [{ ingestJobId: ids.ingest, workerId: "exact-asset-worker", leaseDurationMs: 60_000, action: "ingest_asset" }]);
  assert.equal(h.repository.completions.length, 1);
  assert.match(h.repository.completions[0]!.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(h.repository.completions[0]!.sizeBytes, mp4.byteLength);
  assert.ok(h.repository.completions[0]!.ownedObjectKey.includes("/sha256/"));
  assert.equal(h.repository.failures.length, 0);
  assert.equal(h.reader.requests[0]?.url, "https://cdn.provider.example/fresh.mp4?signature=current");
});

test("missing target or non-claim outcome stops without reader, provider, storage, or mutation side effects", async () => {
  const targets = new Targets();
  targets.ingestJobId = undefined;
  const h = runner({ targets });
  assert.deepEqual(await h.runner.ingestAssetExact(ingestContext), {
    target: baseTarget,
    action: "ingest_asset",
    outcome: "idle",
  });
  assert.equal(h.repository.claims.length, 0);
  assert.equal(h.reader.requests.length, 0);

  targets.ingestJobId = ids.ingest;
  h.repository.claimResult = { kind: "dead_letter", ingestJobId: ids.ingest };
  assert.deepEqual(await h.runner.ingestAssetExact(ingestContext), {
    target: baseTarget,
    action: "ingest_asset",
    outcome: "dead_letter",
  });
  assert.equal(h.reader.requests.length, 0);
});

test("artifact failures preserve safe codes and never persist provider error text", async () => {
  const h = runner({
    reader: new FakeBoundedArtifactReader(() => {
      throw new Error("provider failed with api_key=secret");
    }),
  });
  const result = await h.runner.ingestAssetExact(ingestContext);
  assert.equal(result.outcome, "retry_scheduled");
  assert.equal(h.repository.failures.length, 1);
  assert.equal(h.repository.failures[0]!.errorCode, "ingest_failed");
  assert.equal(JSON.stringify(
    h.repository.failures,
    (_key, value) => typeof value === "bigint" ? value.toString() : value,
  ).includes("api_key=secret"), false);
  assert.equal(h.repository.completions.length, 0);
});

test("permanent MP4 validation failure aborts the stream and records dead letter", async () => {
  let aborted = 0;
  const h = runner({
    reader: new FakeBoundedArtifactReader(() => stream({
      mimeType: "video/mp4",
      chunks: (async function* () { yield new Uint8Array(16); })(),
      abort: () => { aborted += 1; },
    })),
  });
  h.repository.failResult = { applied: true, state: "dead_letter" };
  const result = await h.runner.ingestAssetExact(ingestContext);
  assert.equal(result.outcome, "dead_letter");
  assert.equal(h.repository.failures[0]?.errorCode, "invalid_mp4");
  assert.equal(aborted, 1);
});

test("stale ingest completion maps to lease_lost and never calls canonical link hooks", async () => {
  let leaseLost = 0;
  let completed = 0;
  const h = runner({
    hooks: {
      onLeaseLost() { leaseLost += 1; },
      onCompleted() { completed += 1; return { mediaAssetId: ids.media }; },
    },
  });
  h.repository.completeApplied = false;
  const result = await h.runner.ingestAssetExact(ingestContext);
  assert.equal(result.outcome, "lease_lost");
  assert.equal(leaseLost, 1);
  assert.equal(completed, 0);
  assert.equal(h.repository.links.length, 0);
});

test("link stage loads exactly one target, materializes canonical media, and records the exact link", async () => {
  let hookJob;
  const h = runner({
    hooks: {
      onCompleted(job) {
        hookJob = job;
        return { mediaAssetId: ids.media };
      },
    },
  });
  const result = await h.runner.linkAssetExact(linkContext);
  assert.deepEqual(result, { target: baseTarget, action: "link_asset", outcome: "asset_linked" });
  assert.deepEqual(h.repository.linkLoads.map(call => ({
    action: call.context.action,
    ingestJobId: call.ingestJobId,
  })), [{ action: "link_asset", ingestJobId: ids.ingest }]);
  assert.equal(h.repository.links.length, 1);
  assert.equal(h.repository.links[0]!.mediaAssetId, ids.media);
  assert.equal((hookJob as { id?: string; state?: string; ownedObjectKey?: string } | undefined)?.id, ids.ingest);
  assert.equal((hookJob as { id?: string; state?: string; ownedObjectKey?: string } | undefined)?.state, "completed");
  assert.equal((hookJob as { id?: string; state?: string; ownedObjectKey?: string } | undefined)?.ownedObjectKey,
    "ai-media-studio/workspace-1/owner-1/video.mp4");
  assert.equal((hookJob as { updatedAtMs?: number } | undefined)?.updatedAtMs,
    Date.parse("2026-07-23T20:00:00.000Z"));
  assert.equal(h.repository.claims.length, 0);
});

test("link stage keeps completed-unlinked state when hook is absent, throws, or stale CAS refuses", async () => {
  const noHook = runner();
  assert.equal((await noHook.runner.linkAssetExact(linkContext)).outcome, "asset_completed_unlinked");
  assert.equal(noHook.repository.links.length, 0);

  const throws = runner({ hooks: { onCompleted() { throw new Error("secret token"); } } });
  assert.equal((await throws.runner.linkAssetExact(linkContext)).outcome, "asset_completed_unlinked");
  assert.equal(JSON.stringify(throws.repository.links).includes("secret token"), false);

  const stale = runner({ hooks: { onCompleted() { return { mediaAssetId: ids.media }; } } });
  stale.repository.linkApplied = false;
  assert.equal((await stale.runner.linkAssetExact(linkContext)).outcome, "asset_completed_unlinked");
  assert.equal(stale.repository.links.length, 1);
});

test("link repository failures propagate instead of sealing a normal unlinked outcome", async () => {
  const h = runner({ hooks: { onCompleted() { return { mediaAssetId: ids.media }; } } });
  h.repository.linkError = new Error("commit failed");
  await assert.rejects(h.runner.linkAssetExact(linkContext), /commit failed/u);
  assert.equal(h.repository.links.length, 1);
});

test("runner rejects unsafe source policies before any target or repository call", () => {
  const targets = new Targets();
  assert.throws(() => new ExactAssetStageRunner({
    workerId: "exact-asset-worker",
    repository: new Repository(),
    targets,
    reader: new FakeBoundedArtifactReader(() => stream()),
    sourcePolicy: { ...publicSourcePolicy, allowedHosts: new Set(["*.provider.example"]) },
    storage: new InMemoryOwnedObjectStorage(),
    leaseDurationMs: 60_000,
    maxArtifactBytes: 1_000,
    maxChunkBytes: 100,
    retry: { baseDelayMs: 100, maxDelayMs: 1_000 },
  }), /exact lowercase hostnames/);
  assert.equal(targets.ingestCalls, 0);
  assert.equal(targets.linkCalls, 0);
});
