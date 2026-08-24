#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const LANES = new Set(["motivation_es", "motivation_en", "sleep"]);
const PRIVACY = new Set(["private", "unlisted", "public"]);
const SHA256 = /^[a-f0-9]{64}$/i;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,30}$/;
const ACTIVE_UPLOAD_STATES = new Set(["upload_started", "uncertain_outcome", "uploaded"]);
const DAY_MS = 86_400_000;

const clean = (value) => String(value ?? "").trim();

async function jsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function optionalJson(filePath, fallback) {
  try {
    return await jsonFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function safeFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.isAbsolute(clean(candidate)) ? path.resolve(clean(candidate)) : path.resolve(resolvedRoot, clean(candidate));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, info] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(resolved).catch(() => null),
    lstat(resolved).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !info?.isFile() || info.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? resolved : null;
}

function safeRelative(root, filePath) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path_outside_workspace");
  return relative;
}

function authorizationBlockers(config) {
  const authorization = config?.authorization;
  const blockers = [];
  if (authorization?.blanketAuthorized !== true
    || clean(authorization?.authorizedBy).toLowerCase() !== "robert"
    || !Number.isFinite(Date.parse(clean(authorization?.authorizedAt)))) blockers.push("robert_blanket_authorization_required");
  if (Number(authorization?.motivationShortsPerDayPerChannel) !== 5) blockers.push("five_daily_shorts_per_channel_authorization_required");
  if (Number(authorization?.sleepVideosPerRollingSevenDays) !== 1) blockers.push("one_sleep_video_per_week_authorization_required");
  for (const lane of LANES) {
    const privacy = clean(config?.channels?.[lane]?.privacyStatus);
    if (!PRIVACY.has(privacy)) blockers.push(`${lane}_privacy_choice_required`);
    if (!CHANNEL_ID.test(clean(config?.channels?.[lane]?.channelId))) blockers.push(`${lane}_channel_missing_or_invalid`);
    if (privacy === "public") {
      const publicAuth = config?.channels?.[lane]?.publicAuthorization;
      if (publicAuth?.public !== true
        || clean(publicAuth?.authorizedBy).toLowerCase() !== "robert"
        || !Number.isFinite(Date.parse(clean(publicAuth?.authorizedAt)))) blockers.push(`${lane}_explicit_public_authorization_required`);
    }
  }
  return blockers;
}

function validateConfig(config) {
  const blockers = [];
  if (Number(config?.schemaVersion) !== 1) blockers.push("config_schema_version_invalid");
  if (!clean(config?.workspaceRoot)) blockers.push("workspace_root_required");
  if (!clean(config?.sourceReport)) blockers.push("source_report_required");
  blockers.push(...authorizationBlockers(config));
  return [...new Set(blockers)];
}

function slug(value) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function dayInNewYork(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 });
}

async function mediaQa(mediaPath, lane, run) {
  let probe;
  try {
    const result = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", mediaPath]);
    probe = JSON.parse(clean(result?.stdout));
  } catch {
    throw new Error("ffprobe_failed");
  }
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(probe?.format?.duration);
  const formatName = clean(probe?.format?.format_name);
  if (!video || !audio || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !formatName.includes("mp4")) throw new Error("media_streams_or_format_invalid");
  if (lane.startsWith("motivation_") && !(Number(video.width) < Number(video.height) && durationSeconds >= 20 && durationSeconds <= 40.2)) {
    throw new Error("motivation_media_dimensions_or_duration_invalid");
  }
  if (lane === "sleep" && !(Number(video.width) > Number(video.height) && durationSeconds >= 28_800)) {
    throw new Error("sleep_media_dimensions_or_duration_invalid");
  }
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", mediaPath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
  } catch {
    throw new Error("full_media_decode_failed");
  }
  return {
    playbackComplete: true,
    videoValid: true,
    audioValid: true,
    formatAccepted: true,
    durationSeconds,
    formatName,
    video: { codec: clean(video.codec_name), width: Number(video.width), height: Number(video.height), pixelFormat: clean(video.pix_fmt) },
    audio: { codec: clean(audio.codec_name), channels: Number(audio.channels), sampleRate: Number(audio.sample_rate) },
  };
}

