import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { operationsApi } from "../client/src/features/ai-media-studio/operations/api.ts";
import {
  rankAttributions,
  scheduledPublishingError,
  validateAnalyticsDateWindow,
  type Attribution,
} from "../client/src/features/ai-media-studio/operations/types.ts";

const repositoryRoot = process.cwd();
const operationsRoot = resolve(repositoryRoot, "client/src/features/ai-media-studio/operations");
const source = (name: string) => readFile(resolve(operationsRoot, name), "utf8");

test("operations client uses the exact provider-neutral endpoint wrappers", async () => {
  const api = await source("api.ts");
  for (const route of [
    "/publishing/jobs", "/publishing/connections", "/analytics/summary", "/analytics/attribution",
    "/automation/sources", "/automation/policy",
  ]) assert.match(api, new RegExp(route.replaceAll("/", "\\/")));
  for (const action of ["approve", "reject", "cancel", "retry"]) assert.match(api, new RegExp(`\\/jobs\\/\\$\\{encodeURIComponent\\(id\\)\\}\\/${action}`));
  assert.match(api, /PublishingJobsResponse/);
  assert.match(api, /AttributionResponse/);
  assert.match(api, /SourcesResponse/);
  assert.doesNotMatch(api, /enable-automatic|auto-publish|\/publish-now/);
});

test("publishing UI is approval gated and automatic mode is visibly locked", async () => {
  const publishing = await source("publishing.tsx");
  assert.match(publishing, /Immutable publishing preview/);
  assert.match(publishing, /Approve/);
  assert.match(publishing, /Reject/);
  assert.match(publishing, /Cancel/);
  assert.match(publishing, /Retry/);
  assert.match(publishing, /value="automatic" disabled/);
  assert.match(publishing, /Automatic publishing remains locked/);
  assert.match(publishing, /previewDigest: job\.preview\.digest/);
  assert.match(publishing, /Load more publishing jobs/);
});

test("publishing composer blocks unavailable assets and non-future schedules before mutation", async () => {
  const publishing = await source("publishing.tsx");
  assert.match(publishing, /const assetsUnavailable = assets\.isLoading \|\| assets\.isError \|\| readyAssets\.length === 0/);
  assert.match(publishing, /disabled=\{assetsUnavailable\}/);
  assert.match(publishing, /disabled=\{create\.isPending \|\| assetsUnavailable\}/);
  assert.match(publishing, /Loading ready canonical media assets/);
  assert.match(publishing, /No ready canonical media assets are available/);
  assert.match(publishing, /Retry assets/);
  assert.match(publishing, /scheduledPublishingError\(scheduledFor\)/);
  assert.ok(scheduledPublishingError("2026-07-20T11:59:00Z", Date.parse("2026-07-20T12:00:00Z")));
  assert.ok(scheduledPublishingError("2026-07-20T12:00:00Z", Date.parse("2026-07-20T12:00:00Z")));
  assert.equal(scheduledPublishingError("2026-07-20T12:00:01Z", Date.parse("2026-07-20T12:00:00Z")), null);
  assert.ok(scheduledPublishingError("not-a-date", Date.parse("2026-07-20T12:00:00Z")));
});

test("analytics renders the full summary and paginated attribution rankings", async () => {
  const analytics = await source("analytics.tsx");
  for (const label of ["Views", "Engagement", "CTR", "Retention", "Avg. watch", "Cost / video", "Cost / view", "Shares"]) assert.match(analytics, new RegExp(label.replace("/", "\\/")));
  for (const dimension of ["avatar", "hook", "cta", "posting_time", "category"]) assert.match(analytics, new RegExp(`value: \\"${dimension}\\"`));
  assert.match(analytics, /Load more attribution/);
  assert.match(analytics, /isFetchNextPageError/);
});

