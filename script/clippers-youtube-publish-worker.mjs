#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runYouTubeUpload, validateUploadItem } from "./clippers-youtube-uploader.mjs";

const LANES = Object.freeze({ motivation_es: "ES", motivation_en: "EN", sleep: "SLEEP" });
const SHORT_LANES = new Set(["motivation_es", "motivation_en"]);
const ACTIVE_STATES = new Set(["upload_started", "uncertain_outcome", "uploaded"]);
const SHA256 = /^[a-f0-9]{64}$/i;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{20,30}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,32}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY_LOCK_STALE_MS = 30 * 60 * 1000;

const clean = (value) => String(value ?? "").trim();

async function jsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function safeFile(root, relativeFile) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, clean(relativeFile));
  const relative = path.relative(resolvedRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, info] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(candidate).catch(() => null),
    lstat(candidate).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !info?.isFile() || info.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? candidate : null;
}

function dayInNewYork(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function secretPresent(value) {
  const normalized = clean(value);
  return Boolean(normalized && !/^(?:changeme|replace|example|todo|your[-_ ])/i.test(normalized));
}

function laneAuthBlockers(env, lane, itemChannelId) {
  const suffix = LANES[lane];
  if (!suffix) return ["lane_invalid"];
  const blockers = [];
  const expectedChannelId = clean(env[`CLIPPERS_YOUTUBE_${suffix}_CHANNEL_ID`]);
  if (!CHANNEL_ID.test(expectedChannelId)) blockers.push("expected_channel_id_missing_or_invalid");
  else if (clean(itemChannelId) !== expectedChannelId) blockers.push("item_channel_does_not_match_selected_channel");
  if (!["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN"].every((key) => secretPresent(env[`CLIPPERS_YOUTUBE_${suffix}_${key}`]))) {
    blockers.push("oauth_refresh_config_missing");
  }
  return blockers;
}

function queueBlockers(queue) {
  const blockers = [];
  if (Number(queue?.schemaVersion) !== 1) blockers.push("queue_schema_version_invalid");
  if (queue?.reviewed !== true || !clean(queue?.reviewedBy) || !Number.isFinite(Date.parse(clean(queue?.reviewedAt)))) {
    blockers.push("reviewed_upload_queue_required");
  }
  if (!clean(queue?.sourceReport?.file) || !SHA256.test(clean(queue?.sourceReport?.sha256))) blockers.push("source_report_reference_invalid");
  if (!Array.isArray(queue?.items)) blockers.push("queue_items_invalid");
  return blockers;
}

function queueItemBlockers(entry) {
  const blockers = [];
  if (!clean(entry?.itemFile)) blockers.push("item_file_missing");
  if (entry?.approved !== true || !clean(entry?.approvedBy) || !Number.isFinite(Date.parse(clean(entry?.approvedAt)))) {
    blockers.push("item_review_approval_missing");
  }
  if (!entry?.source || !["motivation_short", "sleep_long"].includes(clean(entry.source.type))) blockers.push("content_source_invalid");
  return blockers;
}

function exactSourceMatch(report, entry, item, workspaceRoot) {
  if (entry.source.type === "motivation_short") {
    const language = entry.source.language;
    const expectedLane = language === "es" ? "motivation_es" : language === "en" ? "motivation_en" : null;
    const results = report?.motivation?.[language]?.results;
    const row = Array.isArray(results) ? results.find((candidate) => candidate?.status === "rendered"
      && clean(candidate?.shortId) === clean(entry.source.shortId)) : null;
    return Boolean(row && item.lane === expectedLane
      && clean(row.outputFile) === clean(item.file)
      && clean(row.outputSha256).toLowerCase() === clean(item.sha256).toLowerCase());
  }
  const row = report?.sleep?.result;
  if (entry.source.type === "sleep_long") {
    const reportFile = path.isAbsolute(clean(row?.outputPath))
      ? path.relative(path.resolve(workspaceRoot), path.resolve(clean(row?.outputPath)))
      : clean(row?.outputPath);
    return row?.status === "generated" && item.lane === "sleep" && reportFile === clean(item.file);
  }
  return false;
}

async function evidenceBlockers(workspaceRoot, item) {
  const blockers = [];
  const mediaPath = await safeFile(workspaceRoot, item?.file);
  const rightsPath = await safeFile(workspaceRoot, item?.rightsEvidence?.file);
  const qaPath = await safeFile(workspaceRoot, item?.qaEvidence?.file);
  if (!mediaPath) blockers.push("media_missing_or_unsafe");
  if (!rightsPath) blockers.push("rights_evidence_missing_or_unsafe");
  if (!qaPath) blockers.push("qa_evidence_missing_or_unsafe");
  if (blockers.length) return blockers;
  let rights;
  let qa;
  try {
    [rights, qa] = await Promise.all([jsonFile(rightsPath), jsonFile(qaPath)]);
  } catch {
    return ["evidence_json_invalid"];
  }
  const [mediaHash, rightsHash, qaHash] = await Promise.all([
    sha256File(mediaPath), sha256File(rightsPath), sha256File(qaPath),
  ]);
  if (!SHA256.test(clean(item?.sha256)) || mediaHash !== clean(item.sha256).toLowerCase()) blockers.push("media_hash_mismatch");
  if (rightsHash !== clean(item?.rightsEvidence?.sha256).toLowerCase()) blockers.push("rights_evidence_hash_mismatch");
  if (qaHash !== clean(item?.qaEvidence?.sha256).toLowerCase()) blockers.push("qa_evidence_hash_mismatch");
  const rightsValid = Number(rights?.schemaVersion) === 1 && rights?.assetType === "youtube_video"
    && clean(rights?.itemId) === clean(item?.itemId) && clean(rights?.file) === clean(item?.file)
    && clean(rights?.sha256).toLowerCase() === mediaHash
    && ["owned", "explicitly_authorized"].includes(clean(rights?.rightsStatus))
    && rights?.commercialUseAuthorized === true && clean(rights?.verifiedBy)
    && Number.isFinite(Date.parse(clean(rights?.verifiedAt)));
  if (!rightsValid) blockers.push("rights_evidence_invalid");
  const checks = qa?.checks;
  const qaValid = Number(qa?.schemaVersion) === 1 && qa?.assetType === "youtube_video_qa"
    && clean(qa?.itemId) === clean(item?.itemId) && clean(qa?.file) === clean(item?.file)
    && clean(qa?.sha256).toLowerCase() === mediaHash && qa?.approved === true
    && checks?.playbackComplete === true && checks?.videoValid === true
    && checks?.audioValid === true && checks?.formatAccepted === true
    && clean(qa?.reviewedBy) && Number.isFinite(Date.parse(clean(qa?.reviewedAt)));
  if (!qaValid) blockers.push("qa_evidence_invalid");
  return blockers;
}

function activeRows(ledger) {
  return Array.isArray(ledger?.items) ? ledger.items.filter((row) => ACTIVE_STATES.has(clean(row?.status))) : [];
}

function uniqueOutcomes(rows) {
  const outcomes = new Map();
  for (const row of rows) {
    const key = clean(row?.itemId) || clean(row?.sha256).toLowerCase() || clean(row?.file);
    if (key) outcomes.set(key, row);
  }
  return [...outcomes.values()];
}

function duplicateBlocker(rows, item) {
  if (rows.some((row) => clean(row?.itemId) === clean(item?.itemId))) return "existing_or_uncertain_item_outcome";
  if (rows.some((row) => clean(row?.file) === clean(item?.file))) return "existing_or_uncertain_file_outcome";
  if (rows.some((row) => clean(row?.sha256).toLowerCase() === clean(item?.sha256).toLowerCase())) return "existing_or_uncertain_hash_outcome";
  return null;
}

function capBlocker(rows, lane, now, reserved) {
  const outcomes = uniqueOutcomes(rows);
  if (SHORT_LANES.has(lane)) {
    const today = dayInNewYork(now);
    const count = outcomes.filter((row) => row.lane === lane && Number.isFinite(Date.parse(row.recordedAt))
      && dayInNewYork(row.recordedAt) === today).length + (reserved[lane] || 0);
    return count >= 5 ? "daily_lane_upload_cap_reached" : null;
  }
  if (lane === "sleep") {
    const cutoff = now.getTime() - 7 * DAY_MS;
    const count = outcomes.filter((row) => row.lane === lane && Number.isFinite(Date.parse(row.recordedAt))
      && Date.parse(row.recordedAt) > cutoff).length + (reserved.sleep || 0);
    return count >= 1 ? "rolling_seven_day_sleep_upload_cap_reached" : null;
  }
  return "lane_invalid";
}

function publicBlockers(item, entry, env) {
  if ((clean(item?.privacyStatus) || "private") !== "public") return [];
  const authorization = item?.publishAuthorization;
  const queueAuthorization = entry?.publicAuthorization;
  const itemAuthorized = authorization?.public === true && clean(authorization?.authorizedBy)
    && Number.isFinite(Date.parse(clean(authorization?.authorizedAt)));
  const queueAuthorized = queueAuthorization?.public === true && clean(queueAuthorization?.authorizedBy)
    && Number.isFinite(Date.parse(clean(queueAuthorization?.authorizedAt)));
  return [
    ...(env.CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED === "true" ? [] : ["global_public_publish_authorization_missing"]),
    ...(itemAuthorized && queueAuthorized ? [] : ["per_item_public_authorization_missing"]),
  ];
}

async function acquireLock(lockPath) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const [existing, info] = await Promise.all([
        jsonFile(lockPath).catch(() => null),
        lstat(lockPath).catch(() => null),
      ]);
      const pid = Number(existing?.pid);
      const isOldEmptyLock = info?.size === 0 && Date.now() - info.mtimeMs > EMPTY_LOCK_STALE_MS;
      if (processAlive(pid) || (!pid && !isOldEmptyLock)) throw new Error("youtube_publish_worker_already_running");
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("youtube_publish_worker_lock_unavailable");
}

