import assert from "node:assert/strict";
import test from "node:test";
import { AssetService, MEDIA_ASSET_TYPES } from "../server/ai-media-studio/core/asset-domain";
import {
  DeterministicMediaMetadataExtractor,
  FakeRemoteMediaDownloader,
  InMemoryMediaAssetRepository,
  InMemoryMediaAssetStorage,
} from "../server/ai-media-studio/core/in-memory-asset-repository";
import {
  type HostAddressResolver,
  type RemoteMediaResponse,
  type RemoteMediaTransport,
  SafeRemoteMediaDownloader,
} from "../server/ai-media-studio/core/safe-media-downloader";

class ScriptedTransport implements RemoteMediaTransport {
  readonly requests: Array<{ url: string; approvedAddresses: readonly string[]; maxBytes: number }> = [];
  constructor(private readonly responses: Map<string, RemoteMediaResponse>) {}
  async request(input: { url: string; approvedAddresses: readonly string[]; maxBytes: number }): Promise<RemoteMediaResponse> {
    this.requests.push({ url: input.url, approvedAddresses: [...input.approvedAddresses], maxBytes: input.maxBytes });
    const response = this.responses.get(input.url);
    if (!response) throw new Error(`Missing response for ${input.url}`);
    return { ...response, body: new Uint8Array(response.body) };
  }
}

const publicResolver: HostAddressResolver = async () => ["93.184.216.34"];

function safeDownloader(
  responses: Map<string, RemoteMediaResponse>,
  overrides: Partial<ConstructorParameters<typeof SafeRemoteMediaDownloader>[0]> = {},
) {
  const transport = new ScriptedTransport(responses);
  const downloader = new SafeRemoteMediaDownloader({
    allowedHosts: new Set(["media.example.com", "cdn.example.com"]),
    resolveHost: publicResolver,
    transport,
    ...overrides,
  });
  return { downloader, transport };
}

test("the asset domain covers every reusable media library type", () => {
  assert.deepEqual(MEDIA_ASSET_TYPES, ["video", "script", "voice", "b_roll", "image", "music", "logo", "subtitle", "thumbnail"]);
});

test("safe downloader rejects SSRF vectors before transport", async () => {
  const cases: Array<[string, HostAddressResolver, RegExp]> = [
    ["http://media.example.com/file.mp4", publicResolver, /HTTPS/i],
    ["https://user:pass@media.example.com/file.mp4", publicResolver, /credentials/i],
    ["https://evil.example.com/file.mp4", publicResolver, /allowlisted/i],
    ["https://media.example.com:8443/file.mp4", publicResolver, /standard HTTPS port/i],
    ["https://media.example.com/file.mp4", async () => ["127.0.0.1"], /private or reserved/i],
    ["https://media.example.com/file.mp4", async () => ["169.254.169.254"], /private or reserved/i],
    ["https://media.example.com/file.mp4", async () => ["::1"], /private or reserved/i],
    ["https://media.example.com/file.mp4", async () => ["::ffff:127.0.0.1"], /private or reserved/i],
  ];
  for (const [url, resolveHost, expected] of cases) {
    const { downloader, transport } = safeDownloader(new Map(), { resolveHost });
    await assert.rejects(() => downloader.download({ url, type: "video" }), expected);
    assert.equal(transport.requests.length, 0);
  }
});

