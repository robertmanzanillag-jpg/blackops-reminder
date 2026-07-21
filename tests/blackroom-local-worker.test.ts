import assert from "node:assert/strict";
import test from "node:test";
import {
  BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES,
  BLACKROOM_FFPROBE_SHOW_ENTRIES,
  buildBlackRoomUploadChunks,
  assertSafeConfirmedDeletion,
  buildBlackRoomCodexArgs,
  buildBlackRoomWorkerPrompt,
  createBlackRoomLocalWorkerState,
  createBlackRoomWorkerLedger,
  nextBlackRoomPublicationDateTime,
  isBlackRoomJobPublishable,
  reserveBlackRoomLedgerEntry,
  selectPublishableBlackRoomReservation,
  shouldRunBlackRoomWorker,
  updateBlackRoomLedgerEntry,
  validateBlackRoomRenderProbe,
  validateBlackRoomAudioLoudness,
} from "../server/blackroom-local-worker";

const mediaDetails = {
  dj: "DJ Test", language: "en" as const, format: "vertical" as const, durationSeconds: 30 as const,
  segmentStartSeconds: 10, segmentEndSeconds: 40, caption: "Drop incoming.",
};

test("splits remote video uploads below Replit's per-request limit", () => {
  const totalBytes = BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2 + 123;
  assert.deepEqual(buildBlackRoomUploadChunks(totalBytes), [
    { index: 0, start: 0, end: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES - 1, size: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES },
    { index: 1, start: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES, end: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2 - 1, size: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES },
    { index: 2, start: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2, end: totalBytes - 1, size: 123 },
  ]);
  assert.throws(() => buildBlackRoomUploadChunks(0), /Invalid BlackRoom upload size/);
});

test("worker only runs for an enabled actionable queue", () => {
  assert.equal(shouldRunBlackRoomWorker({ enabled: false, jobs: [{ status: "queued" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "completed" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry" }] }), true);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry", notBefore: "2026-07-21T00:00:00.000Z" }] }, new Date("2026-07-20T23:00:00.000Z")), false);
});

