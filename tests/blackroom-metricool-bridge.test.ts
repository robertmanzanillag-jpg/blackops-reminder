import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  BLACKROOM_FACEBOOK_MAIN_URL,
  blackRoomMetricoolNetworks,
  buildBlackRoomFacebookCaption,
  buildMetricoolFacebookPayload,
  buildMetricoolYouTubeShortPayload,
  buildMetricoolTikTokPayload,
  extractMetricoolMediaId,
  findVerifiedMetricoolPost,
  postMetricoolJsonBytes,
  scheduleBlackRoomMetricoolPost,
} from "../server/blackroom-metricool-bridge";

const input = {
  caption: "REDAX flips the pressure switch. #BlackRoomRadio",
  publicationDateTime: "2026-07-22T05:00:00",
  timezone: "America/New_York",
  sourceVideoId: "abc123xyz01",
  durationSeconds: 30,
  videoFormat: "vertical" as const,
  mediaUrl: "https://robplanner.replit.app/api/blackroom-agent/media/upload-1",
};

test("extracts normalized media ids without accepting unrelated top-level ids", () => {
  assert.equal(extractMetricoolMediaId({ data: { mediaId: "media-123" } }), "media-123");
  assert.equal(extractMetricoolMediaId({ data: { id: 456 } }), "456");
  assert.equal(extractMetricoolMediaId(input.mediaUrl), input.mediaUrl);
  assert.throws(() => extractMetricoolMediaId("not-a-media-url"), /mediaId/);
  assert.throws(() => extractMetricoolMediaId({ id: "request-1" }), /mediaId/);
});

test("builds a TikTok-only auto-publish payload", () => {
  const payload = buildMetricoolTikTokPayload(input, "media-123");
  assert.deepEqual(payload.providers, [{ network: "tiktok" }]);
  assert.deepEqual(payload.media, { mediaId: "media-123" });
  assert.equal(payload.autoPublish, true);
  assert.equal(payload.publicationDate.timezone, "America/New_York");
  assert.equal(payload.tiktokData.privacyOption, "PUBLIC_TO_EVERYONE");
});

test("builds a separate Facebook payload with a bilingual main-page funnel CTA", () => {
  const english = buildMetricoolFacebookPayload(input, "media-123");
  const spanish = buildMetricoolFacebookPayload({ ...input, language: "es" }, "media-123");
  assert.deepEqual(english.providers, [{ network: "facebook" }]);
  assert.equal("tiktokData" in english, false);
  assert.equal(english.facebookData.type, "REEL");
  assert.equal(buildMetricoolFacebookPayload({ ...input, durationSeconds: 120 }, "media-123").facebookData.type, "POST");
  assert.equal(buildMetricoolFacebookPayload({ ...input, videoFormat: "horizontal" }, "media-123").facebookData.type, "POST");
  assert.match(english.text, /Watch the full set on YouTube: https:\/\/www\.youtube\.com\/watch\?v=abc123xyz01/);
  assert.match(english.text, /Follow the full BlackRoom experience/);
  assert.match(spanish.text, /Mira el set completo en YouTube/);
  assert.match(spanish.text, /Sigue la experiencia completa de BlackRoom/);
  assert.ok(english.text.endsWith(BLACKROOM_FACEBOOK_MAIN_URL));
  assert.equal(buildMetricoolTikTokPayload(input, "media-123").text.includes(BLACKROOM_FACEBOOK_MAIN_URL), false);
});

test("builds YouTube Shorts only for eligible vertical clips", () => {
  const payload = buildMetricoolYouTubeShortPayload(input, "media-123");
  assert.deepEqual(payload.providers, [{ network: "youtube" }]);
  assert.equal(payload.youtubeData.type, "short");
  assert.equal(payload.youtubeData.privacy, "public");
  assert.equal(payload.youtubeData.category, "MUSIC");
  assert.equal(payload.youtubeData.madeForKids, false);
  assert.deepEqual(blackRoomMetricoolNetworks(input), ["tiktok", "facebook", "youtube"]);
  assert.deepEqual(blackRoomMetricoolNetworks({ ...input, videoFormat: "horizontal" }), ["tiktok", "facebook"]);
  assert.deepEqual(blackRoomMetricoolNetworks({ ...input, durationSeconds: 300 }), ["tiktok", "facebook"]);
  assert.throws(() => buildMetricoolYouTubeShortPayload({ ...input, videoFormat: "horizontal" }, "media-123"), /vertical clip/);
});

