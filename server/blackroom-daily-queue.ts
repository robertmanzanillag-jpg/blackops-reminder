import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const BLACKROOM_QUEUE_VERSION = 1;
export const BLACKROOM_QUEUE_PATH = "clippers_workspace/blackroom/agent/queue.json";
export const BLACKROOM_DEFAULT_BUFFER_DAYS = 7;
export const BLACKROOM_DEFAULT_POSTS_PER_DAY = 10;
export const BLACKROOM_DEFAULT_INTERVAL_MINUTES = 90;
export const BLACKROOM_DURATION_VARIANTS = [15, 30, 60, 120, 300, 600] as const;
export type BlackRoomExperimentDuration = (typeof BLACKROOM_DURATION_VARIANTS)[number];

export type BlackRoomDailyJobStatus = "queued" | "processing" | "retry" | "scheduled" | "completed";

export interface BlackRoomDailyJob {
  id: string;
  kind: "daily_tiktok_batch";
  targetDate: string;
  originalTargetDate: string;
  status: BlackRoomDailyJobStatus;
  attempts: number;
  notBefore: string;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastError: string | null;
  slots: Array<{ localTime: string; timezone: string }>;
  requirements: {
    posts: number;
    djs: number;
    postsPerDj: number;
    languages: string[];
    formats: string[];
    durationsSeconds: number[];
    minimumClipsPerDuration: number;
    neverRepeatSourceVideo: boolean;
    neverReuseOverlappingSegment: boolean;
    optimizeDurationFromPerformance: boolean;
    differentMomentsAcrossFormats: boolean;
    dropNearBeginning: boolean;
    deleteOnlyAfterMetricoolConfirmation: boolean;
  };
}

export interface BlackRoomSourceUsage {
  videoId: string;
  jobId: string;
  dj: string;
  format: "vertical" | "horizontal";
  language: "en" | "es";
  durationSeconds: BlackRoomExperimentDuration;
  segmentStartSeconds: number;
  segmentEndSeconds: number;
  recordedAt: string;
}

export interface BlackRoomQueueState {
  version: number;
  enabled: boolean;
  pausedAt: string | null;
  timezone: string;
  bufferDays: number;
  postsPerDay: number;
  intervalMinutes: number;
  updatedAt: string;
  jobs: BlackRoomDailyJob[];
  sourceHistory: BlackRoomSourceUsage[];
}

