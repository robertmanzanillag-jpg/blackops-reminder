import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import {
  DailyAdmissionDomainError,
  MAX_MICRO_USD,
  type BudgetBucket,
  type BudgetReservation,
  type DailyAdmissionBlockCode,
  type DailyAdmissionEvidence,
  type DailyAdmissionIntent,
  type DailyLaunchApproval,
  type DailyPlan,
  type DailyPlanSlot,
  type MicroUsd,
  type Sha256Digest,
} from "./contracts";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PLAN_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export interface DailyPlanSlotBlueprint {
  influencerId: string;
  videoNumber: number;
}

export interface CreateDailyPlanPreviewInput {
  scope: TenantScope;
  planDate: string;
  timeZone: string;
  rosterDigest: Sha256Digest;
  slots: readonly DailyPlanSlotBlueprint[];
  now: string;
}

export interface ReserveDailyPlanSlotInput {
  slot: DailyPlanSlot;
  bucket: BudgetBucket;
  intent: DailyAdmissionIntent;
  reservationExpiresAt: string;
  now: string;
  existingReservation?: BudgetReservation;
}

export interface DailyReservationTransition {
  slot: DailyPlanSlot;
  bucket: BudgetBucket;
  reservation: BudgetReservation;
  idempotent: boolean;
}

/**
 * Money is represented exclusively as integer micro-USD. Numbers are rejected
 * so an unsafe JavaScript float can never become budget authority by accident.
 */
export function microUsd(value: bigint | string, field = "microUsd"): MicroUsd {
  const parsed = typeof value === "bigint"
    ? value
    : typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value) ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > MAX_MICRO_USD) {
    throw invalid(`${field} must be a non-negative signed 64-bit integer in micro-USD`);
  }
  return parsed;
}

export function createDailyPlanPreview(input: CreateDailyPlanPreviewInput): { plan: DailyPlan; slots: DailyPlanSlot[] } {
  const scope = validScope(input.scope);
  const planDate = validPlanDate(input.planDate);
  const timeZone = validTimeZone(input.timeZone);
  const rosterDigest = validDigest(input.rosterDigest, "rosterDigest");
  const now = validInstant(input.now, "now");
  if (input.slots.length === 0) throw invalid("A daily plan requires at least one slot");

  const blueprints = input.slots.map((slot) => ({
    influencerId: validId(slot.influencerId, "influencerId"),
    videoNumber: positiveInteger(slot.videoNumber, "videoNumber"),
  }));
  const slotKeys = blueprints.map(({ influencerId, videoNumber }) => `${influencerId}\0${videoNumber}`);
  if (new Set(slotKeys).size !== slotKeys.length) throw invalid("Daily plan slots must be unique by influencer and video number");
  const canonicalSlots = [...blueprints].sort((left, right) =>
    left.influencerId.localeCompare(right.influencerId) || left.videoNumber - right.videoNumber);
  const previewDigest = digest({ scope, planDate, timeZone, rosterDigest, slots: canonicalSlots });
  const planId = stableId("plan", { scope, planDate, timeZone, rosterDigest }, 24);
  const plan: DailyPlan = {
    id: planId, scope, planDate, timeZone, rosterDigest, previewDigest, state: "preview",
    version: 1, slotCount: canonicalSlots.length, createdAt: now, updatedAt: now,
  };
  const slots = canonicalSlots.map(({ influencerId, videoNumber }) => ({
    id: stableId("slot", { planId, influencerId, videoNumber }, 24),
    scope, planId, planDate, timeZone, influencerId, videoNumber, planDigest: previewDigest,
    state: "preview" as const, attempt: 1, version: 1, createdAt: now, updatedAt: now,
  }));
  return { plan, slots };
}