test("sends Metricool scheduler JSON as exact UTF-8 bytes", async () => {
  const received = await new Promise<{ body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end('{"id":991}');
        server.close();
        resolve({ body: Buffer.concat(chunks).toString("utf8"), headers: request.headers });
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Test server did not bind"));
      try {
        const response = await postMetricoolJsonBytes(
          `http://127.0.0.1:${address.port}/scheduler`,
          "valid-token-that-is-long-enough",
          JSON.stringify({ text: "Café", providers: [{ network: "tiktok" }] }),
        );
        assert.equal(response.status, 201);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
  assert.deepEqual(JSON.parse(received.body), { text: "Café", providers: [{ network: "tiktok" }] });
  assert.equal(received.headers["x-mc-auth"], "valid-token-that-is-long-enough");
  assert.equal(received.headers["content-type"], "application/json");
  assert.equal(received.headers["content-length"], String(Buffer.byteLength(received.body, "utf8")));
});

test("rejects reset curl streams without crashing the Node process", async () => {
  const cases = [
    { index: 0, name: "request" },
    { index: 1, name: "response" },
    { index: 2, name: "diagnostic" },
  ] as const;

  for (const streamCase of cases) {
    const streams = [new PassThrough(), new PassThrough(), new PassThrough()];
    const child = Object.assign(new EventEmitter(), {
      stdin: streams[0],
      stdout: streams[1],
      stderr: streams[2],
      stdio: streams,
      kill: () => true,
    });
    const spawnProcess = (() => {
      queueMicrotask(() => {
        const error = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        streams[streamCase.index].destroy(error);
      });
      return child;
    }) as unknown as typeof import("node:child_process").spawn;

    await assert.rejects(
      () => postMetricoolJsonBytes(
        "https://app.metricool.com/api/v2/scheduler/posts",
        "valid-token-that-is-long-enough",
        JSON.stringify({ text: "audio first" }),
        1_000,
        spawnProcess,
      ),
      new RegExp(`${streamCase.name} stream failed: read ECONNRESET`),
    );
  }
});

test("keeps Metricool auth out of curl arguments and sends it through standard input", async () => {
  const streams = [new PassThrough(), new PassThrough(), new PassThrough()];
  const config: Buffer[] = [];
  streams[0].on("data", (chunk) => config.push(Buffer.from(chunk)));
  let args: readonly string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdin: streams[0],
    stdout: streams[1],
    stderr: streams[2],
    stdio: streams,
    kill: () => true,
  });
  const spawnProcess = ((_command: string, receivedArgs: readonly string[]) => {
    args = receivedArgs;
    queueMicrotask(() => {
      streams[1].end('{"id":991}\n201');
      child.emit("close", 0);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  const token = "valid-token-that-is-long-enough";
  const response = await postMetricoolJsonBytes(
    "https://app.metricool.com/api/v2/scheduler/posts",
    token,
    JSON.stringify({ text: "audio first" }),
    1_000,
    spawnProcess,
  );
  assert.equal(response.status, 201);
  assert.equal(args.some((value) => value.includes(token)), false);
  assert.match(Buffer.concat(config).toString("utf8"), new RegExp(`X-Mc-Auth: ${token}`));
  assert.equal(args.includes("--config"), true);
  assert.equal(args.some((value) => value.startsWith("@") && value.endsWith("payload.json")), true);
});

test("finds exact caption and schedule evidence", () => {
  const post = { id: 99, text: input.caption, publicationDate: { dateTime: input.publicationDateTime } };
  assert.equal(findVerifiedMetricoolPost({ data: [post] }, input.caption, input.publicationDateTime), post);
  assert.equal(findVerifiedMetricoolPost({ data: [{ ...post, text: "different" }] }, input.caption, input.publicationDateTime), null);
});

test("normalizes media, schedules, then verifies before returning a receipt", async () => {
  const calls: Array<{ url: string; method: string; body?: any; headers?: HeadersInit }> = [];
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url);
    const method = init.method || "GET";
    calls.push({ url: href, method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers });
    if (method === "GET" && href.includes("/scheduler/posts")) {
      const verifications = calls.filter((call) => call.method === "GET" && call.url.includes("/scheduler/posts"));
      const tiktok = { id: 991, text: input.caption, publicationDate: { dateTime: input.publicationDateTime } };
      const facebook = { id: 992, text: buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId), publicationDate: { dateTime: input.publicationDateTime } };
      const youtube = { id: 993, text: `${input.caption}\n\nFull set: https://www.youtube.com/watch?v=${input.sourceVideoId}\n#Shorts #BlackRoom`, publicationDate: { dateTime: input.publicationDateTime } };
      return Response.json({ data: verifications.length === 1 ? [] : verifications.length === 2 ? [tiktok] : verifications.length === 3 ? [tiktok, facebook] : [tiktok, facebook, youtube] });
    }
    if (href.includes("/normalize/")) return new Response(input.mediaUrl, { headers: { "Content-Type": "text/plain; charset=ISO-8859-1" } });
    if (method === "POST") return Response.json({ id: 990 + calls.filter((call) => call.method === "POST").length });
    return Response.json({ data: [] });
  };
  const receipt = await scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
  });
  assert.deepEqual(receipt, {
    metricoolId: "991",
    platformReceipts: { tiktok: "991", facebook: "992", youtube: "993" },
    publicationDateTime: input.publicationDateTime,
    caption: input.caption,
    verified: true,
  });
  assert.equal(calls.length, 8);
  assert.deepEqual(calls[2].body.media, { mediaId: input.mediaUrl });
  assert.deepEqual(calls[2].body.providers, [{ network: "tiktok" }]);
  assert.deepEqual(calls[4].body.providers, [{ network: "facebook" }]);
  assert.deepEqual(calls[6].body.providers, [{ network: "youtube" }]);
  assert.equal(calls[6].body.youtubeData.type, "short");
  assert.match(calls[2].url, /integrationSource=MCP/);
  assert.equal((calls[2].headers as Record<string, string>).accept, "application/json");
  assert.equal((calls[2].headers as Record<string, string>)["content-length"], String(Buffer.byteLength(JSON.stringify(calls[2].body), "utf8")));
  assert.equal((calls[1].headers as Record<string, string>).accept, "*/*");
  assert.equal((calls[1].headers as Record<string, string>)["content-type"], undefined);
});