function iso(now: Date): string {
  return now.toISOString();
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(date: string, days: number): string {
  const noonUtc = new Date(`${date}T12:00:00.000Z`);
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  return noonUtc.toISOString().slice(0, 10);
}

function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function buildRotatingSlots(input: {
  dayIndex: number;
  posts?: number;
  intervalMinutes?: number;
  timezone?: string;
}): Array<{ localTime: string; timezone: string }> {
  const posts = Math.max(1, Math.min(20, Math.floor(input.posts || BLACKROOM_DEFAULT_POSTS_PER_DAY)));
  const intervalMinutes = Math.max(30, Math.min(240, Math.floor(input.intervalMinutes || BLACKROOM_DEFAULT_INTERVAL_MINUTES)));
  const timezone = input.timezone || "America/New_York";
  // Alternating windows cover overnight/morning and afternoon/late night while
  // keeping the first experiment cadence at exactly 90 minutes.
  const startMinutes = input.dayIndex % 2 === 0 ? 30 : 10 * 60;
  return Array.from({ length: posts }, (_, index) => ({
    localTime: minutesToTime(startMinutes + index * intervalMinutes),
    timezone,
  }));
}

export function createBlackRoomQueueState(now = new Date()): BlackRoomQueueState {
  return {
    version: BLACKROOM_QUEUE_VERSION,
    enabled: false,
    pausedAt: iso(now),
    timezone: "America/New_York",
    bufferDays: BLACKROOM_DEFAULT_BUFFER_DAYS,
    postsPerDay: BLACKROOM_DEFAULT_POSTS_PER_DAY,
    intervalMinutes: BLACKROOM_DEFAULT_INTERVAL_MINUTES,
    updatedAt: iso(now),
    jobs: [],
    sourceHistory: [],
  };
}

function createDailyJob(state: BlackRoomQueueState, targetDate: string, dayIndex: number, now: Date): BlackRoomDailyJob {
  const timestamp = iso(now);
  return {
    id: `blackroom-tiktok-${targetDate}`,
    kind: "daily_tiktok_batch",
    targetDate,
    originalTargetDate: targetDate,
    status: "queued",
    attempts: 0,
    notBefore: timestamp,
    leaseExpiresAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    lastError: null,
    slots: buildRotatingSlots({
      dayIndex,
      posts: state.postsPerDay,
      intervalMinutes: state.intervalMinutes,
      timezone: state.timezone,
    }),
    requirements: {
      posts: state.postsPerDay,
      djs: 5,
      postsPerDj: 2,
      languages: ["en", "es"],
      formats: ["vertical", "horizontal"],
      durationsSeconds: [...BLACKROOM_DURATION_VARIANTS],
      minimumClipsPerDuration: 1,
      neverRepeatSourceVideo: true,
      neverReuseOverlappingSegment: true,
      optimizeDurationFromPerformance: true,
      differentMomentsAcrossFormats: true,
      dropNearBeginning: true,
      deleteOnlyAfterMetricoolConfirmation: true,
    },
  };
}

export function recordBlackRoomSourceUsage(
  state: BlackRoomQueueState,
  usage: Omit<BlackRoomSourceUsage, "recordedAt">,
  now = new Date(),
): BlackRoomSourceUsage {
  const videoId = String(usage.videoId || "").trim();
  if (!videoId) throw new Error("videoId is required");
  if (state.sourceHistory.some((item) => item.videoId === videoId)) {
    throw new Error(`BlackRoom source video already used: ${videoId}`);
  }
  if (!BLACKROOM_DURATION_VARIANTS.includes(usage.durationSeconds)) {
    throw new Error("durationSeconds must be 15, 30, 60, 120, 300, or 600");
  }
  const recorded: BlackRoomSourceUsage = { ...usage, videoId, recordedAt: iso(now) };
  state.sourceHistory.push(recorded);
  state.updatedAt = iso(now);
  return recorded;
}

export function recoverInterruptedBlackRoomJobs(state: BlackRoomQueueState, now = new Date()): number {
  let recovered = 0;
  for (const job of state.jobs) {
    if (job.status !== "processing") continue;
    if (job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() > now.getTime()) continue;
    job.status = "retry";
    job.leaseExpiresAt = null;
    job.notBefore = iso(now);
    job.updatedAt = iso(now);
    job.lastError ||= "Trabajo interrumpido por apagado o cierre; recuperado automáticamente.";
    recovered += 1;
  }
  return recovered;
}

export function ensureBlackRoomScheduleBuffer(state: BlackRoomQueueState, now = new Date()): number {
  const today = localDate(now, state.timezone);
  const existing = new Set(state.jobs.map((job) => job.targetDate));
  let created = 0;
  for (let dayIndex = 1; dayIndex <= state.bufferDays; dayIndex += 1) {
    const targetDate = addCalendarDays(today, dayIndex);
    if (existing.has(targetDate)) continue;
    state.jobs.push(createDailyJob(state, targetDate, dayIndex - 1, now));
    existing.add(targetDate);
    created += 1;
  }
  state.jobs.sort((left, right) => left.targetDate.localeCompare(right.targetDate) || left.createdAt.localeCompare(right.createdAt));
  state.updatedAt = iso(now);
  return created;
}

export function startBlackRoomAgent(state: BlackRoomQueueState, weeks = 2, now = new Date()): number {
  const normalizedWeeks = Number.isFinite(weeks) ? Math.floor(weeks) : 2;
  state.enabled = true;
  state.pausedAt = null;
  state.bufferDays = Math.max(7, Math.min(28, normalizedWeeks * 7));
  state.updatedAt = iso(now);
  return ensureBlackRoomScheduleBuffer(state, now);
}

export function pauseBlackRoomAgent(state: BlackRoomQueueState, now = new Date()): void {
  state.enabled = false;
  state.pausedAt = iso(now);
  state.updatedAt = iso(now);
}

export function claimNextBlackRoomJob(state: BlackRoomQueueState, now = new Date(), leaseMinutes = 180): BlackRoomDailyJob | null {
  recoverInterruptedBlackRoomJobs(state, now);
  if (!state.enabled) return null;
  const job = state.jobs.find((candidate) =>
    ["queued", "retry"].includes(candidate.status)
    && new Date(candidate.notBefore).getTime() <= now.getTime());
  if (!job) return null;
  job.status = "processing";
  job.attempts += 1;
  job.updatedAt = iso(now);
  job.leaseExpiresAt = new Date(now.getTime() + Math.max(5, leaseMinutes) * 60_000).toISOString();
  job.lastError = null;
  state.updatedAt = iso(now);
  return job;
}

export function completeBlackRoomJob(state: BlackRoomQueueState, jobId: string, now = new Date()): BlackRoomDailyJob {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`BlackRoom queue job not found: ${jobId}`);
  job.status = "completed";
  job.completedAt = iso(now);
  job.updatedAt = iso(now);
  job.leaseExpiresAt = null;
  job.lastError = null;
  state.updatedAt = iso(now);
  return job;
}

