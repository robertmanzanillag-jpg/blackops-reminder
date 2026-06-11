import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTaskSchema, insertWeeklySummarySchema, insertMonthlyGoalSchema, insertYearlyGoalSchema, insertWeeklyTaskSchema, insertPushSubscriptionSchema } from "@shared/schema";
import { z } from "zod";
import { getCalendarEvents, isGoogleCalendarConnected } from "./google-calendar";
import { syncZohoCalendar, checkZohoConnection, getZohoAuthUrl, exchangeZohoCode } from "./zoho-calendar";
import { getVapidPublicKey, sendPushNotification, sendNotificationToAll } from "./push-notifications";
import { testMorningReminder, testEveningReminder, testWeeklyReminder, testProactiveInsights, testNewsDigest } from "./reminder-scheduler";
import { registerAssistantRoutes } from "./assistant";
import { sendTelegramMessage, validateTelegramBot, getTelegramUpdates, setTelegramWebhook, getWebhookInfo } from "./telegram";
import { handleTelegramMessage, setupTelegramWebhook, getTelegramWebhookStatus } from "./telegram-chat";
import { getPrice, getMarketOverview, searchSymbol, getBatchCryptoPrices, getHistoricalData, getPortfolioNews, getMarketNews, getCompanyNews } from "./finance";
import { insertInvestmentSchema, insertTransactionSchema, insertWatchlistSchema, insertPriceAlertSchema, insertMonitoredProjectSchema } from "@shared/schema";
import { checkSingleProject } from "./health-check";
import { sendDailyMarketUpdate, calculatePortfolioSummary } from "./market-news";
import { insertPortfolioHistorySchema, insertDjContactSchema } from "@shared/schema";
import { analyzeRadioEvents, sendRadioSlotsSummary, getRadioSlotsForMonth, importDjsFromRadioHistory, generateDjMessage } from "./radio-agent";
import { getPortfolioSummary, analyzeRebalancing, checkPriceOpportunities, generateWeeklyReport, sendWeeklyPortfolioReport, getGainsByPeriod } from "./portfolio-agent";
import { listAllActions, executeAction, executeMultipleActions, getActionsByCategory } from "./agent-actions";
import { readFile, writeFile, listFiles, getChangeHistory, undoLastChange, getTableSchema, executeQuery, getProjectStructure, addColumnToTable, createTable, getTableInfo } from "./code-agent";
import { generateCode, generateFromTemplate, MODULE_TEMPLATES } from "./code-generator";
import { listRepositories, getRepoContents, getFileContent, updateFile, deleteFile, getAuthenticatedUser, isGitHubConnected } from "./github-client";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Mock user ID - in production this would come from authentication
  const MOCK_USER_ID = "mock-user-123";

  // GET all tasks
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await storage.getTasks(MOCK_USER_ID);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  // GET single task
  app.get("/api/tasks/:id", async (req, res) => {
    try {
      const task = await storage.getTask(req.params.id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch task" });
    }
  });

  // POST create task
  app.post("/api/tasks", async (req, res) => {
    try {
      // Convert date string to Date object if needed
      const body = {
        ...req.body,
        date: typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date,
      };
      const validated = insertTaskSchema.parse(body);
      const task = await storage.createTask(MOCK_USER_ID, validated);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // PATCH update task
  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      // Convert date strings to Date objects if needed
      const body = {
        ...req.body,
        date: req.body.date ? (typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date) : undefined,
        originalDate: req.body.originalDate ? (typeof req.body.originalDate === "string" ? new Date(req.body.originalDate) : req.body.originalDate) : undefined,
      };
      const task = await storage.updateTask(req.params.id, body);
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  // DELETE task
  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      await storage.deleteTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // POST deduplicate main tasks (one-time cleanup)
  app.post("/api/tasks/deduplicate", async (req, res) => {
    try {
      const removed = await storage.deduplicateMainTasks(MOCK_USER_ID);
      res.json({ removed });
    } catch (error) {
      res.status(500).json({ error: "Failed to deduplicate tasks" });
    }
  });

  // DELETE tasks by title (for recurring events)
  app.delete("/api/tasks/by-title/:title", async (req, res) => {
    try {
      const title = decodeURIComponent(req.params.title);
      const deleted = await storage.deleteTasksByTitle(MOCK_USER_ID, title);
      res.json({ deleted });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete tasks" });
    }
  });

  // GET Calendar connection status (Google + Zoho)
  app.get("/api/calendar/status", async (req, res) => {
    try {
      const googleConnected = await isGoogleCalendarConnected();
      const zohoStatus = await checkZohoConnection();
      res.json({ google: googleConnected, zoho: zohoStatus.connected });
    } catch (error) {
      res.json({ google: false, zoho: false });
    }
  });

  // POST Zoho Calendar sync
  app.post("/api/calendar/zoho/sync", async (req, res) => {
    try {
      const result = await syncZohoCalendar();
      res.json({ success: true, synced: result.synced, errors: result.errors });
    } catch (error: any) {
      console.error('Zoho sync error:', error);
      res.status(500).json({ error: error.message || "Failed to sync Zoho calendar" });
    }
  });

  // GET Zoho OAuth authorization URL - redirects to Zoho login
  app.get("/api/zoho/auth", (req, res) => {
    const host = req.get('host') || 'localhost:5000';
    const protocol = host.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/zoho/callback`;
    const authUrl = getZohoAuthUrl(redirectUri);
    
    if (!authUrl) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>Zoho Client ID no configurado. Agrega ZOHO_CLIENT_ID en los secrets.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }
    
    // Redirect directly to Zoho OAuth
    res.redirect(authUrl);
  });

  // GET Zoho OAuth callback - exchanges code for refresh token
  app.get("/api/zoho/callback", async (req, res) => {
    const { code } = req.query;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>No authorization code received from Zoho.</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    const host = req.get('host') || 'localhost:5000';
    const protocol = host.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/zoho/callback`;
    
    const result = await exchangeZohoCode(code, redirectUri);
    
    if (result.error) {
      return res.status(400).send(`
        <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
          <h1>Error</h1>
          <p>${result.error}</p>
          <a href="/" style="color:#3b82f6;">Volver al inicio</a>
        </body></html>
      `);
    }

    res.send(`
      <html><body style="background:#000;color:#fff;font-family:sans-serif;padding:40px;">
        <h1 style="color:#22c55e;">Zoho Calendar Conectado</h1>
        <p>Tu Refresh Token es:</p>
        <code style="background:#1f2937;padding:10px;display:block;border-radius:8px;word-break:break-all;margin:20px 0;">
          ${result.refresh_token}
        </code>
        <p style="color:#fbbf24;">Copia este token y agrégalo como secret ZOHO_REFRESH_TOKEN en Replit.</p>
        <a href="/" style="color:#3b82f6;">Volver al inicio</a>
      </body></html>
    `);
  });

  // GET Google Calendar events and sync to local tasks
  app.post("/api/calendar/sync", async (req, res) => {
    try {
      // Start from beginning of current week (Monday) so today's/this week's events are included
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
      weekStart.setHours(0, 0, 0, 0);

      const twelveMonthsAhead = new Date();
      twelveMonthsAhead.setMonth(twelveMonthsAhead.getMonth() + 12);
      
      const events = await getCalendarEvents(weekStart, twelveMonthsAhead);
      
      // Sync events to local tasks
      let synced = 0;
      for (const event of events) {
        // Check if we already have this event
        const existingTasks = await storage.getTasks(MOCK_USER_ID);
        const exists = existingTasks.some(t => t.externalId === event.id && t.externalSource === 'google');
        
        if (!exists) {
          await storage.createTask(MOCK_USER_ID, {
            title: event.title,
            description: event.description || null,
            date: event.date,
            endDate: event.endDate || null,
            priority: "normal",
            completed: false,
            type: "event",
            externalId: event.id,
            externalSource: "google",
          });
          synced++;
        }
      }
      
      res.json({ success: true, synced, total: events.length });
    } catch (error: any) {
      console.error('Calendar sync error:', error);
      res.status(500).json({ error: error.message || "Failed to sync calendar" });
    }
  });

  // GET calendar events without syncing (just for display)
  app.get("/api/calendar/events", async (req, res) => {
    try {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);

      const twelveMonthsAhead = new Date();
      twelveMonthsAhead.setMonth(twelveMonthsAhead.getMonth() + 12);
      
      const events = await getCalendarEvents(weekStart, twelveMonthsAhead);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch calendar events" });
    }
  });

  // ==================== WEEKLY SUMMARIES ====================

  // GET all weekly summaries
  app.get("/api/weekly-summaries", async (req, res) => {
    try {
      const summaries = await storage.getWeeklySummaries(MOCK_USER_ID);
      res.json(summaries);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly summaries" });
    }
  });

  // GET single weekly summary by week start date
  app.get("/api/weekly-summaries/:weekStart", async (req, res) => {
    try {
      const weekStart = new Date(req.params.weekStart);
      const summary = await storage.getWeeklySummary(MOCK_USER_ID, weekStart);
      if (!summary) {
        return res.status(404).json({ error: "Weekly summary not found" });
      }
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly summary" });
    }
  });

  // POST create weekly summary
  app.post("/api/weekly-summaries", async (req, res) => {
    try {
      const body = {
        ...req.body,
        weekStart: typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart,
      };
      const validated = insertWeeklySummarySchema.parse(body);
      
      // Check if summary already exists for this week
      const existing = await storage.getWeeklySummary(MOCK_USER_ID, validated.weekStart);
      if (existing) {
        // Update instead of create
        const updated = await storage.updateWeeklySummary(existing.id, validated);
        return res.json(updated);
      }
      
      const summary = await storage.createWeeklySummary(MOCK_USER_ID, validated);
      res.status(201).json(summary);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create weekly summary" });
    }
  });

  // PATCH update weekly summary
  app.patch("/api/weekly-summaries/:id", async (req, res) => {
    try {
      const body = {
        ...req.body,
        weekStart: req.body.weekStart ? (typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart) : undefined,
      };
      const summary = await storage.updateWeeklySummary(req.params.id, body);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to update weekly summary" });
    }
  });

  // ==================== MONTHLY GOALS ====================

  // GET all monthly goals across all months (for history view)
  app.get("/api/monthly-goals/all", async (req, res) => {
    try {
      const goals = await storage.getAllMonthlyGoals(MOCK_USER_ID);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch all monthly goals" });
    }
  });

  // GET monthly goals for a specific month
  app.get("/api/monthly-goals", async (req, res) => {
    try {
      const monthParam = req.query.month as string;
      const month = monthParam ? new Date(monthParam) : new Date();
      const goals = await storage.getMonthlyGoals(MOCK_USER_ID, month);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch monthly goals" });
    }
  });

  // POST create monthly goal
  app.post("/api/monthly-goals", async (req, res) => {
    try {
      const body = {
        ...req.body,
        month: typeof req.body.month === "string" ? new Date(req.body.month) : req.body.month,
      };
      const validated = insertMonthlyGoalSchema.parse(body);
      const goal = await storage.createMonthlyGoal(MOCK_USER_ID, validated);
      res.status(201).json(goal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create monthly goal" });
    }
  });

  // PATCH update monthly goal
  app.patch("/api/monthly-goals/:id", async (req, res) => {
    try {
      const goal = await storage.updateMonthlyGoal(req.params.id, req.body);
      res.json(goal);
    } catch (error) {
      res.status(500).json({ error: "Failed to update monthly goal" });
    }
  });

  // DELETE monthly goal
  app.delete("/api/monthly-goals/:id", async (req, res) => {
    try {
      await storage.deleteMonthlyGoal(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete monthly goal" });
    }
  });

  // ==================== YEARLY GOALS ====================

  // GET yearly goals for a specific year
  app.get("/api/yearly-goals", async (req, res) => {
    try {
      const year = (req.query.year as string) || new Date().getFullYear().toString();
      const goals = await storage.getYearlyGoals(MOCK_USER_ID, year);
      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch yearly goals" });
    }
  });

  // POST create yearly goal
  app.post("/api/yearly-goals", async (req, res) => {
    try {
      const validated = insertYearlyGoalSchema.parse(req.body);
      const goal = await storage.createYearlyGoal(MOCK_USER_ID, validated);
      res.status(201).json(goal);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create yearly goal" });
    }
  });

  // PATCH update yearly goal
  app.patch("/api/yearly-goals/:id", async (req, res) => {
    try {
      const goal = await storage.updateYearlyGoal(req.params.id, req.body);
      res.json(goal);
    } catch (error) {
      res.status(500).json({ error: "Failed to update yearly goal" });
    }
  });

  // DELETE yearly goal
  app.delete("/api/yearly-goals/:id", async (req, res) => {
    try {
      await storage.deleteYearlyGoal(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete yearly goal" });
    }
  });

  // ==================== WEEKLY TASKS ====================

  let hasDeduplicatedRecurringTasks = false;
  
  // GET weekly tasks for current week
  // Recurring tasks are shown alongside the current week's tasks without duplication.
  // Incomplete non-recurring tasks from the previous week are carried over automatically.
  app.get("/api/weekly-tasks", async (req, res) => {
    try {
      // One-time deduplication of recurring tasks on first request
      if (!hasDeduplicatedRecurringTasks) {
        const removed = await storage.deduplicateRecurringTasks(MOCK_USER_ID);
        if (removed > 0) {
          console.log(`[weekly-tasks] Cleaned up ${removed} duplicate recurring tasks`);
        }
        hasDeduplicatedRecurringTasks = true;
      }
      
      const weekStartParam = req.query.weekStart as string;
      const weekStart = weekStartParam ? new Date(weekStartParam) : getWeekStart(new Date());
      
      // Get existing tasks for this week
      let tasks = await storage.getWeeklyTasks(MOCK_USER_ID, weekStart);
      
      // Get all recurring tasks (displayed globally, not duplicated per week)
      const recurringTasks = await storage.getRecurringTasks(MOCK_USER_ID);
      
      // Merge recurring tasks that aren't already in this week's list
      const existingTitles = new Set(tasks.map(t => t.title));
      const existingIds = new Set(tasks.map(t => t.id));
      
      // For recurring tasks, show them but DON'T create copies.
      // If the recurring task's weekStart doesn't match the current week,
      // it means it was completed in a previous week — reset completed to false.
      const seenRecurringTitles = new Set<string>();
      for (const rt of recurringTasks) {
        if (!seenRecurringTitles.has(rt.title) && !existingIds.has(rt.id)) {
          if (!existingTitles.has(rt.title)) {
            const rtWeekStart = getWeekStart(rt.weekStart);
            const isSameWeek = rtWeekStart.getTime() === weekStart.getTime();
            tasks.push({ ...rt, completed: isSameWeek ? rt.completed : false, carriedOver: false });
            existingTitles.add(rt.title);
          }
          seenRecurringTitles.add(rt.title);
        }
      }
      
      // Carry over incomplete NON-recurring tasks from the previous week
      const prevIncompleteTasks = await storage.getPreviousWeekIncompleteTasks(MOCK_USER_ID, weekStart);
      for (const pt of prevIncompleteTasks) {
        if (!existingTitles.has(pt.title)) {
          const carriedTask = await storage.createWeeklyTask(MOCK_USER_ID, {
            title: pt.title,
            weekStart: weekStart,
            completed: false,
            isRecurring: false,
            carriedOver: true,
          });
          tasks.push(carriedTask);
          existingTitles.add(pt.title);
        }
      }
      
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch weekly tasks" });
    }
  });

  // POST create weekly task
  app.post("/api/weekly-tasks", async (req, res) => {
    try {
      const body = {
        ...req.body,
        weekStart: typeof req.body.weekStart === "string" ? new Date(req.body.weekStart) : req.body.weekStart,
      };
      const validated = insertWeeklyTaskSchema.parse(body);
      const task = await storage.createWeeklyTask(MOCK_USER_ID, validated);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create weekly task" });
    }
  });

  // PATCH update weekly task
  app.patch("/api/weekly-tasks/:id", async (req, res) => {
    try {
      const existing = await storage.getWeeklyTaskById(req.params.id);
      let updates = { ...req.body };
      
      // When toggling completion on a recurring task, also stamp the current weekStart
      // so that next week the task appears fresh (not completed).
      if (existing?.isRecurring && "completed" in updates) {
        updates.weekStart = getWeekStart(new Date());
      }
      
      const task = await storage.updateWeeklyTask(req.params.id, updates);
      res.json(task);
    } catch (error) {
      res.status(500).json({ error: "Failed to update weekly task" });
    }
  });

  // DELETE weekly task
  app.delete("/api/weekly-tasks/:id", async (req, res) => {
    try {
      await storage.deleteWeeklyTask(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete weekly task" });
    }
  });

  // ==================== PUSH NOTIFICATIONS ====================

  // GET VAPID public key
  app.get("/api/push/vapid-key", (req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
  });

  // POST subscribe to push notifications
  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription" });
      }
      
      // Check if already subscribed
      const existing = await storage.getPushSubscriptions(MOCK_USER_ID);
      const alreadyExists = existing.some(s => s.endpoint === endpoint);
      
      if (!alreadyExists) {
        await storage.createPushSubscription(MOCK_USER_ID, {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  // POST unsubscribe from push notifications
  app.post("/api/push/unsubscribe", async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (endpoint) {
        await storage.deletePushSubscription(endpoint);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  // POST test notification (for debugging)
  app.post("/api/push/test", async (req, res) => {
    try {
      const result = await sendNotificationToAll({
        title: "BlackOps Reminder",
        body: "Notificaciones activadas correctamente!",
        url: "/",
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  // POST test morning reminder
  app.post("/api/push/test-morning", async (req, res) => {
    try {
      const result = await testMorningReminder();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send morning reminder" });
    }
  });

  // POST test evening reminder
  app.post("/api/push/test-evening", async (req, res) => {
    try {
      const result = await testEveningReminder();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send evening reminder" });
    }
  });

  // POST test weekly reminder
  app.post("/api/push/test-weekly", async (req, res) => {
    try {
      const result = await testWeeklyReminder();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send weekly reminder" });
    }
  });

  // POST test proactive insights
  app.post("/api/push/test-insights", async (req, res) => {
    try {
      const result = await testProactiveInsights();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send proactive insights" });
    }
  });

  // POST test news digest
  app.post("/api/push/test-news", async (req, res) => {
    try {
      const result = await testNewsDigest();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send news digest" });
    }
  });

  // ==================== TELEGRAM ENDPOINTS ====================

  // GET telegram status
  app.get("/api/telegram/status", async (req, res) => {
    try {
      const config = await storage.getTelegramConfig(MOCK_USER_ID);
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
        chatId: config.chatId 
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get telegram status" });
    }
  });

  // POST configure telegram with chat ID from bot updates or manual input
  app.post("/api/telegram/configure", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      let chatId = req.body.chatId;

      // If no chat ID provided, try to get it from updates
      if (!chatId) {
        const updates = await getTelegramUpdates(botToken);
        
        if (updates.length === 0) {
          return res.status(400).json({ 
            error: "No messages found. Please send /start to your bot first.",
            instruction: "Send /start to your Telegram bot, then try again.",
            manualOption: "Or provide chatId in request body"
          });
        }

        // Get the most recent chat ID
        const lastMessage = updates[updates.length - 1];
        chatId = lastMessage.message?.chat?.id?.toString();
      }
      
      if (!chatId) {
        return res.status(400).json({ error: "Could not find chat ID" });
      }

      const config = await storage.saveTelegramConfig(MOCK_USER_ID, chatId);
      
      // Send confirmation message
      await sendTelegramMessage(botToken, chatId, "✅ BlackOps Reminder conectado! Recibirás notificaciones aquí.");
      
      res.json({ success: true, chatId, config });
    } catch (error) {
      res.status(500).json({ error: "Failed to configure telegram" });
    }
  });

  // POST toggle telegram notifications
  app.post("/api/telegram/toggle", async (req, res) => {
    try {
      const { enabled } = req.body;
      const config = await storage.updateTelegramConfig(MOCK_USER_ID, enabled);
      
      if (!config) {
        return res.status(404).json({ error: "Telegram not configured" });
      }
      
      res.json({ success: true, enabled: config.enabled });
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle telegram" });
    }
  });

  // POST test telegram notification
  app.post("/api/telegram/test", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      const config = await storage.getTelegramConfig(MOCK_USER_ID);
      if (!config) {
        return res.status(400).json({ error: "Telegram not configured. Send /start to your bot first." });
      }

      const success = await sendTelegramMessage(
        botToken, 
        config.chatId, 
        "🧪 Prueba de notificación\n\nEsta es una notificación de prueba de BlackOps Reminder."
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

  // DELETE disconnect telegram
  app.delete("/api/telegram/disconnect", async (req, res) => {
    try {
      await storage.deleteTelegramConfig(MOCK_USER_ID);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect telegram" });
    }
  });

  // POST telegram webhook (receives messages from Telegram)
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const update = req.body;
      console.log("[Telegram Webhook] Received update:", JSON.stringify(update).slice(0, 200));
      
      // Process message asynchronously
      handleTelegramMessage(update).catch(err => {
        console.error("[Telegram Webhook] Error handling message:", err);
      });
      
      // Always respond 200 OK to Telegram
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Telegram Webhook] Error:", error);
      res.status(200).json({ ok: true }); // Always return 200 to Telegram
    }
  });

  // POST setup telegram webhook
  app.post("/api/telegram/setup-webhook", async (req, res) => {
    try {
      const result = await setupTelegramWebhook();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to setup webhook" });
    }
  });

  // GET telegram webhook status
  app.get("/api/telegram/webhook-status", async (req, res) => {
    try {
      const status = await getTelegramWebhookStatus();
      res.json(status || { url: null, pending_update_count: 0 });
    } catch (error) {
      res.status(500).json({ error: "Failed to get webhook status" });
    }
  });

  // ==================== FINANCE ENDPOINTS ====================

  // GET market overview
  app.get("/api/finance/market", async (req, res) => {
    try {
      const overview = await getMarketOverview();
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market overview" });
    }
  });

  // GET price for symbol
  app.get("/api/finance/price/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const type = (req.query.type as string) || "stock";
      const price = await getPrice(symbol, type as any);
      if (!price) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      res.json(price);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  // GET search symbols
  app.get("/api/finance/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Query required" });
      }
      const results = await searchSymbol(query);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to search symbols" });
    }
  });

  // GET historical price data
  app.get("/api/finance/history/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const type = (req.query.type as string) || "stock";
      const period = (req.query.period as string) || "1M";
      const data = await getHistoricalData(symbol, type as any, period);
      if (!data) {
        return res.status(404).json({ error: "Historical data not found" });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  // GET portfolio news (news for all user investments)
  app.get("/api/finance/news", async (req, res) => {
    try {
      const investments = await storage.getInvestments(MOCK_USER_ID);
      const symbols = investments.map(inv => inv.symbol);
      const news = await getPortfolioNews(symbols);
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio news" });
    }
  });

  // GET market news (general financial news)
  app.get("/api/finance/news/market", async (req, res) => {
    try {
      const news = await getMarketNews();
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market news" });
    }
  });

  // GET company news for specific symbol
  app.get("/api/finance/news/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const days = parseInt(req.query.days as string) || 7;
      const news = await getCompanyNews(symbol, days);
      res.json(news);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch company news" });
    }
  });

  // GET user investments
  app.get("/api/investments", async (req, res) => {
    try {
      const investments = await storage.getInvestments(MOCK_USER_ID);
      res.json(investments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch investments" });
    }
  });

  // POST create investment
  app.post("/api/investments", async (req, res) => {
    try {
      const validated = insertInvestmentSchema.parse(req.body);
      const investment = await storage.createInvestment(MOCK_USER_ID, validated);
      res.status(201).json(investment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create investment" });
    }
  });

  // PATCH update investment
  app.patch("/api/investments/:id", async (req, res) => {
    try {
      const investment = await storage.updateInvestment(req.params.id, req.body);
      res.json(investment);
    } catch (error) {
      res.status(500).json({ error: "Failed to update investment" });
    }
  });

  // DELETE investment
  app.delete("/api/investments/:id", async (req, res) => {
    try {
      await storage.deleteInvestment(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete investment" });
    }
  });

  // GET portfolio history
  app.get("/api/portfolio/history", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const history = await storage.getPortfolioHistory(MOCK_USER_ID, days);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch portfolio history" });
    }
  });

  // POST test market update notification
  app.post("/api/portfolio/test-notification", async (req, res) => {
    try {
      await sendDailyMarketUpdate();
      res.json({ success: true, message: "Market update sent" });
    } catch (error) {
      res.status(500).json({ error: "Failed to send market update" });
    }
  });

  // GET transactions
  app.get("/api/transactions", async (req, res) => {
    try {
      const transactions = await storage.getTransactions(MOCK_USER_ID);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  // POST create transaction
  app.post("/api/transactions", async (req, res) => {
    try {
      const body = {
        ...req.body,
        date: typeof req.body.date === "string" ? new Date(req.body.date) : req.body.date,
      };
      const validated = insertTransactionSchema.parse(body);
      const transaction = await storage.createTransaction(MOCK_USER_ID, validated);
      res.status(201).json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  // GET watchlist
  app.get("/api/watchlist", async (req, res) => {
    try {
      const watchlist = await storage.getWatchlist(MOCK_USER_ID);
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch watchlist" });
    }
  });

  // POST add to watchlist
  app.post("/api/watchlist", async (req, res) => {
    try {
      const validated = insertWatchlistSchema.parse(req.body);
      const item = await storage.addToWatchlist(MOCK_USER_ID, validated);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to add to watchlist" });
    }
  });

  // DELETE from watchlist
  app.delete("/api/watchlist/:id", async (req, res) => {
    try {
      await storage.removeFromWatchlist(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove from watchlist" });
    }
  });

  // GET price alerts
  app.get("/api/price-alerts", async (req, res) => {
    try {
      const alerts = await storage.getPriceAlerts(MOCK_USER_ID);
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  // POST create price alert
  app.post("/api/price-alerts", async (req, res) => {
    try {
      const validated = insertPriceAlertSchema.parse(req.body);
      const alert = await storage.createPriceAlert(MOCK_USER_ID, validated);
      res.status(201).json(alert);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create alert" });
    }
  });

  // PATCH update price alert
  app.patch("/api/price-alerts/:id", async (req, res) => {
    try {
      const alert = await storage.updatePriceAlert(req.params.id, req.body);
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: "Failed to update alert" });
    }
  });

  // DELETE price alert
  app.delete("/api/price-alerts/:id", async (req, res) => {
    try {
      await storage.deletePriceAlert(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete alert" });
    }
  });

  // ==================== RADIO AGENT ====================

  // GET radio slots analysis
  app.get("/api/radio/slots", async (req, res) => {
    try {
      const slots = await getRadioSlotsForMonth();
      res.json(slots);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze radio slots" });
    }
  });

  // GET radio analysis summary
  app.get("/api/radio/analysis", async (req, res) => {
    try {
      const analysis = await analyzeRadioEvents();
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze radio events" });
    }
  });

  // POST send radio slots summary to Telegram
  app.post("/api/radio/notify-slots", async (req, res) => {
    try {
      const result = await sendRadioSlotsSummary();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send radio summary" });
    }
  });

  // POST import DJs from radio history
  app.post("/api/radio/import-djs", async (req, res) => {
    try {
      const result = await importDjsFromRadioHistory();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to import DJs" });
    }
  });

  // GET all DJ contacts
  app.get("/api/djs", async (req, res) => {
    try {
      const djs = await storage.getDjContacts(MOCK_USER_ID);
      res.json(djs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DJs" });
    }
  });

  // POST create DJ contact
  app.post("/api/djs", async (req, res) => {
    try {
      const parsed = insertDjContactSchema.parse(req.body);
      const dj = await storage.createDjContact(MOCK_USER_ID, parsed);
      res.json(dj);
    } catch (error) {
      res.status(500).json({ error: "Failed to create DJ contact" });
    }
  });

  // PATCH update DJ contact
  app.patch("/api/djs/:id", async (req, res) => {
    try {
      const dj = await storage.updateDjContact(req.params.id, req.body);
      res.json(dj);
    } catch (error) {
      res.status(500).json({ error: "Failed to update DJ contact" });
    }
  });

  // DELETE DJ contact
  app.delete("/api/djs/:id", async (req, res) => {
    try {
      await storage.deleteDjContact(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete DJ contact" });
    }
  });

  // POST generate message for DJ
  app.post("/api/djs/:id/message", async (req, res) => {
    try {
      const { eventDate, slot } = req.body;
      const dj = await storage.getDjContact(req.params.id);
      if (!dj) {
        return res.status(404).json({ error: "DJ not found" });
      }
      const message = await generateDjMessage(dj, eventDate, slot);
      res.json({ message });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate message" });
    }
  });

  // ==================== PORTFOLIO AGENT ====================

  // GET portfolio summary with real-time prices
  app.get("/api/portfolio/summary", async (req, res) => {
    try {
      const summary = await getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to get portfolio summary" });
    }
  });

  // GET gains by period (week, month, year)
  app.get("/api/portfolio/gains/:period", async (req, res) => {
    try {
      const { period } = req.params;
      const gains = await getGainsByPeriod(period);
      res.json(gains);
    } catch (error) {
      console.error("Error getting gains by period:", error);
      res.status(500).json({ error: "Failed to get gains by period" });
    }
  });

  // GET portfolio margin config
  app.get("/api/portfolio/margin", async (req, res) => {
    try {
      const config = await storage.getPortfolioConfig("mock-user-123");
      res.json(config || { marginUsed: "0", marginTotal: "0" });
    } catch (error) {
      res.status(500).json({ error: "Failed to get margin config" });
    }
  });

  // PUT update portfolio margin
  app.put("/api/portfolio/margin", async (req, res) => {
    try {
      const { marginUsed, marginTotal } = req.body;
      await storage.updatePortfolioConfig(
        "mock-user-123",
        String(marginUsed || "0"),
        String(marginTotal || "0")
      );
      res.json({ success: true, marginUsed, marginTotal });
    } catch (error) {
      res.status(500).json({ error: "Failed to update margin config" });
    }
  });

  // GET rebalancing recommendations
  app.get("/api/portfolio/rebalance", async (req, res) => {
    try {
      const recommendations = await analyzeRebalancing();
      res.json(recommendations);
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze rebalancing" });
    }
  });

  // GET price opportunities from watchlist and alerts
  app.get("/api/portfolio/opportunities", async (req, res) => {
    try {
      const opportunities = await checkPriceOpportunities();
      res.json(opportunities);
    } catch (error) {
      res.status(500).json({ error: "Failed to check opportunities" });
    }
  });

  // GET weekly portfolio report (preview)
  app.get("/api/portfolio/weekly-report", async (req, res) => {
    try {
      const report = await generateWeeklyReport();
      res.json({ report });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // POST send weekly portfolio report via Telegram
  app.post("/api/portfolio/send-report", async (req, res) => {
    try {
      const result = await sendWeeklyPortfolioReport();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send report" });
    }
  });

  // ==================== AGENT ACTIONS ====================

  // GET list all available actions
  app.get("/api/agent/actions", async (req, res) => {
    try {
      const actions = listAllActions();
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: "Failed to list actions" });
    }
  });

  // GET actions by category
  app.get("/api/agent/actions/:category", async (req, res) => {
    try {
      const actions = getActionsByCategory(req.params.category);
      res.json(actions.map(a => ({ id: a.id, name: a.name, description: a.description })));
    } catch (error) {
      res.status(500).json({ error: "Failed to get category actions" });
    }
  });

  // POST execute a single action
  app.post("/api/agent/execute/:actionId", async (req, res) => {
    try {
      const result = await executeAction(req.params.actionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to execute action" });
    }
  });

  // POST execute multiple actions
  app.post("/api/agent/execute-batch", async (req, res) => {
    try {
      const { actionIds } = req.body;
      if (!Array.isArray(actionIds)) {
        return res.status(400).json({ error: "actionIds must be an array" });
      }
      const results = await executeMultipleActions(actionIds);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Failed to execute actions" });
    }
  });

  // GET agent action history
  app.get("/api/agent/history", async (req, res) => {
    try {
      const actions = await storage.getAgentActions(MOCK_USER_ID);
      res.json(actions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get action history" });
    }
  });

  // ==================== MONITORED PROJECTS ====================

  // GET all monitored projects
  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await storage.getMonitoredProjects(MOCK_USER_ID);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  // GET single monitored project
  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.getMonitoredProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  // POST create monitored project
  app.post("/api/projects", async (req, res) => {
    try {
      const validated = insertMonitoredProjectSchema.parse(req.body);
      const project = await storage.createMonitoredProject(MOCK_USER_ID, validated);
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // PATCH update monitored project
  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const project = await storage.updateMonitoredProject(req.params.id, req.body);
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // DELETE monitored project
  app.delete("/api/projects/:id", async (req, res) => {
    try {
      await storage.deleteMonitoredProject(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // POST check project health manually
  app.post("/api/projects/:id/check", async (req, res) => {
    try {
      const result = await checkSingleProject(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Project not found" });
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to check project" });
    }
  });

  // GET project health check logs
  app.get("/api/projects/:id/logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getHealthCheckLogs(req.params.id, limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // GET project incidents
  app.get("/api/projects/:id/incidents", async (req, res) => {
    try {
      const incidents = await storage.getIncidents(req.params.id);
      res.json(incidents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch incidents" });
    }
  });

  // Register AI assistant routes
  registerAssistantRoutes(app);

  // ==================== CODE AGENT ROUTES ====================
  
  // Read file content
  app.get("/api/code/read", async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        return res.status(400).json({ error: "Se requiere el parámetro 'path'" });
      }
      const result = await readFile(filePath);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error leyendo archivo" });
    }
  });
  
  // Write file content
  app.post("/api/code/write", async (req, res) => {
    try {
      const { path: filePath, content, description } = req.body;
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: "Se requieren 'path' y 'content'" });
      }
      const result = await writeFile(filePath, content, description);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error escribiendo archivo" });
    }
  });
  
  // List files in directory
  app.get("/api/code/files", async (req, res) => {
    try {
      const directory = (req.query.dir as string) || "client/src";
      const result = await listFiles(directory);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error listando archivos" });
    }
  });
  
  // Get project structure
  app.get("/api/code/structure", async (req, res) => {
    try {
      const structure = await getProjectStructure();
      res.json({ success: true, structure });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo estructura" });
    }
  });
  
  // Get change history
  app.get("/api/code/history", async (req, res) => {
    try {
      const history = await getChangeHistory();
      res.json({ success: true, history });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo historial" });
    }
  });
  
  // Undo last change
  app.post("/api/code/undo", async (req, res) => {
    try {
      const result = await undoLastChange();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error deshaciendo cambio" });
    }
  });
  
  // Get database schema
  app.get("/api/code/schema", async (req, res) => {
    try {
      const result = await getTableSchema();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo esquema" });
    }
  });
  
  // Execute SELECT query
  app.post("/api/code/query", async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) {
        return res.status(400).json({ error: "Se requiere 'query'" });
      }
      const result = await executeQuery(query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error ejecutando consulta" });
    }
  });
  
  // Get table info
  app.get("/api/code/table/:name", async (req, res) => {
    try {
      const result = await getTableInfo(req.params.name);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo info de tabla" });
    }
  });
  
  // Create new table
  app.post("/api/code/table", async (req, res) => {
    try {
      const { name, columns } = req.body;
      if (!name || !columns) {
        return res.status(400).json({ error: "Se requieren 'name' y 'columns'" });
      }
      const result = await createTable({ name, columns });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error creando tabla" });
    }
  });
  
  // Add column to table
  app.post("/api/code/table/:name/column", async (req, res) => {
    try {
      const { name, type, nullable, defaultValue } = req.body;
      if (!name || !type) {
        return res.status(400).json({ error: "Se requieren 'name' y 'type'" });
      }
      const result = await addColumnToTable(req.params.name, { name, type, nullable, defaultValue });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error agregando columna" });
    }
  });
  
  // ==================== CODE GENERATOR ROUTES ====================
  
  // Generate code from natural language
  app.post("/api/code/generate", async (req, res) => {
    try {
      const { prompt, context, preview } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Se requiere 'prompt'" });
      }
      const result = await generateCode({ prompt, context, preview: preview ?? true });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error generando código" });
    }
  });
  
  // Apply generated code
  app.post("/api/code/apply", async (req, res) => {
    try {
      const { prompt, context } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Se requiere 'prompt'" });
      }
      const result = await generateCode({ prompt, context, preview: false });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error aplicando código" });
    }
  });
  
  // Get available templates
  app.get("/api/code/templates", async (req, res) => {
    try {
      const templates = Object.entries(MODULE_TEMPLATES).map(([key, val]) => ({
        id: key,
        name: val.name,
        description: val.description
      }));
      res.json({ success: true, templates });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo templates" });
    }
  });
  
  // Generate from template
  app.post("/api/code/template/:id", async (req, res) => {
    try {
      const templateKey = req.params.id as keyof typeof MODULE_TEMPLATES;
      const result = await generateFromTemplate(templateKey, req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error generando desde template" });
    }
  });

  // ===== GitHub Integration Routes =====
  
  // Check if GitHub is connected
  app.get("/api/github/status", async (req, res) => {
    try {
      const connected = await isGitHubConnected();
      if (connected) {
        const user = await getAuthenticatedUser();
        res.json({ connected: true, user });
      } else {
        res.json({ connected: false });
      }
    } catch (error) {
      res.json({ connected: false });
    }
  });

  // List user's repositories
  app.get("/api/github/repos", async (req, res) => {
    try {
      const repos = await listRepositories();
      res.json(repos);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al listar repositorios" });
    }
  });

  // Get repository contents (files/folders at path)
  app.get("/api/github/repos/:owner/:repo/contents", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const path = (req.query.path as string) || '';
      const contents = await getRepoContents(owner, repo, path);
      res.json(contents);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al obtener contenido" });
    }
  });

  // Get file content
  app.get("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const path = req.query.path as string;
      if (!path) {
        return res.status(400).json({ error: "Se requiere el parámetro path" });
      }
      const file = await getFileContent(owner, repo, path);
      res.json(file);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al leer archivo" });
    }
  });

  // Update or create file
  app.post("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { path, content, message, sha } = req.body;
      if (!path || content === undefined || !message) {
        return res.status(400).json({ error: "Se requieren path, content y message" });
      }
      const result = await updateFile(owner, repo, path, content, message, sha);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al guardar archivo" });
    }
  });

  // Delete file
  app.delete("/api/github/repos/:owner/:repo/file", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { path, message, sha } = req.body;
      if (!path || !message || !sha) {
        return res.status(400).json({ error: "Se requieren path, message y sha" });
      }
      const result = await deleteFile(owner, repo, path, message, sha);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Error al eliminar archivo" });
    }
  });

  return httpServer;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
