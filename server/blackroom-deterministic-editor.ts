import { createHash } from "node:crypto";
import type { BlackRoomDailyJob, BlackRoomQueueState, BlackRoomExperimentDuration, BlackRoomTargetNetwork } from "./blackroom-daily-queue";
import { BLACKROOM_CEO_CREATIVE_MIN_SAMPLES, BLACKROOM_CEO_DEFAULT_NETWORK_TARGETS } from "./blackroom-growth-ceo";
import type { BlackRoomLedgerEntry, BlackRoomWorkerLedger } from "./blackroom-local-worker";
import type { BlackRoomCreativeStrategy } from "./blackroom-growth-ceo";

export const BLACKROOM_CHANNEL_ID = "UCi__qHBfHLlYg0fu86BUA8g";
export const BLACKROOM_CHANNEL_HANDLE = "@blackroom_us";
export const BLACKROOM_CHANNEL_VIDEOS_URL = "https://www.youtube.com/@blackroom_us/videos";

/**
 * YouTube sometimes requires an authenticated browser session before it will
 * serve a creator's own long-form videos to the local editor.  This returns
 * only yt-dlp command flags: no cookie is read, persisted, logged or sent to
 * the app. The cookie database is accessed locally by yt-dlp at execution.
 */
export function buildBlackRoomYtDlpAuthArgs(browser = process.env.BLACKROOM_YTDLP_COOKIES_FROM_BROWSER || "chrome"): string[] {
  return browser.trim().toLowerCase() === "chrome" ? ["--cookies-from-browser", "chrome"] : [];
}

export interface BlackRoomInventoryVideo { id: string; title: string; duration: number; url?: string }
export interface BlackRoomEnergySample { timeSeconds: number; rmsDb: number }
export interface BlackRoomEditPlan {
  jobId: string; slot: string; targetDate: string; videoId: string; videoUrl: string; title: string; dj: string;
  language: "en" | "es"; format: "vertical" | "horizontal"; durationSeconds: BlackRoomExperimentDuration;
  windowStartSeconds: number; windowEndSeconds: number; caption: string; creativeStrategy: BlackRoomCreativeStrategy; targetNetworks: BlackRoomTargetNetwork[];
}

export async function commitBlackRoomReservation(
  persistLedger: () => Promise<void>,
  beginPreservingMedia: () => void,
  confirmReservation: () => void,
  recordActivity: () => Promise<void>,
): Promise<void> {
  // Preserve conservatively before starting the subprocess. A signal can arrive
  // after its atomic ledger rename but before execFile's promise resumes here.
  beginPreservingMedia();
  await persistLedger();
  confirmReservation();
  await recordActivity();
}

function stableNumber(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 12), 16);
}