export function retryBlackRoomJob(state: BlackRoomQueueState, jobId: string, error: string, now = new Date()): BlackRoomDailyJob {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`BlackRoom queue job not found: ${jobId}`);
  const delayMinutes = Math.min(6 * 60, Math.max(10, 10 * 2 ** Math.max(0, job.attempts - 1)));
  job.status = "retry";
  job.updatedAt = iso(now);
  job.notBefore = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
  job.leaseExpiresAt = null;
  job.lastError = String(error || "Error desconocido").slice(0, 1000);
  state.updatedAt = iso(now);
  return job;
}

export function summarizeBlackRoomQueue(state: BlackRoomQueueState) {
  const totals = { queued: 0, processing: 0, retry: 0, scheduled: 0, completed: 0 };
  for (const job of state.jobs) totals[job.status] += 1;
  return {
    enabled: state.enabled,
    pausedAt: state.pausedAt,
    updatedAt: state.updatedAt,
    timezone: state.timezone,
    bufferDays: state.bufferDays,
    bufferWeeks: Math.ceil(state.bufferDays / 7),
    postsPerDay: state.postsPerDay,
    usedSourceVideos: state.sourceHistory.length,
    durationSamples: {
      ...Object.fromEntries(BLACKROOM_DURATION_VARIANTS.map((duration) => [
        duration,
        state.sourceHistory.filter((item) => item.durationSeconds === duration).length,
      ])),
    },
    totals,
    nextJob: state.jobs.find((job) => ["queued", "retry", "processing"].includes(job.status)) || null,
  };
}

export async function readBlackRoomQueue(filePath = BLACKROOM_QUEUE_PATH, now = new Date()): Promise<BlackRoomQueueState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.map((job: BlackRoomDailyJob) => ({
      ...job,
      requirements: ["queued", "retry"].includes(job.status)
        ? {
          ...job.requirements,
          durationsSeconds: [...BLACKROOM_DURATION_VARIANTS],
          minimumClipsPerDuration: 1,
        }
        : job.requirements,
    })) : [];
    return {
      ...createBlackRoomQueueState(now),
      ...parsed,
      jobs,
      sourceHistory: Array.isArray(parsed.sourceHistory) ? parsed.sourceHistory : [],
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return createBlackRoomQueueState(now);
    throw error;
  }
}

export async function writeBlackRoomQueue(state: BlackRoomQueueState, filePath = BLACKROOM_QUEUE_PATH): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
