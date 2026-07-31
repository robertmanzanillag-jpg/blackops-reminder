import {
  BLACKROOM_METRICOOL_BLOG_ID,
  BLACKROOM_TIMEZONE,
  callMetricoolMcpTool,
  formatMetricoolMcpDate,
  listMetricoolMcpTools,
  readBlackRoomMetricoolScheduledPosts,
  type BlackRoomMetricoolNetwork,
} from "./blackroom-metricool-bridge";
import type { BlackRoomCeoAnalytics } from "./blackroom-growth-ceo";
import type { BlackRoomRescheduleExperiment } from "./blackroom-remote-control";

export const BLACKROOM_RESCHEDULE_LOOKAHEAD_DAYS = 14;
export const BLACKROOM_RESCHEDULE_PROTECTION_HOURS = 36;
export const BLACKROOM_RESCHEDULE_MAX_PER_CYCLE = 2;
export const BLACKROOM_RESCHEDULE_COOLDOWN_MS = 6 * 60 * 60_000;
export const BLACKROOM_RESCHEDULE_MIN_SPACING_MINUTES = 90;

export interface BlackRoomScheduledPost {
  id: string;
  uuid: string;
  network: BlackRoomMetricoolNetwork;
  publicationDateTime: string;
  info: Record<string, unknown>;
}

export interface BlackRoomReschedulePlan {
  post: BlackRoomScheduledPost;
  from: string;
  to: string;
}

