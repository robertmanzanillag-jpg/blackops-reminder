import { createHash } from "node:crypto";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedTerminalObservation,
  AdmittedTerminalProvider,
  ExactAdmittedProviderCapability,
} from "./admitted-render-contracts";
import type { TenantScope } from "../core/resource-domain";

export type AdmittedTerminalFinalizeResult = "applied" | "duplicate" | "conflict";
export type AdmittedTerminalRetryReason =
  | "processing"
  | "unknown"
  | "provider_retryable_error"
  | "invalid_terminal_observation"
  | "capability_mismatch";

export interface AdmittedTerminalClaim {
  terminalCheckId: string;
  id: string;
  scope: TenantScope;
  budgetReservationId: string;
  renderJobId: string;
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  authorizationDigest: Sha256Digest;
  fencingToken: bigint;
  providerJobId: string;
  terminalLeaseToken: string;
  terminalLeaseExpiresAt: string;
  terminalFencingToken: bigint;
}

export interface AdmittedTerminalProviderResolver {
  resolveTerminal(claim: AdmittedTerminalClaim): Promise<{
    provider: AdmittedTerminalProvider;
    capability: ExactAdmittedProviderCapability;
  }>;
}

export interface AdmittedCompletedTerminalFinality {
  kind: "completed";
  remoteArtifactRef: string;
  /** Ephemeral provider URL; repository must enqueue ingest atomically and must not expose it publicly. */
  ephemeralSourceUrl: string;
  mediaType: "video/mp4";
  observedAt: string;
  evidenceDigest: Sha256Digest;
  durationSeconds?: number;
  releaseCapacity: true;
  enqueueIngest: true;
}

export interface AdmittedFailedTerminalFinality {
  kind: "failed";
  observedAt: string;
  evidenceDigest: Sha256Digest;
  failureCode?: string;
  failureMessageDigest?: Sha256Digest;
  releaseCapacity: true;
  enqueueIngest: false;
}

export type AdmittedTerminalFinality =
  | AdmittedCompletedTerminalFinality
  | AdmittedFailedTerminalFinality;

export interface AdmittedTerminalRepository {
  claimTerminal(input: { workerId: string; leaseDurationMs: number }): Promise<AdmittedTerminalClaim | undefined>;
  finalizeCompleted(input: AdmittedTerminalClaim & { finality: AdmittedCompletedTerminalFinality }): Promise<AdmittedTerminalFinalizeResult>;
  finalizeFailed(input: AdmittedTerminalClaim & { finality: AdmittedFailedTerminalFinality }): Promise<AdmittedTerminalFinalizeResult>;
  rescheduleTerminal(input: AdmittedTerminalClaim & {
    reason: AdmittedTerminalRetryReason;
    observedAt: string;
    evidenceDigest: Sha256Digest;
    capacityHeld: true;
  }): Promise<boolean>;
}

export type AdmittedTerminalWorkerResult =
  | { outcome: "idle" }
  | { outcome: "completed" | "failed"; attemptId: string; finalization: "applied" | "duplicate" }
  | { outcome: "retryable"; attemptId: string; reason: AdmittedTerminalRetryReason }
  | { outcome: "authorization_lost"; attemptId: string };

/**
 * Terminal observer for renders already confirmed accepted by a provider.
 * It never submits, retries submit, mutates budget, or downloads artifacts.
 */
export class AdmittedRenderTerminalWorker {
  constructor(private readonly options: {
    workerId: string;
    leaseDurationMs: number;
    repository: AdmittedTerminalRepository;
    providerResolver: AdmittedTerminalProviderResolver;
    now?: () => string;
  }) {
    if (!options.workerId.trim() || options.workerId !== options.workerId.trim()
      || !Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1
      || options.leaseDurationMs > 300_000) {
      throw new Error("A terminal worker and bounded positive lease are required");
    }
  }

  async runNext(): Promise<AdmittedTerminalWorkerResult> {
    const claim = await this.options.repository.claimTerminal({
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    });
    if (!claim) return { outcome: "idle" };
    assertClaim(claim);

    let observation: AdmittedTerminalObservation;
    try {
      const { provider, capability } = await this.options.providerResolver.resolveTerminal(claim);
      assertExactCapability(claim, capability);
      observation = await provider.observeTerminal({ ...capability, providerJobId: claim.providerJobId });
    } catch (error) {
      const reason = error instanceof Error && error.message.includes("terminal capability")
        ? "capability_mismatch"
        : "provider_retryable_error";
      return this.reschedule(claim, reason, errorDigest(error, claim));
    }

    return this.persistObservation(claim, observation);
  }

