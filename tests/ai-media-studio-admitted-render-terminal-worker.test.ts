import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import type {
  AdmittedTerminalObservation,
  ExactAdmittedProviderCapability,
} from "../server/ai-media-studio/workers/admitted-render-contracts";
import {
  AdmittedRenderTerminalWorker,
  type AdmittedTerminalClaim,
  type AdmittedTerminalFinalizeResult,
  type AdmittedTerminalProviderResolver,
  type AdmittedTerminalRepository,
} from "../server/ai-media-studio/workers/admitted-render-terminal-worker";

const digest = (char: string) => `sha256:${char.repeat(64)}` as Sha256Digest;

const claim: AdmittedTerminalClaim = {
  terminalCheckId: "10000000-0000-4000-8000-000000000000",
  id: "10000000-0000-4000-8000-000000000001",
  scope: { ownerUserId: "owner", workspaceId: "workspace" },
  budgetReservationId: "10000000-0000-4000-8000-000000000002",
  renderJobId: "10000000-0000-4000-8000-000000000003",
  providerAccountId: "10000000-0000-4000-8000-000000000004",
  providerKey: "heygen",
  providerCredentialVersion: 3,
  fencingToken: 2n,
  authorizationDigest: digest("2"),
  providerJobId: "provider-job-123",
  terminalLeaseToken: "terminal-lease-1",
  terminalLeaseExpiresAt: "2026-07-21T20:00:00.000Z",
  terminalFencingToken: 7n,
};

function capability(overrides: Partial<ExactAdmittedProviderCapability> = {}): ExactAdmittedProviderCapability {
  return {
    scope: claim.scope,
    providerAccountId: claim.providerAccountId,
    providerKey: claim.providerKey,
    providerCredentialVersion: claim.providerCredentialVersion,
    authorizationDigest: claim.authorizationDigest,
    ...overrides,
  } as unknown as ExactAdmittedProviderCapability;
}

function resolver(observe: (context: { providerJobId: string }) => Promise<AdmittedTerminalObservation>, cap = capability()): AdmittedTerminalProviderResolver {
  return {
    async resolveTerminal() {
      return { capability: cap, provider: { observeTerminal: observe } };
    },
  };
}

function repository(overrides: Partial<AdmittedTerminalRepository> = {}): AdmittedTerminalRepository {
  return {
    claimTerminal: async () => claim,
    finalizeCompleted: async () => "applied",
    finalizeFailed: async () => "applied",
    rescheduleTerminal: async () => true,
    ...overrides,
  };
}

test("completed terminal observation atomically records terminal state, releases capacity, and enqueues ingest", async () => {
  let observedProviderJobId = "";
  let completedInput: Parameters<AdmittedTerminalRepository["finalizeCompleted"]>[0] | undefined;
  let reschedules = 0;
  let failedFinalizations = 0;
  const worker = new AdmittedRenderTerminalWorker({
    workerId: "terminal-worker-1",
    leaseDurationMs: 60_000,
    repository: repository({
      finalizeCompleted: async (input) => { completedInput = input; return "applied"; },
      finalizeFailed: async () => { failedFinalizations += 1; return "applied"; },
      rescheduleTerminal: async () => { reschedules += 1; return true; },
    }),
    providerResolver: resolver(async (context) => {
      observedProviderJobId = context.providerJobId;
      return {
        kind: "completed",
        observedAt: "2026-07-21T20:01:00.000Z",
        remoteArtifactRef: claim.providerJobId,
        sourceUrl: "https://cdn.example.com/render.mp4?signature=ephemeral",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
        mediaType: "video/mp4",
        durationSeconds: 14,
        evidenceDigest: digest("4"),
      };
    }),
  });

  assert.deepEqual(await worker.runNext(), { outcome: "completed", attemptId: claim.id, finalization: "applied" });
  assert.equal(observedProviderJobId, claim.providerJobId);
  assert.equal(reschedules, 0);
  assert.equal(failedFinalizations, 0);
  assert.ok(completedInput);
  assert.equal(completedInput.providerJobId, claim.providerJobId);
  assert.equal(completedInput.terminalLeaseToken, claim.terminalLeaseToken);
  assert.equal(completedInput.terminalFencingToken, claim.terminalFencingToken);
  assert.equal(completedInput.finality.kind, "completed");
  assert.match(completedInput.finality.remoteArtifactRef, /^provider-artifact:\/\/ai-media-studio\/render-terminal\/v1\/[a-f0-9]{64}$/u);
  assert.doesNotMatch(completedInput.finality.remoteArtifactRef, /cdn\.example|signature|render\.mp4/iu);
  assert.equal(completedInput.finality.ephemeralSourceUrl, "https://cdn.example.com/render.mp4?signature=ephemeral");
  assert.equal(completedInput.finality.mediaType, "video/mp4");
  assert.equal(completedInput.finality.releaseCapacity, true);
  assert.equal(completedInput.finality.enqueueIngest, true);
  assert.equal("budgetMutation" in completedInput.finality, false);
});

