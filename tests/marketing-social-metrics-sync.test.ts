import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingSocialScheduler, getMarketingSocialSyncConfig, parseTikTokPostRows, syncMarketingSocialMetrics, type SocialSnapshot } from "../server/marketing-social-metrics-sync";
import { executionDiagnostics } from "../server/office-web-role-sources";

const env = { METRICOOL_USER_TOKEN: "tok-real", METRICOOL_USER_ID: "123" } as NodeJS.ProcessEnv;
const now = () => new Date("2026-11-24T15:00:00Z");
const mcp = (rows: unknown[]) => ({ result: { content: [{ type: "text", text: JSON.stringify({ rows }) }] } });

test("parses TikTok rows into opaque bounded snapshots without URLs", () => {
  const rows = parseTikTokPostRows({ content: [{ text: JSON.stringify({ rows: [{ TKPO03: { value: "https://tiktok.com/v/1" }, TKPO07: { value: 95 }, TKPO08: 3, TKPO11: 80 }, { TKPO07: 10 }] }) }] }, "6431685", "2026-11-24");
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^metricool-tiktok-[a-f0-9]{32}-2026-11-24$/);
  assert.equal(rows[0].views, 95); assert.equal(rows[0].impressions, 80); assert.equal(rows[0].likes, 3);
  assert.ok(!JSON.stringify(rows).includes("tiktok.com"));
  assert.deepEqual(parseTikTokPostRows("garbage", "1", "d"), []);
});

test("missing credentials or disabled config records nothing (fail-closed)", async () => {
  let calls = 0;
  const record = () => { calls++; return 0; };
  assert.equal((await syncMarketingSocialMetrics({ env: {}, record, now })).error, "missing_metricool_credentials");
  assert.equal((await syncMarketingSocialMetrics({ env: { ...env, MARKETING_SOCIAL_METRICS_SYNC_ENABLED: "false" }, record, now })).status, "blocked");
  assert.equal(calls, 0);
});

test("only calls the read-only analytics tool, records snapshots, then learning once", async () => {
  const tools: string[] = []; let recorded: SocialSnapshot[] = []; const learned: string[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    tools.push(JSON.parse(String(init?.body)).params.name);
    return new Response(JSON.stringify(mcp([{ TKPO03: "https://x/v/" + tools.length, TKPO07: 11 }])), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const result = await syncMarketingSocialMetrics({ env, fetch, now, record: (items) => { recorded = items; return items.length; }, learn: async (k) => { learned.push(k); } });
  assert.deepEqual([...new Set(tools)], ["getAnalyticsDataByMetrics"]);
  assert.equal(tools.length, getMarketingSocialSyncConfig(env).blogIds.length);
  assert.equal(result.status, "completed"); assert.equal(result.recorded, 2); assert.equal(recorded.length, 2);
  assert.deepEqual(learned, ["2026-11-24"]); assert.equal(result.learningRecorded, true);
});

test("failed fetch leaves source untouched and skips learning", async () => {
  let learned = 0, wrote = 0;
  const fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
  const result = await syncMarketingSocialMetrics({ env, fetch, now, record: () => { wrote++; return 0; }, learn: async () => { learned++; } });
  assert.equal(result.status, "blocked"); assert.equal(wrote, 0); assert.equal(learned, 0);
});

test("scheduler runs at most once per New York day after the configured time", async () => {
  let clock = new Date("2026-11-24T11:00:00Z"); let runs = 0;
  const s = createMarketingSocialScheduler({ env, now: () => clock, setInterval: () => ({}), log: () => undefined, sync: async () => { runs++; return { status: "completed", brands: 2, recorded: 1, learningRecorded: true, error: null, at: clock.toISOString() }; } });
  assert.equal(await s.tick(), false); // 06:00 NY, before 07:10
  clock = new Date("2026-11-24T13:00:00Z"); assert.equal(await s.tick(), true); assert.equal(await s.tick(), false);
  clock = new Date("2026-11-25T13:00:00Z"); assert.equal(await s.tick(), true); assert.equal(runs, 2);
});

test("execution labels stay for plan/metric-only rows and are role-scoped", () => {
  assert.deepEqual(executionDiagnostics("marketing-cmo", [{ kind: "campaign_metric" }, { kind: "marketing_plan" }]), ["PLANS_NOT_EXECUTION", "COLLECTED_METRICS_ONLY"]);
  assert.deepEqual(executionDiagnostics("marketing-cmo", []), ["PLANS_NOT_EXECUTION", "COLLECTED_METRICS_ONLY"]);
  assert.deepEqual(executionDiagnostics("dropshipping", [{ kind: "product" }]), []);
});
