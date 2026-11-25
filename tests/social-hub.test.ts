import test from "node:test";
import assert from "node:assert/strict";
import { validateSocialPost } from "@shared/social-hub";
import { memorySocialHubStore, SocialHub } from "../server/social-hub/scheduler";
import { SocialPublishError } from "../server/social-hub/providers";

const creds = { get: async (network: any, accountId: string) => ({ network, accountId, accessToken: "t" }) };
const base = { brand: "kong", caption: "hola", mediaKind: "video" as const, mediaUrls: ["https://x/v.mp4"], targets: [{ network: "instagram" as const, accountId: "1" }, { network: "tiktok" as const, accountId: "2" }] };

test("validation flags missing media and subreddit", () => {
  assert.ok(validateSocialPost({ ...base, mediaKind: "none", mediaUrls: [], createdBy: "robert" }).some((p) => p.includes("instagram")));
  assert.ok(validateSocialPost({ ...base, mediaKind: "none", mediaUrls: [], targets: [{ network: "reddit", accountId: "u" }], createdBy: "robert" }).some((p) => p.includes("subreddit")));
});

test("agent posts wait for approval; robert posts are scheduled", () => {
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds });
  assert.equal(hub.create({ ...base, createdBy: "factory:marketing" }).status, "pending_approval");
  assert.equal(hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-01T00:00:00Z" }).status, "scheduled");
});

test("publishing is off unless enabled", async () => {
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds });
  const p = hub.create({ ...base, createdBy: "robert" });
  await assert.rejects(hub.publishNow(p.id));
});

test("runDue publishes, retries retryable errors, marks partial", async () => {
  let ig = 0;
  const hub = new SocialHub({
    store: memorySocialHubStore(), credentials: creds, publishingEnabled: true, now: () => new Date("2026-02-01T00:00:00Z"),
    providers: {
      instagram: { network: "instagram", publish: async () => { if (++ig < 2) throw new SocialPublishError("instagram", "500"); return { externalId: "ig1" }; } },
      tiktok: { network: "tiktok", publish: async () => { throw new SocialPublishError("tiktok", "bad", false); } },
    },
  });
  hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-01T00:00:00Z" });
  const [done] = await hub.runDue();
  assert.equal(done.status, "partially_published");
  assert.equal(done.results[0].externalId, "ig1");
  assert.equal(done.results[0].attempts, 2);
  assert.equal(done.results[1].attempts, 1);
});

test("best time is in the future on the hour", () => {
  const now = new Date("2026-02-01T10:07:00Z");
  const hub = new SocialHub({ store: memorySocialHubStore(), credentials: creds, now: () => now });
  const at = hub.bestTime(["tiktok"]);
  assert.ok(at > now && at.getMinutes() === 0);
});

test("collectMetrics stores snapshots and analytics aggregates latest per post", async () => {
  const hub = new SocialHub({
    store: memorySocialHubStore(), credentials: creds, publishingEnabled: true, now: () => new Date("2026-02-01T00:00:00Z"),
    providers: { instagram: { network: "instagram", publish: async () => ({ externalId: "ig9" }) }, tiktok: { network: "tiktok", publish: async () => ({ externalId: "tt9" }) } },
    fetchImpl: (async (url: string) => new Response(JSON.stringify(
      String(url).includes("tiktok") ? { data: { videos: [{ view_count: 100, like_count: 10, comment_count: 1, share_count: 2 }] } }
        : { data: [{ name: "views", values: [{ value: 50 }] }, { name: "likes", values: [{ value: 5 }] }] },
    ), { status: 200 })) as any,
  });
  hub.create({ ...base, createdBy: "robert", publishAt: "2026-01-31T00:00:00Z" });
  await hub.runDue();
  const r = await hub.collectMetrics();
  assert.equal(r.collected, 2);
  const a = hub.analytics();
  assert.equal(a.byNetwork.tiktok.views, 100);
  assert.equal(a.byNetwork.instagram.likes, 5);
  assert.equal(a.topPosts[0].network, "tiktok");
});

