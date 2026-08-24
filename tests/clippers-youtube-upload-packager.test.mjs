import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { packageYouTubeUploads } from "../script/clippers-youtube-upload-packager.mjs";

const NOW = new Date("2026-08-24T16:00:00.000Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");

function fakeMediaCommands({ decodeFails = false, sleep = false } = {}) {
  const calls = [];
  return {
    calls,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (command === "ffmpeg" && decodeFails) throw new Error("decode error");
      if (command === "ffprobe") return { stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264", width: sleep ? 1920 : 1080, height: sleep ? 1080 : 1920, pix_fmt: "yuv420p" },
          { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
        ],
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: sleep ? "29100" : "26" },
      }) };
      return { stdout: "", stderr: "" };
    },
  };
}

async function fixture({ motivationCount = 1, includeSleep = false, privacy = "private", publicAuth = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "youtube-packager-"));
  await Promise.all(["reports/content-worker", "reports", "media", "manifests", "evidence/motivation", "sleep"].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  const report = {
    schemaVersion: 1, status: "completed", motivation: { es: { results: [] }, en: { results: [] } },
    sleep: { result: { status: "not_planned" } },
  };
  for (let index = 0; index < motivationCount; index += 1) {
    const shortId = `motiva-${index + 1}`;
    const manifestFile = `manifests/${shortId}.json`;
    const mediaFile = `media/${shortId}.mp4`;
    const provenanceFile = `evidence/motivation/${shortId}/provenance.json`;
    const media = Buffer.from(`valid-motivation-${index}`);
    const mediaHash = sha(media);
    const manifest = {
      schemaVersion: 1, shortId, channelId: "motivation-es", language: "es", topic: "disciplina",
      script: {
        hook: `La disciplina empieza hoy ${index + 1}`,
        beats: ["Haz una acción pequeña y repítela mañana."], close: "Empieza ahora.",
        originality: { status: "owned_original", author: "Equipo Clippers", thirdPartyQuotes: false, thirdPartySpeeches: false, sources: [] },
      },
      audio: { mode: "procedural_original", provenance: { status: "owned_original", generator: "ffmpeg_lavfi_anoisesrc_v1", thirdPartyAssets: false, networkUsed: false, paidCostUsd: 0 } },
    };
    await mkdir(path.dirname(path.join(root, provenanceFile)), { recursive: true });
    await writeFile(path.join(root, mediaFile), media);
    await writeFile(path.join(root, manifestFile), JSON.stringify(manifest));
    const row = {
      status: "rendered", shortId, outputFile: mediaFile, outputSha256: mediaHash,
      manifestFile, manifestSha256: sha(await readFile(path.join(root, manifestFile))),
      audioMode: "procedural_original", rights: { script: "owned_original", audio: "owned_original_procedural", thirdPartyMaterial: false },
      evidenceFrames: [{ file: `evidence/motivation/${shortId}/start.jpg` }],
    };
    await writeFile(path.join(root, provenanceFile), JSON.stringify({ schemaVersion: 1, ...row }));
    report.motivation.es.results.push(row);
  }
  if (includeSleep) {
    const outputPath = path.join(root, "sleep", "rain-8h.mp4");
    const media = Buffer.from("valid-sleep-media");
    const mediaHash = sha(media);
    await writeFile(outputPath, media);
    const manifestPath = `${outputPath}.rights.json`;
    const manifest = {
      schemaVersion: 1, artifactType: "rights_verified_visual_with_procedural_rain_audio", title: "Lluvia Nocturna — 8 Horas para Dormir",
      output: { path: outputPath, sha256: mediaHash },
      provenance: {
        externalAudioSamples: [], paidServicesUsed: [], networkAccessRequired: false, generatedForTestingOnly: false,
        generator: "script/clippers-sleep-video-generator.mjs",
        externalVisualAssets: [{ sha256: "a".repeat(64), evidenceSha256: "b".repeat(64), evidence: { rightsStatus: "owned_generated_output", commercialUseAuthorized: true, thirdPartyAssets: [] } }],
      },
      rights: { reviewRequiredBeforePublishing: true, publicationAuthorizedByThisManifest: false }, qa: { status: "passed" },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    report.sleep.result = { status: "generated", outputPath, manifestPath };
  }
  const sourceReport = "reports/content-worker/clippers-content-local-worker-latest.json";
  await writeFile(path.join(root, sourceReport), JSON.stringify(report));
  const config = {
    schemaVersion: 1, workspaceRoot: root, sourceReport,
    authorization: {
      blanketAuthorized: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:00:00.000Z",
      motivationShortsPerDayPerChannel: 5, sleepVideosPerRollingSevenDays: 1,
    },
    channels: {
      motivation_es: { channelId: "UC1234567890123456789012", privacyStatus: privacy, ...(publicAuth ? { publicAuthorization: publicAuth } : {}) },
      motivation_en: { channelId: "UCabcdefghijklmnopqrstuv", privacyStatus: "private" },
      sleep: { channelId: "UCZYXWVUTSRQPONMLKJIHGFE", privacyStatus: privacy, ...(publicAuth ? { publicAuthorization: publicAuth } : {}) },
    },
  };
  const configPath = path.join(root, "packager-config.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, report, config, configPath, sourceReport };
}

test("packages owned procedural motivation with full-decode QA and native metadata", async () => {
  const item = await fixture();
  const commands = fakeMediaCommands();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: commands });
  assert.equal(result.status, "completed");
  assert.equal(result.packaged, 1);
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  assert.equal(queue.reviewedBy, "Robert");
  assert.equal(queue.items.length, 1);
  const uploadItem = JSON.parse(await readFile(path.join(item.root, queue.items[0].itemFile), "utf8"));
  assert.match(uploadItem.description, /Motivación/);
  assert.equal(uploadItem.privacyStatus, "private");
  const rights = JSON.parse(await readFile(path.join(item.root, uploadItem.rightsEvidence.file), "utf8"));
  assert.equal(rights.sourceProvenance.proceduralAudioGenerator, "ffmpeg_lavfi_anoisesrc_v1");
  const qa = JSON.parse(await readFile(path.join(item.root, uploadItem.qaEvidence.file), "utf8"));
  assert.equal(qa.checks.playbackComplete, true);
  assert.ok(commands.calls.some((call) => call.command === "ffmpeg" && call.args.includes("-f") && call.args.includes("null")));
  assert.equal((await stat(path.join(item.root, queue.items[0].itemFile))).mode & 0o777, 0o600);
});

