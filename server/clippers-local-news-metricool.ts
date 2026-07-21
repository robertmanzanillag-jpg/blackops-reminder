import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  ClipperLocalNewsLane,
  ClipperLocalNewsPlatform,
  ClipperLocalNewsStatus,
} from "./clippers-local-news-agent";

const METRICOOL_API = "https://app.metricool.com";
const TIME_ZONE = "America/New_York";
const DEFAULT_MAX_PER_RUN = 20;
const MAX_PER_RUN = 50;
const MIN_SPACING_MS = 2 * 60_000;
const STALE_LOCK_MS = 10 * 60_000;

const queueItemSchema = z.object({
  id: z.string().min(1).max(500),
  eventId: z.string().min(1).max(500),
  lane: z.enum(["miami-news", "ny-news"]),
  platform: z.enum(["x", "facebook"]),
  copy: z.string().min(1).max(20_000),
  risk: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["approval_required", "auto_eligible"]),
  approvalRequired: z.boolean(),
  autoEligible: z.boolean(),
  published: z.literal(false),
  createdAt: z.string().datetime(),
}).passthrough();

const queueFileSchema = z.object({
  items: z.array(queueItemSchema).max(10_000),
}).passthrough();

const ledgerEntrySchema = z.object({
  queueItemId: z.string().min(1).max(500),
  lane: z.enum(["miami-news", "ny-news"]),
  platform: z.enum(["x", "facebook"]),
  blogId: z.string().min(1).max(100),
  scheduledFor: z.string().datetime(),
  scheduledAt: z.string().datetime(),
  metricoolPostId: z.string().max(500).nullable(),
});

const ledgerSchema = z.object({
  version: z.literal(1),
  entries: z.array(ledgerEntrySchema).max(100_000),
});

type QueueItem = z.infer<typeof queueItemSchema>;
type Ledger = z.infer<typeof ledgerSchema>;

export type ClipperLocalNewsMetricoolResultStatus = "completed" | "partial" | "blocked";

export interface ClipperLocalNewsMetricoolResult {
  status: ClipperLocalNewsMetricoolResultStatus;
  reason: string | null;
  scanned: number;
  eligible: number;
  scheduled: number;
  alreadyScheduled: number;
  filtered: number;
  failed: number;
  blockedLanes: ClipperLocalNewsLane[];
  ledgerPath: string;
}

export interface ClipperLocalNewsMetricoolOptions {
  status?: ClipperLocalNewsStatus;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  workspaceDir?: string;
  maxPerRun?: number;
}

interface ProfileCandidate {
  label: string;
  blogId: string;
  connectedNetworks: Set<string> | null;
}

function hasRealValue(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return !/^<.*>$|^(?:change|replace|your)[-_ ]/i.test(value.trim());
}

function cappedInteger(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_PER_RUN, Math.trunc(parsed))) : fallback;
}

function defaultWorkspace(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.CLIPPERS_LOCAL_NEWS_WORKSPACE || path.join(process.cwd(), "clippers_workspace", "local-news"));
}

function resolvePaths(options: ClipperLocalNewsMetricoolOptions, env: NodeJS.ProcessEnv) {
  const queuePath = options.status?.artifacts.queue
    ? path.resolve(options.status.artifacts.queue)
    : path.join(path.resolve(options.workspaceDir || defaultWorkspace(env)), "metricool-queue.json");
  return {
    queuePath,
    ledgerPath: path.join(path.dirname(queuePath), "metricool-delivery-ledger.json"),
  };
}

