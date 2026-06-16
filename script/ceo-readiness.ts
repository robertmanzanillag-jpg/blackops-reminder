import { buildCeoReadinessReport } from "../server/ceo-readiness";
import { parseCeoReadinessArgs, formatCeoReadinessText } from "../server/ceo-readiness-cli";
import { getReminderSchedulerConfig } from "../server/reminder-scheduler";
import { getTelegramWebhookStatus, resolveTelegramWebhookUrl } from "../server/telegram-chat";
import { storage } from "../server/storage";
import { DEFAULT_DEV_USER_ID, allowsDevUserFallback, getSystemUserId } from "../server/user-context";
import { resolveSessionRuntimeSettings } from "../server/session-config-core";

async function main() {
  const options = parseCeoReadinessArgs(process.argv.slice(2));
  let userId: string | null = options.userId || null;
  if (!userId) {
    try {
      userId = getSystemUserId();
    } catch {
      userId = null;
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const config = userId ? await storage.getTelegramConfig(userId).catch(() => undefined) : undefined;
  const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  const scheduler = getReminderSchedulerConfig();
  const sessionSettings = resolveSessionRuntimeSettings();

  const report = buildCeoReadinessReport({
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

  console.log(options.json ? JSON.stringify(report, null, 2) : formatCeoReadinessText(report));
  process.exit(report.ready ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
