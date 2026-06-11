import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Chat conversations for AI assistant
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  date: timestamp("date").notNull(),
  endDate: timestamp("end_date"),
  priority: text("priority").notNull().default("normal"),
  completed: boolean("completed").notNull().default(false),
  type: text("type").notNull().default("task"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  originalDate: timestamp("original_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// Weekly Reflection/Summary schema
export const weeklySummaries = pgTable("weekly_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  weekStart: timestamp("week_start").notNull(), // Monday of the week
  gratitude: text("gratitude").array(), // 3+ things grateful for
  completedAllTasks: boolean("completed_all_tasks"),
  tasksIncompleteReason: text("tasks_incomplete_reason"),
  talkedToFamily: boolean("talked_to_family"),
  wentOutWithFriend: boolean("went_out_with_friend"),
  learnedThisWeek: text("learned_this_week"),
  exercisedThreePlus: boolean("exercised_three_plus"),
  helpedSomeone: boolean("helped_someone"),
  biggestAchievement: text("biggest_achievement"),
  hardestTask: text("hardest_task"),
  improvementsForNextWeek: text("improvements_for_next_week"),
  pendingTasks: text("pending_tasks"),
  mostProductiveThing: text("most_productive_thing"),
  nextWeekGoal: text("next_week_goal"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWeeklySummarySchema = createInsertSchema(weeklySummaries).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWeeklySummary = z.infer<typeof insertWeeklySummarySchema>;
export type WeeklySummary = typeof weeklySummaries.$inferSelect;

// Monthly Goals schema
export const monthlyGoals = pgTable("monthly_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  month: timestamp("month").notNull(), // First day of the month
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMonthlyGoalSchema = createInsertSchema(monthlyGoals).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertMonthlyGoal = z.infer<typeof insertMonthlyGoalSchema>;
export type MonthlyGoal = typeof monthlyGoals.$inferSelect;

// Yearly Goals schema
export const yearlyGoals = pgTable("yearly_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  year: text("year").notNull(), // e.g., "2026"
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertYearlyGoalSchema = createInsertSchema(yearlyGoals).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertYearlyGoal = z.infer<typeof insertYearlyGoalSchema>;
export type YearlyGoal = typeof yearlyGoals.$inferSelect;

// Weekly Tasks (quick tasks not on calendar)
export const weeklyTasks = pgTable("weekly_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  weekStart: timestamp("week_start").notNull(),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  carriedOver: boolean("carried_over").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWeeklyTaskSchema = createInsertSchema(weeklyTasks).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertWeeklyTask = z.infer<typeof insertWeeklyTaskSchema>;
export type WeeklyTask = typeof weeklyTasks.$inferSelect;

// Push Subscriptions for notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// Telegram configuration for notifications
export const telegramConfig = pgTable("telegram_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  chatId: text("chat_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTelegramConfigSchema = createInsertSchema(telegramConfig).omit({
  id: true,
  createdAt: true,
});

export type InsertTelegramConfig = z.infer<typeof insertTelegramConfigSchema>;
export type TelegramConfig = typeof telegramConfig.$inferSelect;

// ==================== FINANCE MODULE ====================

// Investment types
export type InvestmentType = "stock" | "crypto" | "etf" | "bond" | "fund";

// User investments/holdings
export const investments = pgTable("investments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  quantity: text("quantity").notNull(),
  avgBuyPrice: text("avg_buy_price").notNull(),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvestmentSchema = createInsertSchema(investments).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type Investment = typeof investments.$inferSelect;
export type InsertInvestment = z.infer<typeof insertInvestmentSchema>;

// Portfolio configuration (margin, settings)
export const portfolioConfig = pgTable("portfolio_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  marginUsed: text("margin_used").notNull().default("0"),
  marginTotal: text("margin_total").notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPortfolioConfigSchema = createInsertSchema(portfolioConfig).omit({
  id: true,
  userId: true,
  updatedAt: true,
});

export type PortfolioConfig = typeof portfolioConfig.$inferSelect;
export type InsertPortfolioConfig = z.infer<typeof insertPortfolioConfigSchema>;

// Transaction history
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  investmentId: varchar("investment_id").references(() => investments.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  type: text("type").notNull().$type<"buy" | "sell">(),
  quantity: text("quantity").notNull(),
  price: text("price").notNull(),
  totalValue: text("total_value").notNull(),
  currency: text("currency").notNull().default("USD"),
  date: timestamp("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// Watchlist
export const watchlist = pgTable("watchlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  targetPrice: text("target_price"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;

// Price alerts
export const priceAlerts = pgTable("price_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  condition: text("condition").notNull().$type<"above" | "below">(),
  targetPrice: text("target_price").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  triggered: boolean("triggered").notNull().default(false),
  triggeredAt: timestamp("triggered_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPriceAlertSchema = createInsertSchema(priceAlerts).omit({
  id: true,
  userId: true,
  triggered: true,
  triggeredAt: true,
  createdAt: true,
});

export type PriceAlert = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;

// Portfolio history for tracking daily values
export const portfolioHistory = pgTable("portfolio_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: timestamp("date").notNull(),
  totalValue: text("total_value").notNull(),
  stocksValue: text("stocks_value").notNull().default("0"),
  etfsValue: text("etfs_value").notNull().default("0"),
  cryptoValue: text("crypto_value").notNull().default("0"),
  bondsValue: text("bonds_value").notNull().default("0"),
  dailyChange: text("daily_change"),
  dailyChangePercent: text("daily_change_percent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPortfolioHistorySchema = createInsertSchema(portfolioHistory).omit({
  id: true,
  createdAt: true,
});

export type PortfolioHistory = typeof portfolioHistory.$inferSelect;
export type InsertPortfolioHistory = z.infer<typeof insertPortfolioHistorySchema>;

// User Profile Data - stores personal information the assistant learns about the user
export const userProfileData = pgTable("user_profile_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(), // e.g., "personal", "work", "preferences", "family", "hobbies"
  key: text("key").notNull(), // e.g., "nombre", "cumpleaños", "trabajo", "pareja"
  value: text("value").notNull(), // the actual information
  confidence: text("confidence").default("confirmed"), // "confirmed" or "inferred"
  source: text("source").default("conversation"), // "conversation", "manual", "system"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserProfileDataSchema = createInsertSchema(userProfileData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserProfileData = typeof userProfileData.$inferSelect;
export type InsertUserProfileData = z.infer<typeof insertUserProfileDataSchema>;

// ==================== PROJECT MONITORING ====================

// Monitored projects/deployments
export const monitoredProjects = pgTable("monitored_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  githubRepo: text("github_repo"), // e.g., "username/repo-name"
  status: text("status").notNull().default("unknown").$type<"online" | "offline" | "unknown" | "degraded">(),
  lastCheck: timestamp("last_check"),
  lastOnline: timestamp("last_online"),
  responseTime: integer("response_time"), // in milliseconds
  checkInterval: integer("check_interval").notNull().default(5), // in minutes
  notifyOnDown: boolean("notify_on_down").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMonitoredProjectSchema = createInsertSchema(monitoredProjects).omit({
  id: true,
  userId: true,
  status: true,
  lastCheck: true,
  lastOnline: true,
  responseTime: true,
  createdAt: true,
  updatedAt: true,
});

export type MonitoredProject = typeof monitoredProjects.$inferSelect;
export type InsertMonitoredProject = z.infer<typeof insertMonitoredProjectSchema>;

// Health check history/logs
export const healthCheckLogs = pgTable("health_check_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => monitoredProjects.id, { onDelete: "cascade" }),
  status: text("status").notNull().$type<"online" | "offline" | "degraded">(),
  responseTime: integer("response_time"), // in milliseconds
  statusCode: integer("status_code"),
  errorMessage: text("error_message"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

export const insertHealthCheckLogSchema = createInsertSchema(healthCheckLogs).omit({
  id: true,
  checkedAt: true,
});

export type HealthCheckLog = typeof healthCheckLogs.$inferSelect;
export type InsertHealthCheckLog = z.infer<typeof insertHealthCheckLogSchema>;

// Downtime incidents
export const incidents = pgTable("incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => monitoredProjects.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  duration: integer("duration"), // in seconds
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIncidentSchema = createInsertSchema(incidents).omit({
  id: true,
  resolvedAt: true,
  duration: true,
  createdAt: true,
});

export type Incident = typeof incidents.$inferSelect;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;

// GitHub connection info (for when user connects later)
export const githubConnections = pgTable("github_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  accessToken: text("access_token"),
  username: text("username"),
  connected: boolean("connected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type GitHubConnection = typeof githubConnections.$inferSelect;

// ==================== DJ CONTACTS (for Radio automation) ====================

export const djContacts = pgTable("dj_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  instagramHandle: text("instagram_handle"),
  email: text("email"),
  genre: text("genre"), // e.g., "techno", "house", "ambient"
  location: text("location"),
  lastContacted: timestamp("last_contacted"),
  lastPerformance: timestamp("last_performance"),
  notes: text("notes"),
  rating: integer("rating"), // 1-5 stars based on performance
  status: text("status").default("available").$type<"available" | "contacted" | "confirmed" | "declined" | "inactive">(),
  driveLink: text("drive_link"), // link to their music/sets
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDjContactSchema = createInsertSchema(djContacts).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type DjContact = typeof djContacts.$inferSelect;
export type InsertDjContact = z.infer<typeof insertDjContactSchema>;

// ==================== AGENT ACTIONS (autonomous task execution) ====================

export const agentActions = pgTable("agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull().$type<"radio_dj_search" | "radio_message_draft" | "portfolio_analysis" | "portfolio_rebalance" | "task_reminder" | "weekly_report">(),
  status: text("status").notNull().default("pending").$type<"pending" | "in_progress" | "completed" | "failed" | "needs_approval">(),
  description: text("description").notNull(),
  input: jsonb("input"), // input data for the action
  output: jsonb("output"), // result of the action
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at"),
  scheduledFor: timestamp("scheduled_for"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentActionSchema = createInsertSchema(agentActions).omit({
  id: true,
  userId: true,
  status: true,
  approvedAt: true,
  executedAt: true,
  createdAt: true,
});

export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = z.infer<typeof insertAgentActionSchema>;

// ==================== DJ MESSAGE TEMPLATES ====================

export const djMessageTemplates = pgTable("dj_message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  template: text("template").notNull(), // template with {{variables}}
  language: text("language").default("es"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDjMessageTemplateSchema = createInsertSchema(djMessageTemplates).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type DjMessageTemplate = typeof djMessageTemplates.$inferSelect;
export type InsertDjMessageTemplate = z.infer<typeof insertDjMessageTemplateSchema>;

// Scheduled Reminders - user-configured recurring notifications
export const scheduledReminders = pgTable("scheduled_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  message: text("message").notNull(),
  hour: integer("hour").notNull(), // 0-23
  minute: integer("minute").notNull().default(0), // 0-59
  daysOfWeek: text("days_of_week").array(), // ["monday", "tuesday", ...] or null for every day
  isActive: boolean("is_active").notNull().default(true),
  lastSent: timestamp("last_sent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertScheduledReminderSchema = createInsertSchema(scheduledReminders).omit({
  id: true,
  userId: true,
  lastSent: true,
  createdAt: true,
});

export type ScheduledReminder = typeof scheduledReminders.$inferSelect;
export type InsertScheduledReminder = z.infer<typeof insertScheduledReminderSchema>;
