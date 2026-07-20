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
} from "../server/blackroom-daily-queue";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("rotates 90-minute posting windows across the full day", () => {
  const overnight = buildRotatingSlots({ dayIndex: 0 });
  const late = buildRotatingSlots({ dayIndex: 1 });
  assert.equal(overnight.length, 10);
  assert.deepEqual(overnight.map((slot) => slot.localTime), ["00:30", "02:00", "03:30", "05:00", "06:30", "08:00", "09:30", "11:00", "12:30", "14:00"]);
  assert.deepEqual(late.map((slot) => slot.localTime), ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30", "19:00", "20:30", "22:00", "23:30"]);
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

test("keeps a one-week persistent scheduling buffer", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 7);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 0);
  assert.equal(state.jobs.length, 7);
  assert.equal(state.jobs[0].requirements.posts, 10);
  assert.equal(state.jobs[0].requirements.djs, 5);
  assert.equal(state.jobs[0].requirements.deleteOnlyAfterMetricoolConfirmation, true);
  assert.deepEqual(state.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
});

test("recovers an interrupted job after its lease expires", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  startBlackRoomAgent(state, 1, now);
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

test("migrates existing queued jobs into the long-form experiment", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs[0].requirements.durationsSeconds = [15, 30, 60];
  state.jobs[0].requirements.minimumClipsPerDuration = 2;
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-queue-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(state, queuePath);
  const migrated = await readBlackRoomQueue(queuePath, now);
  assert.deepEqual(migrated.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
  assert.equal(migrated.jobs[0].requirements.minimumClipsPerDuration, 1);
});
