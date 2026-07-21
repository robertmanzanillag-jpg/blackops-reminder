import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";

export type AdmittedSubmissionState =
  | "claimed" | "authorized" | "confirmed" | "ambiguous" | "reconciled_no_submit";

export interface AdmittedSubmissionIdentity {
  id: string;
  scope: TenantScope;
  budgetReservationId: string;
  renderJobId: string;
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  providerIdempotencyKey: string;
  avatarExternalResourceId: string;
  voiceExternalResourceId: string;
  sealedRequest: Readonly<Record<string, unknown>>;
  sealedRequestDigest: Sha256Digest;
  fencingToken: bigint;
}

export interface AdmittedSubmissionClaim extends AdmittedSubmissionIdentity {
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface AdmittedAuthorizedIdentity extends AdmittedSubmissionIdentity {
  authorizationDigest: Sha256Digest;
  commitEvidenceDigest: Sha256Digest;
  authorizedAt: string;
}

export interface AdmittedSendAuthorization extends AdmittedAuthorizedIdentity {
  leaseToken: string;
  leaseExpiresAt: string;
}

declare const exactProviderCapability: unique symbol;
export interface ExactAdmittedProviderCapability {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly providerCredentialVersion: number;
  readonly authorizationDigest: Sha256Digest;
  readonly [exactProviderCapability]: true;
}

export type AdmittedSubmitOutcome =
  | { kind: "confirmed"; providerJobId: string; providerRequestId?: string; evidenceDigest: Sha256Digest }
  | { kind: "ambiguous"; providerRequestId?: string; evidenceDigest: Sha256Digest };

declare const exactNegativeSubmissionFinality: unique symbol;
/**
 * Provider-specific proof from a linearizable operation which establishes that
 * this exact idempotency key was not accepted and can never be accepted later.
 * Timeouts, 404s and eventual-consistency absence must never mint this brand.
 * No HeyGen adapter may implement it until that contract is independently verified.
 */
export interface ExactNegativeSubmissionFinality {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly providerCredentialVersion: number;
  readonly authorizationDigest: Sha256Digest;
  readonly providerIdempotencyKey: string;
  readonly guarantee: "linearizable_not_accepted_and_cannot_later_accept";
  readonly observedAt: string;
  readonly evidenceDigest: Sha256Digest;
  readonly [exactNegativeSubmissionFinality]: true;
}

export type AdmittedReconciliationOutcome =
  | { kind: "confirmed"; providerJobId: string; providerRequestId?: string; evidenceDigest: Sha256Digest }
  | { kind: "definitive_no_submit"; finality: ExactNegativeSubmissionFinality }
  | { kind: "unknown" };

export interface AdmittedRenderProvider {
  submit(
    request: Readonly<Record<string, unknown>>,
    context: ExactAdmittedProviderCapability & {
      providerIdempotencyKey: string;
      avatarExternalResourceId: string;
      voiceExternalResourceId: string;
    },
  ): Promise<AdmittedSubmitOutcome>;
  reconcile(context: ExactAdmittedProviderCapability & {
    providerIdempotencyKey: string;
  }): Promise<AdmittedReconciliationOutcome>;
}

export interface AdmittedProviderResolver {
  resolve(authorization: AdmittedAuthorizedIdentity): Promise<{
    provider: AdmittedRenderProvider;
    capability: ExactAdmittedProviderCapability;
  }>;
}

export interface AdmittedReconciliationClaim extends AdmittedAuthorizedIdentity {
  reconciliationLeaseToken: string;
  reconciliationLeaseOwner: string;
  reconciliationFencingToken: bigint;
}

export interface AdmittedRenderRepository {
  claim(input: { workerId: string; leaseDurationMs: number }): Promise<AdmittedSubmissionClaim | undefined>;
  authorize(claim: AdmittedSubmissionClaim): Promise<AdmittedSendAuthorization | undefined>;
  confirm(input: AdmittedAuthorizedIdentity & { providerJobId: string; providerRequestId?: string; evidenceDigest: Sha256Digest }): Promise<boolean>;
  markAmbiguous(input: AdmittedSendAuthorization & { providerRequestId?: string; evidenceDigest: Sha256Digest }): Promise<boolean>;
  markReconciledNoSubmit(input: AdmittedReconciliationClaim & { finality: ExactNegativeSubmissionFinality }): Promise<boolean>;
  expireAuthorizedLeases(): Promise<number>;
  claimAmbiguous(input: { workerId: string; leaseDurationMs: number }): Promise<AdmittedReconciliationClaim | undefined>;
  releaseUnknownReconciliation(claim: AdmittedReconciliationClaim): Promise<boolean>;
}