test("packages a production sleep artifact only from its SHA-linked rights manifest", async () => {
  const item = await fixture({ motivationCount: 0, includeSleep: true });
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands({ sleep: true }) });
  assert.equal(result.packaged, 1);
  assert.equal(result.items[0].lane, "sleep");
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  const uploadItem = JSON.parse(await readFile(path.join(item.root, queue.items[0].itemFile), "utf8"));
  assert.match(uploadItem.title, /Lluvia Nocturna/);
  const rights = JSON.parse(await readFile(path.join(item.root, uploadItem.rightsEvidence.file), "utf8"));
  assert.equal(rights.sourceProvenance.type, "owned_original_sleep_video");
});

test("fails a candidate closed when the complete ffmpeg decode fails", async () => {
  const item = await fixture();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands({ decodeFails: true }) });
  assert.equal(result.packaged, 0);
  assert.equal(result.blocked[0].blocker, "full_media_decode_failed");
});

test("rejects a rendered file whose hash no longer matches the completed report", async () => {
  const item = await fixture();
  await writeFile(path.join(item.root, item.report.motivation.es.results[0].outputFile), "tampered");
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(result.packaged, 0);
  assert.equal(result.blocked[0].blocker, "media_hash_mismatch");
});

test("enforces five Shorts per channel and one sleep video per rolling week", async () => {
  const item = await fixture({ motivationCount: 6, includeSleep: true });
  await writeFile(path.join(item.root, "reports/youtube-upload-ledger.json"), JSON.stringify({ schemaVersion: 1, items: [
    { lane: "motivation_es", itemId: "old-short", status: "uploaded", recordedAt: NOW.toISOString() },
    { lane: "sleep", itemId: "old-sleep", status: "uncertain_outcome", recordedAt: new Date(NOW.getTime() - DAY()).toISOString() },
  ] }));
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(result.items.filter((row) => row.lane === "motivation_es").length, 4);
  assert.ok(result.blocked.filter((row) => row.blocker === "daily_lane_upload_cap_reached").length >= 2);
  assert.ok(result.blocked.some((row) => row.blocker === "rolling_seven_day_sleep_upload_cap_reached"));
});

