import assert from "node:assert/strict";
import test from "node:test";
import {
  AssetIngestFailure,
  AssetIngestWorker,
  FakeBoundedArtifactReader,
  InMemoryAssetIngestRepository,
  InMemoryOwnedObjectStorage,
  hasMp4FileTypeBox,
  type ArtifactReadStream,
  type AssetIngestWorkerHooks,
  type EnqueueAssetIngest,
  type ExactHostSsrfPolicy,
} from "../server/ai-media-studio/assets";

class MutableClock {
  constructor(private value: number) {}
  now() { return this.value; }
  advance(ms: number) { this.value += ms; }
}

const publicSourcePolicy: ExactHostSsrfPolicy = {
  allowedHosts: new Set(["cdn.provider.example"]),
  requireHttps: true,
  requireStandardPort: true,
  maxRedirects: 2,
  async resolvePublicAddresses() { return ["93.184.216.34"]; },
};

const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

function stream(overrides: Partial<ArtifactReadStream> = {}): ArtifactReadStream {
  return {
    finalUrl: "https://cdn.provider.example/output.mp4",
    mimeType: "video/mp4",
    declaredSizeBytes: mp4.byteLength,
    chunks: (async function* () { yield mp4.subarray(0, 7); yield mp4.subarray(7); })(),
    ...overrides,
  };
}

function createWorker(input: {
  repository: InMemoryAssetIngestRepository;
  reader: FakeBoundedArtifactReader;
  storage?: InMemoryOwnedObjectStorage;
  clock?: MutableClock;
  maxBytes?: number;
  maxChunkBytes?: number;
  hooks?: AssetIngestWorkerHooks;
}) {
  return new AssetIngestWorker({
    workerId: "ingest-worker",
    repository: input.repository,
    reader: input.reader,
    sourcePolicy: publicSourcePolicy,
    storage: input.storage ?? new InMemoryOwnedObjectStorage(),
    leaseDurationMs: 1_000,
    maxArtifactBytes: input.maxBytes ?? 1_000,
    maxChunkBytes: input.maxChunkBytes ?? 100,
    retry: { baseDelayMs: 100, maxDelayMs: 1_000 },
    clock: input.clock ?? new MutableClock(1_000),
    hooks: input.hooks,
  });
}

async function enqueue(repository: InMemoryAssetIngestRepository, overrides: Partial<EnqueueAssetIngest> = {}) {
  return repository.enqueue({
    id: "ingest-1",
    tenantId: "tenant-a",
    renderJobId: "render-1",
    sourceUrl: "https://cdn.provider.example/output.mp4?signature=secret",
    maxAttempts: 2,
    ...overrides,
  }, 1_000);
}

test("enqueue is idempotent by tenant and render job while tenant reads remain isolated", async () => {
  const repository = new InMemoryAssetIngestRepository();
  const first = await enqueue(repository);
  const duplicate = await repository.enqueue({
    id: "ignored-on-replay",
    tenantId: "tenant-a",
    renderJobId: "render-1",
    sourceUrl: "https://cdn.provider.example/output.mp4?signature=secret",
    maxAttempts: 9,
  }, 9_000);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.maxAttempts, 2, "webhook replay returns the original canonical job");
  assert.equal(await repository.getForTenant("tenant-b", first.id), undefined);
  assert.equal(await repository.findByRenderJob("tenant-b", "render-1"), undefined);
  await assert.rejects(() => repository.enqueue({
    id: "mismatch",
    tenantId: "tenant-a",
    renderJobId: "render-1",
    sourceUrl: "https://cdn.provider.example/different.mp4",
    maxAttempts: 2,
  }, 1_000), /different ingest input/);
});

test("expired leases are fenced and recovered without increasing the processing attempt", async () => {
  const repository = new InMemoryAssetIngestRepository();
  await enqueue(repository, { maxLeaseRecoveries: 2 });
  const first = await repository.claimDue({ workerId: "crashed", nowMs: 1_000, leaseDurationMs: 10 });
  assert.ok(first);
  assert.equal((await repository.reconcileExpiredLeases(1_010))[0]?.deadLettered, false);
  const second = await repository.claimDue({ workerId: "replacement", nowMs: 1_010, leaseDurationMs: 10 });
  assert.ok(second);
  assert.equal(await repository.complete({
    jobId: first.job.id,
    leaseToken: first.leaseToken,
    ownedObjectKey: "stale",
    sha256: "bad",
    sizeBytes: 1,
    nowMs: 1_011,
  }), undefined);
  assert.notEqual(first.leaseToken, second.leaseToken);
});

