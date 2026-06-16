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
    SESSION_SECRET: "secret",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "token",
    PUBLIC_APP_URL: "https://example.com",
    TELEGRAM_WEBHOOK_SECRET: "secret",
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
    SESSION_SECRET: "secret",
    LOCAL_AUTH_ENABLED: "false",
    ALLOW_DEV_USER_FALLBACK: "true",
    TELEGRAM_BOT_TOKEN: "token",
    PUBLIC_APP_URL: "https://example.com",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    SCHEDULER_TIMEZONE: "",
    CEO_BRIEF_HOUR: "99",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.find((check) => check.id === "local_auth")?.ok, false);
  assert.equal(checks.find((check) => check.id === "dev_fallback")?.ok, false);
  assert.equal(checks.find((check) => check.id === "scheduler")?.ok, false);
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