export function confirmDailyPlan(
  plan: DailyPlan,
  slots: readonly DailyPlanSlot[],
  expectedPreviewDigest: Sha256Digest,
  nowInput: string,
): { plan: DailyPlan; slots: DailyPlanSlot[]; idempotent: boolean } {
  const now = validInstant(nowInput, "now");
  validDigest(expectedPreviewDigest, "expectedPreviewDigest");
  assertPlanComposition(plan, slots);
  if (plan.previewDigest !== expectedPreviewDigest) throw conflict("The daily plan preview changed before confirmation");
  if (plan.state === "planned") {
    if (slots.every((slot) => slot.state === "planned")) return { plan, slots: [...slots], idempotent: true };
    throw invariant("A planned daily plan contains slots outside the planned state");
  }
  if (plan.state !== "preview" || slots.some((slot) => slot.state !== "preview")) {
    throw transition("Only a complete preview can be confirmed");
  }
  return {
    plan: { ...plan, state: "planned", version: plan.version + 1, updatedAt: now },
    slots: slots.map((slot) => ({ ...slot, state: "planned", version: slot.version + 1, updatedAt: now })),
    idempotent: false,
  };
}

export function dailyAdmissionApprovalSubjectDigest(
  slot: DailyPlanSlot,
  evidenceInput: DailyAdmissionEvidence,
): Sha256Digest {
  assertSlotIdentity(slot);
  const evidence = validEvidence(evidenceInput);
  return digest({
    scope: slot.scope, planId: slot.planId, slotId: slot.id, slotAttempt: slot.attempt,
    planDigest: slot.planDigest, evidence: digestableEvidence(evidence),
  });
}

export function createDailyAdmissionIntent(
  slot: DailyPlanSlot,
  evidenceInput: DailyAdmissionEvidence,
  approvalInput: DailyLaunchApproval,
): DailyAdmissionIntent {
  if (slot.state !== "planned") throw transition("Admission intent requires a planned slot");
  const evidence = validEvidence(evidenceInput);
  const approval = validApproval(approvalInput);
  const approvalSubjectDigest = dailyAdmissionApprovalSubjectDigest(slot, evidence);
  if (approval.approvedSubjectDigest !== approvalSubjectDigest) {
    throw new DailyAdmissionDomainError("HUMAN_APPROVAL_INVALID", "Human approval is not bound to the exact admission subject");
  }
  const admissionDigest = digest({
    approvalSubjectDigest,
    approvalEvidenceDigest: approval.evidenceDigest,
    approvalApprovedAt: approval.approvedAt,
    approvalExpiresAt: approval.expiresAt,
  });
  return {
    planId: slot.planId,
    slotId: slot.id,
    slotAttempt: slot.attempt,
    approvalSubjectDigest,
    approvalEvidenceDigest: approval.evidenceDigest,
    admissionDigest,
    idempotencyKey: stableId("daily_admission", {
      planId: slot.planId, slotId: slot.id, slotAttempt: slot.attempt, admissionDigest,
    }),
    evidence,
    approval,
  };
}

/**
 * Pure locked-row transition model. A durable adapter must execute the slot,
 * bucket, reservation, render-job, and outbox writes in one DB transaction.
 * This function itself never creates a job, contacts a provider, or spends.
 */
