import assert from "node:assert/strict";
import test from "node:test";
import {
  AssetIngestFailure,
  NodeHttpsArtifactReader,
  isPublicIp,
  type ExactHostSsrfPolicy,
  type PinnedHttpsRequest,
  type StreamingHttpsResponse,
  type StreamingHttpsTransport,
} from "../server/ai-media-studio/assets";

const PUBLIC_V4 = "93.184.216.34";

function policy(overrides: Partial<ExactHostSsrfPolicy> = {}): ExactHostSsrfPolicy {
  return {
    allowedHosts: new Set(["cdn.provider.example"]),
    requireHttps: true,
    requireStandardPort: true,
    maxRedirects: 2,
    async resolvePublicAddresses() { return [PUBLIC_V4]; },
    ...overrides,
  };
}

function response(input: {
  status?: number;
  headers?: StreamingHttpsResponse["headers"];
  chunks?: readonly unknown[];
  bodyError?: Error;
} = {}): StreamingHttpsResponse & { discarded: number; aborted: number } {
  const result: StreamingHttpsResponse & { discarded: number; aborted: number } = {
    statusCode: input.status ?? 200,
    headers: input.headers ?? { "content-type": "video/mp4" },
    discarded: 0,
    aborted: 0,
    body: (async function* () {
      for (const chunk of input.chunks ?? []) yield chunk;
      if (input.bodyError) throw input.bodyError;
    })(),
    discard() { result.discarded += 1; },
    abort() { result.aborted += 1; },
  };
  return result;
}

class FakeTransport implements StreamingHttpsTransport {
  readonly calls: PinnedHttpsRequest[] = [];
  constructor(private readonly results: Array<StreamingHttpsResponse | Error>) {}

  async request(input: PinnedHttpsRequest): Promise<StreamingHttpsResponse> {
    this.calls.push(input);
    const next = this.results.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  }
}

function open(reader: NodeHttpsArtifactReader, url: string, sourcePolicy = policy(), overrides: { maxBytes?: number; maxChunkBytes?: number } = {}) {
  return reader.open({
    url,
    policy: sourcePolicy,
    maxBytes: overrides.maxBytes ?? 1_024,
    maxChunkBytes: overrides.maxChunkBytes ?? 512,
  });
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const output: Uint8Array[] = [];
  for await (const chunk of chunks) output.push(chunk);
  return output;
}

async function expectFailure(operation: Promise<unknown> | (() => Promise<unknown>), code: AssetIngestFailure["code"], retryable: boolean) {
  const promise = typeof operation === "function" ? operation() : operation;
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AssetIngestFailure);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal(error.message, code);
    return true;
  });
}

test("reader rejects non-HTTPS, credentials, nonstandard ports, and non-exact hosts without transport calls", async () => {
  const transport = new FakeTransport([]);
  const reader = new NodeHttpsArtifactReader({ transport });
  const urls = [
    "http://cdn.provider.example/video.mp4",
    "https://user:password@cdn.provider.example/video.mp4",
    "https://cdn.provider.example:8443/video.mp4",
    "https://cdn.provider.example.evil.test/video.mp4",
    "https://sub.cdn.provider.example/video.mp4",
  ];
  for (const url of urls) await expectFailure(open(reader, url), "source_rejected", false);
  assert.equal(transport.calls.length, 0);
});

test("reader rejects every private, reserved, or mixed DNS answer with the shared IPv4/IPv6 classifier", async () => {
  for (const address of [
    "0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
    "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "ff00::1", "2001:db8::1", "::ffff:127.0.0.1",
  ]) assert.equal(isPublicIp(address), false, address);
  assert.equal(isPublicIp(PUBLIC_V4), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);

  const privateTransport = new FakeTransport([]);
  await expectFailure(open(
    new NodeHttpsArtifactReader({ transport: privateTransport }),
    "https://cdn.provider.example/video.mp4",
    policy({ async resolvePublicAddresses() { return [PUBLIC_V4, "127.0.0.1"]; } }),
  ), "source_rejected", false);
  assert.equal(privateTransport.calls.length, 0);
});