export function blackRoomVideoUrl(video: Pick<BlackRoomInventoryVideo, "id" | "url">): string {
  const supplied = String(video.url || "");
  return /^https:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(supplied)
    ? supplied : `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
}

export function extractBlackRoomDj(title: string): string {
  const cleaned = String(title || "").replace(/\s+/g, " ").trim();
  const prefix = cleaned.split(/\s+(?:-|–|—)\s+|\s+DJ Set\b/i)[0]?.trim();
  return (prefix || "BlackRoom DJ").slice(0, 80);
}

function isActionableJob(job: BlackRoomDailyJob, now: Date): boolean {
  return ["queued", "retry", "processing"].includes(job.status)
    && (!job.notBefore || new Date(job.notBefore).getTime() <= now.getTime());
}

function distributedSlotSelected(index: number, total: number, target: number): boolean {
  const bounded = Math.max(0, Math.min(total, Math.floor(target)));
  return Math.floor((index + 1) * bounded / total) > Math.floor(index * bounded / total);
}

export function selectBlackRoomTargetNetworks(
  job: BlackRoomDailyJob,
  slot: BlackRoomDailyJob["slots"][number],
  queue: BlackRoomQueueState,
): BlackRoomTargetNetwork[] {
  if (slot.networks?.length) return [...new Set(slot.networks)];
  const slotIndex = Math.max(0, job.slots.findIndex((candidate) => candidate.localTime === slot.localTime));
  const total = Math.max(1, job.slots.length);
  const targets = { ...BLACKROOM_CEO_DEFAULT_NETWORK_TARGETS, ...(queue.analytics?.networkDailyTargets || {}) };
  const durations = job.requirements.durationsSeconds;
  const youtubeCandidateIndexes = job.slots
    .map((_, index) => ({ index, duration: durations[index % Math.max(1, durations.length)] }))
    .filter((candidate) => Number(candidate.duration || 0) <= 120)
    .map((candidate) => candidate.index);
  const networks = (["tiktok", "facebook", "youtube"] as BlackRoomTargetNetwork[])
    .filter((network) => {
      const requested = Number(targets[network] || 0);
      if (network !== "youtube") return distributedSlotSelected(slotIndex, total, requested);
      const candidateIndex = youtubeCandidateIndexes.indexOf(slotIndex);
      return candidateIndex >= 0
        && distributedSlotSelected(candidateIndex, youtubeCandidateIndexes.length, requested);
    });
  return networks.length ? networks : ["facebook"];
}

function chooseDuration(job: BlackRoomDailyJob, entries: BlackRoomLedgerEntry[], queue: BlackRoomQueueState, targetNetworks: BlackRoomTargetNetwork[]): BlackRoomExperimentDuration {
  const allowed = job.requirements.durationsSeconds
    .filter((duration): duration is BlackRoomExperimentDuration => [15, 30, 60, 120, 300, 600].includes(duration))
    .filter((duration) => !targetNetworks.includes("youtube") || duration <= 120);
  if (!allowed.length) throw new Error("BlackRoom job has no supported durations");
  const counts = new Map(allowed.map((duration) => [duration, entries.filter((entry) => entry.durationSeconds === duration).length]));
  const requiredSamples = Math.max(1, Number(job.requirements.minimumClipsPerDuration || 1));
  const unexplored = allowed.find((duration) => (counts.get(duration) || 0) < requiredSamples);
  if (unexplored) return unexplored;
  const provenDurations = new Set((queue.analytics?.durationPerformance || [])
    .filter((cohort) => Number(cohort.samples || 0) >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES)
    .map((cohort) => Number(cohort.durationSeconds)));
  const provenPreferred = (queue.analytics?.preferredDurations || [])
    .map(Number)
    .filter((duration): duration is BlackRoomExperimentDuration =>
      allowed.includes(duration as BlackRoomExperimentDuration) && provenDurations.has(duration))
    .slice(0, 2);
  if (provenPreferred.length) {
    const minimumPreferred = Math.min(...provenPreferred.map((duration) => counts.get(duration) || 0));
    return provenPreferred.find((duration) => counts.get(duration) === minimumPreferred)!;
  }
  if (Number(queue.analytics?.networkSamples?.tiktok || 0) >= 5
    && Number(queue.analytics?.tiktokLowViewRate || 0) >= 0.7) {
    const shortTests = allowed.filter((duration) => duration === 15 || duration === 30);
    if (shortTests.length) {
      const shortMinimum = Math.min(...shortTests.map((duration) => counts.get(duration) || 0));
      return shortTests.find((duration) => counts.get(duration) === shortMinimum)!;
    }
  }
  const minimum = Math.min(...counts.values());
  return allowed.find((duration) => counts.get(duration) === minimum)!;
}

function chooseLanguage(entries: BlackRoomLedgerEntry[]): "en" | "es" {
  return entries.filter((entry) => entry.language === "en").length <= entries.filter((entry) => entry.language === "es").length ? "en" : "es";
}

function chooseFormat(duration: BlackRoomExperimentDuration, entries: BlackRoomLedgerEntry[], targetNetworks: BlackRoomTargetNetwork[]): "vertical" | "horizontal" {
  if (duration >= 300) return "horizontal";
  if (targetNetworks.includes("youtube")) return "vertical";
  const vertical = entries.filter((entry) => entry.format === "vertical" && entry.durationSeconds < 300).length;
  const horizontal = entries.filter((entry) => entry.format === "horizontal" && entry.durationSeconds < 300).length;
  return vertical <= horizontal ? "vertical" : "horizontal";
}

function buildCaption(dj: string, language: "en" | "es", duration: number, seed: string, strategy: BlackRoomCreativeStrategy): string {
  const templates = language === "en"
    ? strategy === "instant_drop"
      ? [`No intro. ${dj} goes straight to the drop.`, `${dj} starts at full pressure.`, `The first second belongs to ${dj}.`]
      : strategy === "build_then_drop"
        ? [`Wait for ${dj} to flip this room.`, `The tension before ${dj}'s switch is the point.`, `Stay for the payoff from ${dj}.`]
        : [`${dj} found the drop. Stay for the switch.`, `The room changed when ${dj} hit this transition.`, `${duration >= 300 ? "Long-form session" : "Drop incoming"} with ${dj} at BlackRoom.`]
    : strategy === "instant_drop"
      ? [`Sin intro: ${dj} entra directo al drop.`, `${dj} empieza con presión total.`, `El primer segundo es de ${dj}.`]
      : strategy === "build_then_drop"
        ? [`Espera a que ${dj} cambie la sala.`, `La tensión antes del cambio de ${dj} es la clave.`, `Quédate para el golpe de ${dj}.`]
        : [`${dj} encontró el drop. Quédate para el cambio.`, `La sala cambió cuando ${dj} soltó esta transición.`, `${duration >= 300 ? "Sesión extendida" : "Se acerca el drop"} con ${dj} en BlackRoom.`];
  return `${templates[stableNumber(seed) % templates.length]} #BlackRoom #DJSet`;
}

