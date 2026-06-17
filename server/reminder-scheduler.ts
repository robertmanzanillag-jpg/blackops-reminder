import { storage } from "./storage";
import { sendPushNotification } from "./push-notifications";
import { sendTelegramMessage, sendTelegramPlainMessageChunks } from "./telegram";
import { sendProactiveInsights } from "./proactive-insights";
import { executeAction } from "./agent-actions";
import { getPortfolioNews } from "./finance";
import { getSystemUserId } from "./user-context";
import { generateCeoMorningBrief } from "./ceo-briefing";
import { ensureDefaultAutomations, recordScheduledAutomationRun, type ScheduledAutomationRunOutcome } from "./automation-registry";
import { generateRadioTemplatesForDate } from "./radio-template-agent";
import {
  getDateKeyFromClock,
  getZonedClock as getClockInTimezone,
  shouldRunDailyScheduledJob,
  type SchedulerClock,
} from "./scheduler-time";

const SCHEDULER_TIMEZONE = process.env.SCHEDULER_TIMEZONE || "America/New_York";
const CEO_BRIEF_HOUR = Number(process.env.CEO_BRIEF_HOUR || 7);
const CEO_BRIEF_MINUTE = Number(process.env.CEO_BRIEF_MINUTE || 0);
const INSIGHTS_HOUR = Number(process.env.INSIGHTS_HOUR || 8);
const NEWS_DIGEST_HOUR = Number(process.env.NEWS_DIGEST_HOUR || 9);
const EVENING_REVIEW_HOUR = Number(process.env.EVENING_REVIEW_HOUR || 21);

export function getReminderSchedulerConfig() {
  return {
    timezone: SCHEDULER_TIMEZONE,
    ceoBriefHour: CEO_BRIEF_HOUR,
    ceoBriefMinute: CEO_BRIEF_MINUTE,
    insightsHour: INSIGHTS_HOUR,
    newsDigestHour: NEWS_DIGEST_HOUR,
    eveningReviewHour: EVENING_REVIEW_HOUR,
  };
}

async function sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText = false): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const config = await storage.getTelegramConfig(userId);
  if (!config || !config.enabled) return false;

  const message = `<b>${title}</b>\n\n${body}`;
  return plainText
    ? sendTelegramPlainMessageChunks(botToken, config.chatId, `${title}\n\n${body}`)
    : sendTelegramMessage(botToken, config.chatId, message);
}

async function getScheduledNotificationUserIds(): Promise<string[]> {
  const [telegramConfigs, pushSubscriptions] = await Promise.all([
    storage.getEnabledTelegramConfigs(),
    storage.getAllPushSubscriptions(),
  ]);
  const userIds = [
    ...telegramConfigs.map((config) => config.userId),
    ...pushSubscriptions.map((subscription) => subscription.userId),
  ].filter((userId): userId is string => Boolean(userId));
  const uniqueUserIds = Array.from(new Set(userIds));
  return uniqueUserIds.length ? uniqueUserIds : [getSystemUserId()];
}

async function runTrackedScheduledAutomation<T>(
  userId: string,
  automationKey: string,
  run: () => Promise<T>,
  summarize: (result: T) => ScheduledAutomationRunOutcome,
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await run();
    await recordScheduledAutomationRun(userId, automationKey, startedAt, summarize(result));
    return result;
  } catch (error: any) {
    const message = error?.message || "Scheduled automation failed";
    await recordScheduledAutomationRun(userId, automationKey, startedAt, {
      status: "failed",
      resultSummary: `${automationKey} failed`,
      errorMessage: message,
      metadata: { error: message },
    });
    throw error;
  }
}

let lastMorningNotification: string | null = null;
let lastEveningNotification: string | null = null;
let lastWeeklyNotification: string | null = null;
let lastInsightsNotification: string | null = null;
let lastRadioAnalysis: string | null = null;
let lastRadioTemplateGeneration: string | null = null;
let lastPortfolioReport: string | null = null;
let lastVideoEditCheck: string | null = null;
let lastNewsNotification: string | null = null;
const userRemindersSent: Map<string, string> = new Map();