async function motivationProvenance(root, row, language, actualHash) {
  const manifestPath = await safeFile(root, row?.manifestFile);
  if (!manifestPath || await sha256File(manifestPath) !== clean(row?.manifestSha256).toLowerCase()) throw new Error("motivation_manifest_hash_mismatch");
  const manifest = await jsonFile(manifestPath);
  if (clean(manifest?.shortId) !== clean(row?.shortId) || clean(manifest?.language).toLowerCase() !== language
    || manifest?.script?.originality?.status !== "owned_original"
    || manifest?.script?.originality?.thirdPartyQuotes !== false
    || manifest?.script?.originality?.thirdPartySpeeches !== false
    || !Array.isArray(manifest?.script?.originality?.sources) || manifest.script.originality.sources.length !== 0) {
    throw new Error("motivation_owned_script_provenance_invalid");
  }
  if (clean(row?.audioMode) !== "procedural_original"
    || manifest?.audio?.mode !== "procedural_original"
    || manifest?.audio?.provenance?.status !== "owned_original"
    || manifest?.audio?.provenance?.thirdPartyAssets !== false
    || manifest?.audio?.provenance?.networkUsed !== false
    || Number(manifest?.audio?.provenance?.paidCostUsd) !== 0
    || row?.rights?.script !== "owned_original"
    || row?.rights?.audio !== "owned_original_procedural"
    || row?.rights?.thirdPartyMaterial !== false) throw new Error("motivation_procedural_provenance_invalid");
  const firstFrame = Array.isArray(row?.evidenceFrames) ? row.evidenceFrames[0] : null;
  const provenanceRelative = firstFrame?.file ? path.join(path.dirname(clean(firstFrame.file)), "provenance.json") : null;
  const provenancePath = provenanceRelative ? await safeFile(root, provenanceRelative) : null;
  if (!provenancePath) throw new Error("motivation_render_provenance_missing");
  const provenance = await jsonFile(provenancePath);
  if (Number(provenance?.schemaVersion) !== 1 || clean(provenance?.shortId) !== clean(row.shortId)
    || clean(provenance?.outputFile) !== clean(row.outputFile)
    || clean(provenance?.outputSha256).toLowerCase() !== actualHash) throw new Error("motivation_render_provenance_invalid");
  const hook = clean(manifest?.script?.hook);
  const beats = Array.isArray(manifest?.script?.beats) ? manifest.script.beats.map(clean).filter(Boolean) : [];
  const close = clean(manifest?.script?.close);
  const title = hook.slice(0, 100);
  const description = [...beats, close, language === "es" ? "#Motivación #Disciplina #Shorts" : "#Motivation #Discipline #Shorts"].filter(Boolean).join("\n\n");
  if (!title || description.length > 5_000) throw new Error("motivation_native_metadata_invalid");
  return {
    rightsStatus: "owned",
    title,
    description,
    provenance: {
      type: "owned_original_motivation_short",
      sourceManifest: safeRelative(root, manifestPath),
      sourceManifestSha256: clean(row.manifestSha256).toLowerCase(),
      renderProvenance: safeRelative(root, provenancePath),
      renderProvenanceSha256: await sha256File(provenancePath),
      scriptAuthor: clean(manifest.script.originality.author),
      proceduralAudioGenerator: clean(manifest.audio.provenance.generator),
      thirdPartyAssets: false,
    },
  };
}