test("returns an existing exact post before uploading media or creating a duplicate", async () => {
  const calls: string[] = [];
  const mockFetch = async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json({ data: [
      { id: 991, text: input.caption, publicationDate: { dateTime: input.publicationDateTime } },
      { id: 992, text: buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId), publicationDate: { dateTime: input.publicationDateTime } },
      { id: 993, text: `${input.caption}\n\nFull set: https://www.youtube.com/watch?v=${input.sourceVideoId}\n#Shorts #BlackRoom`, publicationDate: { dateTime: input.publicationDateTime } },
    ] });
  };
  const receipt = await scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
  });
  assert.equal(receipt.metricoolId, "991");
  assert.deepEqual(receipt.platformReceipts, { tiktok: "991", facebook: "992", youtube: "993" });
  assert.equal(calls.length, 1);
});

test("retries only the missing Facebook post after TikTok was already confirmed", async () => {
  const calls: Array<{ method: string; body?: any }> = [];
  const tiktok = { id: 991, text: input.caption, publicationDate: { dateTime: input.publicationDateTime } };
  const facebook = { id: 992, text: buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId), publicationDate: { dateTime: input.publicationDateTime } };
  const youtube = { id: 993, text: `${input.caption}\n\nFull set: https://www.youtube.com/watch?v=${input.sourceVideoId}\n#Shorts #BlackRoom`, publicationDate: { dateTime: input.publicationDateTime } };
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const method = init.method || "GET";
    calls.push({ method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).includes("/normalize/")) return new Response(input.mediaUrl);
    if (method === "POST") return Response.json({ id: 992 });
    const gets = calls.filter((call) => call.method === "GET").length;
    return Response.json({ data: gets === 1 ? [tiktok, youtube] : [tiktok, facebook, youtube] });
  };
  const receipt = await scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
  });
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.providers, [{ network: "facebook" }]);
  assert.deepEqual(receipt.platformReceipts, { tiktok: "991", facebook: "992", youtube: "993" });
});