async function readLedger(ledgerPath: string): Promise<Ledger> {
  try {
    return ledgerSchema.parse(JSON.parse(await readFile(ledgerPath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  }
}

async function atomicWriteLedger(ledgerPath: string, ledger: Ledger): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const temporary = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, ledgerPath);
}

async function acquireDeliveryLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const ownerId = randomUUID();
      try {
        await handle.writeFile(`${JSON.stringify({ ownerId, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
      } catch (error) {
        try { await handle.close(); } catch { /* best effort */ }
        try { await unlink(lockPath); } catch { /* best effort */ }
        throw error;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await handle.close(); } catch { /* already closed */ }
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { ownerId?: unknown };
          if (current.ownerId === ownerId) await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt > 0) return null;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs <= STALE_LOCK_MS) return null;
        await unlink(lockPath);
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") return null;
      }
    }
  }
  return null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (child === true) return [key.toLowerCase()];
      if (/^(twitter|x|facebook)$/i.test(key) && child !== null && child !== false) return [key.toLowerCase()];
      if (/network|provider|social/i.test(key)) return stringValues(child);
      return [];
    });
  }
  return [];
}

function profileFromRecord(record: Record<string, unknown>): ProfileCandidate | null {
  const label = [record.label, record.name, record.blogName, record.brandName]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  const blogId = normalizeId(record.blogId ?? record.id ?? record.blog_id);
  if (!label || !blogId) return null;
  const explicitTopLevelNetworks = ["twitter", "x", "facebook"].filter((network) => network in record);
  const networkField = record.networks
    ?? record.providers
    ?? record.connectedNetworks
    ?? record.socialNetworks
    ?? (explicitTopLevelNetworks.length ? Object.fromEntries(explicitTopLevelNetworks.map((network) => [network, record[network]])) : undefined);
  const values = networkField === undefined ? null : new Set(stringValues(networkField));
  return { label, blogId, connectedNetworks: values };
}

function collectProfiles(value: unknown, depth = 0): ProfileCandidate[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectProfiles(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const record = z.record(z.string(), z.unknown()).parse(value);
  const direct = profileFromRecord(record);
  const nested = Object.values(record).flatMap((item) => collectProfiles(item, depth + 1));
  return direct ? [direct, ...nested] : nested;
}

function providerFor(platform: ClipperLocalNewsPlatform): "twitter" | "facebook" {
  return platform === "x" ? "twitter" : "facebook";
}

function supportsProvider(profile: ProfileCandidate, platform: ClipperLocalNewsPlatform): boolean {
  if (!profile.connectedNetworks) return true;
  const provider = providerFor(platform);
  return profile.connectedNetworks.has(provider)
    || (provider === "twitter" && profile.connectedNetworks.has("x"));
}

function localDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

function responsePostId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = z.record(z.string(), z.unknown()).parse(value);
  const direct = normalizeId(record.id ?? record.uuid ?? record.postId ?? record.post_id);
  if (direct) return direct;
  for (const key of ["data", "post", "result"]) {
    const nested = responsePostId(record[key]);
    if (nested) return nested;
  }
  return null;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function emptyResult(ledgerPath: string): ClipperLocalNewsMetricoolResult {
  return {
    status: "blocked",
    reason: null,
    scanned: 0,
    eligible: 0,
    scheduled: 0,
    alreadyScheduled: 0,
    filtered: 0,
    failed: 0,
    blockedLanes: [],
    ledgerPath,
  };
}

async function discoverProfiles(fetcher: typeof globalThis.fetch, token: string, userId: string): Promise<ProfileCandidate[] | null> {
  const url = new URL("/api/admin/simpleProfiles", METRICOOL_API);
  url.searchParams.set("userId", userId);
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json", "X-Mc-Auth": token } });
    if (!response.ok) return null;
    return collectProfiles(await safeJson(response));
  } catch {
    return null;
  }
}

export async function deliverClipperLocalNewsToMetricool(
  options: ClipperLocalNewsMetricoolOptions = {},
): Promise<ClipperLocalNewsMetricoolResult> {
  const env = options.env || process.env;
  const { queuePath, ledgerPath } = resolvePaths(options, env);
  const result = emptyResult(ledgerPath);
  const token = env.METRICOOL_USER_TOKEN;
  const userId = env.METRICOOL_USER_ID;
  if (!hasRealValue(token) || !hasRealValue(userId)) {
    result.reason = "missing_metricool_credentials";
    return result;
  }

  const lockPath = `${ledgerPath}.lock`;
  let releaseLock: (() => Promise<void>) | null;
  try {
    releaseLock = await acquireDeliveryLock(lockPath);
  } catch {
    result.reason = "metricool_delivery_lock_unavailable";
    return result;
  }
  if (!releaseLock) {
    result.reason = "metricool_delivery_in_progress";
    return result;
  }

  try {
    let queue: QueueItem[];
    let ledger: Ledger;
    try {
      queue = queueFileSchema.parse(JSON.parse(await readFile(queuePath, "utf8"))).items;
      ledger = await readLedger(ledgerPath);
    } catch {
      result.reason = "invalid_or_missing_queue_artifact";
      return result;
    }
    result.scanned = queue.length;

    const already = new Set(ledger.entries.map((entry) => entry.queueItemId));
    const safeItems = queue.filter((item) => {
      const eligible = item.status === "auto_eligible"
        && item.autoEligible
        && !item.approvalRequired
        && (item.risk === "low" || item.risk === "medium");
      if (!eligible) result.filtered += 1;
      else result.eligible += 1;
      if (eligible && already.has(item.id)) result.alreadyScheduled += 1;
      return eligible && !already.has(item.id);
    });

    const laneConfig: Record<ClipperLocalNewsLane, { label: string; override?: string }> = {
      "miami-news": { label: "Miami News", override: env.METRICOOL_MIAMI_NEWS_BLOG_ID },
      "ny-news": { label: "NY News", override: env.METRICOOL_NY_NEWS_BLOG_ID },
    };
    const needsDiscovery = (Object.keys(laneConfig) as ClipperLocalNewsLane[])
      .some((lane) => safeItems.some((item) => item.lane === lane) && !hasRealValue(laneConfig[lane].override));
    const profiles = needsDiscovery ? await discoverProfiles(options.fetch || globalThis.fetch, token, userId) : [];
    if (needsDiscovery && profiles === null) {
      result.reason = "metricool_profile_discovery_failed";
      return result;
    }

    const laneProfiles = new Map<ClipperLocalNewsLane, ProfileCandidate>();
    for (const lane of Object.keys(laneConfig) as ClipperLocalNewsLane[]) {
      const config = laneConfig[lane];
      if (hasRealValue(config.override)) {
        laneProfiles.set(lane, { label: config.label, blogId: config.override.trim(), connectedNetworks: null });
        continue;
      }
      const match = profiles?.find((profile) => profile.label === config.label);
      if (match) laneProfiles.set(lane, match);
      else if (safeItems.some((item) => item.lane === lane)) result.blockedLanes.push(lane);
    }

    if (result.blockedLanes.length && laneProfiles.size === 0) {
      result.reason = "metricool_news_brands_not_connected";
      return result;
    }

    const maxPerRun = cappedInteger(options.maxPerRun ?? env.CLIPPERS_LOCAL_NEWS_METRICOOL_MAX_PER_RUN, DEFAULT_MAX_PER_RUN);
    const now = options.now || (() => new Date());
    const fetchedNow = now();
    const minimumStart = fetchedNow.getTime() + MIN_SPACING_MS;
    const cursors = new Map<string, number>();
    for (const entry of ledger.entries) {
      const key = `${entry.lane}|${entry.platform}`;
      const scheduled = new Date(entry.scheduledFor).getTime();
      if (Number.isFinite(scheduled)) cursors.set(key, Math.max(cursors.get(key) || 0, scheduled));
    }

    const fetcher = options.fetch || globalThis.fetch;
    let attempts = 0;
    for (const item of safeItems) {
      const profile = laneProfiles.get(item.lane);
      if (!profile || !supportsProvider(profile, item.platform)) {
        if (!result.blockedLanes.includes(item.lane)) result.blockedLanes.push(item.lane);
        continue;
      }
      if (attempts >= maxPerRun) break;
      attempts += 1;
      const cursorKey = `${item.lane}|${item.platform}`;
      const scheduledMs = Math.max(minimumStart, (cursors.get(cursorKey) || (minimumStart - MIN_SPACING_MS)) + MIN_SPACING_MS);
      const scheduledDate = new Date(scheduledMs);
      const url = new URL("/api/v2/scheduler/posts", METRICOOL_API);
      url.searchParams.set("userId", userId);
      url.searchParams.set("blogId", profile.blogId);
      url.searchParams.set("jobId", item.id);
      const payload = {
        text: item.copy,
        providers: [{ network: providerFor(item.platform) }],
        publicationDate: { dateTime: localDateTime(scheduledDate), timezone: TIME_ZONE },
        autoPublish: true,
        draft: false,
      };
      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Mc-Auth": token },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          result.failed += 1;
          if (response.status === 400 || response.status === 403 || response.status === 404) {
            if (!result.blockedLanes.includes(item.lane)) result.blockedLanes.push(item.lane);
          }
          continue;
        }
        const responseBody = await safeJson(response);
        ledger.entries.push({
          queueItemId: item.id,
          lane: item.lane,
          platform: item.platform,
          blogId: profile.blogId,
          scheduledFor: scheduledDate.toISOString(),
          scheduledAt: fetchedNow.toISOString(),
          metricoolPostId: responsePostId(responseBody),
        });
        await atomicWriteLedger(ledgerPath, ledger);
        cursors.set(cursorKey, scheduledMs);
        result.scheduled += 1;
      } catch {
        result.failed += 1;
      }
    }

    if (result.scheduled === 0 && (result.blockedLanes.length || result.failed > 0)) {
      result.status = "blocked";
      result.reason = result.blockedLanes.length ? "metricool_profile_or_provider_not_connected" : "metricool_schedule_failed";
    } else if (result.blockedLanes.length || result.failed > 0) {
      result.status = "partial";
      result.reason = result.blockedLanes.length ? "some_metricool_profiles_not_connected" : "some_metricool_requests_failed";
    } else {
      result.status = "completed";
      result.reason = null;
    }
    return result;
  } finally {
    await releaseLock();
  }
}

export const __clipperLocalNewsMetricoolInternals = {
  collectProfiles,
  acquireDeliveryLock,
  localDateTime,
  providerFor,
  responsePostId,
};