  private async persistObservation(
    claim: AdmittedTerminalClaim,
    observation: AdmittedTerminalObservation,
  ): Promise<AdmittedTerminalWorkerResult> {
    if (observation.kind === "processing") {
      return this.reschedule(claim, "processing", observation.evidenceDigest, observation.observedAt);
    }
    if (observation.kind === "unknown") {
      return this.reschedule(claim, "unknown", observation.evidenceDigest, observation.observedAt);
    }
    if (observation.kind === "completed") {
      if (!isSafeCompletedObservation(claim, observation)) {
        return this.reschedule(claim, "invalid_terminal_observation", observation.evidenceDigest, observation.observedAt);
      }
      const finalization = await this.options.repository.finalizeCompleted({
        ...claim,
        finality: {
          kind: "completed",
          remoteArtifactRef: remoteArtifactRef(claim, observation),
          ephemeralSourceUrl: observation.sourceUrl,
          mediaType: "video/mp4",
          observedAt: observation.observedAt,
          evidenceDigest: observation.evidenceDigest,
          ...(observation.durationSeconds === undefined ? {} : { durationSeconds: observation.durationSeconds }),
          releaseCapacity: true,
          enqueueIngest: true,
        },
      });
      return terminalResult(claim.id, "completed", finalization);
    }
    const finalization = await this.options.repository.finalizeFailed({
      ...claim,
      finality: {
        kind: "failed",
        observedAt: observation.observedAt,
        evidenceDigest: observation.evidenceDigest,
        ...(observation.failureCode ? { failureCode: observation.failureCode.slice(0, 120) } : {}),
        ...(observation.failureMessageDigest ? { failureMessageDigest: observation.failureMessageDigest } : {}),
        releaseCapacity: true,
        enqueueIngest: false,
      },
    });
    return terminalResult(claim.id, "failed", finalization);
  }

  private async reschedule(
    claim: AdmittedTerminalClaim,
    reason: AdmittedTerminalRetryReason,
    evidenceDigest: Sha256Digest,
    observedAt = this.options.now?.() ?? new Date().toISOString(),
  ): Promise<AdmittedTerminalWorkerResult> {
    const released = await this.options.repository.rescheduleTerminal({
      ...claim,
      reason,
      observedAt,
      evidenceDigest,
      capacityHeld: true,
    });
    return released ? { outcome: "retryable", attemptId: claim.id, reason } : { outcome: "authorization_lost", attemptId: claim.id };
  }
}

function terminalResult(
  attemptId: string,
  outcome: "completed" | "failed",
  finalization: AdmittedTerminalFinalizeResult,
): AdmittedTerminalWorkerResult {
  if (finalization === "conflict") return { outcome: "authorization_lost", attemptId };
  return { outcome, attemptId, finalization };
}

function assertExactCapability(
  claim: AdmittedTerminalClaim,
  capability: {
    scope: { ownerUserId: string; workspaceId: string };
    providerAccountId: string;
    providerKey: string;
    providerCredentialVersion: number;
    authorizationDigest: string;
  },
): void {
  if (capability.scope.ownerUserId !== claim.scope.ownerUserId
    || capability.scope.workspaceId !== claim.scope.workspaceId
    || capability.providerAccountId !== claim.providerAccountId
    || capability.providerKey !== claim.providerKey
    || capability.providerCredentialVersion !== claim.providerCredentialVersion
    || capability.authorizationDigest !== claim.authorizationDigest) {
    throw new Error("Provider resolver returned a terminal capability for another admitted authorization");
  }
}

function assertClaim(claim: AdmittedTerminalClaim): void {
  if (!boundedProviderId(claim.providerJobId) || !boundedProviderId(claim.terminalLeaseToken)
    || claim.terminalFencingToken < 1n || Number.isNaN(Date.parse(claim.terminalLeaseExpiresAt))) {
    throw new Error("Invalid terminal claim lease or provider job identity");
  }
}

function isSafeCompletedObservation(
  claim: AdmittedTerminalClaim,
  observation: Extract<AdmittedTerminalObservation, { kind: "completed" }>,
): boolean {
  if (observation.mediaType !== "video/mp4"
    || observation.sourceUrlPolicy !== "ephemeral_refresh_via_provider_get"
    || observation.remoteArtifactRef !== claim.providerJobId
    || !/^sha256:[0-9a-f]{64}$/u.test(observation.evidenceDigest)) return false;
  try {
    const url = new URL(observation.sourceUrl);
    return url.protocol === "https:" && !url.username && !url.password && !Number.isNaN(Date.parse(observation.observedAt));
  } catch {
    return false;
  }
}

function remoteArtifactRef(
  claim: AdmittedTerminalClaim,
  _observation: Extract<AdmittedTerminalObservation, { kind: "completed" }>,
): string {
  // This identity must survive signed-URL refreshes, repeated observations, and
  // credential rotation. Mutable evidence belongs beside it, never inside it.
  return `provider-artifact://ai-media-studio/render-terminal/v1/${createHash("sha256").update(JSON.stringify({
    version: 1,
    ownerUserId: claim.scope.ownerUserId,
    workspaceId: claim.scope.workspaceId,
    renderJobId: claim.renderJobId,
    providerAccountId: claim.providerAccountId,
    providerKey: claim.providerKey,
    providerJobId: claim.providerJobId,
  })).digest("hex")}`;
}

function errorDigest(error: unknown, claim: AdmittedTerminalClaim): Sha256Digest {
  const classification = error instanceof Error ? error.name : "UnknownTerminalObservationError";
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    classification,
    attemptId: claim.id,
    terminalFencingToken: claim.terminalFencingToken.toString(),
    authorizationDigest: claim.authorizationDigest,
    providerAccountId: claim.providerAccountId,
    providerKey: claim.providerKey,
    providerJobId: claim.providerJobId,
  })).digest("hex")}`;
}

function boundedProviderId(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length >= 1 && value.length <= 500;
}