test("oauth: auth url has state+pkce, callback stores encrypted token, store resolves by handle", async () => {
  const { hydrateSocialHub, memoryBackend, kvFlush } = await import("../server/social-hub/persist");
  const backend = memoryBackend();
  await hydrateSocialHub(["state", "tokens"], backend);
  Object.assign(process.env, { SOCIAL_HUB_TOKEN_KEY: "k".repeat(32), SOCIAL_HUB_PUBLIC_URL: "https://ops.example", SH_TIKTOK_CLIENT_KEY: "ck", SH_TIKTOK_CLIENT_SECRET: "cs" });
  const { buildAuthUrl, completeOAuth, oauthCredentialStore } = await import("../server/social-hub/oauth");
  const url = new URL(buildAuthUrl("tiktok"));
  assert.equal(url.searchParams.get("client_key"), "ck");
  assert.ok(url.searchParams.get("code_challenge"));
  const f = (async (u: string) => new Response(JSON.stringify(String(u).includes("token") ? { access_token: "PLAIN_TOKEN_x", refresh_token: "RT", expires_in: 86400 } : { data: { user: { open_id: "oid_kong", username: "kongnightlife", display_name: "KONG" } } }), { status: 200 })) as any;
  const rows = await completeOAuth(url.searchParams.get("state")!, "code", f);
  assert.equal(rows[0].accountId, "oid_kong"); assert.equal(rows[0].label, "@kongnightlife");
  await kvFlush();
  const persisted = await backend.read("tokens");
  assert.ok(persisted && !persisted.includes("PLAIN_TOKEN_x"), "token is persisted encrypted");
  const store = oauthCredentialStore({ get: async () => null }, f);
  assert.equal((await store.get("tiktok", "@kongnightlife"))?.accessToken, "PLAIN_TOKEN_x");
  await assert.rejects(completeOAuth(url.searchParams.get("state")!, "code", f));

  // "Redeploy": fresh memory, same database → tokens and queue survive.
  const { persistentSocialHubStore } = await import("../server/social-hub/scheduler");
  persistentSocialHubStore().save({ posts: [], metrics: [{ network: "x", accountId: "1", capturedAt: "2026-01-01T00:00:00Z" }] });
  await kvFlush();
  await hydrateSocialHub(["state", "tokens"], backend);
  assert.equal((await store.get("tiktok", "kongnightlife"))?.accessToken, "PLAIN_TOKEN_x");
  assert.equal(persistentSocialHubStore().load().metrics.length, 1);
});

test("tiktok reuses the clippers app credentials when SH_TIKTOK_* is unset", async () => {
  const { oauthConfigured, buildAuthUrl } = await import("../server/social-hub/oauth");
  const saved = { ...process.env };
  delete process.env.SH_TIKTOK_CLIENT_KEY; delete process.env.SH_TIKTOK_CLIENT_SECRET;
  Object.assign(process.env, { TIKTOK_CLIENT_KEY: "clippers_ck", TIKTOK_CLIENT_SECRET: "clippers_cs", SOCIAL_HUB_PUBLIC_URL: "https://ops.example" });
  assert.equal(oauthConfigured("tiktok"), true);
  assert.equal(new URL(buildAuthUrl("tiktok")).searchParams.get("client_key"), "clippers_ck");
  process.env = saved;
});

test("social hub oauth callback is reachable without a browser session (state-protected)", async () => {
  const { isPublicApiPath } = await import("../server/user-context");
  assert.equal(isPublicApiPath("/api/social-hub/oauth/callback"), true);
  assert.equal(isPublicApiPath("/api/social-hub/oauth/start/facebook"), false);
  assert.equal(isPublicApiPath("/api/social-hub/connections"), false);
});

test("a failed database write is reported, never confirmed as saved", async () => {
  const { hydrateSocialHub, kvSet, kvFlushOrThrow, kvStatus } = await import("../server/social-hub/persist");
  await hydrateSocialHub(["state", "tokens"], { async read() { return null; }, async write() { throw new Error("db down"); } });
  kvSet("tokens", "x");
  await assert.rejects(kvFlushOrThrow(), /db down/);
  assert.equal(kvStatus().lastWriteError?.key, "tokens");
});

