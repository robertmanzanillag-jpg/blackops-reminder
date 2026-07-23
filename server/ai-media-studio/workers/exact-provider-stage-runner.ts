import { createHash } from "node:crypto";
import { durableProviderArtifactRef } from "../assets/provider-artifact-identity";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedAuthorizedIdentity, AdmittedProviderResolver, AdmittedReconciliationOutcome,
  AdmittedSendAuthorization, AdmittedSubmissionClaim, AdmittedSubmitOutcome,
  AdmittedTerminalObservation, ExactNegativeSubmissionFinality,
} from "./admitted-render-contracts";
import type {
  AdmittedCompletedTerminalFinality, AdmittedFailedTerminalFinality,
  AdmittedTerminalClaim, AdmittedTerminalFinalizeResult,
  AdmittedTerminalProviderResolver, AdmittedTerminalRetryReason,
} from "./admitted-render-terminal-worker";
import type { ExactReconciliationClaim } from "./drizzle-exact-reconcile-terminal-repository";
import type {
  ExactOneVideoStageContext, ExactOneVideoStageResult, ExactOneVideoStageRunner,
} from "./one-video-run-once-executor";

export interface ExactSubmitStageRepository {
  claim(context: ExactOneVideoStageContext, input: WorkerLease): Promise<AdmittedSubmissionClaim | undefined>;
  authorize(context: ExactOneVideoStageContext, claim: AdmittedSubmissionClaim): Promise<AdmittedSendAuthorization | undefined>;
  confirm(context: ExactOneVideoStageContext, authorization: AdmittedSendAuthorization, outcome: Confirmed): Promise<boolean>;
  markAmbiguous(context: ExactOneVideoStageContext, authorization: AdmittedSendAuthorization, outcome: Ambiguous): Promise<boolean>;
}

export interface ExactReconcileTerminalStageRepository {
  claimReconciliation(context: ExactOneVideoStageContext, input: WorkerLease): Promise<ExactReconciliationClaim | undefined>;
  releaseReconciliationUnknown(context: ExactOneVideoStageContext, claim: ExactReconciliationClaim): Promise<boolean>;
  finalizeReconciliationConfirmed(context: ExactOneVideoStageContext, claim: ExactReconciliationClaim, outcome: ReconciledConfirmed): Promise<boolean>;
  finalizeReconciledNoSubmit(context: ExactOneVideoStageContext, claim: ExactReconciliationClaim, finality: ExactNegativeSubmissionFinality): Promise<boolean>;
  claimTerminal(context: ExactOneVideoStageContext, input: WorkerLease): Promise<AdmittedTerminalClaim | undefined>;
  releaseTerminalUnknown(context: ExactOneVideoStageContext, claim: AdmittedTerminalClaim, outcome: TerminalRelease): Promise<boolean>;
  finalizeTerminalCompleted(context: ExactOneVideoStageContext, claim: AdmittedTerminalClaim, finality: AdmittedCompletedTerminalFinality): Promise<AdmittedTerminalFinalizeResult>;
  finalizeTerminalFailed(context: ExactOneVideoStageContext, claim: AdmittedTerminalClaim, finality: AdmittedFailedTerminalFinality): Promise<AdmittedTerminalFinalizeResult>;
}

export interface ExactAssetStageDelegate {
  ingestAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
  linkAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult>;
}

interface WorkerLease { workerId: string; leaseDurationMs: number }
type Confirmed = Extract<AdmittedSubmitOutcome, { kind: "confirmed" }>;
type Ambiguous = Extract<AdmittedSubmitOutcome, { kind: "ambiguous" }>;
type ReconciledConfirmed = Extract<AdmittedReconciliationOutcome, { kind: "confirmed" }>;
interface TerminalRelease {
  reason: AdmittedTerminalRetryReason;
  observedAt: string;
  evidenceDigest: Sha256Digest;
}

export interface ExactOneVideoProviderStageRunnerOptions {
  workerId: string;
  leaseDurationMs: number;
  submitRepository: ExactSubmitStageRepository;
  reconcileTerminalRepository: ExactReconcileTerminalStageRepository;
  providerResolver: AdmittedProviderResolver;
  terminalProviderResolver: AdmittedTerminalProviderResolver;
  assetDelegate: ExactAssetStageDelegate;
  now?: () => string;
}

/** Explicit exact-target stages. Construction performs no I/O. */
export class ExactOneVideoProviderStageRunner implements ExactOneVideoStageRunner {
  readonly autostart = false;
  readonly publishingAvailable = false;

