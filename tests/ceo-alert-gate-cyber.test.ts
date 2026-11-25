import assert from "node:assert/strict";
import test from "node:test";
import { __cybersecurityAgentInternals, notifyCyberThroughCeoGate, type CybersecurityScanResult } from "../server/cybersecurity-agent";

function scan(): CybersecurityScanResult {
  return {
    scannedAt: "2026-11-24T10:00:00.000Z", totalApps: 1, totalLegacyProjects: 0, totalGithubRepos: 0, githubConnected: true, githubError: null,
    threatCount: 1, criticalCount: 1, highCount: 0, telegramSent: false, summary: "x",
    threats: [{ id: "t1", appName: "Kong", severity: "critical", title: "Sitio caído", detail: "d", recommendation: "Revisa Replit.", signal: "uptime" }],
    githubRepos: [], skills: [],
  } as unknown as CybersecurityScanResult;
}

test("gate unavailable (no postgres): critical threat falls back to legacy alert with 2 h cooldown", async () => {
  const fallback = await notifyCyberThroughCeoGate("u-fallback", scan(), async () => null);
  assert.equal(fallback, true);
  assert.equal(__cybersecurityAgentInternals.shouldSendAutomaticAlert("u-fallback", scan()), true);
  assert.equal(__cybersecurityAgentInternals.shouldSendAutomaticAlert("u-fallback", scan()), false, "legacy 2 h cooldown");
});

test("corrupt/unreadable ledger: falls back instead of silence", async () => {
  const fallback = await notifyCyberThroughCeoGate("u-corrupt", scan(), async () => ({ sent: 0, planned: 0, failed: 0, skippedReason: "CEO_ALERT_LEDGER_UNAVAILABLE: CEO_ALERT_LEDGER_INVALID" }));
  assert.equal(fallback, true);
  const thrown = await notifyCyberThroughCeoGate("u-throw", scan(), async () => { throw new Error("db down"); });
  assert.equal(thrown, true);
});

test("healthy gate: no fallback", async () => {
  const result = scan();
  const fallback = await notifyCyberThroughCeoGate("u-ok", result, async () => ({ sent: 1, planned: 1, failed: 0 }));
  assert.equal(fallback, false);
  assert.equal(result.telegramSent, true);
  const healthy = { ...scan(), threats: [] } as CybersecurityScanResult;
  assert.equal(await notifyCyberThroughCeoGate("u-healthy", healthy, async () => null), false, "nothing to alert => silence");
});
