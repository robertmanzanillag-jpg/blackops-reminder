import assert from "node:assert/strict";
import { access, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deliverClipperLocalNewsToMetricool } from "../server/clippers-local-news-metricool";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "queue-1",
    eventId: "event-1",
    lane: "miami-news",
    platform: "x",
    copy: "Cierre local. Fuente oficial: https://example.gov/road",
    risk: "medium",
    status: "auto_eligible",
    approvalRequired: false,
    autoEligible: true,
    published: false,
    createdAt: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

async function workspace(items: unknown[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "local-news-metricool-"));
  await writeFile(path.join(dir, "metricool-queue.json"), JSON.stringify({ items }), "utf8");
  return dir;
}

const credentials = { METRICOOL_USER_TOKEN: "real-token", METRICOOL_USER_ID: "123" };
const fixedNow = () => new Date("2026-07-21T16:00:00.000Z");

test("missing credentials blocks without making a network request", async () => {
  const dir = await workspace([item()]);
  let fetched = false;
  const result = await deliverClipperLocalNewsToMetricool({
    env: {},
    workspaceDir: dir,
    fetch: async () => { fetched = true; throw new Error("should not fetch"); },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "missing_metricool_credentials");
  assert.equal(fetched, false);
});

test("discovers the exact Miami News brand and sends one provider with safe scheduling fields", async () => {
  const dir = await workspace([item()]);
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [
          { id: 88, label: "Miami news", networks: ["twitter", "facebook"] },
          { blogId: 99, label: "Miami News", networks: ["twitter", "facebook"] },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { uuid: "metricool-post-1" } }), { status: 201 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("userId"), "123");
  assert.equal(calls[1].url.pathname, "/api/v2/scheduler/posts");
  assert.equal(calls[1].url.searchParams.get("blogId"), "99");
  assert.equal(calls[1].url.searchParams.get("jobId"), "queue-1");
  assert.equal((calls[1].init?.headers as Record<string, string>)["X-Mc-Auth"], "real-token");
  const payload = JSON.parse(String(calls[1].init?.body));
  assert.deepEqual(payload.providers, [{ network: "twitter" }]);
  assert.equal(payload.autoPublish, true);
  assert.equal(payload.draft, false);
  assert.equal(payload.publicationDate.timezone, "America/New_York");
  assert.equal(payload.publicationDate.dateTime, "2026-07-21T12:02:00");

  const ledger = await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8");
  assert.match(ledger, /metricool-post-1/);
  assert.doesNotMatch(ledger, /real-token/);
});

test("maps the live Metricool Facebook brand labels to the correct Miami and New York lanes", async () => {
  const dir = await workspace([
    item({ id: "miami-facebook", platform: "facebook" }),
    item({ id: "ny-facebook", eventId: "event-ny", lane: "ny-news", platform: "facebook" }),
  ]);
  const scheduledBlogIds: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify({ profiles: [
          { blogId: 501, label: "ynb4b6r6", networks: ["facebook"] },
          { blogId: 502, label: "New York News", networks: ["facebook"] },
        ] }), { status: 200 });
      }
      if (init?.method === "POST") scheduledBlogIds.push(url.searchParams.get("blogId") || "");
      return new Response(JSON.stringify({ id: `post-${scheduledBlogIds.length}` }), { status: 201 });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.scheduled, 2);
  assert.deepEqual(scheduledBlogIds, ["501", "502"]);
});