  constructor(private readonly options: ExactOneVideoProviderStageRunnerOptions) {
    if (!options.workerId || options.workerId !== options.workerId.trim()
      || !Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1
      || options.leaseDurationMs > 300_000 || !options.submitRepository
      || !options.reconcileTerminalRepository || !options.providerResolver
      || !options.terminalProviderResolver || !options.assetDelegate) {
      throw new Error("Exact provider stages require bounded inert dependencies");
    }
  }

  async activateAndSubmitExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "activate_and_submit");
    const claim = await this.options.submitRepository.claim(context, this.workerLease());
    if (!claim) return result(context, "idle");
    const authorization = await this.options.submitRepository.authorize(context, claim);
    if (!authorization) return result(context, "authorization_lost");
    let outcome: AdmittedSubmitOutcome;
    try {
      const resolved = await this.options.providerResolver.resolve(authorization);
      assertCapability(authorization, resolved.capability);
      const providerOutcome: unknown = await resolved.provider.submit(authorization.sealedRequest, {
        ...resolved.capability,
        providerIdempotencyKey: authorization.providerIdempotencyKey,
        avatarExternalResourceId: authorization.avatarExternalResourceId,
        voiceExternalResourceId: authorization.voiceExternalResourceId,
      });
      if (!safeSubmitOutcome(providerOutcome)) throw new InvalidProviderOutcomeError();
      outcome = providerOutcome;
    } catch (error) {
      // Any transport failure or malformed response after durable authorization
      // can only be recorded as ambiguous; it must never trigger a resubmit.
      outcome = { kind: "ambiguous", evidenceDigest: errorDigest("submit", error, authorization) };
    }
    const applied = outcome.kind === "confirmed"
      ? await this.options.submitRepository.confirm(context, authorization, outcome)
      : await this.options.submitRepository.markAmbiguous(context, authorization, outcome);
    return result(context, applied ? outcome.kind : "authorization_lost");
  }

  async reconcileSubmissionExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "reconcile_submission");
    const repo = this.options.reconcileTerminalRepository;
    const claim = await repo.claimReconciliation(context, this.workerLease());
    if (!claim) return result(context, "idle");
    let outcome: AdmittedReconciliationOutcome;
    try {
      const resolved = await this.options.providerResolver.resolve(claim);
      assertCapability(claim, resolved.capability);
      outcome = await resolved.provider.reconcile({
        ...resolved.capability,
        providerIdempotencyKey: claim.providerIdempotencyKey,
      });
    } catch {
      return this.releaseReconciliation(context, claim);
    }
    if (!safeReconciliationOutcome(outcome)) {
      return this.releaseReconciliation(context, claim);
    }
    if (outcome.kind === "unknown") return this.releaseReconciliation(context, claim);
    if (outcome.kind === "confirmed") {
      const applied = await repo.finalizeReconciliationConfirmed(context, claim, outcome);
      return result(context, applied ? "confirmed" : "authorization_lost");
    }
    if (!safeNegativeFinality(claim, outcome.finality)) {
      return this.releaseReconciliation(context, claim);
    }
    const applied = await repo.finalizeReconciledNoSubmit(context, claim, outcome.finality);
    return result(context, applied ? "reconciled_no_submit" : "authorization_lost");
  }

  async observeTerminalExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "observe_terminal");
    const repo = this.options.reconcileTerminalRepository;
    const claim = await repo.claimTerminal(context, this.workerLease());
    if (!claim) return result(context, "idle");
    let observation: AdmittedTerminalObservation;
    try {
      assertTerminalClaim(claim);
      const resolved = await this.options.terminalProviderResolver.resolveTerminal(claim);
      assertCapability(claim, resolved.capability);
      observation = await resolved.provider.observeTerminal({
        ...resolved.capability,
        providerJobId: claim.providerJobId,
      });
    } catch (error) {
      return this.releaseTerminal(context, claim,
        error instanceof CapabilityMismatchError ? "capability_mismatch" : "provider_retryable_error",
        errorDigest("terminal", error, claim));
    }
    if (!safeObservationEnvelope(observation)) {
      return this.releaseTerminal(context, claim, "invalid_terminal_observation",
        invalidObservationDigest(claim, observation));
    }
    if (observation.kind === "processing" || observation.kind === "unknown") {
      return this.releaseTerminal(context, claim, observation.kind,
        observation.evidenceDigest, observation.observedAt);
    }
    if (observation.kind === "completed") {
      if (!safeCompleted(claim, observation)) {
        return this.releaseTerminal(context, claim, "invalid_terminal_observation",
          observation.evidenceDigest, observation.observedAt);
      }
      const finalized = await repo.finalizeTerminalCompleted(context, claim, {
        kind: "completed",
        remoteArtifactRef: durableProviderArtifactRef(claim),
        ephemeralSourceUrl: observation.sourceUrl,
        mediaType: "video/mp4",
        observedAt: observation.observedAt,
        evidenceDigest: observation.evidenceDigest,
        ...(observation.durationSeconds === undefined ? {} : { durationSeconds: observation.durationSeconds }),
        releaseCapacity: true,
        enqueueIngest: true,
      });
      return terminalResult(context, "completed", finalized);
    }
    if (observation.kind !== "failed" || !safeFailed(observation)) {
      return this.releaseTerminal(context, claim, "invalid_terminal_observation",
        invalidObservationDigest(claim, observation));
    }
    const finalized = await repo.finalizeTerminalFailed(context, claim, {
      kind: "failed",
      observedAt: observation.observedAt,
      evidenceDigest: observation.evidenceDigest,
      ...(observation.failureCode ? { failureCode: observation.failureCode.slice(0, 120) } : {}),
      ...(observation.failureMessageDigest ? { failureMessageDigest: observation.failureMessageDigest } : {}),
      releaseCapacity: true,
      enqueueIngest: false,
    });
    return terminalResult(context, "failed", finalized);
  }

  ingestAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "ingest_asset");
    return this.options.assetDelegate.ingestAssetExact(context);
  }

  linkAssetExact(context: ExactOneVideoStageContext): Promise<ExactOneVideoStageResult> {
    assertAction(context, "link_asset");
    return this.options.assetDelegate.linkAssetExact(context);
  }

  private workerLease(): WorkerLease {
    return { workerId: this.options.workerId, leaseDurationMs: this.options.leaseDurationMs };
  }

  private async releaseReconciliation(context: ExactOneVideoStageContext, claim: ExactReconciliationClaim) {
    const released = await this.options.reconcileTerminalRepository
      .releaseReconciliationUnknown(context, claim);
    return result(context, released ? "ambiguous" : "authorization_lost");
  }

  private async releaseTerminal(
    context: ExactOneVideoStageContext, claim: AdmittedTerminalClaim,
    reason: AdmittedTerminalRetryReason, evidenceDigest: Sha256Digest,
    observedAt = this.options.now?.() ?? new Date().toISOString(),
  ) {
    const released = await this.options.reconcileTerminalRepository.releaseTerminalUnknown(
      context, claim, { reason, observedAt, evidenceDigest },
    );
    return result(context, released ? "processing" : "authorization_lost");
  }
}

