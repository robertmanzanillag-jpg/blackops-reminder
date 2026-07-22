import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRotatingSlots,
  claimNextBlackRoomJob,
  completeBlackRoomJob,
  createBlackRoomQueueState,
  ensureBlackRoomScheduleBuffer,
  pauseBlackRoomAgent,
  recoverInterruptedBlackRoomJobs,
  recordBlackRoomSourceUsage,
  retryBlackRoomJob,
  startBlackRoomAgent,
  readBlackRoomQueue,
  writeBlackRoomQueue,
  withBlackRoomQueueLock,
  applyBlackRoomRemoteCommands,
} from "../server/blackroom-daily-queue";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("rotates 90-minute posting windows across the full day", () => {
  const overnight = buildRotatingSlots({ dayIndex: 0 });
  const late = buildRotatingSlots({ dayIndex: 1 });
  assert.equal(overnight.length, 7);
  assert.deepEqual(overnight.map((slot) => slot.localTime), ["00:30", "03:56", "07:21", "10:47", "14:13", "17:39", "21:04"]);
  assert.deepEqual(late.map((slot) => slot.localTime), ["02:00", "05:26", "08:51", "12:17", "15:43", "19:09", "22:34"]);
});

test("records source videos once and tracks short and long-form experiments", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-001", jobId: "job-1", dj: "DJ A", format: "vertical", language: "en", durationSeconds: 15, segmentStartSeconds: 10, segmentEndSeconds: 25 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-002", jobId: "job-1", dj: "DJ A", format: "horizontal", language: "es", durationSeconds: 30, segmentStartSeconds: 50, segmentEndSeconds: 80 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-003", jobId: "job-1", dj: "DJ B", format: "vertical", language: "en", durationSeconds: 60, segmentStartSeconds: 100, segmentEndSeconds: 160 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-004", jobId: "job-1", dj: "DJ B", format: "horizontal", language: "es", durationSeconds: 120, segmentStartSeconds: 200, segmentEndSeconds: 320 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-005", jobId: "job-1", dj: "DJ C", format: "vertical", language: "en", durationSeconds: 300, segmentStartSeconds: 300, segmentEndSeconds: 600 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-006", jobId: "job-1", dj: "DJ C", format: "horizontal", language: "es", durationSeconds: 600, segmentStartSeconds: 600, segmentEndSeconds: 1200 }, now);
  assert.deepEqual(state.sourceHistory.map((item) => item.durationSeconds), [15, 30, 60, 120, 300, 600]);
  assert.throws(() => recordBlackRoomSourceUsage(state, { videoId: "yt-001", jobId: "job-2", dj: "DJ C", format: "vertical", language: "es", durationSeconds: 15, segmentStartSeconds: 0, segmentEndSeconds: 15 }, now), /already used/);
});

test("keeps a two-week persistent scheduling buffer", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 14);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 0);
  assert.equal(state.jobs.length, 14);
  assert.equal(state.jobs[0].requirements.posts, 7);
  assert.equal(state.jobs[0].requirements.djs, 5);
  assert.equal(state.jobs[0].requirements.deleteOnlyAfterMetricoolConfirmation, true);
  assert.deepEqual(state.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
});

test("recovers an interrupted job after its lease expires", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  startBlackRoomAgent(state, 1, now);
  assert.equal(state.bufferDays, 14);
  const claimed = claimNextBlackRoomJob(state, now, 5);
  assert.equal(claimed?.status, "processing");
  assert.equal(recoverInterruptedBlackRoomJobs(state, new Date("2026-07-20T12:06:00.000Z")), 1);
  assert.equal(state.jobs[0].status, "retry");
  assert.match(state.jobs[0].lastError || "", /recuperado automáticamente/);
});

test("retries safely and completes only after explicit confirmation", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  startBlackRoomAgent(state, 1, now);
  const claimed = claimNextBlackRoomJob(state, now)!;
  const retried = retryBlackRoomJob(state, claimed.id, "Chrome cerrado", now);
  assert.equal(retried.status, "retry");
  assert.equal(retried.completedAt, null);
  const completed = completeBlackRoomJob(state, claimed.id, now);
  assert.equal(completed.status, "completed");
  assert.equal(completed.leaseExpiresAt, null);
});

test("starts weeks of work and pause prevents new claims", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  assert.equal(claimNextBlackRoomJob(state, now), null);
  assert.equal(startBlackRoomAgent(state, 2, now), 14);
  assert.equal(state.enabled, true);
  assert.equal(state.bufferDays, 14);
  assert.ok(claimNextBlackRoomJob(state, now));
  pauseBlackRoomAgent(state, now);
  assert.equal(state.enabled, false);
  assert.equal(claimNextBlackRoomJob(state, now), null);
});

test("applies remote quantity, extra-today and priority-source commands once", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const commands = [
    { id: "daily-12", type: "daily_target" as const, posts: 12, createdAt: now.toISOString() },
    { id: "extra-3", type: "extra_posts" as const, posts: 3, targetDate: state.jobs[0].targetDate, createdAt: now.toISOString() },
    { id: "source-1", type: "priority_source" as const, url: "https://youtu.be/video123", createdAt: now.toISOString() },
  ];
  assert.equal(applyBlackRoomRemoteCommands(state, commands, now), 3);
  assert.equal(state.postsPerDay, 12);
  assert.equal(state.jobs[0].requirements.posts, 15);
  assert.equal(state.prioritySources[0].status, "pending");
  assert.equal(applyBlackRoomRemoteCommands(state, commands, now), 0);
});