export async function runYouTubePublishWorker(options = {}) {
  const env = options.env || process.env;
  const now = options.now instanceof Date ? options.now : new Date();
  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const reportPath = path.join(workspaceRoot, "reports", "youtube-publish-worker-latest.json");
  const lockPath = path.join(workspaceRoot, "reports", "youtube-publish-worker.lock");
  const queuePath = await safeFile(workspaceRoot, options.queueFile);
  const runUpload = options.runUpload || runYouTubeUpload;
  const base = {
    schemaVersion: 1, runId: randomUUID(), generatedAt: now.toISOString(),
    apiCostUsd: 0, paidSpendAllowed: false, networkAllowedOnlyByUploader: true,
  };
  if (!queuePath) {
    const report = { ...base, status: "blocked", blockers: ["reviewed_upload_queue_missing_or_unsafe"], items: [] };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  }
  let queue;
  try { queue = await jsonFile(queuePath); } catch { queue = null; }
  const invalidQueue = queueBlockers(queue);
  if (invalidQueue.length) {
    const report = { ...base, status: "blocked", blockers: invalidQueue, items: [] };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  }
  const sourceReportPath = await safeFile(workspaceRoot, queue.sourceReport.file);
  if (!sourceReportPath || await sha256File(sourceReportPath) !== clean(queue.sourceReport.sha256).toLowerCase()) {
    const report = { ...base, status: "blocked", blockers: [sourceReportPath ? "source_report_hash_mismatch" : "source_report_missing_or_unsafe"], items: [] };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  }
  let sourceReport;
  try { sourceReport = await jsonFile(sourceReportPath); } catch { sourceReport = null; }
  if (Number(sourceReport?.schemaVersion) !== 1 || !["completed", "completed_with_shortfall"].includes(sourceReport?.status)) {
    const report = { ...base, status: "blocked", blockers: ["completed_content_worker_report_required"], items: [] };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  }
  let ledger;
  try {
    ledger = await jsonFile(path.join(workspaceRoot, "reports", "youtube-upload-ledger.json"));
    if (Number(ledger?.schemaVersion) !== 1 || !Array.isArray(ledger?.items)) throw new Error("invalid");
  } catch (error) {
    if (error?.code === "ENOENT") ledger = { schemaVersion: 1, items: [] };
    else {
      const report = { ...base, status: "blocked", blockers: ["youtube_upload_ledger_invalid"], items: [] };
      await atomicJson(reportPath, report);
      return { ...report, reportPath };
    }
  }
  const lock = await acquireLock(lockPath);
  const rows = activeRows(ledger);
  const acceptedThisRun = [];
  const reserved = { motivation_es: 0, motivation_en: 0, sleep: 0 };
  const outcomes = [];
  try {
    for (const entry of queue.items) {
      const entryProblems = queueItemBlockers(entry);
      const itemPath = entryProblems.length ? null : await safeFile(workspaceRoot, entry.itemFile);
      let item = null;
      if (!itemPath) entryProblems.push("item_manifest_missing_or_unsafe");
      else {
        try {
          item = await jsonFile(itemPath);
          entryProblems.push(...validateUploadItem(item));
        } catch { entryProblems.push("item_manifest_json_invalid"); }
      }
      const lane = clean(item?.lane) || null;
      if (item && !exactSourceMatch(sourceReport, entry, item, workspaceRoot)) entryProblems.push("item_not_in_completed_content_report");
      if (item) entryProblems.push(...await evidenceBlockers(workspaceRoot, item));
      if (item) entryProblems.push(...laneAuthBlockers(env, lane, item.channelId));
      if (item) entryProblems.push(...publicBlockers(item, entry, env));
      const duplicate = item ? duplicateBlocker([...rows, ...acceptedThisRun], item) : null;
      if (duplicate) entryProblems.push(duplicate);
      const cap = item ? capBlocker(rows, lane, now, reserved) : null;
      if (cap) entryProblems.push(cap);
      if (entryProblems.length) {
        outcomes.push({ itemId: clean(item?.itemId) || null, lane, status: "blocked", blockers: [...new Set(entryProblems)], uploadAttempted: false, apiCostUsd: 0 });
        continue;
      }
      reserved[lane] += 1;
      acceptedThisRun.push({ itemId: item.itemId, file: item.file, sha256: item.sha256, lane, status: "upload_started", recordedAt: now.toISOString() });
      const result = await runUpload({ workspaceRoot, itemFile: entry.itemFile, env, now });
      const returnedStatus = clean(result?.status) || "blocked";
      const returnedVideoId = clean(result?.youtubeVideoId);
      const uploadedResultValid = returnedStatus !== "uploaded"
        || (result?.uploadAttempted === true && VIDEO_ID.test(returnedVideoId));
      const status = uploadedResultValid ? returnedStatus : "uncertain_outcome";
      const blockers = uploadedResultValid
        ? (Array.isArray(result?.blockers) ? result.blockers : [])
        : ["uploader_result_invalid", "manual_youtube_reconciliation_required"];
      const confirmedVideoId = status === "uploaded" ? returnedVideoId : null;
      outcomes.push({
        itemId: clean(result?.itemId) || clean(item.itemId), lane,
        status, blockers,
        privacyStatus: clean(result?.privacyStatus) || clean(item.privacyStatus) || "private",
        uploadAttempted: result?.uploadAttempted === true,
        youtubeVideoId: confirmedVideoId,
        youtubeUrl: confirmedVideoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(confirmedVideoId)}` : null,
        apiCostUsd: 0,
      });
    }
    const uploaded = outcomes.filter((item) => item.status === "uploaded").length;
    const uncertain = outcomes.filter((item) => item.status === "uncertain_outcome").length;
    const report = {
      ...base,
      status: uncertain ? "completed_with_uncertain_outcomes" : outcomes.some((item) => item.status === "blocked") ? "completed_with_blockers" : "completed",
      sourceReport: queue.sourceReport.file,
      queued: queue.items.length,
      uploaded,
      uncertain,
      blocked: outcomes.filter((item) => item.status === "blocked").length,
      items: outcomes,
      blockers: [...new Set(outcomes.flatMap((item) => item.blockers))],
    };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const queueFile = cliValue("queue");
  if (!queueFile) {
    process.stdout.write(`${JSON.stringify({ status: "blocked", blockers: ["queue_argument_required"], apiCostUsd: 0 }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    runYouTubePublishWorker({ queueFile })
      .then((result) => {
        process.stdout.write(`${JSON.stringify({ status: result.status, reportPath: result.reportPath, uploaded: result.uploaded || 0 }, null, 2)}\n`);
        process.exitCode = result.status === "completed" ? 0 : 1;
      })
      .catch(() => {
        process.stdout.write(`${JSON.stringify({ status: "blocked", blockers: ["unexpected_publish_worker_failure"], apiCostUsd: 0 }, null, 2)}\n`);
        process.exitCode = 1;
      });
  }
}
