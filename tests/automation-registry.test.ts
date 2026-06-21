import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationDefinition } from "@shared/schema";
import { DEFAULT_AUTOMATIONS, buildScheduledAutomationRunInput } from "../server/automation-registry";

function automation(overrides: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: "automation-1",
    ownerUserId: "user-1",
    name: "CEO brief",
    description: "Sends the morning brief.",
    type: "reminder",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "daily_time", hour: 7, minute: 0 },
    timezone: "America/New_York",
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    failureCount: 0,
    costEstimate: "0",
    metadata: { key: "morning-reminder" },
    createdAt: new Date("2026-06-17T10:00:00.000Z"),
    updatedAt: new Date("2026-06-17T10:00:00.000Z"),
    ...overrides,
  };
}

test("builds a scheduled automation run insert for successful scheduler jobs", () => {
  const startedAt = new Date("2026-06-17T11:00:00.000Z");
  const finishedAt = new Date("2026-06-17T11:00:05.000Z");
  const run = buildScheduledAutomationRunInput({
    automation: automation(),
    startedAt,
    finishedAt,
    outcome: {
      status: "success",
      resultSummary: "CEO morning brief sent.",
      metadata: { pendingCount: 3 },
    },
  });

  assert.equal(run.automationId, "automation-1");
  assert.equal(run.ownerUserId, "user-1");
  assert.equal(run.triggeredBy, "scheduler");
  assert.equal(run.status, "success");
  assert.equal(run.costEstimate, "0");
  assert.deepEqual(run.metadata, { pendingCount: 3 });
});

test("builds a failed scheduled automation run insert with error details", () => {
  const run = buildScheduledAutomationRunInput({
    automation: automation({ costEstimate: "low" }),
    startedAt: new Date("2026-06-17T11:00:00.000Z"),
    finishedAt: new Date("2026-06-17T11:00:05.000Z"),
    outcome: {
      status: "failed",
      resultSummary: "Proactive insights failed.",
      errorMessage: "AI key missing.",
      metadata: { error: "AI key missing." },
    },
  });

  assert.equal(run.status, "failed");
  assert.equal(run.errorMessage, "AI key missing.");
  assert.equal(run.costEstimate, "low");
  assert.deepEqual(run.metadata, { error: "AI key missing." });
});

test("default automations expose Bug Patrol and daily QA report", () => {
  const automation = DEFAULT_AUTOMATIONS.find((item) => item.key === "app-qa-council");

  assert.ok(automation);
  assert.match(automation.name, /Bug Patrol/);
  assert.match(automation.description || "", /Codex PR-first handoffs/);
  assert.equal((automation.metadata as any).bugPatrol, true);
  assert.equal((automation.metadata as any).digest, "daily");
});