export function reserveDailyPlanSlot(input: ReserveDailyPlanSlotInput): DailyReservationTransition {
  const { slot, bucket, intent } = input;
  assertSlotIdentity(slot);
  assertBucket(bucket);
  assertScopeEqual(slot.scope, bucket.scope);
  if (slot.planDate !== bucket.planDate || slot.timeZone !== bucket.timeZone) {
    throw invariant("Budget bucket is not bound to the slot's server-owned budget day");
  }
  assertIntentMatchesSlot(intent, slot);

  if (slot.state === "reserved" || slot.state === "committed") {
    return exactReservationReplay(input);
  }
  if (slot.state !== "planned") throw transition("Only a planned slot can reserve budget");
  if (input.existingReservation !== undefined) {
    throw invariant("A planned slot cannot be paired with an existing budget reservation");
  }

  const now = validInstant(input.now, "now");
  const reservationExpiresAt = validInstant(input.reservationExpiresAt, "reservationExpiresAt");
  assertAdmissionGates(intent, now);
  if (Date.parse(reservationExpiresAt) <= Date.parse(now)
    || Date.parse(reservationExpiresAt) > Date.parse(intent.evidence.quoteExpiresAt)) {
    throw new DailyAdmissionDomainError("RESERVATION_EXPIRED", "Reservation expiry must be future-dated and no later than the maximum quote expiry");
  }
  const amount = intent.evidence.maximumQuoteMicroUsd;
  const available = bucket.limitMicroUsd - bucket.reservedMicroUsd - bucket.committedMicroUsd;
  if (amount > available) {
    throw new DailyAdmissionDomainError("BUDGET_EXHAUSTED", "The locked daily budget bucket has insufficient available micro-USD");
  }
  const reservationId = stableId("budget_reservation", {
    bucketId: bucket.id, slotId: slot.id, slotAttempt: slot.attempt, admissionDigest: intent.admissionDigest,
  });
  const reservation: BudgetReservation = {
    id: reservationId, scope: slot.scope, bucketId: bucket.id, planId: slot.planId, slotId: slot.id,
    slotAttempt: slot.attempt, admissionDigest: intent.admissionDigest, idempotencyKey: intent.idempotencyKey,
    amountMicroUsd: amount, state: "reserved", version: 1, reservedAt: now,
    expiresAt: reservationExpiresAt, updatedAt: now,
  };
  return {
    slot: {
      ...slot, state: "reserved", version: slot.version + 1, updatedAt: now,
      admissionDigest: intent.admissionDigest, admissionIdempotencyKey: intent.idempotencyKey, reservationId,
    },
    bucket: { ...bucket, reservedMicroUsd: bucket.reservedMicroUsd + amount, version: bucket.version + 1, updatedAt: now },
    reservation,
    idempotent: false,
  };
}

/** Commit immediately before a provider submission. Committed funds never auto-refund after an ambiguous response. */
export function commitDailyPlanReservation(
  slot: DailyPlanSlot,
  bucket: BudgetBucket,
  reservation: BudgetReservation,
  nowInput: string,
): DailyReservationTransition {
  const now = validInstant(nowInput, "now");
  assertLinked(slot, bucket, reservation);
  if (slot.state === "committed" && reservation.state === "committed") {
    return { slot, bucket, reservation, idempotent: true };
  }
  if (slot.state !== "reserved" || reservation.state !== "reserved") {
    throw transition("Only an active reservation can be committed");
  }
  if (Date.parse(now) >= Date.parse(reservation.expiresAt)) {
    throw new DailyAdmissionDomainError("RESERVATION_EXPIRED", "Expired reservations cannot be committed");
  }
  if (bucket.reservedMicroUsd < reservation.amountMicroUsd) throw invariant("Budget bucket reserved balance is inconsistent");
  return {
    slot: { ...slot, state: "committed", version: slot.version + 1, updatedAt: now },
    bucket: {
      ...bucket,
      reservedMicroUsd: bucket.reservedMicroUsd - reservation.amountMicroUsd,
      committedMicroUsd: bucket.committedMicroUsd + reservation.amountMicroUsd,
      version: bucket.version + 1,
      updatedAt: now,
    },
    reservation: { ...reservation, state: "committed", version: reservation.version + 1, committedAt: now, updatedAt: now },
    idempotent: false,
  };
}

export function releaseDailyPlanReservation(
  slot: DailyPlanSlot,
  bucket: BudgetBucket,
  reservation: BudgetReservation,
  nowInput: string,
): DailyReservationTransition {
  return closeReservation(slot, bucket, reservation, "released", validInstant(nowInput, "now"));
}

export function expireDailyPlanReservation(
  slot: DailyPlanSlot,
  bucket: BudgetBucket,
  reservation: BudgetReservation,
  nowInput: string,
): DailyReservationTransition {
  const now = validInstant(nowInput, "now");
  if (Date.parse(now) < Date.parse(reservation.expiresAt)) {
    throw transition("A reservation cannot expire before its authoritative expiry instant");
  }
  return closeReservation(slot, bucket, reservation, "expired", now);
}

