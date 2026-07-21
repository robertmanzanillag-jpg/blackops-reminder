import type { TenantScope } from "../core/resource-domain";

export type Sha256Digest = `sha256:${string}`;
export type MicroUsd = bigint;

export const MAX_MICRO_USD = 9_000_000_000_000_000n;

export const DAILY_PLAN_STATES = ["preview", "planned", "blocked", "active", "completed", "cancelled"] as const;
export type DailyPlanState = (typeof DAILY_PLAN_STATES)[number];

export const DAILY_PLAN_SLOT_STATES = [
  "preview",
  "planned",
  "reserved",
  "committed",
  "released",
  "expired",
  "blocked",
  "queued",
  "submitted",
  "reconciling",
  "completed",
  "failed",
  "cancelled",
] as const;
export type DailyPlanSlotState = (typeof DAILY_PLAN_SLOT_STATES)[number];

export const BUDGET_RESERVATION_STATES = ["reserved", "committed", "released", "expired", "settled"] as const;
export type BudgetReservationState = (typeof BUDGET_RESERVATION_STATES)[number];

export type DailyAdmissionBlockCode =
  | "account_not_ready"
  | "budget_exhausted"
  | "governance_not_approved"
  | "human_approval_invalid"
  | "kill_switch_active"
  | "policy_not_allowed"
  | "quote_expired"
  | "sandbox_not_passed";

export interface DailyPlan {
  id: string;
  scope: TenantScope;
  planDate: string;
  timeZone: string;
  rosterDigest: Sha256Digest;
  previewDigest: Sha256Digest;
  state: DailyPlanState;
  version: number;
  slotCount: number;
  createdAt: string;
  updatedAt: string;
  blockedCode?: DailyAdmissionBlockCode;
  blockedEvidenceDigest?: Sha256Digest;
}

export interface DailyPlanSlot {
  id: string;
  scope: TenantScope;
  planId: string;
  planDate: string;
  timeZone: string;
  influencerId: string;
  videoNumber: number;
  planDigest: Sha256Digest;
  state: DailyPlanSlotState;
  attempt: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  admissionDigest?: Sha256Digest;
  admissionIdempotencyKey?: string;
  reservationId?: string;
  blockedCode?: DailyAdmissionBlockCode;
  blockedEvidenceDigest?: Sha256Digest;
}

export interface BudgetBucket {
  id: string;
  scope: TenantScope;
  planDate: string;
  timeZone: string;
  limitMicroUsd: MicroUsd;
  reservedMicroUsd: MicroUsd;
  committedMicroUsd: MicroUsd;
  version: number;
  updatedAt: string;
}

export interface BudgetReservation {
  id: string;
  scope: TenantScope;
  bucketId: string;
  planId: string;
  slotId: string;
  slotAttempt: number;
  admissionDigest: Sha256Digest;
  idempotencyKey: string;
  amountMicroUsd: MicroUsd;
  state: BudgetReservationState;
  version: number;
  reservedAt: string;
  expiresAt: string;
  updatedAt: string;
  committedAt?: string;
  releasedAt?: string;
  expiredAt?: string;
  settledAt?: string;
}

export interface DailyAdmissionEvidence {
  providerKey: string;
  providerAccountId: string;
  credentialVersion: number;
  accountStatus: "active_verified" | "inactive" | "unverified";
  scriptDigest: Sha256Digest;
  governanceStatus: "approved" | "missing" | "rejected" | "expired" | "revoked";
  governanceEvidenceDigest: Sha256Digest;
  sandboxStatus: "passed" | "missing" | "failed" | "expired";
  sandboxEvidenceDigest: Sha256Digest;
  policyAllowed: boolean;
  policyDigest: Sha256Digest;
  killSwitchActive: boolean;
  maximumQuoteMicroUsd: MicroUsd;
  quoteExpiresAt: string;
}

export interface DailyLaunchApproval {
  approvedSubjectDigest: Sha256Digest;
  evidenceDigest: Sha256Digest;
  approvedAt: string;
  expiresAt: string;
}

export interface DailyAdmissionIntent {
  planId: string;
  slotId: string;
  slotAttempt: number;
  approvalSubjectDigest: Sha256Digest;
  approvalEvidenceDigest: Sha256Digest;
  admissionDigest: Sha256Digest;
  idempotencyKey: string;
  evidence: DailyAdmissionEvidence;
  approval: DailyLaunchApproval;
}

export type DailyAdmissionDomainErrorCode =
  | "ACCOUNT_NOT_READY"
  | "BUDGET_EXHAUSTED"
  | "GOVERNANCE_NOT_APPROVED"
  | "HUMAN_APPROVAL_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "INVARIANT_VIOLATION"
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "KILL_SWITCH_ACTIVE"
  | "POLICY_NOT_ALLOWED"
  | "QUOTE_EXPIRED"
  | "RESERVATION_EXPIRED"
  | "SANDBOX_NOT_PASSED";

export class DailyAdmissionDomainError extends Error {
  constructor(readonly code: DailyAdmissionDomainErrorCode, message: string) {
    super(message);
    this.name = "DailyAdmissionDomainError";
  }
}
