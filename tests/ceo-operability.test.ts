import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const requiredOperationalScripts = [
  "auth:create-user",
  "user:migrate",
  "telegram:configure",
  "telegram:webhook",
  "ceo:readiness",
  "ceo:send-brief",
  "ceo:smoke",
  "ceo:doctor",
  "ceo:db-check",
  "ceo:backup-check",
  "test:ceo-assistant",
];

const requiredEnvKeys = [
  "DATABASE_URL",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "DEFAULT_USER_ID",
  "ALLOW_DEV_USER_FALLBACK",
  "SESSION_SECRET",
  "LOCAL_AUTH_ENABLED",
  "ALLOW_LOCAL_AUTH_REGISTRATION",
  "TELEGRAM_BOT_TOKEN",
  "PUBLIC_APP_URL",
  "TELEGRAM_WEBHOOK_SECRET",
  "SCHEDULER_TIMEZONE",
  "CEO_BRIEF_HOUR",
  "CEO_BRIEF_MINUTE",
  "CEO_BACKUP_DIR",
  "CEO_BACKUP_SECRETS_ENCRYPTED",
];

test("CEO Assistant operational scripts exist and are documented", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");

  for (const script of requiredOperationalScripts) {
    assert.equal(typeof packageJson.scripts?.[script], "string", `${script} script should exist`);
    const scriptPattern = new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(`${runbook}\n${status}`, scriptPattern, `${script} should be documented`);
  }
});

test("CEO Assistant status tracks runtime-only completion blockers", () => {
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");

  for (const required of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "telegram:configure",
    "telegram:webhook",
    "ceo:send-brief",
    "ceo:smoke",
    "ceo:db-check",
    "ceo:backup-check",
    "conversation-history",
  ]) {
    assert.match(status, new RegExp(required), `${required} should be tracked in status`);
  }
});

test("CEO Assistant aggregate test includes core safety suites", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const aggregate = packageJson.scripts["test:ceo-assistant"];

  for (const script of [
    "test:auth",
    "test:local-auth",
    "test:session",
    "test:ownership",
    "test:readiness",
    "test:scheduler",
    "test:ceo",
    "test:ceo-db-check-cli",
    "test:ceo-backup-check-cli",
    "test:ceo-operational-health",
    "test:automation-registry",
    "test:telegram",
    "test:assistant-chat",
    "test:migration",
    "test:conversation",
  ]) {
    assert.match(aggregate, new RegExp(`npm run ${script}`), `${script} should run in test:ceo-assistant`);
  }
});

test("CEO Assistant env example covers runbook critical variables", () => {
  const envExample = readFileSync("CEO_ASSISTANT_ENV.example", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");

  for (const key of requiredEnvKeys) {
    assert.match(envExample, new RegExp(`^#?\\s*${key}=`, "m"), `${key} should exist in env example`);
    assert.match(runbook, new RegExp(`\`${key}\``), `${key} should be documented in runbook`);
  }
});

test("Telegram and CEO readiness routes are registered through a domain module", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const telegramRoutesSource = readFileSync("server/telegram-routes.ts", "utf8");

  assert.match(routesSource, /registerTelegramRoutes\(app\)/, "routes.ts should delegate Telegram routes to the domain module");
  assert.doesNotMatch(routesSource, /api\/telegram\/webhook/, "routes.ts should not inline Telegram webhook behavior");
  assert.match(telegramRoutesSource, /api\/telegram\/webhook/, "telegram-routes should own the Telegram webhook endpoint");
  assert.match(telegramRoutesSource, /api\/ceo\/readiness/, "telegram-routes should own CEO readiness wiring that depends on Telegram health");
});
