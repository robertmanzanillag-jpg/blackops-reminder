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
  assert.equal(snapshot.summary.done, 13);
  assert.equal(snapshot.summary.running, 1);
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
  const durableScriptBatch = snapshot.workItems.find((item) => item.id === "ams-agent-durable-script-batch");
  const launchReadiness = snapshot.workItems.find((item) => item.id === "ams-agent-launch-readiness");
  const offlinePreflight = snapshot.workItems.find((item) => item.id === "ams-agent-offline-launch-preflight");
  const sandboxReadiness = snapshot.workItems.find((item) => item.id === "ams-agent-one-video-sandbox-readiness");
  const staticHeyGenOnboarding = snapshot.workItems.find((item) => item.id === "ams-agent-static-heygen-onboarding");
  const oneVideoExecutionControl = snapshot.workItems.find((item) => item.id === "ams-agent-one-video-execution-control");
  const heyGenVerificationEvidence = snapshot.workItems.find((item) => item.id === "ams-agent-heygen-verification-evidence");
  const secureHeyGenSetupRuntime = snapshot.workItems.find((item) => item.id === "ams-agent-secure-heygen-setup-runtime");
  const quoteBoundHumanApproval = snapshot.workItems.find((item) => item.id === "ams-agent-quote-bound-human-approval");
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
  assert.equal(durableScriptBatch?.state, "done");
  assert.equal(durableScriptBatch?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/141");
  assert.match(durableScriptBatch?.acceptance.join(" ") ?? "", /ten eligible Kong sources[\s\S]*every blocked slot/u);
  assert.match(durableScriptBatch?.acceptance.join(" ") ?? "", /Legacy generation[\s\S]*no provider[\s\S]*budget[\s\S]*render[\s\S]*outbox/u);
  assert.match(durableScriptBatch?.evidence.join(" ") ?? "", /PostgreSQL 16[\s\S]*5→50[\s\S]*10→100[\s\S]*zero launch side effects/u);
  assert.match(durableScriptBatch?.evidence.join(" ") ?? "", /checker[\s\S]*P0=P1=P2=0/u);
  assert.match(durableScriptBatch?.evidence.join(" ") ?? "", /App QA[\s\S]*P0=P1=P2=0/u);
  assert.match(durableScriptBatch?.blockers.join(" ") ?? "", /Merge[\s\S]*sandbox[\s\S]*spend[\s\S]*deployment[\s\S]*Clippers chunk warning/u);
  assert.equal(launchReadiness?.state, "done");
  assert.equal(launchReadiness?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/144");
  assert.match(launchReadiness?.acceptance.join(" ") ?? "", /5–10 × 10[\s\S]*Video Title[\s\S]*SEO/u);
  assert.match(launchReadiness?.acceptance.join(" ") ?? "", /selected\/current variants/u);
  assert.match(launchReadiness?.evidence.join(" ") ?? "", /722 passed[\s\S]*P0=P1=P2=P3=0/u);
  assert.match(launchReadiness?.blockers.join(" ") ?? "", /Merge[\s\S]*sandbox[\s\S]*spend[\s\S]*deployment/u);
  assert.match(launchReadiness?.nextAction ?? "", /PR #144 unmerged[\s\S]*do not call HeyGen/u);
  assert.equal(offlinePreflight?.state, "done");
  assert.equal(offlinePreflight?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/146");
  assert.match(offlinePreflight?.acceptance.join(" ") ?? "", /5–10 × 10[\s\S]*14 launch gates[\s\S]*No provider call/u);
  assert.match(offlinePreflight?.evidence.join(" ") ?? "", /54\/54[\s\S]*749 passed[\s\S]*P0=P1=P2=P3=0/u);
  assert.match(offlinePreflight?.blockers.join(" ") ?? "", /Merge[\s\S]*sandbox[\s\S]*spend[\s\S]*deployment/u);
  assert.match(offlinePreflight?.nextAction ?? "", /PR #146 unmerged[\s\S]*one-video HeyGen sandbox/u);
  assert.equal(sandboxReadiness?.state, "done");
  assert.equal(sandboxReadiness?.branch, "codex/ai-media-studio-one-video-sandbox-readiness");
  assert.equal(sandboxReadiness?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/147");
  assert.match(sandboxReadiness?.acceptance.join(" ") ?? "", /5 × 10 batch[\s\S]*read-only 9:16 readiness packet/u);
  assert.match(sandboxReadiness?.acceptance.join(" ") ?? "", /exactly one slot[\s\S]*fake submit[\s\S]*zero publishing/u);
  assert.match(sandboxReadiness?.evidence.join(" ") ?? "", /Draft PR #147[\s\S]*all 50 scripts approved[\s\S]*exactly one selected slot/u);
  assert.match(sandboxReadiness?.evidence.join(" ") ?? "", /811\/812 passed[\s\S]*P0=P1=P2=P3=0/u);
  assert.match(sandboxReadiness?.blockers.join(" ") ?? "", /staging migration rehearsal[\s\S]*live HeyGen[\s\S]*maximum quote[\s\S]*owned storage[\s\S]*callbacks[\s\S]*one-video cost approval/u);
  assert.match(sandboxReadiness?.blockers.join(" ") ?? "", /5 × 10 canary spend[\s\S]*Replit deployment[\s\S]*no provider call or spend/u);
  assert.match(sandboxReadiness?.nextAction ?? "", /PR #147 unmerged[\s\S]*approved secret manager[\s\S]*explicit one-video cost approval/u);
  assert.equal(staticHeyGenOnboarding?.state, "done");
  assert.equal(staticHeyGenOnboarding?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/148");
  assert.match(staticHeyGenOnboarding?.acceptance.join(" ") ?? "", /secret-manager reference[\s\S]*5–10 avatar[\s\S]*blocked no-spend slots/u);
  assert.match(staticHeyGenOnboarding?.evidence.join(" ") ?? "", /PR #148[\s\S]*PostgreSQL 16[\s\S]*P0=P1=P2=P3=0/u);
  assert.match(staticHeyGenOnboarding?.blockers.join(" ") ?? "", /no live HeyGen verification[\s\S]*unapplied[\s\S]*Replit deployment/u);
  assert.match(staticHeyGenOnboarding?.nextAction ?? "", /secret manager[\s\S]*avatar\/voice IDs[\s\S]*read-only live verification/u);
  assert.equal(oneVideoExecutionControl?.state, "done");
  assert.equal(oneVideoExecutionControl?.branch, "codex/ai-media-studio-one-video-execution-control");
  assert.equal(oneVideoExecutionControl?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/149");
  assert.match(oneVideoExecutionControl?.acceptance.join(" ") ?? "", /official HeyGen API profile[\s\S]*exactly one public slot[\s\S]*execution[\s\S]*disabled/u);
  assert.match(oneVideoExecutionControl?.blockers.join(" ") ?? "", /No API key[\s\S]*one-video POST[\s\S]*separate approvals/u);
  assert.equal(heyGenVerificationEvidence?.state, "done");
  assert.equal(heyGenVerificationEvidence?.branch, "codex/ai-media-studio-heygen-verification-evidence");
  assert.equal(heyGenVerificationEvidence?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/154");
  assert.match(heyGenVerificationEvidence?.acceptance.join(" ") ?? "", /credential-version-bound[\s\S]*avatar look[\s\S]*parent-group[\s\S]*voice/u);
  assert.match(heyGenVerificationEvidence?.blockers.join(" ") ?? "", /No API key[\s\S]*provider request[\s\S]*separate approvals/u);
  assert.equal(secureHeyGenSetupRuntime?.state, "done");
  assert.equal(secureHeyGenSetupRuntime?.branch, "codex/ai-media-studio-secure-heygen-setup-runtime");
  assert.equal(secureHeyGenSetupRuntime?.pullRequestUrl, "https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/161");
  assert.match(secureHeyGenSetupRuntime?.acceptance.join(" ") ?? "", /AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY[\s\S]*5–10[\s\S]*GET-only/u);
  assert.match(secureHeyGenSetupRuntime?.evidence.join(" ") ?? "", /PR #161[\s\S]*22\/22[\s\S]*P0=P1=P2=P3=0/u);
  assert.match(secureHeyGenSetupRuntime?.blockers.join(" ") ?? "", /migrations remain pending[\s\S]*No live verification[\s\S]*quote-to-human-approval/u);
  assert.equal(quoteBoundHumanApproval?.state, "running");
  assert.equal(quoteBoundHumanApproval?.branch, "codex/ai-media-studio-quote-bound-approval");
  assert.match(quoteBoundHumanApproval?.acceptance.join(" ") ?? "", /exact latest quote[\s\S]*render specification[\s\S]*prior approval stale/u);
  assert.match(quoteBoundHumanApproval?.blockers.join(" ") ?? "", /No authoritative[\s\S]*pending and unapplied[\s\S]*No generation/u);
  assert.doesNotMatch(staging?.blockers.join(" ") ?? "", /PR1|PR16|PR13/u);
  assert.match(staging?.blockers.join(" ") ?? "", /staging target[\s\S]*explicit rehearsal approval/u);
  assert.match(staging?.nextAction ?? "", /script-batch workbench[\s\S]*separate approval[\s\S]*restored-staging rehearsal/u);
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
