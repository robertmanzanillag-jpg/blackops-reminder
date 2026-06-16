import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("project health alerts are scoped to the project owner", () => {
  const source = readFileSync("server/health-check.ts", "utf8");

  assert.doesNotMatch(source, /sendNotificationToAll/, "health alerts should not broadcast to every push subscriber");
  assert.match(source, /storage\.getTelegramConfig\(project\.userId\)/, "health alerts should use the project owner's Telegram config");
  assert.match(source, /sendPushNotification\(project\.userId,/, "health alerts should push only to the project owner");
});

test("market updates process enabled Telegram users instead of one global user", () => {
  const source = readFileSync("server/market-news.ts", "utf8");

  assert.doesNotMatch(source, /getSystemUserId/, "market updates should not use a global system user");
  assert.match(source, /storage\.getEnabledTelegramConfigs\(\)/, "market updates should discover enabled Telegram users");
  assert.match(source, /sendDailyMarketUpdateForUser\(userId\)/, "market updates should run per owner user id");
  assert.match(source, /storage\.getInvestments\(userId\)/, "portfolio summary should read investments for the owner user id");
});

test("Zoho calendar sync imports events into the authenticated owner account", () => {
  const zohoSource = readFileSync("server/zoho-calendar.ts", "utf8");
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.doesNotMatch(zohoSource, /getSystemUserId/, "Zoho sync should not use a global system user");
  assert.match(zohoSource, /syncZohoCalendar\(userId: string\)/, "Zoho sync should require an explicit user id");
  assert.match(zohoSource, /storage\.getTasks\(userId\)/, "Zoho sync should search existing tasks for the owner user id");
  assert.match(zohoSource, /storage\.createTask\(userId, taskData\)/, "Zoho sync should create tasks for the owner user id");
  assert.match(routesSource, /syncZohoCalendar\(getCurrentUserId\(req\)\)/, "Zoho sync route should pass the authenticated user id");
});

test("manual notification test endpoints target the authenticated user only", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const schedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");

  assert.doesNotMatch(routesSource, /sendNotificationToAll/, "manual push tests should not broadcast to every subscriber");
  assert.match(routesSource, /sendPushNotification\(getCurrentUserId\(req\),/, "manual push test should target the authenticated user");
  assert.match(routesSource, /testMorningReminder\(getCurrentUserId\(req\)\)/, "manual morning test should target the authenticated user");
  assert.match(routesSource, /testEveningReminder\(getCurrentUserId\(req\)\)/, "manual evening test should target the authenticated user");
  assert.match(routesSource, /testWeeklyReminder\(getCurrentUserId\(req\)\)/, "manual weekly test should target the authenticated user");
  assert.match(routesSource, /testProactiveInsights\(getCurrentUserId\(req\)\)/, "manual insights test should target the authenticated user");
  assert.match(routesSource, /testNewsDigest\(getCurrentUserId\(req\)\)/, "manual news test should target the authenticated user");

  assert.match(schedulerSource, /testMorningReminder\(userId\?: string\)/, "manual reminder helper should accept an explicit user id");
  assert.match(schedulerSource, /testProactiveInsights\(userId\?: string\)/, "manual insights helper should accept an explicit user id");
  assert.match(schedulerSource, /testNewsDigest\(userId\?: string\)/, "manual news helper should accept an explicit user id");
});