async function sleepProvenance(root, row, actualHash) {
  const manifestPath = await safeFile(root, row?.manifestPath);
  if (!manifestPath) throw new Error("sleep_rights_manifest_missing");
  const manifest = await jsonFile(manifestPath);
  const manifestOutput = await safeFile(root, manifest?.output?.path);
  const visuals = manifest?.provenance?.externalVisualAssets;
  const visual = Array.isArray(visuals) && visuals.length === 1 ? visuals[0] : null;
  if (Number(manifest?.schemaVersion) !== 1
    || manifest?.artifactType !== "rights_verified_visual_with_procedural_rain_audio"
    || manifestOutput !== await safeFile(root, row?.outputPath)
    || clean(manifest?.output?.sha256).toLowerCase() !== actualHash
    || !Array.isArray(manifest?.provenance?.externalAudioSamples) || manifest.provenance.externalAudioSamples.length !== 0
    || !Array.isArray(manifest?.provenance?.paidServicesUsed) || manifest.provenance.paidServicesUsed.length !== 0
    || manifest?.provenance?.networkAccessRequired !== false
    || manifest?.provenance?.generatedForTestingOnly !== false
    || !visual || visual?.evidence?.rightsStatus !== "owned_generated_output"
    || visual?.evidence?.commercialUseAuthorized !== true
    || !Array.isArray(visual?.evidence?.thirdPartyAssets) || visual.evidence.thirdPartyAssets.length !== 0
    || manifest?.rights?.reviewRequiredBeforePublishing !== true
    || manifest?.rights?.publicationAuthorizedByThisManifest !== false
    || manifest?.qa?.status !== "passed") throw new Error("sleep_rights_manifest_invalid");
  const title = clean(manifest.title).slice(0, 100);
  if (!title) throw new Error("sleep_native_title_missing");
  return {
    rightsStatus: "owned",
    title,
    description: "Relájate con lluvia nocturna y un ambiente original creado para dormir, descansar o estudiar.\n\n#Dormir #Lluvia #Relajación",
    provenance: {
      type: "owned_original_sleep_video",
      sleepRightsManifest: safeRelative(root, manifestPath),
      sleepRightsManifestSha256: await sha256File(manifestPath),
      generator: clean(manifest.provenance.generator),
      visualSha256: clean(visual.sha256),
      visualEvidenceSha256: clean(visual.evidenceSha256),
      thirdPartyAssets: false,
    },
  };
}

async function priorOutcomes(root, rootLedger, existingQueue) {
  const ledger = Array.isArray(rootLedger?.items)
    ? rootLedger.items.filter((row) => ACTIVE_UPLOAD_STATES.has(clean(row?.status)))
    : [];
  const queue = Array.isArray(existingQueue?.items) ? existingQueue.items : [];
  const queueItems = [];
  for (const entry of queue) {
    const itemPath = await safeFile(root, entry?.itemFile);
    if (!itemPath) throw new Error("existing_reviewed_queue_item_missing_or_unsafe");
    const item = await jsonFile(itemPath);
    if (!clean(item?.itemId) || !clean(item?.file) || !SHA256.test(clean(item?.sha256))) {
      throw new Error("existing_reviewed_queue_item_invalid");
    }
    queueItems.push(item);
  }
  return {
    ids: new Set([
      ...ledger.map((row) => clean(row.itemId)),
      ...queue.map((row) => clean(row.itemId)),
      ...queueItems.map((row) => clean(row.itemId)),
    ].filter(Boolean)),
    files: new Set([
      ...ledger.map((row) => clean(row.file)),
      ...queueItems.map((row) => clean(row.file)),
    ].filter(Boolean)),
    hashes: new Set([
      ...ledger.map((row) => clean(row.sha256).toLowerCase()),
      ...queueItems.map((row) => clean(row.sha256).toLowerCase()),
    ].filter(Boolean)),
    ledger,
  };
}

function remainingCapacity(lane, now, ledger, reserved) {
  if (lane === "sleep") {
    const cutoff = now.getTime() - 7 * DAY_MS;
    const used = ledger.filter((row) => clean(row.lane) === lane && Number.isFinite(Date.parse(row.recordedAt)) && Date.parse(row.recordedAt) > cutoff).length;
    return Math.max(0, 1 - used - reserved);
  }
  const today = dayInNewYork(now);
  const used = ledger.filter((row) => clean(row.lane) === lane && Number.isFinite(Date.parse(row.recordedAt)) && dayInNewYork(row.recordedAt) === today).length;
  return Math.max(0, 5 - used - reserved);
}

