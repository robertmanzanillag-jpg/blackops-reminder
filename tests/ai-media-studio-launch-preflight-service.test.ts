import assert from "node:assert/strict";
import test from "node:test";
import { launchPreflightGateCodes, launchPreflightSchema } from "../shared/ai-media-studio-launch-preflight";
import { LaunchPreflightError } from "../server/ai-media-studio/planning/launch-preflight-contracts";
import { LaunchPreflightService } from "../server/ai-media-studio/planning/launch-preflight-service";

const planId = `plan_${"a".repeat(24)}`;
function report() {
  const required = 50;
  return launchPreflightSchema.parse({ version: 1, source: "derived_read_only",
    subject: { planId, batchId: `batch_${"b".repeat(24)}`, avatarCount: 5, videosPerAvatar: 10, plannedVideoCount: required },
    observedAt: "2026-07-22T00:00:00.000Z", status: "blocked", canGenerate: false,
    sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true, authoritativeForAdmission: false,
    effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
      renderCreated: false, outboxCreated: false, providerCalled: false },
    summary: { totalGates: 14, passedGates: 0, blockedGates: 14, pendingExternalGates: 0,
      pendingHumanGates: 0, unavailableGates: 0, readySlots: 0, requiredSlots: required },
    gates: launchPreflightGateCodes.map((code) => ({ code, state: "blocked", readySlots: 0, requiredSlots: required,
      reasonCode: "observation_unavailable", nextActionCode: "retry_observation" })) });
}

test("service scopes exact public key and returns only a validated read observation", async () => {
  const calls: unknown[] = [];
  const service = new LaunchPreflightService({ observe: async (...args) => { calls.push(args); return report(); } });
  assert.deepEqual(await service.observe({ ownerUserId: " owner ", workspaceId: " workspace " }, planId), report());
  assert.deepEqual(calls, [[{ ownerUserId: "owner", workspaceId: "workspace" }, planId]]);
});

test("service makes cross-tenant absence indistinguishable and fails malformed repository output closed", async () => {
  const missing = new LaunchPreflightService({ observe: async () => undefined });
  await assert.rejects(() => missing.observe({ ownerUserId: "owner", workspaceId: "ws" }, planId),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "NOT_FOUND");
  const corrupt = new LaunchPreflightService({ observe: async () => ({ ...report(), canGenerate: true }) as any });
  await assert.rejects(() => corrupt.observe({ ownerUserId: "owner", workspaceId: "ws" }, planId),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "UNAVAILABLE");
  await assert.rejects(() => missing.observe({ ownerUserId: "owner", workspaceId: "ws" }, "bad"),
    (error: unknown) => error instanceof LaunchPreflightError && error.code === "INVALID_REQUEST");
});