test("filters high/critical and approval-required queue items even if their flags conflict", async () => {
  const dir = await workspace([
    item({ id: "high", risk: "high" }),
    item({ id: "critical", risk: "critical" }),
    item({ id: "review", status: "approval_required", approvalRequired: true, autoEligible: false }),
    item({ id: "safe", platform: "facebook" }),
  ]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async (_input, init) => {
      if (init?.method === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
  });
  assert.equal(result.filtered, 3);
  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
});

test("blocks a discovered brand when its requested social profile is not connected", async () => {
  const dir = await workspace([item({ platform: "facebook" })]);
  let posts = 0;
  const result = await deliverClipperLocalNewsToMetricool({
    env: credentials,
    workspaceDir: dir,
    fetch: async (input, init) => {
      if (init?.method === "POST") posts += 1;
      const url = new URL(String(input));
      if (url.pathname === "/api/admin/simpleProfiles") {
        return new Response(JSON.stringify([{ id: 99, label: "Miami News", networks: ["twitter"] }]), { status: 200 });
      }
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "metricool_profile_or_provider_not_connected");
  assert.deepEqual(result.blockedLanes, ["miami-news"]);
  assert.equal(posts, 0);
});

test("durable ledger makes successful queue IDs idempotent across runs", async () => {
  const dir = await workspace([item()]);
  let posts = 0;
  const fetcher: typeof fetch = async () => {
    posts += 1;
    return new Response(JSON.stringify({ id: `post-${posts}` }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };
  assert.equal((await deliverClipperLocalNewsToMetricool(options)).scheduled, 1);
  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 0);
  assert.equal(second.alreadyScheduled, 1);
  assert.equal(posts, 1);
});

test("failed scheduling is not written to the ledger and is retried next run", async () => {
  const dir = await workspace([item()]);
  let attempt = 0;
  const fetcher: typeof fetch = async () => {
    attempt += 1;
    return attempt === 1
      ? new Response(JSON.stringify({ error: "rejected" }), { status: 500 })
      : new Response(JSON.stringify({ id: "retried-ok" }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };
  const first = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(first.failed, 1);
  await assert.rejects(readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8"), /ENOENT/);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
  const second = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(second.scheduled, 1);
  assert.equal(attempt, 2);
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});

test("exclusive workspace lock prevents concurrent duplicate Metricool posts", async () => {
  const dir = await workspace([item()]);
  let postCount = 0;
  let signalPostStarted: (() => void) | undefined;
  let releasePost: (() => void) | undefined;
  const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
  const holdPost = new Promise<void>((resolve) => { releasePost = resolve; });
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount += 1;
      signalPostStarted?.();
      await holdPost;
    }
    return new Response(JSON.stringify({ id: "only-post" }), { status: 200 });
  };
  const options = {
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: fetcher,
  };

  const firstPromise = deliverClipperLocalNewsToMetricool(options);
  await postStarted;
  const competing = await deliverClipperLocalNewsToMetricool(options);
  assert.equal(competing.status, "blocked");
  assert.equal(competing.reason, "metricool_delivery_in_progress");
  assert.equal(postCount, 1);

  releasePost?.();
  const first = await firstPromise;
  assert.equal(first.scheduled, 1);
  const ledger = JSON.parse(await readFile(path.join(dir, "metricool-delivery-ledger.json"), "utf8"));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].queueItemId, "queue-1");
  await assert.rejects(access(path.join(dir, "metricool-delivery-ledger.json.lock")), /ENOENT/);
});

test("recovers a bounded stale lock and cleans up its replacement", async () => {
  const dir = await workspace([item()]);
  const lockPath = path.join(dir, "metricool-delivery-ledger.json.lock");
  await writeFile(lockPath, JSON.stringify({ ownerId: "dead-process" }), "utf8");
  const stale = new Date(Date.now() - 11 * 60_000);
  await utimes(lockPath, stale, stale);
  let posts = 0;

  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    fetch: async () => {
      posts += 1;
      return new Response(JSON.stringify({ id: "recovered" }), { status: 200 });
    },
  });

  assert.equal(result.scheduled, 1);
  assert.equal(posts, 1);
  await assert.rejects(access(lockPath), /ENOENT/);
});

test("spaces posts for the same lane and platform by at least two minutes and honors run cap", async () => {
  const dir = await workspace([
    item({ id: "one" }),
    item({ id: "two", eventId: "event-2" }),
    item({ id: "three", eventId: "event-3" }),
  ]);
  const dates: string[] = [];
  const result = await deliverClipperLocalNewsToMetricool({
    env: { ...credentials, METRICOOL_MIAMI_NEWS_BLOG_ID: "99" },
    workspaceDir: dir,
    now: fixedNow,
    maxPerRun: 2,
    fetch: async (_input, init) => {
      dates.push(JSON.parse(String(init?.body)).publicationDate.dateTime);
      return new Response(JSON.stringify({ id: `post-${dates.length}` }), { status: 200 });
    },
  });
  assert.equal(result.scheduled, 2);
  assert.deepEqual(dates, ["2026-07-21T12:02:00", "2026-07-21T12:04:00"]);
});
