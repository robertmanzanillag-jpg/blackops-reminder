import { type User, type InsertUser, type Task, type InsertTask, type WeeklySummary, type InsertWeeklySummary, type MonthlyGoal, type InsertMonthlyGoal, type YearlyGoal, type InsertYearlyGoal, type WeeklyTask, type InsertWeeklyTask, type PushSubscription, type InsertPushSubscription, type TelegramConfig, type InsertTelegramConfig, type Investment, type InsertInvestment, type Transaction, type InsertTransaction, type WatchlistItem, type InsertWatchlistItem, type PriceAlert, type InsertPriceAlert, type UserProfileData, type InsertUserProfileData, type MonitoredProject, type InsertMonitoredProject, type HealthCheckLog, type InsertHealthCheckLog, type Incident, type InsertIncident, type PortfolioHistory, type InsertPortfolioHistory, type DjContact, type InsertDjContact, type AgentAction, type InsertAgentAction, type DjMessageTemplate, type InsertDjMessageTemplate, type ScheduledReminder, type InsertScheduledReminder } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { tasks as tasksTable, users as usersTable, weeklySummaries as weeklySummariesTable, monthlyGoals as monthlyGoalsTable, yearlyGoals as yearlyGoalsTable, weeklyTasks as weeklyTasksTable, pushSubscriptions as pushSubscriptionsTable, telegramConfig as telegramConfigTable, investments as investmentsTable, transactions as transactionsTable, watchlist as watchlistTable, priceAlerts as priceAlertsTable, userProfileData as userProfileDataTable, monitoredProjects as monitoredProjectsTable, healthCheckLogs as healthCheckLogsTable, incidents as incidentsTable, portfolioHistory as portfolioHistoryTable, djContacts as djContactsTable, agentActions as agentActionsTable, djMessageTemplates as djMessageTemplatesTable, scheduledReminders as scheduledRemindersTable, portfolioConfig as portfolioConfigTable } from "@shared/schema";
import { eq, and, desc, gte, lt, isNull } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Task operations
  getTasks(userId: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(userId: string, task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  deleteTasksByTitle(userId: string, title: string): Promise<number>;
  deduplicateMainTasks(userId: string): Promise<number>;

  // Weekly Summary operations
  getWeeklySummaries(userId: string): Promise<WeeklySummary[]>;
  getWeeklySummary(userId: string, weekStart: Date): Promise<WeeklySummary | undefined>;
  createWeeklySummary(userId: string, summary: InsertWeeklySummary): Promise<WeeklySummary>;
  updateWeeklySummary(id: string, summary: Partial<InsertWeeklySummary>): Promise<WeeklySummary>;

  // Monthly Goals operations
  getMonthlyGoals(userId: string, month: Date): Promise<MonthlyGoal[]>;
  getAllMonthlyGoals(userId: string): Promise<MonthlyGoal[]>;
  createMonthlyGoal(userId: string, goal: InsertMonthlyGoal): Promise<MonthlyGoal>;
  updateMonthlyGoal(id: string, updates: Partial<InsertMonthlyGoal>): Promise<MonthlyGoal>;
  deleteMonthlyGoal(id: string): Promise<void>;

  // Yearly Goals operations
  getYearlyGoals(userId: string, year: string): Promise<YearlyGoal[]>;
  createYearlyGoal(userId: string, goal: InsertYearlyGoal): Promise<YearlyGoal>;
  updateYearlyGoal(id: string, updates: Partial<InsertYearlyGoal>): Promise<YearlyGoal>;
  deleteYearlyGoal(id: string): Promise<void>;

  // Weekly Tasks operations
  getWeeklyTasks(userId: string, weekStart: Date): Promise<WeeklyTask[]>;
  getWeeklyTaskById(id: string): Promise<WeeklyTask | undefined>;
  getRecurringTasks(userId: string): Promise<WeeklyTask[]>;
  getPreviousWeekIncompleteTasks(userId: string, currentWeekStart: Date): Promise<WeeklyTask[]>;
  createWeeklyTask(userId: string, task: InsertWeeklyTask): Promise<WeeklyTask>;
  updateWeeklyTask(id: string, updates: Partial<InsertWeeklyTask>): Promise<WeeklyTask>;
  deleteWeeklyTask(id: string): Promise<void>;
  deduplicateRecurringTasks(userId: string): Promise<number>;

  // Push Subscriptions operations
  getPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;
  createPushSubscription(userId: string, sub: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;

  // Telegram Config operations
  getTelegramConfig(userId: string): Promise<TelegramConfig | undefined>;
  saveTelegramConfig(userId: string, chatId: string): Promise<TelegramConfig>;
  updateTelegramConfig(userId: string, enabled: boolean): Promise<TelegramConfig | undefined>;
  deleteTelegramConfig(userId: string): Promise<void>;

  // Investment operations
  getInvestments(userId: string): Promise<Investment[]>;
  getInvestment(id: string): Promise<Investment | undefined>;
  createInvestment(userId: string, investment: InsertInvestment): Promise<Investment>;
  updateInvestment(id: string, updates: Partial<InsertInvestment>): Promise<Investment>;
  deleteInvestment(id: string): Promise<void>;
  
  // Portfolio config operations
  getPortfolioConfig(userId: string): Promise<{ marginUsed: string; marginTotal: string } | undefined>;
  updatePortfolioConfig(userId: string, marginUsed: string, marginTotal: string): Promise<void>;

  // Transaction operations
  getTransactions(userId: string): Promise<Transaction[]>;
  createTransaction(userId: string, transaction: InsertTransaction): Promise<Transaction>;

  // Watchlist operations
  getWatchlist(userId: string): Promise<WatchlistItem[]>;
  addToWatchlist(userId: string, item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: string): Promise<void>;

  // Price Alert operations
  getPriceAlerts(userId: string): Promise<PriceAlert[]>;
  createPriceAlert(userId: string, alert: InsertPriceAlert): Promise<PriceAlert>;
  updatePriceAlert(id: string, updates: Partial<InsertPriceAlert>): Promise<PriceAlert>;
  deletePriceAlert(id: string): Promise<void>;

  // User Profile Data operations
  getUserProfileData(userId: string): Promise<UserProfileData[]>;
  getUserProfileDataByCategory(userId: string, category: string): Promise<UserProfileData[]>;
  getUserProfileDataByKey(userId: string, key: string): Promise<UserProfileData | undefined>;
  saveUserProfileData(userId: string, data: InsertUserProfileData): Promise<UserProfileData>;
  updateUserProfileData(id: string, updates: Partial<InsertUserProfileData>): Promise<UserProfileData>;
  deleteUserProfileData(id: string): Promise<void>;

  // Monitored Projects operations
  getMonitoredProjects(userId: string): Promise<MonitoredProject[]>;
  getAllMonitoredProjects(): Promise<MonitoredProject[]>;
  getMonitoredProject(id: string): Promise<MonitoredProject | undefined>;
  createMonitoredProject(userId: string, project: InsertMonitoredProject): Promise<MonitoredProject>;
  updateMonitoredProject(id: string, updates: Partial<MonitoredProject>): Promise<MonitoredProject>;
  deleteMonitoredProject(id: string): Promise<void>;

  // Health Check Log operations
  getHealthCheckLogs(projectId: string, limit?: number): Promise<HealthCheckLog[]>;
  createHealthCheckLog(log: InsertHealthCheckLog): Promise<HealthCheckLog>;

  // Incident operations
  getIncidents(projectId: string): Promise<Incident[]>;
  getActiveIncident(projectId: string): Promise<Incident | undefined>;
  createIncident(incident: InsertIncident): Promise<Incident>;
  resolveIncident(id: string): Promise<Incident>;

  // Portfolio History operations
  getPortfolioHistory(userId: string, days?: number): Promise<PortfolioHistory[]>;
  createPortfolioSnapshot(userId: string, snapshot: InsertPortfolioHistory): Promise<PortfolioHistory>;
  getLatestPortfolioSnapshot(userId: string): Promise<PortfolioHistory | undefined>;

  // DJ Contact operations
  getDjContacts(userId: string): Promise<DjContact[]>;
  getDjContact(id: string): Promise<DjContact | undefined>;
  getAvailableDjContacts(userId: string): Promise<DjContact[]>;
  createDjContact(userId: string, contact: InsertDjContact): Promise<DjContact>;
  updateDjContact(id: string, updates: Partial<InsertDjContact>): Promise<DjContact>;
  deleteDjContact(id: string): Promise<void>;

  // Agent Action operations
  getAgentActions(userId: string): Promise<AgentAction[]>;
  getPendingAgentActions(userId: string): Promise<AgentAction[]>;
  createAgentAction(userId: string, action: InsertAgentAction): Promise<AgentAction>;
  updateAgentAction(id: string, updates: Partial<AgentAction>): Promise<AgentAction>;

  // DJ Message Template operations
  getDjMessageTemplates(userId: string): Promise<DjMessageTemplate[]>;
  createDjMessageTemplate(userId: string, template: InsertDjMessageTemplate): Promise<DjMessageTemplate>;
  getDefaultDjMessageTemplate(userId: string): Promise<DjMessageTemplate | undefined>;

  // Scheduled Reminder operations
  getScheduledReminders(userId: string): Promise<ScheduledReminder[]>;
  getActiveScheduledReminders(): Promise<ScheduledReminder[]>;
  createScheduledReminder(userId: string, reminder: InsertScheduledReminder): Promise<ScheduledReminder>;
  updateScheduledReminder(id: string, updates: Partial<ScheduledReminder>): Promise<ScheduledReminder>;
  deleteScheduledReminder(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
    };
    await db.insert(usersTable).values(user);
    return user;
  }

  async getTasks(userId: string): Promise<Task[]> {
    const results = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.userId, userId));
    return results;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const result = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);
    return result[0];
  }

  async createTask(userId: string, task: InsertTask): Promise<Task> {
    const id = randomUUID();
    const newTask: Task = {
      id,
      userId,
      title: task.title,
      description: task.description || null,
      date: task.date,
      endDate: task.endDate || null,
      priority: task.priority || "normal",
      completed: task.completed || false,
      type: task.type || "task",
      isRecurring: task.isRecurring ?? false,
      externalId: task.externalId || null,
      externalSource: task.externalSource || null,
      originalDate: task.originalDate || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(tasksTable).values(newTask);
    return newTask;
  }

  async deduplicateMainTasks(userId: string): Promise<number> {
    // Only deduplicate user-created tasks (no externalSource) — never touch Google Calendar events
    // which are identified by externalId and can legitimately share a title across dates
    const allTasks = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), isNull(tasksTable.externalSource)))
      .orderBy(desc(tasksTable.createdAt));

    const seen = new Set<string>();
    const idsToDelete: string[] = [];

    for (const task of allTasks) {
      if (seen.has(task.title)) {
        idsToDelete.push(task.id);
      } else {
        seen.add(task.title);
      }
    }

    for (const id of idsToDelete) {
      await db.delete(tasksTable).where(eq(tasksTable.id, id));
    }

    return idsToDelete.length;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    await db
      .update(tasksTable)
      .set(updateData)
      .where(eq(tasksTable.id, id));
    
    const result = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Task not found");
    return result[0];
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasksTable).where(eq(tasksTable.id, id));
  }

  async deleteTasksByTitle(userId: string, title: string): Promise<number> {
    const result = await db
      .delete(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.title, title)));
    return result.rowCount || 0;
  }

  async getWeeklySummaries(userId: string): Promise<WeeklySummary[]> {
    const results = await db
      .select()
      .from(weeklySummariesTable)
      .where(eq(weeklySummariesTable.userId, userId))
      .orderBy(desc(weeklySummariesTable.weekStart));
    return results;
  }

  async getWeeklySummary(userId: string, weekStart: Date): Promise<WeeklySummary | undefined> {
    const result = await db
      .select()
      .from(weeklySummariesTable)
      .where(
        and(
          eq(weeklySummariesTable.userId, userId),
          eq(weeklySummariesTable.weekStart, weekStart)
        )
      )
      .limit(1);
    return result[0];
  }

  async createWeeklySummary(userId: string, summary: InsertWeeklySummary): Promise<WeeklySummary> {
    const id = randomUUID();
    const newSummary: WeeklySummary = {
      id,
      userId,
      weekStart: summary.weekStart,
      gratitude: summary.gratitude || null,
      completedAllTasks: summary.completedAllTasks ?? null,
      tasksIncompleteReason: summary.tasksIncompleteReason || null,
      talkedToFamily: summary.talkedToFamily ?? null,
      wentOutWithFriend: summary.wentOutWithFriend ?? null,
      learnedThisWeek: summary.learnedThisWeek || null,
      exercisedThreePlus: summary.exercisedThreePlus ?? null,
      helpedSomeone: summary.helpedSomeone ?? null,
      biggestAchievement: summary.biggestAchievement || null,
      hardestTask: summary.hardestTask || null,
      improvementsForNextWeek: summary.improvementsForNextWeek || null,
      pendingTasks: summary.pendingTasks || null,
      mostProductiveThing: summary.mostProductiveThing || null,
      nextWeekGoal: summary.nextWeekGoal || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(weeklySummariesTable).values(newSummary);
    return newSummary;
  }

  async updateWeeklySummary(id: string, updates: Partial<InsertWeeklySummary>): Promise<WeeklySummary> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    await db
      .update(weeklySummariesTable)
      .set(updateData)
      .where(eq(weeklySummariesTable.id, id));
    
    const result = await db
      .select()
      .from(weeklySummariesTable)
      .where(eq(weeklySummariesTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Weekly summary not found");
    return result[0];
  }

  async getMonthlyGoals(userId: string, month: Date): Promise<MonthlyGoal[]> {
    const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    
    const results = await db
      .select()
      .from(monthlyGoalsTable)
      .where(
        and(
          eq(monthlyGoalsTable.userId, userId),
          gte(monthlyGoalsTable.month, startOfMonth),
          lt(monthlyGoalsTable.month, endOfMonth)
        )
      );
    return results;
  }

  async getAllMonthlyGoals(userId: string): Promise<MonthlyGoal[]> {
    const results = await db
      .select()
      .from(monthlyGoalsTable)
      .where(eq(monthlyGoalsTable.userId, userId))
      .orderBy(monthlyGoalsTable.month, monthlyGoalsTable.createdAt);
    return results;
  }

  async createMonthlyGoal(userId: string, goal: InsertMonthlyGoal): Promise<MonthlyGoal> {
    const id = randomUUID();
    const newGoal: MonthlyGoal = {
      id,
      userId,
      month: goal.month,
      title: goal.title,
      completed: goal.completed ?? false,
      createdAt: new Date(),
    };
    await db.insert(monthlyGoalsTable).values(newGoal);
    return newGoal;
  }

  async updateMonthlyGoal(id: string, updates: Partial<InsertMonthlyGoal>): Promise<MonthlyGoal> {
    await db
      .update(monthlyGoalsTable)
      .set(updates)
      .where(eq(monthlyGoalsTable.id, id));
    
    const result = await db
      .select()
      .from(monthlyGoalsTable)
      .where(eq(monthlyGoalsTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Monthly goal not found");
    return result[0];
  }

  async deleteMonthlyGoal(id: string): Promise<void> {
    await db.delete(monthlyGoalsTable).where(eq(monthlyGoalsTable.id, id));
  }

  async getYearlyGoals(userId: string, year: string): Promise<YearlyGoal[]> {
    const results = await db
      .select()
      .from(yearlyGoalsTable)
      .where(
        and(
          eq(yearlyGoalsTable.userId, userId),
          eq(yearlyGoalsTable.year, year)
        )
      );
    return results;
  }

  async createYearlyGoal(userId: string, goal: InsertYearlyGoal): Promise<YearlyGoal> {
    const id = randomUUID();
    const newGoal: YearlyGoal = {
      id,
      userId,
      year: goal.year,
      title: goal.title,
      completed: goal.completed ?? false,
      createdAt: new Date(),
    };
    await db.insert(yearlyGoalsTable).values(newGoal);
    return newGoal;
  }

  async updateYearlyGoal(id: string, updates: Partial<InsertYearlyGoal>): Promise<YearlyGoal> {
    await db
      .update(yearlyGoalsTable)
      .set(updates)
      .where(eq(yearlyGoalsTable.id, id));
    
    const result = await db
      .select()
      .from(yearlyGoalsTable)
      .where(eq(yearlyGoalsTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Yearly goal not found");
    return result[0];
  }

  async deleteYearlyGoal(id: string): Promise<void> {
    await db.delete(yearlyGoalsTable).where(eq(yearlyGoalsTable.id, id));
  }

  async getWeeklyTasks(userId: string, weekStart: Date): Promise<WeeklyTask[]> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          gte(weeklyTasksTable.weekStart, weekStart),
          lt(weeklyTasksTable.weekStart, weekEnd)
        )
      );
    return results;
  }

  async getWeeklyTaskById(id: string): Promise<WeeklyTask | undefined> {
    const result = await db
      .select()
      .from(weeklyTasksTable)
      .where(eq(weeklyTasksTable.id, id))
      .limit(1);
    return result[0];
  }

  async getRecurringTasks(userId: string): Promise<WeeklyTask[]> {
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.isRecurring, true)
        )
      );
    return results;
  }

  async createWeeklyTask(userId: string, task: InsertWeeklyTask): Promise<WeeklyTask> {
    const id = randomUUID();
    const newTask: WeeklyTask = {
      id,
      userId,
      weekStart: task.weekStart,
      title: task.title,
      completed: task.completed ?? false,
      isRecurring: task.isRecurring ?? false,
      carriedOver: task.carriedOver ?? false,
      createdAt: new Date(),
    };
    await db.insert(weeklyTasksTable).values(newTask);
    return newTask;
  }

  async updateWeeklyTask(id: string, updates: Partial<InsertWeeklyTask>): Promise<WeeklyTask> {
    await db
      .update(weeklyTasksTable)
      .set(updates)
      .where(eq(weeklyTasksTable.id, id));
    
    const result = await db
      .select()
      .from(weeklyTasksTable)
      .where(eq(weeklyTasksTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Weekly task not found");
    return result[0];
  }

  async getPreviousWeekIncompleteTasks(userId: string, currentWeekStart: Date): Promise<WeeklyTask[]> {
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(currentWeekStart);
    
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.completed, false),
          eq(weeklyTasksTable.isRecurring, false),
          gte(weeklyTasksTable.weekStart, prevWeekStart),
          lt(weeklyTasksTable.weekStart, prevWeekEnd)
        )
      );
    return results;
  }

  async deduplicateRecurringTasks(userId: string): Promise<number> {
    const allRecurring = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.isRecurring, true)
        )
      )
      .orderBy(weeklyTasksTable.createdAt);

    const seen = new Map<string, string>();
    const idsToDelete: string[] = [];

    for (const task of allRecurring) {
      if (seen.has(task.title)) {
        idsToDelete.push(task.id);
      } else {
        seen.set(task.title, task.id);
      }
    }

    if (idsToDelete.length > 0) {
      for (const id of idsToDelete) {
        await db.delete(weeklyTasksTable).where(eq(weeklyTasksTable.id, id));
      }
    }

    return idsToDelete.length;
  }

  async deleteWeeklyTask(id: string): Promise<void> {
    await db.delete(weeklyTasksTable).where(eq(weeklyTasksTable.id, id));
  }

  // Push Subscriptions
  async getPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    const results = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
    return results;
  }

  async getAllPushSubscriptions(): Promise<PushSubscription[]> {
    const results = await db.select().from(pushSubscriptionsTable);
    return results;
  }

  async createPushSubscription(userId: string, sub: InsertPushSubscription): Promise<PushSubscription> {
    const id = randomUUID();
    const newSub: PushSubscription = {
      id,
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      createdAt: new Date(),
    };
    await db.insert(pushSubscriptionsTable).values(newSub);
    return newSub;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  }

  // Telegram Config
  async getTelegramConfig(userId: string): Promise<TelegramConfig | undefined> {
    const result = await db
      .select()
      .from(telegramConfigTable)
      .where(eq(telegramConfigTable.userId, userId))
      .limit(1);
    return result[0];
  }

  async saveTelegramConfig(userId: string, chatId: string): Promise<TelegramConfig> {
    const existing = await this.getTelegramConfig(userId);
    if (existing) {
      const [updated] = await db
        .update(telegramConfigTable)
        .set({ chatId, enabled: true })
        .where(eq(telegramConfigTable.userId, userId))
        .returning();
      return updated;
    }
    const id = randomUUID();
    const newConfig: TelegramConfig = {
      id,
      userId,
      chatId,
      enabled: true,
      createdAt: new Date(),
    };
    await db.insert(telegramConfigTable).values(newConfig);
    return newConfig;
  }

  async updateTelegramConfig(userId: string, enabled: boolean): Promise<TelegramConfig | undefined> {
    const [updated] = await db
      .update(telegramConfigTable)
      .set({ enabled })
      .where(eq(telegramConfigTable.userId, userId))
      .returning();
    return updated;
  }

  async deleteTelegramConfig(userId: string): Promise<void> {
    await db.delete(telegramConfigTable).where(eq(telegramConfigTable.userId, userId));
  }

  // ==================== INVESTMENTS ====================

  async getInvestments(userId: string): Promise<Investment[]> {
    return await db
      .select()
      .from(investmentsTable)
      .where(eq(investmentsTable.userId, userId))
      .orderBy(desc(investmentsTable.createdAt));
  }

  async getInvestment(id: string): Promise<Investment | undefined> {
    const result = await db
      .select()
      .from(investmentsTable)
      .where(eq(investmentsTable.id, id))
      .limit(1);
    return result[0];
  }

  async createInvestment(userId: string, investment: InsertInvestment): Promise<Investment> {
    const id = randomUUID();
    const now = new Date();
    const newInvestment = {
      id,
      userId,
      symbol: investment.symbol,
      name: investment.name,
      type: investment.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      quantity: investment.quantity,
      avgBuyPrice: investment.avgBuyPrice,
      currency: investment.currency || "USD",
      notes: investment.notes || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(investmentsTable).values(newInvestment);
    return newInvestment as Investment;
  }

  async updateInvestment(id: string, updates: Partial<InsertInvestment>): Promise<Investment> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    const [updated] = await db
      .update(investmentsTable)
      .set(updateData)
      .where(eq(investmentsTable.id, id))
      .returning();
    return updated;
  }

  async deleteInvestment(id: string): Promise<void> {
    await db.delete(investmentsTable).where(eq(investmentsTable.id, id));
  }

  // ==================== PORTFOLIO CONFIG ====================

  async getPortfolioConfig(userId: string): Promise<{ marginUsed: string; marginTotal: string } | undefined> {
    const result = await db
      .select()
      .from(portfolioConfigTable)
      .where(eq(portfolioConfigTable.userId, userId))
      .limit(1);
    
    if (result.length === 0) {
      return undefined;
    }
    
    return {
      marginUsed: result[0].marginUsed,
      marginTotal: result[0].marginTotal,
    };
  }

  async updatePortfolioConfig(userId: string, marginUsed: string, marginTotal: string): Promise<void> {
    const existing = await this.getPortfolioConfig(userId);
    
    if (existing) {
      await db
        .update(portfolioConfigTable)
        .set({ marginUsed, marginTotal, updatedAt: new Date() })
        .where(eq(portfolioConfigTable.userId, userId));
    } else {
      await db.insert(portfolioConfigTable).values({
        id: randomUUID(),
        userId,
        marginUsed,
        marginTotal,
        updatedAt: new Date(),
      });
    }
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, userId))
      .orderBy(desc(transactionsTable.date));
  }

  async createTransaction(userId: string, transaction: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const newTransaction = {
      id,
      userId,
      investmentId: transaction.investmentId || null,
      symbol: transaction.symbol,
      type: transaction.type as "buy" | "sell",
      quantity: transaction.quantity,
      price: transaction.price,
      totalValue: transaction.totalValue,
      currency: transaction.currency || "USD",
      date: transaction.date,
      notes: transaction.notes || null,
      createdAt: new Date(),
    };
    await db.insert(transactionsTable).values(newTransaction);
    return newTransaction as Transaction;
  }

  // ==================== WATCHLIST ====================

  async getWatchlist(userId: string): Promise<WatchlistItem[]> {
    return await db
      .select()
      .from(watchlistTable)
      .where(eq(watchlistTable.userId, userId))
      .orderBy(desc(watchlistTable.createdAt));
  }

  async addToWatchlist(userId: string, item: InsertWatchlistItem): Promise<WatchlistItem> {
    const id = randomUUID();
    const newItem = {
      id,
      userId,
      symbol: item.symbol,
      name: item.name,
      type: item.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      targetPrice: item.targetPrice || null,
      notes: item.notes || null,
      createdAt: new Date(),
    };
    await db.insert(watchlistTable).values(newItem);
    return newItem as WatchlistItem;
  }

  async removeFromWatchlist(id: string): Promise<void> {
    await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
  }

  // ==================== PRICE ALERTS ====================

  async getPriceAlerts(userId: string): Promise<PriceAlert[]> {
    return await db
      .select()
      .from(priceAlertsTable)
      .where(eq(priceAlertsTable.userId, userId))
      .orderBy(desc(priceAlertsTable.createdAt));
  }

  async createPriceAlert(userId: string, alert: InsertPriceAlert): Promise<PriceAlert> {
    const id = randomUUID();
    const newAlert = {
      id,
      userId,
      symbol: alert.symbol,
      type: alert.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      condition: alert.condition as "above" | "below",
      targetPrice: alert.targetPrice,
      enabled: alert.enabled ?? true,
      triggered: false,
      triggeredAt: null,
      createdAt: new Date(),
    };
    await db.insert(priceAlertsTable).values(newAlert);
    return newAlert as PriceAlert;
  }

  async updatePriceAlert(id: string, updates: Partial<InsertPriceAlert>): Promise<PriceAlert> {
    const updateData: any = { ...updates };
    const [updated] = await db
      .update(priceAlertsTable)
      .set(updateData)
      .where(eq(priceAlertsTable.id, id))
      .returning();
    return updated;
  }

  async deletePriceAlert(id: string): Promise<void> {
    await db.delete(priceAlertsTable).where(eq(priceAlertsTable.id, id));
  }

  // User Profile Data methods
  async getUserProfileData(userId: string): Promise<UserProfileData[]> {
    return db
      .select()
      .from(userProfileDataTable)
      .where(eq(userProfileDataTable.userId, userId))
      .orderBy(desc(userProfileDataTable.updatedAt));
  }

  async getUserProfileDataByCategory(userId: string, category: string): Promise<UserProfileData[]> {
    return db
      .select()
      .from(userProfileDataTable)
      .where(and(
        eq(userProfileDataTable.userId, userId),
        eq(userProfileDataTable.category, category)
      ))
      .orderBy(desc(userProfileDataTable.updatedAt));
  }

  async getUserProfileDataByKey(userId: string, key: string): Promise<UserProfileData | undefined> {
    const [result] = await db
      .select()
      .from(userProfileDataTable)
      .where(and(
        eq(userProfileDataTable.userId, userId),
        eq(userProfileDataTable.key, key)
      ))
      .limit(1);
    return result;
  }

  async saveUserProfileData(userId: string, data: InsertUserProfileData): Promise<UserProfileData> {
    // Check if key already exists for this user
    const existing = await this.getUserProfileDataByKey(userId, data.key);
    if (existing) {
      // Update existing record
      const [updated] = await db
        .update(userProfileDataTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userProfileDataTable.id, existing.id))
        .returning();
      return updated;
    }
    // Create new record
    const id = randomUUID();
    const newData = {
      id,
      userId,
      category: data.category,
      key: data.key,
      value: data.value,
      confidence: data.confidence || "confirmed",
      source: data.source || "conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(userProfileDataTable).values(newData);
    return newData as UserProfileData;
  }

  async updateUserProfileData(id: string, updates: Partial<InsertUserProfileData>): Promise<UserProfileData> {
    const [updated] = await db
      .update(userProfileDataTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userProfileDataTable.id, id))
      .returning();
    return updated;
  }

  async deleteUserProfileData(id: string): Promise<void> {
    await db.delete(userProfileDataTable).where(eq(userProfileDataTable.id, id));
  }

  // ==================== MONITORED PROJECTS ====================

  async getMonitoredProjects(userId: string): Promise<MonitoredProject[]> {
    return await db
      .select()
      .from(monitoredProjectsTable)
      .where(eq(monitoredProjectsTable.userId, userId))
      .orderBy(desc(monitoredProjectsTable.createdAt));
  }

  async getAllMonitoredProjects(): Promise<MonitoredProject[]> {
    return await db
      .select()
      .from(monitoredProjectsTable)
      .orderBy(desc(monitoredProjectsTable.createdAt));
  }

  async getMonitoredProject(id: string): Promise<MonitoredProject | undefined> {
    const [result] = await db
      .select()
      .from(monitoredProjectsTable)
      .where(eq(monitoredProjectsTable.id, id))
      .limit(1);
    return result;
  }

  async createMonitoredProject(userId: string, project: InsertMonitoredProject): Promise<MonitoredProject> {
    const id = randomUUID();
    const now = new Date();
    const newProject = {
      id,
      userId,
      name: project.name,
      url: project.url,
      description: project.description || null,
      githubRepo: project.githubRepo || null,
      status: "unknown" as const,
      lastCheck: null,
      lastOnline: null,
      responseTime: null,
      checkInterval: project.checkInterval || 5,
      notifyOnDown: project.notifyOnDown ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(monitoredProjectsTable).values(newProject);
    return newProject as MonitoredProject;
  }

  async updateMonitoredProject(id: string, updates: Partial<MonitoredProject>): Promise<MonitoredProject> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    const [updated] = await db
      .update(monitoredProjectsTable)
      .set(updateData)
      .where(eq(monitoredProjectsTable.id, id))
      .returning();
    return updated;
  }

  async deleteMonitoredProject(id: string): Promise<void> {
    await db.delete(monitoredProjectsTable).where(eq(monitoredProjectsTable.id, id));
  }

  // ==================== HEALTH CHECK LOGS ====================

  async getHealthCheckLogs(projectId: string, limit: number = 100): Promise<HealthCheckLog[]> {
    return await db
      .select()
      .from(healthCheckLogsTable)
      .where(eq(healthCheckLogsTable.projectId, projectId))
      .orderBy(desc(healthCheckLogsTable.checkedAt))
      .limit(limit);
  }

  async createHealthCheckLog(log: InsertHealthCheckLog): Promise<HealthCheckLog> {
    const id = randomUUID();
    const newLog = {
      id,
      projectId: log.projectId,
      status: log.status as "online" | "offline" | "degraded",
      responseTime: log.responseTime || null,
      statusCode: log.statusCode || null,
      errorMessage: log.errorMessage || null,
      checkedAt: new Date(),
    };
    await db.insert(healthCheckLogsTable).values(newLog);
    return newLog as HealthCheckLog;
  }

  // ==================== INCIDENTS ====================

  async getIncidents(projectId: string): Promise<Incident[]> {
    return await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.projectId, projectId))
      .orderBy(desc(incidentsTable.startedAt));
  }

  async getActiveIncident(projectId: string): Promise<Incident | undefined> {
    const [result] = await db
      .select()
      .from(incidentsTable)
      .where(and(
        eq(incidentsTable.projectId, projectId),
        isNull(incidentsTable.resolvedAt)
      ))
      .limit(1);
    return result;
  }

  async createIncident(incident: InsertIncident): Promise<Incident> {
    const id = randomUUID();
    const newIncident = {
      id,
      projectId: incident.projectId,
      startedAt: incident.startedAt,
      resolvedAt: null,
      duration: null,
      notified: incident.notified ?? false,
      createdAt: new Date(),
    };
    await db.insert(incidentsTable).values(newIncident);
    return newIncident as Incident;
  }

  async resolveIncident(id: string): Promise<Incident> {
    const [incident] = await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, id))
      .limit(1);
    
    if (!incident) throw new Error("Incident not found");
    
    const resolvedAt = new Date();
    const duration = Math.floor((resolvedAt.getTime() - incident.startedAt.getTime()) / 1000);
    
    const [updated] = await db
      .update(incidentsTable)
      .set({ resolvedAt, duration })
      .where(eq(incidentsTable.id, id))
      .returning();
    return updated;
  }

  async getPortfolioHistory(userId: string, days: number = 30): Promise<PortfolioHistory[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const result = await db
      .select()
      .from(portfolioHistoryTable)
      .where(
        and(
          eq(portfolioHistoryTable.userId, userId),
          gte(portfolioHistoryTable.date, startDate)
        )
      )
      .orderBy(portfolioHistoryTable.date);
    return result;
  }

  async createPortfolioSnapshot(userId: string, snapshot: InsertPortfolioHistory): Promise<PortfolioHistory> {
    const id = randomUUID();
    const newSnapshot = { ...snapshot, id, userId };
    await db.insert(portfolioHistoryTable).values(newSnapshot);
    return newSnapshot as PortfolioHistory;
  }

  async getLatestPortfolioSnapshot(userId: string): Promise<PortfolioHistory | undefined> {
    const result = await db
      .select()
      .from(portfolioHistoryTable)
      .where(eq(portfolioHistoryTable.userId, userId))
      .orderBy(desc(portfolioHistoryTable.date))
      .limit(1);
    return result[0];
  }

  // DJ Contact operations
  async getDjContacts(userId: string): Promise<DjContact[]> {
    return db.select().from(djContactsTable).where(eq(djContactsTable.userId, userId));
  }

  async getDjContact(id: string): Promise<DjContact | undefined> {
    const result = await db.select().from(djContactsTable).where(eq(djContactsTable.id, id)).limit(1);
    return result[0];
  }

  async getAvailableDjContacts(userId: string): Promise<DjContact[]> {
    return db.select().from(djContactsTable).where(
      and(eq(djContactsTable.userId, userId), eq(djContactsTable.status, "available"))
    );
  }

  async createDjContact(userId: string, contact: InsertDjContact): Promise<DjContact> {
    const id = randomUUID();
    const newContact = { 
      id, 
      userId, 
      name: contact.name,
      instagramHandle: contact.instagramHandle || null,
      email: contact.email || null,
      genre: contact.genre || null,
      location: contact.location || null,
      lastContacted: contact.lastContacted || null,
      lastPerformance: contact.lastPerformance || null,
      notes: contact.notes || null,
      rating: contact.rating || null,
      status: (contact.status || "available") as "available" | "contacted" | "confirmed" | "declined" | "inactive",
      driveLink: contact.driveLink || null,
      createdAt: new Date(), 
      updatedAt: new Date() 
    };
    await db.insert(djContactsTable).values(newContact);
    return newContact;
  }

  async updateDjContact(id: string, updates: Partial<InsertDjContact>): Promise<DjContact> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    await db.update(djContactsTable).set(updateData).where(eq(djContactsTable.id, id));
    const result = await db.select().from(djContactsTable).where(eq(djContactsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("DJ Contact not found");
    return result[0];
  }

  async deleteDjContact(id: string): Promise<void> {
    await db.delete(djContactsTable).where(eq(djContactsTable.id, id));
  }

  // Agent Action operations
  async getAgentActions(userId: string): Promise<AgentAction[]> {
    return db.select().from(agentActionsTable).where(eq(agentActionsTable.userId, userId)).orderBy(desc(agentActionsTable.createdAt));
  }

  async getPendingAgentActions(userId: string): Promise<AgentAction[]> {
    return db.select().from(agentActionsTable).where(
      and(eq(agentActionsTable.userId, userId), eq(agentActionsTable.status, "pending"))
    );
  }

  async createAgentAction(userId: string, action: InsertAgentAction): Promise<AgentAction> {
    const id = randomUUID();
    const newAction = { 
      id, 
      userId, 
      type: action.type as "radio_dj_search" | "radio_message_draft" | "portfolio_analysis" | "portfolio_rebalance" | "task_reminder" | "weekly_report",
      status: "pending" as "pending" | "in_progress" | "completed" | "failed" | "needs_approval",
      description: action.description,
      input: action.input || null,
      output: action.output || null,
      requiresApproval: action.requiresApproval || false,
      approvedAt: null,
      executedAt: null,
      scheduledFor: action.scheduledFor || null,
      createdAt: new Date() 
    };
    await db.insert(agentActionsTable).values(newAction);
    return newAction;
  }

  async updateAgentAction(id: string, updates: Partial<AgentAction>): Promise<AgentAction> {
    await db.update(agentActionsTable).set(updates).where(eq(agentActionsTable.id, id));
    const result = await db.select().from(agentActionsTable).where(eq(agentActionsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("Agent Action not found");
    return result[0];
  }

  // DJ Message Template operations
  async getDjMessageTemplates(userId: string): Promise<DjMessageTemplate[]> {
    return db.select().from(djMessageTemplatesTable).where(eq(djMessageTemplatesTable.userId, userId));
  }

  async createDjMessageTemplate(userId: string, template: InsertDjMessageTemplate): Promise<DjMessageTemplate> {
    const id = randomUUID();
    const newTemplate = { ...template, id, userId, createdAt: new Date() };
    await db.insert(djMessageTemplatesTable).values(newTemplate);
    return newTemplate as DjMessageTemplate;
  }

  async getDefaultDjMessageTemplate(userId: string): Promise<DjMessageTemplate | undefined> {
    const result = await db.select().from(djMessageTemplatesTable).where(
      and(eq(djMessageTemplatesTable.userId, userId), eq(djMessageTemplatesTable.isDefault, true))
    ).limit(1);
    return result[0];
  }

  async getScheduledReminders(userId: string): Promise<ScheduledReminder[]> {
    return await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.userId, userId));
  }

  async getActiveScheduledReminders(): Promise<ScheduledReminder[]> {
    return await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.isActive, true));
  }

  async createScheduledReminder(userId: string, reminder: InsertScheduledReminder): Promise<ScheduledReminder> {
    const id = randomUUID();
    const newReminder = { ...reminder, id, userId, createdAt: new Date() };
    await db.insert(scheduledRemindersTable).values(newReminder);
    return newReminder as ScheduledReminder;
  }

  async updateScheduledReminder(id: string, updates: Partial<ScheduledReminder>): Promise<ScheduledReminder> {
    await db.update(scheduledRemindersTable).set(updates).where(eq(scheduledRemindersTable.id, id));
    const result = await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.id, id)).limit(1);
    return result[0];
  }

  async deleteScheduledReminder(id: string): Promise<void> {
    await db.delete(scheduledRemindersTable).where(eq(scheduledRemindersTable.id, id));
  }
}

export const storage = new DatabaseStorage();