test("schedules and verifies only the explicitly requested network", async () => {
  const calls: Array<{ method: string; body?: any }> = [];
  const facebook = { id: 992, text: buildBlackRoomFacebookCaption(input.caption, input.sourceVideoId), publicationDate: { dateTime: input.publicationDateTime } };
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const method = init.method || "GET";
    calls.push({ method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).includes("/normalize/")) return new Response(input.mediaUrl);
    if (method === "POST") return Response.json({ id: 992 });
    const gets = calls.filter((call) => call.method === "GET").length;
    return Response.json({ data: gets === 1 ? [] : [facebook] });
  };
  const receipt = await scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
    networks: ["facebook"],
  });
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body.providers, [{ network: "facebook" }]);
  assert.equal(receipt.metricoolId, "992");
  assert.deepEqual(receipt.platformReceipts, { facebook: "992" });
});

test("refuses to confirm when the verification response does not contain the post", async () => {
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    if (init.method !== "POST" && String(url).includes("/scheduler/posts")) return Response.json({ data: [] });
    if (String(url).includes("/normalize/")) return Response.json({ mediaId: "media-123" });
    if (init.method === "POST") return Response.json({ id: 991 });
    return Response.json({ data: [] });
  };
  await assert.rejects(() => scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
    verificationAttempts: 1,
    verificationIntervalMs: 0,
  }), /submitted but verification is still pending/);
});

test("verification-only recovery never POSTs a possibly accepted network twice", async () => {
  const calls: string[] = [];
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push(init.method || "GET");
    return Response.json({ data: [] });
  };
  await assert.rejects(() => scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
    verifyOnly: true,
  }), /verification is still pending/);
  assert.deepEqual(calls, ["GET"]);
});

test("includes a bounded upstream validation message without leaking auth", async () => {
  const mockFetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    if (init.method !== "POST" && String(url).includes("/scheduler/posts")) return Response.json({ data: [] });
    if (String(url).includes("/normalize/")) return new Response(input.mediaUrl);
    return Response.json({ error: "invalid tiktokData", token: "super-secret-value" }, { status: 400 });
  };
  await assert.rejects(() => scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
  }), (error: Error) => error.message.includes("invalid tiktokData") && !error.message.includes("super-secret-value"));
});

test("includes a bounded media-normalization error without leaking auth", async () => {
  const mockFetch = async (url: string | URL | Request) => {
    if (String(url).includes("/scheduler/posts")) return Response.json({ data: [] });
    return new Response(JSON.stringify({ error: "could not fetch public MP4", token: "super-secret-value" }), { status: 500 });
  };
  await assert.rejects(() => scheduleBlackRoomMetricoolPost(input, {
    env: { METRICOOL_USER_TOKEN: "valid-token-that-is-long-enough", METRICOOL_USER_ID: "3558197" },
    fetch: mockFetch as typeof fetch,
  }), (error: Error) => error.message.includes("could not fetch public MP4") && !error.message.includes("super-secret-value"));
});