function availableWindowStart(
  videoDuration: number,
  windowDuration: number,
  intervals: Array<{ start: number; end: number }>,
  seed: string,
): number | null {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const interval of sorted) {
    if (interval.start - cursor >= windowDuration) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (videoDuration - cursor >= windowDuration) gaps.push({ start: cursor, end: videoDuration });
  if (!gaps.length) return null;
  const gap = gaps[stableNumber(seed) % gaps.length];
  const maximumStart = Math.floor(gap.end - windowDuration);
  const minimumStart = Math.ceil(gap.start);
  return minimumStart + (maximumStart > minimumStart ? stableNumber(`${seed}:window`) % (maximumStart - minimumStart + 1) : 0);
}

export function planBlackRoomDeterministicEdit(input: {
  queue: BlackRoomQueueState; ledger: BlackRoomWorkerLedger; inventory: BlackRoomInventoryVideo[];
  priorityVideoId?: string | null; now?: Date;
}): BlackRoomEditPlan | null {
  const now = input.now || new Date();
  if (input.queue.enabled !== true) return null;
  // A discarded reservation had no remote publication attempt and no usable
  // local render. It is audit history only, never a consumed slot/source.
  const activeLedgerEntries = input.ledger.entries.filter((entry) => entry.status !== "discarded");
  const job = input.queue.jobs.find((candidate) => {
    if (!isActionableJob(candidate, now)) return false;
    const occupied = new Set(activeLedgerEntries.filter((entry) => entry.jobId === candidate.id).map((entry) => entry.slot));
    return candidate.slots.some((slot) => !occupied.has(slot.localTime));
  });
  if (!job) return null;
  const occupied = new Set(activeLedgerEntries.filter((entry) => entry.jobId === job.id).map((entry) => entry.slot));
  const slotConfig = job.slots.find((candidate) => !occupied.has(candidate.localTime));
  if (!slotConfig) return null;
  const slot = slotConfig.localTime;
  const jobEntries = activeLedgerEntries.filter((entry) => entry.jobId === job.id);
  const creativeStrategy: BlackRoomCreativeStrategy = input.queue.analytics?.creativeStrategy || "drop_first";
  const targetNetworks = selectBlackRoomTargetNetworks(job, slotConfig, input.queue);
  const durationSeconds = chooseDuration(job, jobEntries, input.queue, targetNetworks);
  const format = chooseFormat(durationSeconds, jobEntries, targetNetworks);
  const language = chooseLanguage(jobEntries);
  const margin = durationSeconds >= 300 ? 180 : 90;
  const windowDuration = durationSeconds + margin;
  const usedVideos = new Set([
    ...input.queue.sourceHistory.map((entry) => entry.videoId),
    ...(input.queue.failedSourceVideos || []).map((entry) => entry.videoId),
    ...activeLedgerEntries.map((entry) => entry.videoId),
  ]);
  const usedDjs = new Map<string, number>();
  for (const entry of jobEntries) usedDjs.set(entry.dj, (usedDjs.get(entry.dj) || 0) + 1);
  let eligible = input.inventory
    .filter((video) => video.id && Number.isFinite(video.duration) && video.duration >= windowDuration + 2)
    .map((video) => {
      const intervals = [
        ...input.queue.sourceHistory.filter((entry) => entry.videoId === video.id)
          .map((entry) => ({ start: entry.segmentStartSeconds, end: entry.segmentEndSeconds })),
        ...activeLedgerEntries.filter((entry) => entry.videoId === video.id)
          .map((entry) => ({ start: entry.segmentStartSeconds, end: entry.segmentEndSeconds })),
      ];
      const dj = extractBlackRoomDj(video.title);
      const windowStart = availableWindowStart(video.duration, windowDuration, intervals, `${job.id}:${slot}:${video.id}`);
      return { video, dj, windowStart };
    })
    .filter((candidate): candidate is { video: BlackRoomInventoryVideo; dj: string; windowStart: number } => candidate.windowStart !== null);
  if (usedDjs.size < Math.min(job.requirements.djs, job.requirements.posts)) {
    const unseen = eligible.filter((candidate) => !usedDjs.has(candidate.dj) && !usedVideos.has(candidate.video.id));
    if (!unseen.length) throw new Error(`BlackRoom needs ${job.requirements.djs} distinct DJs before reusing one`);
    eligible = unseen;
  } else {
    const belowTarget = eligible.filter((candidate) => !usedVideos.has(candidate.video.id)
      && usedDjs.has(candidate.dj)
      && (usedDjs.get(candidate.dj) || 0) < job.requirements.postsPerDj);
    if (!belowTarget.length) throw new Error("No unused source remains for the five selected DJs within the per-DJ quota");
    eligible = belowTarget;
  }
  if (!eligible.length) throw new Error(`No unused BlackRoom source can support a ${durationSeconds}s clip`);
  const priority = input.priorityVideoId
    ? eligible.find((candidate) => candidate.video.id === input.priorityVideoId)
    : undefined;
  const preferredDjs = new Set(input.queue.analytics?.preferredDjs || []);
  eligible.sort((left, right) => left.video.id.localeCompare(right.video.id));
  const preferredEligible = eligible.filter((candidate) => preferredDjs.has(candidate.dj));
  const selectionPool = preferredEligible.length ? preferredEligible : eligible;
  const seed = `${job.id}:${slot}:${durationSeconds}:${format}:${language}:${creativeStrategy}`;
  const selected = priority || selectionPool[stableNumber(seed) % selectionPool.length];
  const windowStartSeconds = selected.windowStart;
  return {
    jobId: job.id, slot, targetDate: job.targetDate, videoId: selected.video.id,
    videoUrl: blackRoomVideoUrl(selected.video), title: selected.video.title, dj: selected.dj,
    language, format, durationSeconds, creativeStrategy, targetNetworks, windowStartSeconds,
    windowEndSeconds: windowStartSeconds + windowDuration,
    caption: buildCaption(selected.dj, language, durationSeconds, seed, creativeStrategy),
  };
}

