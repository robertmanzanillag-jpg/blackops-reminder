import { storage } from "./storage";
import { sendPushNotification } from "./push-notifications";
import { sendTelegramMessage } from "./telegram";
import { sendProactiveInsights } from "./proactive-insights";
import { executeAction } from "./agent-actions";
import { getPortfolioNews } from "./finance";

const MOCK_USER_ID = "mock-user-123";

async function sendTelegramNotification(title: string, body: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const config = await storage.getTelegramConfig(MOCK_USER_ID);
  if (!config || !config.enabled) return;

  const message = `<b>${title}</b>\n\n${body}`;
  await sendTelegramMessage(botToken, config.chatId, message);
}

let lastMorningNotification: string | null = null;
let lastEveningNotification: string | null = null;
let lastWeeklyNotification: string | null = null;
let lastInsightsNotification: string | null = null;
let lastRadioAnalysis: string | null = null;
let lastPortfolioReport: string | null = null;
let lastVideoEditCheck: string | null = null;
let lastNewsNotification: string | null = null;
const userRemindersSent: Map<string, string> = new Map();

function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function getWeekKey(date: Date): string {
  const weekStart = getWeekStart(date);
  return `${weekStart.getFullYear()}-${weekStart.getMonth() + 1}-${weekStart.getDate()}`;
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

async function getTodaysTasks(): Promise<{ pending: string[]; completed: string[] }> {
  const tasks = await storage.getTasks(MOCK_USER_ID);
  const today = new Date();
  
  const todaysTasks = tasks.filter((task) => isSameDay(new Date(task.date), today));
  
  const pending = todaysTasks.filter((t) => !t.completed).map((t) => t.title);
  const completed = todaysTasks.filter((t) => t.completed).map((t) => t.title);
  
  return { pending, completed };
}

async function getIncompleteWeeklyTasks(): Promise<string[]> {
  const weekStart = getWeekStart(new Date());
  const weeklyTasks = await storage.getWeeklyTasks(MOCK_USER_ID, weekStart);
  
  return weeklyTasks.filter((t) => !t.completed).map((t) => t.title);
}

async function sendMorningReminder(): Promise<void> {
  const { pending } = await getTodaysTasks();
  
  if (pending.length === 0) {
    console.log("[Reminder] No pending tasks for today - skipping morning notification");
    return;
  }
  
  const taskList = pending.slice(0, 5).join("\n• ");
  const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
  
  const title = "🌅 Tareas de Hoy";
  const body = `Tienes ${pending.length} tarea${pending.length > 1 ? "s" : ""} pendiente${pending.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(MOCK_USER_ID, { title, body, url: "/", tag: "morning-reminder" }),
    sendTelegramNotification(title, body),
  ]);
  
  console.log(`[Reminder] Morning notification sent - ${pending.length} pending tasks`);
}

async function sendEveningReminder(): Promise<void> {
  const { pending } = await getTodaysTasks();
  
  if (pending.length === 0) {
    console.log("[Reminder] All tasks completed for today - skipping evening notification");
    return;
  }
  
  const taskList = pending.slice(0, 5).join("\n• ");
  const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
  
  const title = "🌙 Tareas sin Completar";
  const body = `Quedan ${pending.length} tarea${pending.length > 1 ? "s" : ""} por hacer:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(MOCK_USER_ID, { title, body, url: "/", tag: "evening-reminder" }),
    sendTelegramNotification(title, body),
  ]);
  
  console.log(`[Reminder] Evening notification sent - ${pending.length} incomplete tasks`);
}

