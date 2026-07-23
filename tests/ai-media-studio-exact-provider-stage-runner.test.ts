import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import type {
  AdmittedProviderResolver,
  AdmittedReconciliationOutcome,
  AdmittedSendAuthorization,
  AdmittedSubmissionClaim,
  AdmittedSubmitOutcome,
  AdmittedTerminalObservation,
  ExactAdmittedProviderCapability,
} from "../server/ai-media-studio/workers/admitted-render-contracts";
import type {
  AdmittedCompletedTerminalFinality,
  AdmittedFailedTerminalFinality,
  AdmittedTerminalClaim,
  AdmittedTerminalProviderResolver,
  AdmittedTerminalRetryReason,
} from "../server/ai-media-studio/workers/admitted-render-terminal-worker";
import type { ExactReconciliationClaim } from "../server/ai-media-studio/workers/drizzle-exact-reconcile-terminal-repository";
import {
  ExactOneVideoProviderStageRunner,
  type ExactAssetStageDelegate,
  type ExactReconcileTerminalStageRepository,
  type ExactSubmitStageRepository,
} from "../server/ai-media-studio/workers/exact-provider-stage-runner";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoStageContext,
  ExactOneVideoStageResult,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (char: string) => `sha256:${char.repeat(64)}` as Sha256Digest;
const ids = {
  execution: "10000000-0000-4000-8000-000000000001",
  runLease: "20000000-0000-4000-8000-000000000002",
  reservation: "30000000-0000-4000-8000-000000000003",
  render: "40000000-0000-4000-8000-000000000004",
  slot: "50000000-0000-4000-8000-000000000005",
  attempt: "60000000-0000-4000-8000-000000000006",
  account: "70000000-0000-4000-8000-000000000007",
  submitLease: "80000000-0000-4000-8000-000000000008",
  reconciliationLease: "90000000-0000-4000-8000-000000000009",
  terminalCheck: "a0000000-0000-4000-8000-00000000000a",
  terminalLease: "b0000000-0000-4000-8000-00000000000b",
} as const;
const scope = Object.freeze({ ownerUserId: "owner-1", workspaceId: "workspace-1" });
const target = Object.freeze({
  scope,
  budgetReservationId: ids.reservation,
  renderJobId: ids.render,
  dailyPlanSlotId: ids.slot,
  slotAttempt: 1,
  workHandoffDigest: digest("b"),
});

function context(
  action: ExactOneVideoStageContext["action"],
): ExactOneVideoStageContext {
  const commandId = `exact-${action}`;
  const commandDigest = digest("a");
  const lease = Object.freeze({
    executionId: ids.execution,
    commandId,
    commandDigest,
    fencingToken: 3n,
    leaseToken: ids.runLease,
  }) as ExactOneVideoRunLease;
  return Object.freeze({
    target,
    action,
    commandId,
    commandDigest,
    actorUserId: "robert",
    lease,
  });
}

const submitContext = context("activate_and_submit");
const reconciliationContext = context("reconcile_submission");
const terminalContext = context("observe_terminal");

const claim: AdmittedSubmissionClaim = Object.freeze({
  id: ids.attempt,
  scope,
  budgetReservationId: ids.reservation,
  renderJobId: ids.render,
  providerAccountId: ids.account,
  providerKey: "heygen",
  providerCredentialVersion: 3,
  providerIdempotencyKey: "exact:persisted-key",
  avatarExternalResourceId: "avatar-1",
  voiceExternalResourceId: "voice-1",
  sealedRequest: Object.freeze({ script: "hello" }),
  sealedRequestDigest: digest("c"),
  fencingToken: 4n,
  leaseToken: ids.submitLease,
  leaseExpiresAt: "2026-07-23T20:01:00.000Z",
});
const authorization: AdmittedSendAuthorization = Object.freeze({
  ...claim,
  authorizationDigest: digest("d"),
  commitEvidenceDigest: digest("e"),
  authorizedAt: "2026-07-23T20:00:00.000Z",
});
const reconciliationClaim: ExactReconciliationClaim = Object.freeze({
  ...authorization,
  reconciliationLeaseToken: ids.reconciliationLease,
  reconciliationLeaseOwner: "exact-provider-worker",
  reconciliationFencingToken: 5n,
  reconciliationLeaseExpiresAt: "2026-07-23T20:02:00.000Z",
});
const terminalClaim: AdmittedTerminalClaim = Object.freeze({
  terminalCheckId: ids.terminalCheck,
  id: ids.attempt,
  scope,
  budgetReservationId: ids.reservation,
  renderJobId: ids.render,
  providerAccountId: ids.account,
  providerKey: "heygen",
  providerCredentialVersion: 3,
  authorizationDigest: digest("d"),
  fencingToken: 4n,
  providerJobId: "provider-job-123",
  terminalLeaseToken: ids.terminalLease,
  terminalLeaseExpiresAt: "2026-07-23T20:03:00.000Z",
  terminalFencingToken: 6n,
});