test("applies CEO analytics and learned slots only to pending days", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const targetDate = state.jobs[0].targetDate;
  const command = {
    id: "ceo-schedule", type: "ceo_schedule" as const, createdAt: now.toISOString(),
    slotsByDate: { [targetDate]: ["01:00", "04:00", "07:00", "10:00", "13:00", "16:00", "20:00"] },
    analytics: { sampleCount: 24, lastCheckedAt: now.toISOString(), nextCheckAt: now.toISOString(), confidence: "learning" as const, networkSamples: { tiktok: 24, facebook: 24, youtube: 24 }, recommendedTimes: ["13:00"], reason: "learning" },
  };
  assert.equal(applyBlackRoomRemoteCommands(state, [command], now), 1);
  assert.equal(state.analytics.sampleCount, 24);
  assert.deepEqual(state.jobs[0].slots.map((slot) => slot.localTime), command.slotsByDate[targetDate]);
});

test("daily target changes do not erase extra posts already requested for a date", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const targetDate = state.jobs[0].targetDate;
  applyBlackRoomRemoteCommands(state, [{ id: "extra", type: "extra_posts", posts: 3, targetDate, createdAt: now.toISOString() }], now);
  applyBlackRoomRemoteCommands(state, [{ id: "daily", type: "daily_target", posts: 8, createdAt: now.toISOString() }], now);
  assert.equal(state.jobs[0].requirements.posts, 11);
});

test("daily target cannot reduce the two-week campaign below seven posts", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  applyBlackRoomRemoteCommands(state, [{ id: "daily-low", type: "daily_target", posts: 1, createdAt: now.toISOString() }], now);
  assert.equal(state.postsPerDay, 7);
  assert.equal(state.jobs[0].requirements.posts, 7);
  assert.equal(state.jobs[0].slots.length, 7);
});

test("extra today creates exactly the requested future slots when today has no daily batch", () => {
  const now = new Date("2026-07-21T18:00:00.000Z"); // 14:00 America/New_York
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  assert.equal(state.jobs.some((job) => job.targetDate === "2026-07-21"), false);
  applyBlackRoomRemoteCommands(state, [{
    id: "extra-today", type: "extra_posts", posts: 3, targetDate: "2026-07-21", createdAt: now.toISOString(),
  }], now);
  const today = state.jobs.find((job) => job.targetDate === "2026-07-21");
  assert.equal(today?.requirements.posts, 3);
  assert.deepEqual(today?.slots.map((slot) => slot.localTime), ["14:15", "15:45", "17:15"]);
});

test("repeated extra-today commands add only the new amount to an ad hoc batch", () => {
  const now = new Date("2026-07-21T18:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  applyBlackRoomRemoteCommands(state, [{ id: "extra-3", type: "extra_posts", posts: 3, targetDate: "2026-07-21", createdAt: now.toISOString() }], now);
  applyBlackRoomRemoteCommands(state, [{ id: "extra-2", type: "extra_posts", posts: 2, targetDate: "2026-07-21", createdAt: now.toISOString() }], now);
  const today = state.jobs.find((job) => job.targetDate === "2026-07-21");
  assert.equal(today?.requirements.posts, 5);
  assert.deepEqual(today?.slots.map((slot) => slot.localTime), ["14:15", "15:45", "17:15", "18:45", "20:15"]);
});

test("migrates existing queued jobs into the long-form experiment", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs[0].requirements.durationsSeconds = [15, 30, 60];
  state.jobs[0].requirements.minimumClipsPerDuration = 2;
  state.bufferDays = 7;
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-queue-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(state, queuePath);
  const migrated = await readBlackRoomQueue(queuePath, now);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.bufferDays, 14);
  assert.deepEqual(migrated.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
  assert.equal(migrated.jobs[0].requirements.minimumClipsPerDuration, 1);
});

test("serializes concurrent queue mutations without losing source history", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-queue-lock-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(createBlackRoomQueueState(), queuePath);
  const mutate = (videoId: string, delayMs: number) => withBlackRoomQueueLock(queuePath, async () => {
    const state = await readBlackRoomQueue(queuePath);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    recordBlackRoomSourceUsage(state, {
      videoId, jobId: "job-1", dj: "DJ Test", format: "vertical", language: "en",
      durationSeconds: 15, segmentStartSeconds: 0, segmentEndSeconds: 15,
    });
    await writeBlackRoomQueue(state, queuePath);
  });
  await Promise.all([mutate("video-a", 50), mutate("video-b", 0)]);
  const finalState = await readBlackRoomQueue(queuePath);
  assert.deepEqual(finalState.sourceHistory.map((item) => item.videoId).sort(), ["video-a", "video-b"]);
});

test("does not steal a newly created lock before its PID is written", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-empty-lock-"));
  const queuePath = path.join(directory, "queue.json");
  const lockPath = `${queuePath}.lock`;
  await writeFile(lockPath, "", "utf8");
  let entered = false;
  await assert.rejects(
    withBlackRoomQueueLock(queuePath, async () => { entered = true; }, 75),
    /Timed out waiting/,
  );
  assert.equal(entered, false);
  await unlink(lockPath);
});
