import { createHash } from "node:crypto";
import type {
  AdmittedProviderResolver,
  AdmittedAuthorizedIdentity,
  AdmittedRenderRepository,
  AdmittedSendAuthorization,
  AdmittedSubmitOutcome,
  ExactNegativeSubmissionFinality,
} from "./admitted-render-contracts";
import type { Sha256Digest } from "../planning/contracts";

export type AdmittedWorkerResult =
  | { outcome: "idle" }
  | { outcome: "confirmed" | "ambiguous" | "reconciled_no_submit" | "authorization_lost"; attemptId: string };

/**
 * Dedicated admitted worker. It has no retry loop: once authorization commits,
 * every uncertain result is reconciled by the same persisted provider key.
 */
export class AdmittedRenderWorker {
  constructor(private readonly options: {
    workerId: string;
    leaseDurationMs: number;
    repository: AdmittedRenderRepository;
    providerResolver: AdmittedProviderResolver;
  }) {
    if (!options.workerId.trim() || options.leaseDurationMs <= 0) throw new Error("A worker and positive lease are required");
  }

  async runNext(): Promise<AdmittedWorkerResult> {
    await this.options.repository.expireAuthorizedLeases();
    const claim = await this.options.repository.claim({
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    });
    if (!claim) return { outcome: "idle" };
    const authorization = await this.options.repository.authorize(claim);
    if (!authorization) return { outcome: "authorization_lost", attemptId: claim.id };
    let outcome: AdmittedSubmitOutcome;
    try {
      const { provider, capability } = await this.options.providerResolver.resolve(authorization);
      assertExactCapability(authorization, capability);
      outcome = await provider.submit(authorization.sealedRequest, {
        ...capability,
        providerIdempotencyKey: authorization.providerIdempotencyKey,
        avatarExternalResourceId: authorization.avatarExternalResourceId,
        voiceExternalResourceId: authorization.voiceExternalResourceId,
      });
    } catch (error) {
      // A thrown transport error cannot prove whether the provider accepted the
      // request. Preserve one-way semantics and reconcile; never auto-resubmit.
      outcome = { kind: "ambiguous", evidenceDigest: errorDigest(error, authorization) };
    }
    return this.persistOutcome(authorization, outcome);
  }

  async reconcileNext(): Promise<AdmittedWorkerResult> {
    const attempt = await this.options.repository.claimAmbiguous({
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs,
    });
    if (!attempt) return { outcome: "idle" };
    let outcome;
    try {
      const { provider, capability } = await this.options.providerResolver.resolve(attempt);
      assertExactCapability(attempt, capability);
      outcome = await provider.reconcile({ ...capability, providerIdempotencyKey: attempt.providerIdempotencyKey });
    } catch {
      const released = await this.options.repository.releaseUnknownReconciliation(attempt);
      return { outcome: released ? "ambiguous" : "authorization_lost", attemptId: attempt.id };
    }
    if (outcome.kind === "unknown") {
      const released = await this.options.repository.releaseUnknownReconciliation(attempt);
      return { outcome: released ? "ambiguous" : "authorization_lost", attemptId: attempt.id };
    }
    if (outcome.kind === "confirmed") {
      const committed = await this.options.repository.confirm({ ...attempt, ...outcome });
      return { outcome: committed ? "confirmed" : "authorization_lost", attemptId: attempt.id };
    }
    try {
      assertExactNegativeFinality(attempt, outcome.finality);
    } catch {
      const released = await this.options.repository.releaseUnknownReconciliation(attempt);
      return { outcome: released ? "ambiguous" : "authorization_lost", attemptId: attempt.id };
    }
    const committed = await this.options.repository.markReconciledNoSubmit({ ...attempt, finality: outcome.finality });
    return { outcome: committed ? "reconciled_no_submit" : "authorization_lost", attemptId: attempt.id };
  }

  private async persistOutcome(
    authorization: AdmittedSendAuthorization,
    outcome: AdmittedSubmitOutcome,
  ): Promise<AdmittedWorkerResult> {
    if (outcome.kind === "confirmed") {
      const committed = await this.options.repository.confirm({ ...authorization, ...outcome });
      return { outcome: committed ? "confirmed" : "authorization_lost", attemptId: authorization.id };
    }
    const committed = await this.options.repository.markAmbiguous({ ...authorization, ...outcome });
    return { outcome: committed ? "ambiguous" : "authorization_lost", attemptId: authorization.id };
  }
}

function assertExactNegativeFinality(
  authorization: AdmittedAuthorizedIdentity & { providerIdempotencyKey: string },
  finality: ExactNegativeSubmissionFinality,
): void {
  if (!finality || finality.guarantee !== "linearizable_not_accepted_and_cannot_later_accept"
    || finality.scope.ownerUserId !== authorization.scope.ownerUserId
    || finality.scope.workspaceId !== authorization.scope.workspaceId
    || finality.providerAccountId !== authorization.providerAccountId
    || finality.providerKey !== authorization.providerKey
    || finality.providerCredentialVersion !== authorization.providerCredentialVersion
    || finality.authorizationDigest !== authorization.authorizationDigest
    || finality.providerIdempotencyKey !== authorization.providerIdempotencyKey
    || !/^sha256:[0-9a-f]{64}$/u.test(finality.evidenceDigest)
    || Number.isNaN(Date.parse(finality.observedAt))) {
    throw new Error("Provider returned negative finality for another or non-linearizable authorization");
  }
}

function assertExactCapability(
  authorization: AdmittedAuthorizedIdentity,
  capability: {
    scope: { ownerUserId: string; workspaceId: string };
    providerAccountId: string;
    providerKey: string;
    providerCredentialVersion: number;
    authorizationDigest: string;
  },
): void {
  if (capability.scope.ownerUserId !== authorization.scope.ownerUserId
    || capability.scope.workspaceId !== authorization.scope.workspaceId
    || capability.providerAccountId !== authorization.providerAccountId
    || capability.providerKey !== authorization.providerKey
    || capability.providerCredentialVersion !== authorization.providerCredentialVersion
    || capability.authorizationDigest !== authorization.authorizationDigest) {
    throw new Error("Provider resolver returned a capability for another admitted authorization");
  }
}

function errorDigest(error: unknown, authorization: AdmittedSendAuthorization): Sha256Digest {
  const classification = error instanceof Error ? error.name : "UnknownTransportError";
  return `sha256:${createHash("sha256").update(JSON.stringify({
    version: 1,
    classification,
    attemptId: authorization.id,
    fencingToken: authorization.fencingToken.toString(),
    authorizationDigest: authorization.authorizationDigest,
    providerAccountId: authorization.providerAccountId,
    providerKey: authorization.providerKey,
  })).digest("hex")}`;
}