function capability(
  identity: typeof authorization | typeof reconciliationClaim | typeof terminalClaim,
  overrides: Partial<ExactAdmittedProviderCapability> = {},
): ExactAdmittedProviderCapability {
  return {
    scope: identity.scope,
    providerAccountId: identity.providerAccountId,
    providerKey: identity.providerKey,
    providerCredentialVersion: identity.providerCredentialVersion,
    authorizationDigest: identity.authorizationDigest,
    ...overrides,
  } as unknown as ExactAdmittedProviderCapability;
}

class SubmitRepository implements ExactSubmitStageRepository {
  claimValue: AdmittedSubmissionClaim | undefined = claim;
  authorizationValue: AdmittedSendAuthorization | undefined = authorization;
  confirmApplied = true;
  ambiguousApplied = true;
  calls: string[] = [];
  confirmedOutcome: Parameters<ExactSubmitStageRepository["confirm"]>[2] | undefined;
  ambiguousOutcome: Parameters<ExactSubmitStageRepository["markAmbiguous"]>[2] | undefined;

  async claim(exactContext: ExactOneVideoStageContext, lease: { workerId: string; leaseDurationMs: number }) {
    assert.equal(exactContext, submitContext);
    assert.deepEqual(lease, { workerId: "exact-provider-worker", leaseDurationMs: 60_000 });
    this.calls.push("claim");
    return this.claimValue;
  }
  async authorize(exactContext: ExactOneVideoStageContext, exactClaim: AdmittedSubmissionClaim) {
    assert.equal(exactContext, submitContext);
    assert.equal(exactClaim, claim);
    this.calls.push("authorize");
    return this.authorizationValue;
  }
  async confirm(
    exactContext: ExactOneVideoStageContext,
    exactAuthorization: AdmittedSendAuthorization,
    outcome: Parameters<ExactSubmitStageRepository["confirm"]>[2],
  ) {
    assert.equal(exactContext, submitContext);
    assert.equal(exactAuthorization, authorization);
    this.calls.push("confirm");
    this.confirmedOutcome = outcome;
    return this.confirmApplied;
  }
  async markAmbiguous(
    exactContext: ExactOneVideoStageContext,
    exactAuthorization: AdmittedSendAuthorization,
    outcome: Parameters<ExactSubmitStageRepository["markAmbiguous"]>[2],
  ) {
    assert.equal(exactContext, submitContext);
    assert.equal(exactAuthorization, authorization);
    this.calls.push("ambiguous");
    this.ambiguousOutcome = outcome;
    return this.ambiguousApplied;
  }
}

class ReconcileTerminalRepository implements ExactReconcileTerminalStageRepository {
  reconciliationClaimValue: ExactReconciliationClaim | undefined = reconciliationClaim;
  terminalClaimValue: AdmittedTerminalClaim | undefined = terminalClaim;
  releaseReconciliationApplied = true;
  reconciliationConfirmedApplied = true;
  reconciledNoSubmitApplied = true;
  releaseTerminalApplied = true;
  terminalFinalization: "applied" | "duplicate" | "conflict" = "applied";
  calls: string[] = [];
  terminalRelease:
    | { reason: AdmittedTerminalRetryReason; observedAt: string; evidenceDigest: Sha256Digest }
    | undefined;
  completedFinality: AdmittedCompletedTerminalFinality | undefined;
  failedFinality: AdmittedFailedTerminalFinality | undefined;

