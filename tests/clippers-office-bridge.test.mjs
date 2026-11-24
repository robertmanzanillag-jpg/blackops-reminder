import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bridgeConfig, buildClipperOfficeBridgePayload, sendClipperOfficeBridge } from "../script/clippers-office-bridge.mjs";

const TOKEN = "t".repeat(40);
const NOW = new Date("2026-11-24T12:00:00.000Z");

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-office-bridge-"));
  await mkdir(path.join(root, "research"), { recursive: true });
  await mkdir(path.join(root, "reports"), { recursive: true });
  await writeFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), JSON.stringify([
    { finalStatus: "published", publishedPostUrl: "https://www.tiktok.com/@a/video/1", metricEvidenceVerified: true, metricoolId: "m1", itemId: "i1", account: "@a", publishedAt: "2026-11-24T10:00:00Z", views: 95, likes: 3 },
    { finalStatus: "published", publishedPostUrl: "https://www.tiktok.com/@a/video/2", metricEvidenceVerified: false, metricoolId: "m2" },
    { finalStatus: "scheduled", metricoolId: "m3", views: 10 },
  ]));
  await writeFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), JSON.stringify([
    { status: "published", publishedAt: "2026-11-24T10:00:00Z" }, { status: "scheduled" }, { status: "blocked" },
  ]));
  await writeFile(path.join(root, "reports", "metricool-autopilot-queue.json"), JSON.stringify([{}, {}]));
  return root;
}

test("fails closed without token or url, never calling fetch", async () => {
  let called = false;
  const result = await sendClipperOfficeBridge({ workspaceRoot: "/nonexistent", workerReport: {}, env: {}, fetchImpl: () => { called = true; }, log: () => {} });
  assert.deepEqual(result, { status: "skipped", reason: "office_bridge_not_configured" });
  assert.equal(called, false);
  assert.equal(bridgeConfig({ CLIPPERS_OFFICE_INGEST_URL: "http://example.com/x", CLIPPERS_OFFICE_INGEST_TOKEN: TOKEN }).reason, "office_bridge_url_not_https");
  assert.equal(bridgeConfig({ CLIPPERS_OFFICE_INGEST_URL: "https://example.com/x", CLIPPERS_OFFICE_INGEST_TOKEN: "short" }).reason, "office_bridge_token_too_short");
});

test("only proof-backed rows with explicit views are sent; no URLs leave the Mac", async () => {
  const root = await workspace();
  const payload = await buildClipperOfficeBridgePayload({ workspaceRoot: root, workerReport: { status: "completed", finishedAt: NOW.toISOString() }, env: {}, now: NOW });
  assert.equal(payload.metrics.records.length, 1);
  assert.equal(payload.metrics.records[0].views, 95);
  assert.doesNotMatch(JSON.stringify(payload), /tiktok\.com/);
  assert.equal(payload.cycle.status, "ready");
  assert.equal(payload.cycle.totals.posts, 1);
  assert.equal(payload.cycle.totals.scheduled, 1);
  assert.equal(payload.cycle.totals.blocked, 1);
  assert.equal(payload.cycle.totals.backlogPosts, 2);
  assert.equal(payload.cycle.totals.gapToDailyTarget, 4);
});

test("posts with bearer token and reports http failures without throwing", async () => {
  const root = await workspace();
  const env = { CLIPPERS_OFFICE_INGEST_URL: "https://office.example.com/api/clippers/office-ingest", CLIPPERS_OFFICE_INGEST_TOKEN: TOKEN };
  let seen;
  const ok = await sendClipperOfficeBridge({ workspaceRoot: root, workerReport: { status: "blocked" }, env, now: NOW, log: () => {},
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 202 }; } });
  assert.equal(ok.status, "sent");
  assert.equal(seen.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.parse(seen.init.body).cycle.status, "blocked");
  const bad = await sendClipperOfficeBridge({ workspaceRoot: root, workerReport: {}, env, now: NOW, log: () => {}, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(bad.reason, "http_401");
  const down = await sendClipperOfficeBridge({ workspaceRoot: root, workerReport: {}, env, now: NOW, log: () => {}, fetchImpl: async () => { throw new Error("x"); } });
  assert.equal(down.reason, "network_error");
});