export function blockDailyPlanSlot(
  slot: DailyPlanSlot,
  code: DailyAdmissionBlockCode,
  evidenceDigestInput: Sha256Digest,
  nowInput: string,
): { slot: DailyPlanSlot; idempotent: boolean } {
  const evidenceDigest = validDigest(evidenceDigestInput, "blockedEvidenceDigest");
  const now = validInstant(nowInput, "now");
  assertSlotIdentity(slot);
  if (slot.state === "blocked") {
    if (slot.blockedCode === code && slot.blockedEvidenceDigest === evidenceDigest) return { slot, idempotent: true };
    throw conflict("A blocked slot cannot be replayed with different evidence");
  }
  if (slot.state !== "planned" && slot.state !== "preview") {
    throw transition("Reserved, committed, released, and expired slots cannot be directly blocked");
  }
  return {
    slot: { ...slot, state: "blocked", blockedCode: code, blockedEvidenceDigest: evidenceDigest, version: slot.version + 1, updatedAt: now },
    idempotent: false,
  };
}

export function blockDailyPlan(
  plan: DailyPlan,
  code: DailyAdmissionBlockCode,
  evidenceDigestInput: Sha256Digest,
  nowInput: string,
): { plan: DailyPlan; idempotent: boolean } {
  const evidenceDigest = validDigest(evidenceDigestInput, "blockedEvidenceDigest");
  const now = validInstant(nowInput, "now");
  if (plan.state === "blocked") {
    if (plan.blockedCode === code && plan.blockedEvidenceDigest === evidenceDigest) return { plan, idempotent: true };
    throw conflict("A blocked daily plan cannot be replayed with different evidence");
  }
  if (plan.state !== "preview" && plan.state !== "planned") throw transition("Daily plan cannot be blocked from its current state");
  return {
    plan: { ...plan, state: "blocked", blockedCode: code, blockedEvidenceDigest: evidenceDigest, version: plan.version + 1, updatedAt: now },
    idempotent: false,
  };
}

/** Remediation always creates a new attempt, preventing reuse of old approval or reservation evidence. */
export function replanDailyPlanSlot(slot: DailyPlanSlot, nowInput: string): DailyPlanSlot {
  const now = validInstant(nowInput, "now");
  if (slot.state !== "blocked" && slot.state !== "released" && slot.state !== "expired") {
    throw transition("Only a blocked, released, or expired slot can start a new attempt");
  }
  const { admissionDigest: _admissionDigest, admissionIdempotencyKey: _key, reservationId: _reservationId,
    blockedCode: _blockedCode, blockedEvidenceDigest: _blockedEvidence, ...base } = slot;
  return { ...base, state: "planned", attempt: slot.attempt + 1, version: slot.version + 1, updatedAt: now };
}

function closeReservation(
  slot: DailyPlanSlot,
  bucket: BudgetBucket,
  reservation: BudgetReservation,
  target: "released" | "expired",
  now: string,
): DailyReservationTransition {
  assertLinked(slot, bucket, reservation);
  if (slot.state === target && reservation.state === target) return { slot, bucket, reservation, idempotent: true };
  if (slot.state === "committed" || reservation.state === "committed") {
    throw transition("Committed reservations cannot be released or expired; reconciliation must settle them");
  }
  if (slot.state !== "reserved" || reservation.state !== "reserved") {
    throw transition(`Only an active reservation can be ${target}`);
  }
  if (bucket.reservedMicroUsd < reservation.amountMicroUsd) throw invariant("Budget bucket reserved balance is inconsistent");
  return {
    slot: { ...slot, state: target, version: slot.version + 1, updatedAt: now },
    bucket: {
      ...bucket, reservedMicroUsd: bucket.reservedMicroUsd - reservation.amountMicroUsd,
      version: bucket.version + 1, updatedAt: now,
    },
    reservation: {
      ...reservation, state: target, version: reservation.version + 1, updatedAt: now,
      ...(target === "released" ? { releasedAt: now } : { expiredAt: now }),
    },
    idempotent: false,
  };
}