test("valid MP4 is streamed to tenant-owned storage with digest and bounded source policy", async () => {
  const repository = new InMemoryAssetIngestRepository();
  const storage = new InMemoryOwnedObjectStorage();
  const reader = new FakeBoundedArtifactReader(stream());
  await enqueue(repository);
  const result = await createWorker({ repository, reader, storage }).runNext();
  assert.equal(result.outcome, "completed");
  if (result.outcome !== "completed") return;
  assert.match(result.job.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.job.sizeBytes, mp4.byteLength);
  assert.ok(result.job.ownedObjectKey?.startsWith("ai-media-studio/tenant-a/sha256/"));
  assert.deepEqual(storage.getForTenant("tenant-a", result.job.ownedObjectKey!)?.bytes, mp4);
  assert.equal(storage.getForTenant("tenant-b", result.job.ownedObjectKey!), undefined);
  assert.equal(reader.requests[0]?.policy, publicSourcePolicy);
  assert.equal(reader.requests[0]?.maxBytes, 1_000);
  assert.equal(reader.requests[0]?.maxChunkBytes, 100);
});

test("MIME, declared/streamed size, chunk, and MP4 signature violations are permanent", async (context) => {
  const cases: Array<{ name: string; response: ArtifactReadStream; maxBytes?: number; maxChunkBytes?: number; code: string }> = [
    { name: "mime", response: stream({ mimeType: "text/html" }), code: "mime_rejected" },
    { name: "declared size", response: stream({ declaredSizeBytes: 2_000 }), maxBytes: 1_000, code: "size_exceeded" },
    { name: "streamed size", response: stream({ declaredSizeBytes: undefined, chunks: (async function* () { yield new Uint8Array(60); yield new Uint8Array(41); })() }), maxBytes: 100, maxChunkBytes: 100, code: "size_exceeded" },
    { name: "chunk", response: stream({ declaredSizeBytes: undefined, chunks: (async function* () { yield new Uint8Array(101); })() }), maxBytes: 1_000, maxChunkBytes: 100, code: "chunk_exceeded" },
    { name: "signature", response: stream({ declaredSizeBytes: 16, chunks: (async function* () { yield new Uint8Array(16); })() }), code: "invalid_mp4" },
  ];
  for (const entry of cases) await context.test(entry.name, async () => {
    const repository = new InMemoryAssetIngestRepository();
    const storage = new InMemoryOwnedObjectStorage();
    await enqueue(repository);
    const result = await createWorker({ repository, reader: new FakeBoundedArtifactReader(entry.response), storage, maxBytes: entry.maxBytes, maxChunkBytes: entry.maxChunkBytes }).runNext();
    assert.equal(result.outcome, "dead_letter");
    if (result.outcome === "dead_letter") assert.equal(result.job.lastErrorCode, entry.code);
    assert.equal(storage.abortedKeys.length, entry.name === "mime" || entry.name === "declared size" ? 0 : 1);
  });
});

test("transient failures retry with backoff, dead-letter at the bound, and redact provider details", async () => {
  const repository = new InMemoryAssetIngestRepository();
  const clock = new MutableClock(1_000);
  const secret = "https://cdn.provider.example/file.mp4?token=do-not-store";
  const reader = new FakeBoundedArtifactReader(() => { throw new Error(`fetch failed: ${secret}`); });
  await enqueue(repository, { sourceUrl: secret });
  const worker = createWorker({ repository, reader, clock });
  const first = await worker.runNext();
  assert.equal(first.outcome, "retry_scheduled");
  if (first.outcome !== "retry_scheduled") return;
  assert.equal(first.job.lastErrorCode, "ingest_failed");
  assert.equal(first.job.availableAtMs, 1_100);
  assert.equal(JSON.stringify(first.job).includes("do-not-store"), true, "the source URL remains input data, never an error field");
  assert.equal(JSON.stringify({ lastErrorCode: first.job.lastErrorCode }).includes("do-not-store"), false);
  assert.equal((await worker.runNext()).outcome, "idle");
  clock.advance(100);
  const final = await worker.runNext();
  assert.equal(final.outcome, "dead_letter");
  assert.equal((await repository.listDeadLetters("tenant-b")).length, 0);
  assert.equal((await repository.listDeadLetters("tenant-a"))[0]?.lastErrorCode, "ingest_failed");
});

