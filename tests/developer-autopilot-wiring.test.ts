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
  assert.match(source, /\/api\/developer-autopilot\/qa-gate/);
  assert.match(source, /runAppQaScan\(getCurrentUserId\(req\), Boolean\(req\.body\?\.notify\), true, false\)/);
  assert.match(source, /const prUrl = typeof req\.body\?\.prUrl === "string"/);
  assert.match(source, /evaluateDeveloperReleaseGate\(scan, \{ prUrl \}\)/);
});
