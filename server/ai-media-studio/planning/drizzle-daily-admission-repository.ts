import { createHash, randomUUID } from "node:crypto";
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
  aiMediaRenderJobs,
  aiMediaOutbox,
  aiMediaScripts,
  aiMediaScriptVariants,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "./contracts";
import { lockAuthorityWorkspace, lockGovernanceProfile } from "./authority-locks";

const AUTHORITY_SNAPSHOTS = sql.raw('"ai_media_launch_authority_snapshots"');
const LAUNCH_EVIDENCE = sql.raw('"ai_media_launch_evidence"');
const LAUNCH_INTENTS = sql.raw('"ai_media_launch_intents"');
const POLICY_REVISIONS = sql.raw('"ai_media_admission_policy_revisions"');
const KILL_SWITCH_REVISIONS = sql.raw('"ai_media_kill_switch_revisions"');

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type DailyAdmissionDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type DailyAdmissionTransactionalDatabase = DailyAdmissionDatabase & {
  transaction<T>(callback: (tx: DailyAdmissionDatabase) => Promise<T>): Promise<T>;
};

export interface ReserveAndAdmitRequest {
  scope: TenantScope;
  planId: string;
  slotId: string;
  budgetBucketId: string;
  authoritySnapshotId: string;
  authorityDigest: Sha256Digest;
  expectedSlotStateVersion: number;
  expectedBucketStateVersion: number;
  reservationExpiresAt: string;
  idempotencyKey: string;
  inputDigest: Sha256Digest;
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
  renderJobId: string;
  dispatchOutboxId: string;
  workHandoffDigest: Sha256Digest;
  reservedAt: string;
  expiresAt: string;
}