/** Short compatibility name for callers that do not include the one-video qualifier. */
export { ExactOneVideoProviderStageRunner as ExactProviderStageRunner };
export type ExactProviderStageRunnerOptions = ExactOneVideoProviderStageRunnerOptions;

function result(context: ExactOneVideoStageContext, outcome: ExactOneVideoStageResult["outcome"]): ExactOneVideoStageResult {
  return Object.freeze({ target: context.target, action: context.action, outcome });
}

function terminalResult(context: ExactOneVideoStageContext, outcome: "completed" | "failed", finalized: AdmittedTerminalFinalizeResult) {
  return result(context, finalized === "conflict" ? "authorization_lost" : outcome);
}

function assertAction(context: ExactOneVideoStageContext, action: ExactOneVideoStageContext["action"]) {
  if (!context || context.action !== action) throw new Error(`Invalid ${action} exact provider stage context`);
}

class CapabilityMismatchError extends Error {}
class InvalidProviderOutcomeError extends Error {}
function assertCapability(
  authorization: AdmittedAuthorizedIdentity | AdmittedTerminalClaim,
  capability: { scope: { ownerUserId: string; workspaceId: string }; providerAccountId: string;
    providerKey: string; providerCredentialVersion: number; authorizationDigest: string },
) {
  if (capability.scope.ownerUserId !== authorization.scope.ownerUserId
    || capability.scope.workspaceId !== authorization.scope.workspaceId
    || capability.providerAccountId !== authorization.providerAccountId
    || capability.providerKey !== authorization.providerKey
    || capability.providerCredentialVersion !== authorization.providerCredentialVersion
    || capability.authorizationDigest !== authorization.authorizationDigest) {
    throw new CapabilityMismatchError();
  }
}

