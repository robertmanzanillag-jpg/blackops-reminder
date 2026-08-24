import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireWorkerLock, runContentLocalWorker } from "../script/clippers-content-local-worker.mjs";
import { runContentLearningCeo } from "../script/clippers-content-learning-ceo.mjs";

const NOW = new Date("2026-08-24T14:00:00.000Z");

async function fixture({ es = 5, en = 5, sleep = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-worker-"));
  const reports = path.join(root, "reports", "content-worker");
  await mkdir(path.join(root, "manifests"), { recursive: true });
  await mkdir(reports, { recursive: true });
  await writeFile(path.join(root, "metrics.json"), JSON.stringify({ entries: [] }));
  const manifests = { es: [], en: [] };
  for (const language of ["es", "en"]) {
    const count = language === "es" ? es : en;
    for (let index = 0; index < count; index += 1) {
      const relative = `manifests/${language}-${index}.json`;
      await writeFile(path.join(root, relative), JSON.stringify({ channelId: `motivation-${language}`, language }));
      manifests[language].push(relative);
    }
  }
  const config = {
    schemaVersion: 1,
    workspaceRoot: root,
    metricsLedger: "metrics.json",
    reportDir: "reports/content-worker",
    operationTimeoutMs: 60_000,
    motivation: {
      es: { channelId: "motivation-es", manifestFiles: manifests.es, gates: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } },
      en: { channelId: "motivation-en", manifestFiles: manifests.en, gates: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } },
    },
    learning: { laneGates: { sleep_long: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } } },
    sleep: sleep ? {
      enabled: true,
      jobs: [1, 2].map((number) => ({
        output: `sleep/output-${number}.mp4`,
        durationSeconds: 29_100,
        seed: number,
        title: `Rain for sleep ${number}`,
        visualSource: "sleep/source.png",
        visualSha256: "a".repeat(64),
        visualRightsEvidence: "sleep/source.rights.json",
      })),
    } : { enabled: false },
  };
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, reports, configPath };
}

function operations(calls) {
  return {
    runCeo: runContentLearningCeo,
    renderShort: async ({ manifestFile }) => {
      calls.shorts.push(manifestFile);
      return { status: "rendered", shortId: path.basename(manifestFile, ".json"), publishEnabled: false, apiCostUsd: 0 };
    },
    generateSleep: async (options) => {
      calls.sleep.push(options);
      return { outputPath: options.outputPath, manifestPath: `${options.outputPath}.rights.json` };
    },
  };
}

test("cold start prepares five independent candidates per channel and never uploads", async () => {
  const item = await fixture();
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.deepEqual({ es: result.motivation.es.rendered, en: result.motivation.en.rendered }, { es: 5, en: 5 });
  assert.deepEqual({ es: result.motivation.es.shortfall, en: result.motivation.en.shortfall }, { es: 0, en: 0 });
  assert.equal(calls.shorts.length, 10);
  assert.ok(result.plan.lanes.filter((lane) => lane.lane === "motivation_short").every((lane) => lane.action === "cold_start_controlled"));
  assert.equal(result.plan.experiments.length, 0);
  assert.equal(result.networkUsed, false);
  assert.equal(result.uploadAttempted, false);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.credentialsRead, false);
  assert.equal(result.apiCostUsd, 0);
  assert.equal((await stat(result.reportPath)).mode & 0o777, 0o600);
});

test("reports exact per-channel shortfall from eligible manifests", async () => {
  const item = await fixture({ es: 3, en: 1, sleep: false });
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.deepEqual({ planned: result.motivation.es.planned, rendered: result.motivation.es.rendered, shortfall: result.motivation.es.shortfall }, { planned: 3, rendered: 3, shortfall: 2 });
  assert.deepEqual({ planned: result.motivation.en.planned, rendered: result.motivation.en.rendered, shortfall: result.motivation.en.shortfall }, { planned: 1, rendered: 1, shortfall: 4 });
  assert.equal(result.status, "completed_with_shortfall");
});

