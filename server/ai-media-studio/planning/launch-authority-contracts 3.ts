import type { TenantScope } from "../core/resource-domain";
import type { MicroUsd, Sha256Digest } from "./contracts";

export const SLOT_LAUNCH_EVIDENCE_KINDS = ["content_approval", "human_launch_approval", "sandbox_proof", "maximum_quote"] as const;
export type SlotLaunchEvidenceKind = (typeof SLOT_LAUNCH_EVIDENCE_KINDS)[number];
export type SlotLaunchEvidenceDecision = "approved" | "rejected" | "passed" | "failed" | "quoted" | "declined" | "revoked";
export type ScriptChecksum = string;

export interface SlotLaunchAuthoritySubject {
  scope: TenantScope;
  planId: string;
  planDigest: Sha256Digest;
  slotId: string;
  slotDigest: Sha256Digest;
  slotAttempt: number;
  providerAccountId: string;
  providerKey: string;
  credentialVersion: number;
  scriptVariantId: string;
  scriptChecksum: ScriptChecksum;
  governanceProfileId: string;
  governanceEvidenceDigest: Sha256Digest;
  governanceUse: string;
  governanceTerritory: string;
  language: string;
  country: string;
  timeZone: string;
}

export interface AdmissionPolicyRevision {
  id: string;
  scope: TenantScope;
  revision: number;
  previousRevisionId?: string;
  dailyBudgetMicroUsd: MicroUsd;
  totalConcurrency: number;
  providerConcurrency: number;
  tenantConcurrency: number;
  allowedLanguages: readonly string[];
  allowedCountries: readonly string[];
  allowedTimeZones: readonly string[];
  state: "active" | "disabled";
  validFrom: string;
  expiresAt?: string;
  policyDigest: Sha256Digest;
  evidenceDigest: Sha256Digest;
  createdAt: string;
}

export interface WorkspaceKillSwitchRevision {
  id: string;
  scope: TenantScope;
  revision: number;
  previousRevisionId?: string;
  active: boolean;
  validFrom: string;
  expiresAt?: string;
  reason: string;
  evidenceDigest: Sha256Digest;
  createdAt: string;
}

export interface SlotLaunchEvidence {
  id: string;
  scope: TenantScope;
  subjectDigest: Sha256Digest;
  kind: SlotLaunchEvidenceKind;
  decision: SlotLaunchEvidenceDecision;
  amountMicroUsd?: MicroUsd;
  currency?: "USD";
  revision: number;
  previousEvidenceId?: string;
  validFrom: string;
  expiresAt?: string;
  evidenceDigest: Sha256Digest;
  createdAt: string;
}

export interface LaunchAuthoritySnapshot {
  id: string;
  scope: TenantScope;
  subject: SlotLaunchAuthoritySubject;
  launchSubjectDigest: Sha256Digest;
  policyRevisionId: string;
  policyRevision: number;
  policyDigest: Sha256Digest;
  killSwitchRevisionId: string;
  killSwitchRevision: number;
  killSwitchEvidenceDigest: Sha256Digest;
  contentApprovalEvidenceId: string;
  contentApprovalEvidenceDigest: Sha256Digest;
  humanLaunchApprovalEvidenceId: string;
  humanLaunchApprovalEvidenceDigest: Sha256Digest;
  sandboxEvidenceId: string;
  sandboxEvidenceDigest: Sha256Digest;
  maximumQuoteEvidenceId: string;
  maximumQuoteEvidenceDigest: Sha256Digest;
  maximumQuoteMicroUsd: MicroUsd;
  currency: "USD";
  validFrom: string;
  expiresAt: string;
  authorityDigest: Sha256Digest;
  admissionDigest: Sha256Digest;
  createdAt: string;
}

export type LaunchAuthorityDomainErrorCode = "DENIED" | "EXPIRED" | "INVALID_INPUT" | "KILL_SWITCH_ACTIVE" | "REVOKED" | "STALE_AUTHORITY" | "SUBJECT_MISMATCH" | "TENANT_MISMATCH";

export class LaunchAuthorityDomainError extends Error {
  constructor(readonly code: LaunchAuthorityDomainErrorCode, message: string) {
    super(message);
    this.name = "LaunchAuthorityDomainError";
  }
}