test("analytics date edits remain draft until an accessible atomic apply or clear", async () => {
  const analytics = await source("analytics.tsx");
  assert.match(analytics, /const \[draftFrom, setDraftFrom\]/);
  assert.match(analytics, /const \[draftTo, setDraftTo\]/);
  assert.match(analytics, /const \[appliedWindow, setAppliedWindow\]/);
  assert.match(analytics, /validateAnalyticsDateWindow\(draftFrom, draftTo\)/);
  assert.match(analytics, /Apply date range/);
  assert.match(analytics, /Clear date range/);
  assert.match(analytics, /role="alert"/);
  assert.match(analytics, /aria-invalid=\{Boolean\(dateError\)\}/);
  assert.match(analytics, /appliedWindow \? \{ from: isoDate\(appliedWindow\.from\), to: isoDate\(appliedWindow\.to, true\) \} : \{\}/);
  assert.doesNotMatch(analytics, /from: isoDate\(draftFrom\)|to: isoDate\(draftTo/);

  assert.deepEqual(validateAnalyticsDateWindow("2026-07-01", "2026-07-20"), {
    ok: true,
    window: { from: "2026-07-01", to: "2026-07-20" },
  });
  assert.equal(validateAnalyticsDateWindow("2026-07-01", "").ok, false);
  assert.equal(validateAnalyticsDateWindow("", "2026-07-20").ok, false);
  assert.equal(validateAnalyticsDateWindow("2026-07-21", "2026-07-20").ok, false);
});

test("attribution ranking is deterministic and omits missing dimensions", () => {
  const base = {
    publicationId: "publication-1", sourceItemId: null, scriptId: null, influencerId: null,
    campaignKey: null, attributedAt: "2026-07-20T12:00:00.000Z", model: "direct" as const,
  };
  const rows: Attribution[] = [
    { ...base, publicationId: "publication-1", dimensions: { avatarId: "emily", hook: "Hidden gem", cta: null, postingTime: null, category: "food" } },
    { ...base, publicationId: "publication-2", dimensions: { avatarId: "emily", hook: "Worth it", cta: null, postingTime: null, category: "food" } },
    { ...base, publicationId: "publication-3", dimensions: { avatarId: "alex", hook: "Tonight", cta: null, postingTime: null, category: "nightlife" } },
  ];
  assert.deepEqual(rankAttributions(rows, "avatar"), [{ label: "emily", count: 2 }, { label: "alex", count: 1 }]);
  assert.deepEqual(rankAttributions(rows, "cta"), []);
});

test("automation policy is read-only, approval-required, and exposes no enable or post action", async () => {
  const automation = await source("automation.tsx");
  const api = await source("api.ts");
  assert.match(automation, /Automatic publishing kill switch/);
  assert.match(automation, /LOCKED ON/);
  assert.match(automation, /No enable or post action available/);
  assert.match(automation, /Source intake status/);
  assert.match(automation, /Load more sources/);
  assert.match(automation, /isFetchNextPageError/);
  assert.doesNotMatch(api, /automationPolicy.*post|kill-switch.*post/i);
});

test("publishing connection DTO contains readiness only and no secret-bearing fields", async () => {
  const types = await source("types.ts");
  const connection = types.slice(types.indexOf("export type PublishingConnection"), types.indexOf("export type PublishingConnectionsResponse"));
  assert.match(connection, /platform/);
  assert.match(connection, /status/);
  assert.match(connection, /capabilities/);
  assert.doesNotMatch(connection, /secret|credential|accessToken|refreshToken|apiKey/);
});

test("all three operations sections are mounted and navigable", async () => {
  const page = await readFile(resolve(repositoryRoot, "client/src/pages/ai-media-studio.tsx"), "utf8");
  const navigation = await readFile(resolve(repositoryRoot, "client/src/features/ai-media-studio/navigation.ts"), "utf8");
  assert.match(page, /OperationsWorkspace/);
  for (const anchor of ["publishing", "analytics", "automation"]) assert.match(navigation, new RegExp(`#${anchor}`));
});

test("API retains cursor metadata for every operational collection", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    requested.push(String(input));
    if (String(input).includes("publishing/jobs")) return new Response(JSON.stringify({ jobs: [], nextCursor: "job-next", hasMore: true }));
    if (String(input).includes("analytics/attribution")) return new Response(JSON.stringify({ attributions: [], nextCursor: "attr-next", hasMore: true }));
    return new Response(JSON.stringify({ sources: [], nextCursor: "source-next", hasMore: true }));
  }) as typeof fetch;
  try {
    const jobs = await operationsApi.publishingJobs({ cursor: "job-cursor", limit: 25 });
    const attributions = await operationsApi.attributions({ dimension: "hook", cursor: "attr-cursor", limit: 25 });
    const sources = await operationsApi.sources({ cursor: "source-cursor", limit: 25 });
    assert.deepEqual([jobs.nextCursor, attributions.nextCursor, sources.nextCursor], ["job-next", "attr-next", "source-next"]);
    assert.ok(jobs.hasMore && attributions.hasMore && sources.hasMore);
    assert.match(requested.join("\n"), /cursor=job-cursor/);
    assert.match(requested.join("\n"), /cursor=attr-cursor/);
    assert.match(requested.join("\n"), /cursor=source-cursor/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
