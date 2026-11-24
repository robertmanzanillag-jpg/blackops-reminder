import { createHash } from "node:crypto";
import { callMetricoolMcpTool } from "./blackroom-metricool-bridge";

/**
 * Daily, read-only refresh of organic TikTok post metrics from Metricool into
 * the marketing-cmo `social_metrics` source. It never schedules posts, never
 * touches ads and never spends money. Only `getAnalyticsDataByMetrics` is called.
 * Missing credentials or a failed fetch record nothing (the source stays stale
 * or missing, i.e. fail-closed); it never invents rows.
 */
const TIME_ZONE = "America/New_York";
const DEFAULT_BLOG_IDS = ["6431685", "6431687"];
const TIKTOK_FIELDS = ["TKPO02", "TKPO03", "TKPO07", "TKPO08", "TKPO09", "TKPO10", "TKPO11"] as const;
const MAX_BRANDS = 5;
const MAX_POSTS_PER_BRAND = 200;

export type SocialSnapshot = { id: string; platform: "tiktok"; views: number; impressions: number; likes: number; comments: number; shares: number };
export type MarketingSocialSyncResult = { status: "completed" | "partial" | "blocked"; brands: number; recorded: number; learningRecorded: boolean; error: string | null; at: string };
type Fetcher = typeof globalThis.fetch;
type Timer = { unref?: () => void };

export type MarketingSocialSyncDeps = {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetcher;
  now?: () => Date;
  record?: (items: SocialSnapshot[], now: Date) => number | Promise<number>;
  learn?: (dateKey: string) => Promise<unknown>;
};

const real = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(v.trim());
const int = (v: string | undefined, d: number, min: number, max: number) => { const n = Number.parseInt(v || "", 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

export function getMarketingSocialSyncConfig(env: NodeJS.ProcessEnv = process.env) {
  const ids = (real(env.METRICOOL_SOCIAL_METRICS_BLOG_IDS) ? env.METRICOOL_SOCIAL_METRICS_BLOG_IDS!.split(",") : DEFAULT_BLOG_IDS)
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

function cell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = row[key];
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) return (v as { value: unknown }).value;
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}
const count = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(100_000_000, Math.round(n)) : 0; };

function rowsOf(value: unknown): Record<string, unknown>[] {
  let parsed = value;
  const content = value && typeof value === "object" ? (value as { content?: unknown }).content : undefined;
  if (Array.isArray(content)) for (const item of content) {
    const text = item && typeof item === "object" ? (item as { text?: unknown }).text : undefined;
    if (typeof text !== "string") continue;
    try { parsed = JSON.parse(text); break; } catch { continue; }
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as { rows?: unknown }).rows : null;
  return Array.isArray(list) ? list.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object" && !Array.isArray(r))) : [];
}

/** Maps Metricool TikTok post rows to opaque daily snapshots. Rows without a
 * video URL are dropped (no id can be proven). URLs never leave this function. */
export function parseTikTokPostRows(value: unknown, blogId: string, dateKey: string): SocialSnapshot[] {
  const out = new Map<string, SocialSnapshot>();
  for (const row of rowsOf(value).slice(0, MAX_POSTS_PER_BRAND)) {
    const url = cell(row, "TKPO03", "shareurl", "shareUrl", "url");
    if (typeof url !== "string" || !url.trim()) continue;
    const post = createHash("sha256").update(`${blogId}|${url.trim()}`).digest("hex").slice(0, 32);
    const id = `metricool-tiktok-${post}-${dateKey}`;
    out.set(id, {
      id, platform: "tiktok",
      views: count(cell(row, "TKPO07", "views")),
      impressions: count(cell(row, "TKPO11", "reach")),
      likes: count(cell(row, "TKPO08", "likes")),
      comments: count(cell(row, "TKPO09", "comments")),
      shares: count(cell(row, "TKPO10", "shares")),
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
  if (!real(env.METRICOOL_USER_TOKEN) || !real(env.METRICOOL_USER_ID)) return { ...base, status: "blocked", error: "missing_metricool_credentials" };
  if (!config.blogIds.length) return { ...base, status: "blocked", error: "no_metricool_brands" };
  const token = env.METRICOOL_USER_TOKEN!, fetcher = deps.fetch || globalThis.fetch, controller = new AbortController();
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
        const result = await callMetricoolMcpTool(bounded, token, "getAnalyticsDataByMetrics", { brandId: blogId, metrics: [...TIKTOK_FIELDS], from, to });
        items.push(...parseTikTokPostRows(result, blogId, dateKey)); brands += 1;
      } catch (error) { errors.push(safe(error)); }
    }
  } finally { clearTimeout(timer); }
  const record = deps.record || (async (rows: SocialSnapshot[], at: Date) => (await import("./dropshipping-ceo")).recordMetricoolSocialSnapshots(rows, at));
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