function contentRows(report) {
  const rows = [];
  for (const language of ["es", "en"]) {
    for (const row of Array.isArray(report?.motivation?.[language]?.results) ? report.motivation[language].results : []) {
      if (row?.status === "rendered") rows.push({ lane: `motivation_${language}`, language, row });
    }
  }
  if (report?.sleep?.result?.status === "generated") rows.push({ lane: "sleep", row: report.sleep.result });
  return rows;
}

export async function packageYouTubeUploads({ configPath, now = new Date(), operations = {} }) {
  const configAbsolute = path.resolve(configPath);
  const configInfo = await lstat(configAbsolute);
  if (!configInfo.isFile() || configInfo.isSymbolicLink()) throw new Error("config_must_be_regular_file");
  if ((configInfo.mode & 0o777) !== 0o600) throw new Error("config_must_be_owner_only_0600");
  const config = await jsonFile(configAbsolute);
  const configProblems = validateConfig(config);
  if (configProblems.length) throw new Error(configProblems.join(","));
  const root = path.resolve(path.dirname(configAbsolute), config.workspaceRoot);
  const reportPath = await safeFile(root, config.sourceReport);
  if (!reportPath) throw new Error("source_report_missing_or_unsafe");
  const report = await jsonFile(reportPath);
  if (Number(report?.schemaVersion) !== 1 || !["completed", "completed_with_shortfall"].includes(report?.status)) throw new Error("completed_content_worker_report_required");
  const sourceReportSha256 = await sha256File(reportPath);
  const ledger = await optionalJson(path.join(root, "reports", "youtube-upload-ledger.json"), { schemaVersion: 1, items: [] });
  if (Number(ledger?.schemaVersion) !== 1 || !Array.isArray(ledger?.items)) throw new Error("youtube_upload_ledger_invalid");
  const queuePath = path.join(root, "youtube", "reviewed-upload-queue.json");
  const existingQueue = await optionalJson(queuePath, { schemaVersion: 1, items: [] });
  if (Number(existingQueue?.schemaVersion) !== 1 || !Array.isArray(existingQueue?.items)) throw new Error("existing_reviewed_queue_invalid");
  const existingQueueSameSource = existingQueue.items.length > 0
    && clean(existingQueue?.sourceReport?.sha256).toLowerCase() === sourceReportSha256;
  if (existingQueue.items.length > 0 && !existingQueueSameSource) throw new Error("existing_reviewed_queue_pins_different_source_report");
  const prior = await priorOutcomes(root, ledger, existingQueue);
  const accepted = [];
  const blocked = [];
  const deduplicated = [];
  const reserved = { motivation_es: 0, motivation_en: 0, sleep: 0 };
  const run = operations.runCommand || runCommand;
  for (const candidate of contentRows(report)) {
    const { lane, row } = candidate;
    try {
      if (!LANES.has(lane)) throw new Error("lane_invalid");
      if (remainingCapacity(lane, now, prior.ledger, reserved[lane]) <= 0) throw new Error(lane === "sleep" ? "rolling_seven_day_sleep_upload_cap_reached" : "daily_lane_upload_cap_reached");
      const sourceFile = lane === "sleep" ? row.outputPath : row.outputFile;
      const mediaPath = await safeFile(root, sourceFile);
      if (!mediaPath) throw new Error("media_missing_or_unsafe");
      const file = safeRelative(root, mediaPath);
      const mediaHash = await sha256File(mediaPath);
      if (lane !== "sleep" && mediaHash !== clean(row.outputSha256).toLowerCase()) throw new Error("media_hash_mismatch");
      const itemId = lane === "sleep" ? `yt-sleep-${mediaHash.slice(0, 16)}` : `yt-${lane}-${slug(row.shortId)}`;
      if (existingQueueSameSource && prior.ids.has(itemId)) {
        deduplicated.push({ itemId, lane, reason: "already_in_exact_reviewed_queue" });
        continue;
      }
      if (prior.ids.has(itemId) || prior.files.has(file) || prior.hashes.has(mediaHash)
        || accepted.some((entry) => entry.item.itemId === itemId || entry.item.file === file || entry.item.sha256 === mediaHash)) throw new Error("duplicate_or_uncertain_outcome");
      const source = lane === "sleep"
        ? await sleepProvenance(root, row, mediaHash)
        : await motivationProvenance(root, row, candidate.language, mediaHash);
      const qa = await mediaQa(mediaPath, lane, run);
      const channel = config.channels[lane];
      const rightsFile = `youtube/rights/${itemId}.json`;
      const qaFile = `youtube/qa/${itemId}.json`;
      const itemFile = `youtube/items/${itemId}.json`;
      const rights = {
        schemaVersion: 1, assetType: "youtube_video", itemId, file, sha256: mediaHash,
        rightsStatus: source.rightsStatus, commercialUseAuthorized: true,
        verifiedBy: config.authorization.authorizedBy, verifiedAt: now.toISOString(),
        sourceProvenance: source.provenance,
      };
      await atomicJson(path.join(root, rightsFile), rights);
      const rightsHash = await sha256File(path.join(root, rightsFile));
      const qaEvidence = {
        schemaVersion: 1, assetType: "youtube_video_qa", itemId, file, sha256: mediaHash,
        approved: true, checks: qa, reviewedBy: config.authorization.authorizedBy, reviewedAt: now.toISOString(),
        toolchain: { probe: "ffprobe", fullDecode: "ffmpeg" },
      };
      await atomicJson(path.join(root, qaFile), qaEvidence);
      const qaHash = await sha256File(path.join(root, qaFile));
      const privacyStatus = channel.privacyStatus;
      const item = {
        schemaVersion: 1, itemId, lane, channelId: clean(channel.channelId), file, sha256: mediaHash,
        title: source.title, description: source.description, privacyStatus,
        rightsEvidence: { file: rightsFile, sha256: rightsHash },
        qaEvidence: { file: qaFile, sha256: qaHash },
        ...(privacyStatus === "public" ? { publishAuthorization: channel.publicAuthorization } : {}),
      };
      await atomicJson(path.join(root, itemFile), item);
      const queueEntry = {
        itemId, itemFile, approved: true, approvedBy: config.authorization.authorizedBy, approvedAt: now.toISOString(),
        source: lane === "sleep" ? { type: "sleep_long" } : { type: "motivation_short", language: candidate.language, shortId: row.shortId },
        ...(privacyStatus === "public" ? { publicAuthorization: channel.publicAuthorization } : {}),
      };
      accepted.push({ item, queueEntry });
      reserved[lane] += 1;
    } catch (error) {
      blocked.push({ lane, sourceId: clean(row?.shortId) || clean(row?.outputPath) || null, blocker: clean(error?.message) || "packaging_failed" });
    }
  }
  const queue = {
    schemaVersion: 1, reviewed: true, reviewedBy: config.authorization.authorizedBy, reviewedAt: now.toISOString(),
    sourceReport: { file: safeRelative(root, reportPath), sha256: sourceReportSha256 },
    authorization: {
      motivationShortsPerDayPerChannel: 5, sleepVideosPerRollingSevenDays: 1,
      source: "explicit_owner_config", authorizedAt: config.authorization.authorizedAt,
    },
    items: [...(existingQueueSameSource ? existingQueue.items : []), ...accepted.map((entry) => entry.queueEntry)],
  };
  await atomicJson(queuePath, queue);
  const result = {
    schemaVersion: 1, generatedAt: now.toISOString(), status: blocked.length ? "completed_with_blockers" : "completed",
    sourceReport: queue.sourceReport, packaged: accepted.length, deduplicated, blocked, queueFile: safeRelative(root, queuePath),
    uploadAttempted: false, networkUsed: false, credentialsRead: false, apiCostUsd: 0, paidSpendAllowed: false,
    items: accepted.map((entry) => ({ itemId: entry.item.itemId, lane: entry.item.lane, itemFile: entry.queueEntry.itemFile, privacyStatus: entry.item.privacyStatus })),
  };
  await atomicJson(path.join(root, "reports", "youtube-upload-packager-latest.json"), result);
  return result;
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const configPath = cliValue("config");
  if (!configPath) throw new Error("Usage: node script/clippers-youtube-upload-packager.mjs --config /absolute/path/config.json");
  const result = await packageYouTubeUploads({ configPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
