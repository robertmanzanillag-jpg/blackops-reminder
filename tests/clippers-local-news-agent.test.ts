import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";
import { __clipperLocalNewsInternals, bootstrapClipperLocalNews, getClipperLocalNewsStatus, ingestClipperLocalNewsEvents, recordClipperLocalNewsMetrics, runClipperLocalNewsCycle } from "../server/clippers-local-news-agent";

async function fixture(t: test.TestContext) {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "local-news-agent-"));
  t.after(() => rm(workspaceDir, { recursive: true, force: true }));
  return workspaceDir;
}

const event = { sourceEventId: "nws-1", source: "NWS Miami", sourceUrl: "https://weather.gov/example", lane: "miami-news" as const, title: "Flood Watch", description: "Heavy rain is possible.", location: "Miami-Dade", severity: "Moderate", urgency: "Expected" };

test("bootstrap creates all artifacts and clamps schedule to 2-5 minutes", async (t) => {
  const workspaceDir = await fixture(t);
  const status = await bootstrapClipperLocalNews({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES: "99" } });
  assert.equal(status.bootstrapped, true);
  assert.equal(status.scheduleMinutes, 5);
  for (const artifact of Object.values(status.artifacts)) assert.ok((await readFile(artifact, "utf8")).length > 0);
});

test("stable dedupe, updates and resolution create one revision per change", async (t) => {
  const workspaceDir = await fixture(t);
  const first = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  assert.deepEqual({ created: first.created, queued: first.queued }, { created: 1, queued: 2 });
  const duplicate = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:01:00Z", events: [event] });
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.queued, 0);
  const update = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:02:00Z", events: [{ ...event, description: "Road flooding reported." }] });
  assert.equal(update.updated, 1);
  assert.equal(update.queued, 2);
  const resolution = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:03:00Z", events: [{ ...event, description: "Road flooding reported.", status: "resolved" }] });
  assert.equal(resolution.resolved, 1);
  assert.equal(resolution.status.events.resolved, 1);
  assert.equal(resolution.status.queue.total, 6);
});

test("risk gate blocks critical events and copy stays platform-specific", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "true" }, events: [{ ...event, title: "Hurricane Warning", severity: "Extreme", description: "Evacuate immediately. ".repeat(40) }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(queue.length, 2);
  assert.ok(queue.every((item: any) => item.status === "approval_required" && item.published === false));
  const x = queue.find((item: any) => item.platform === "x");
  const facebook = queue.find((item: any) => item.platform === "facebook");
  assert.ok(x.copy.length <= 280);
  assert.notEqual(x.copy, facebook.copy);
  assert.match(x.copy, /Fuente: NWS Miami https:\/\/weather.gov\/example/);
  assert.match(facebook.copy, /Aviso: verifica la información oficial/);
});

test("low and medium events default to auto eligible, opt-out requires approval, and road closed remains active", async (t) => {
  const automaticWorkspace = await fixture(t);
  const automatic = await ingestClipperLocalNewsEvents({ workspaceDir: automaticWorkspace, now: "2026-07-21T12:00:00Z", events: [{ ...event, status: "closed" }] });
  assert.equal(automatic.status.events.active, 1);
  assert.equal(automatic.status.queue.autoEligible, 2);
  assert.equal(automatic.status.queue.approvalRequired, 0);

  const optedOutWorkspace = await fixture(t);
  const optedOut = await ingestClipperLocalNewsEvents({ workspaceDir: optedOutWorkspace, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "false" }, events: [event] });
  assert.equal(optedOut.status.queue.autoEligible, 0);
  assert.equal(optedOut.status.queue.approvalRequired, 2);
});

test("NWS sources target Miami and NYC coordinates instead of statewide alerts", () => {
  const configured = __clipperLocalNewsInternals.sources({});
  assert.equal(configured.find((source) => source.id === "nws-miami")?.url, "https://api.weather.gov/alerts/active?point=25.7617,-80.1918");
  assert.equal(configured.find((source) => source.id === "nws-nyc")?.url, "https://api.weather.gov/alerts/active?point=40.7128,-74.0060");
  assert.ok(configured.every((source) => !/[?&]area=(FL|NY)/.test(source.url)));
});

test("status exposes optional road connectors while cycles fetch only configured sources", async (t) => {
  const workspaceDir = await fixture(t);
  const requested: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    requested.push(String(url));
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", env: {}, fetch: fetcher as typeof fetch });
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.startsWith("https://api.weather.gov/")));
  const ny511 = cycle.status.connectors.find((connector) => connector.id === "ny511");
  const fl511 = cycle.status.connectors.find((connector) => connector.id === "fl511");
  assert.deepEqual({ configured: ny511?.configured, requiresKey: ny511?.requiresKey }, { configured: false, requiresKey: true });
  assert.equal(fl511?.configured, false);
});

