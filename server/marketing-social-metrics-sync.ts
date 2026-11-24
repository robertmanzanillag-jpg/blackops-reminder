import { createHash } from "node:crypto";
import { resolveSocialAnalyticsProvider, type PostAnalytics, type SocialAnalyticsProvider } from "./social-analytics/provider";

/**
 * Daily, read-only refresh of organic TikTok post metrics into the
 * marketing-cmo `social_metrics` source, through the provider seam in
 * server/social-analytics/ (SOCIAL_ANALYTICS_PROVIDER, default "metricool";
 * Metricool uses the REST GET /api/v2/analytics/posts/tiktok). It never
 * schedules posts, never touches ads and never spends money.
 * Missing credentials or a failed fetch record nothing (the source stays stale
 * or missing, i.e. fail-closed); it never invents rows.
 */
const TIME_ZONE = "America/New_York";
const DEFAULT_BLOG_IDS = ["6431685", "6431687"];
const MAX_BRANDS = 5;
const MAX_POSTS_PER_BRAND = 200;

export type SocialSnapshot = { id: string; provider: string; platform: "tiktok"; views: number; impressions: number; likes: number; comments: number; shares: number };
export type MarketingSocialSyncResult = { status: "completed" | "partial" | "blocked"; brands: number; recorded: number; learningRecorded: boolean; error: string | null; at: string };
type Fetcher = typeof globalThis.fetch;
type Timer = { unref?: () => void };

export type MarketingSocialSyncDeps = {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetcher;
  now?: () => Date;
  record?: (items: SocialSnapshot[], now: Date) => number | Promise<number>;
  learn?: (dateKey: string) => Promise<unknown>;
  /** Inject a provider directly (tests / in-house hub) or a registry. */
  provider?: SocialAnalyticsProvider;
  providers?: Readonly<Record<string, SocialAnalyticsProvider>>;
  log?: (message: string) => void;
};

const real = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(v.trim());
const int = (v: string | undefined, d: number, min: number, max: number) => { const n = Number.parseInt(v || "", 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

export function getMarketingSocialSyncConfig(env: NodeJS.ProcessEnv = process.env) {
  const configured = real(env.SOCIAL_ANALYTICS_ACCOUNT_IDS) ? env.SOCIAL_ANALYTICS_ACCOUNT_IDS : env.METRICOOL_SOCIAL_METRICS_BLOG_IDS;
  const ids = (real(configured) ? configured.split(",") : DEFAULT_BLOG_IDS)
    .map((id) => id.trim()).filter((id) => /^\d{1,20}$/.test(id));
  return {
    enabled: env.MARKETING_SOCIAL_METRICS_SYNC_ENABLED !== "false",
    learningEnabled: env.MARKETING_LEARNING_DAILY_ENABLED !== "false",
    hour: int(env.MARKETING_SOCIAL_METRICS_SYNC_HOUR, 7, 0, 23),
    minute: int(env.MARKETING_SOCIAL_METRICS_SYNC_MINUTE, 10, 0, 59),
    lookbackDays: int(env.MARKETING_SOCIAL_METRICS_LOOKBACK_DAYS, 14, 1, 30),
    timeoutMs: int(env.MARKETING_SOCIAL_METRICS_TIMEOUT_MS, 60_000, 5_000, 120_000),
    blogIds: [...new Set(ids)].slice(0, MAX_BRANDS),
  };
}

const count = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(100_000_000, Math.round(n)) : 0; };

/** Maps provider-neutral posts to opaque daily snapshots. Posts without a URL
 * or video id are dropped. URLs never leave this function. Metricool ids keep
 * the historical `metricool-` prefix so existing persisted rows stay readable;
 * other providers use `social-analytics-<provider>-`. */
export function snapshotsFromPosts(posts: readonly PostAnalytics[], accountId: string, dateKey: string, providerName: string): SocialSnapshot[] {
  const out = new Map<string, SocialSnapshot>();
  const provider = providerName.replace(/[^a-z0-9_-]/gi, "").toLowerCase().slice(0, 40) || "unknown";
  const prefix = provider === "metricool" ? "metricool-tiktok" : `social-analytics-${provider}-tiktok`;
  for (const post of posts.slice(0, MAX_POSTS_PER_BRAND)) {
    const key = (post.url || "").trim() || (post.videoId || post.postId || "").trim();
    if (!key) continue;
    const hash = createHash("sha256").update(`${accountId}|${key}`).digest("hex").slice(0, 32);
    const id = `${prefix}-${hash}-${dateKey}`;
    out.set(id, {
      id, provider, platform: "tiktok",
      views: count(post.views), impressions: count(post.impressions), likes: count(post.likes),
      comments: count(post.comments), shares: count(post.shares),
    });
  }
  return [...out.values()];
}

export function zonedDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const v = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return { dateKey: `${v("year")}-${v("month")}-${v("day")}`, hour: Number(v("hour")), minute: Number(v("minute")) };
}

const safe = (e: unknown) => (e instanceof Error ? e.message : "social_sync_failed").replace(/https?:\/\/\S+/gi, "[url]").replace(/(token|auth|secret)\S*\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 200);