function DAY() { return 86_400_000; }

test("pins the reviewed queue to the exact completed report hash", async () => {
  const item = await fixture();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  assert.equal(queue.sourceReport.file, item.sourceReport);
  assert.equal(queue.sourceReport.sha256, sha(await readFile(path.join(item.root, item.sourceReport))));
});

test("rerun preserves and deduplicates an exact pinned reviewed queue", async () => {
  const item = await fixture();
  const first = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  const second = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(first.packaged, 1);
  assert.equal(second.packaged, 0);
  assert.equal(second.deduplicated.length, 1);
  const queue = JSON.parse(await readFile(path.join(item.root, second.queueFile), "utf8"));
  assert.equal(queue.items.length, 1);
});

test("rerun treats existing reviewed queue item files and hashes as active outcomes", async () => {
  const item = await fixture({ motivationCount: 2 });
  const firstRow = item.report.motivation.es.results[0];
  const secondRow = item.report.motivation.es.results[1];
  secondRow.outputFile = firstRow.outputFile;
  secondRow.outputSha256 = firstRow.outputSha256;
  const provenanceFile = path.join(item.root, "evidence/motivation", secondRow.shortId, "provenance.json");
  await writeFile(provenanceFile, JSON.stringify({ schemaVersion: 1, ...secondRow }));
  await writeFile(path.join(item.root, item.sourceReport), JSON.stringify(item.report));

  const first = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(first.packaged, 1);
  assert.equal(first.blocked[0].blocker, "duplicate_or_uncertain_outcome");

  const second = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(second.packaged, 0);
  assert.equal(second.deduplicated.length, 1);
  assert.equal(second.blocked[0].blocker, "duplicate_or_uncertain_outcome");
  const queue = JSON.parse(await readFile(path.join(item.root, second.queueFile), "utf8"));
  assert.equal(queue.items.length, 1);
});

test("requires the owner-reviewed config file to be mode 0600", async () => {
  const item = await fixture();
  await chmod(item.configPath, 0o644);
  await assert.rejects(() => packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() }), /config_must_be_owner_only_0600/);
});

test("public packaging requires separate explicit Robert authorization and writes it to item and queue", async () => {
  const missing = await fixture({ privacy: "public" });
  await assert.rejects(() => packageYouTubeUploads({ configPath: missing.configPath, now: NOW, operations: fakeMediaCommands() }), /explicit_public_authorization_required/);
  const publicAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:30:00.000Z" };
  const approved = await fixture({ privacy: "public", publicAuth: publicAuthorization });
  const result = await packageYouTubeUploads({ configPath: approved.configPath, now: NOW, operations: fakeMediaCommands() });
  const queue = JSON.parse(await readFile(path.join(approved.root, result.queueFile), "utf8"));
  const uploadItem = JSON.parse(await readFile(path.join(approved.root, queue.items[0].itemFile), "utf8"));
  assert.deepEqual(queue.items[0].publicAuthorization, publicAuthorization);
  assert.deepEqual(uploadItem.publishAuthorization, publicAuthorization);
  assert.equal(result.uploadAttempted, false);
});
