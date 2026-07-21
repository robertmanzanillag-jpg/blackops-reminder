import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaBudgetBuckets,
  aiMediaBudgetReservations,
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaGovernanceProfiles,
  aiMediaInfluencers,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
  aiMediaScriptVariants,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "./contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type DailyAdmissionDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type DailyAdmissionTransactionalDatabase = DailyAdmissionDatabase & {
  transaction<T>(callback: (tx: DailyAdmissionDatabase) => Promise<T>): Promise<T>;
};

export type DailyAdmissionGovernanceUse = "internal_preview" | "organic_social" | "paid_ads" | "commercial";

export interface ReserveAndAdmitRequest {
  scope: TenantScope;
  planId: string;
  slotId: string;
  budgetBucketId: string;
  providerAccountId: string;
  providerKey: string;
  providerCredentialVersion: number;
  influencerId: string;
  governanceProfileId: string;
  governanceUse: DailyAdmissionGovernanceUse;
  governanceTerritory: string;
  planDigest: Sha256Digest;
  slotDigest: Sha256Digest;
  scriptVariantChecksum: string;
  expectedSlotStateVersion: number;
  expectedBucketStateVersion: number;
  budgetPolicyVersion: number;
  attempt: number;
  amountMicroUsd: bigint | string;
  idempotencyKey: string;
  inputDigest: Sha256Digest;
  admissionDigest: Sha256Digest;
  quoteDigest: Sha256Digest;
  quoteExpiresAt: string;
  reservationExpiresAt: string;
  contentApprovalGranted: boolean;
  contentApprovalDigest: Sha256Digest;
  contentApprovalExpiresAt: string;
  humanLaunchApprovalGranted: boolean;
  humanLaunchApprovalDigest: Sha256Digest;
  humanLaunchApprovalExpiresAt: string;
  governanceEvidenceDigest: Sha256Digest;
  policyAllowed: boolean;
  policyDigest: Sha256Digest;
  killSwitchActive: boolean;
  killSwitchEvidenceDigest: Sha256Digest;
  sandboxPassed: boolean;
  sandboxEvidenceDigest: Sha256Digest;
  sandboxExpiresAt: string;
  providerIdempotencyKey: string;
}

export type UnsignedReserveAndAdmitRequest = Omit<ReserveAndAdmitRequest, "inputDigest">;

export interface DurableDailyAdmissionReservation {
  id: string;
  state: "reserved" | "committed" | "released" | "expired" | "settled";
  submissionState: "not_started" | "dispatching" | "confirmed" | "ambiguous" | "reconciled_no_submit";
  slotId: string;
  bucketId: string;
  amountMicroUsd: string;
  attempt: number;
  idempotencyKey: string;
  inputDigest: Sha256Digest;
  admissionDigest: Sha256Digest;
  reservedAt: string;
  expiresAt: string;
}

export interface ReserveAndAdmitResult {
  reservation: DurableDailyAdmissionReservation;
  databaseNow: string;
  budgetDate: string;
  accountingTimeZone: string;
  replayed: boolean;
  /** PR19 is deliberately reservation-only: activation writes are forbidden here. */
  effects: {
    renderJobCreated: false;
    outboxCreated: false;
    eventCreated: false;
    providerCalled: false;
  };
}

export type DailyAdmissionPersistenceErrorCode =
  | "ADMISSION_DENIED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVARIANT_VIOLATION"
  | "INVALID_INPUT";

