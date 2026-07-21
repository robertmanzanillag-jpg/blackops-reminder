import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeConfirmedDeletion,
  buildBlackRoomCodexArgs,
  buildBlackRoomWorkerPrompt,
  createBlackRoomLocalWorkerState,
  createBlackRoomWorkerLedger,
  reserveBlackRoomLedgerEntry,
  shouldRunBlackRoomWorker,
  updateBlackRoomLedgerEntry,
} from "../server/blackroom-local-worker";

const mediaDetails = {
  dj: "DJ Test", language: "en" as const, format: "vertical" as const, durationSeconds: 30 as const,
  segmentStartSeconds: 10, segmentEndSeconds: 40, caption: "Drop incoming.",
};

test("worker only runs for an enabled actionable queue", () => {
  assert.equal(shouldRunBlackRoomWorker({ enabled: false, jobs: [{ status: "queued" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "completed" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry" }] }), true);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry", notBefore: "2026-07-21T00:00:00.000Z" }] }, new Date("2026-07-20T23:00:00.000Z")), false);
});

test("worker state starts stopped and recoverable", () => {
  assert.deepEqual(createBlackRoomLocalWorkerState(), {
    running: false, workerPid: null, pid: null, startedAt: null, finishedAt: null, lastExitCode: null, lastError: null, runs: 0,
  });
});

test("uses only Codex exec flags supported by the installed noninteractive CLI", () => {
  const args = buildBlackRoomCodexArgs("/tmp/blackroom-project");
  assert.deepEqual(args.slice(0, 3), ["exec", "--ephemeral", "--color"]);
  assert.equal(args.includes("-a"), false);
  assert.equal(args.includes("workspace-write"), true);
  assert.ok(args.includes("sandbox_workspace_write.network_access=true"));
  assert.equal(args.at(-1), "-");
});

test("prompt contains posting and deletion safety gates", () => {
  const prompt = buildBlackRoomWorkerPrompt("/tmp/blackroom-project");
  assert.match(prompt, /EXACTAMENTE un post/);
  assert.match(prompt, /confirmaci[oó]n inequívoca de Metricool/i);
  assert.match(prompt, /No borres archivos directamente/);
  assert.match(prompt, /blackroom:ledger -- --delete-confirmed/);
  assert.match(prompt, /No resuelvas CAPTCHA/);
  assert.match(prompt, /Nunca repitas video fuente/);
  assert.match(prompt, /No abras ni navegues YouTube con Chrome/);
  assert.match(prompt, /\/opt\/homebrew\/bin\/yt-dlp/);
  assert.match(prompt, /Chrome se reserva para Metricool/);
  assert.match(prompt, /No descargues el set completo/);
  assert.match(prompt, /--download-sections/);
  assert.match(prompt, /tiempos absolutos del set original/);
});

test("ledger blocks duplicate slots and source videos", () => {
  const ledger = createBlackRoomWorkerLedger();
  reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-2",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/b.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/b.mp4",
  }), /slot already reserved/);
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "02:00", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/c.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/c.mp4",
  }), /source video already reserved/);
});

test("safe deletion requires confirmed Metricool receipt and exact media path", () => {
  const project = "/tmp/project";
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: `${project}/clippers_workspace/blackroom/rendered/a.mp4`,
    sourcePath: `${project}/clippers_workspace/blackroom/sources/a.mp4`,
  });
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, entry.renderPath), /confirmation is required/);
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "metricool-123" });
  assert.equal(assertSafeConfirmedDeletion(project, entry, entry.renderPath), entry.renderPath);
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, `${project}/package.json`), /not part of this reservation/);
});

test("ledger rejects a source already recorded in queue history", () => {
  const ledger = createBlackRoomWorkerLedger();
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-used",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  }, ["video-used"]), /already used by queue history/);
});

test("ledger rejects missing paths and non-finite segment boundaries", () => {
  const ledger = createBlackRoomWorkerLedger();
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1", renderPath: "", sourcePath: "",
  }), /Path.*required/);
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails, segmentEndSeconds: Number.NaN,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  }), /invalid segment/);
});
