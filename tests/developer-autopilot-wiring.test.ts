import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Telegram routes developer bug requests before generic work routing", () => {
  const source = readFileSync("server/telegram-chat.ts", "utf8");
  const autopilotIndex = source.indexOf('createDeveloperAutopilotHandoff(userId, message, "telegram")');
  const genericIndex = source.indexOf("const actionIds = routeTelegramWorkRequest(message)");

  assert.ok(autopilotIndex > 0, "Telegram should call Developer Autopilot");
  assert.ok(genericIndex > 0, "Telegram should keep generic work routing");
  assert.ok(autopilotIndex < genericIndex, "Developer Autopilot should run before generic routing");
});

test("Web assistant routes developer bug requests before the model fallback", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const autopilotIndex = source.indexOf('createDeveloperAutopilotHandoff(userId, message, "web_chat")');
  const modelFallbackIndex = source.indexOf("const openAiMessages: ChatCompletionMessageParam[]");

  assert.ok(autopilotIndex > 0, "Web assistant should call Developer Autopilot");
  assert.ok(modelFallbackIndex > 0, "Web assistant should still have model fallback");
  assert.ok(autopilotIndex < modelFallbackIndex, "Developer Autopilot should run before model fallback");
});

test("Developer Autopilot routes are exposed near App QA gates", () => {
  const source = readFileSync("server/routes.ts", "utf8");

  assert.match(source, /\/api\/developer-autopilot\/handoff/);
  assert.match(source, /result\.status === "codex_dispatched"/);
  assert.match(source, /result\.status === "subscription_brief"/);
  assert.match(source, /\/api\/developer-autopilot\/qa-gate/);
  assert.match(source, /runAppQaScan\(getCurrentUserId\(req\), Boolean\(req\.body\?\.notify\), true, false\)/);
  assert.match(source, /const prUrl = typeof req\.body\?\.prUrl === "string"/);
  assert.match(source, /evaluateDeveloperReleaseGate\(scan, \{ prUrl \}\)/);
});

test("Revenue Engine exposes GitHub handoff route for sold website workspaces", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const mutationStart = uiSource.indexOf("const deliveryWorkspaceGithubHandoffMutation");
  const mutationEnd = uiSource.indexOf("const deliveryWorkspaceDeliverMutation");
  const handoffMutation = uiSource.slice(mutationStart, mutationEnd);

  assert.match(routeSource, /\/api\/revenue-engine\/delivery-workspaces\/github-handoff/);
  assert.match(routeSource, /createDeveloperAutopilotHandoffFromRequest/);
  assert.match(routeSource, /kind: "client_build"/);
  assert.match(routeSource, /repo_mismatch/);
  assert.match(routeSource, /publicIssueDescription/);
  assert.match(routeSource, /Commercial details intentionally withheld/);
  assert.doesNotMatch(routeSource, /`Package: \$\{workspace\.input\.packageName\}`/);
  assert.match(routeSource, /githubIssueUrl: ""/);
  assert.match(routeSource, /prUrl: ""/);
  assert.match(routeSource, /secondReviewStatus: "pending"/);
  assert.match(routeSource, /approvedByRobert: false/);
  assert.match(routeSource, /updateRevenueDeliveryWorkspaceQa\(\{/);
  assert.doesNotMatch(routeSource, /workspace\.codexBuildHandoff\.codexBrief/);
  assert.match(uiSource, /button-create-github-handoff/);
  assert.match(uiSource, /deliveryWorkspaceGithubHandoffMutation/);
  assert.match(handoffMutation, /repoFullName: workspace\.input\.repoFullName/);
  assert.doesNotMatch(handoffMutation, /repoFullName: reviewRepoFullName \|\| workspace\.input\.repoFullName/);
});

test("Revenue Engine exposes the daily money command panel", () => {
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const serverSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(serverSource, /buildRevenueDailyMoneyCommand/);
  assert.match(serverSource, /dailyMoneyCommand/);
  assert.match(uiSource, /button-copy-daily-money-command/);
  assert.match(uiSource, /dailyMoneyCommand\.primaryAction/);
  assert.match(uiSource, /dailyMoneyCommand\.funnel\.salesPacketsReady/);
});

test("Revenue Engine exposes manual outreach outcome recording", () => {
  const routeSource = readFileSync("server/routes.ts", "utf8");
  const uiSource = readFileSync("client/src/pages/revenue-engine.tsx", "utf8");
  const engineSource = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(engineSource, /recordRevenueOutreachOutcome/);
  assert.match(routeSource, /\/api\/revenue-engine\/outreach-outcome/);
  assert.match(routeSource, /revenueOutreachOutcomeSchema\.parse/);
  assert.match(uiSource, /outreachOutcomeMutation/);
  assert.match(uiSource, /button-record-outreach-reply/);
  assert.match(uiSource, /button-record-outreach-call/);
  assert.match(uiSource, /button-record-outreach-deposit/);
});

test("Dashboard chat exposes a subscription handoff prompt", () => {
  const source = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");

  assert.match(source, /membresia Pro/);
  assert.match(source, /campana fuerte/);
});

test("Agents Office shows Claude as an independent PR reviewer", () => {
  const source = readFileSync("client/src/pages/agents-office.tsx", "utf8");

  assert.match(source, /id: "claude-reviewer"/);
  assert.match(source, /name: "Claude Reviewer"/);
  assert.match(source, /Segundo chequeo/);
  assert.match(source, /from: "claude-reviewer", to: "github"/);
  assert.match(source, /from: "app-qa", to: "claude-reviewer"/);
  assert.match(source, /Codex trabaja PR-first y Claude revisa antes de App QA/);
});
