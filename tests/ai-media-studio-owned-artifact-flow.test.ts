import assert from "node:assert/strict";
import test from "node:test";
import {
  AssetIngestWorker,
  FakeBoundedArtifactReader,
  InMemoryAssetIngestRepository,
  InMemoryOwnedObjectStorage,
} from "../server/ai-media-studio/assets";
import { InMemoryMediaAssetRepository } from "../server/ai-media-studio/core/in-memory-asset-repository";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "../server/ai-media-studio/core/in-memory-core-repositories";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import {
  FAKE_VIDEO_PROVIDER_ACCOUNT_ID,
  FakeVideoProvider,
} from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

test("provider completion becomes a tenant-owned canonical asset only after bounded worker ingest", async () => {
  class OneTimeFailingAssetRepository extends InMemoryMediaAssetRepository {
    private failOnce = true;
    override async createOrGet(candidate: Parameters<InMemoryMediaAssetRepository["createOrGet"]>[0]) {
      if (this.failOnce) { this.failOnce = false; throw new Error("transient catalog outage"); }
      return super.createOrGet(candidate);
    }
  }
  const assets = new OneTimeFailingAssetRepository();
  const ingestRepository = new InMemoryAssetIngestRepository();
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider({ autoComplete: false })],
    defaultProviderKey: "fake",
    allowedAssetHosts: new Set(["cdn.example.com"]),
    assetIngestRepository: ingestRepository,
    coreRepositories: {
      influencers: new InMemoryInfluencerRepository(),
      resources: new InMemoryCanonicalResourceRepository(),
      assets,
    },
    runtimeEnvironment: "test",
    seedCoreDefaults: true,
  });
  const job = await runtime.service.createGeneration("owner-a", {
    influencerId: "emily-food", script: "A finished owned render.", voiceId: "voice-emily-en",
    language: "en-US", aspectRatio: "9:16", idempotencyKey: "owned-artifact-flow-001",
  });
  await runtime.service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "provider-completed-1", occurred_at: "2026-07-20T20:00:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "completed", video_url: "https://cdn.example.com/private-render.mp4" },
  });
  const waiting = await runtime.service.getJob("owner-a", job.id);
  assert.equal(waiting.status, "rendering");
  assert.equal(waiting.stage, "artifact_ingest_queued");
  assert.equal(waiting.outputAssetId, undefined);

  const mp4Header = Uint8Array.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
  const storage = new InMemoryOwnedObjectStorage();
  const worker = new AssetIngestWorker({
    workerId: "asset-worker-test",
    repository: ingestRepository,
    reader: new FakeBoundedArtifactReader({
      finalUrl: "https://cdn.example.com/private-render.mp4",
      mimeType: "video/mp4",
      declaredSizeBytes: mp4Header.byteLength,
      chunks: (async function* () { yield mp4Header; })(),
      abort: () => undefined,
    }),
    sourcePolicy: {
      allowedHosts: new Set(["cdn.example.com"]), requireHttps: true, requireStandardPort: true,
      maxRedirects: 1, resolvePublicAddresses: async () => ["203.0.113.10"],
    },
    storage,
    leaseDurationMs: 30_000,
    maxArtifactBytes: 10_000,
    maxChunkBytes: 10_000,
    retry: { baseDelayMs: 100, maxDelayMs: 1_000 },
    hooks: runtime.assetIngestHooks,
  });
  assert.equal((await worker.runNext()).outcome, "completed_unlinked");
  assert.equal((await runtime.service.getJob("owner-a", job.id)).stage, "artifact_ingest_queued");
  assert.equal(await runtime.reconcileCompletedAssetIngests(10), 1);

  const completed = await runtime.service.getJob("owner-a", job.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.stage, "completed");
  assert.equal(completed.outputUrl, undefined);
  assert.ok(completed.outputAssetId);
  const asset = await assets.get("owner-a", completed.outputAssetId!);
  assert.equal(asset?.storageProvider, "owned-object-storage");
  assert.equal(asset?.renderJobId, job.id);
  assert.equal(asset?.source.originalUrl, undefined);
  assert.equal(asset?.source.finalUrl, undefined);
  assert.equal(asset?.deliveryUrl, null);
  assert.match(asset?.storageKey ?? "", /\/sha256\/[a-f0-9]{64}\.mp4$/u);
});
