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
  assert.match(x.copy, /Según NWS Miami .*https:\/\/weather.gov\/example/);
  assert.match(facebook.copy, /Esta página no es la agencia emisora/);
  assert.equal(facebook.textOnly, true);
  assert.equal(facebook.mediaRequired, false);
  assert.match(facebook.copy, /Hora: .*E[DS]T/);
  assert.match(facebook.copy, /Impacto: Evacuate immediately/);
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

test("status exposes built-in official sources and fetches optional sources only when configured", async (t) => {
  const workspaceDir = await fixture(t);
  const requested: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    requested.push(String(url));
    return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cycle = await runClipperLocalNewsCycle({ workspaceDir, now: "2026-07-21T12:00:00Z", env: {}, fetch: fetcher as typeof fetch });
  assert.equal(requested.length, 8);
  assert.ok(requested.some((url) => url === "https://feeds.everbridge.net/feeds/453003085617722/rss/rss.xml"));
  assert.ok(requested.some((url) => url === "https://www.miamidade.gov/global/rss-news.page"));
  assert.equal(requested.filter((url) => url.includes("Road_Closures/FeatureServer")).length, 4);
  const ny511 = cycle.status.connectors.find((connector) => connector.id === "ny511");
  const fl511 = cycle.status.connectors.find((connector) => connector.id === "fl511");
  assert.deepEqual({ configured: ny511?.configured, requiresKey: ny511?.requiresKey }, { configured: false, requiresKey: true });
  assert.equal(fl511?.configured, false);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "notify-nyc")?.configured, true);
  assert.equal(cycle.status.connectors.find((connector) => connector.id === "fhp-miami-dade")?.configured, true);
  assert.equal(cycle.status.coverage.miamiTraffic, "public_incident_feed");
  assert.equal(cycle.status.coverage.nyTraffic, "notify_nyc_public");
});

test("professional newsroom classifies desks and produces attributed Facebook text without media", async (t) => {
  const workspaceDir = await fixture(t);
  const result = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [{
    sourceEventId: "traffic-1", source: "Notify NYC", sourceUrl: "https://notify.nyc/traffic-1", lane: "ny-news",
    title: "Road closure on Broadway", description: "Two lanes are closed near Canal Street.", instruction: "Use an alternate route.",
    location: "Broadway at Canal Street", eventType: "Traffic closure", urgency: "Expected",
  }] });
  const persisted = JSON.parse(await readFile(path.join(workspaceDir, "events.json"), "utf8")).events[0];
  const facebook = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items.find((item: any) => item.platform === "facebook");
  assert.equal(persisted.section, "traffic");
  assert.equal(persisted.editorialUrgency, "developing");
  assert.deepEqual({ textOnly: facebook.textOnly, mediaRequired: facebook.mediaRequired }, { textOnly: true, mediaRequired: false });
  assert.match(facebook.copy, /TRÁFICO:/);
  assert.match(facebook.copy, /Qué hacer: Use an alternate route/);
  assert.match(facebook.copy, /Según Notify NYC/);
  assert.equal(result.status.editorial.owner, "Local News CEO");
  assert.equal(result.status.editorial.sections.traffic.events, 1);
  assert.equal(result.status.editorial.textOnlyFacebook, 1);
});

test("cadence defers overflow with notBefore while preserving automatic eligibility", async (t) => {
  const workspaceDir = await fixture(t);
  const events = Array.from({ length: 7 }, (_, index) => ({
    sourceEventId: `traffic-${index}`, source: "Notify NYC", sourceUrl: `https://notify.nyc/${index}`, lane: "ny-news" as const,
    title: `Traffic closure ${index}`, description: "One lane is closed.", location: `Street ${index}`, eventType: "Traffic closure",
  }));
  const result = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  const facebook = queue.filter((item: any) => item.platform === "facebook");
  assert.equal(facebook.filter((item: any) => item.gateReason === "none").length, 6);
  const deferred = facebook.find((item: any) => item.gateReason === "cadence");
  assert.equal(deferred.status, "auto_eligible");
  assert.equal(deferred.approvalRequired, false);
  assert.equal(deferred.notBefore, "2026-07-21T13:00:00.000Z");
  assert.equal(result.status.editorial.cadenceHeld, 1);
});

