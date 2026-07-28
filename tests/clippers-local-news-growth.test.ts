import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildLocalNewsCeoDecision,
  buildLocalNewsGrowthPackage,
  localNewsArticleSlug,
  selectLocalNewsGrowthVariant,
} from "../server/clippers-local-news-growth";

const event = {
  id: "notify-nyc:traffic:123",
  lane: "ny-news" as const,
  title: "Broadway closure",
  location: "Broadway at Canal Street",
  section: "traffic" as const,
  editorialUrgency: "developing" as const,
  lifecycle: "active" as const,
};

test("article slugs and empty-data experiments are deterministic", () => {
  assert.equal(localNewsArticleSlug(event.id, event.lane), localNewsArticleSlug(event.id, event.lane));
  assert.equal(selectLocalNewsGrowthVariant(event.id, []), selectLocalNewsGrowthVariant(event.id, []));
});

test("headline experiments use observed results only after both variants have enough impressions", () => {
  const metrics = [
    { variantId: "utility" as const, impressions: 120, engagements: 8, clicks: 20, shares: 6 },
    { variantId: "impact" as const, impressions: 130, engagements: 4, clicks: 3, shares: 1 },
  ];
  assert.equal(selectLocalNewsGrowthVariant(event.id, metrics), "utility");
  assert.equal(selectLocalNewsGrowthVariant(event.id, [metrics[0]]), selectLocalNewsGrowthVariant(event.id, []));
});

test("growth package stays zero-cost and produces an owned tracked link plus a local short-form manifest", () => {
  const growth = buildLocalNewsGrowthPackage(event, [], "https://news.example.com/path");
  assert.equal(growth.zeroCost, true);
  assert.equal(growth.experiment, "deterministic_observed_metrics");
  assert.deepEqual(
    { minimum: growth.ceoDecision.dailyMinimumPosts, target: growth.ceoDecision.dailyTargetPosts, format: growth.ceoDecision.preferredFormat },
    { minimum: 10, target: 10, format: "video_first" },
  );
  assert.match(growth.ownedArticleUrl || "", /^https:\/\/news\.example\.com\/news\/article\//);
  assert.match(growth.ownedArticleUrl || "", /utm_medium=organic_social/);
  assert.match(growth.ownedArticleUrl || "", new RegExp(`utm_content=${growth.variantId}`));
  assert.deepEqual(growth.hashtags, ["#NewYork", "#Trafico"]);
  assert.deepEqual(
    { ready: growth.shortForm.ready, format: growth.shortForm.format, sound: growth.shortForm.soundRequired, mode: growth.shortForm.renderMode },
    { ready: true, format: "9:16", sound: true, mode: "local_template" },
  );
});

test("growth package prefers a verified source video when one is available", () => {
  const growth = buildLocalNewsGrowthPackage({ ...event, mediaUrl: "https://notify.nyc/closure.mp4", mediaType: "video", qualityScore: 94 }, [], "https://news.example.com");
  assert.equal(growth.shortForm.publishableVideoUrl, "https://notify.nyc/closure.mp4");
});

test("CEO raises volume only after observed performance clears confidence thresholds", () => {
  const growing = buildLocalNewsCeoDecision([{ impressions: 600, engagements: 15, clicks: 2, shares: 1 }]);
  const breakout = buildLocalNewsCeoDecision([{ impressions: 1_200, engagements: 50, clicks: 8, shares: 4 }]);
  assert.deepEqual({ target: growing.dailyTargetPosts, mode: growing.performanceMode }, { target: 12, mode: "growing" });
  assert.deepEqual({ target: breakout.dailyTargetPosts, mode: breakout.performanceMode }, { target: 14, mode: "breakout" });
});

test("local-news publishing path contains no paid model SDK or generation calls", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const files = [
    "server/clippers-local-news-growth.ts",
    "server/clippers-local-news-agent.ts",
    "server/clippers-local-news-metricool.ts",
    "server/public-local-news.ts",
  ];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  for (const forbidden of ["@google/genai", "chat.completions", "responses.create", "anthropic.messages", "generateContent("]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not enter the automatic publishing path`);
  }
});
