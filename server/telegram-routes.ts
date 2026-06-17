import type { Express } from "express";
import { storage } from "./storage";
import { getCurrentUserId, DEFAULT_DEV_USER_ID, allowsDevUserFallback } from "./user-context";
import { sendTelegramMessage, getTelegramUpdates, isTelegramWebhookSecretValid } from "./telegram";
import { handleTelegramMessage, setupTelegramWebhook, getTelegramWebhookStatus, resolveTelegramWebhookUrl } from "./telegram-chat";
import { testCeoMorningBrief, getReminderSchedulerConfig } from "./reminder-scheduler";
import { buildCeoReadinessReport } from "./ceo-readiness";
import { getCeoConversationMessages } from "./ceo-conversation-history";
import { resolveSessionRuntimeSettings } from "./session-config-core";
import { createRateLimiter } from "./rate-limit";
import { createTelegramUpdateDeduper, shouldProcessTelegramUpdate } from "./telegram-webhook-dedupe";

export function registerTelegramRoutes(app: Express): void {
  const telegramWebhookRateLimit = createRateLimiter({
    scope: "telegram-webhook",
    limit: 180,
    windowMs: 60 * 1000,
    persistentStore: storage,
    onPersistentError: (error) => {
      console.warn("[RateLimit] Persistent telegram-webhook limiter unavailable; using in-memory fallback:", error instanceof Error ? error.message : error);
    },
  });
  const telegramUpdateDeduper = createTelegramUpdateDeduper();

  app.get("/api/telegram/status", async (req, res) => {
    try {
      const config = await storage.getTelegramConfig(getCurrentUserId(req));
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return res.json({ configured: false, enabled: false, reason: "no_token" });
      }

      if (!config) {
        return res.json({ configured: false, enabled: false, reason: "no_chat_id" });
      }

      res.json({
        configured: true,
        enabled: config.enabled,
        chatId: config.chatId,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get telegram status" });
    }
  });

  app.get("/api/telegram/health", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const aiConfigured = Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
      const config = await storage.getTelegramConfig(userId);
      const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
      const expectedWebhookUrl = resolveTelegramWebhookUrl();

      res.json({
        tokenConfigured: Boolean(botToken),
        aiConfigured,
        webhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
        webhookUrlConfigured: Boolean(expectedWebhookUrl),
        chatConfigured: Boolean(config?.chatId),
        enabled: Boolean(config?.enabled),
        chatId: config?.chatId || null,
        webhookUrl: webhook?.url || null,
        expectedWebhookUrl,
        webhookMatchesExpected: Boolean(expectedWebhookUrl && webhook?.url === expectedWebhookUrl),
        pendingUpdates: webhook?.pending_update_count || 0,
        lastWebhookError: webhook?.last_error_message || null,
        readyForBriefs: Boolean(botToken && config?.chatId && config?.enabled),
        readyForChat: Boolean(aiConfigured && botToken && config?.chatId && config?.enabled && webhook?.url),
        scheduler: getReminderSchedulerConfig(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get Telegram health" });
    }
  });

  app.get("/api/ceo/readiness", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const config = await storage.getTelegramConfig(userId);
      const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
      const expectedWebhookUrl = resolveTelegramWebhookUrl();
      const scheduler = getReminderSchedulerConfig();
      const sessionSettings = resolveSessionRuntimeSettings();

      res.json(buildCeoReadinessReport({
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
      }));
    } catch (error) {
      res.status(500).json({ error: "Failed to get CEO readiness" });
    }
  });

  app.get("/api/ceo/conversation-history", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const limit = Math.min(Number(req.query.limit || 12) || 12, 50);
      const messages = await getCeoConversationMessages(userId, limit);
      res.json({
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get CEO conversation history" });
    }
  });

  app.post("/api/telegram/test-ceo-brief", async (req, res) => {
    try {
      const result = await testCeoMorningBrief(getCurrentUserId(req));
      res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send CEO brief" });
    }
  });

  app.post("/api/telegram/configure", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      let chatId = req.body.chatId;

      if (!chatId) {
        const updates = await getTelegramUpdates(botToken);

        if (updates.length === 0) {
          return res.status(400).json({
            error: "No messages found. Please send /start to your bot first.",
            instruction: "Send /start to your Telegram bot, then try again.",
            manualOption: "Or provide chatId in request body",
          });
        }

        const lastMessage = updates[updates.length - 1];
        chatId = lastMessage.message?.chat?.id?.toString();
      }

      if (!chatId) {
        return res.status(400).json({ error: "Could not find chat ID" });
      }

      const config = await storage.saveTelegramConfig(getCurrentUserId(req), chatId);
      await sendTelegramMessage(botToken, chatId, "✅ BlackOps Reminder conectado! Recibirás notificaciones aquí.");

      res.json({ success: true, chatId, config });
    } catch (error) {
      res.status(500).json({ error: "Failed to configure telegram" });
    }
  });

  app.post("/api/telegram/toggle", async (req, res) => {
    try {
      const { enabled } = req.body;
      const config = await storage.updateTelegramConfig(getCurrentUserId(req), enabled);

      if (!config) {
        return res.status(404).json({ error: "Telegram not configured" });
      }

      res.json({ success: true, enabled: config.enabled });
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle telegram" });
    }
  });

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      const config = await storage.getTelegramConfig(getCurrentUserId(req));
      if (!config) {
        return res.status(400).json({ error: "Telegram not configured. Send /start to your bot first." });
      }

      const success = await sendTelegramMessage(
        botToken,
        config.chatId,
        "🧪 Prueba de notificación\n\nEsta es una notificación de prueba de BlackOps Reminder.",
      );

      if (success) {
        res.json({ success: true, message: "Test notification sent" });
      } else {
        res.status(500).json({ error: "Failed to send test notification" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  app.delete("/api/telegram/disconnect", async (req, res) => {
    try {
      await storage.deleteTelegramConfig(getCurrentUserId(req));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect telegram" });
    }
  });

  app.post("/api/telegram/webhook", telegramWebhookRateLimit, async (req, res) => {
    try {
      const providedSecret = req.header("x-telegram-bot-api-secret-token");
      if (!isTelegramWebhookSecretValid(process.env.TELEGRAM_WEBHOOK_SECRET, providedSecret)) {
        console.warn("[Telegram Webhook] Rejected update with invalid secret token");
        return res.status(401).json({ ok: false });
      }

      const update = req.body;
      console.log("[Telegram Webhook] Received update:", JSON.stringify(update).slice(0, 200));

      const shouldProcess = await shouldProcessTelegramUpdate(update, storage, telegramUpdateDeduper, (error) => {
        console.warn("[Telegram Webhook] Durable dedupe unavailable; using in-memory fallback:", error instanceof Error ? error.message : error);
      });
      if (!shouldProcess) {
        console.log(`[Telegram Webhook] Duplicate update skipped: ${update.update_id}`);
        return res.status(200).json({ ok: true, duplicate: true });
      }

      handleTelegramMessage(update).catch(err => {
        console.error("[Telegram Webhook] Error handling message:", err);
      });

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Telegram Webhook] Error:", error);
      res.status(200).json({ ok: true });
    }
  });

  app.post("/api/telegram/setup-webhook", async (_req, res) => {
    try {
      const result = await setupTelegramWebhook();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to setup webhook" });
    }
  });

  app.get("/api/telegram/webhook-status", async (_req, res) => {
    try {
      const status = await getTelegramWebhookStatus();
      res.json(status || { url: null, pending_update_count: 0 });
    } catch (error) {
      res.status(500).json({ error: "Failed to get webhook status" });
    }
  });
}