test("updates, corrections and resolved notices are tracked as newsroom revisions", async (t) => {
  const workspaceDir = await fixture(t);
  const base = { sourceEventId: "revision-1", source: "Miami-Dade County", sourceUrl: "https://miamidade.gov/update", lane: "miami-news" as const, title: "County service update", description: "Service is delayed.", location: "Miami-Dade", eventType: "Local update" };
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [base] });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:05:00Z", events: [{ ...base, description: "Service is delayed by one hour." }] });
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:10:00Z", events: [{ ...base, status: "correction", title: "Correction: county service update", description: "Service is delayed by 30 minutes." }] });
  const resolved = await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:15:00Z", events: [{ ...base, status: "resolved", description: "Service has resumed." }] });
  const queue = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items;
  assert.ok(queue.some((item: any) => item.revisionKind === "update" && /ACTUALIZACIÓN/.test(item.copy)));
  assert.ok(queue.some((item: any) => item.revisionKind === "correction" && /CORRECCIÓN/.test(item.copy)));
  assert.ok(queue.some((item: any) => item.revisionKind === "resolved" && /RESUELTO/.test(item.copy)));
  assert.equal(resolved.status.editorial.revisions, 3);
  assert.equal(resolved.status.editorial.corrections, 1);
  assert.equal(resolved.status.editorial.resolvedRevisions, 1);
});

test("FHP ArcGIS mapper uses documented fields and drops stale Miami-Dade incidents", () => {
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "fhp-miami-closures")!;
  const mapped = __clipperLocalNewsInternals.sourceEvents({ features: [
    { attributes: { INCIDENTID: "fresh-1", DATESTR: "07/21/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "MIAMI-DADE", LOCATION: "I-95 NB", REMARKS: "Two lanes closed" } },
    { attributes: { INCIDENTID: "wrong-county-1", DATESTR: "07/21/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "BROWARD", LOCATION: "I-95 NB", REMARKS: "Outside Miami-Dade" } },
    { attributes: { INCIDENTID: "stale-1", DATESTR: "07/10/2026", TIMESTR: "07:30", TYPEEVENT: "Road Closure", COUNTY: "MIAMI-DADE", LOCATION: "Old Road", REMARKS: "Old event" } },
  ] }, source, "2026-07-21T12:00:00Z");
  assert.equal(mapped.length, 1);
  assert.deepEqual({ id: mapped[0].sourceEventId, type: mapped[0].eventType, location: mapped[0].location, description: mapped[0].description }, { id: "fresh-1", type: "Road Closure", location: "I-95 NB", description: "Two lanes closed" });
});

test("official RSS adapters normalize attributed XML items without credentials and skip stale/future feed entries", () => {
  const source = __clipperLocalNewsInternals.sources({}).find((item) => item.id === "notify-nyc")!;
  const items = __clipperLocalNewsInternals.rssEvents(`<?xml version="1.0"?><rss><channel>
    <item><guid>alert-1</guid><title>Traffic &amp; Transit</title><description><![CDATA[Road closed <b>temporarily</b>.]]></description><link>https://notify.nyc/alert-1</link><pubDate>Tue, 21 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>old-alert</guid><title>Old closure</title><description>Old</description><link>https://notify.nyc/old</link><pubDate>Fri, 17 Jul 2026 12:00:00 GMT</pubDate></item>
    <item><guid>future-alert</guid><title>Future closure</title><description>Future</description><link>https://notify.nyc/future</link><pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`, source, "2026-07-21T12:00:00Z");
  assert.equal(items.length, 1);
  assert.deepEqual({ source: items[0].source, title: items[0].title, description: items[0].description }, { source: "Notify NYC", title: "Traffic & Transit", description: "Road closed temporarily ." });
  assert.equal(items[0].effective, "2026-07-21T12:00:00.000Z");
});

test("Facebook newsroom copy keeps official detail concise for long source descriptions", async (t) => {
  const workspaceDir = await fixture(t);
  await ingestClipperLocalNewsEvents({ workspaceDir, now: "2026-07-21T12:00:00Z", events: [{
    sourceEventId: "long-copy-1", source: "Miami-Dade County", sourceUrl: "https://miamidade.gov/long", lane: "miami-news",
    title: "Traffic advisory", description: "Long detail. ".repeat(300), instruction: "Use alternate route. ".repeat(100),
    location: "Miami-Dade", eventType: "Traffic advisory",
  }] });
  const facebook = JSON.parse(await readFile(path.join(workspaceDir, "metricool-queue.json"), "utf8")).items.find((item: any) => item.platform === "facebook");
  assert.ok(facebook.copy.length < 1800);
  assert.match(facebook.copy, /Impacto: Long detail/);
  assert.match(facebook.copy, /Qué hacer: Use alternate route/);
});

test("sensitive Spanish and English topics are gated for approval", async (t) => {
  const workspaceDir = await fixture(t);
  const sensitive = ["Menor identificado como víctima", "Unconfirmed shooting", "Arresto y acusación", "Fallecido en incidente", "Rumor sin confirmar", "Crime investigation involving a robbery"];
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