function exactReservationReplay(input: ReserveDailyPlanSlotInput): DailyReservationTransition {
  const { slot, bucket, intent, existingReservation } = input;
  if (!existingReservation) throw invariant("Exact reservation replay requires the authoritative existing reservation");
  assertLinked(slot, bucket, existingReservation);
  const requestedExpiry = validInstant(input.reservationExpiresAt, "reservationExpiresAt");
  const exact = slot.admissionDigest === intent.admissionDigest
    && slot.admissionIdempotencyKey === intent.idempotencyKey
    && existingReservation.admissionDigest === intent.admissionDigest
    && existingReservation.idempotencyKey === intent.idempotencyKey
    && existingReservation.amountMicroUsd === intent.evidence.maximumQuoteMicroUsd
    && existingReservation.expiresAt === requestedExpiry
    && existingReservation.slotAttempt === intent.slotAttempt
    && ((slot.state === "reserved" && existingReservation.state === "reserved")
      || (slot.state === "committed" && existingReservation.state === "committed"));
  if (!exact) throw conflict("The slot attempt already has a different reservation or admission digest");
  return { slot, bucket, reservation: existingReservation, idempotent: true };
}

function assertAdmissionGates(intent: DailyAdmissionIntent, now: string): void {
  const evidence = intent.evidence;
  if (evidence.killSwitchActive) throw new DailyAdmissionDomainError("KILL_SWITCH_ACTIVE", "Global generation kill switch is active");
  if (evidence.accountStatus !== "active_verified") throw new DailyAdmissionDomainError("ACCOUNT_NOT_READY", "Provider account is not active and verified");
  if (evidence.governanceStatus !== "approved") throw new DailyAdmissionDomainError("GOVERNANCE_NOT_APPROVED", "Governance evidence is not approved");
  if (evidence.sandboxStatus !== "passed") throw new DailyAdmissionDomainError("SANDBOX_NOT_PASSED", "Sandbox evidence has not passed");
  if (!evidence.policyAllowed) throw new DailyAdmissionDomainError("POLICY_NOT_ALLOWED", "Admission policy denied this exact subject");
  if (Date.parse(now) >= Date.parse(evidence.quoteExpiresAt)) throw new DailyAdmissionDomainError("QUOTE_EXPIRED", "Maximum quote is missing or expired");
  if (Date.parse(now) < Date.parse(intent.approval.approvedAt)) throw new DailyAdmissionDomainError("HUMAN_APPROVAL_INVALID", "Human launch approval is not active yet");
  if (Date.parse(now) >= Date.parse(intent.approval.expiresAt)) throw new DailyAdmissionDomainError("HUMAN_APPROVAL_INVALID", "Human launch approval is expired");
  if (intent.approval.approvedSubjectDigest !== intent.approvalSubjectDigest) {
    throw new DailyAdmissionDomainError("HUMAN_APPROVAL_INVALID", "Human launch approval does not match the exact admission subject");
  }
}

function assertPlanComposition(plan: DailyPlan, slots: readonly DailyPlanSlot[]): void {
  validScope(plan.scope);
  validId(plan.id, "plan.id");
  validPlanDate(plan.planDate);
  validTimeZone(plan.timeZone);
  validDigest(plan.rosterDigest, "plan.rosterDigest");
  validDigest(plan.previewDigest, "plan.previewDigest");
  positiveInteger(plan.version, "plan.version");
  positiveInteger(plan.slotCount, "plan.slotCount");
  validInstant(plan.createdAt, "plan.createdAt");
  validInstant(plan.updatedAt, "plan.updatedAt");
  if (slots.length !== plan.slotCount) throw invariant("Daily plan slot count does not match its immutable preview");
  for (const slot of slots) {
    assertSlotIdentity(slot);
    assertScopeEqual(plan.scope, slot.scope);
    if (slot.planId !== plan.id || slot.planDigest !== plan.previewDigest
      || slot.planDate !== plan.planDate || slot.timeZone !== plan.timeZone) {
      throw invariant("Daily plan slot is not bound to the exact plan preview");
    }
  }
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length) throw invariant("Daily plan contains duplicate slot IDs");
}