export function parseBlackRoomEnergySamples(output: string): BlackRoomEnergySample[] {
  const samples: BlackRoomEnergySample[] = [];
  let timeSeconds: number | null = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const time = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/)?.[1];
    if (time) timeSeconds = Number(time);
    const rms = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?inf|-?[0-9]+(?:\.[0-9]+)?)/i)?.[1];
    if (rms && timeSeconds !== null && !/inf/i.test(rms)) {
      samples.push({ timeSeconds, rmsDb: Number(rms) });
      timeSeconds = null;
    }
  }
  return samples.filter((sample) => Number.isFinite(sample.timeSeconds) && Number.isFinite(sample.rmsDb));
}

export function findBlackRoomDropOffset(
  samples: BlackRoomEnergySample[],
  durationSeconds: number,
  windowDurationSeconds: number,
  strategy: BlackRoomCreativeStrategy = "drop_first",
): number {
  const maximumStart = Math.max(0, windowDurationSeconds - durationSeconds);
  let best = { rise: Number.NEGATIVE_INFINITY, timeSeconds: 2 };
  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index], previous = samples[index - 1];
    const rise = current.rmsDb - previous.rmsDb;
    if (current.timeSeconds >= 2 && current.timeSeconds <= maximumStart + 5 && rise > best.rise) best = { rise, timeSeconds: current.timeSeconds };
  }
  const leadSeconds = strategy === "instant_drop" ? 0.25 : strategy === "build_then_drop" ? 4 : 2;
  return Math.max(0, Math.min(maximumStart, Math.round((best.timeSeconds - leadSeconds) * 10) / 10));
}

