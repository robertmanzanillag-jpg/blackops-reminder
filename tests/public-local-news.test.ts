import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { getPublicLocalNewsBySlug, listPublicLocalNews, renderPublicLocalNewsShareHtml } from "../server/public-local-news";
import { registerRoutes } from "../server/routes";
import { requireAppUser } from "../server/user-context";

const NOW = "2026-07-21T12:00:00.000Z";
let workspaceDir = "";
let server: Server;
let baseUrl = "";
const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  ALLOW_DEV_USER_FALLBACK: process.env.ALLOW_DEV_USER_FALLBACK,
  DEFAULT_USER_ID: process.env.DEFAULT_USER_ID,
  CLIPPERS_LOCAL_NEWS_WORKSPACE: process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
};

const miamiEvent = {
  id: "miami-event-1234567890",
  lane: "miami-news",
  title: "Flood Watch",
  description: "Heavy rain is possible.",
  instruction: "Monitor official updates.",
  location: "Miami-Dade",
  eventType: "Flood Watch",
  source: "National Weather Service",
  sourceUrl: "https://www.weather.gov/example-miami",
  severity: "Moderate",
  urgency: "Expected",
  certainty: "Likely",
  risk: "medium",
  lifecycle: "active",
  effective: "2026-07-21T11:00:00.000Z",
  expires: "2026-07-22T01:00:00.000Z",
  firstSeenAt: "2026-07-21T11:00:00.000Z",
  updatedAt: NOW,
  resolvedAt: null,
  revision: 2,
};

const nyEvent = {
  ...miamiEvent,
  id: "ny-event-1234567890",
  lane: "ny-news",
  title: "Road Closure",
  description: "A route is temporarily closed.",
  location: "Manhattan",
  eventType: "Traffic closure",
  source: "NY511",
  sourceUrl: "https://www.511ny.org/example",
  risk: "low",
};

const highRiskEvent = {
  ...miamiEvent,
  id: "high-risk-event-1234",
  title: "Severe emergency",
  eventType: "Emergency",
  risk: "high",
};

function queueItem(overrides: Record<string, unknown>) {
  return {
    id: "queue-default",
    eventId: miamiEvent.id,
    eventRevision: 2,
    lane: "miami-news",
    platform: "x",
    copy: "INTERNAL QUEUE COPY MUST NEVER BE PUBLIC",
    risk: "medium",
    lifecycle: "active",
    status: "auto_eligible",
    approvalRequired: false,
    autoEligible: true,
    published: false,
    createdAt: NOW,
    ...overrides,
  };
}