test("revalidates allowlist and DNS on every redirect and pins approved addresses", async () => {
  const first = "https://media.example.com/start";
  const final = "https://cdn.example.com/video.mp4";
  const responses = new Map<string, RemoteMediaResponse>([
    [first, { status: 302, headers: { Location: final }, body: new Uint8Array() }],
    [final, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": "3" }, body: Uint8Array.of(1, 2, 3) }],
  ]);
  const resolutions: Record<string, readonly string[]> = {
    "media.example.com": ["93.184.216.34"],
    "cdn.example.com": ["8.8.8.8"],
  };
  const { downloader, transport } = safeDownloader(responses, { resolveHost: async (hostname) => resolutions[hostname] ?? [] });
  const result = await downloader.download({ url: first, type: "video" });
  assert.equal(result.finalUrl, final);
  assert.deepEqual(transport.requests, [
    { url: first, approvedAddresses: ["93.184.216.34"], maxBytes: 500_000_000 },
    { url: final, approvedAddresses: ["8.8.8.8"], maxBytes: 500_000_000 },
  ]);

  const privateRedirect = safeDownloader(new Map([
    [first, { status: 302, headers: { location: final }, body: new Uint8Array() }],
  ]), { resolveHost: async (hostname) => hostname === "cdn.example.com" ? ["10.0.0.2"] : ["93.184.216.34"] });
  await assert.rejects(() => privateRedirect.downloader.download({ url: first, type: "video" }), /private or reserved/i);
  assert.equal(privateRedirect.transport.requests.length, 1);
});

test("rejects redirect loops, disallowed MIME types and declared or actual oversize bodies", async () => {
  const url = "https://media.example.com/file";
  const redirectLoop = safeDownloader(new Map([
    [url, { status: 302, headers: { location: url }, body: new Uint8Array() }],
  ]));
  await assert.rejects(() => redirectLoop.downloader.download({ url, type: "video" }), /redirect loop/i);

  const wrongMime = safeDownloader(new Map([
    [url, { status: 200, headers: { "content-type": "text/html" }, body: Uint8Array.of(1) }],
  ]));
  await assert.rejects(() => wrongMime.downloader.download({ url, type: "video" }), /MIME type/i);

  const declaredLarge = safeDownloader(new Map([
    [url, { status: 200, headers: { "content-type": "video/mp4", "content-length": "4" }, body: Uint8Array.of(1) }],
  ]), { maxBytesByType: { video: 3 } });
  await assert.rejects(() => declaredLarge.downloader.download({ url, type: "video" }), /byte limit/i);

  const actualLarge = safeDownloader(new Map([
    [url, { status: 200, headers: { "content-type": "video/mp4" }, body: Uint8Array.of(1, 2, 3, 4) }],
  ]), { maxBytesByType: { video: 3 } });
  await assert.rejects(() => actualLarge.downloader.download({ url, type: "video" }), /byte limit/i);
});

test("imports assets with checksum dedupe, metadata, opaque storage and tenant isolation", async () => {
  const bytes = Uint8Array.of(1, 2, 3, 4);
  const remote = new FakeRemoteMediaDownloader().register("https://media.example.com/a.mp4", {
    bytes,
    mimeType: "video/mp4",
    finalUrl: "https://cdn.example.com/a.mp4",
  });
  const repository = new InMemoryMediaAssetRepository();
  const storage = new InMemoryMediaAssetStorage();
  let id = 0;
  const service = new AssetService(
    repository,
    storage,
    remote,
    new DeterministicMediaMetadataExtractor({ video: { width: 1080, height: 1920, durationMs: 4000, codec: "h264" } }),
    () => new Date("2026-07-20T12:00:00.000Z"),
    () => `asset-${++id}`,
  );

  const first = await service.importRemote("tenant-a", { type: "video", name: "Launch video", url: "https://media.example.com/a.mp4" });
  const duplicate = await service.importRemote("tenant-a", { type: "video", name: "Duplicate name", url: "https://media.example.com/a.mp4" });
  assert.equal(first.deduplicated, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.asset.id, first.asset.id);
  assert.equal(storage.size(), 1);
  assert.ok(first.asset.checksumSha256);
  assert.match(first.asset.checksumSha256, /^[a-f0-9]{64}$/u);
  assert.equal(first.asset.storageKey, "media-assets/asset-1");
  assert.equal(first.asset.workspaceId, "personal");
  assert.equal(first.asset.status, "ready");
  assert.equal(first.asset.storageProvider, "internal");
  assert.equal(first.asset.deliveryUrl, null);
  assert.equal(first.asset.thumbnailUrl, null);
  assert.equal(first.asset.projectId, null);
  assert.equal(first.asset.influencerId, null);
  assert.equal(first.asset.deletedAt, null);
  assert.deepEqual(first.asset.metadata, { width: 1080, height: 1920, durationMs: 4000, codec: "h264" });
  assert.deepEqual(first.asset.source, {
    kind: "remote",
    originalUrl: "https://media.example.com/a.mp4",
    finalUrl: "https://cdn.example.com/a.mp4",
  });

  const otherTenant = await service.importRemote("tenant-b", { type: "video", name: "Tenant B copy", url: "https://media.example.com/a.mp4" });
  assert.notEqual(otherTenant.asset.id, first.asset.id);
  assert.equal(storage.size(), 2);
  assert.deepEqual(await service.list("tenant-a"), [first.asset]);
  assert.deepEqual(await service.list("tenant-b"), [otherTenant.asset]);
  await assert.rejects(() => service.get("tenant-b", first.asset.id), /not found/i);
});

test("in-memory lifecycle assets without checksums remain distinct and workspace scoped", async () => {
  const repository = new InMemoryMediaAssetRepository("workspace-a");
  const base = {
    ownerUserId: "tenant-a",
    workspaceId: "workspace-a",
    type: "video" as const,
    name: "Pending render",
    status: "processing" as const,
    mimeType: "video/mp4",
    sizeBytes: null,
    checksumSha256: null,
    storageProvider: "internal",
    storageKey: "media-assets/pending-1",
    deliveryUrl: null,
    thumbnailUrl: null,
    projectId: "project-a",
    renderJobId: "render-a",
    influencerId: "influencer-a",
    providerResourceId: null,
    source: { kind: "text" as const },
    metadata: {},
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    deletedAt: null,
  };
  const first = await repository.createOrGet({ ...base, id: "pending-1" });
  const second = await repository.createOrGet({ ...base, id: "pending-2" });
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal((await repository.list("tenant-a")).length, 2);
  await assert.rejects(
    () => repository.createOrGet({ ...base, id: "foreign-workspace", workspaceId: "workspace-b" }),
    /workspace does not match/i,
  );
});

test("creates reusable text assets without accepting filesystem paths", async () => {
  const repository = new InMemoryMediaAssetRepository();
  const storage = new InMemoryMediaAssetStorage();
  let id = 0;
  const service = new AssetService(
    repository,
    storage,
    new FakeRemoteMediaDownloader(),
    new DeterministicMediaMetadataExtractor(),
    () => new Date("2026-07-20T12:00:00.000Z"),
    () => `text-${++id}`,
  );
  const script = await service.createText("tenant-a", { type: "script", name: "Miami hook", text: "Three Miami spots you need to see.", language: "en" });
  assert.equal(script.asset.mimeType, "text/plain");
  assert.deepEqual(script.asset.metadata, { language: "en" });
  assert.equal((await storage.get(script.asset.storageKey))?.bytes.byteLength, new TextEncoder().encode("Three Miami spots you need to see.").byteLength);
  await assert.rejects(() => service.createText("tenant-a", { type: "script", name: "../../escape", text: "blocked" }), /filesystem path/i);
  await assert.rejects(() => storage.put({ storageKey: "../../escape", bytes: Uint8Array.of(1), mimeType: "text/plain" }), /opaque media storage key/i);
});