test("reader pins one validated address, retains TLS hostname, streams bytes, and redacts the query", async () => {
  const ok = response({
    headers: { "content-type": "video/mp4; charset=binary", "content-length": "4" },
    chunks: [new Uint8Array([1, 2]), Buffer.from([3, 4])],
  });
  const transport = new FakeTransport([ok]);
  const reader = new NodeHttpsArtifactReader({ transport, requestTimeoutMs: 1_234, userAgent: "reader-test" });
  const artifact = await open(reader, "https://CDN.PROVIDER.EXAMPLE/files/video.mp4?token=provider-secret#fragment");

  assert.equal(artifact.finalUrl, "https://cdn.provider.example/files/video.mp4");
  assert.equal(artifact.mimeType, "video/mp4; charset=binary");
  assert.equal(artifact.declaredSizeBytes, 4);
  assert.deepEqual(await collect(artifact.chunks), [new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
  assert.deepEqual(transport.calls[0], {
    hostname: "cdn.provider.example",
    path: "/files/video.mp4?token=provider-secret",
    pinnedAddress: PUBLIC_V4,
    addressFamily: 4,
    tlsServername: "cdn.provider.example",
    timeoutMs: 1_234,
    headers: { accept: "video/mp4, application/octet-stream;q=0.8", "user-agent": "reader-test" },
  });
  assert.equal(ok.aborted, 0);
});

test("every redirect target is allowlisted, re-resolved, and separately DNS-pinned", async () => {
  const redirect = response({ status: 307, headers: { location: "https://media.provider.example/final.mp4?signature=secret" } });
  const ok = response({ chunks: [new Uint8Array([1])] });
  const transport = new FakeTransport([redirect, ok]);
  const resolutions: string[] = [];
  const sourcePolicy = policy({
    allowedHosts: new Set(["cdn.provider.example", "media.provider.example"]),
    async resolvePublicAddresses(hostname) {
      resolutions.push(hostname);
      return hostname === "cdn.provider.example" ? [PUBLIC_V4] : ["2606:4700:4700::1111"];
    },
  });
  const artifact = await open(new NodeHttpsArtifactReader({ transport }), "https://cdn.provider.example/start", sourcePolicy);

  assert.deepEqual(await collect(artifact.chunks), [new Uint8Array([1])]);
  assert.deepEqual(resolutions, ["cdn.provider.example", "media.provider.example"]);
  assert.equal(redirect.aborted, 1);
  assert.equal(transport.calls[1]?.pinnedAddress, "2606:4700:4700::1111");
  assert.equal(transport.calls[1]?.addressFamily, 6);
  assert.equal(transport.calls[1]?.hostname, "media.provider.example");
  assert.equal(transport.calls[1]?.path, "/final.mp4?signature=secret");
  assert.equal(transport.calls[1]?.tlsServername, "media.provider.example");
  assert.equal(artifact.finalUrl, "https://media.provider.example/final.mp4");
});

test("redirect loops, redirect-limit overflow, missing Location, and unsafe targets fail closed", async () => {
  const loopA = response({ status: 302, headers: { location: "/b" } });
  const loopB = response({ status: 302, headers: { location: "/a" } });
  const loopTransport = new FakeTransport([loopA, loopB]);
  await expectFailure(open(new NodeHttpsArtifactReader({ transport: loopTransport }), "https://cdn.provider.example/a"), "source_rejected", false);
  assert.equal(loopTransport.calls.length, 2);

  for (const location of [undefined, "https://evil.example/video.mp4", "http://cdn.provider.example/video.mp4", "https://u:p@cdn.provider.example/video.mp4"]) {
    const redirect = response({ status: 302, headers: location ? { location } : {} });
    const transport = new FakeTransport([redirect]);
    await expectFailure(open(new NodeHttpsArtifactReader({ transport }), "https://cdn.provider.example/start"), "source_rejected", false);
    assert.equal(redirect.aborted, 1);
    assert.equal(transport.calls.length, 1);
  }

  const atLimit = response({ status: 308, headers: { location: "/next" } });
  await expectFailure(open(
    new NodeHttpsArtifactReader({ transport: new FakeTransport([atLimit]) }),
    "https://cdn.provider.example/start",
    policy({ maxRedirects: 0 }),
  ), "source_rejected", false);
  assert.equal(atLimit.aborted, 1);
});

test("HTTP failures are safely classified and response bodies are aborted without draining", async () => {
  for (const [status, code, retryable] of [
    [404, "source_rejected", false],
    [408, "source_unavailable", true],
    [429, "source_unavailable", true],
    [503, "source_unavailable", true],
  ] as const) {
    const failed = response({ status, chunks: [Buffer.from("provider error contains secret") ] });
    await expectFailure(open(new NodeHttpsArtifactReader({ transport: new FakeTransport([failed]) }), "https://cdn.provider.example/video"), code, retryable);
    assert.equal(failed.aborted, 1);
  }
});

test("invalid or oversized Content-Length fails before body consumption", async () => {
  for (const [value, code] of [["-1", "source_rejected"], ["1.5", "source_rejected"], [" 4", "source_rejected"], ["9007199254740992", "source_rejected"], ["11", "size_exceeded"]] as const) {
    const failed = response({ headers: { "content-length": value }, chunks: [new Uint8Array([1])] });
    await expectFailure(open(
      new NodeHttpsArtifactReader({ transport: new FakeTransport([failed]) }),
      "https://cdn.provider.example/video",
      policy(),
      { maxBytes: 10 },
    ), code, false);
    assert.equal(failed.aborted, 1);
  }
});

test("streaming bounds abort immediately on an oversized chunk or cumulative body", async () => {
  const oversizedChunk = response({ chunks: [new Uint8Array(5)] });
  const chunkArtifact = await open(
    new NodeHttpsArtifactReader({ transport: new FakeTransport([oversizedChunk]) }),
    "https://cdn.provider.example/video",
    policy(),
    { maxBytes: 10, maxChunkBytes: 4 },
  );
  await expectFailure(collect(chunkArtifact.chunks), "chunk_exceeded", false);
  assert.ok(oversizedChunk.aborted >= 1);

  const oversizedBody = response({ chunks: [new Uint8Array(4), new Uint8Array(4)] });
  const bodyArtifact = await open(
    new NodeHttpsArtifactReader({ transport: new FakeTransport([oversizedBody]) }),
    "https://cdn.provider.example/video",
    policy(),
    { maxBytes: 7, maxChunkBytes: 4 },
  );
  await expectFailure(collect(bodyArtifact.chunks), "size_exceeded", false);
  assert.ok(oversizedBody.aborted >= 1);
});

test("transport timeouts, DNS errors, and body aborts map to retryable safe failures without URL leakage", async () => {
  const providerSecret = "provider-secret-query-value";
  await expectFailure(open(
    new NodeHttpsArtifactReader({ transport: new FakeTransport([new Error(`timeout ${providerSecret}`)]) }),
    `https://cdn.provider.example/video?token=${providerSecret}`,
  ), "source_unavailable", true);

  await expectFailure(open(
    new NodeHttpsArtifactReader({ transport: new FakeTransport([]) }),
    `https://cdn.provider.example/video?token=${providerSecret}`,
    policy({ async resolvePublicAddresses() { throw new Error(`dns ${providerSecret}`); } }),
  ), "source_unavailable", true);

  const aborted = response({ chunks: [new Uint8Array([1])], bodyError: new Error(`socket ${providerSecret}`) });
  const artifact = await open(new NodeHttpsArtifactReader({ transport: new FakeTransport([aborted]) }), `https://cdn.provider.example/video?token=${providerSecret}`);
  await expectFailure(collect(artifact.chunks), "source_unavailable", true);
  assert.ok(aborted.aborted >= 1);
});

test("ending consumption early aborts the streaming response", async () => {
  const streaming = response({ chunks: [new Uint8Array([1]), new Uint8Array([2])] });
  const artifact = await open(new NodeHttpsArtifactReader({ transport: new FakeTransport([streaming]) }), "https://cdn.provider.example/video");
  for await (const _chunk of artifact.chunks) break;
  assert.equal(streaming.aborted, 1);
});

test("reader validates positive request and streaming bounds", async () => {
  assert.throws(() => new NodeHttpsArtifactReader({ requestTimeoutMs: 0 }), /positive integer/);
  const reader = new NodeHttpsArtifactReader({ transport: new FakeTransport([]) });
  await expectFailure(reader.open({ url: "https://cdn.provider.example/video", policy: policy(), maxBytes: 0, maxChunkBytes: 1 }), "source_rejected", false);
  await expectFailure(reader.open({ url: "https://cdn.provider.example/video", policy: policy(), maxBytes: 1, maxChunkBytes: 0 }), "source_rejected", false);
});