test("known source policy failures preserve only their safe code", async () => {
  const repository = new InMemoryAssetIngestRepository();
  await enqueue(repository);
  const reader = new FakeBoundedArtifactReader(() => { throw new AssetIngestFailure("source_rejected", false, "URL contained api_key=secret"); });
  const result = await createWorker({ repository, reader }).runNext();
  assert.equal(result.outcome, "dead_letter");
  if (result.outcome === "dead_letter") assert.equal(result.job.lastErrorCode, "source_rejected");
  assert.equal(hasMp4FileTypeBox(mp4), true);
  assert.equal(hasMp4FileTypeBox(new Uint8Array(12)), false);
});

test("worker refuses wildcard or non-HTTPS source-policy configuration", () => {
  const repository = new InMemoryAssetIngestRepository();
  const reader = new FakeBoundedArtifactReader(stream());
  assert.throws(() => new AssetIngestWorker({
    workerId: "worker",
    repository,
    reader,
    sourcePolicy: { ...publicSourcePolicy, allowedHosts: new Set(["*.provider.example"]) },
    storage: new InMemoryOwnedObjectStorage(),
    leaseDurationMs: 100,
    maxArtifactBytes: 1_000,
    maxChunkBytes: 100,
    retry: { baseDelayMs: 10, maxDelayMs: 100 },
  }), /exact lowercase hostnames/);
});

test("an object committed before a repository outage is safely reused on retry", async () => {
  class CompleteOnceUnavailableRepository extends InMemoryAssetIngestRepository {
    private unavailable = true;
    override async complete(input: Parameters<InMemoryAssetIngestRepository["complete"]>[0]) {
      if (this.unavailable) {
        this.unavailable = false;
        throw new Error("database unavailable");
      }
      return super.complete(input);
    }
  }
  const repository = new CompleteOnceUnavailableRepository();
  const storage = new InMemoryOwnedObjectStorage();
  const clock = new MutableClock(1_000);
  await enqueue(repository);
  const reader = new FakeBoundedArtifactReader(() => stream());
  const worker = createWorker({ repository, reader, storage, clock });
  const first = await worker.runNext();
  assert.equal(first.outcome, "retry_scheduled");
  clock.advance(100);
  const second = await worker.runNext();
  assert.equal(second.outcome, "completed");
  if (second.outcome === "completed") {
    assert.deepEqual(storage.getForTenant("tenant-a", second.job.ownedObjectKey!)?.bytes, mp4);
    assert.equal(second.job.attempt, 2);
  }
});

test("different render jobs with identical content share one tenant-scoped final object", async () => {
  const repository = new InMemoryAssetIngestRepository();
  const storage = new InMemoryOwnedObjectStorage();
  const reader = new FakeBoundedArtifactReader(() => stream());
  await enqueue(repository);
  await enqueue(repository, { id: "ingest-2", renderJobId: "render-2" });
  const worker = createWorker({ repository, reader, storage });
  const first = await worker.runNext();
  const second = await worker.runNext();
  assert.equal(first.outcome, "completed");
  assert.equal(second.outcome, "completed");
  if (first.outcome === "completed" && second.outcome === "completed") {
    assert.equal(first.job.ownedObjectKey, second.job.ownedObjectKey);
    assert.equal(first.job.sha256, second.job.sha256);
  }
  assert.equal(storage.countForTenant("tenant-a"), 1);
});

test("canonical media linking happens after fenced completion and failed linking reconciles", async () => {
  const repository = new InMemoryAssetIngestRepository();
  await enqueue(repository);
  let calls = 0;
  const worker = createWorker({
    repository,
    reader: new FakeBoundedArtifactReader(() => stream()),
    hooks: {
      async onCompleted(job) {
        assert.equal(job.state, "completed", "materialization never runs under a stale ingest lease");
        calls += 1;
        if (calls === 1) throw new Error("media repository temporarily unavailable with token=secret");
        return { mediaAssetId: "asset-canonical" };
      },
    },
  });
  const first = await worker.runNext();
  assert.equal(first.outcome, "completed_unlinked");
  assert.equal((await repository.listCompletedUnlinked(10)).length, 1);
  assert.deepEqual(await worker.reconcileCompletedUnlinked(10), { linked: 1, remaining: 0 });
  assert.equal((await repository.getForTenant("tenant-a", "ingest-1"))?.mediaAssetId, "asset-canonical");
  assert.equal((await repository.listCompletedUnlinked(10)).length, 0);
  assert.equal(await repository.attachMediaAsset({ tenantId: "tenant-b", jobId: "ingest-1", mediaAssetId: "leak", nowMs: 2_000 }), undefined);
  await assert.rejects(() => repository.attachMediaAsset({ tenantId: "tenant-a", jobId: "ingest-1", mediaAssetId: "different", nowMs: 2_000 }), /different media asset/);
  await assert.rejects(() => repository.listCompletedUnlinked(101), /between 1 and 100/);
});
