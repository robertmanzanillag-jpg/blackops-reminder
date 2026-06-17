import assert from "node:assert/strict";
import test from "node:test";
import { __clipperInternals, getClipperStatus, runClipperDailyPlan } from "../server/clippers-agent";

test("normalizeRunOptions clamps clips and defaults publish mode", () => {
  const result = __clipperInternals.normalizeRunOptions({
    clipsPerAccount: 999,
    publishMode: "anything",
    riskTolerance: "wild",
  });

  assert.equal(result.clipsPerAccount, 50);
  assert.equal(result.publishMode, "approval_required");
  assert.equal(result.riskTolerance, "growth");
});

test("runClipperDailyPlan creates drafts for each configured account", async () => {
  const { report, status } = await runClipperDailyPlan({
    clipsPerAccount: 2,
    publishMode: "draft_only",
    riskTolerance: "safe",
  });

  assert.equal(report.publishMode, "draft_only");
  assert.equal(report.riskTolerance, "safe");
  assert.equal(report.plannedClips.length, status.accounts.length * 2);
  assert.ok(report.nextActions.some((action) => action.includes("TikTok")));
});

test("getClipperStatus exposes guarded growth goals", async () => {
  const status = await getClipperStatus();

  assert.ok(status.goals.totalWeeklyGoal >= 3_000_000);
  assert.ok(status.guardrails.some((rule) => rule.includes("licenciado")));
  assert.ok(status.agents.some((agent) => agent.id === "rights-gate"));
});