export async function syncMarketingSocialMetrics(deps: MarketingSocialSyncDeps = {}): Promise<MarketingSocialSyncResult> {
  const env = deps.env || process.env, config = getMarketingSocialSyncConfig(env), now = (deps.now || (() => new Date()))();
  const base = { brands: 0, recorded: 0, learningRecorded: false, at: now.toISOString() };
  if (!config.enabled) return { ...base, status: "blocked", error: "disabled_by_configuration" };
  const log = deps.log || ((m: string) => console.warn(m));
  const resolved = deps.provider ? { provider: deps.provider, reason: null } : resolveSocialAnalyticsProvider(env, deps.providers);
  if (!resolved.provider) { log(`[Marketing social] skipped: ${resolved.reason}`); return { ...base, status: "blocked", error: resolved.reason }; }
  const provider = resolved.provider;
  if (!provider.isConfigured(env)) return { ...base, status: "blocked", error: `missing_${provider.name}_credentials` };
  if (!config.blogIds.length) return { ...base, status: "blocked", error: "no_social_analytics_accounts" };
  const fetcher = deps.fetch || globalThis.fetch, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs); timer.unref?.();
  const bounded: Fetcher = (input, init) => fetcher(input, { ...init, signal: controller.signal });
  const { dateKey } = zonedDateKey(now);
  const from = new Date(now.getTime() - config.lookbackDays * 86_400_000).toISOString().replace(/\.\d+Z$/, "+00:00");
  const to = now.toISOString().replace(/\.\d+Z$/, "+00:00");
  const items: SocialSnapshot[] = [], errors: string[] = [];
  let brands = 0;
  try {
    for (const blogId of config.blogIds) {
      try {
        const posts = await provider.getPostAnalytics({ accountId: blogId, platform: "tiktok", from, to, env, fetch: bounded });
        items.push(...snapshotsFromPosts(Array.isArray(posts) ? posts : [], blogId, dateKey, provider.name)); brands += 1;
      } catch (error) { errors.push(safe(error)); }
    }
  } finally { clearTimeout(timer); }
  const record = deps.record || (async (rows: SocialSnapshot[], at: Date) => (await import("./dropshipping-ceo")).recordSocialAnalyticsSnapshots(rows, at));
  const recorded = items.length ? await record(items, now) : 0;
  let learningRecorded = false;
  // Learning only follows new evidence: no fresh metrics means no new run.
  if (recorded > 0 && config.learningEnabled) {
    try {
      const learn = deps.learn || (async (key: string) => {
        const [{ runMarketingCommandCenterForOwner }, { getSystemUserId }] = await Promise.all([import("./marketing-learning-service"), import("./user-context")]);
        return runMarketingCommandCenterForOwner(getSystemUserId(), {}, `daily-social-${key}`);
      });
      await learn(dateKey); learningRecorded = true;
    } catch (error) { errors.push(`learning:${safe(error)}`); }
  }
  const status = brands === 0 ? "blocked" : errors.length ? "partial" : "completed";
  return { brands, recorded, learningRecorded, at: base.at, status, error: errors.length ? errors.join("; ").slice(0, 240) : null };
}

export type MarketingSocialSchedulerDeps = MarketingSocialSyncDeps & {
  sync?: () => Promise<MarketingSocialSyncResult>;
  setInterval?: (cb: () => void, ms: number) => Timer;
  log?: (message: string) => void;
};

/** Once per New York day after the configured time (catch-up after restarts),
 * same cadence model as the Metricool analytics scheduler. */
export function createMarketingSocialScheduler(deps: MarketingSocialSchedulerDeps = {}) {
  const env = deps.env || process.env, config = getMarketingSocialSyncConfig(env), now = deps.now || (() => new Date());
  const run = deps.sync || (() => syncMarketingSocialMetrics(deps));
  const schedule = deps.setInterval || globalThis.setInterval, log = deps.log || ((m: string) => console.log(m));
  let lastDate: string | null = null, running = false, started = false, last: MarketingSocialSyncResult | null = null;
  const tick = async () => {
    const clock = zonedDateKey(now());
    if (running || lastDate === clock.dateKey) return false;
    if (clock.hour < config.hour || (clock.hour === config.hour && clock.minute < config.minute)) return false;
    lastDate = clock.dateKey; running = true;
    try { last = await run(); log(`[Marketing social] ${last.status}: ${last.recorded} snapshot(s)`); }
    catch (error) { last = { status: "partial", brands: 0, recorded: 0, learningRecorded: false, error: safe(error), at: now().toISOString() }; }
    finally { running = false; }
    return true;
  };
  return {
    tick,
    start() { if (started || !config.enabled) return false; started = true; const t = schedule(() => { void tick(); }, 60_000); t.unref?.(); void tick(); return true; },
    status: () => ({ enabled: config.enabled, started, running, lastDate, last }),
  };
}

let shared: ReturnType<typeof createMarketingSocialScheduler> | null = null;
export function startMarketingSocialScheduler() { shared ||= createMarketingSocialScheduler(); return shared.start(); }
export function getMarketingSocialSchedulerStatus() { shared ||= createMarketingSocialScheduler(); return shared.status(); }