test("day two skips the first five duplicates and rotates to the next five candidates", async () => {
  const item = await fixture({ es: 10, en: 0, sleep: false });
  const rendered = new Set();
  const rotatingOperations = {
    runCeo: runContentLearningCeo,
    renderShort: async ({ manifestFile }) => {
      if (rendered.has(manifestFile)) return { status: "duplicate", blockers: ["already_rendered"], shortId: manifestFile };
      rendered.add(manifestFile);
      return { status: "rendered", shortId: manifestFile, publishEnabled: false, apiCostUsd: 0 };
    },
    generateSleep: async () => assert.fail("sleep must remain disabled"),
  };
  const first = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: rotatingOperations });
  assert.equal(first.motivation.es.rendered, 5);
  assert.deepEqual([...rendered], Array.from({ length: 5 }, (_, index) => `manifests/es-${index}.json`));
  const second = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 86_400_000), operations: rotatingOperations });
  assert.equal(second.motivation.es.rendered, 5);
  assert.equal(second.motivation.es.skippedDuplicates, 5);
  assert.equal(second.motivation.es.attempted, 5);
  assert.equal(second.motivation.es.shortfall, 0);
  assert.deepEqual([...rendered], Array.from({ length: 10 }, (_, index) => `manifests/es-${index}.json`));
  assert.ok(!second.blockers.includes("already_rendered"));
});

test("blocks a manifest assigned to the wrong independent channel before render", async () => {
  const item = await fixture({ es: 1, en: 0, sleep: false });
  await writeFile(path.join(item.root, "manifests", "es-0.json"), JSON.stringify({ channelId: "motivation-en", language: "en" }));
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.equal(calls.shorts.length, 0);
  assert.deepEqual(result.motivation.es.results[0].blockers, ["configured_channel_or_language_mismatch"]);
});

test("generates sleep once per rolling seven days and deduplicates a second run", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const firstCalls = { shorts: [], sleep: [] };
  const first = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(firstCalls) });
  assert.equal(first.sleep.generated, 1);
  assert.equal(firstCalls.sleep.length, 1);
  assert.equal(firstCalls.sleep[0].durationSeconds, 29_100);
  assert.equal(firstCalls.sleep[0].visualSha256, "a".repeat(64));
  const secondCalls = { shorts: [], sleep: [] };
  const second = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 2 * 86_400_000), operations: operations(secondCalls) });
  assert.equal(second.sleep.generated, 0);
  assert.equal(second.sleep.requestedByCeo, 1);
  assert.equal(second.sleep.planned, 0);
  assert.equal(second.sleep.shortfall, 0);
  assert.equal(second.sleep.result.status, "deduplicated");
  assert.equal(secondCalls.sleep.length, 0);
  const nextWeekCalls = { shorts: [], sleep: [] };
  const nextWeek = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 8 * 86_400_000), operations: operations(nextWeekCalls) });
  assert.equal(nextWeek.sleep.generated, 1);
  assert.equal(nextWeek.sleep.shortfall, 0);
  assert.equal(nextWeekCalls.sleep.length, 1);
  assert.match(nextWeekCalls.sleep[0].outputPath, /output-2\.mp4$/);
});

test("a live PID lock remains authoritative regardless of age", async () => {
  const item = await fixture();
  const lockPath = path.join(item.reports, "lock.json");
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: "old", acquiredAt: "2001-01-01T00:00:00Z" }), { mode: 0o600 });
  await assert.rejects(acquireWorkerLock(lockPath, NOW), /content_worker_already_running/);
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "old");
});

test("rejects unsafe workspace escapes", async () => {
  const item = await fixture();
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.reportDir = "../outside";
  await writeFile(item.configPath, JSON.stringify(config));
  await assert.rejects(runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations({ shorts: [], sleep: [] }) }), /report_dir_outside_workspace/);
});