export interface BlackRoomRescheduleReport {
  checkedAt: string;
  experiments: BlackRoomRescheduleExperiment[];
  error?: string;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function records(value: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, any>;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function publicationDateTime(record: Record<string, any>): string {
  return String(record.publicationDate?.dateTime || record.publicationDateTime || record.date || "").slice(0, 19);
}

function networkOf(record: Record<string, any>): BlackRoomMetricoolNetwork | null {
  const names = records(record.providers ?? record.networks ?? record)
    .map((item) => String(item.network || item.provider || item.name || "").toLowerCase());
  const matched = (["tiktok", "facebook", "youtube"] as BlackRoomMetricoolNetwork[])
    .filter((network) => names.includes(network));
  return matched.length === 1 ? matched[0] : null;
}

export function extractBlackRoomScheduledPosts(value: unknown): BlackRoomScheduledPost[] {
  const unique = new Map<string, BlackRoomScheduledPost>();
  for (const record of records(value)) {
    const id = String(record.id ?? "").trim();
    const uuid = String(record.uuid ?? "").trim();
    const network = networkOf(record);
    const dateTime = publicationDateTime(record);
    const signature = `${String(record.text || "")} ${String(record.title || "")}`.toLowerCase();
    if (!id || !uuid || !network || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateTime)) continue;
    if (!signature.includes("blackroom") && !signature.includes("black room")) continue;
    unique.set(`${id}:${network}`, { id, uuid, network, publicationDateTime: dateTime, info: structuredClone(record) });
  }
  return [...unique.values()];
}

function combineDateAndTime(dateTime: string, time: string): string {
  return `${dateTime.slice(0, 10)}T${time}:00`;
}

export function planBlackRoomRescheduleExperiments(input: {
  posts: BlackRoomScheduledPost[];
  analytics: BlackRoomCeoAnalytics;
  attemptedPostIds?: string[];
  now?: Date;
}): BlackRoomReschedulePlan[] {
  if (input.analytics.comparableSampleCount < 21) return [];
  const now = input.now || new Date();
  const earliest = now.getTime() + BLACKROOM_RESCHEDULE_PROTECTION_HOURS * 60 * 60_000;
  const latest = now.getTime() + BLACKROOM_RESCHEDULE_LOOKAHEAD_DAYS * 24 * 60 * 60_000;
  const attempted = new Set(input.attemptedPostIds || []);
  const eligible = input.posts
    .filter((post) => {
      const at = new Date(post.publicationDateTime).getTime();
      return at >= earliest && at <= latest && !attempted.has(post.id);
    })
    .sort((left, right) => left.publicationDateTime.localeCompare(right.publicationDateTime));
  const selectedNetworks = new Set<string>();
  const plans: BlackRoomReschedulePlan[] = [];
  for (const post of eligible) {
    if (plans.length >= BLACKROOM_RESCHEDULE_MAX_PER_CYCLE || selectedNetworks.has(post.network)) continue;
    const candidates = input.analytics.recommendedTimesByNetwork?.[post.network]
      || input.analytics.recommendedTimes || [];
    const occupied = input.posts.filter((other) => other.network === post.network && other.id !== post.id);
    const time = candidates.find((candidate) => {
      if (!/^\d{2}:\d{2}$/.test(candidate)) return false;
      const target = combineDateAndTime(post.publicationDateTime, candidate);
      if (target === post.publicationDateTime) return false;
      const targetAt = new Date(target).getTime();
      if (targetAt < earliest || targetAt > latest) return false;
      return occupied.every((other) =>
        Math.abs(targetAt - new Date(other.publicationDateTime).getTime())
          >= BLACKROOM_RESCHEDULE_MIN_SPACING_MINUTES * 60_000);
    });
    if (!time) continue;
    plans.push({ post, from: post.publicationDateTime, to: combineDateAndTime(post.publicationDateTime, time) });
    selectedNetworks.add(post.network);
  }
  return plans;
}

function updateToolArgs(
  schema: Record<string, any> | undefined,
  plan: BlackRoomReschedulePlan,
  blogId: number,
): Record<string, unknown> {
  const properties = schema?.properties || {};
  const info = structuredClone(plan.post.info) as Record<string, any>;
  info.publicationDate = { ...(info.publicationDate || {}), dateTime: plan.to, timezone: BLACKROOM_TIMEZONE };
  const args: Record<string, unknown> = {};
  if (!Object.keys(properties).length) {
    return {
      id: /^\d+$/.test(plan.post.id) ? Number(plan.post.id) : plan.post.id,
      uuid: plan.post.uuid,
      blogId,
      date: formatMetricoolMcpDate(plan.to),
      info,
    };
  }
  for (const [key, definition] of Object.entries(properties) as Array<[string, any]>) {
    const normalized = normalizedName(key);
    if (normalized === "blogid") args[key] = definition?.type === "string" ? String(blogId) : blogId;
    if (normalized === "id") args[key] = definition?.type === "string"
      ? plan.post.id : (/^\d+$/.test(plan.post.id) ? Number(plan.post.id) : plan.post.id);
    if (normalized === "uuid") args[key] = plan.post.uuid;
    if (normalized === "date" || normalized === "publicationdate") args[key] = formatMetricoolMcpDate(plan.to);
    if (normalized === "info") args[key] = definition?.type === "string" ? JSON.stringify(info) : info;
  }
  return args;
}

export async function rescheduleBlackRoomMetricoolExperiments(input: {
  analytics: BlackRoomCeoAnalytics;
  attemptedPostIds?: string[];
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}): Promise<BlackRoomRescheduleReport> {
  const now = input.now || new Date();
  const checkedAt = now.toISOString();
  const env = input.env || process.env;
  const fetcher = input.fetch || fetch;
  const start = checkedAt.slice(0, 10);
  const endDate = new Date(now.getTime() + BLACKROOM_RESCHEDULE_LOOKAHEAD_DAYS * 24 * 60 * 60_000);
  const end = endDate.toISOString().slice(0, 10);
  const posts = extractBlackRoomScheduledPosts(await readBlackRoomMetricoolScheduledPosts(
    { start: `${start}T00:00:00`, end: `${end}T23:59:59` }, { env, fetch: fetcher },
  ));
  const plans = planBlackRoomRescheduleExperiments({
    posts, analytics: input.analytics, attemptedPostIds: input.attemptedPostIds, now,
  });
  if (!plans.length) return { checkedAt, experiments: [] };
  const tools = await listMetricoolMcpTools({ env, fetch: fetcher });
  const tool = tools.find((candidate) =>
    ["updateschedulepost", "updatescheduledpost"].includes(normalizedName(candidate.name)));
  if (!tool) return { checkedAt, experiments: [], error: "Metricool no expuso una herramienta para mover posts." };
  const token = String(env.METRICOOL_USER_TOKEN || "").trim();
  const blogId = Number(env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID);
  const experiments: BlackRoomRescheduleExperiment[] = [];
  for (const plan of plans) {
    const base = {
      postId: plan.post.id, uuid: plan.post.uuid, network: plan.post.network,
      from: plan.from, to: plan.to, movedAt: checkedAt,
    };
    try {
      await callMetricoolMcpTool(fetcher, token, tool.name, updateToolArgs(tool.inputSchema, plan, blogId));
      const verification = extractBlackRoomScheduledPosts(await readBlackRoomMetricoolScheduledPosts(
        { start: `${plan.to.slice(0, 10)}T00:00:00`, end: `${plan.to.slice(0, 10)}T23:59:59` },
        { env, fetch: fetcher },
      ));
      const verified = verification.some((post) => post.id === plan.post.id && post.publicationDateTime === plan.to);
      experiments.push({ ...base, status: verified ? "verified" : "uncertain" });
    } catch (error: any) {
      experiments.push({ ...base, status: "failed", error: String(error?.message || error).slice(0, 500) });
    }
  }
  return { checkedAt, experiments };
}