export function buildBlackRoomVideoFilter(format: "vertical" | "horizontal"): string {
  return format === "vertical"
    ? "scale=-2:1920,crop=1080:1920,setsar=1"
    : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1";
}

export function isOwnedBlackRoomMetadata(metadata: { channel_id?: unknown; uploader_id?: unknown }): boolean {
  return String(metadata.channel_id || "") === BLACKROOM_CHANNEL_ID
    || String(metadata.uploader_id || "").toLowerCase() === BLACKROOM_CHANNEL_HANDLE.toLowerCase();
}

export function buildBlackRoomYtDlpWindowArgs(plan: BlackRoomEditPlan, sourcePath: string, temporaryDirectory: string): string[] {
  return [
    plan.videoUrl,
    "--download-sections", `*${plan.windowStartSeconds}-${plan.windowEndSeconds}`,
    "--force-keyframes-at-cuts", "-f", "bestvideo*[height<=1080]+bestaudio/best[height<=1080]",
    // A network stall must fail fast so the local worker can retry the slot instead
    // of holding the whole production queue for its outer watchdog window.
    "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3",
    "--merge-output-format", "mp4", "--no-playlist", "--no-warnings", "--force-overwrites",
    "--paths", `temp:${temporaryDirectory}`, "-o", sourcePath,
  ];
}

export function buildBlackRoomRenderArgs(
  sourcePath: string,
  renderPath: string,
  plan: Pick<BlackRoomEditPlan, "format" | "durationSeconds">,
  offsetSeconds: number,
  encoder = "h264_videotoolbox",
): string[] {
  const bitrate = plan.durationSeconds >= 300 ? "5M" : "8M";
  const encoderOptions = encoder === "libx264" ? ["-preset", "veryfast"] : [];
  return [
    "-nostdin", "-hide_banner", "-y", "-ss", String(offsetSeconds), "-i", sourcePath,
    "-t", String(plan.durationSeconds), "-vf", buildBlackRoomVideoFilter(plan.format),
    "-c:v", encoder, ...encoderOptions, "-b:v", bitrate, "-maxrate", bitrate, "-bufsize", "10M",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", renderPath,
  ];
}