  async claimReconciliation(
    exactContext: ExactOneVideoStageContext,
    lease: { workerId: string; leaseDurationMs: number },
  ) {
    assert.equal(exactContext, reconciliationContext);
    assert.deepEqual(lease, { workerId: "exact-provider-worker", leaseDurationMs: 60_000 });
    this.calls.push("claim-reconciliation");
    return this.reconciliationClaimValue;
  }
  async releaseReconciliationUnknown(
    exactContext: ExactOneVideoStageContext,
    exactClaim: ExactReconciliationClaim,
  ) {
    assert.equal(exactContext, reconciliationContext);
    assert.equal(exactClaim, reconciliationClaim);
    this.calls.push("release-reconciliation");
    return this.releaseReconciliationApplied;
  }
  async finalizeReconciliationConfirmed(
    exactContext: ExactOneVideoStageContext,
    exactClaim: ExactReconciliationClaim,
  ) {
    assert.equal(exactContext, reconciliationContext);
    assert.equal(exactClaim, reconciliationClaim);
    this.calls.push("confirm-reconciliation");
    return this.reconciliationConfirmedApplied;
  }
  async finalizeReconciledNoSubmit(
    exactContext: ExactOneVideoStageContext,
    exactClaim: ExactReconciliationClaim,
  ) {
    assert.equal(exactContext, reconciliationContext);
    assert.equal(exactClaim, reconciliationClaim);
    this.calls.push("no-submit");
    return this.reconciledNoSubmitApplied;
  }
  async claimTerminal(
    exactContext: ExactOneVideoStageContext,
    lease: { workerId: string; leaseDurationMs: number },
  ) {
    assert.equal(exactContext, terminalContext);
    assert.deepEqual(lease, { workerId: "exact-provider-worker", leaseDurationMs: 60_000 });
    this.calls.push("claim-terminal");
    return this.terminalClaimValue;
  }
  async releaseTerminalUnknown(
    exactContext: ExactOneVideoStageContext,
    exactClaim: AdmittedTerminalClaim,
    outcome: { reason: AdmittedTerminalRetryReason; observedAt: string; evidenceDigest: Sha256Digest },
  ) {
    assert.equal(exactContext, terminalContext);
    assert.equal(exactClaim, terminalClaim);
    this.calls.push("release-terminal");
    this.terminalRelease = outcome;
    return this.releaseTerminalApplied;
  }
  async finalizeTerminalCompleted(
    exactContext: ExactOneVideoStageContext,
    exactClaim: AdmittedTerminalClaim,
    finality: AdmittedCompletedTerminalFinality,
  ) {
    assert.equal(exactContext, terminalContext);
    assert.equal(exactClaim, terminalClaim);
    this.calls.push("completed");
    this.completedFinality = finality;
    return this.terminalFinalization;
  }
  async finalizeTerminalFailed(
    exactContext: ExactOneVideoStageContext,
    exactClaim: AdmittedTerminalClaim,
    finality: AdmittedFailedTerminalFinality,
  ) {
    assert.equal(exactContext, terminalContext);
    assert.equal(exactClaim, terminalClaim);
    this.calls.push("failed");
    this.failedFinality = finality;
    return this.terminalFinalization;
  }
}

class Assets implements ExactAssetStageDelegate {
  calls: string[] = [];
  async ingestAssetExact(exactContext: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    this.calls.push("ingest");
    return { target: exactContext.target, action: exactContext.action, outcome: "asset_completed" };
  }
  async linkAssetExact(exactContext: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    this.calls.push("link");
    return { target: exactContext.target, action: exactContext.action, outcome: "asset_linked" };
  }
}