function assertIntentMatchesSlot(intent: DailyAdmissionIntent, slot: DailyPlanSlot): void {
  const approval = validApproval(intent.approval);
  const regeneratedSubject = dailyAdmissionApprovalSubjectDigest(slot, intent.evidence);
  const regeneratedAdmission = digest({
    approvalSubjectDigest: regeneratedSubject,
    approvalEvidenceDigest: approval.evidenceDigest,
    approvalApprovedAt: approval.approvedAt,
    approvalExpiresAt: approval.expiresAt,
  });
  const regeneratedKey = stableId("daily_admission", {
    planId: slot.planId, slotId: slot.id, slotAttempt: slot.attempt, admissionDigest: regeneratedAdmission,
  });
  if (intent.planId !== slot.planId || intent.slotId !== slot.id || intent.slotAttempt !== slot.attempt
    || intent.approvalSubjectDigest !== regeneratedSubject || intent.admissionDigest !== regeneratedAdmission
    || intent.idempotencyKey !== regeneratedKey || intent.approvalEvidenceDigest !== approval.evidenceDigest
    || approval.approvedSubjectDigest !== regeneratedSubject
    || intent.approval.approvedAt !== approval.approvedAt || intent.approval.expiresAt !== approval.expiresAt) {
    throw conflict("Admission intent is not the exact canonical intent for this slot attempt");
  }
}

function assertLinked(slot: DailyPlanSlot, bucket: BudgetBucket, reservation: BudgetReservation): void {
  assertSlotIdentity(slot);
  assertBucket(bucket);
  assertScopeEqual(slot.scope, bucket.scope);
  assertScopeEqual(slot.scope, reservation.scope);
  if (reservation.bucketId !== bucket.id || reservation.planId !== slot.planId || reservation.slotId !== slot.id
    || reservation.slotAttempt !== slot.attempt || reservation.id !== slot.reservationId
    || reservation.admissionDigest !== slot.admissionDigest || reservation.idempotencyKey !== slot.admissionIdempotencyKey) {
    throw invariant("Reservation, slot, and budget bucket bindings do not match");
  }
  microUsd(reservation.amountMicroUsd, "reservation.amountMicroUsd");
  validInstant(reservation.expiresAt, "reservation.expiresAt");
  if (reservation.state === "reserved" && bucket.reservedMicroUsd < reservation.amountMicroUsd) {
    throw invariant("Budget bucket does not contain the active reserved amount");
  }
  if (reservation.state === "committed" && bucket.committedMicroUsd < reservation.amountMicroUsd) {
    throw invariant("Budget bucket does not contain the committed amount");
  }
}

function assertSlotIdentity(slot: DailyPlanSlot): void {
  validScope(slot.scope);
  validId(slot.id, "slot.id");
  validId(slot.planId, "slot.planId");
  validId(slot.influencerId, "slot.influencerId");
  positiveInteger(slot.videoNumber, "slot.videoNumber");
  positiveInteger(slot.attempt, "slot.attempt");
  positiveInteger(slot.version, "slot.version");
  validDigest(slot.planDigest, "slot.planDigest");
  validPlanDate(slot.planDate);
  validTimeZone(slot.timeZone);
}

function assertBucket(bucket: BudgetBucket): void {
  validScope(bucket.scope);
  validId(bucket.id, "bucket.id");
  validPlanDate(bucket.planDate);
  validTimeZone(bucket.timeZone);
  microUsd(bucket.limitMicroUsd, "bucket.limitMicroUsd");
  microUsd(bucket.reservedMicroUsd, "bucket.reservedMicroUsd");
  microUsd(bucket.committedMicroUsd, "bucket.committedMicroUsd");
  positiveInteger(bucket.version, "bucket.version");
  if (bucket.reservedMicroUsd + bucket.committedMicroUsd > bucket.limitMicroUsd) {
    throw invariant("Budget bucket balances exceed its limit");
  }
}

