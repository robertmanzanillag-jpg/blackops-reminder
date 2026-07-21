import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_MEDIA_STUDIO_AGENT_API,
  AI_MEDIA_STUDIO_AGENT_ROUTE,
  aiMediaStudioAgentSnapshotSchema,
} from "../shared/ai-media-studio-agent";
import { createAiMediaStudioAgentSnapshot } from "../server/ai-media-studio/agent-control";

const routesSource = readFileSync(new URL("../server/ai-media-studio/routes.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const officeSource = readFileSync(new URL("../client/src/pages/agents-office.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../client/src/pages/ai-media-studio-agent.tsx", import.meta.url), "utf8");

test("dedicated media agent snapshot exposes exact ownership, gates, evidence and launch bounds", () => {
  const snapshot = createAiMediaStudioAgentSnapshot(() => new Date("2026-07-21T20:00:00.000Z"));
  assert.deepEqual(aiMediaStudioAgentSnapshotSchema.parse(snapshot), snapshot);
  assert.equal(snapshot.agent.id, "ai-media-studio-agent");
  assert.equal(snapshot.agent.route, AI_MEDIA_STUDIO_AGENT_ROUTE);
  assert.deepEqual(snapshot.launchTarget, {
    minimumAvatars: 5,
    maximumAvatars: 10,
    videosPerAvatar: 10,
    minimumVideos: 50,
    maximumVideos: 100,
  });
  assert.equal(snapshot.summary.total, snapshot.workItems.length);
  assert.equal(snapshot.summary.done, 4);
  assert.equal(snapshot.summary.running, 0);
  assert.equal(snapshot.summary.ready, 0);
  assert.equal(snapshot.summary.blocked, 2);
  assert.equal(new Set(snapshot.workItems.map((item) => item.id)).size, snapshot.workItems.length);
  for (const item of snapshot.workItems) {
    assert.ok(item.owner.length > 0);
    assert.ok(item.acceptance.length > 0);
    assert.ok(item.mergeGate.length > 0);
    assert.ok(item.nextAction.length > 0);
  }
});

test("agent status is explicitly no-spend, no-deploy, no-migration and no-live-provider", () => {
  const snapshot = createAiMediaStudioAgentSnapshot(() => new Date("2026-07-21T20:00:00.000Z"));
  assert.deepEqual(snapshot.safety, {
    spendAuthorized: false,
    deploymentAuthorized: false,
    migrationsApplied: false,
    liveProviderCallsEnabled: false,
  });
  const sandbox = snapshot.workItems.find((item) => item.id === "ams-agent-one-video-sandbox");
  const canary = snapshot.workItems.find((item) => item.id === "ams-agent-five-by-ten-canary");
  const staging = snapshot.workItems.find((item) => item.id === "ams-agent-staging-migrations");
  const durablePlan = snapshot.workItems.find((item) => item.id === "ams-agent-durable-roster-plan");
  assert.equal(sandbox?.state, "blocked");
  assert.equal(canary?.state, "backlog");
  assert.match(sandbox?.mergeGate ?? "", /Robert approves/u);
  assert.equal(durablePlan?.state, "done");
  assert.equal(durablePlan?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/136");
  assert.match(durablePlan?.acceptance.join(" ") ?? "", /exactly ten blocked durable slots per avatar/u);
  assert.match(durablePlan?.acceptance.join(" ") ?? "", /no budget reservation[\s\S]*provider call/u);
  assert.match(durablePlan?.evidence.join(" ") ?? "", /PostgreSQL 16[\s\S]*5→50[\s\S]*10→100/u);
  assert.match(durablePlan?.evidence.join(" ") ?? "", /checker[\s\S]*App QA[\s\S]*P0=P1=P2=0/u);
  assert.match(durablePlan?.blockers.join(" ") ?? "", /Merge[\s\S]*sandbox[\s\S]*spend[\s\S]*deployment/u);
  assert.doesNotMatch(staging?.blockers.join(" ") ?? "", /PR1|PR16|PR13/u);
  assert.match(staging?.blockers.join(" ") ?? "", /staging target[\s\S]*explicit rehearsal approval/u);
  assert.match(staging?.nextAction ?? "", /separate approval[\s\S]*restored-staging rehearsal/u);
});

test("agent API is authenticated, read-only and mounted separately from product actions", () => {
  assert.equal(AI_MEDIA_STUDIO_AGENT_API, "/api/ai-media-studio/agent");
  assert.match(routesSource, /router\.get\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/agent`[\s\S]*getCurrentUserId\(req\)[\s\S]*createAiMediaStudioAgentSnapshot/u);
  assert.doesNotMatch(routesSource, /router\.(?:post|patch|put|delete)\(`\$\{AI_MEDIA_STUDIO_API_BASE\}\/agent/u);
});

test("Agents Office and the app expose one dedicated control pane with safe status copy", () => {
  assert.match(appSource, /path="\/ai-media-studio-agent" component=\{AiMediaStudioAgentPage\}/u);
  assert.match(officeSource, /id: "ai-media-studio-agent"[\s\S]*href: "\/ai-media-studio-agent"[\s\S]*station: "Media Studio"/u);
  assert.match(officeSource, /"ai-media-studio-agent": "media-studio"/u);
  assert.match(pageSource, /This control pane is read-only/u);
  assert.match(pageSource, /Spend, deployment, migrations and live provider calls remain disabled/u);
  assert.match(pageSource, /Ownership and merge readiness are shown as gates, not estimates/u);
});

test("snapshot schema rejects summary drift and unsafe PR hosts", () => {
  const snapshot = createAiMediaStudioAgentSnapshot(() => new Date("2026-07-21T20:00:00.000Z"));
  assert.equal(aiMediaStudioAgentSnapshotSchema.safeParse({ ...snapshot, summary: { ...snapshot.summary, done: 99 } }).success, false);
  assert.equal(aiMediaStudioAgentSnapshotSchema.safeParse({
    ...snapshot,
    workItems: snapshot.workItems.map((item, index) => index === 0
      ? { ...item, pullRequestUrl: "https://example.com/not-github" }
      : item),
  }).success, false);
});