export interface ReserveAndAdmitResult {
  reservation: DurableDailyAdmissionReservation;
  databaseNow: string;
  budgetDate: string;
  accountingTimeZone: string;
  replayed: boolean;
  effects: {
    renderJobCreated: boolean;
    outboxCreated: boolean;
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
const REPLAY_EFFECTS = Object.freeze({
  renderJobCreated: false,
  outboxCreated: false,
  eventCreated: false,
  providerCalled: false,
} as const);
const CREATED_EFFECTS = Object.freeze({
  renderJobCreated: true,
  outboxCreated: true,
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
  const result = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) throw invariant("Database returned an invalid budget date");
  return result;
}

function reservationFromRow(row: Record<string, unknown>): DurableDailyAdmissionReservation {
  const state = String(row.state) as DurableDailyAdmissionReservation["state"];
  const submissionState = String(value(row, "submissionState", "submission_state")) as DurableDailyAdmissionReservation["submissionState"];
  if (![
    "reserved", "committed", "released", "expired", "settled",
  ].includes(state) || ![
    "not_started", "dispatching", "confirmed", "ambiguous", "reconciled_no_submit",
  ].includes(submissionState)) throw invariant("Database returned an invalid reservation lifecycle");
  return {
    id: uuid(String(row.id), "reservation.id"),
    state,
    submissionState,
    slotId: uuid(String(value(row, "dailyPlanSlotId", "daily_plan_slot_id")), "reservation.slotId"),
    bucketId: uuid(String(value(row, "budgetBucketId", "budget_bucket_id")), "reservation.bucketId"),
    amountMicroUsd: databaseMicroUsd(value(row, "amountMicroUsd", "amount_micro_usd")),
    attempt: positiveInteger(Number(row.attempt), "reservation.attempt"),
    idempotencyKey: safeString(String(value(row, "idempotencyKey", "idempotency_key")), "reservation.idempotencyKey", 200, 8),
    inputDigest: digest(String(value(row, "inputDigest", "input_digest")), "reservation.inputDigest"),
    admissionDigest: digest(String(value(row, "admissionDigest", "admission_digest")), "reservation.admissionDigest"),
    renderJobId: uuid(String(value(row, "renderJobId", "render_job_id")), "reservation.renderJobId"),
    dispatchOutboxId: uuid(String(value(row, "dispatchOutboxId", "dispatch_outbox_id")), "reservation.dispatchOutboxId"),
    workHandoffDigest: digest(String(value(row, "workHandoffDigest", "work_handoff_digest")), "reservation.workHandoffDigest"),
    reservedAt: canonicalIso(value(row, "reservedAt", "reserved_at"), "reservedAt"),
    expiresAt: canonicalIso(value(row, "expiresAt", "expires_at"), "expiresAt"),
  };
}

function exactReplay(row: Record<string, unknown>, request: ReserveAndAdmitRequest): DurableDailyAdmissionReservation {
  const reservation = reservationFromRow(row);
  const matches = reservation.inputDigest === request.inputDigest
    && reservation.slotId === request.slotId
    && reservation.bucketId === request.budgetBucketId
    && reservation.expiresAt === request.reservationExpiresAt
    && String(value(row, "authoritySnapshotId", "authority_snapshot_id")) === request.authoritySnapshotId
    && String(value(row, "authorityDigest", "authority_digest")) === request.authorityDigest;
  const exactHeldWork = String(value(row, "replayRenderStage", "replay_render_stage")) === "admission_held"
    && String(value(row, "replayOutboxStatus", "replay_outbox_status")) === "held"
    && String(value(row, "replayRenderHandoffDigest", "replay_render_handoff_digest")) === reservation.workHandoffDigest
    && String(value(row, "replayOutboxHandoffDigest", "replay_outbox_handoff_digest")) === reservation.workHandoffDigest
    && String(value(row, "replayRenderJobId", "replay_render_job_id")) === reservation.renderJobId
    && String(value(row, "replayOutboxId", "replay_outbox_id")) === reservation.dispatchOutboxId
    && value(row, "replayProviderJobId", "replay_provider_job_id") == null
    && value(row, "replayRenderLeaseOwner", "replay_render_lease_owner") == null
    && value(row, "replayOutboxLeaseOwner", "replay_outbox_lease_owner") == null;
  if (!matches) {
    throw new DailyAdmissionPersistenceError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key is already bound to another authority snapshot or reservation request",
    );
  }
  if (!exactHeldWork) throw invariant("Existing admission has no exact immutable held-work handoff");
  return reservation;
}

function validateRequest(input: ReserveAndAdmitRequest, trustedTimeZone: string): ReserveAndAdmitRequest {
  const request: ReserveAndAdmitRequest = {
    scope: {
      ownerUserId: safeString(input.scope.ownerUserId, "ownerUserId", 255),
      workspaceId: safeString(input.scope.workspaceId, "workspaceId", 255),
    },
    planId: uuid(input.planId, "planId"),
    slotId: uuid(input.slotId, "slotId"),
    budgetBucketId: uuid(input.budgetBucketId, "budgetBucketId"),
    authoritySnapshotId: uuid(input.authoritySnapshotId, "authoritySnapshotId"),
    authorityDigest: digest(input.authorityDigest, "authorityDigest"),
    expectedSlotStateVersion: positiveInteger(input.expectedSlotStateVersion, "expectedSlotStateVersion"),
    expectedBucketStateVersion: positiveInteger(input.expectedBucketStateVersion, "expectedBucketStateVersion"),
    reservationExpiresAt: isoInput(input.reservationExpiresAt, "reservationExpiresAt"),
    idempotencyKey: safeString(input.idempotencyKey, "idempotencyKey", 200, 8),
    inputDigest: digest(input.inputDigest, "inputDigest"),
  };
  const { inputDigest: _inputDigest, ...unsigned } = request;
  if (request.inputDigest !== dailyAdmissionPersistenceInputDigest(unsigned, trustedTimeZone)) {
    throw invalid("inputDigest does not bind the exact reservation request");
  }
  return request;
}

export function dailyAdmissionPersistenceInputDigest(
  input: UnsignedReserveAndAdmitRequest,
  trustedAccountingTimeZone: string,
): Sha256Digest {
  const canonical = canonicalJson({
    version: 2,
    trustedAccountingTimeZone: validTimeZone(trustedAccountingTimeZone),
    ...input,
  });
  return sha256(JSON.stringify(canonical));
}

function stableProviderIdempotencyKey(request: ReserveAndAdmitRequest): string {
  return `admit:${sha256(JSON.stringify(canonicalJson({
    version: 1,
    ownerUserId: request.scope.ownerUserId,
    workspaceId: request.scope.workspaceId,
    authoritySnapshotId: request.authoritySnapshotId,
    slotId: request.slotId,
    idempotencyKey: request.idempotencyKey,
  }))).slice("sha256:".length)}`;
}

interface HeldWorkSeal {
  requestJson: Record<string, unknown>;
  scriptContent: string;
  scriptVariantChecksum: string;
  sealedRequestDigest: Sha256Digest;
  workHandoffDigest: Sha256Digest;
}

function heldWorkSeal(input: {
  row: Record<string, unknown>;
  request: ReserveAndAdmitRequest;
  providerIdempotencyKey: string;
  reservationId: string;
  renderJobId: string;
  dispatchOutboxId: string;
}): HeldWorkSeal {
  const dbUuid = (camel: string, snake: string): string => {
    const result = String(value(input.row, camel, snake));
    if (!UUID.test(result)) throw invariant(`Locked admission returned invalid ${snake}`);
    return result;
  };
  const dbDigest = (camel: string, snake: string): Sha256Digest => {
    const result = String(value(input.row, camel, snake));
    if (!SHA256.test(result)) throw invariant(`Locked admission returned invalid ${snake}`);
    return result as Sha256Digest;
  };
  const textValue = (camel: string, snake: string, min: number, max: number): string => {
    const result = String(value(input.row, camel, snake));
    if (result.trim().length < min || result.length > max) throw invariant(`Locked admission returned invalid ${snake}`);
    return result;
  };
  const influencerId = dbUuid("influencerId", "influencer_id");
  const voiceResourceId = dbUuid("voiceResourceId", "voice_resource_id");
  const governanceProfileId = dbUuid("governanceProfileId", "governance_profile_id");
  const governanceEvidenceDigest = dbDigest("governanceEvidenceDigest", "governance_evidence_digest");
  const scriptContent = textValue("scriptContent", "script_content", 1, 20_000);
  const language = textValue("scriptLanguage", "script_language", 1, 40);
  const scriptVariantChecksum = String(value(input.row, "scriptVariantChecksum", "script_variant_checksum"));
  const computedChecksum = createHash("sha256").update(scriptContent).digest("hex");
  if (!/^[0-9a-f]{64}$/u.test(scriptVariantChecksum) || computedChecksum !== scriptVariantChecksum) {
    throw invariant("Locked approved script content does not match its checksum");
  }
  const requestJson = canonicalJson({
    influencerId,
    script: scriptContent,
    voiceId: voiceResourceId,
    language,
    aspectRatio: "9:16",
    idempotencyKey: input.providerIdempotencyKey,
    governance: { profileId: governanceProfileId, evidenceDigest: governanceEvidenceDigest },
  }) as Record<string, unknown>;
  const sealedRequestDigest = sha256(JSON.stringify(canonicalJson({
    version: 1,
    request: requestJson,
    reservationId: input.reservationId,
    renderJobId: input.renderJobId,
    outboxId: input.dispatchOutboxId,
    slotId: input.request.slotId,
    slotAttempt: positiveInteger(Number(value(input.row, "slotAttempt", "slot_attempt")), "slotAttempt"),
    authoritySnapshotId: input.request.authoritySnapshotId,
    authorityDigest: input.request.authorityDigest,
    launchIntentId: dbUuid("launchIntentId", "launch_intent_id"),
    launchIntentDigest: dbDigest("launchIntentDigest", "launch_intent_digest"),
    admissionDigest: dbDigest("admissionDigest", "admission_digest"),
    providerAccountId: dbUuid("providerAccountId", "provider_account_id"),
    providerKey: textValue("providerKey", "provider_key", 1, 80),
    providerCredentialVersion: positiveInteger(Number(value(input.row, "providerCredentialVersion", "provider_credential_version")), "providerCredentialVersion"),
    scriptVariantId: dbUuid("scriptVariantId", "script_variant_id"),
    scriptVariantChecksum,
    sourceItemId: value(input.row, "sourceItemId", "source_item_id") == null
      ? null : dbUuid("sourceItemId", "source_item_id"),
    sourceContentHash: value(input.row, "sourceContentHash", "source_content_hash") == null
      ? null : dbDigest("sourceContentHash", "source_content_hash"),
    avatarResourceId: dbUuid("avatarResourceId", "avatar_resource_id"),
    voiceResourceId,
  })));
  const workHandoffDigest = sha256(JSON.stringify(canonicalJson({
    version: 1,
    reservationId: input.reservationId,
    renderJobId: input.renderJobId,
    outboxId: input.dispatchOutboxId,
    sealedRequestDigest,
    authorityDigest: input.request.authorityDigest,
    launchIntentDigest: dbDigest("launchIntentDigest", "launch_intent_digest"),
    admissionDigest: dbDigest("admissionDigest", "admission_digest"),
  })));
  return { requestJson, scriptContent, scriptVariantChecksum, sealedRequestDigest, workHandoffDigest };
}

/**
 * Inert PR23 admission boundary. Every authority fact is derived from locked,
 * immutable database revisions. A successful transaction creates an exact
 * reservation plus immutable held job/outbox evidence, but cannot activate
 * either queue, commit spend, call a provider, emit an event, or cause any
 * external side effect.
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
    const providerIdempotencyKey = stableProviderIdempotencyKey(request);
    const reservationId = randomUUID();
    const renderJobId = randomUUID();
    const dispatchOutboxId = randomUUID();
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
          jobs.id AS replay_render_job_id, jobs.stage AS replay_render_stage,
          jobs.work_handoff_digest AS replay_render_handoff_digest,
          jobs.provider_job_id AS replay_provider_job_id, jobs.lease_owner AS replay_render_lease_owner,
          outbox.id AS replay_outbox_id, outbox.status AS replay_outbox_status,
          outbox.work_handoff_digest AS replay_outbox_handoff_digest,
          outbox.lease_owner AS replay_outbox_lease_owner,
          clock_timestamp() AS database_now
        FROM ${aiMediaBudgetReservations} reservations
        INNER JOIN ${aiMediaBudgetBuckets} buckets
          ON buckets.owner_user_id=reservations.owner_user_id
          AND buckets.workspace_id=reservations.workspace_id
          AND buckets.id=reservations.budget_bucket_id AND buckets.currency=reservations.currency
        INNER JOIN ${aiMediaRenderJobs} jobs
          ON jobs.owner_user_id=reservations.owner_user_id
          AND jobs.workspace_id=reservations.workspace_id
          AND jobs.id=reservations.render_job_id
          AND jobs.budget_reservation_id=reservations.id
        INNER JOIN ${aiMediaOutbox} outbox
          ON outbox.owner_user_id=reservations.owner_user_id
          AND outbox.workspace_id=reservations.workspace_id
          AND outbox.id=reservations.dispatch_outbox_id
          AND outbox.budget_reservation_id=reservations.id
          AND outbox.render_job_id=jobs.id
        WHERE reservations.owner_user_id=${request.scope.ownerUserId}
          AND reservations.workspace_id=${request.scope.workspaceId}
          AND reservations.idempotency_key=${request.idempotencyKey}
        FOR UPDATE OF reservations, buckets
      `))[0];
      if (replayRow) {
        if (String(value(replayRow, "replayAccountingTimeZone", "replay_accounting_time_zone")) !== this.accountingTimeZone) {
          throw new DailyAdmissionPersistenceError("IDEMPOTENCY_CONFLICT", "Existing reservation belongs to another accounting time zone");
        }
        return {
          reservation: exactReplay(replayRow, request),
          databaseNow: canonicalIso(value(replayRow, "databaseNow", "database_now"), "databaseNow"),
          budgetDate: canonicalDate(value(replayRow, "replayBudgetDate", "replay_budget_date")),
          accountingTimeZone: this.accountingTimeZone,
          replayed: true,
          effects: REPLAY_EFFECTS,
        };
      }

      // One global admission lock makes the three count-based concurrency
      // fences race-safe until they are replaced by dedicated lease counters.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(
          'ai-media:daily-admission:global-concurrency', 0
        )) AS global_concurrency_locked
      `);

      await lockAuthorityWorkspace(tx, request.scope);

      // The governance repository serializes append-only revisions with this
      // subject lock. Locking only the referenced row would not block a newer
      // INSERT and could otherwise admit a superseded profile.
      const governanceSubjectRows = resultRows(await tx.execute(sql`
        SELECT slots.influencer_id
        FROM ${AUTHORITY_SNAPSHOTS} snapshots
        INNER JOIN ${aiMediaDailyPlanSlots} slots
          ON slots.owner_user_id=snapshots.owner_user_id
          AND slots.workspace_id=snapshots.workspace_id
          AND slots.id=snapshots.daily_plan_slot_id
          AND slots.daily_plan_id=snapshots.daily_plan_id
        WHERE snapshots.owner_user_id=${request.scope.ownerUserId}
          AND snapshots.workspace_id=${request.scope.workspaceId}
          AND snapshots.id=${request.authoritySnapshotId}
          AND snapshots.authority_digest=${request.authorityDigest}
          AND snapshots.daily_plan_id=${request.planId}
          AND snapshots.daily_plan_slot_id=${request.slotId}
        LIMIT 2
      `));
      if (governanceSubjectRows.length !== 1) {
        throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Exact durable launch authority did not admit this slot");
      }
      const influencerId = String(value(governanceSubjectRows[0], "influencerId", "influencer_id"));
      if (!UUID.test(influencerId)) throw invariant("Authority snapshot returned an invalid governance subject");
      await lockGovernanceProfile(tx, request.scope, influencerId);

      const clockRow = resultRows(await tx.execute(sql`
        SELECT observed_at AS database_now,
          (observed_at AT TIME ZONE ${this.accountingTimeZone})::date::text AS budget_date
        FROM (SELECT clock_timestamp() AS observed_at) fresh_clock
      `))[0];
      if (!clockRow) throw invariant("Database clock did not return an authoritative budget day");
      const budgetDate = canonicalDate(value(clockRow, "budgetDate", "budget_date"));

      const gateRows = resultRows(await tx.execute(sql`
        SELECT snapshots.id AS authority_snapshot_id, snapshots.authority_digest,
          snapshots.slot_attempt, quotes.amount_micro_usd, snapshots.admission_digest,
          snapshots.launch_intent_id, snapshots.launch_intent_digest,
          snapshots.provider_account_id, snapshots.provider_key, snapshots.provider_credential_version,
          snapshots.governance_profile_id, snapshots.governance_evidence_digest,
          slots.influencer_id, slots.avatar_resource_id, slots.voice_resource_id,
          variants.script_id, variants.id AS script_variant_id,
          variants.checksum AS script_variant_checksum, variants.content AS script_content,
          scripts.title AS script_title, scripts.language AS script_language,
          intents.source_type, intents.source_item_id, intents.source_content_hash
        FROM ${AUTHORITY_SNAPSHOTS} snapshots
        INNER JOIN ${LAUNCH_INTENTS} intents
          ON intents.owner_user_id=snapshots.owner_user_id AND intents.workspace_id=snapshots.workspace_id
          AND intents.id=snapshots.launch_intent_id AND intents.launch_intent_digest=snapshots.launch_intent_digest
          AND intents.daily_plan_id=snapshots.daily_plan_id AND intents.daily_plan_slot_id=snapshots.daily_plan_slot_id
          AND intents.slot_attempt=snapshots.slot_attempt AND intents.plan_digest=snapshots.plan_digest
          AND intents.slot_digest=snapshots.slot_digest AND intents.provider_account_id=snapshots.provider_account_id
          AND intents.provider_key=snapshots.provider_key
          AND intents.provider_credential_version=snapshots.provider_credential_version
          AND intents.script_variant_id=snapshots.script_variant_id
          AND intents.script_variant_checksum=snapshots.script_variant_checksum
          AND intents.governance_profile_id=snapshots.governance_profile_id
          AND intents.governance_evidence_digest=snapshots.governance_evidence_digest
          AND intents.governance_use=snapshots.governance_use
          AND intents.governance_territory=snapshots.governance_territory
          AND intents.content_country=snapshots.content_country
          AND intents.launch_subject_digest=snapshots.launch_subject_digest
        INNER JOIN ${LAUNCH_EVIDENCE} content
          ON content.owner_user_id=snapshots.owner_user_id AND content.workspace_id=snapshots.workspace_id
          AND content.id=snapshots.content_approval_evidence_id
          AND content.evidence_digest=snapshots.content_approval_evidence_digest
          AND content.launch_intent_id=intents.id AND content.launch_intent_digest=intents.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} human
          ON human.owner_user_id=snapshots.owner_user_id AND human.workspace_id=snapshots.workspace_id
          AND human.id=snapshots.human_launch_approval_evidence_id
          AND human.evidence_digest=snapshots.human_launch_approval_evidence_digest
          AND human.launch_intent_id=intents.id AND human.launch_intent_digest=intents.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} sandbox
          ON sandbox.owner_user_id=snapshots.owner_user_id AND sandbox.workspace_id=snapshots.workspace_id
          AND sandbox.id=snapshots.sandbox_evidence_id
          AND sandbox.evidence_digest=snapshots.sandbox_evidence_digest
          AND sandbox.launch_intent_id=intents.id AND sandbox.launch_intent_digest=intents.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} quotes
          ON quotes.owner_user_id=snapshots.owner_user_id AND quotes.workspace_id=snapshots.workspace_id
          AND quotes.id=snapshots.maximum_quote_evidence_id
          AND quotes.evidence_digest=snapshots.maximum_quote_evidence_digest
          AND quotes.launch_intent_id=intents.id AND quotes.launch_intent_digest=intents.launch_intent_digest
        INNER JOIN ${POLICY_REVISIONS} policy
          ON policy.owner_user_id=snapshots.owner_user_id AND policy.workspace_id=snapshots.workspace_id
          AND policy.id=snapshots.policy_revision_id AND policy.revision=snapshots.policy_revision
          AND policy.policy_digest=snapshots.policy_digest
        INNER JOIN ${KILL_SWITCH_REVISIONS} kill
          ON kill.owner_user_id=snapshots.owner_user_id AND kill.workspace_id=snapshots.workspace_id
          AND kill.id=snapshots.kill_switch_revision_id AND kill.revision=snapshots.kill_switch_revision
          AND kill.evidence_digest=snapshots.kill_switch_evidence_digest
        INNER JOIN ${aiMediaDailyPlans} plans
          ON plans.owner_user_id=snapshots.owner_user_id AND plans.workspace_id=snapshots.workspace_id
          AND plans.id=snapshots.daily_plan_id AND plans.plan_digest=snapshots.plan_digest
          AND plans.provider_account_id=snapshots.provider_account_id
          AND plans.provider_key=snapshots.provider_key
          AND plans.provider_credential_version=snapshots.provider_credential_version
          AND plans.source_roster_key=intents.source_roster_key
          AND plans.source_roster_digest=intents.source_roster_digest
        INNER JOIN ${aiMediaDailyPlanSlots} slots
          ON slots.owner_user_id=snapshots.owner_user_id AND slots.workspace_id=snapshots.workspace_id
          AND slots.id=snapshots.daily_plan_slot_id AND slots.daily_plan_id=snapshots.daily_plan_id
          AND slots.slot_digest=snapshots.slot_digest
          AND slots.provider_account_id=snapshots.provider_account_id
          AND slots.provider_key=snapshots.provider_key
          AND slots.provider_credential_version=snapshots.provider_credential_version
          AND slots.script_variant_id=snapshots.script_variant_id
          AND slots.source_member_key=intents.source_member_key
        INNER JOIN ${aiMediaBudgetBuckets} buckets
          ON buckets.owner_user_id=snapshots.owner_user_id AND buckets.workspace_id=snapshots.workspace_id
        INNER JOIN ${aiMediaProviderAccounts} accounts
          ON accounts.owner_user_id=snapshots.owner_user_id AND accounts.workspace_id=snapshots.workspace_id
          AND accounts.id=snapshots.provider_account_id AND accounts.provider_key=snapshots.provider_key
        INNER JOIN ${aiMediaGovernanceProfiles} governance
          ON governance.owner_user_id=snapshots.owner_user_id AND governance.workspace_id=snapshots.workspace_id
          AND governance.id=snapshots.governance_profile_id
          AND governance.influencer_id=slots.influencer_id
          AND governance.evidence_digest=snapshots.governance_evidence_digest
        INNER JOIN ${aiMediaInfluencers} influencers
          ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
          AND influencers.id=slots.influencer_id
        INNER JOIN ${aiMediaProviderResources} avatars
          ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
          AND avatars.id=slots.avatar_resource_id AND avatars.provider_account_id=snapshots.provider_account_id
          AND avatars.provider_key=snapshots.provider_key AND avatars.resource_type='avatar'
        INNER JOIN ${aiMediaProviderResources} voices
          ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
          AND voices.id=slots.voice_resource_id AND voices.provider_account_id=snapshots.provider_account_id
          AND voices.provider_key=snapshots.provider_key AND voices.resource_type='voice'
        INNER JOIN ${aiMediaScriptVariants} variants
          ON variants.owner_user_id=snapshots.owner_user_id AND variants.workspace_id=snapshots.workspace_id
          AND variants.id=snapshots.script_variant_id AND variants.checksum=snapshots.script_variant_checksum
        INNER JOIN ${aiMediaScripts} scripts
          ON scripts.owner_user_id=variants.owner_user_id AND scripts.workspace_id=variants.workspace_id
          AND scripts.id=intents.script_id AND scripts.id=variants.script_id
          AND scripts.source_type=intents.source_type AND scripts.current_variant_id=intents.script_variant_id
        LEFT JOIN ${aiMediaSourceItems} sources
          ON sources.owner_user_id=intents.owner_user_id AND sources.workspace_id=intents.workspace_id
          AND sources.id=intents.source_item_id AND sources.source_type=intents.source_type
          AND sources.content_hash=intents.source_content_hash
        WHERE snapshots.owner_user_id=${request.scope.ownerUserId}
          AND snapshots.workspace_id=${request.scope.workspaceId}
          AND snapshots.id=${request.authoritySnapshotId}
          AND snapshots.authority_digest=${request.authorityDigest}
          AND snapshots.daily_plan_id=${request.planId} AND snapshots.daily_plan_slot_id=${request.slotId}
          AND snapshots.valid_from<=clock_timestamp() AND snapshots.expires_at>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=snapshots.expires_at
          AND plans.status='planned' AND plans.plan_date=${budgetDate}::date
          AND plans.accounting_time_zone=${this.accountingTimeZone}
          AND slots.status='planned' AND slots.state_version=${request.expectedSlotStateVersion}
          AND buckets.id=${request.budgetBucketId} AND buckets.budget_date=${budgetDate}::date
          AND buckets.accounting_time_zone=${this.accountingTimeZone} AND buckets.currency='USD'
          AND buckets.policy_digest=policy.policy_digest AND buckets.policy_version=policy.revision
          AND buckets.limit_micro_usd=policy.daily_budget_micro_usd
          AND buckets.state_version=${request.expectedBucketStateVersion}
          AND buckets.reserved_micro_usd+buckets.committed_micro_usd+quotes.amount_micro_usd<=buckets.limit_micro_usd
          AND snapshots.maximum_quote_micro_usd=quotes.amount_micro_usd
          AND snapshots.currency='USD' AND quotes.currency=snapshots.currency
          AND accounts.credential_version=snapshots.provider_credential_version
          AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
          AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>clock_timestamp())
          AND influencers.status='active' AND influencers.archived_at IS NULL
          AND avatars.status='active' AND voices.status='active'
          AND variants.status='approved'
          AND scripts.status='approved'
          AND ((intents.source_type='manual' AND intents.source_item_id IS NULL
              AND intents.source_content_hash IS NULL)
            OR (intents.source_type<>'manual' AND sources.id IS NOT NULL
              AND sources.status IN ('accepted','ready') AND sources.moderation_status='approved'
              AND sources.rights_status IN ('owned','licensed')))
          AND governance.state='active' AND governance.revoked_at IS NULL
          AND governance.valid_from<=clock_timestamp() AND governance.expires_at>clock_timestamp()
          AND governance.allowed_uses @> jsonb_build_array(snapshots.governance_use)
          AND (governance.territories @> jsonb_build_array(snapshots.governance_territory)
            OR governance.territories @> '["WORLDWIDE"]'::jsonb)
          AND content.evidence_kind='content_approval' AND content.decision='approved'
          AND human.evidence_kind='human_launch_approval' AND human.decision='approved'
          AND sandbox.evidence_kind='sandbox_proof' AND sandbox.decision='passed'
          AND quotes.evidence_kind='maximum_quote' AND quotes.decision='quoted'
          AND content.launch_subject_digest=snapshots.launch_subject_digest
          AND human.launch_subject_digest=snapshots.launch_subject_digest
          AND sandbox.launch_subject_digest=snapshots.launch_subject_digest
          AND quotes.launch_subject_digest=snapshots.launch_subject_digest
          AND (content.provider_account_id,content.provider_key,content.provider_credential_version,
            content.script_variant_id,content.script_variant_checksum,content.governance_profile_id,
            content.governance_evidence_digest,content.governance_use,content.governance_territory)
            =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
              snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
              snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
          AND (human.provider_account_id,human.provider_key,human.provider_credential_version,
            human.script_variant_id,human.script_variant_checksum,human.governance_profile_id,
            human.governance_evidence_digest,human.governance_use,human.governance_territory)
            =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
              snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
              snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
          AND (sandbox.provider_account_id,sandbox.provider_key,sandbox.provider_credential_version,
            sandbox.script_variant_id,sandbox.script_variant_checksum,sandbox.governance_profile_id,
            sandbox.governance_evidence_digest,sandbox.governance_use,sandbox.governance_territory)
            =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
              snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
              snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
          AND (quotes.provider_account_id,quotes.provider_key,quotes.provider_credential_version,
            quotes.script_variant_id,quotes.script_variant_checksum,quotes.governance_profile_id,
            quotes.governance_evidence_digest,quotes.governance_use,quotes.governance_territory)
            =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
              snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
              snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
          AND content.daily_plan_slot_id=snapshots.daily_plan_slot_id AND content.slot_attempt=snapshots.slot_attempt
          AND human.daily_plan_slot_id=snapshots.daily_plan_slot_id AND human.slot_attempt=snapshots.slot_attempt
          AND sandbox.daily_plan_slot_id=snapshots.daily_plan_slot_id AND sandbox.slot_attempt=snapshots.slot_attempt
          AND quotes.daily_plan_slot_id=snapshots.daily_plan_slot_id AND quotes.slot_attempt=snapshots.slot_attempt
          AND content.valid_from<=clock_timestamp() AND content.expires_at>clock_timestamp()
          AND human.valid_from<=clock_timestamp() AND human.expires_at>clock_timestamp()
          AND sandbox.valid_from<=clock_timestamp() AND sandbox.expires_at>clock_timestamp()
          AND quotes.valid_from<=clock_timestamp() AND quotes.expires_at>clock_timestamp()
          AND ${request.reservationExpiresAt}::timestamptz<=content.expires_at
          AND ${request.reservationExpiresAt}::timestamptz<=human.expires_at
          AND ${request.reservationExpiresAt}::timestamptz<=sandbox.expires_at
          AND ${request.reservationExpiresAt}::timestamptz<=quotes.expires_at
          AND policy.state='active' AND policy.valid_from<=clock_timestamp()
          AND (policy.expires_at IS NULL OR policy.expires_at>clock_timestamp())
          AND policy.allowed_time_zones @> jsonb_build_array(${this.accountingTimeZone}::text)
          AND policy.allowed_countries @> jsonb_build_array(snapshots.content_country)
          AND policy.allowed_languages @> jsonb_build_array(scripts.language)
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE (active.state='committed'
              OR (active.state='reserved' AND active.expires_at>clock_timestamp())))<policy.total_concurrency
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE active.provider_key=snapshots.provider_key
              AND (active.state='committed'
                OR (active.state='reserved' AND active.expires_at>clock_timestamp())))<policy.provider_concurrency
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE active.owner_user_id=snapshots.owner_user_id
              AND active.workspace_id=snapshots.workspace_id
              AND (active.state='committed'
                OR (active.state='reserved' AND active.expires_at>clock_timestamp())))<policy.tenant_concurrency
          AND kill.active=false AND kill.valid_from<=clock_timestamp()
          AND (kill.expires_at IS NULL OR kill.expires_at>clock_timestamp())
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=content.owner_user_id AND newer.workspace_id=content.workspace_id
              AND newer.daily_plan_slot_id=content.daily_plan_slot_id
              AND newer.slot_attempt=content.slot_attempt AND newer.evidence_kind=content.evidence_kind
              AND newer.revision>content.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=human.owner_user_id AND newer.workspace_id=human.workspace_id
              AND newer.daily_plan_slot_id=human.daily_plan_slot_id
              AND newer.slot_attempt=human.slot_attempt AND newer.evidence_kind=human.evidence_kind
              AND newer.revision>human.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=sandbox.owner_user_id AND newer.workspace_id=sandbox.workspace_id
              AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id
              AND newer.slot_attempt=sandbox.slot_attempt AND newer.evidence_kind=sandbox.evidence_kind
              AND newer.revision>sandbox.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=quotes.owner_user_id AND newer.workspace_id=quotes.workspace_id
              AND newer.daily_plan_slot_id=quotes.daily_plan_slot_id
              AND newer.slot_attempt=quotes.slot_attempt AND newer.evidence_kind=quotes.evidence_kind
              AND newer.revision>quotes.revision)
          AND NOT EXISTS (SELECT 1 FROM ${POLICY_REVISIONS} newer_policy
            WHERE newer_policy.owner_user_id=policy.owner_user_id AND newer_policy.workspace_id=policy.workspace_id
              AND newer_policy.revision>policy.revision)
          AND NOT EXISTS (SELECT 1 FROM ${KILL_SWITCH_REVISIONS} newer_kill
            WHERE newer_kill.owner_user_id=kill.owner_user_id AND newer_kill.workspace_id=kill.workspace_id
              AND newer_kill.revision>kill.revision)
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaGovernanceProfiles} newer_governance
            WHERE newer_governance.owner_user_id=governance.owner_user_id
              AND newer_governance.workspace_id=governance.workspace_id
              AND newer_governance.influencer_id=governance.influencer_id
              AND newer_governance.version>governance.version)
          AND snapshots.slot_attempt=COALESCE((SELECT MAX(previous.attempt)+1
            FROM ${aiMediaBudgetReservations} previous
            WHERE previous.owner_user_id=slots.owner_user_id
              AND previous.workspace_id=slots.workspace_id
              AND previous.daily_plan_slot_id=slots.id),1)
        FOR UPDATE OF snapshots, content, human, sandbox, quotes, policy, kill, intents,
          plans, slots, buckets, accounts, governance, influencers, avatars, voices, variants, scripts
      `));
      if (gateRows.length !== 1) {
        throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Exact durable launch authority did not admit this slot");
      }

      const boundIntent = gateRows[0];
      const sourceType = String(value(boundIntent, "sourceType", "source_type"));
      const sourceItemId = value(boundIntent, "sourceItemId", "source_item_id");
      const sourceContentHash = value(boundIntent, "sourceContentHash", "source_content_hash");
      if (sourceType === "manual") {
        if (sourceItemId !== null || sourceContentHash !== null) {
          throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Manual launch intent has an invalid source binding");
        }
      } else {
        if (!sourceType || sourceItemId === null || sourceItemId === undefined
          || sourceContentHash === null || sourceContentHash === undefined
          || !SHA256.test(String(sourceContentHash))) {
          throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Launch intent source binding is incomplete");
        }
        const lockedSources = resultRows(await tx.execute(sql`
          SELECT id FROM ${aiMediaSourceItems}
          WHERE owner_user_id=${request.scope.ownerUserId} AND workspace_id=${request.scope.workspaceId}
            AND id=${sourceItemId} AND source_type=${sourceType} AND content_hash=${sourceContentHash}
            AND status IN ('accepted','ready') AND moderation_status='approved'
            AND rights_status IN ('owned','licensed')
          FOR UPDATE
        `));
        if (lockedSources.length !== 1) {
          throw new DailyAdmissionPersistenceError("ADMISSION_DENIED", "Exact durable source is no longer launchable");
        }
      }

      const heldWork = heldWorkSeal({
        row: boundIntent,
        request,
        providerIdempotencyKey,
        reservationId,
        renderJobId,
        dispatchOutboxId,
      });

      const createdRows = resultRows(await tx.execute(sql`
        WITH fresh_clock AS MATERIALIZED (
          SELECT observed_at, (observed_at AT TIME ZONE ${this.accountingTimeZone})::date AS budget_date
          FROM (SELECT clock_timestamp() AS observed_at) sampled_clock
        ), final_guard AS MATERIALIZED (
          SELECT buckets.id AS bucket_id, snapshots.slot_attempt, quotes.amount_micro_usd,
            snapshots.id AS authority_snapshot_id, snapshots.authority_digest,
            snapshots.launch_intent_id, snapshots.launch_intent_digest,
            snapshots.provider_account_id, snapshots.provider_key, snapshots.provider_credential_version,
            snapshots.script_variant_checksum, snapshots.admission_digest,
            snapshots.daily_plan_slot_id, slots.influencer_id, slots.avatar_resource_id,
            slots.voice_resource_id, variants.script_id, variants.id AS script_variant_id,
            intents.source_item_id, intents.source_content_hash,
            scripts.title AS script_title, scripts.language AS script_language,
            variants.content AS script_content,
            snapshots.maximum_quote_evidence_digest AS quote_digest, quotes.expires_at AS quote_expires_at,
            snapshots.content_approval_evidence_digest, snapshots.human_launch_approval_evidence_digest,
            snapshots.governance_profile_id, snapshots.governance_evidence_digest,
            snapshots.policy_digest, snapshots.kill_switch_evidence_digest,
            snapshots.sandbox_evidence_digest, fresh_clock.observed_at
          FROM ${AUTHORITY_SNAPSHOTS} snapshots
          INNER JOIN ${LAUNCH_INTENTS} intents ON intents.id=snapshots.launch_intent_id
            AND intents.owner_user_id=snapshots.owner_user_id AND intents.workspace_id=snapshots.workspace_id
            AND intents.launch_intent_digest=snapshots.launch_intent_digest
            AND intents.daily_plan_id=snapshots.daily_plan_id AND intents.daily_plan_slot_id=snapshots.daily_plan_slot_id
            AND intents.slot_attempt=snapshots.slot_attempt AND intents.plan_digest=snapshots.plan_digest
            AND intents.slot_digest=snapshots.slot_digest AND intents.provider_account_id=snapshots.provider_account_id
            AND intents.provider_key=snapshots.provider_key
            AND intents.provider_credential_version=snapshots.provider_credential_version
            AND intents.script_variant_id=snapshots.script_variant_id
            AND intents.script_variant_checksum=snapshots.script_variant_checksum
            AND intents.governance_profile_id=snapshots.governance_profile_id
            AND intents.governance_evidence_digest=snapshots.governance_evidence_digest
            AND intents.governance_use=snapshots.governance_use
            AND intents.governance_territory=snapshots.governance_territory
            AND intents.content_country=snapshots.content_country
            AND intents.launch_subject_digest=snapshots.launch_subject_digest
          INNER JOIN ${LAUNCH_EVIDENCE} content ON content.id=snapshots.content_approval_evidence_id
            AND content.owner_user_id=snapshots.owner_user_id AND content.workspace_id=snapshots.workspace_id
            AND content.evidence_digest=snapshots.content_approval_evidence_digest
            AND content.launch_intent_id=intents.id AND content.launch_intent_digest=intents.launch_intent_digest
          INNER JOIN ${LAUNCH_EVIDENCE} human ON human.id=snapshots.human_launch_approval_evidence_id
            AND human.owner_user_id=snapshots.owner_user_id AND human.workspace_id=snapshots.workspace_id
            AND human.evidence_digest=snapshots.human_launch_approval_evidence_digest
            AND human.launch_intent_id=intents.id AND human.launch_intent_digest=intents.launch_intent_digest
          INNER JOIN ${LAUNCH_EVIDENCE} sandbox ON sandbox.id=snapshots.sandbox_evidence_id
            AND sandbox.owner_user_id=snapshots.owner_user_id AND sandbox.workspace_id=snapshots.workspace_id
            AND sandbox.evidence_digest=snapshots.sandbox_evidence_digest
            AND sandbox.launch_intent_id=intents.id AND sandbox.launch_intent_digest=intents.launch_intent_digest
          INNER JOIN ${LAUNCH_EVIDENCE} quotes ON quotes.id=snapshots.maximum_quote_evidence_id
            AND quotes.owner_user_id=snapshots.owner_user_id AND quotes.workspace_id=snapshots.workspace_id
            AND quotes.evidence_digest=snapshots.maximum_quote_evidence_digest
            AND quotes.launch_intent_id=intents.id AND quotes.launch_intent_digest=intents.launch_intent_digest
          INNER JOIN ${POLICY_REVISIONS} policy ON policy.id=snapshots.policy_revision_id
            AND policy.owner_user_id=snapshots.owner_user_id AND policy.workspace_id=snapshots.workspace_id
            AND policy.revision=snapshots.policy_revision AND policy.policy_digest=snapshots.policy_digest
          INNER JOIN ${KILL_SWITCH_REVISIONS} kill ON kill.id=snapshots.kill_switch_revision_id
            AND kill.owner_user_id=snapshots.owner_user_id AND kill.workspace_id=snapshots.workspace_id
            AND kill.revision=snapshots.kill_switch_revision
            AND kill.evidence_digest=snapshots.kill_switch_evidence_digest
          INNER JOIN ${aiMediaDailyPlans} plans ON plans.id=snapshots.daily_plan_id
            AND plans.owner_user_id=snapshots.owner_user_id AND plans.workspace_id=snapshots.workspace_id
            AND plans.plan_digest=snapshots.plan_digest AND plans.provider_account_id=snapshots.provider_account_id
            AND plans.provider_key=snapshots.provider_key
            AND plans.provider_credential_version=snapshots.provider_credential_version
            AND plans.source_roster_key=intents.source_roster_key
            AND plans.source_roster_digest=intents.source_roster_digest
          INNER JOIN ${aiMediaDailyPlanSlots} slots ON slots.id=snapshots.daily_plan_slot_id
            AND slots.owner_user_id=snapshots.owner_user_id AND slots.workspace_id=snapshots.workspace_id
            AND slots.daily_plan_id=snapshots.daily_plan_id AND slots.slot_digest=snapshots.slot_digest
            AND slots.script_variant_id=snapshots.script_variant_id
            AND slots.source_member_key=intents.source_member_key
          INNER JOIN ${aiMediaBudgetBuckets} buckets
            ON buckets.owner_user_id=snapshots.owner_user_id AND buckets.workspace_id=snapshots.workspace_id
          INNER JOIN ${aiMediaProviderAccounts} accounts ON accounts.id=snapshots.provider_account_id
            AND accounts.owner_user_id=snapshots.owner_user_id AND accounts.workspace_id=snapshots.workspace_id
            AND accounts.provider_key=snapshots.provider_key
          INNER JOIN ${aiMediaGovernanceProfiles} governance ON governance.id=snapshots.governance_profile_id
            AND governance.owner_user_id=snapshots.owner_user_id AND governance.workspace_id=snapshots.workspace_id
            AND governance.evidence_digest=snapshots.governance_evidence_digest
            AND governance.influencer_id=slots.influencer_id
          INNER JOIN ${aiMediaInfluencers} influencers
            ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
            AND influencers.id=slots.influencer_id
          INNER JOIN ${aiMediaProviderResources} avatars
            ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
            AND avatars.id=slots.avatar_resource_id AND avatars.provider_account_id=snapshots.provider_account_id
            AND avatars.provider_key=snapshots.provider_key AND avatars.resource_type='avatar'
          INNER JOIN ${aiMediaProviderResources} voices
            ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
            AND voices.id=slots.voice_resource_id AND voices.provider_account_id=snapshots.provider_account_id
            AND voices.provider_key=snapshots.provider_key AND voices.resource_type='voice'
          INNER JOIN ${aiMediaScriptVariants} variants ON variants.id=snapshots.script_variant_id
            AND variants.owner_user_id=snapshots.owner_user_id AND variants.workspace_id=snapshots.workspace_id
            AND variants.checksum=snapshots.script_variant_checksum
          INNER JOIN ${aiMediaScripts} scripts ON scripts.id=variants.script_id
            AND scripts.owner_user_id=variants.owner_user_id AND scripts.workspace_id=variants.workspace_id
            AND scripts.id=intents.script_id AND scripts.source_type=intents.source_type
            AND scripts.current_variant_id=intents.script_variant_id
          LEFT JOIN ${aiMediaSourceItems} sources ON sources.owner_user_id=intents.owner_user_id
            AND sources.workspace_id=intents.workspace_id AND sources.id=intents.source_item_id
            AND sources.source_type=intents.source_type AND sources.content_hash=intents.source_content_hash
          CROSS JOIN fresh_clock
          WHERE snapshots.id=${request.authoritySnapshotId}
            AND snapshots.owner_user_id=${request.scope.ownerUserId}
            AND snapshots.workspace_id=${request.scope.workspaceId}
            AND snapshots.authority_digest=${request.authorityDigest}
            AND snapshots.daily_plan_id=${request.planId} AND snapshots.daily_plan_slot_id=${request.slotId}
            AND snapshots.valid_from<=fresh_clock.observed_at AND snapshots.expires_at>fresh_clock.observed_at
            AND ${request.reservationExpiresAt}::timestamptz>fresh_clock.observed_at
            AND ${request.reservationExpiresAt}::timestamptz<=snapshots.expires_at
            AND plans.status='planned' AND plans.plan_date=fresh_clock.budget_date
            AND plans.accounting_time_zone=${this.accountingTimeZone}
            AND slots.status='planned' AND slots.state_version=${request.expectedSlotStateVersion}
            AND slots.provider_account_id=snapshots.provider_account_id
            AND slots.provider_key=snapshots.provider_key
            AND slots.provider_credential_version=snapshots.provider_credential_version
            AND buckets.id=${request.budgetBucketId} AND buckets.budget_date=fresh_clock.budget_date
            AND buckets.accounting_time_zone=${this.accountingTimeZone} AND buckets.currency='USD'
            AND buckets.policy_digest=policy.policy_digest AND buckets.policy_version=policy.revision
            AND buckets.limit_micro_usd=policy.daily_budget_micro_usd
            AND buckets.state_version=${request.expectedBucketStateVersion}
            AND buckets.reserved_micro_usd+buckets.committed_micro_usd+quotes.amount_micro_usd<=buckets.limit_micro_usd
            AND quotes.amount_micro_usd=snapshots.maximum_quote_micro_usd
            AND quotes.currency='USD' AND snapshots.currency='USD'
            AND accounts.credential_version=snapshots.provider_credential_version
            AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
            AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>fresh_clock.observed_at)
            AND influencers.status='active' AND influencers.archived_at IS NULL
            AND avatars.status='active' AND voices.status='active'
            AND governance.state='active' AND governance.revoked_at IS NULL
            AND governance.valid_from<=fresh_clock.observed_at AND governance.expires_at>fresh_clock.observed_at
            AND governance.allowed_uses @> jsonb_build_array(snapshots.governance_use)
            AND (governance.territories @> jsonb_build_array(snapshots.governance_territory)
              OR governance.territories @> '["WORLDWIDE"]'::jsonb)
            AND variants.status='approved'
            AND scripts.status='approved'
            AND length(btrim(variants.content)) BETWEEN 1 AND 20000
            AND variants.content=${heldWork.scriptContent}
            AND variants.checksum=${heldWork.scriptVariantChecksum}
            AND ((intents.source_type='manual' AND intents.source_item_id IS NULL
                AND intents.source_content_hash IS NULL)
              OR (intents.source_type<>'manual' AND sources.id IS NOT NULL
                AND sources.status IN ('accepted','ready') AND sources.moderation_status='approved'
                AND sources.rights_status IN ('owned','licensed')))
            AND content.evidence_kind='content_approval' AND content.decision='approved'
            AND human.evidence_kind='human_launch_approval' AND human.decision='approved'
            AND sandbox.evidence_kind='sandbox_proof' AND sandbox.decision='passed'
            AND quotes.evidence_kind='maximum_quote' AND quotes.decision='quoted'
            AND content.launch_subject_digest=snapshots.launch_subject_digest
            AND human.launch_subject_digest=snapshots.launch_subject_digest
            AND sandbox.launch_subject_digest=snapshots.launch_subject_digest
            AND quotes.launch_subject_digest=snapshots.launch_subject_digest
            AND (content.provider_account_id,content.provider_key,content.provider_credential_version,
              content.script_variant_id,content.script_variant_checksum,content.governance_profile_id,
              content.governance_evidence_digest,content.governance_use,content.governance_territory)
              =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
                snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
                snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
            AND (human.provider_account_id,human.provider_key,human.provider_credential_version,
              human.script_variant_id,human.script_variant_checksum,human.governance_profile_id,
              human.governance_evidence_digest,human.governance_use,human.governance_territory)
              =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
                snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
                snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
            AND (sandbox.provider_account_id,sandbox.provider_key,sandbox.provider_credential_version,
              sandbox.script_variant_id,sandbox.script_variant_checksum,sandbox.governance_profile_id,
              sandbox.governance_evidence_digest,sandbox.governance_use,sandbox.governance_territory)
              =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
                snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
                snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
            AND (quotes.provider_account_id,quotes.provider_key,quotes.provider_credential_version,
              quotes.script_variant_id,quotes.script_variant_checksum,quotes.governance_profile_id,
              quotes.governance_evidence_digest,quotes.governance_use,quotes.governance_territory)
              =(snapshots.provider_account_id,snapshots.provider_key,snapshots.provider_credential_version,
                snapshots.script_variant_id,snapshots.script_variant_checksum,snapshots.governance_profile_id,
                snapshots.governance_evidence_digest,snapshots.governance_use,snapshots.governance_territory)
            AND content.daily_plan_slot_id=snapshots.daily_plan_slot_id AND content.slot_attempt=snapshots.slot_attempt
            AND human.daily_plan_slot_id=snapshots.daily_plan_slot_id AND human.slot_attempt=snapshots.slot_attempt
            AND sandbox.daily_plan_slot_id=snapshots.daily_plan_slot_id AND sandbox.slot_attempt=snapshots.slot_attempt
            AND quotes.daily_plan_slot_id=snapshots.daily_plan_slot_id AND quotes.slot_attempt=snapshots.slot_attempt
            AND content.valid_from<=fresh_clock.observed_at AND content.expires_at>fresh_clock.observed_at
            AND human.valid_from<=fresh_clock.observed_at AND human.expires_at>fresh_clock.observed_at
            AND sandbox.valid_from<=fresh_clock.observed_at AND sandbox.expires_at>fresh_clock.observed_at
            AND quotes.valid_from<=fresh_clock.observed_at AND quotes.expires_at>fresh_clock.observed_at
            AND ${request.reservationExpiresAt}::timestamptz<=content.expires_at
            AND ${request.reservationExpiresAt}::timestamptz<=human.expires_at
            AND ${request.reservationExpiresAt}::timestamptz<=sandbox.expires_at
            AND ${request.reservationExpiresAt}::timestamptz<=quotes.expires_at
            AND policy.state='active' AND policy.valid_from<=fresh_clock.observed_at
            AND (policy.expires_at IS NULL OR policy.expires_at>fresh_clock.observed_at)
            AND policy.allowed_time_zones @> jsonb_build_array(${this.accountingTimeZone}::text)
            AND policy.allowed_countries @> jsonb_build_array(snapshots.content_country)
            AND policy.allowed_languages @> jsonb_build_array(scripts.language)
            AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
              WHERE (active.state='committed'
                OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))<policy.total_concurrency
            AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
              WHERE active.provider_key=snapshots.provider_key
                AND (active.state='committed'
                  OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))<policy.provider_concurrency
            AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
              WHERE active.owner_user_id=snapshots.owner_user_id
                AND active.workspace_id=snapshots.workspace_id
                AND (active.state='committed'
                  OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))<policy.tenant_concurrency
            AND kill.active=false AND kill.valid_from<=fresh_clock.observed_at
            AND (kill.expires_at IS NULL OR kill.expires_at>fresh_clock.observed_at)
            AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
              WHERE newer.owner_user_id=content.owner_user_id AND newer.workspace_id=content.workspace_id
                AND newer.daily_plan_slot_id=content.daily_plan_slot_id AND newer.slot_attempt=content.slot_attempt
                AND newer.evidence_kind=content.evidence_kind AND newer.revision>content.revision)
            AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
              WHERE newer.owner_user_id=human.owner_user_id AND newer.workspace_id=human.workspace_id
                AND newer.daily_plan_slot_id=human.daily_plan_slot_id AND newer.slot_attempt=human.slot_attempt
                AND newer.evidence_kind=human.evidence_kind AND newer.revision>human.revision)
            AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
              WHERE newer.owner_user_id=sandbox.owner_user_id AND newer.workspace_id=sandbox.workspace_id
                AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id AND newer.slot_attempt=sandbox.slot_attempt
                AND newer.evidence_kind=sandbox.evidence_kind AND newer.revision>sandbox.revision)
            AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
              WHERE newer.owner_user_id=quotes.owner_user_id AND newer.workspace_id=quotes.workspace_id
                AND newer.daily_plan_slot_id=quotes.daily_plan_slot_id AND newer.slot_attempt=quotes.slot_attempt
                AND newer.evidence_kind=quotes.evidence_kind AND newer.revision>quotes.revision)
            AND NOT EXISTS (SELECT 1 FROM ${POLICY_REVISIONS} newer_policy
              WHERE newer_policy.owner_user_id=policy.owner_user_id
                AND newer_policy.workspace_id=policy.workspace_id AND newer_policy.revision>policy.revision)
            AND NOT EXISTS (SELECT 1 FROM ${KILL_SWITCH_REVISIONS} newer_kill
              WHERE newer_kill.owner_user_id=kill.owner_user_id
                AND newer_kill.workspace_id=kill.workspace_id AND newer_kill.revision>kill.revision)
            AND NOT EXISTS (SELECT 1 FROM ${aiMediaGovernanceProfiles} newer_governance
              WHERE newer_governance.owner_user_id=governance.owner_user_id
                AND newer_governance.workspace_id=governance.workspace_id
                AND newer_governance.influencer_id=governance.influencer_id
                AND newer_governance.version>governance.version)
            AND snapshots.slot_attempt=COALESCE((SELECT MAX(previous.attempt)+1
              FROM ${aiMediaBudgetReservations} previous
              WHERE previous.owner_user_id=slots.owner_user_id
                AND previous.workspace_id=slots.workspace_id
                AND previous.daily_plan_slot_id=slots.id),1)
          FOR UPDATE OF snapshots, content, human, sandbox, quotes, policy, kill,
            plans, slots, buckets, accounts, governance, influencers, avatars, voices, variants, scripts
        ), work_request AS MATERIALIZED (
          SELECT final_guard.*,
            ${reservationId}::uuid AS reservation_id,
            ${renderJobId}::uuid AS render_job_id,
            ${dispatchOutboxId}::uuid AS dispatch_outbox_id,
            ${JSON.stringify(heldWork.requestJson)}::jsonb AS request_json,
            ${heldWork.sealedRequestDigest} AS sealed_request_digest,
            ${heldWork.workHandoffDigest} AS work_handoff_digest
          FROM final_guard
        ), bucket_update AS (
          UPDATE ${aiMediaBudgetBuckets} buckets
          SET reserved_micro_usd=buckets.reserved_micro_usd+work_request.amount_micro_usd,
            state_version=buckets.state_version+1, updated_at=work_request.observed_at
          FROM work_request
          WHERE buckets.id=work_request.bucket_id
            AND buckets.owner_user_id=${request.scope.ownerUserId}
            AND buckets.workspace_id=${request.scope.workspaceId} AND buckets.currency='USD'
            AND buckets.state_version=${request.expectedBucketStateVersion}
            AND buckets.reserved_micro_usd+buckets.committed_micro_usd+work_request.amount_micro_usd<=buckets.limit_micro_usd
          RETURNING buckets.id, work_request.*
        ), reservation_insert AS (
          INSERT INTO ${aiMediaBudgetReservations} (
            id,owner_user_id,workspace_id,budget_bucket_id,daily_plan_slot_id,provider_account_id,
            provider_key,provider_credential_version,attempt,state,submission_state,amount_micro_usd,
            currency,idempotency_key,input_digest,admission_digest,authority_snapshot_id,authority_digest,
            script_variant_checksum,quote_digest,quote_expires_at,content_approval_digest,
            human_launch_approval_digest,governance_profile_id,governance_evidence_digest,policy_digest,
            kill_switch_evidence_digest,sandbox_evidence_digest,provider_idempotency_key,
            render_job_id,dispatch_outbox_id,work_handoff_digest,reserved_at,expires_at,created_at,updated_at
          )
          SELECT bucket_update.reservation_id,${request.scope.ownerUserId},${request.scope.workspaceId},${request.budgetBucketId},
            ${request.slotId},bucket_update.provider_account_id,bucket_update.provider_key,
            bucket_update.provider_credential_version,bucket_update.slot_attempt,'reserved','not_started',
            bucket_update.amount_micro_usd,'USD',${request.idempotencyKey},${request.inputDigest},
            bucket_update.admission_digest,${request.authoritySnapshotId},${request.authorityDigest},
            bucket_update.script_variant_checksum,bucket_update.quote_digest,bucket_update.quote_expires_at,
            bucket_update.content_approval_evidence_digest,bucket_update.human_launch_approval_evidence_digest,
            bucket_update.governance_profile_id,bucket_update.governance_evidence_digest,
            bucket_update.policy_digest,bucket_update.kill_switch_evidence_digest,
            bucket_update.sandbox_evidence_digest,${providerIdempotencyKey},bucket_update.render_job_id,
            bucket_update.dispatch_outbox_id,bucket_update.work_handoff_digest,
            bucket_update.observed_at,${request.reservationExpiresAt}::timestamptz,
            bucket_update.observed_at,bucket_update.observed_at
          FROM bucket_update
          RETURNING *
        ), render_insert AS (
          INSERT INTO ${aiMediaRenderJobs} (
            id,owner_user_id,workspace_id,provider_account_id,provider_key,provider_credential_version,
            idempotency_key,title,status,stage,progress,attempts,retry_count,max_attempts,request,
            governance_profile_id,governance_evidence_digest,queued_at,available_at,created_at,updated_at,
            budget_reservation_id,daily_plan_slot_id,slot_attempt,influencer_id,avatar_resource_id,
            voice_resource_id,script_id,script_variant_id,source_item_id,source_content_hash,
            authority_snapshot_id,authority_digest,launch_intent_id,launch_intent_digest,
            admission_digest,script_variant_checksum,sealed_request_digest,work_handoff_digest
          )
          SELECT bucket_update.render_job_id,${request.scope.ownerUserId},${request.scope.workspaceId},
            bucket_update.provider_account_id,bucket_update.provider_key,bucket_update.provider_credential_version,
            ${providerIdempotencyKey},left(bucket_update.script_title,160),'pending','admission_held',0,0,0,3,
            bucket_update.request_json,bucket_update.governance_profile_id,bucket_update.governance_evidence_digest,
            bucket_update.observed_at,bucket_update.observed_at,bucket_update.observed_at,bucket_update.observed_at,
            reservation.id,bucket_update.daily_plan_slot_id,bucket_update.slot_attempt,bucket_update.influencer_id,
            bucket_update.avatar_resource_id,bucket_update.voice_resource_id,bucket_update.script_id,
            bucket_update.script_variant_id,bucket_update.source_item_id,bucket_update.source_content_hash,
            bucket_update.authority_snapshot_id,bucket_update.authority_digest,bucket_update.launch_intent_id,
            bucket_update.launch_intent_digest,bucket_update.admission_digest,bucket_update.script_variant_checksum,
            bucket_update.sealed_request_digest,bucket_update.work_handoff_digest
          FROM bucket_update INNER JOIN reservation_insert reservation
            ON reservation.id=bucket_update.reservation_id
          RETURNING *
        ), outbox_insert AS (
          INSERT INTO ${aiMediaOutbox} (
            id,owner_user_id,workspace_id,idempotency_key,aggregate_type,aggregate_id,event_type,payload,
            status,attempts,available_at,fencing_token,created_at,updated_at,
            budget_reservation_id,render_job_id,sealed_request_digest,work_handoff_digest
          )
          SELECT bucket_update.dispatch_outbox_id,${request.scope.ownerUserId},${request.scope.workspaceId},
            ${providerIdempotencyKey}||':dispatch','render_job',render.id::text,'ai_media.render.dispatch',
            jsonb_build_object('version',1,'renderJobId',render.id::text,
              'reservationId',reservation.id::text,'sealedRequestDigest',bucket_update.sealed_request_digest,
              'workHandoffDigest',bucket_update.work_handoff_digest),
            'held',0,bucket_update.observed_at,0,bucket_update.observed_at,bucket_update.observed_at,
            reservation.id,render.id,bucket_update.sealed_request_digest,bucket_update.work_handoff_digest
          FROM bucket_update
          INNER JOIN reservation_insert reservation ON reservation.id=bucket_update.reservation_id
          INNER JOIN render_insert render ON render.id=bucket_update.render_job_id
          RETURNING *
        ), slot_update AS (
          UPDATE ${aiMediaDailyPlanSlots} slots
          SET status='reserved',state_version=state_version+1,updated_at=reservation.reserved_at
          FROM reservation_insert reservation
          INNER JOIN outbox_insert outbox ON outbox.id=reservation.dispatch_outbox_id
          WHERE slots.id=${request.slotId} AND slots.owner_user_id=${request.scope.ownerUserId}
            AND slots.workspace_id=${request.scope.workspaceId} AND slots.daily_plan_id=${request.planId}
            AND slots.status='planned' AND slots.state_version=${request.expectedSlotStateVersion}
            AND reservation.daily_plan_slot_id=slots.id AND outbox.render_job_id=reservation.render_job_id
          RETURNING slots.id
        )
        SELECT reservation_insert.*, reservation_insert.reserved_at AS database_now
        FROM reservation_insert
        INNER JOIN render_insert ON render_insert.id=reservation_insert.render_job_id
        INNER JOIN outbox_insert ON outbox_insert.id=reservation_insert.dispatch_outbox_id
        INNER JOIN slot_update ON slot_update.id=reservation_insert.daily_plan_slot_id
      `));
      if (createdRows.length !== 1) throw invariant("Atomic reservation or slot CAS did not create exactly one row");
      return {
        reservation: reservationFromRow(createdRows[0]),
        databaseNow: canonicalIso(value(createdRows[0], "databaseNow", "database_now"), "databaseNow"),
        budgetDate,
        accountingTimeZone: this.accountingTimeZone,
        replayed: false,
        effects: CREATED_EFFECTS,
      };
    });
  }
}

function databaseMicroUsd(value: unknown): string {
  const raw = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^[1-9]\d*$/u.test(raw) || BigInt(raw) > 9_000_000_000_000_000n) {
    throw invariant("Database returned an invalid amountMicroUsd");
  }
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
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invalid(message: string): DailyAdmissionPersistenceError {
  return new DailyAdmissionPersistenceError("INVALID_INPUT", message);
}

function invariant(message: string): DailyAdmissionPersistenceError {
  return new DailyAdmissionPersistenceError("INVARIANT_VIOLATION", message);
}