export function getZonedClock(date: Date): SchedulerClock {
  return getClockInTimezone(date, SCHEDULER_TIMEZONE);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

async function getTodaysTasks(userId = getSystemUserId()): Promise<{ pending: string[]; completed: string[] }> {
  const tasks = await storage.getTasks(userId);
  const today = new Date();
  
  const todaysTasks = tasks.filter((task) => isSameDay(new Date(task.date), today));
  
  const pending = todaysTasks.filter((t) => !t.completed).map((t) => t.title);
  const completed = todaysTasks.filter((t) => t.completed).map((t) => t.title);
  
  return { pending, completed };
}

async function getIncompleteWeeklyTasks(userId = getSystemUserId()): Promise<string[]> {
  const weekStart = getWeekStart(new Date());
  const weeklyTasks = await storage.getWeeklyTasks(userId, weekStart);
  
  return weeklyTasks.filter((t) => !t.completed).map((t) => t.title);
}

async function sendMorningReminder(): Promise<void> {
  const title = "🌅 Brief CEO";
  const userIds = await getScheduledNotificationUserIds();

  await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
    userId,
    "morning-reminder",
    async () => {
    const { pending } = await getTodaysTasks(userId);
    const body = await generateCeoMorningBrief(userId);

    await Promise.all([
      sendPushNotification(userId, { title, body: pending.length > 0 ? `${pending.length} pendiente(s) para hoy.` : "Brief ejecutivo listo.", url: "/", tag: "morning-reminder" }),
      sendTelegramNotificationToUser(userId, title, body, true),
    ]);

    console.log(`[Reminder] CEO morning brief sent for ${userId} - ${pending.length} pending tasks`);
      return { pendingCount: pending.length };
    },
    (result) => ({
      status: "success",
      resultSummary: `CEO morning brief sent with ${result.pendingCount} pending task(s).`,
      metadata: result,
    }),
  )));
}

async function sendMorningReminderForUser(userId: string): Promise<void> {
  const { pending } = await getTodaysTasks(userId);
  const title = "🌅 Brief CEO";
  const body = await generateCeoMorningBrief(userId);

  await Promise.all([
    sendPushNotification(userId, { title, body: pending.length > 0 ? `${pending.length} pendiente(s) para hoy.` : "Brief ejecutivo listo.", url: "/", tag: "morning-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] CEO morning brief test sent for ${userId} - ${pending.length} pending tasks`);
}

async function sendEveningReminder(): Promise<void> {
  const title = "🌙 Tareas sin Completar";
  const userIds = await getScheduledNotificationUserIds();

  await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
    userId,
    "evening-reminder",
    async () => {
    const { pending } = await getTodaysTasks(userId);

    if (pending.length === 0) {
      console.log(`[Reminder] All tasks completed for ${userId} today - skipping evening notification`);
      return { sent: false, pendingCount: 0 };
    }

    const taskList = pending.slice(0, 5).join("\n• ");
    const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
    const body = `Quedan ${pending.length} tarea${pending.length > 1 ? "s" : ""} por hacer:\n• ${taskList}${moreText}`;

    await Promise.all([
      sendPushNotification(userId, { title, body, url: "/", tag: "evening-reminder" }),
      sendTelegramNotificationToUser(userId, title, body, true),
    ]);

    console.log(`[Reminder] Evening notification sent for ${userId} - ${pending.length} incomplete tasks`);
      return { sent: true, pendingCount: pending.length };
    },
    (result) => ({
      status: result.sent ? "success" : "skipped",
      resultSummary: result.sent
        ? `Evening reminder sent with ${result.pendingCount} pending task(s).`
        : "Evening reminder skipped because all tasks are complete.",
      metadata: result,
    }),
  )));
}

async function sendEveningReminderForUser(userId: string): Promise<void> {
  const title = "🌙 Tareas sin Completar";
  const { pending } = await getTodaysTasks(userId);

  if (pending.length === 0) {
    console.log(`[Reminder] All tasks completed for ${userId} today - skipping evening notification`);
    return;
  }

  const taskList = pending.slice(0, 5).join("\n• ");
  const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
  const body = `Quedan ${pending.length} tarea${pending.length > 1 ? "s" : ""} por hacer:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(userId, { title, body, url: "/", tag: "evening-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] Evening notification test sent for ${userId} - ${pending.length} incomplete tasks`);
}