async function sendWeeklyReminder(): Promise<void> {
  const incompleteTasks = await getIncompleteWeeklyTasks();
  
  if (incompleteTasks.length === 0) {
    console.log("[Reminder] All weekly tasks completed - skipping weekly notification");
    return;
  }
  
  const taskList = incompleteTasks.slice(0, 5).join("\n• ");
  const moreText = incompleteTasks.length > 5 ? `\n+${incompleteTasks.length - 5} más` : "";
  
  const title = "📅 Tareas Semanales Pendientes";
  const body = `Tienes ${incompleteTasks.length} tarea${incompleteTasks.length > 1 ? "s" : ""} semanal${incompleteTasks.length > 1 ? "es" : ""} pendiente${incompleteTasks.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(MOCK_USER_ID, { title, body, url: "/", tag: "weekly-reminder" }),
    sendTelegramNotification(title, body),
  ]);
  
  console.log(`[Reminder] Weekly notification sent - ${incompleteTasks.length} incomplete weekly tasks`);
}

async function sendDailyNewsDigest(): Promise<{ sent: boolean; newsCount: number }> {
  try {
    const investments = await storage.getInvestments(MOCK_USER_ID);
    const symbols = investments.map(inv => inv.symbol);
    const news = await getPortfolioNews(symbols);
    
    if (news.length === 0) {
      console.log("[Reminder] No news available for portfolio");
      return { sent: false, newsCount: 0 };
    }
    
    const topNews = news.slice(0, 5);
    const newsItems = topNews.map((n, i) => 
      `${i + 1}. <b>${n.related}</b>: ${n.headline}\n   <a href="${n.url}">Leer más</a>`
    ).join("\n\n");
    
    const title = "📰 Noticias de tu Portafolio";
    const body = `${newsItems}\n\n<i>Total: ${news.length} noticias disponibles</i>`;
    
    await sendTelegramNotification(title, body);
    console.log(`[Reminder] Daily news digest sent - ${news.length} news items`);
    return { sent: true, newsCount: news.length };
  } catch (error) {
    console.error("[Reminder] Error sending news digest:", error);
    return { sent: false, newsCount: 0 };
  }
}

async function checkScheduledReminders(): Promise<void> {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay();
  const dateKey = getDateKey(now);
  const weekKey = getWeekKey(now);
  
  try {
    if (hour === 7 && minute === 0 && lastMorningNotification !== dateKey) {
      lastMorningNotification = dateKey;
      await sendMorningReminder();
    }
    
    if (hour === 8 && minute === 0 && lastInsightsNotification !== dateKey) {
      lastInsightsNotification = dateKey;
      const result = await sendProactiveInsights();
      if (result.sent) {
        console.log(`[Reminder] Proactive insights sent - ${result.insights} insights`);
      }
    }
    
    // Daily news digest at 9:00 AM
    if (hour === 9 && minute === 0 && lastNewsNotification !== dateKey) {
      lastNewsNotification = dateKey;
      const result = await sendDailyNewsDigest();
      if (result.sent) {
        console.log(`[Reminder] Daily news digest sent - ${result.newsCount} news items`);
      }
    }
    
    if (hour === 21 && minute === 0 && lastEveningNotification !== dateKey) {
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
      const result = await executeAction("radio_notify_slots");
      console.log(`[Agent] Radio analysis: ${result.message}`);
    }
    
    // Agent Actions - Portfolio weekly report Sunday 10:00 AM
    if (dayOfWeek === 0 && hour === 10 && minute === 0 && lastPortfolioReport !== weekKey) {
      lastPortfolioReport = weekKey;
      const result = await executeAction("portfolio_weekly_report");
      console.log(`[Agent] Portfolio report: ${result.message}`);
    }
    
    // Agent Actions - Create video edit tasks Friday 10:00 AM
    if (dayOfWeek === 5 && hour === 10 && minute === 0 && lastVideoEditCheck !== dateKey) {
      lastVideoEditCheck = dateKey;
      const result = await executeAction("create_video_edit_task");
      console.log(`[Agent] Video edit task check: ${result.message}`);
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
    const hour = now.getHours();
    const minute = now.getMinutes();
    const dayOfWeek = now.getDay();
    
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
      
      await sendTelegramNotification("⏰ Recordatorio", reminder.message);
      console.log(`[Reminder] User reminder sent: ${reminder.message}`);
    }
  } catch (error) {
    console.error("[Reminder] Error processing user scheduled reminders:", error);
  }
}

export function startReminderScheduler(): void {
  console.log("[Reminder] Starting reminder scheduler...");
  console.log("[Reminder] Schedule: Morning 7:00 AM, Insights 8:00 AM, News 9:00 AM, Evening 9:00 PM, Weekly Sunday 6:00 PM");
  console.log("[Agent] Schedule: Radio Monday 8:00 AM, Portfolio Sunday 10:00 AM, Video Tasks Friday 10:00 AM");
  
  setInterval(checkScheduledReminders, 60 * 1000);
  
  checkScheduledReminders();
}

export async function testMorningReminder(): Promise<{ success: boolean; message: string }> {
  try {
    await sendMorningReminder();
    return { success: true, message: "Morning reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testEveningReminder(): Promise<{ success: boolean; message: string }> {
  try {
    await sendEveningReminder();
    return { success: true, message: "Evening reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testWeeklyReminder(): Promise<{ success: boolean; message: string }> {
  try {
    await sendWeeklyReminder();
    return { success: true, message: "Weekly reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testProactiveInsights(): Promise<{ success: boolean; message: string; insights: number }> {
  try {
    const result = await sendProactiveInsights();
    return { 
      success: result.sent, 
      message: result.sent ? "Proactive insights sent" : "No insights to send or Telegram not configured",
      insights: result.insights 
    };
  } catch (error: any) {
    return { success: false, message: error.message, insights: 0 };
  }
}

export async function testNewsDigest(): Promise<{ success: boolean; message: string; newsCount: number }> {
  try {
    const result = await sendDailyNewsDigest();
    return { 
      success: result.sent, 
      message: result.sent ? "News digest sent" : "No news available or FINNHUB_API_KEY not configured",
      newsCount: result.newsCount 
    };
  } catch (error: any) {
    return { success: false, message: error.message, newsCount: 0 };
  }
}