test("failed terminal observation releases capacity without artifact ingest or budget mutation", async () => {
  let failedInput: Parameters<AdmittedTerminalRepository["finalizeFailed"]>[0] | undefined;
  let completedCalls = 0;
  const worker = new AdmittedRenderTerminalWorker({
    workerId: "terminal-worker-1",
    leaseDurationMs: 60_000,
    repository: repository({
      finalizeCompleted: async () => { completedCalls += 1; return "applied"; },
      finalizeFailed: async (input) => { failedInput = input; return "applied"; },
    }),
    providerResolver: resolver(async () => ({
      kind: "failed",
      observedAt: "2026-07-21T20:01:00.000Z",
      failureCode: "provider_render_failed",
      failureMessageDigest: digest("5"),
      evidenceDigest: digest("6"),
    })),
  });

  assert.deepEqual(await worker.runNext(), { outcome: "failed", attemptId: claim.id, finalization: "applied" });
  assert.equal(completedCalls, 0);
  assert.ok(failedInput);
  assert.equal(failedInput.finality.kind, "failed");
  assert.equal(failedInput.finality.releaseCapacity, true);
  assert.equal(failedInput.finality.enqueueIngest, false);
  assert.equal("ephemeralSourceUrl" in failedInput.finality, false);
  assert.equal("remoteArtifactRef" in failedInput.finality, false);
  assert.equal("budgetMutation" in failedInput.finality, false);
});

test("processing, unknown, rate-limit, timeout, and invalid completed observations only reschedule with capacity held", async () => {
  for (const [name, observe, expectedReason] of [
    ["processing", async () => ({ kind: "processing", observedAt: "2026-07-21T20:01:00.000Z", evidenceDigest: digest("7") }), "processing"],
    ["unknown", async () => ({ kind: "unknown", observedAt: "2026-07-21T20:01:00.000Z", evidenceDigest: digest("8") }), "unknown"],
    ["rate-limit", async () => { const error = new Error("429"); error.name = "RateLimitError"; throw error; }, "provider_retryable_error"],
    ["timeout", async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; }, "provider_retryable_error"],
    ["invalid-completed", async () => ({
      kind: "completed",
      observedAt: "2026-07-21T20:01:00.000Z",
      remoteArtifactRef: claim.providerJobId,
      sourceUrl: "http://cdn.example.com/render.mp4",
      sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
      mediaType: "video/mp4",
      evidenceDigest: digest("9"),
    }), "invalid_terminal_observation"],
  ] as const) {
    let rescheduleInput: Parameters<AdmittedTerminalRepository["rescheduleTerminal"]>[0] | undefined;
    let terminalCalls = 0;
    const worker = new AdmittedRenderTerminalWorker({
      workerId: `terminal-worker-${name}`,
      leaseDurationMs: 60_000,
      repository: repository({
        finalizeCompleted: async () => { terminalCalls += 1; return "applied"; },
        finalizeFailed: async () => { terminalCalls += 1; return "applied"; },
        rescheduleTerminal: async (input) => { rescheduleInput = input; return true; },
      }),
      providerResolver: resolver(observe as () => Promise<AdmittedTerminalObservation>),
      now: () => "2026-07-21T20:02:00.000Z",
    });

    assert.deepEqual(await worker.runNext(), { outcome: "retryable", attemptId: claim.id, reason: expectedReason });
    assert.equal(terminalCalls, 0);
    assert.ok(rescheduleInput);
    assert.equal(rescheduleInput.reason, expectedReason);
    assert.equal(rescheduleInput.capacityHeld, true);
    assert.equal("budgetMutation" in rescheduleInput, false);
  }
});

test("duplicate terminal finalization is idempotent and conflict is not reported as success", async () => {
  for (const [result, expected] of [
    ["duplicate", { outcome: "completed", attemptId: claim.id, finalization: "duplicate" }],
    ["conflict", { outcome: "authorization_lost", attemptId: claim.id }],
  ] as const) {
    const worker = new AdmittedRenderTerminalWorker({
      workerId: `terminal-worker-${result}`,
      leaseDurationMs: 60_000,
      repository: repository({
        finalizeCompleted: async () => result as AdmittedTerminalFinalizeResult,
      }),
      providerResolver: resolver(async () => ({
        kind: "completed",
        observedAt: "2026-07-21T20:01:00.000Z",
        remoteArtifactRef: claim.providerJobId,
        sourceUrl: "https://cdn.example.com/render.mp4",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
        mediaType: "video/mp4",
        evidenceDigest: digest("a"),
      })),
    });
    assert.deepEqual(await worker.runNext(), expected);
  }
});

test("mismatched terminal capability is rejected before provider I/O and rescheduled without terminal finalization", async () => {
  let observeCalls = 0;
  let rescheduleInput: Parameters<AdmittedTerminalRepository["rescheduleTerminal"]>[0] | undefined;
  const worker = new AdmittedRenderTerminalWorker({
    workerId: "terminal-worker-1",
    leaseDurationMs: 60_000,
    repository: repository({
      finalizeCompleted: async () => { throw new Error("must not finalize"); },
      finalizeFailed: async () => { throw new Error("must not finalize"); },
      rescheduleTerminal: async (input) => { rescheduleInput = input; return true; },
    }),
    providerResolver: resolver(async () => {
      observeCalls += 1;
      return { kind: "unknown", observedAt: "2026-07-21T20:01:00.000Z", evidenceDigest: digest("b") };
    }, capability({ providerCredentialVersion: 999 })),
  });

  assert.deepEqual(await worker.runNext(), { outcome: "retryable", attemptId: claim.id, reason: "capability_mismatch" });
  assert.equal(observeCalls, 0);
  assert.ok(rescheduleInput);
  assert.equal(rescheduleInput.capacityHeld, true);
});
