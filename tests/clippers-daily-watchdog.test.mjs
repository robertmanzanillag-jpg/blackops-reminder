import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runClippersDailyWatchdog } from "../script/clippers-daily-watchdog.mjs";

async function fixture({ ledger = [], worker = null, supply = null } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-watchdog-"));
  const reports = path.join(workspaceRoot, "reports");
  await mkdir(path.join(reports, "free-local-worker"), { recursive: true });
  await writeFile(path.join(reports, "metricool-autopilot-ledger.json"), JSON.stringify(ledger));
  if (worker) await writeFile(path.join(reports, "free-local-worker", "latest.json"), JSON.stringify(worker));
  if (supply) await writeFile(path.join(reports, "marketplace-supply-report.json"), JSON.stringify(supply));
  return workspaceRoot;
}

test("creates a local zero-post alert with worker stage, blocker, and run age", async () => {
  const workspaceRoot = await fixture({
    worker: {
      status: "blocked",
      failedStage: "supply",
      finishedAt: "2026-08-12T13:00:00.000Z",
      configurationBlockers: [],
    },
    supply: { summary: { snapshotsRead: 0 }, rejected: [] },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T14:05:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "alert");
    assert.equal(report.alert, true);
    assert.equal(report.counts.total, 0);
    assert.equal(report.worker.stage, "supply");
    assert.deepEqual(report.worker.blockers, ["no_fresh_marketplace_snapshots"]);
    assert.equal(report.worker.lastRunAgeMinutes, 65);
    assert.equal(report.notificationSent, false);
    assert.equal(report.costUsd, 0);

    const alertJson = JSON.parse(await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.json",
    ), "utf8"));
    const alertMarkdown = await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.md",
    ), "utf8");
    assert.equal(alertJson.worker.stage, "supply");
    assert.match(alertMarkdown, /local alert only; no message was sent/i);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("counts only evidence-backed posts for the configured account and New York date", async () => {
  const workspaceRoot = await fixture({
    ledger: [
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-1", scheduledFor: "2026-08-12T21:00:00.000Z", campaignId: "one" },
      { status: "published", account: "streamersclipusa", metricoolId: "m-2", publishedAt: "2026-08-12T15:00:00.000Z", publicUrl: "https://www.tiktok.com/@streamersclipusa/video/123456", campaignId: "two" },
      { status: "scheduled", account: "@streamersclipusa", scheduledFor: "2026-08-12T22:00:00.000Z" },
      { status: "published", account: "@streamersclipusa", publishedAt: "2026-08-12T16:00:00.000Z", publicUrl: "https://example.com/not-proof" },
      { status: "scheduled", account: "@other", metricoolId: "m-3", scheduledFor: "2026-08-12T18:00:00.000Z" },
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-old", scheduledFor: "2026-08-11T18:00:00.000Z" },
      { status: "scheduled", account: "@streamersclipusa", metricoolId: "m-date-only", scheduledFor: "2026-08-12" },
    ],
    worker: { status: "completed", finishedAt: "2026-08-12T13:05:00.000Z" },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "healthy");
    assert.equal(report.counts.total, 3);
    assert.equal(report.counts.scheduled, 2);
    assert.equal(report.counts.published, 1);
    assert.deepEqual(report.evidence.map(({ metricoolId }) => metricoolId), ["m-1", "m-2", "m-date-only"]);
    await assert.rejects(readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/alerts/2026-08-12.json",
    )));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("records not_due before the configurable local check hour", async () => {
  const workspaceRoot = await fixture();
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T12:59:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.status, "not_due");
    assert.equal(report.alert, false);
    const latest = JSON.parse(await readFile(path.join(
      workspaceRoot,
      "reports/clippers-daily-watchdog/latest.json",
    ), "utf8"));
    assert.equal(latest.date, "2026-08-12");
    assert.equal(latest.timeZone, "America/New_York");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports renderer shortfall from a partial worker without calling it a missing report", async () => {
  const workspaceRoot = await fixture({
    worker: {
      status: "partial",
      failedStage: null,
      finishedAt: "2026-08-12T13:00:00.000Z",
      renderingReport: { summary: { rendered: 2, missingAgainstTarget: 3 } },
    },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.worker.stage, "partial");
    assert.deepEqual(report.worker.blockers, ["renderer_shortfall_3"]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reports a long worker startup as running instead of a missing report", async () => {
  const workspaceRoot = await fixture({
    worker: { status: "running", startedAt: "2026-08-12T14:55:00.000Z" },
  });
  try {
    const report = await runClippersDailyWatchdog({
      workspaceRoot,
      now: new Date("2026-08-12T15:00:00.000Z"),
      checkHour: 10,
    });
    assert.equal(report.worker.stage, "running");
    assert.deepEqual(report.worker.blockers, []);
    assert.equal(report.worker.lastRunAgeMinutes, 5);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("rejects an invalid configured hour", async () => {
  const workspaceRoot = await fixture();
  try {
    await assert.rejects(
      runClippersDailyWatchdog({ workspaceRoot, checkHour: 24 }),
      /integer from 0 to 23/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