test("tiktok label falls back to display name when username is not granted", async () => {
  const { hydrateSocialHub, memoryBackend } = await import("../server/social-hub/persist");
  await hydrateSocialHub(["state", "tokens"], memoryBackend());
  Object.assign(process.env, { SOCIAL_HUB_TOKEN_KEY: "k".repeat(32), SOCIAL_HUB_PUBLIC_URL: "https://ops.example", SH_TIKTOK_CLIENT_KEY: "ck", SH_TIKTOK_CLIENT_SECRET: "cs" });
  const { buildAuthUrl, completeOAuth } = await import("../server/social-hub/oauth");
  const url = new URL(buildAuthUrl("tiktok"));
  assert.ok(url.searchParams.get("scope")!.includes("user.info.profile"));
  const f = (async (u: string) => new Response(JSON.stringify(
    String(u).includes("oauth/token") ? { access_token: "PLAIN_TOKEN_x", open_id: "oid_br", expires_in: 86400 }
      : String(u).includes("username") ? { error: { code: "scope_not_authorized" } }
      : { data: { user: { open_id: "oid_br", display_name: "Black Room" } } },
  ), { status: 200 })) as any;
  const rows = await completeOAuth(url.searchParams.get("state")!, "code", f);
  assert.deepEqual([rows[0].accountId, rows[0].label], ["oid_br", "Black Room"]);
});

test("uploads: only images/videos, served by id with byte ranges", async () => {
  const { memoryMediaStore, saveUpload, serveMedia, MediaRejected } = await import("../server/social-hub/media");
  const store = memoryMediaStore();
  await assert.rejects(saveUpload(store, Buffer.from("x"), "text/html", "a.html"), MediaRejected);
  const out = await saveUpload(store, Buffer.from("0123456789"), "video/mp4", "clip.mp4");
  assert.equal(out.kind, "video");
  assert.match(out.id, /^[A-Za-z0-9_-]{24}\.mp4$/);
  const row = (await store.get(out.id))!;
  assert.equal(serveMedia(row).status, 200);
  const part = serveMedia(row, "bytes=2-5");
  assert.equal(part.status, 206);
  assert.equal(part.body.toString(), "2345");
  assert.equal(part.headers["Content-Range"], "bytes 2-5/10");
});

test("metricool calendar: converts NY local time and skips drafts/published", async () => {
  const { zonedToIso, metricoolScheduled } = await import("../server/social-hub/metricool-calendar");
  assert.equal(zonedToIso("2026-11-25T11:00:00", "America/New_York"), "2026-11-25T16:00:00.000Z");
  assert.equal(zonedToIso("2026-07-01T11:00:00", "America/New_York"), "2026-07-01T15:00:00.000Z");
  const rows = [
    { id: 1, publicationDate: { dateTime: "2026-11-25T11:00:00", timezone: "America/New_York" }, text: "a", providers: [{ network: "tiktok", status: "PENDING" }] },
    { id: 2, publicationDate: { dateTime: "2026-11-25T12:00:00", timezone: "America/New_York" }, text: "b", draft: true, providers: [] },
    { id: 3, publicationDate: { dateTime: "2026-11-25T13:00:00", timezone: "America/New_York" }, text: "c", providers: [{ network: "facebook", status: "PUBLISHED" }] },
  ];
  const f = (async () => new Response(JSON.stringify({ data: rows }), { status: 200 })) as any;
  const out = await metricoolScheduled(new Date("2026-11-25"), new Date("2026-11-26"), { token: "tttttttttttttt", userId: "1", fetcher: f });
  assert.ok(out.items.length >= 1 && out.items.every((i) => i.id === "1"));
});

test("agent API rejects missing or short tokens and accepts the configured one", async () => {
  const { registerSocialHubRoutes } = await import("../server/social-hub/routes");
  const routes: Record<string, any[]> = {};
  const app: any = { get: (p: string, ...h: any[]) => { routes["GET " + p] = h; }, post: (p: string, ...h: any[]) => { routes["POST " + p] = h; } };
  const hub: any = { list: () => [], metricsSince: () => [{ network: "facebook", externalId: "1" }] };
  registerSocialHubRoutes(app, { hub: () => hub, isOwner: () => false, media: { put: async () => {}, get: async () => null } });
  const call = async (auth?: string) => {
    let status = 200, body: any;
    const res: any = { status(c: number) { status = c; return res; }, json(b: any) { body = b; return res; }, set() { return res; } };
    await routes["GET /social-hub-agent/metrics"].at(-1)({ headers: auth ? { authorization: auth } : {}, query: {} }, res);
    return { status, body };
  };
  process.env.SOCIAL_HUB_AGENT_TOKEN = "short";
  assert.equal((await call("Bearer short")).status, 401);
  process.env.SOCIAL_HUB_AGENT_TOKEN = "a".repeat(40);
  assert.equal((await call()).status, 401);
  assert.equal((await call("Bearer " + "b".repeat(40))).status, 401);
  const ok = await call("Bearer " + "a".repeat(40));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.length, 1);
});