async function sendWeeklyReminder(): Promise<void> {
  const title = "📅 Tareas Semanales Pendientes";
  const userIds = await getScheduledNotificationUserIds();

  await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
    userId,
    "weekly-reminder",
    async () => {
    const incompleteTasks = await getIncompleteWeeklyTasks(userId);

    if (incompleteTasks.length === 0) {
      console.log(`[Reminder] All weekly tasks completed for ${userId} - skipping weekly notification`);
      return { sent: false, incompleteCount: 0 };
    }

    const taskList = incompleteTasks.slice(0, 5).join("\n• ");
    const moreText = incompleteTasks.length > 5 ? `\n+${incompleteTasks.length - 5} más` : "";
    const body = `Tienes ${incompleteTasks.length} tarea${incompleteTasks.length > 1 ? "s" : ""} semanal${incompleteTasks.length > 1 ? "es" : ""} pendiente${incompleteTasks.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

    await Promise.all([
      sendPushNotification(userId, { title, body, url: "/", tag: "weekly-reminder" }),
      sendTelegramNotificationToUser(userId, title, body, true),
    ]);

    console.log(`[Reminder] Weekly notification sent for ${userId} - ${incompleteTasks.length} incomplete weekly tasks`);
      return { sent: true, incompleteCount: incompleteTasks.length };
    },
    (result) => ({
      status: result.sent ? "success" : "skipped",
      resultSummary: result.sent
        ? `Weekly reminder sent with ${result.incompleteCount} incomplete task(s).`
        : "Weekly reminder skipped because all weekly tasks are complete.",
      metadata: result,
    }),
  )));
}

async function sendWeeklyReminderForUser(userId: string): Promise<void> {
  const title = "📅 Tareas Semanales Pendientes";
  const incompleteTasks = await getIncompleteWeeklyTasks(userId);

  if (incompleteTasks.length === 0) {
    console.log(`[Reminder] All weekly tasks completed for ${userId} - skipping weekly notification`);
    return;
  }

  const taskList = incompleteTasks.slice(0, 5).join("\n• ");
  const moreText = incompleteTasks.length > 5 ? `\n+${incompleteTasks.length - 5} más` : "";
  const body = `Tienes ${incompleteTasks.length} tarea${incompleteTasks.length > 1 ? "s" : ""} semanal${incompleteTasks.length > 1 ? "es" : ""} pendiente${incompleteTasks.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(userId, { title, body, url: "/", tag: "weekly-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] Weekly notification test sent for ${userId} - ${incompleteTasks.length} incomplete weekly tasks`);
}

async function sendDailyNewsDigest(): Promise<{ sent: boolean; newsCount: number }> {
  try {
    const userIds = await getScheduledNotificationUserIds();
    const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
      userId,
      "portfolio-news-digest",
      () => sendDailyNewsDigestForUser(userId),
      (result) => ({
        status: result.sent ? "success" : "skipped",
        resultSummary: result.sent
          ? `Portfolio news digest sent with ${result.newsCount} news item(s).`
          : "Portfolio news digest skipped because no news was sent.",
        metadata: result,
      }),
    )));

    return {
      sent: results.some((result) => result.sent),
      newsCount: results.reduce((total, result) => total + result.newsCount, 0),
    };
  } catch (error) {
    console.error("[Reminder] Error sending news digest:", error);
    return { sent: false, newsCount: 0 };
  }
}

async function sendDailyNewsDigestForUser(userId: string): Promise<{ sent: boolean; newsCount: number }> {
  const investments = await storage.getInvestments(userId);
  const symbols = investments.map(inv => inv.symbol);
  if (symbols.length === 0) {
    console.log(`[Reminder] No portfolio symbols for ${userId} news digest`);
    return { sent: false, newsCount: 0 };
  }

  const news = await getPortfolioNews(symbols);

  if (news.length === 0) {
    console.log(`[Reminder] No news available for ${userId} portfolio`);
    return { sent: false, newsCount: 0 };
  }

  const topNews = news.slice(0, 5);
  const newsItems = topNews.map((n, i) =>
    `${i + 1}. ${n.related}: ${n.headline}\n   ${n.url}`
  ).join("\n\n");

  const title = "📰 Noticias de tu Portafolio";
  const body = `${newsItems}\n\nTotal: ${news.length} noticias disponibles`;

  const sent = await sendTelegramNotificationToUser(userId, title, body, true);
  console.log(`[Reminder] Daily news digest ${sent ? "sent" : "not sent"} for ${userId} - ${news.length} news items`);
  return { sent, newsCount: news.length };
}

async function runRadioTemplateGenerationForUser(userId: string): Promise<string> {
  const automations = await ensureDefaultAutomations(userId);
  const automation = automations.find((item) => (item.metadata as any)?.key === "radio-template-generation");
  const startedAt = new Date();

  try {
    const result = await generateRadioTemplatesForDate(userId);
    const status = result.failed > 0 ? "failed" : result.generated > 0 || result.skipped > 0 ? "success" : "skipped";
    const resultSummary = `Radio templates ${status}: ${result.generated} generated, ${result.skipped} skipped, ${result.failed} failed for ${result.dateKey}`;

    if (automation) {
      await storage.createAutomationRun({
        automationId: automation.id,
        ownerUserId: userId,
        startedAt,
        finishedAt: new Date(),
        status,
        triggeredBy: "scheduler",
        resultSummary,
        errorMessage: status === "failed" ? result.files.find((file) => file.status === "failed")?.errorMessage || null : null,
        costEstimate: automation.costEstimate,
        pendingActionId: null,
        auditLogId: null,
        metadata: result,
      });
    }

    return resultSummary;
  } catch (error: any) {
    const message = error?.message || "Radio template generation failed";
    if (automation) {
      await storage.createAutomationRun({
        automationId: automation.id,
        ownerUserId: userId,
        startedAt,
        finishedAt: new Date(),
        status: "failed",
        triggeredBy: "scheduler",
        resultSummary: "Radio template generation failed",
        errorMessage: message,
        costEstimate: automation.costEstimate,
        pendingActionId: null,
        auditLogId: null,
        metadata: { error: message },
      });
    }
    return `Radio templates failed: ${message}`;
  }
}

async function checkScheduledReminders(): Promise<void> {
  const now = new Date();
  const clock = getZonedClock(now);
  const { hour, minute, dayOfWeek } = clock;
  const dateKey = getDateKeyFromClock(clock);
  const weekKey = dateKey;
  
  try {
    if (shouldRunDailyScheduledJob(clock, CEO_BRIEF_HOUR, CEO_BRIEF_MINUTE, lastMorningNotification)) {
      lastMorningNotification = dateKey;
      await sendMorningReminder();
    }
    
    if (shouldRunDailyScheduledJob(clock, INSIGHTS_HOUR, 0, lastInsightsNotification)) {
      lastInsightsNotification = dateKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
        userId,
        "proactive-insights",
        () => sendProactiveInsights(userId),
        (result) => ({
          status: result.sent ? "success" : "skipped",
          resultSummary: result.sent
            ? `Proactive insights sent with ${result.insights} insight(s).`
            : "Proactive insights skipped because nothing was sent.",
          metadata: result,
        }),
      )));
      const sentCount = results.filter((result) => result.sent).length;
      const insightCount = results.reduce((total, result) => total + result.insights, 0);
      console.log(`[Reminder] Proactive insights processed for ${userIds.length} user(s) - ${sentCount} sent, ${insightCount} insights`);
    }

    if (shouldRunDailyScheduledJob(clock, 8, 15, lastRadioTemplateGeneration)) {
      lastRadioTemplateGeneration = dateKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runRadioTemplateGenerationForUser(userId)));
      console.log(`[Agent] Radio template generation processed for ${userIds.length} user(s): ${results.join("; ")}`);
    }
    
    // Daily news digest at 9:00 AM
    if (shouldRunDailyScheduledJob(clock, NEWS_DIGEST_HOUR, 0, lastNewsNotification)) {
      lastNewsNotification = dateKey;
      const result = await sendDailyNewsDigest();
      if (result.sent) {
        console.log(`[Reminder] Daily news digest sent - ${result.newsCount} news items`);
      }
    }
    
    if (shouldRunDailyScheduledJob(clock, EVENING_REVIEW_HOUR, 0, lastEveningNotification)) {
      lastEveningNotification = dateKey;
      await sendEveningReminder();
    }
    
    if (dayOfWeek === 0 && hour === 18 && minute === 0 && lastWeeklyNotification !== weekKey) {
      lastWeeklyNotification = weekKey;
      await sendWeeklyReminder();
    }
    
    // Agent Actions - Radio analysis Monday 8:00 AM
    if (dayOfWeek === 1 && hour === 8 && minute === 0 && lastRadioAnalysis !== weekKey) {
      lastRadioAnalysis = weekKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
        userId,
        "radio-slot-check",
        () => executeAction("radio_notify_slots", userId),
        (result) => ({
          status: result.success ? "success" : "failed",
          resultSummary: result.message,
          errorMessage: result.success ? null : result.message,
          metadata: result,
        }),
      )));
      console.log(`[Agent] Radio analysis processed for ${userIds.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // Agent Actions - Portfolio weekly report Sunday 10:00 AM
    if (dayOfWeek === 0 && hour === 10 && minute === 0 && lastPortfolioReport !== weekKey) {
      lastPortfolioReport = weekKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
        userId,
        "portfolio-weekly-report",
        () => executeAction("portfolio_weekly_report", userId),
        (result) => ({
          status: result.success ? "success" : "failed",
          resultSummary: result.message,
          errorMessage: result.success ? null : result.message,
          metadata: result,
        }),
      )));
      console.log(`[Agent] Portfolio report processed for ${userIds.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // Agent Actions - Create video edit tasks Friday 10:00 AM
    if (dayOfWeek === 5 && hour === 10 && minute === 0 && lastVideoEditCheck !== dateKey) {
      lastVideoEditCheck = dateKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
        userId,
        "video-edit-task-check",
        () => executeAction("create_video_edit_task", userId),
        (result) => ({
          status: result.success ? "success" : "failed",
          resultSummary: result.message,
          errorMessage: result.success ? null : result.message,
          metadata: result,
        }),
      )));
      console.log(`[Agent] Video edit task check processed for ${userIds.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // User scheduled reminders
    await processUserScheduledReminders(now, dateKey);
  } catch (error) {
    console.error("[Reminder] Error checking scheduled reminders:", error);
  }
}

const dayNameToNumber: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

async function processUserScheduledReminders(now: Date, dateKey: string): Promise<void> {
  try {
    const reminders = await storage.getActiveScheduledReminders();
    const clock = getZonedClock(now);
    const { hour, minute, dayOfWeek } = clock;
    
    for (const reminder of reminders) {
      if (reminder.hour !== hour || reminder.minute !== minute) continue;
      
      const reminderKey = `${reminder.id}-${dateKey}`;
      if (userRemindersSent.has(reminderKey)) continue;
      
      // Check if should run today
      if (reminder.daysOfWeek && reminder.daysOfWeek.length > 0) {
        const shouldRunToday = reminder.daysOfWeek.some(
          (day: string) => dayNameToNumber[day.toLowerCase()] === dayOfWeek
        );
        if (!shouldRunToday) continue;
      }
      
      userRemindersSent.set(reminderKey, dateKey);
      
      await sendTelegramNotificationToUser(reminder.userId, "⏰ Recordatorio", reminder.message, true);
      console.log(`[Reminder] User reminder sent: ${reminder.message}`);
    }
  } catch (error) {
    console.error("[Reminder] Error processing user scheduled reminders:", error);
  }
}

export function startReminderScheduler(): void {
  console.log("[Reminder] Starting reminder scheduler...");
  console.log(`[Reminder] Schedule timezone: ${SCHEDULER_TIMEZONE}`);
  console.log(`[Reminder] Schedule: CEO Brief ${CEO_BRIEF_HOUR}:${String(CEO_BRIEF_MINUTE).padStart(2, "0")}, Insights ${INSIGHTS_HOUR}:00, News ${NEWS_DIGEST_HOUR}:00, Evening ${EVENING_REVIEW_HOUR}:00, Weekly Sunday 18:00`);
  console.log("[Agent] Schedule: Radio Monday 8:00 AM, Radio Templates daily 8:15 AM, Portfolio Sunday 10:00 AM, Video Tasks Friday 10:00 AM");
  
  setInterval(checkScheduledReminders, 60 * 1000);
  
  checkScheduledReminders();
}

export async function testMorningReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendMorningReminderForUser(userId);
    else await sendMorningReminder();
    return { success: true, message: "CEO morning brief sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testCeoMorningBrief(userId = getSystemUserId()): Promise<{ success: boolean; message: string }> {
  try {
    await sendMorningReminderForUser(userId);
    return { success: true, message: "CEO morning brief sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testEveningReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendEveningReminderForUser(userId);
    else await sendEveningReminder();
    return { success: true, message: "Evening reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testWeeklyReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendWeeklyReminderForUser(userId);
    else await sendWeeklyReminder();
    return { success: true, message: "Weekly reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testProactiveInsights(userId?: string): Promise<{ success: boolean; message: string; insights: number }> {
  try {
    const userIds = userId ? [userId] : await getScheduledNotificationUserIds();
    const results = await Promise.all(userIds.map((userId) => sendProactiveInsights(userId)));
    const sent = results.some((result) => result.sent);
    const insights = results.reduce((total, result) => total + result.insights, 0);
    return {
      success: sent,
      message: sent ? "Proactive insights sent" : "No insights to send or Telegram not configured",
      insights
    };
  } catch (error: any) {
    return { success: false, message: error.message, insights: 0 };
  }
}

export async function testNewsDigest(userId?: string): Promise<{ success: boolean; message: string; newsCount: number }> {
  try {
    const result = userId ? await sendDailyNewsDigestForUser(userId) : await sendDailyNewsDigest();
    return { 
      success: result.sent, 
      message: result.sent ? "News digest sent" : "No news available or FINNHUB_API_KEY not configured",
      newsCount: result.newsCount 
    };
  } catch (error: any) {
    return { success: false, message: error.message, newsCount: 0 };
  }
}
