import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KONG_SOURCE_FEED_ENDPOINT,
  HttpKongSourceReader,
  HttpKongSourceReaderError,
  type PinnedHttpsRequest,
  type StreamingHttpsResponse,
  type StreamingHttpsTransport,
} from "../server/ai-media-studio/sources";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const PUBLIC_V4 = "93.184.216.34";
const at = "2026-07-22T13:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;

function cursor(): string {
  return Buffer.from(JSON.stringify({ v: "1", u: at, i: "event:event-1" })).toString("base64url");
}

function feed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "1",
    capturedAt: at,
    items: [{
      id: "event:event-1",
      category: "events",
      title: "Public event",
      summary: "A public catalog summary.",
      publishedAt: at,
      updatedAt: at,
      fingerprint: digest,
      attributes: { eventCategory: "nightclub", startAt: at, venueName: "KONG Club" },
    }],
    page: { limit: 1, hasMore: true, nextCursor: cursor() },
    ...overrides,
  };
}

function response(input: {
  status?: number;
  headers?: StreamingHttpsResponse["headers"];
  chunks?: readonly unknown[];
  bodyError?: Error;
} = {}): StreamingHttpsResponse & { aborts: number } {
  const result: StreamingHttpsResponse & { aborts: number } = {
    statusCode: input.status ?? 200,
    headers: input.headers ?? { "content-type": "application/json" },
    aborts: 0,
    body: (async function* () {
      for (const chunk of input.chunks ?? []) yield chunk;
      if (input.bodyError) throw input.bodyError;
    })(),
    discard() { result.aborts += 1; },
    abort() { result.aborts += 1; },
  };
  return result;
}

function jsonResponse(value: unknown, headers: StreamingHttpsResponse["headers"] = {}): ReturnType<typeof response> {
  const body = Buffer.from(JSON.stringify(value));
  return response({ headers: { "content-type": "application/json; charset=utf-8", "content-length": String(body.byteLength), ...headers }, chunks: [body] });
}

class FakeTransport implements StreamingHttpsTransport {
  readonly calls: PinnedHttpsRequest[] = [];
  constructor(private readonly outcomes: Array<StreamingHttpsResponse | Error>) {}
  async request(input: PinnedHttpsRequest): Promise<StreamingHttpsResponse> {
    this.calls.push(input);
    const outcome = this.outcomes.shift();
    if (!outcome || outcome instanceof Error) throw outcome ?? new Error("unexpected request");
    return outcome;
  }
}

function reader(transport: FakeTransport, addresses: readonly string[] = [PUBLIC_V4], options: Partial<ConstructorParameters<typeof HttpKongSourceReader>[0]> = {}) {
  return new HttpKongSourceReader({
    endpoint: "https://feed.kong.example/api/ai-media-studio/source-feed",
    transport,
    resolvePublicAddresses: async () => addresses,
    ...options,
  });
}

async function expectSafeFailure(operation: Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof HttpKongSourceReaderError);
    assert.equal(error.code, "KONG_SOURCE_FEED_UNAVAILABLE");
    assert.equal(error.message, "Kong source feed is unavailable");
    assert.doesNotMatch(String(error), /feed\.kong|source-feed|secret|private-body/u);
    return true;
  });
}

test("construction is inert and the production default is the exact HTTPS Kong feed", () => {
  let resolutions = 0;
  let requests = 0;
  const transport: StreamingHttpsTransport = { async request() { requests += 1; throw new Error("unused"); } };
  new HttpKongSourceReader({ transport, resolvePublicAddresses: async () => { resolutions += 1; return [PUBLIC_V4]; } });
  assert.equal(DEFAULT_KONG_SOURCE_FEED_ENDPOINT, "https://kong--app.replit.app/api/ai-media-studio/source-feed");
  assert.equal(resolutions, 0);
  assert.equal(requests, 0);
});

test("endpoint configuration rejects non-HTTPS, credentials, non-443 ports, IP literals, query, and fragments", () => {
  for (const endpoint of [
    "http://feed.kong.example/api/ai-media-studio/source-feed",
    "https://u:p@feed.kong.example/api/ai-media-studio/source-feed",
    "https://feed.kong.example:8443/api/ai-media-studio/source-feed",
    "https://127.0.0.1/api/ai-media-studio/source-feed",
    "https://[::1]/api/ai-media-studio/source-feed",
    "https://feed.kong.example/api/ai-media-studio/source-feed?target=private",
    "https://feed.kong.example/api/ai-media-studio/source-feed#fragment",
  ]) assert.throws(() => new HttpKongSourceReader({ endpoint }), HttpKongSourceReaderError);
});

test("all DNS answers must be public and the selected address is pinned while TLS retains the exact hostname", async () => {
  for (const addresses of [[], [PUBLIC_V4, "127.0.0.1"], ["169.254.169.254"], ["not-an-ip"]]) {
    const transport = new FakeTransport([]);
    await expectSafeFailure(reader(transport, addresses).read(scope, { limit: 1 }));
    assert.equal(transport.calls.length, 0);
  }

  const transport = new FakeTransport([jsonResponse(feed())]);
  await reader(transport, [PUBLIC_V4, "2606:4700:4700::1111"], { requestTimeoutMs: 1_234, userAgent: "reader-test" })
    .read(scope, { limit: 1, cursor: cursor() });
  assert.deepEqual(transport.calls[0], {
    hostname: "feed.kong.example",
    path: `/api/ai-media-studio/source-feed?limit=1&cursor=${cursor()}`,
    pinnedAddress: PUBLIC_V4,
    addressFamily: 4,
    tlsServername: "feed.kong.example",
    timeoutMs: 1_234,
    headers: { accept: "application/json", "user-agent": "reader-test" },
  });
});