function safeNegativeFinality(
  authorization: AdmittedAuthorizedIdentity & { providerIdempotencyKey: string },
  finality: ExactNegativeSubmissionFinality,
) {
  return Boolean(finality && finality.guarantee === "linearizable_not_accepted_and_cannot_later_accept"
    && finality.scope.ownerUserId === authorization.scope.ownerUserId
    && finality.scope.workspaceId === authorization.scope.workspaceId
    && finality.providerAccountId === authorization.providerAccountId
    && finality.providerKey === authorization.providerKey
    && finality.providerCredentialVersion === authorization.providerCredentialVersion
    && finality.authorizationDigest === authorization.authorizationDigest
    && finality.providerIdempotencyKey === authorization.providerIdempotencyKey
    && digest(finality.evidenceDigest) && !Number.isNaN(Date.parse(finality.observedAt)));
}

function safeSubmitOutcome(outcome: unknown): outcome is AdmittedSubmitOutcome {
  if (!outcome || typeof outcome !== "object") return false;
  const candidate = outcome as Partial<AdmittedSubmitOutcome>;
  if (!digest(candidate.evidenceDigest)
    || (candidate.providerRequestId !== undefined
      && !bounded(candidate.providerRequestId, 500))) {
    return false;
  }
  if (candidate.kind === "ambiguous") return true;
  return candidate.kind === "confirmed"
    && bounded(candidate.providerJobId, 500);
}

function safeReconciliationOutcome(
  outcome: unknown,
): outcome is AdmittedReconciliationOutcome {
  if (!outcome || typeof outcome !== "object") return false;
  const candidate = outcome as Partial<AdmittedReconciliationOutcome>;
  if (candidate.kind === "unknown") return true;
  if (candidate.kind === "confirmed") {
    return bounded(candidate.providerJobId, 500)
      && (candidate.providerRequestId === undefined
        || bounded(candidate.providerRequestId, 500))
      && digest(candidate.evidenceDigest);
  }
  return candidate.kind === "definitive_no_submit"
    && Boolean(candidate.finality);
}

function safeCompleted(claim: AdmittedTerminalClaim, observation: Extract<AdmittedTerminalObservation, { kind: "completed" }>) {
  if (observation.mediaType !== "video/mp4"
    || observation.sourceUrlPolicy !== "ephemeral_refresh_via_provider_get"
    || observation.remoteArtifactRef !== claim.providerJobId
    || (observation.durationSeconds !== undefined
      && (!Number.isFinite(observation.durationSeconds) || observation.durationSeconds < 0))) return false;
  try {
    const url = new URL(observation.sourceUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function safeFailed(observation: Extract<AdmittedTerminalObservation, { kind: "failed" }>) {
  return observation.kind === "failed"
    && (!observation.failureCode
      || (observation.failureCode === observation.failureCode.trim()
        && observation.failureCode.length <= 1_000))
    && (!observation.failureMessageDigest || digest(observation.failureMessageDigest));
}

function safeObservationEnvelope(observation: AdmittedTerminalObservation) {
  return Boolean(observation && digest(observation.evidenceDigest)
    && !Number.isNaN(Date.parse(observation.observedAt)));
}

function assertTerminalClaim(claim: AdmittedTerminalClaim) {
  if (!bounded(claim.providerJobId, 500) || !bounded(claim.terminalLeaseToken, 500)
    || typeof claim.terminalFencingToken !== "bigint" || claim.terminalFencingToken < 1n
    || Number.isNaN(Date.parse(claim.terminalLeaseExpiresAt))) {
    throw new Error("Invalid exact terminal claim");
  }
}

function invalidObservationDigest(
  claim: AdmittedTerminalClaim,
  observation: unknown,
): Sha256Digest {
  const kind = observation && typeof observation === "object" && "kind" in observation
    ? String(observation.kind).slice(0, 80)
    : "invalid";
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    lane: "terminal-invalid-observation",
    attemptId: claim.id,
    terminalFencingToken: claim.terminalFencingToken.toString(),
    authorizationDigest: claim.authorizationDigest,
    kind,
  })).digest("hex")}`;
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value === value.trim()
    && value.length >= 1 && value.length <= max;
}

function errorDigest(
  lane: "submit" | "terminal", error: unknown,
  identity: { id: string; fencingToken: bigint; authorizationDigest: Sha256Digest;
    providerAccountId: string; providerKey: string },
): Sha256Digest {
  const classification = error instanceof Error ? error.name : "UnknownProviderError";
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1, lane, classification, attemptId: identity.id,
    fencingToken: identity.fencingToken.toString(),
    authorizationDigest: identity.authorizationDigest,
    providerAccountId: identity.providerAccountId, providerKey: identity.providerKey,
  })).digest("hex")}`;
}

function digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