test("publishing gate honors pause and skips stale reservations", () => {
  const queue = {
    enabled: true,
    jobs: [
      { id: "completed-job", status: "completed" },
      { id: "active-job", status: "retry", notBefore: "2026-07-21T00:00:00.000Z" },
    ],
  };
  const entries = [
    { status: "reserved", jobId: "missing-job", reservationId: "stale-1" },
    { status: "reserved", jobId: "completed-job", reservationId: "stale-2" },
    { status: "reserved", jobId: "active-job", reservationId: "ready" },
  ];
  const now = new Date("2026-07-21T01:00:00.000Z");
  assert.equal(selectPublishableBlackRoomReservation(queue, entries, now)?.reservationId, "ready");
  assert.equal(selectPublishableBlackRoomReservation(queue, [{ status: "uncertain", jobId: "active-job", reservationId: "verify-only" }], now)?.reservationId, "verify-only");
  assert.equal(isBlackRoomJobPublishable({ ...queue, enabled: false }, "active-job", now), false);
  assert.equal(selectPublishableBlackRoomReservation({ ...queue, enabled: false }, entries, now), null);
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

test("prompt stops after rendering and reservation so deterministic publisher owns Metricool", () => {
  const prompt = buildBlackRoomWorkerPrompt("/tmp/blackroom-project");
  assert.match(prompt, /EXACTAMENTE un video/);
  assert.match(prompt, /no abras Chrome ni intentes entrar en Metricool/i);
  assert.match(prompt, /Termina justo después de que la reserva/i);
  assert.match(prompt, /No confirmes, no marques uncertain, no borres archivos/i);
  assert.match(prompt, /no resuelvas CAPTCHA/i);
  assert.match(prompt, /Nunca repitas video fuente/);
  assert.match(prompt, /No abras ni navegues YouTube con Chrome/);
  assert.match(prompt, /\/opt\/homebrew\/bin\/yt-dlp/);
  assert.match(prompt, /No descargues el set completo/);
  assert.match(prompt, /--download-sections/);
  assert.match(prompt, /tiempos absolutos del set original/);
  assert.match(prompt, /debajo de 500 MB/);
  assert.match(prompt, /cercano a 5 Mbps/);
  assert.match(prompt, /TikTok @blackroom\.clipss, la página de clips de Facebook y YouTube Shorts/);
  assert.match(prompt, /evidencia inequívoca de Metricool para TikTok, Facebook/);
  assert.match(prompt, /enlace exacto del video completo de YouTube/);
  assert.match(prompt, /verticales de hasta 178 segundos también se publican como Shorts/);
});

test("past BlackRoom slots roll forward while future slots keep their target date", () => {
  const now = new Date("2026-07-21T07:00:00.000Z"); // 03:00 in New York.
  assert.equal(nextBlackRoomPublicationDateTime("2026-07-21", "05:00", "America/New_York", now), "2026-07-21T05:00:00");
  assert.equal(nextBlackRoomPublicationDateTime("2026-07-21", "00:30", "America/New_York", now), "2026-07-22T00:30:00");
});

test("validates Metricool and TikTok compatible MP4 renders", () => {
  assert.match(BLACKROOM_FFPROBE_SHOW_ENTRIES, /stream=.*duration.*channels/);
  const valid = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30.02" },
    streams: [
      { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920 },
      { codec_type: "audio", codec_name: "aac", channels: 2, duration: "30.02" },
    ],
  };
  assert.deepEqual(validateBlackRoomRenderProbe(valid, 30), { durationSeconds: 30.02, width: 1080, height: 1920 });
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [{ ...valid.streams[0], codec_name: "hevc" }, valid.streams[1]] }, 30), /H\.264/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, format: { ...valid.format, duration: "25" } }, 30), /duration/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [valid.streams[0], { ...valid.streams[1], duration: "2" }] }, 30), /audio track/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [valid.streams[0], { ...valid.streams[1], channels: 0 }] }, 30), /audio track/);
});

test("rejects silent or nearly silent DJ audio before upload", () => {
  assert.deepEqual(validateBlackRoomAudioLoudness("mean_volume: -12.4 dB\nmax_volume: -0.8 dB"), { meanVolumeDb: -12.4, maxVolumeDb: -0.8 });
  assert.throws(() => validateBlackRoomAudioLoudness("mean_volume: -inf dB\nmax_volume: -inf dB"), /silent/);
  assert.throws(() => validateBlackRoomAudioLoudness("mean_volume: -50.0 dB\nmax_volume: -35.0 dB"), /audible-volume/);
  assert.throws(() => validateBlackRoomAudioLoudness("no volumedetect summary"), /silent/);
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

test("uncertain reservations persist their exact Metricool schedule for verification-only recovery", () => {
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "uncertain", publicationDateTime: "2026-07-22T00:30:00" });
  assert.equal(entry.status, "uncertain");
  assert.equal(entry.publicationDateTime, "2026-07-22T00:30:00");
  assert.throws(() => updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "uncertain", publicationDateTime: "tomorrow" }), /invalid Metricool publication date/);
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
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, entry.renderPath), /confirmations are required/);
  assert.throws(() => updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "metricool-123" }), /complete Metricool receipts/);
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "tiktok:991|facebook:992|youtube:993" });
  assert.equal(assertSafeConfirmedDeletion(project, entry, entry.renderPath), entry.renderPath);
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, `${project}/package.json`), /not part of this reservation/);

  const legacy = { ...entry, renderPath: `${project}/clippers_workspace/blackroom/renders/legacy.mp4` };
  assert.equal(assertSafeConfirmedDeletion(project, legacy, legacy.renderPath), legacy.renderPath);

  const historicalSingleNetwork = { ...entry, metricoolId: "991", renderPath: `${project}/clippers_workspace/blackroom/renders/old.mp4` };
  assert.throws(() => assertSafeConfirmedDeletion(project, historicalSingleNetwork, historicalSingleNetwork.renderPath), /complete Metricool confirmations/);
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