export class DailyAdmissionPersistenceError extends Error {
  constructor(readonly code: DailyAdmissionPersistenceErrorCode, message: string) {
    super(message);
    this.name = "DailyAdmissionPersistenceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const MAX_DB_MICRO_USD = 9_000_000_000_000_000n;
const EFFECTS = Object.freeze({
  renderJobCreated: false,
  outboxCreated: false,
  eventCreated: false,
  providerCalled: false,
} as const);

function resultRows(result: ExecuteResult): Record<string, unknown>[] {
  const rows = Array.isArray(result) ? result : result.rows;
  return Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
}

function value(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function canonicalIso(raw: unknown, field: string): string {
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) throw invariant(`Database returned an invalid ${field}`);
  return date.toISOString();
}

function canonicalDate(raw: unknown): string {
  const value = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invariant("Database returned an invalid budget date");
  return value;
}

function reservationFromRow(row: Record<string, unknown>): DurableDailyAdmissionReservation {
  const state = String(row.state) as DurableDailyAdmissionReservation["state"];
  const submissionState = String(value(row, "submissionState", "submission_state")) as DurableDailyAdmissionReservation["submissionState"];
  if (!["reserved", "committed", "released", "expired", "settled"].includes(state)
    || !["not_started", "dispatching", "confirmed", "ambiguous", "reconciled_no_submit"].includes(submissionState)) {
    throw invariant("Database returned an invalid reservation lifecycle");
  }
  const amountMicroUsd = canonicalMicroUsd(value(row, "amountMicroUsd", "amount_micro_usd"), "database amountMicroUsd");
  return {
    id: uuid(String(row.id), "reservation.id"),
    state,
    submissionState,
    slotId: uuid(String(value(row, "dailyPlanSlotId", "daily_plan_slot_id")), "reservation.slotId"),
    bucketId: uuid(String(value(row, "budgetBucketId", "budget_bucket_id")), "reservation.bucketId"),
    amountMicroUsd,
    attempt: positiveInteger(Number(row.attempt), "reservation.attempt"),
    idempotencyKey: safeString(String(value(row, "idempotencyKey", "idempotency_key")), "reservation.idempotencyKey", 200, 8),
    inputDigest: digest(String(value(row, "inputDigest", "input_digest")), "reservation.inputDigest"),
    admissionDigest: digest(String(value(row, "admissionDigest", "admission_digest")), "reservation.admissionDigest"),
    reservedAt: canonicalIso(value(row, "reservedAt", "reserved_at"), "reservedAt"),
    expiresAt: canonicalIso(value(row, "expiresAt", "expires_at"), "expiresAt"),
  };
}

function exactReplay(row: Record<string, unknown>, request: ValidatedRequest): DurableDailyAdmissionReservation {
  const reservation = reservationFromRow(row);
  const immutableMatches = reservation.inputDigest === request.inputDigest
    && reservation.admissionDigest === request.admissionDigest
    && String(value(row, "scriptVariantChecksum", "script_variant_checksum")) === request.scriptVariantChecksum
    && reservation.slotId === request.slotId
    && reservation.bucketId === request.budgetBucketId
    && reservation.amountMicroUsd === request.amountMicroUsd
    && reservation.attempt === request.attempt
    && String(value(row, "providerAccountId", "provider_account_id")) === request.providerAccountId
    && String(value(row, "providerKey", "provider_key")) === request.providerKey
    && Number(value(row, "providerCredentialVersion", "provider_credential_version")) === request.providerCredentialVersion
    && String(value(row, "quoteDigest", "quote_digest")) === request.quoteDigest
    && canonicalIso(value(row, "quoteExpiresAt", "quote_expires_at"), "quoteExpiresAt") === request.quoteExpiresAt
    && String(value(row, "contentApprovalDigest", "content_approval_digest")) === request.contentApprovalDigest
    && String(value(row, "humanLaunchApprovalDigest", "human_launch_approval_digest")) === request.humanLaunchApprovalDigest
    && String(value(row, "governanceProfileId", "governance_profile_id")) === request.governanceProfileId
    && String(value(row, "governanceEvidenceDigest", "governance_evidence_digest")) === request.governanceEvidenceDigest
    && String(value(row, "policyDigest", "policy_digest")) === request.policyDigest
    && String(value(row, "killSwitchEvidenceDigest", "kill_switch_evidence_digest")) === request.killSwitchEvidenceDigest
    && String(value(row, "sandboxEvidenceDigest", "sandbox_evidence_digest")) === request.sandboxEvidenceDigest
    && String(value(row, "providerIdempotencyKey", "provider_idempotency_key")) === request.providerIdempotencyKey
    && reservation.expiresAt === request.reservationExpiresAt;
  if (!immutableMatches) {
    throw new DailyAdmissionPersistenceError("IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different admission evidence");
  }
  return reservation;
}

type ValidatedRequest = Omit<ReserveAndAdmitRequest, "amountMicroUsd"> & { amountMicroUsd: string };

function validateRequest(input: ReserveAndAdmitRequest, trustedTimeZone: string): ValidatedRequest {
  const request: ValidatedRequest = {
    ...input,
    scope: {
      ownerUserId: safeString(input.scope.ownerUserId, "ownerUserId", 255),
      workspaceId: safeString(input.scope.workspaceId, "workspaceId", 255),
    },
    planId: uuid(input.planId, "planId"),
    slotId: uuid(input.slotId, "slotId"),
    budgetBucketId: uuid(input.budgetBucketId, "budgetBucketId"),
    providerAccountId: uuid(input.providerAccountId, "providerAccountId"),
    providerKey: safeString(input.providerKey, "providerKey", 100),
    providerCredentialVersion: positiveInteger(input.providerCredentialVersion, "providerCredentialVersion"),
    influencerId: uuid(input.influencerId, "influencerId"),
    governanceProfileId: uuid(input.governanceProfileId, "governanceProfileId"),
    governanceUse: governanceUse(input.governanceUse),
    governanceTerritory: governanceTerritory(input.governanceTerritory),
    planDigest: digest(input.planDigest, "planDigest"),
    slotDigest: digest(input.slotDigest, "slotDigest"),
    scriptVariantChecksum: checksum(input.scriptVariantChecksum, "scriptVariantChecksum"),
    expectedSlotStateVersion: positiveInteger(input.expectedSlotStateVersion, "expectedSlotStateVersion"),
    expectedBucketStateVersion: positiveInteger(input.expectedBucketStateVersion, "expectedBucketStateVersion"),
    budgetPolicyVersion: positiveInteger(input.budgetPolicyVersion, "budgetPolicyVersion"),
    attempt: positiveInteger(input.attempt, "attempt"),
    amountMicroUsd: canonicalMicroUsd(input.amountMicroUsd, "amountMicroUsd"),
    idempotencyKey: safeString(input.idempotencyKey, "idempotencyKey", 200, 8),
    inputDigest: digest(input.inputDigest, "inputDigest"),
    admissionDigest: digest(input.admissionDigest, "admissionDigest"),
    quoteDigest: digest(input.quoteDigest, "quoteDigest"),
    quoteExpiresAt: isoInput(input.quoteExpiresAt, "quoteExpiresAt"),
    reservationExpiresAt: isoInput(input.reservationExpiresAt, "reservationExpiresAt"),
    contentApprovalGranted: boolean(input.contentApprovalGranted, "contentApprovalGranted"),
    contentApprovalDigest: digest(input.contentApprovalDigest, "contentApprovalDigest"),
    contentApprovalExpiresAt: isoInput(input.contentApprovalExpiresAt, "contentApprovalExpiresAt"),
    humanLaunchApprovalGranted: boolean(input.humanLaunchApprovalGranted, "humanLaunchApprovalGranted"),
    humanLaunchApprovalDigest: digest(input.humanLaunchApprovalDigest, "humanLaunchApprovalDigest"),
    humanLaunchApprovalExpiresAt: isoInput(input.humanLaunchApprovalExpiresAt, "humanLaunchApprovalExpiresAt"),
    governanceEvidenceDigest: digest(input.governanceEvidenceDigest, "governanceEvidenceDigest"),
    policyAllowed: boolean(input.policyAllowed, "policyAllowed"),
    policyDigest: digest(input.policyDigest, "policyDigest"),
    killSwitchActive: boolean(input.killSwitchActive, "killSwitchActive"),
    killSwitchEvidenceDigest: digest(input.killSwitchEvidenceDigest, "killSwitchEvidenceDigest"),
    sandboxPassed: boolean(input.sandboxPassed, "sandboxPassed"),
    sandboxEvidenceDigest: digest(input.sandboxEvidenceDigest, "sandboxEvidenceDigest"),
    sandboxExpiresAt: isoInput(input.sandboxExpiresAt, "sandboxExpiresAt"),
    providerIdempotencyKey: safeString(input.providerIdempotencyKey, "providerIdempotencyKey", 200, 8),
  };
  if ([request.quoteExpiresAt, request.contentApprovalExpiresAt,
    request.humanLaunchApprovalExpiresAt, request.sandboxExpiresAt]
    .some((expiresAt) => request.reservationExpiresAt > expiresAt)) {
    throw invalid("reservationExpiresAt cannot exceed quote, approval, or sandbox evidence expiry");
  }
  const { inputDigest: _inputDigest, ...unsignedRequest } = request;
  const expectedInputDigest = dailyAdmissionPersistenceInputDigest(unsignedRequest, trustedTimeZone);
  if (request.inputDigest !== expectedInputDigest) throw invalid("inputDigest does not bind the exact reservation request");
  return request;
}

export function dailyAdmissionPersistenceInputDigest(
  input: UnsignedReserveAndAdmitRequest,
  trustedAccountingTimeZone: string,
): Sha256Digest {
  const timeZone = validTimeZone(trustedAccountingTimeZone);
  const canonical = canonicalJson({
    version: 1,
    trustedAccountingTimeZone: timeZone,
    ...input,
    amountMicroUsd: typeof input.amountMicroUsd === "bigint" ? input.amountMicroUsd.toString() : input.amountMicroUsd,
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

/**
 * Reservation-only PR19 boundary. This repository cannot create render jobs,
 * outbox commands, events, or provider requests. A later activation service
 * must add those writes to an independently reviewed atomic transaction.
 */
export class DrizzleDailyAdmissionRepository {
  private readonly accountingTimeZone: string;

  constructor(private readonly db: DailyAdmissionTransactionalDatabase, options: { accountingTimeZone: string }) {
    this.accountingTimeZone = validTimeZone(options.accountingTimeZone);
  }

  inputDigest(input: UnsignedReserveAndAdmitRequest): Sha256Digest {
    return dailyAdmissionPersistenceInputDigest(input, this.accountingTimeZone);
  }

  async reserveAndAdmit(input: ReserveAndAdmitRequest): Promise<ReserveAndAdmitResult> {
    const request = validateRequest(input, this.accountingTimeZone);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          'ai-media:daily-admission:idempotency:' || ${request.scope.ownerUserId} || ':'
          || ${request.scope.workspaceId} || ':' || ${request.idempotencyKey}, 0
        )) AS idempotency_locked
      `);

      const replayRow = resultRows(await tx.execute(sql`
        SELECT reservations.*, buckets.budget_date::text AS replay_budget_date,
          buckets.accounting_time_zone AS replay_accounting_time_zone,
          clock_timestamp() AS database_now
        FROM ${aiMediaBudgetReservations} reservations
        INNER JOIN ${aiMediaBudgetBuckets} buckets
          ON buckets.owner_user_id=reservations.owner_user_id
          AND buckets.workspace_id=reservations.workspace_id
          AND buckets.id=reservations.budget_bucket_id AND buckets.currency=reservations.currency
        WHERE reservations.owner_user_id=${request.scope.ownerUserId}
          AND reservations.workspace_id=${request.scope.workspaceId}
          AND reservations.idempotency_key=${request.idempotencyKey}
        FOR UPDATE OF reservations, buckets
      `))[0];
      if (replayRow) {
        const replayTimeZone = String(value(replayRow, "replayAccountingTimeZone", "replay_accounting_time_zone"));
        if (replayTimeZone !== this.accountingTimeZone) {
          throw new DailyAdmissionPersistenceError("IDEMPOTENCY_CONFLICT", "Existing reservation belongs to another accounting time zone");
        }
        return {
          reservation: exactReplay(replayRow, request),
          databaseNow: canonicalIso(value(replayRow, "databaseNow", "database_now"), "databaseNow"),
          budgetDate: canonicalDate(value(replayRow, "replayBudgetDate", "replay_budget_date")),
          accountingTimeZone: this.accountingTimeZone, replayed: true, effects: EFFECTS,
        };
      }

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          'ai-media:daily-admission:workspace:' || ${request.scope.ownerUserId} || ':'
          || ${request.scope.workspaceId}, 0
        )) AS workspace_locked
      `);

      // Governance profile writers must use this same subject lock. It closes
      // the append/revocation race that a row lock on one immutable revision
      // alone cannot prevent.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          'ai-media-governance:profile:' || ${request.scope.ownerUserId} || ':'
          || ${request.scope.workspaceId} || ':' || ${request.influencerId}, 0
        )) AS governance_subject_locked
      `);

      // This wall clock is sampled only after potentially blocking advisory
      // locks, so midnight and evidence expiry cannot be decided using a stale
      // transaction-start instant.
      const clockRow = resultRows(await tx.execute(sql`
        SELECT observed_at AS database_now,
          (observed_at AT TIME ZONE ${this.accountingTimeZone})::date::text AS budget_date
        FROM (SELECT clock_timestamp() AS observed_at) fresh_clock
      `))[0];
      if (!clockRow) throw invariant("Database clock did not return an authoritative budget day");
      const budgetDate = canonicalDate(value(clockRow, "budgetDate", "budget_date"));

      const gateRows = resultRows(await tx.execute(sql`
        SELECT plans.id AS plan_id, slots.id AS slot_id, buckets.id AS bucket_id
        FROM ${aiMediaDailyPlans} plans
        INNER JOIN ${aiMediaDailyPlanSlots} slots
          ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
          AND slots.daily_plan_id=plans.id AND slots.provider_account_id=plans.provider_account_id
          AND slots.provider_key=plans.provider_key
          AND slots.provider_credential_version=plans.provider_credential_version
        INNER JOIN ${aiMediaBudgetBuckets} buckets
          ON buckets.owner_user_id=plans.owner_user_id AND buckets.workspace_id=plans.workspace_id
        INNER JOIN ${aiMediaProviderAccounts} accounts
          ON accounts.owner_user_id=plans.owner_user_id AND accounts.workspace_id=plans.workspace_id
          AND accounts.id=plans.provider_account_id AND accounts.provider_key=plans.provider_key
        INNER JOIN ${aiMediaGovernanceProfiles} governance
          ON governance.owner_user_id=slots.owner_user_id AND governance.workspace_id=slots.workspace_id
          AND governance.id=${request.governanceProfileId} AND governance.influencer_id=slots.influencer_id
          AND governance.avatar_resource_id=slots.avatar_resource_id
          AND governance.voice_resource_id=slots.voice_resource_id
        INNER JOIN ${aiMediaInfluencers} influencers
          ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
          AND influencers.id=slots.influencer_id
        INNER JOIN ${aiMediaProviderResources} avatars
          ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
          AND avatars.provider_account_id=slots.provider_account_id AND avatars.provider_key=slots.provider_key
          AND avatars.id=slots.avatar_resource_id AND avatars.resource_type='avatar'
        INNER JOIN ${aiMediaProviderResources} voices
          ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
          AND voices.provider_account_id=slots.provider_account_id AND voices.provider_key=slots.provider_key
          AND voices.id=slots.voice_resource_id AND voices.resource_type='voice'
        INNER JOIN ${aiMediaScriptVariants} variants
          ON variants.owner_user_id=slots.owner_user_id AND variants.workspace_id=slots.workspace_id
          AND variants.id=slots.script_variant_id
        WHERE plans.owner_user_id=${request.scope.ownerUserId}
          AND plans.workspace_id=${request.scope.workspaceId} AND plans.id=${request.planId}
          AND plans.status='planned' AND plans.plan_digest=${request.planDigest}
          AND plans.provider_account_id=${request.providerAccountId}
          AND plans.provider_key=${request.providerKey}
          AND plans.provider_credential_version=${request.providerCredentialVersion}
          AND plans.plan_date=${budgetDate}::date
          AND plans.accounting_time_zone=${this.accountingTimeZone}
          AND slots.id=${request.slotId} AND slots.status='planned'
          AND slots.influencer_id=${request.influencerId}
          AND slots.slot_digest=${request.slotDigest}
          AND slots.state_version=${request.expectedSlotStateVersion}
          AND ${request.attempt}=COALESCE((
            SELECT MAX(previous.attempt)+1 FROM ${aiMediaBudgetReservations} previous
            WHERE previous.owner_user_id=slots.owner_user_id
              AND previous.workspace_id=slots.workspace_id
              AND previous.daily_plan_slot_id=slots.id
          ),1)
          AND buckets.id=${request.budgetBucketId} AND buckets.budget_date=${budgetDate}::date
          AND buckets.accounting_time_zone=${this.accountingTimeZone} AND buckets.currency='USD'
          AND buckets.policy_digest=${request.policyDigest}
          AND buckets.policy_version=${request.budgetPolicyVersion}
          AND buckets.state_version=${request.expectedBucketStateVersion}
          AND buckets.reserved_micro_usd+buckets.committed_micro_usd+${request.amountMicroUsd}::numeric
            <= buckets.limit_micro_usd
          AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
          AND accounts.credential_version=${request.providerCredentialVersion}
          AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>clock_timestamp())
          AND influencers.status='active' AND influencers.archived_at IS NULL
          AND avatars.status='active' AND voices.status='active'
          AND variants.status='approved' AND variants.checksum=${request.scriptVariantChecksum}
          AND governance.state='active' AND governance.revoked_at IS NULL
          AND governance.valid_from<=clock_timestamp() AND governance.expires_at>clock_timestamp()
          AND governance.evidence_digest=${request.governanceEvidenceDigest}
          AND governance.allowed_uses @> ${JSON.stringify([request.governanceUse])}::jsonb
          AND (governance.territories @> ${JSON.stringify([request.governanceTerritory])}::jsonb
            OR governance.territories @> '["WORLDWIDE"]'::jsonb)
          AND NOT EXISTS (
            SELECT 1 FROM ${aiMediaGovernanceProfiles} newer_governance
            WHERE newer_governance.owner_user_id=governance.owner_user_id
              AND newer_governance.workspace_id=governance.workspace_id
              AND newer_governance.influencer_id=governance.influencer_id
              AND newer_governance.version>governance.version
          )
          AND ${request.quoteExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=${request.quoteExpiresAt}::timestamptz
          AND ${request.contentApprovalGranted}=true
          AND ${request.contentApprovalExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=${request.contentApprovalExpiresAt}::timestamptz
          AND ${request.humanLaunchApprovalGranted}=true
          AND ${request.humanLaunchApprovalExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=${request.humanLaunchApprovalExpiresAt}::timestamptz
          AND ${request.policyAllowed}=true AND ${request.killSwitchActive}=false
          AND ${request.sandboxPassed}=true
          AND ${request.sandboxExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=${request.sandboxExpiresAt}::timestamptz
        FOR UPDATE OF plans, slots, buckets, accounts, governance, influencers, avatars, voices, variants
      `));
      if (gateRows.length !== 1) {
        throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Daily admission gates did not resolve to one exact locked subject");
      }

      const createdRows = resultRows(await tx.execute(sql`
        WITH fresh_clock AS MATERIALIZED (
          SELECT observed_at,
            (observed_at AT TIME ZONE ${this.accountingTimeZone})::date AS budget_date
          FROM (SELECT clock_timestamp() AS observed_at) sampled_clock
        ), final_guard AS (
          SELECT buckets.id AS bucket_id, fresh_clock.observed_at
          FROM ${aiMediaDailyPlans} plans
          INNER JOIN ${aiMediaDailyPlanSlots} slots
            ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
            AND slots.daily_plan_id=plans.id
          INNER JOIN ${aiMediaBudgetBuckets} buckets
            ON buckets.owner_user_id=plans.owner_user_id AND buckets.workspace_id=plans.workspace_id
          INNER JOIN ${aiMediaProviderAccounts} accounts
            ON accounts.owner_user_id=plans.owner_user_id AND accounts.workspace_id=plans.workspace_id
            AND accounts.id=plans.provider_account_id AND accounts.provider_key=plans.provider_key
          INNER JOIN ${aiMediaGovernanceProfiles} governance
            ON governance.owner_user_id=slots.owner_user_id AND governance.workspace_id=slots.workspace_id
            AND governance.id=${request.governanceProfileId}
            AND governance.influencer_id=slots.influencer_id
          INNER JOIN ${aiMediaScriptVariants} variants
            ON variants.owner_user_id=slots.owner_user_id AND variants.workspace_id=slots.workspace_id
            AND variants.id=slots.script_variant_id
          CROSS JOIN fresh_clock
          WHERE plans.id=${request.planId} AND plans.owner_user_id=${request.scope.ownerUserId}
            AND plans.workspace_id=${request.scope.workspaceId} AND plans.status='planned'
            AND plans.plan_digest=${request.planDigest}
            AND plans.provider_account_id=${request.providerAccountId}
            AND plans.provider_key=${request.providerKey}
            AND plans.provider_credential_version=${request.providerCredentialVersion}
            AND plans.plan_date=fresh_clock.budget_date
            AND plans.accounting_time_zone=${this.accountingTimeZone}
            AND slots.id=${request.slotId} AND slots.status='planned'
            AND slots.influencer_id=${request.influencerId}
            AND slots.slot_digest=${request.slotDigest}
            AND slots.state_version=${request.expectedSlotStateVersion}
            AND buckets.id=${request.budgetBucketId} AND buckets.budget_date=fresh_clock.budget_date
            AND buckets.accounting_time_zone=${this.accountingTimeZone} AND buckets.currency='USD'
            AND buckets.policy_digest=${request.policyDigest}
            AND buckets.policy_version=${request.budgetPolicyVersion}
            AND buckets.state_version=${request.expectedBucketStateVersion}
            AND buckets.reserved_micro_usd+buckets.committed_micro_usd+${request.amountMicroUsd}::numeric
              <= buckets.limit_micro_usd
            AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
            AND accounts.credential_version=${request.providerCredentialVersion}
            AND (accounts.credential_expires_at IS NULL
              OR accounts.credential_expires_at>fresh_clock.observed_at)
            AND governance.state='active' AND governance.revoked_at IS NULL
            AND governance.valid_from<=fresh_clock.observed_at
            AND governance.expires_at>fresh_clock.observed_at
            AND governance.evidence_digest=${request.governanceEvidenceDigest}
            AND governance.allowed_uses @> ${JSON.stringify([request.governanceUse])}::jsonb
            AND (governance.territories @> ${JSON.stringify([request.governanceTerritory])}::jsonb
              OR governance.territories @> '["WORLDWIDE"]'::jsonb)
            AND variants.status='approved' AND variants.checksum=${request.scriptVariantChecksum}
            AND ${request.quoteExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.reservationExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.contentApprovalExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.humanLaunchApprovalExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.sandboxExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.reservationExpiresAt}::timestamptz<=${request.quoteExpiresAt}::timestamptz
            AND ${request.reservationExpiresAt}::timestamptz<=${request.contentApprovalExpiresAt}::timestamptz
            AND ${request.reservationExpiresAt}::timestamptz<=${request.humanLaunchApprovalExpiresAt}::timestamptz
            AND ${request.reservationExpiresAt}::timestamptz<=${request.sandboxExpiresAt}::timestamptz
            AND ${request.contentApprovalGranted}=true
            AND ${request.humanLaunchApprovalGranted}=true
            AND ${request.policyAllowed}=true AND ${request.killSwitchActive}=false
            AND ${request.sandboxPassed}=true
          FOR UPDATE OF plans, slots, buckets, accounts, governance, variants
        ), bucket_update AS (
          UPDATE ${aiMediaBudgetBuckets} buckets
          SET reserved_micro_usd=buckets.reserved_micro_usd+${request.amountMicroUsd}::numeric,
            state_version=buckets.state_version+1, updated_at=final_guard.observed_at
          FROM final_guard
          WHERE buckets.id=final_guard.bucket_id
            AND buckets.owner_user_id=${request.scope.ownerUserId}
            AND buckets.workspace_id=${request.scope.workspaceId} AND buckets.currency='USD'
            AND buckets.state_version=${request.expectedBucketStateVersion}
            AND buckets.reserved_micro_usd+buckets.committed_micro_usd+${request.amountMicroUsd}::numeric
              <=buckets.limit_micro_usd
          RETURNING buckets.id, final_guard.observed_at
        ), reservation_insert AS (
          INSERT INTO ${aiMediaBudgetReservations} (
            owner_user_id,workspace_id,budget_bucket_id,daily_plan_slot_id,provider_account_id,
            provider_key,provider_credential_version,attempt,state,submission_state,amount_micro_usd,
            currency,idempotency_key,input_digest,admission_digest,script_variant_checksum,quote_digest,quote_expires_at,
            content_approval_digest,human_launch_approval_digest,governance_profile_id,
            governance_evidence_digest,policy_digest,kill_switch_evidence_digest,sandbox_evidence_digest,
            provider_idempotency_key,render_job_id,dispatch_outbox_id,reserved_at,expires_at,created_at,updated_at
          )
          SELECT ${request.scope.ownerUserId},${request.scope.workspaceId},${request.budgetBucketId},
            ${request.slotId},${request.providerAccountId},${request.providerKey},
            ${request.providerCredentialVersion},${request.attempt},'reserved','not_started',
            ${request.amountMicroUsd}::numeric,'USD',${request.idempotencyKey},${request.inputDigest},
            ${request.admissionDigest},${request.scriptVariantChecksum},${request.quoteDigest},
            ${request.quoteExpiresAt}::timestamptz,
            ${request.contentApprovalDigest},${request.humanLaunchApprovalDigest},${request.governanceProfileId},
            ${request.governanceEvidenceDigest},${request.policyDigest},${request.killSwitchEvidenceDigest},
            ${request.sandboxEvidenceDigest},${request.providerIdempotencyKey},NULL,NULL,
            bucket_update.observed_at,${request.reservationExpiresAt}::timestamptz,
            bucket_update.observed_at,bucket_update.observed_at
          FROM bucket_update
          RETURNING *
        ), slot_update AS (
          UPDATE ${aiMediaDailyPlanSlots} slots
          SET status='reserved',state_version=state_version+1,updated_at=reservation.reserved_at
          FROM reservation_insert reservation
          WHERE slots.id=${request.slotId} AND slots.owner_user_id=${request.scope.ownerUserId}
            AND slots.workspace_id=${request.scope.workspaceId} AND slots.daily_plan_id=${request.planId}
            AND slots.status='planned' AND slots.state_version=${request.expectedSlotStateVersion}
            AND reservation.daily_plan_slot_id=slots.id
          RETURNING slots.id
        )
        SELECT reservation_insert.*, reservation_insert.reserved_at AS database_now
        FROM reservation_insert INNER JOIN slot_update ON slot_update.id=reservation_insert.daily_plan_slot_id
      `));
      if (createdRows.length !== 1) throw invariant("Atomic reservation or slot CAS did not create exactly one row");
      return {
        reservation: reservationFromRow(createdRows[0]),
        databaseNow: canonicalIso(value(createdRows[0], "databaseNow", "database_now"), "databaseNow"),
        budgetDate,
        accountingTimeZone: this.accountingTimeZone,
        replayed: false,
        effects: EFFECTS,
      };
    });
  }
}

function canonicalMicroUsd(value: unknown, field: string): string {
  const raw = typeof value === "bigint" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^[1-9]\d*$/u.test(raw)) throw invalid(`${field} must be a positive integer micro-USD string or bigint`);
  const amount = BigInt(raw);
  if (amount > MAX_DB_MICRO_USD) throw invalid(`${field} exceeds the durable database limit`);
  return raw;
}

function uuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw invalid(`${field} must be a lowercase RFC 4122 UUID`);
  return value;
}

function digest(value: string, field: string): Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) throw invalid(`${field} must be a lowercase SHA-256 digest`);
  return value as Sha256Digest;
}

function checksum(value: string, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw invalid(`${field} must be a lowercase SHA-256 checksum`);
  }
  return value;
}

function safeString(value: string, field: string, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max || !SAFE.test(value)) {
    throw invalid(`${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(`${field} must be a positive safe integer`);
  return value;
}

function boolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${field} must be boolean`);
  return value;
}

function governanceUse(value: string): DailyAdmissionGovernanceUse {
  if (!["internal_preview", "organic_social", "paid_ads", "commercial"].includes(value)) throw invalid("governanceUse is invalid");
  return value as DailyAdmissionGovernanceUse;
}

function governanceTerritory(value: string): string {
  if (typeof value !== "string" || !/^(?:WORLDWIDE|[A-Z]{2})$/u.test(value)) {
    throw invalid("governanceTerritory must be WORLDWIDE or an uppercase ISO country code");
  }
  return value;
}

function isoInput(value: string, field: string): string {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw invalid(`${field} must be a canonical UTC ISO-8601 instant with milliseconds`);
  }
  return value;
}

function validTimeZone(value: string): string {
  try {
    if (typeof value !== "string" || value.length > 80
      || new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone !== value) throw new Error("invalid");
  } catch {
    throw invalid("accountingTimeZone must be a trusted canonical IANA time zone");
  }
  return value;
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

function invalid(message: string): DailyAdmissionPersistenceError {
  return new DailyAdmissionPersistenceError("INVALID_INPUT", message);
}

function invariant(message: string): DailyAdmissionPersistenceError {
  return new DailyAdmissionPersistenceError("INVARIANT_VIOLATION", message);
}