function providerResolver(input: {
  submit?: () => Promise<
    | { kind: "confirmed"; providerJobId: string; evidenceDigest: Sha256Digest }
    | { kind: "ambiguous"; evidenceDigest: Sha256Digest }
  >;
  reconcile?: () => Promise<AdmittedReconciliationOutcome>;
  capability?: ExactAdmittedProviderCapability;
  onResolve?: () => void;
} = {}): AdmittedProviderResolver {
  return {
    async resolve(identity) {
      input.onResolve?.();
      return {
        capability: input.capability ?? capability(identity as typeof authorization),
        provider: {
          submit: input.submit ?? (async () => ({
            kind: "confirmed",
            providerJobId: "provider-job-123",
            evidenceDigest: digest("f"),
          })),
          reconcile: input.reconcile ?? (async () => ({ kind: "unknown" })),
        },
      };
    },
  };
}

function terminalResolver(input: {
  observe?: () => Promise<AdmittedTerminalObservation>;
  capability?: ExactAdmittedProviderCapability;
  onResolve?: () => void;
} = {}): AdmittedTerminalProviderResolver {
  return {
    async resolveTerminal(identity) {
      input.onResolve?.();
      return {
        capability: input.capability ?? capability(identity),
        provider: {
          observeTerminal: input.observe ?? (async () => ({
            kind: "processing",
            observedAt: "2026-07-23T20:04:00.000Z",
            evidenceDigest: digest("1"),
          })),
        },
      };
    },
  };
}

function harness(input: {
  submitRepository?: SubmitRepository;
  reconcileRepository?: ReconcileTerminalRepository;
  providerResolver?: AdmittedProviderResolver;
  terminalResolver?: AdmittedTerminalProviderResolver;
  assets?: Assets;
} = {}) {
  const submitRepository = input.submitRepository ?? new SubmitRepository();
  const reconcileRepository = input.reconcileRepository ?? new ReconcileTerminalRepository();
  const assets = input.assets ?? new Assets();
  return {
    submitRepository,
    reconcileRepository,
    assets,
    runner: new ExactOneVideoProviderStageRunner({
      workerId: "exact-provider-worker",
      leaseDurationMs: 60_000,
      submitRepository,
      reconcileTerminalRepository: reconcileRepository,
      providerResolver: input.providerResolver ?? providerResolver(),
      terminalProviderResolver: input.terminalResolver ?? terminalResolver(),
      assetDelegate: assets,
      now: () => "2026-07-23T20:05:00.000Z",
    }),
  };
}

test("construction is inert and exposes no queue, timer, publishing, or deploy surface", () => {
  let providerResolutions = 0;
  const h = harness({
    providerResolver: providerResolver({ onResolve: () => { providerResolutions += 1; } }),
    terminalResolver: terminalResolver({ onResolve: () => { providerResolutions += 1; } }),
  });
  assert.equal(h.runner.autostart, false);
  assert.equal(h.runner.publishingAvailable, false);
  for (const forbidden of ["runNext", "reconcileNext", "start", "publish", "deploy", "claimDue"]) {
    assert.equal(forbidden in h.runner, false, forbidden);
  }
  assert.equal(providerResolutions, 0);
  assert.deepEqual(h.submitRepository.calls, []);
  assert.deepEqual(h.reconcileRepository.calls, []);
});

test("activate-and-submit claims and authorizes the exact target before one provider submit", async () => {
  let submissions = 0;
  const h = harness({
    providerResolver: providerResolver({
      submit: async () => {
        submissions += 1;
        return { kind: "confirmed", providerJobId: "provider-job-123", evidenceDigest: digest("f") };
      },
    }),
  });
  assert.deepEqual(await h.runner.activateAndSubmitExact(submitContext), {
    target,
    action: "activate_and_submit",
    outcome: "confirmed",
  });
  assert.equal(submissions, 1);
  assert.deepEqual(h.submitRepository.calls, ["claim", "authorize", "confirm"]);
  assert.equal(h.submitRepository.confirmedOutcome?.providerJobId, "provider-job-123");
});