test("sensitive Spanish and English topics are gated for approval", async (t) => {
  const workspaceDir = await fixture(t);
  const sensitive = ["Menor identificado como víctima", "Unconfirmed shooting", "Arresto y acusación", "Fallecido en incidente", "Rumor sin confirmar"];
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE: "true" }, events: sensitive.map((title, index) => ({ ...event, sourceEventId: `sensitive-${index}`, title: index === 4 ? "Actualización policial" : title, description: index === 4 ? title : event.description })) });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.equal(queue.length, sensitive.length * 2);
  assert.ok(queue.every((item: any) => ["high", "critical"].includes(item.risk) && item.status === "approval_required"));
});

test("NY511 sends its key only as an ephemeral query parameter and never persists it", async (t) => {
  const workspaceDir = await fixture(t);
  const secret = "super-secret-developer-key";
  const requested: URL[] = [];
  const fetcher = async (url: string | URL | Request) => {
    requested.push(new URL(String(url)));
    return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", env: { NY511_FEED_URL: "https://example.test/incidents", NY511_API_KEY: secret }, fetch: fetcher as typeof fetch });
  assert.equal(requested.find((url) => url.hostname === "example.test")?.searchParams.get("key"), secret);
  for (const artifact of Object.values(result.status.artifacts)) assert.doesNotMatch(await readFile(artifact, "utf8"), new RegExp(secret));
});

test("runtime validation rejects malformed and excessive route payloads with ZodError", async (t) => {
  const workspaceDir = await fixture(t);
  await assert.rejects(() => ingestClipperLocalNewsEvents({ workspaceDir, events: [{ ...event, lane: "boston-news" }] as any }), z.ZodError);
  await assert.rejects(() => runClipperLocalNewsCycle({ workspaceDir, events: Array.from({ length: 501 }, () => event) }), z.ZodError);
  await assert.rejects(() => recordClipperLocalNewsMetrics({ workspaceDir, metrics: Array.from({ length: 501 }, () => ({ lane: "miami-news" as const, platform: "x" as const })) }), z.ZodError);
  await assert.rejects(() => recordClipperLocalNewsMetrics({ workspaceDir, metrics: [{ lane: "miami-news", platform: "x", impressions: -1 }] }), z.ZodError);
});

test("cycle accepts deterministic injected events without network and resolves missing snapshot events", async (t) => {
  const workspaceDir = await fixture(t);
  await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:03:00Z", events: [], resolveMissing: true, snapshotLanes: ["miami-news"] });
  assert.equal(cycle.status.events.resolved, 1);
  assert.equal(cycle.status.lastRunAt, "2026-07-21T12:03:00.000Z");
});

test("a successful NWS fetch does not resolve an absent FL511 event, while explicit expiry does", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [
    { ...event, source: "fl511", sourceEventId: "fl511-active", title: "Cierre vial", expires: "2026-07-21T14:00:00Z" },
    { ...event, source: "fl511", sourceEventId: "fl511-expired", title: "Cierre temporal", expires: "2026-07-21T12:02:00Z" },
  ] });
  const fetcher = async () => new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:03:00Z", fetch: fetcher as typeof fetch });
  assert.equal(cycle.failedSources.length, 0);
  assert.equal(cycle.status.events.active, 1);
  assert.equal(cycle.status.events.resolved, 1);
  const persisted = JSON.parse(await readFile(path.join(workspaceDir, "events.json"), "utf8")).events;
  assert.equal(persisted.find((item: any) => item.sourceEventId === "fl511-active").lifecycle, "active");
  assert.equal(persisted.find((item: any) => item.sourceEventId === "fl511-expired").lifecycle, "resolved");
});

test("metrics roll into analytics and status without changing publish claims", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [event] });
  const result = await recordClipperLocalNewsMetrics({ workspaceDir, now: "2026-07-21T13:00:00Z", metrics: [
    { eventId: "nws-1", lane: "miami-news", platform: "x", impressions: 100, engagements: 9, clicks: 4, shares: 2, revenueUsd: 12.5, costUsd: 3.25 },
    { eventId: "nws-1", lane: "miami-news", platform: "facebook" },
  ] });
  assert.deepEqual(result.status.metrics, { total: 2, impressions: 100, engagements: 9, clicks: 4, shares: 2, revenueUsd: 12.5, costUsd: 3.25, profitUsd: 9.25 });
  assert.equal(result.status.queue.published, 0);
  assert.match(await readFile(result.status.artifacts.analytics, "utf8"), /"impressions": 100/);
  assert.match(await readFile(result.status.artifacts.analyticsCsv, "utf8"), /revenueUsd,costUsd/);
  assert.deepEqual((await getClipperLocalNewsStatus({ workspaceDir })).metrics, result.status.metrics);
});