function validEvidence(input: DailyAdmissionEvidence): DailyAdmissionEvidence {
  const evidence = {
    providerKey: validId(input.providerKey, "providerKey"),
    providerAccountId: validId(input.providerAccountId, "providerAccountId"),
    credentialVersion: positiveInteger(input.credentialVersion, "credentialVersion"),
    accountStatus: input.accountStatus,
    scriptDigest: validDigest(input.scriptDigest, "scriptDigest"),
    governanceStatus: input.governanceStatus,
    governanceEvidenceDigest: validDigest(input.governanceEvidenceDigest, "governanceEvidenceDigest"),
    sandboxStatus: input.sandboxStatus,
    sandboxEvidenceDigest: validDigest(input.sandboxEvidenceDigest, "sandboxEvidenceDigest"),
    policyAllowed: input.policyAllowed,
    policyDigest: validDigest(input.policyDigest, "policyDigest"),
    killSwitchActive: input.killSwitchActive,
    maximumQuoteMicroUsd: microUsd(input.maximumQuoteMicroUsd, "maximumQuoteMicroUsd"),
    quoteExpiresAt: validInstant(input.quoteExpiresAt, "quoteExpiresAt"),
  };
  if (!["active_verified", "inactive", "unverified"].includes(evidence.accountStatus)) throw invalid("accountStatus is invalid");
  if (!["approved", "missing", "rejected", "expired", "revoked"].includes(evidence.governanceStatus)) throw invalid("governanceStatus is invalid");
  if (!["passed", "missing", "failed", "expired"].includes(evidence.sandboxStatus)) throw invalid("sandboxStatus is invalid");
  if (typeof evidence.policyAllowed !== "boolean" || typeof evidence.killSwitchActive !== "boolean") throw invalid("Policy and kill switch values must be booleans");
  if (evidence.maximumQuoteMicroUsd === 0n) throw invalid("maximumQuoteMicroUsd must be positive");
  return evidence;
}

function validApproval(input: DailyLaunchApproval): DailyLaunchApproval {
  const approvedAt = validInstant(input.approvedAt, "approval.approvedAt");
  const expiresAt = validInstant(input.expiresAt, "approval.expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(approvedAt)) throw invalid("Human launch approval must expire after it is issued");
  return {
    approvedSubjectDigest: validDigest(input.approvedSubjectDigest, "approval.approvedSubjectDigest"),
    evidenceDigest: validDigest(input.evidenceDigest, "approval.evidenceDigest"),
    approvedAt,
    expiresAt,
  };
}

function digestableEvidence(evidence: DailyAdmissionEvidence): Record<string, unknown> {
  return { ...evidence, maximumQuoteMicroUsd: evidence.maximumQuoteMicroUsd.toString() };
}

function digest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex")}`;
}

function stableId(prefix: string, value: unknown, digestLength = 32): string {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex").slice(0, digestLength)}`;
}

function canonicalJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function validScope(scope: TenantScope): TenantScope {
  return { ownerUserId: validId(scope.ownerUserId, "ownerUserId"), workspaceId: validId(scope.workspaceId, "workspaceId") };
}

function assertScopeEqual(left: TenantScope, right: TenantScope): void {
  if (left.ownerUserId !== right.ownerUserId || left.workspaceId !== right.workspaceId) {
    throw invariant("Cross-tenant planning or budget binding is forbidden");
  }
}

function validId(value: string, field: string): string {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) throw invalid(`${field} is invalid`);
  return value;
}

function validDigest(value: string, field: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) throw invalid(`${field} must be a lowercase SHA-256 digest`);
  return value as Sha256Digest;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${field} must be a positive safe integer`);
  return value;
}

function validPlanDate(value: string): string {
  const instant = typeof value === "string" ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;
  if (!PLAN_DATE.test(value) || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value) {
    throw invalid("planDate must be a real YYYY-MM-DD calendar date");
  }
  return value;
}

function validTimeZone(value: string): string {
  try {
    if (typeof value !== "string" || value.length > 100 || new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone !== value) {
      throw new Error("invalid");
    }
  } catch {
    throw invalid("timeZone must be a canonical IANA time zone");
  }
  return value;
}

function validInstant(value: string, field: string): string {
  const instant = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw invalid(`${field} must be a canonical UTC ISO-8601 instant with milliseconds`);
  }
  return value;
}

function invalid(message: string): DailyAdmissionDomainError {
  return new DailyAdmissionDomainError("INVALID_INPUT", message);
}
function transition(message: string): DailyAdmissionDomainError {
  return new DailyAdmissionDomainError("INVALID_TRANSITION", message);
}
function conflict(message: string): DailyAdmissionDomainError {
  return new DailyAdmissionDomainError("IDEMPOTENCY_CONFLICT", message);
}
function invariant(message: string): DailyAdmissionDomainError {
  return new DailyAdmissionDomainError("INVARIANT_VIOLATION", message);
}