test.before(async () => {
  workspaceDir = await mkdtemp(path.join(os.tmpdir(), "public-local-news-"));
  await writeFile(path.join(workspaceDir, "state.json"), JSON.stringify({
    version: 1,
    bootstrappedAt: NOW,
    updatedAt: NOW,
    lastRunAt: NOW,
    scheduleMinutes: 3,
    events: [miamiEvent, nyEvent, highRiskEvent],
    queue: [
      queueItem({ id: "miami-x", platform: "x" }),
      queueItem({ id: "miami-facebook", platform: "facebook" }),
      queueItem({ id: "ny-x", eventId: nyEvent.id, lane: "ny-news", risk: "low" }),
      queueItem({ id: "high-x", eventId: highRiskEvent.id, eventRevision: 1 }),
      queueItem({ id: "quarantined-ny", eventId: nyEvent.id, eventRevision: 2, lane: "ny-news", platform: "facebook", risk: "low", status: "quarantined", approvalRequired: false, autoEligible: false }),
      queueItem({ id: "rejected-ny", eventId: nyEvent.id, eventRevision: 2, lane: "ny-news", platform: "x", risk: "low", status: "rejected", approvalRequired: false, autoEligible: false }),
    ],
    metrics: [],
  }, null, 2));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({
    version: 1,
    entries: [
      { queueItemId: "miami-x", lane: "miami-news", platform: "x", blogId: "private-blog-id", scheduledFor: "2026-07-21T11:50:00.000Z", scheduledAt: NOW, metricoolPostId: "secret-provider-id", token: "never-public" },
      { queueItemId: "miami-facebook", lane: "miami-news", platform: "facebook", blogId: "private-blog-id", scheduledFor: "2026-07-21T11:52:00.000Z", scheduledAt: NOW, metricoolPostId: "secret-provider-id-2" },
      { queueItemId: "ny-x", lane: "ny-news", platform: "x", blogId: "private-ny", scheduledFor: "2099-07-21T12:15:00.000Z", scheduledAt: NOW, metricoolPostId: "future-provider-id" },
      { queueItemId: "high-x", lane: "miami-news", platform: "x", blogId: "private-high", scheduledFor: "2026-07-21T11:55:00.000Z", scheduledAt: NOW, metricoolPostId: null },
      { queueItemId: "quarantined-ny", lane: "ny-news", platform: "facebook", blogId: "private-quarantine", scheduledFor: "2026-07-21T11:56:00.000Z", scheduledAt: NOW, metricoolPostId: "must-not-publish" },
      { queueItemId: "rejected-ny", lane: "ny-news", platform: "x", blogId: "private-reject", scheduledFor: "2026-07-21T11:57:00.000Z", scheduledAt: NOW, metricoolPostId: "must-not-publish" },
    ],
  }, null, 2));

  process.env.NODE_ENV = "production";
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  delete process.env.DEFAULT_USER_ID;
  process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE = workspaceDir;
  process.env.PUBLIC_BASE_URL = "https://news.example.com";
  const app = express();
  app.use(express.json());
  app.use(requireAppUser);
  server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(workspaceDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("ledger evidence gates articles and X/Facebook rows deduplicate to one bilingual story", async () => {
  const feed = await listPublicLocalNews({ workspaceDir, lang: "es", limit: 50 });
  assert.equal(feed.articles.length, 1);
  const article = feed.articles[0];
  assert.equal(article.city, "miami");
  assert.equal(article.lang, "es");
  assert.deepEqual(article.publicationEvidence.platforms, ["facebook", "x"]);
  assert.match(article.translations.en.title, /Weather update/);
  assert.match(article.translations.es.title, /Actualización meteorológica/);
  assert.match(article.translations.es.body, /no pretende ser una traducción completa/);

  const serialized = JSON.stringify(feed);
  for (const forbidden of ["INTERNAL QUEUE COPY", "private-blog-id", "secret-provider-id", "never-public", workspaceDir]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(serialized, /high-risk-event|Road Closure/);
  assert.match(article.slug, /^miami-update-/);
  assert.equal(
    article.slug,
    (await listPublicLocalNews({ workspaceDir, lang: "en" })).articles[0].slug,
    "article URLs must remain stable across languages and mutable presentation fields",
  );
});

test("city filters, language projection, detail lookup, and safe share metadata work", async () => {
  const miami = await listPublicLocalNews({ workspaceDir, city: "miami", lang: "en", limit: 1 });
  assert.equal(miami.articles.length, 1);
  assert.equal(miami.articles[0].title, miami.articles[0].translations.en.title);
  const ny = await listPublicLocalNews({ workspaceDir, city: "new-york", lang: "en" });
  assert.equal(ny.articles.length, 0, "NY has no Metricool ledger evidence");

  const detail = await getPublicLocalNewsBySlug(miami.articles[0].slug, { workspaceDir, lang: "es" });
  assert.equal(detail?.title, detail?.translations.es.title);
  const html = renderPublicLocalNewsShareHtml(detail!, "https://example.com/news/miami/story", "https://example.com/logo.png");
  assert.match(html, /property="og:title"/);
  assert.match(html, /https:\/\/example.com\/news\/miami\/story/);
  assert.match(html, /property="og:image"/);
  assert.doesNotMatch(html, /private-blog-id|INTERNAL QUEUE COPY/);
});

test("public HTTP feed bypasses auth, validates queries, supports ETag, and returns 404 for unknown slugs", async () => {
  const response = await fetch(`${baseUrl}/api/public/local-news?city=miami&lang=en&limit=10`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /public/);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  const body = await response.json() as { articles: Array<{ slug: string }> };
  assert.equal(body.articles.length, 1);

  const notModified = await fetch(`${baseUrl}/api/public/local-news?city=miami&lang=en&limit=10`, { headers: { "If-None-Match": etag! } });
  assert.equal(notModified.status, 304);
  const invalid = await fetch(`${baseUrl}/api/public/local-news?city=boston&limit=0`);
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${baseUrl}/api/public/local-news/does-not-exist?lang=es`);
  assert.equal(missing.status, 404);

  const share = await fetch(`${baseUrl}/news/article/${body.articles[0].slug}?lang=es`);
  assert.equal(share.status, 200);
  const shareHtml = await share.text();
  assert.match(shareHtml, /property="og:title"/);
  assert.match(shareHtml, /https:\/\/news\.example\.com\/local-news\/miami-news-profile\.png/);
  assert.match(shareHtml, /https:\/\/news\.example\.com\/news\/article\//);
});