test("submit transport error and capability mismatch become durable ambiguity without provider retry", async () => {
  for (const [name, resolver, expectedNetworkCalls] of [
    ["transport", providerResolver({ submit: async () => { throw new Error("secret response"); } }), 1],
    ["capability", providerResolver({
      capability: capability(authorization, { providerCredentialVersion: 999 }),
      submit: async () => { throw new Error("must not run"); },
    }), 0],
  ] as const) {
    let networkCalls = 0;
    const wrapped: AdmittedProviderResolver = {
      async resolve(identity) {
        const resolved = await resolver.resolve(identity);
        return {
          ...resolved,
          provider: {
            ...resolved.provider,
            async submit(request, exactCapability) {
              networkCalls += 1;
              return resolved.provider.submit(request, exactCapability);
            },
          },
        };
      },
    };
    const h = harness({ providerResolver: wrapped });
    assert.equal((await h.runner.activateAndSubmitExact(submitContext)).outcome, "ambiguous", name);
    assert.equal(networkCalls, expectedNetworkCalls, name);
    assert.match(h.submitRepository.ambiguousOutcome!.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.doesNotMatch(h.submitRepository.ambiguousOutcome!.evidenceDigest, /secret/iu);
  }
});

test("malformed provider submit outcomes are durably ambiguous after exactly one call", async () => {
  for (const [name, malformed] of [
    ["null", null],
    ["invalid-confirmed", {
      kind: "confirmed",
      providerJobId: "",
      evidenceDigest: "provider-secret-body",
    }],
  ] as const) {
    let submissions = 0;
    const h = harness({
      providerResolver: providerResolver({
        submit: async () => {
          submissions += 1;
          return malformed as unknown as AdmittedSubmitOutcome;
        },
      }),
    });
    assert.equal(
      (await h.runner.activateAndSubmitExact(submitContext)).outcome,
      "ambiguous",
      name,
    );
    assert.equal(submissions, 1, name);
    assert.deepEqual(
      h.submitRepository.calls,
      ["claim", "authorize", "ambiguous"],
      name,
    );
    assert.match(
      h.submitRepository.ambiguousOutcome!.evidenceDigest,
      /^sha256:[0-9a-f]{64}$/u,
      name,
    );
    assert.doesNotMatch(
      h.submitRepository.ambiguousOutcome!.evidenceDigest,
      /secret/iu,
      name,
    );
  }
});

test("idle, authorization loss, and lost submit finalization never call or report provider success", async () => {
  const idleRepository = new SubmitRepository();
  idleRepository.claimValue = undefined;
  const idle = harness({ submitRepository: idleRepository });
  assert.equal((await idle.runner.activateAndSubmitExact(submitContext)).outcome, "idle");

  const authRepository = new SubmitRepository();
  authRepository.authorizationValue = undefined;
  const auth = harness({ submitRepository: authRepository });
  assert.equal((await auth.runner.activateAndSubmitExact(submitContext)).outcome, "authorization_lost");

  const lostRepository = new SubmitRepository();
  lostRepository.confirmApplied = false;
  const lost = harness({ submitRepository: lostRepository });
  assert.equal((await lost.runner.activateAndSubmitExact(submitContext)).outcome, "authorization_lost");
});

test("reconciliation confirms exact provider identity or safely releases unknown", async () => {
  const confirmed = harness({
    providerResolver: providerResolver({
      reconcile: async () => ({
        kind: "confirmed",
        providerJobId: "provider-job-123",
        evidenceDigest: digest("2"),
      }),
    }),
  });
  assert.equal((await confirmed.runner.reconcileSubmissionExact(reconciliationContext)).outcome, "confirmed");
  assert.deepEqual(confirmed.reconcileRepository.calls, ["claim-reconciliation", "confirm-reconciliation"]);

  for (const [name, resolver] of [
    ["unknown", providerResolver({ reconcile: async () => ({ kind: "unknown" }) })],
    ["error", providerResolver({ reconcile: async () => { throw new Error("timeout"); } })],
    ["capability", providerResolver({
      capability: capability(reconciliationClaim, { providerAccountId: ids.reservation }),
    })],
  ] as const) {
    const h = harness({ providerResolver: resolver });
    assert.equal((await h.runner.reconcileSubmissionExact(reconciliationContext)).outcome, "ambiguous", name);
    assert.deepEqual(h.reconcileRepository.calls, ["claim-reconciliation", "release-reconciliation"]);
  }
});

test("malformed reconciliation outcomes release the exact lease without finality", async () => {
  for (const [name, malformed] of [
    ["null", null],
    ["invalid-confirmed", {
      kind: "confirmed",
      providerJobId: "",
      evidenceDigest: "provider-secret-body",
    }],
    ["unexpected-kind", { kind: "completed" }],
  ] as const) {
    const h = harness({
      providerResolver: providerResolver({
        reconcile: async () => malformed as unknown as AdmittedReconciliationOutcome,
      }),
    });
    assert.equal(
      (await h.runner.reconcileSubmissionExact(reconciliationContext)).outcome,
      "ambiguous",
      name,
    );
    assert.deepEqual(
      h.reconcileRepository.calls,
      ["claim-reconciliation", "release-reconciliation"],
      name,
    );
  }
});

test("only matching linearizable negative finality can finalize reconciled-no-submit", async () => {
  const matching = {
    scope,
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 3,
    authorizationDigest: digest("d"),
    providerIdempotencyKey: "exact:persisted-key",
    guarantee: "linearizable_not_accepted_and_cannot_later_accept",
    observedAt: "2026-07-23T20:04:00.000Z",
    evidenceDigest: digest("3"),
  } as const;
  // The brand is provider-minted at runtime; the test intentionally supplies its structural equivalent.
  const goodResolver = providerResolver({
    reconcile: async () => ({
      kind: "definitive_no_submit",
      finality: matching as unknown as Extract<
        AdmittedReconciliationOutcome,
        { kind: "definitive_no_submit" }
      >["finality"],
    }),
  });
  const accepted = harness({ providerResolver: goodResolver });
  assert.equal(
    (await accepted.runner.reconcileSubmissionExact(reconciliationContext)).outcome,
    "reconciled_no_submit",
  );
  assert.ok(accepted.reconcileRepository.calls.includes("no-submit"));

  const rejected = harness({
    providerResolver: providerResolver({
      reconcile: async () => ({
        kind: "definitive_no_submit",
        finality: {
          ...matching,
          providerIdempotencyKey: "another-key",
        } as unknown as Extract<
          AdmittedReconciliationOutcome,
          { kind: "definitive_no_submit" }
        >["finality"],
      }),
    }),
  });
  assert.equal((await rejected.runner.reconcileSubmissionExact(reconciliationContext)).outcome, "ambiguous");
  assert.equal(rejected.reconcileRepository.calls.includes("no-submit"), false);
});

test("completed terminal observation records durable artifact identity and delegates later asset stages", async () => {
  const h = harness({
    terminalResolver: terminalResolver({
      observe: async () => ({
        kind: "completed",
        observedAt: "2026-07-23T20:04:00.000Z",
        remoteArtifactRef: terminalClaim.providerJobId,
        sourceUrl: "https://cdn.example.com/render.mp4?signature=ephemeral",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
        mediaType: "video/mp4",
        durationSeconds: 12,
        evidenceDigest: digest("4"),
      }),
    }),
  });
  assert.equal((await h.runner.observeTerminalExact(terminalContext)).outcome, "completed");
  assert.ok(h.reconcileRepository.completedFinality);
  assert.match(
    h.reconcileRepository.completedFinality.remoteArtifactRef,
    /^provider-artifact:\/\/ai-media-studio\/render-terminal\/v1\/[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(h.reconcileRepository.completedFinality.remoteArtifactRef, /signature|cdn/iu);
  assert.equal(h.reconcileRepository.completedFinality.ephemeralSourceUrl.includes("signature"), true);
  assert.equal(h.reconcileRepository.completedFinality.releaseCapacity, true);
  assert.equal(h.reconcileRepository.completedFinality.enqueueIngest, true);

  assert.equal((await h.runner.ingestAssetExact(context("ingest_asset"))).outcome, "asset_completed");
  assert.equal((await h.runner.linkAssetExact(context("link_asset"))).outcome, "asset_linked");
  assert.deepEqual(h.assets.calls, ["ingest", "link"]);
});

test("processing, provider failure, capability mismatch, and invalid terminal output only release the exact lease", async () => {
  for (const [name, resolver, reason] of [
    ["processing", terminalResolver(), "processing"],
    ["provider-error", terminalResolver({ observe: async () => { throw new Error("429 secret"); } }), "provider_retryable_error"],
    ["capability", terminalResolver({
      capability: capability(terminalClaim, { providerCredentialVersion: 999 }),
      observe: async () => { throw new Error("must not run"); },
    }), "capability_mismatch"],
    ["invalid", terminalResolver({
      observe: async () => ({
        kind: "completed",
        observedAt: "2026-07-23T20:04:00.000Z",
        remoteArtifactRef: terminalClaim.providerJobId,
        sourceUrl: "http://cdn.example.com/render.mp4",
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
        mediaType: "video/mp4",
        evidenceDigest: digest("5"),
      }),
    }), "invalid_terminal_observation"],
  ] as const) {
    const h = harness({ terminalResolver: resolver });
    assert.equal((await h.runner.observeTerminalExact(terminalContext)).outcome, "processing", name);
    assert.equal(h.reconcileRepository.terminalRelease?.reason, reason, name);
    assert.equal(h.reconcileRepository.completedFinality, undefined, name);
    assert.equal(h.reconcileRepository.failedFinality, undefined, name);
  }
});

test("malformed provider evidence and failed finality are classified invalid before terminal mutation", async () => {
  for (const [name, observation] of [
    ["bad-envelope", {
      kind: "unknown",
      observedAt: "not-a-date",
      evidenceDigest: "provider-secret-body",
    }],
    ["bad-failed-finality", {
      kind: "failed",
      observedAt: "2026-07-23T20:04:00.000Z",
      evidenceDigest: digest("8"),
      failureMessageDigest: "not-a-digest",
    }],
    ["unexpected-kind", {
      kind: "unexpected",
      observedAt: "2026-07-23T20:04:00.000Z",
      evidenceDigest: digest("9"),
    }],
  ] as const) {
    const h = harness({
      terminalResolver: terminalResolver({
        observe: async () => observation as unknown as AdmittedTerminalObservation,
      }),
    });
    assert.equal((await h.runner.observeTerminalExact(terminalContext)).outcome, "processing", name);
    assert.equal(
      h.reconcileRepository.terminalRelease?.reason,
      "invalid_terminal_observation",
      name,
    );
    assert.match(
      h.reconcileRepository.terminalRelease!.evidenceDigest,
      /^sha256:[0-9a-f]{64}$/u,
      name,
    );
    assert.equal(h.reconcileRepository.failedFinality, undefined, name);
    assert.equal(h.reconcileRepository.completedFinality, undefined, name);
  }
});

test("failed terminal output releases capacity without ingest; CAS conflict is authorization loss", async () => {
  const repository = new ReconcileTerminalRepository();
  const h = harness({
    reconcileRepository: repository,
    terminalResolver: terminalResolver({
      observe: async () => ({
        kind: "failed",
        observedAt: "2026-07-23T20:04:00.000Z",
        failureCode: "provider_failed",
        failureMessageDigest: digest("6"),
        evidenceDigest: digest("7"),
      }),
    }),
  });
  assert.equal((await h.runner.observeTerminalExact(terminalContext)).outcome, "failed");
  assert.equal(repository.failedFinality?.releaseCapacity, true);
  assert.equal(repository.failedFinality?.enqueueIngest, false);

  repository.calls = [];
  repository.terminalFinalization = "conflict";
  assert.equal((await h.runner.observeTerminalExact(terminalContext)).outcome, "authorization_lost");
});

test("wrong action is rejected before repository or provider I/O", async () => {
  const h = harness();
  await assert.rejects(
    h.runner.activateAndSubmitExact(reconciliationContext),
    /Invalid activate_and_submit/u,
  );
  await assert.rejects(
    h.runner.reconcileSubmissionExact(terminalContext),
    /Invalid reconcile_submission/u,
  );
  await assert.rejects(
    h.runner.observeTerminalExact(submitContext),
    /Invalid observe_terminal/u,
  );
  assert.deepEqual(h.submitRepository.calls, []);
  assert.deepEqual(h.reconcileRepository.calls, []);
});