test("strict v1 response maps the string fingerprint and safe attributes into detached records", async () => {
  const transport = new FakeTransport([jsonResponse(feed())]);
  const page = await reader(transport).read(scope, { limit: 1 });
  assert.equal(page.capturedAt, at);
  assert.equal(page.nextCursor, cursor());
  assert.deepEqual(page.records[0], {
    id: "event:event-1",
    category: "events",
    title: "Public event",
    summary: "A public catalog summary.",
    publishedAt: at,
    fingerprint: { digest },
    attributes: { eventCategory: "nightclub", startAt: at, venueName: "KONG Club" },
  });
  assert.ok(Object.isFrozen(page));
  assert.ok(Object.isFrozen(page.records));
  assert.ok(Object.isFrozen(page.records[0]));
  assert.ok(Object.isFrozen(page.records[0]?.attributes));
});

test("request cursors are canonical, bounded base64url and invalid requests fail before DNS or HTTP", async () => {
  let resolutions = 0;
  const transport = new FakeTransport([]);
  const source = reader(transport, [PUBLIC_V4], { resolvePublicAddresses: async () => { resolutions += 1; return [PUBLIC_V4]; } });
  const invalidCursors = [
    "not-json",
    Buffer.from(JSON.stringify({ v: "2", u: at, i: "event:event-1" })).toString("base64url"),
    `${cursor()}=`,
    "x".repeat(1_025),
  ];
  for (const request of [{ limit: 0 }, { limit: 101 }, ...invalidCursors.map((value) => ({ limit: 1, cursor: value }))]) {
    await expectSafeFailure(source.read(scope, request));
  }
  assert.equal(resolutions, 0);
  assert.equal(transport.calls.length, 0);
});

test("redirects, status errors, non-JSON media types, and malformed content lengths abort without consuming error bodies", async () => {
  for (const failed of [
    response({ status: 302, headers: { location: "https://private.example/secret" }, chunks: [Buffer.from("private-body")] }),
    response({ status: 503, chunks: [Buffer.from("private-body")] }),
    response({ headers: { "content-type": "text/json" }, chunks: [Buffer.from("{}") ] }),
    response({ headers: { "content-type": "application/json", "content-length": "01" }, chunks: [Buffer.from("{}") ] }),
  ]) {
    await expectSafeFailure(reader(new FakeTransport([failed])).read(scope, { limit: 1 }));
    assert.equal(failed.aborts, 1);
  }
});

test("declared size, streamed body size, individual chunks, and chunk count are independently bounded", async () => {
  const cases = [
    response({ headers: { "content-type": "application/json", "content-length": "17" }, chunks: [] }),
    response({ headers: { "content-type": "application/json" }, chunks: [Buffer.alloc(9)] }),
    response({ headers: { "content-type": "application/json" }, chunks: [Buffer.alloc(5), Buffer.alloc(5)] }),
    response({ headers: { "content-type": "application/json" }, chunks: [Buffer.from("{"), Buffer.from("}"), Buffer.from(" ")] }),
  ];
  for (const failed of cases) {
    await expectSafeFailure(reader(new FakeTransport([failed]), [PUBLIC_V4], {
      maxResponseBytes: 8,
      maxChunkBytes: 4,
      maxChunks: 2,
    }).read(scope, { limit: 1 }));
    assert.ok(failed.aborts >= 1);
  }
});

test("strict schema rejects extra fields, wrong versions, unsafe attributes, oversized pages, and inconsistent cursors", async () => {
  const validItem = (feed().items as unknown[])[0] as Record<string, unknown>;
  const malformed = [
    feed({ version: "2" }),
    { ...feed(), private: "secret" },
    feed({ items: [{ ...validItem, ownerEmail: "secret@example.com" }] }),
    feed({ items: [{ ...validItem, attributes: { phone: "305-555-0100" } }] }),
    feed({ items: [validItem, validItem] }),
    feed({ page: { limit: 1, hasMore: false, nextCursor: cursor() } }),
    feed({ page: { limit: 1, hasMore: true, nextCursor: "not-canonical" } }),
  ];
  for (const body of malformed) {
    const failed = jsonResponse(body);
    await expectSafeFailure(reader(new FakeTransport([failed])).read(scope, { limit: 1 }));
    assert.ok(failed.aborts >= 1);
  }
});

test("transport, body, UTF-8, and JSON errors surface only the stable redacted failure", async () => {
  const operations = [
    reader(new FakeTransport([new Error("secret URL https://private.example")])).read(scope, { limit: 1 }),
    reader(new FakeTransport([response({ bodyError: new Error("private-body") })])).read(scope, { limit: 1 }),
    reader(new FakeTransport([response({ chunks: [new Uint8Array([0xff])] })])).read(scope, { limit: 1 }),
    reader(new FakeTransport([response({ chunks: [Buffer.from("private-body")] })])).read(scope, { limit: 1 }),
  ];
  for (const operation of operations) await expectSafeFailure(operation);
});
