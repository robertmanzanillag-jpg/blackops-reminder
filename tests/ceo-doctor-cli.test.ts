import assert from "node:assert/strict";
import test from "node:test";
import { buildCeoDoctorChecks, buildCeoDoctorNextCommands, formatCeoDoctorJson, formatCeoDoctorReport, parseCeoDoctorArgs } from "../server/ceo-doctor-cli";

test("parses CEO doctor CLI options", () => {
  assert.deepEqual(parseCeoDoctorArgs(["--user-id=user-123", "--chat-id=999", "--json"]), {
    userId: "user-123",
    chatId: "999",
    json: true,
  });
});

test("builds CEO doctor checks from env and options", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "postgres://example",
    AI_INTEGRATIONS_GEMINI_API_KEY: "key",
    SESSION_SECRET: "a-production-session-secret-32-chars",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "token",
    PUBLIC_APP_URL: "https://example.com",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret-16",
    DEFAULT_USER_ID: "user-123",
    SCHEDULER_TIMEZONE: "America/New_York",
    CEO_BRIEF_HOUR: "7",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.every((check) => check.ok), true);
});

test("flags unsafe production auth and scheduler settings", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "postgres://example",
    AI_INTEGRATIONS_GEMINI_API_KEY: "key",
    SESSION_SECRET: "short",
    LOCAL_AUTH_ENABLED: "false",
    ALLOW_DEV_USER_FALLBACK: "true",
    TELEGRAM_BOT_TOKEN: "token",
    PUBLIC_APP_URL: "http://example.com",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    DEFAULT_USER_ID: "another-user",
    SCHEDULER_TIMEZONE: "",
    CEO_BRIEF_HOUR: "99",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.find((check) => check.id === "local_auth")?.ok, false);
  assert.equal(checks.find((check) => check.id === "dev_fallback")?.ok, false);
  assert.equal(checks.find((check) => check.id === "session")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_url")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_secret")?.ok, false);
  assert.equal(checks.find((check) => check.id === "default_user")?.ok, false);
  assert.equal(checks.find((check) => check.id === "scheduler")?.ok, false);
});

test("flags placeholder production values", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "replace-with-database-url",
    AI_INTEGRATIONS_GEMINI_API_KEY: "replace-with-gemini-api-key",
    SESSION_SECRET: "replace-with-long-random-secret",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "replace-with-botfather-token",
    PUBLIC_APP_URL: "https://your-domain.example",
    TELEGRAM_WEBHOOK_SECRET: "replace-with-telegram-webhook-secret",
    DEFAULT_USER_ID: "replace-after-running-auth-create-user",
    SCHEDULER_TIMEZONE: "America/New_York",
    CEO_BRIEF_HOUR: "7",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.find((check) => check.id === "database")?.ok, false);
  assert.equal(checks.find((check) => check.id === "ai")?.ok, false);
  assert.equal(checks.find((check) => check.id === "session")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_token")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_secret")?.ok, false);
  assert.equal(checks.find((check) => check.id === "default_user")?.ok, false);
});

test("prints next CEO doctor commands with placeholders", () => {
  const commands = buildCeoDoctorNextCommands({ userId: "", chatId: "", json: false });
  assert.ok(commands.some((command) => command.includes("<real-user-id>")));
  assert.ok(commands.some((command) => command.includes("<telegram-chat-id>")));

  const report = formatCeoDoctorReport([], commands);
  assert.match(report, /CEO Assistant Doctor/);
  assert.match(report, /Ready: yes/);
  assert.match(report, /Next commands:/);
});

test("prints CEO doctor JSON for automated preflight gates", () => {
  const checks = [
    { id: "ai", label: "Assistant AI", ok: true, detail: "AI key configured." },
    { id: "telegram_token", label: "Telegram token", ok: false, detail: "Set TELEGRAM_BOT_TOKEN." },
  ];
  const output = JSON.parse(formatCeoDoctorJson(checks, ["npm run ceo:doctor"]));

  assert.equal(output.ready, false);
  assert.equal(output.checks.length, 2);
  assert.deepEqual(output.commands, ["npm run ceo:doctor"]);
});
