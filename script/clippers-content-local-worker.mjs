#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runContentLearningCeo } from "./clippers-content-learning-ceo.mjs";
import { renderMotivationShort } from "./clippers-motivation-shorts.mjs";
import { generateSleepVideo } from "./clippers-sleep-video-generator.mjs";

const LANGUAGES = ["es", "en"];
const DEFAULT_TIMEOUT_MS = 14 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (value) => String(value ?? "").trim();

async function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label}_json_invalid`);
    throw error;
  }
  return parsed;
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function within(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, clean(candidate));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label}_outside_workspace`);
  return resolved;
}

function validateConfig(config, configPath) {
  if (config?.schemaVersion !== 1) throw new Error("config_schema_version_invalid");
  const base = path.dirname(configPath);
  const workspaceRoot = path.resolve(base, clean(config.workspaceRoot));
  if (!clean(config.workspaceRoot)) throw new Error("workspace_root_required");
  const metricsLedgerPath = within(workspaceRoot, config.metricsLedger, "metrics_ledger");
  const reportDir = within(workspaceRoot, config.reportDir, "report_dir");
  const timeoutMs = Number(config.operationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > MAX_TIMEOUT_MS) throw new Error("operation_timeout_invalid");
  const motivation = {};
  for (const language of LANGUAGES) {
    const lane = config?.motivation?.[language];
    if (!lane || !clean(lane.channelId)) throw new Error(`motivation_${language}_channel_required`);
    if (!Array.isArray(lane.manifestFiles)) throw new Error(`motivation_${language}_manifests_required`);
    if (lane.manifestFiles.length > 100) throw new Error(`motivation_${language}_manifest_limit_exceeded`);
    motivation[language] = {
      channelId: clean(lane.channelId),
      manifestFiles: [...new Set(lane.manifestFiles.map(clean).filter(Boolean))],
      gates: lane.gates || {},
    };
  }
  const sleep = config.sleep || {};
  if (sleep.enabled === true) {
    for (const field of ["output", "visualSource", "visualSha256", "visualRightsEvidence", "title"]) {
      if (!clean(sleep[field])) throw new Error(`sleep_${field}_required`);
    }
  }
  return {
    workspaceRoot, metricsLedgerPath, reportDir, timeoutMs, motivation,
    sleep: sleep.enabled === true ? {
      enabled: true,
      outputPath: within(workspaceRoot, sleep.output, "sleep_output"),
      visualSource: within(workspaceRoot, sleep.visualSource, "sleep_visual"),
      visualRightsEvidence: within(workspaceRoot, sleep.visualRightsEvidence, "sleep_visual_rights"),
      visualSha256: clean(sleep.visualSha256),
      title: clean(sleep.title),
      durationSeconds: Number(sleep.durationSeconds ?? 29_100),
      seed: Number(sleep.seed ?? 20_260_824),
    } : { enabled: false },
    learning: config.learning || {},
  };
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

export async function acquireWorkerLock(lockPath, now = new Date()) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, acquiredAt: now.toISOString() })}\n`);
      await handle.close();
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJson(lockPath, "worker_lock").catch(() => null);
      if (processAlive(Number(existing?.pid))) throw new Error("content_worker_already_running");
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("content_worker_lock_unavailable");
}

async function releaseWorkerLock(lock) {
  const existing = await readJson(lock.lockPath, "worker_lock").catch(() => null);
  if (existing?.pid === process.pid && existing?.token === lock.token) await rm(lock.lockPath, { force: true });
}

async function withTimeout(task, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function candidateIdentity(workspaceRoot, manifestFile) {
  try {
    const manifestPath = within(workspaceRoot, manifestFile, "motivation_manifest");
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const manifest = await readJson(manifestPath, "motivation_manifest");
    return { channelId: clean(manifest?.channelId), language: clean(manifest?.language).toLowerCase() };
  } catch {
    return null;
  }
}

function recentSleepRows(ledger, now) {
  const rows = Array.isArray(ledger?.items) ? ledger.items : [];
  const cutoff = now.getTime() - 7 * DAY_MS;
  return rows.filter((row) => Number.isFinite(Date.parse(row?.generatedAt)) && Date.parse(row.generatedAt) > cutoff);
}

export async function runContentLocalWorker({ configPath, now = new Date(), operations = {} }) {
  const resolvedConfig = path.resolve(configPath);
  const configInfo = await lstat(resolvedConfig);
  if (!configInfo.isFile() || configInfo.isSymbolicLink()) throw new Error("config_must_be_regular_file");
  const config = validateConfig(await readJson(resolvedConfig, "content_worker_config"), resolvedConfig);
  await stat(config.metricsLedgerPath);
  const lock = await acquireWorkerLock(path.join(config.reportDir, "clippers-content-local-worker.lock"), now);
  const reportPath = path.join(config.reportDir, "clippers-content-local-worker-latest.json");
  const sleepLedgerPath = path.join(config.reportDir, "clippers-content-sleep-ledger.json");
  const runCeo = operations.runCeo || runContentLearningCeo;
  const renderShort = operations.renderShort || renderMotivationShort;
  const generateSleep = operations.generateSleep || generateSleepVideo;
  try {
    const shortChannels = Object.fromEntries(LANGUAGES.map((language) => {
      const lane = config.motivation[language];
      return [language, { ...lane.gates, eligibleCandidates: Math.min(5, lane.manifestFiles.length) }];
    }));
    const plan = await withTimeout(() => runCeo({
      ledgerPath: config.metricsLedgerPath,
      outputDir: config.reportDir,
      now,
      config: { ...config.learning, shortChannels },
    }), config.timeoutMs, "content_learning_ceo");
    const motivation = {};
    for (const language of LANGUAGES) {
      const lanePlan = plan.dailyPlan.lanes.find((lane) => lane.lane === "motivation_short" && lane.language === language);
      const hardCap = Math.min(5, Math.max(0, Number(lanePlan?.target) || 0));
      const candidates = config.motivation[language].manifestFiles.slice(0, hardCap);
      const results = [];
      for (const manifestFile of candidates) {
        const identity = await candidateIdentity(config.workspaceRoot, manifestFile);
        if (!identity) {
          results.push({ status: "blocked", blockers: ["manifest_missing_or_unsafe"], manifestFile, apiCostUsd: 0, publishEnabled: false });
          continue;
        }
        if (identity.language !== language || identity.channelId !== config.motivation[language].channelId) {
          results.push({ status: "blocked", blockers: ["configured_channel_or_language_mismatch"], manifestFile, apiCostUsd: 0, publishEnabled: false });
          continue;
        }
        results.push(await withTimeout(() => renderShort({
          workspaceRoot: config.workspaceRoot, manifestFile, now,
        }), config.timeoutMs, `motivation_${language}`));
      }
      const rendered = results.filter((result) => result?.status === "rendered").length;
      motivation[language] = {
        channelId: config.motivation[language].channelId,
        editorialTarget: 5,
        planned: hardCap,
        attempted: results.length,
        rendered,
        shortfall: 5 - rendered,
        results,
      };
    }
    const sleepPlan = plan.dailyPlan.lanes.find((lane) => lane.lane === "sleep_long");
    const sleepLedger = await readJson(sleepLedgerPath, "sleep_ledger").catch((error) => {
      if (error?.code === "ENOENT") return { schemaVersion: 1, items: [] };
      throw error;
    });
    const recent = recentSleepRows(sleepLedger, now);
    let sleepResult = { status: "not_planned", blockers: [] };
    let attempted = 0;
    if (config.sleep.enabled && Number(sleepPlan?.target) > 0 && recent.length === 0) {
      attempted = 1;
      sleepResult = await withTimeout(() => generateSleep({
        outputPath: config.sleep.outputPath,
        durationSeconds: config.sleep.durationSeconds,
        seed: config.sleep.seed,
        title: config.sleep.title,
        width: 1920,
        height: 1080,
        fps: 1,
        testMode: false,
        overwrite: false,
        visualSource: config.sleep.visualSource,
        visualSha256: config.sleep.visualSha256,
        visualRightsEvidence: config.sleep.visualRightsEvidence,
      }), config.timeoutMs, "sleep_generation");
      const entry = { generatedAt: now.toISOString(), outputPath: sleepResult.outputPath, manifestPath: sleepResult.manifestPath };
      await atomicJson(sleepLedgerPath, { schemaVersion: 1, items: [...(sleepLedger.items || []), entry] });
      sleepResult = { status: "generated", ...entry };
    } else if (recent.length) {
      sleepResult = { status: "deduplicated", blockers: ["rolling_seven_day_generation_cap_reached"], duplicateOf: recent.at(-1).outputPath };
    } else if (!config.sleep.enabled) {
      sleepResult = { status: "disabled", blockers: ["sleep_not_enabled_in_config"] };
    }
    const generated = sleepResult.status === "generated" ? 1 : 0;
    const requestedSleep = Math.min(1, Number(sleepPlan?.target) || 0);
    const effectiveSleepPlan = recent.length ? 0 : requestedSleep;
    const report = {
      schemaVersion: 1,
      runId: randomUUID(),
      generatedAt: now.toISOString(),
      status: Object.values(motivation).some((lane) => lane.shortfall > 0) || (effectiveSleepPlan > generated) ? "completed_with_shortfall" : "completed",
      networkUsed: false,
      uploadAttempted: false,
      publishEnabled: false,
      credentialsRead: false,
      apiCostUsd: 0,
      marketplaceAndTikTokIndependent: true,
      plan: { generatedAt: plan.generatedAt, lanes: plan.dailyPlan.lanes, experiments: plan.experiments },
      motivation,
      sleep: { requestedByCeo: requestedSleep, planned: effectiveSleepPlan, attempted, generated, shortfall: Math.max(0, effectiveSleepPlan - generated), result: sleepResult },
      blockers: [
        ...LANGUAGES.flatMap((language) => motivation[language].results.flatMap((result) => result?.blockers || [])),
        ...(sleepResult.blockers || []),
      ],
    };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  } finally {
    await releaseWorkerLock(lock);
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const configPath = cliValue("config");
  if (!configPath) throw new Error("Usage: node script/clippers-content-local-worker.mjs --config /absolute/path/clippers-content-worker.json");
  const result = await runContentLocalWorker({ configPath });
  process.stdout.write(`${JSON.stringify({ status: result.status, reportPath: result.reportPath }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
