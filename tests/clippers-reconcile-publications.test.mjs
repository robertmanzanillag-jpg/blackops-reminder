import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reconcileClipperPublications } from "../script/clippers-reconcile-publications.mjs";

async function workspace(ledger) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-reconcile-"));
  await mkdir(path.join(root, "reports"), { recursive: true });
  await mkdir(path.join(root, "research"), { recursive: true });
  await writeFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  await writeFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "[]\n");
  return root;
}

function scheduled(overrides = {}) {
  return {
    itemId: "item-07",
    campaignId: "campaign-07",
    strategyId: "specific_conflict",
    draftFile: "drafts/clip-07.mp4",
    account: "streamersclipusa",
    status: "scheduled",
    scheduledFor: "2026-08-05T10:00:00-04:00",
    metricoolId: "metricool-700",
    ...overrides,
  };
}

test("closes a scheduled Metricool post only with the exact public account URL and explicit metrics", async () => {
  const root = await workspace([scheduled()]);
  try {
    const result = await reconcileClipperPublications({
      workspaceRoot: root,
      now: new Date("2026-08-05T15:00:00.000Z"),
      env: { CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa" },
      dependencies: {
        async getPublication({ row }) {
          assert.equal(row.metricoolId, "metricool-700");
          return {
            id: "metricool-700",
            status: "PUBLISHED",
            permalink: "https://www.tiktok.com/@streamersclipusa/video/7530000000000000007?is_from_webapp=1",
            analytics: { views: 321, likes: 17, comments: 2, shares: 4 },
          };
        },
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.published, 1);
    const ledger = JSON.parse(await readFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), "utf8"));
    assert.equal(ledger[0].status, "published");
    assert.equal(ledger[0].publicUrl, "https://www.tiktok.com/@streamersclipusa/video/7530000000000000007");
    const metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].views, 321);
    assert.equal(metrics[0].likes, 17);
    assert.equal(metrics[0].earningsUsd, undefined, "earnings must not be inferred from views");
    assert.equal(metrics[0].qualifiedForPayout, undefined, "payout qualification must not be invented");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a scheduled post pending during the grace period and does not create performance", async () => {
  const root = await workspace([scheduled()]);
  try {
    const result = await reconcileClipperPublications({
      workspaceRoot: root,
      now: new Date("2026-08-05T14:20:00.000Z"),
      env: { CLIPPERS_TIKTOK_ACCOUNT: "@streamersclipusa" },
      dependencies: { async getPublication() { return null; } },
    });
    assert.equal(result.status, "pending");
    assert.equal(result.pending, 1);
    const ledger = JSON.parse(await readFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), "utf8"));
    assert.equal(ledger[0].status, "scheduled", "pending reconciliation must preserve delivery dedupe");
    assert.equal(ledger[0].publicationReconciliation.status, "pending");
    const metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.deepEqual(metrics, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("supports an injected fetcher for the default Metricool lookup without real credentials", async () => {
  const root = await workspace([scheduled({ metricoolBlogId: 6431687 })]);
  let calls = 0;
  try {
    const result = await reconcileClipperPublications({
      workspaceRoot: root,
      now: new Date("2026-08-05T15:00:00.000Z"),
      env: {
        CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
        METRICOOL_USER_TOKEN: "test-only-token",
        METRICOOL_USER_ID: "test-user",
      },
      fetcher: async (input, init) => {
        calls += 1;
        assert.match(String(input), /blogId=6431687/);
        assert.equal(init.headers["X-Mc-Auth"], "test-only-token");
        return new Response(JSON.stringify({ posts: [{
          id: "metricool-700",
          state: "posted",
          provider: { permalink: "https://www.tiktok.com/@STREAMERSCLIPUSA/video/7530000000000000008" },
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.published, 1);
    assert.equal(result.results[0].publicUrl, "https://www.tiktok.com/@streamersclipusa/video/7530000000000000008");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("is idempotent and rejects a published URL from another TikTok account", async () => {
  const root = await workspace([scheduled()]);
  let account = "wrongaccount";
  const options = {
    workspaceRoot: root,
    now: new Date("2026-08-05T16:00:00.000Z"),
    env: { CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa" },
    dependencies: {
      async getPublication() {
        return {
          id: "metricool-700",
          status: "published",
          postUrl: `https://www.tiktok.com/@${account}/video/7530000000000000007`,
          views: 9,
        };
      },
    },
  };
  try {
    const blocked = await reconcileClipperPublications(options);
    assert.equal(blocked.status, "attention_required");
    assert.equal(blocked.results[0].reason, "published_without_exact_account_url");
    let metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.deepEqual(metrics, []);

    account = "streamersclipusa";
    const first = await reconcileClipperPublications(options);
    const second = await reconcileClipperPublications(options);
    assert.equal(first.published, 1);
    assert.equal(second.results[0].reason, "already_reconciled");
    metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.equal(metrics.length, 1, "reruns must not duplicate a performance row");
    assert.equal(metrics[0].views, 9);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refreshes views for already-published clips from Metricool post analytics so the growth CEO can learn", async () => {
  const url = "https://www.tiktok.com/@streamersclipusa/video/7530000000000000007";
  const root = await workspace([scheduled({
    status: "published",
    publicUrl: url,
    publishedPostUrl: url,
    publishedAt: "2026-08-05T14:00:00.000Z",
    metricoolBlogId: 6431687,
    publicationReconciliation: { status: "published", publicUrl: url, metrics: {} },
  })]);
  const calls = [];
  try {
    const result = await reconcileClipperPublications({
      workspaceRoot: root,
      now: new Date("2026-08-08T15:00:00.000Z"),
      env: { CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa" },
      dependencies: {
        async getPublication() { throw new Error("must not re-read the scheduler for reconciled rows"); },
        async getPostAnalytics(args) {
          calls.push(args);
          return [
            { videoId: "7530000000000000099", views: 5000 },
            { shareUrl: `${url}?is_from_webapp=1`, views: 1840, likes: 92, shares: 11, comments: 6 },
          ];
        },
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].blogId, "6431687");
    const metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].views, 1840, "must match the exact video id, not another post");
    assert.equal(metrics[0].likes, 92);
    assert.equal(metrics[0].metricEvidenceVerified, true);
    assert.equal(metrics[0].strategyId, "specific_conflict");
    const report = await readFile(path.join(root, "reports", "metricool-publication-reconciliation.json"), "utf8");
    for (const needed of ["Metricool", url, "1840"]) assert.ok(report.includes(needed), `proof report must contain ${needed}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an analytics failure never invents metrics and does not block reconciliation", async () => {
  const url = "https://www.tiktok.com/@streamersclipusa/video/7530000000000000007";
  const root = await workspace([scheduled({ status: "published", publicUrl: url, publishedAt: "2026-08-05T14:00:00.000Z", metricoolBlogId: 6431687 })]);
  try {
    const result = await reconcileClipperPublications({
      workspaceRoot: root,
      now: new Date("2026-08-08T15:00:00.000Z"),
      env: { CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa" },
      dependencies: { async getPostAnalytics() { throw new Error("metricool_analytics_http_500"); } },
    });
    assert.equal(result.status, "completed");
    const metrics = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "utf8"));
    assert.equal(metrics[0].views, undefined);
    assert.equal(metrics[0].metricEvidenceVerified, false);
    const report = JSON.parse(await readFile(path.join(root, "reports", "metricool-publication-reconciliation.json"), "utf8"));
    assert.deepEqual(report.analyticsRefresh.errors, ["metricool_analytics_http_500"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
