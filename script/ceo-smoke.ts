import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { parseCeoSmokeArgs, validateCeoSmokeOptions, buildCeoSmokeReport, formatCeoSmokeJson, formatCeoSmokeText } from "../server/ceo-smoke-cli";
import {
  CEO_BACKUP_ARTIFACT_PATHS,
  DEFAULT_CEO_BACKUP_DIR,
  buildCeoBackupCheckReport,
} from "../server/ceo-backup-check-cli";
import {
  REQUIRED_CEO_DB_TABLES,
  buildCeoDbCheckReport,
} from "../server/ceo-db-check-cli";
import { buildCeoDoctorChecks, buildCeoDoctorNextCommands } from "../server/ceo-doctor-cli";
import { buildCeoReadinessReport } from "../server/ceo-readiness";
import { getReminderSchedulerConfig, testCeoMorningBrief } from "../server/reminder-scheduler";
import { getTelegramWebhookStatus, resolveTelegramWebhookUrl } from "../server/telegram-chat";
import { storage } from "../server/storage";
import { DEFAULT_DEV_USER_ID, allowsDevUserFallback, getSystemUserId } from "../server/user-context";
import { resolveSessionRuntimeSettings } from "../server/session-config-core";

function hasTool(tool: string): boolean {
  return spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
}

function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function getExistingTables(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [Array.from(REQUIRED_CEO_DB_TABLES)],
    );
    return result.rows.map((row) => row.table_name);
  } finally {
    await pool.end();
  }
}

function resolveSmokeBackupReport() {
  const backupDir = process.env.CEO_BACKUP_DIR || DEFAULT_CEO_BACKUP_DIR;
  const absoluteBackupDir = path.resolve(process.cwd(), backupDir);
  const existingArtifactPaths = CEO_BACKUP_ARTIFACT_PATHS
    .filter((artifact) => fs.existsSync(path.resolve(process.cwd(), artifact.path)))
    .map((artifact) => artifact.path);

  return buildCeoBackupCheckReport({
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    backupDir,
    backupDirWritable: ensureWritableDir(absoluteBackupDir),
    encryptedSecretBackupConfigured: process.env.CEO_BACKUP_SECRETS_ENCRYPTED === "true",
    availableTools: {
      pg_dump: hasTool("pg_dump"),
      pg_restore: hasTool("pg_restore"),
      psql: hasTool("psql"),
      tar: hasTool("tar"),
    },
    existingArtifactPaths,
  });
}

async function resolveSmokeReadiness(userId: string | null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const config = userId ? await storage.getTelegramConfig(userId).catch(() => undefined) : undefined;
  const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  const scheduler = getReminderSchedulerConfig();
  const sessionSettings = resolveSessionRuntimeSettings();

  return buildCeoReadinessReport({
    auth: {
      userId,
      devFallbackAllowed: allowsDevUserFallback(),
      usingDevFallback: userId === DEFAULT_DEV_USER_ID && !process.env.DEFAULT_USER_ID,
      defaultUserConfigured: Boolean(process.env.DEFAULT_USER_ID),
      sessionSecretConfigured: Boolean(process.env.SESSION_SECRET),
      sessionStoreKind: sessionSettings.storeKind,
    },
    assistant: {
      aiConfigured: Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY),
    },
    telegram: {
      tokenConfigured: Boolean(botToken),
      chatConfigured: Boolean(config?.chatId),
      enabled: Boolean(config?.enabled),
      webhookUrlConfigured: Boolean(expectedWebhookUrl),
      webhookRegistered: Boolean(webhook?.url),
      webhookMatchesExpected: Boolean(expectedWebhookUrl && webhook?.url === expectedWebhookUrl),
      webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      lastWebhookError: webhook?.last_error_message || null,
    },
    scheduler: {
      timezone: scheduler.timezone,
      ceoBriefHour: scheduler.ceoBriefHour,
      ceoBriefMinute: scheduler.ceoBriefMinute,
    },
  });
}

async function main() {
  const options = parseCeoSmokeArgs(process.argv.slice(2));
  const optionErrors = validateCeoSmokeOptions(options);
  if (optionErrors.length > 0) {
    console.error(optionErrors.join("\n"));
    console.error("Usage: npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> [--send-brief --execute] [--json]");
    process.exit(1);
  }

  let userId: string | null = options.userId || null;
  if (!userId) {
    try {
      userId = getSystemUserId();
    } catch {
      userId = null;
    }
  }

  const doctorOptions = { userId: options.userId || userId || "", chatId: options.chatId, json: options.json };
  const checks = buildCeoDoctorChecks(process.env, doctorOptions);
  const commands = buildCeoDoctorNextCommands(doctorOptions);
  const existingTables = process.env.DATABASE_URL ? await getExistingTables(process.env.DATABASE_URL).catch(() => []) : [];
  const db = buildCeoDbCheckReport({
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    existingTables,
  });
  const backup = resolveSmokeBackupReport();
  const readiness = await resolveSmokeReadiness(userId);
  const brief = options.sendBrief
    ? { attempted: true, ...(await testCeoMorningBrief(options.userId)) }
    : { attempted: false, success: true, message: "skipped" };
  const report = buildCeoSmokeReport({ checks, db, backup, readiness, commands, brief });

  console.log(options.json ? formatCeoSmokeJson(report) : formatCeoSmokeText(report));
  process.exit(report.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
