import { sql, type SQL } from "drizzle-orm";
import { readProductionBatchEnvelope } from "../production-batches/metadata-integrity";
import {
  deriveMaximumQuoteKey,
  deriveRenderSpecKey,
} from "./one-video-execution-control-contracts";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionExistingAttempt,
  type OneVideoHeldAdmissionPublicCas,
  type OneVideoHeldAdmissionReplayRepository,
} from "./one-video-held-admission-contracts";
import type { TenantScope } from "../core/resource-domain";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoHeldAdmissionReplayDatabase = { execute(query: SQL): Promise<ExecuteResult> };
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PUBLIC_KEY = (prefix: string) => new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u");
const MONEY = /^[1-9][0-9]{0,15}$/u;

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result?.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const nullable = (row: Row, camel: string, snake: string): unknown => value(row, camel, snake) ?? null;
const instant = (raw: unknown): string => {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  return parsed.toISOString();
};

/**
 * Reads one tenant-bound durable attempt with its immutable authority/evidence
 * and held-work tuple. It has no mutation, provider, secret, activation or
 * worker dependency.
 */
export class DrizzleOneVideoHeldAdmissionReplayRepository
implements OneVideoHeldAdmissionReplayRepository {
  constructor(private readonly db: OneVideoHeldAdmissionReplayDatabase) {
    if (!db || typeof db.execute !== "function") throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }

  async observeExisting(
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
  ): Promise<OneVideoHeldAdmissionExistingAttempt | undefined> {
    assertScopeAndPath(scope, publicPlanKey, publicSlotKey);
    return this.load(scope, publicPlanKey, publicSlotKey);
  }

  async loadExactReplay(
    scope: TenantScope,
    cas: Readonly<OneVideoHeldAdmissionPublicCas>,
  ): Promise<OneVideoHeldAdmissionExistingAttempt | undefined> {
    assertScopeAndCas(scope, cas);
    const found = await this.load(scope, cas.publicPlanKey, cas.publicSlotKey, cas.idempotencyKey);
    if (!found) return undefined;
    if (found.publicPlanKey !== cas.publicPlanKey
      || found.publicSlotKey !== cas.publicSlotKey
      || found.publicBatchKey !== cas.expectedBatchId
      || found.publicQuoteKey !== cas.expectedQuoteKey
      || found.publicRenderSpecKey !== cas.expectedRenderSpecKey
      || found.slotAttempt !== cas.expectedSlotAttempt
      || found.idempotencyKey !== cas.idempotencyKey) {
      throw new OneVideoHeldAdmissionError("STALE_OR_CONFLICT");
    }
    return found;
  }

  private async load(
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
    idempotencyKey?: string,
  ): Promise<OneVideoHeldAdmissionExistingAttempt | undefined> {
    let found: Row[];
    try {
      found = rows(await this.db.execute(sql`
        WITH db_clock AS MATERIALIZED (SELECT transaction_timestamp() AS observed_at),
        candidates AS MATERIALIZED (
          SELECT reservation.*,plan.id AS plan_id,plan.public_plan_key,slot.public_slot_key,slot.status AS slot_status,
            script.metadata AS script_metadata,
            snapshot.id AS snapshot_id,snapshot.daily_plan_id AS snapshot_plan_id,
            snapshot.daily_plan_slot_id AS snapshot_slot_id,snapshot.slot_attempt AS snapshot_slot_attempt,
            snapshot.maximum_quote_evidence_id,snapshot.maximum_quote_evidence_digest,
            snapshot.maximum_quote_micro_usd AS snapshot_maximum_quote_micro_usd,
            snapshot.currency AS snapshot_currency,
            snapshot.human_launch_approval_evidence_id,snapshot.authority_digest AS snapshot_authority_digest,
            snapshot.admission_digest AS snapshot_admission_digest,
            quote.id AS quote_id,quote.revision AS quote_revision,quote.evidence_kind AS quote_kind,
            quote.decision AS quote_decision,quote.amount_micro_usd AS quote_amount,
            quote.currency AS quote_currency,quote.expires_at AS evidence_quote_expires_at,
            quote.evidence_digest AS quote_evidence_digest,
            bridge.human_launch_approval_evidence_id AS bridge_human_id,
            bridge.maximum_quote_evidence_id AS bridge_quote_id,
            bridge.maximum_quote_evidence_revision AS bridge_quote_revision,
            bridge.maximum_quote_evidence_digest AS bridge_quote_digest,
            bridge.daily_plan_slot_id AS bridge_slot_id,bridge.slot_attempt AS bridge_slot_attempt,
            bridge.decision AS bridge_decision,bridge.amount_micro_usd AS bridge_amount,
            bridge.currency AS bridge_currency,bridge.quote_expires_at AS bridge_quote_expires_at,
            bridge.render_spec_digest,
            job.id AS job_id,job.status AS job_status,job.stage AS job_stage,job.progress AS job_progress,
            job.attempts AS job_attempts,job.provider_job_id AS job_provider_job_id,
            job.lease_owner AS job_lease_owner,job.budget_reservation_id AS job_reservation_id,
            job.daily_plan_slot_id AS job_slot_id,job.slot_attempt AS job_slot_attempt,
            job.authority_snapshot_id AS job_snapshot_id,job.authority_digest AS job_authority_digest,
            job.admission_digest AS job_admission_digest,job.work_handoff_digest AS job_handoff_digest,
            job.sealed_request_digest AS job_sealed_digest,
            outbox.id AS outbox_id,outbox.status AS outbox_status,outbox.attempts AS outbox_attempts,
            outbox.lease_owner AS outbox_lease_owner,outbox.processed_at AS outbox_processed_at,
            outbox.budget_reservation_id AS outbox_reservation_id,outbox.render_job_id AS outbox_render_id,
            outbox.work_handoff_digest AS outbox_handoff_digest,
            outbox.sealed_request_digest AS outbox_sealed_digest
          FROM ai_media_budget_reservations reservation
          JOIN ai_media_daily_plan_slots slot ON slot.owner_user_id=reservation.owner_user_id
            AND slot.workspace_id=reservation.workspace_id AND slot.id=reservation.daily_plan_slot_id
          JOIN ai_media_daily_plans plan ON plan.owner_user_id=slot.owner_user_id
            AND plan.workspace_id=slot.workspace_id AND plan.id=slot.daily_plan_id
          LEFT JOIN ai_media_scripts script ON script.owner_user_id=slot.owner_user_id
            AND script.workspace_id=slot.workspace_id AND script.current_variant_id=slot.script_variant_id
          LEFT JOIN ai_media_launch_authority_snapshots snapshot
            ON snapshot.owner_user_id=reservation.owner_user_id
            AND snapshot.workspace_id=reservation.workspace_id AND snapshot.id=reservation.authority_snapshot_id
          LEFT JOIN ai_media_launch_evidence quote ON quote.owner_user_id=snapshot.owner_user_id
            AND quote.workspace_id=snapshot.workspace_id AND quote.id=snapshot.maximum_quote_evidence_id
          LEFT JOIN ai_media_quote_bound_human_approvals bridge
            ON bridge.owner_user_id=snapshot.owner_user_id AND bridge.workspace_id=snapshot.workspace_id
            AND bridge.human_launch_approval_evidence_id=snapshot.human_launch_approval_evidence_id
            AND bridge.maximum_quote_evidence_id=snapshot.maximum_quote_evidence_id
          LEFT JOIN ai_media_render_jobs job ON job.owner_user_id=reservation.owner_user_id
            AND job.workspace_id=reservation.workspace_id AND job.id=reservation.render_job_id
          LEFT JOIN ai_media_outbox outbox ON outbox.owner_user_id=reservation.owner_user_id
            AND outbox.workspace_id=reservation.workspace_id AND outbox.id=reservation.dispatch_outbox_id
          WHERE reservation.owner_user_id=${scope.ownerUserId}
            AND reservation.workspace_id=${scope.workspaceId}
            AND ((plan.public_plan_key=${publicPlanKey} AND slot.public_slot_key=${publicSlotKey})
              OR (${idempotencyKey ?? ""}<>'' AND reservation.idempotency_key=${idempotencyKey ?? ""}))
          ORDER BY reservation.reserved_at DESC LIMIT 3
        )
        SELECT db_clock.observed_at,candidates.* FROM db_clock JOIN candidates ON true
      `));
    } catch (error) {
      if (error instanceof OneVideoHeldAdmissionError) throw error;
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    if (found.length === 0) return undefined;
    if (found.length !== 1) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    return project(found[0]!, scope);
  }
}

function project(row: Row, scope: TenantScope): OneVideoHeldAdmissionExistingAttempt {
  const observedAt = instant(value(row, "observedAt", "observed_at"));
  const expiresAt = instant(value(row, "expiresAt", "expires_at"));
  const quoteExpiresAt = instant(value(row, "evidenceQuoteExpiresAt", "evidence_quote_expires_at"));
  const bridgeQuoteExpiresAt = instant(value(row, "bridgeQuoteExpiresAt", "bridge_quote_expires_at"));
  const reservationId = text(row, "id", "id");
  const publicPlanKey = text(row, "publicPlanKey", "public_plan_key");
  const publicSlotKey = text(row, "publicSlotKey", "public_slot_key");
  const slotId = text(row, "dailyPlanSlotId", "daily_plan_slot_id");
  const planId = text(row, "planId", "plan_id");
  const snapshotId = text(row, "snapshotId", "snapshot_id");
  const quoteId = text(row, "quoteId", "quote_id");
  const quoteDigest = text(row, "quoteEvidenceDigest", "quote_evidence_digest");
  const renderSpecDigest = text(row, "renderSpecDigest", "render_spec_digest");
  const amount = text(row, "amountMicroUsd", "amount_micro_usd");
  const attempt = number(row, "attempt", "attempt");
  const quoteRevision = number(row, "quoteRevision", "quote_revision");
  const metadata = value(row, "scriptMetadata", "script_metadata");
  const envelope = readProductionBatchEnvelope(metadata);

  const baseValid = text(row, "ownerUserId", "owner_user_id") === scope.ownerUserId
    && text(row, "workspaceId", "workspace_id") === scope.workspaceId
    && scope.workspaceId === "personal"
    && [reservationId, slotId, planId, snapshotId, quoteId].every((id) => UUID.test(id))
    && PUBLIC_KEY("plan").test(publicPlanKey) && PUBLIC_KEY("slot").test(publicSlotKey)
    && envelope?.planId === publicPlanKey && envelope.slotId === publicSlotKey
    && Number.isSafeInteger(attempt) && attempt >= 1
    && number(row, "snapshotSlotAttempt", "snapshot_slot_attempt") === attempt
    && text(row, "snapshotPlanId", "snapshot_plan_id") === planId
    && text(row, "snapshotSlotId", "snapshot_slot_id") === slotId
    && text(row, "authoritySnapshotId", "authority_snapshot_id") === snapshotId
    && text(row, "authorityDigest", "authority_digest") === text(row, "snapshotAuthorityDigest", "snapshot_authority_digest")
    && text(row, "admissionDigest", "admission_digest") === text(row, "snapshotAdmissionDigest", "snapshot_admission_digest")
    && SHA256.test(text(row, "authorityDigest", "authority_digest"))
    && SHA256.test(text(row, "admissionDigest", "admission_digest"))
    && text(row, "maximumQuoteEvidenceId", "maximum_quote_evidence_id") === quoteId
    && text(row, "maximumQuoteEvidenceDigest", "maximum_quote_evidence_digest") === quoteDigest
    && text(row, "quoteDigest", "quote_digest") === quoteDigest
    && text(row, "quoteKind", "quote_kind") === "maximum_quote"
    && text(row, "quoteDecision", "quote_decision") === "quoted"
    && Number.isSafeInteger(quoteRevision) && quoteRevision >= 1
    && text(row, "quoteAmount", "quote_amount") === amount
    && text(row, "snapshotMaximumQuoteMicroUsd", "snapshot_maximum_quote_micro_usd") === amount
    && text(row, "snapshotCurrency", "snapshot_currency") === "USD"
    && text(row, "quoteCurrency", "quote_currency") === "USD"
    && text(row, "currency", "currency") === "USD"
    && MONEY.test(amount) && BigInt(amount) <= 9_000_000_000_000_000n
    && quoteExpiresAt === instant(value(row, "quoteExpiresAt", "quote_expires_at"))
    && bridgeQuoteExpiresAt === quoteExpiresAt
    && text(row, "bridgeHumanId", "bridge_human_id") === text(row, "humanLaunchApprovalEvidenceId", "human_launch_approval_evidence_id")
    && text(row, "bridgeSlotId", "bridge_slot_id") === slotId
    && number(row, "bridgeSlotAttempt", "bridge_slot_attempt") === attempt
    && text(row, "bridgeQuoteId", "bridge_quote_id") === quoteId
    && number(row, "bridgeQuoteRevision", "bridge_quote_revision") === quoteRevision
    && text(row, "bridgeQuoteDigest", "bridge_quote_digest") === quoteDigest
    && text(row, "bridgeDecision", "bridge_decision") === "approved"
    && text(row, "bridgeAmount", "bridge_amount") === amount
    && text(row, "bridgeCurrency", "bridge_currency") === "USD"
    && SHA256.test(renderSpecDigest)
    && expiresAt <= quoteExpiresAt;
  if (!baseValid || !envelope) throw new OneVideoHeldAdmissionError("UNAVAILABLE");

  const publicQuoteKey = deriveMaximumQuoteKey({
    evidenceId: quoteId,
    evidenceRevision: quoteRevision,
    evidenceDigest: quoteDigest as `sha256:${string}`,
    amountMicroUsd: amount,
    currency: "USD",
    expiresAt: new Date(quoteExpiresAt),
    renderSpecDigest: renderSpecDigest as `sha256:${string}`,
  });
  const publicRenderSpecKey = deriveRenderSpecKey(renderSpecDigest as `sha256:${string}`);
  const durableState = text(row, "state", "state");
  const submissionState = text(row, "submissionState", "submission_state");
  const expired = durableState === "expired"
    || (durableState === "reserved" && Date.parse(expiresAt) <= Date.parse(observedAt));
  let state: OneVideoHeldAdmissionExistingAttempt["state"] = "blocked";
  if (expired) state = "expired";
  else if (durableState === "reserved" && submissionState === "not_started") {
    assertExactHeldTuple(row, reservationId, slotId, attempt, snapshotId);
    state = "held";
  } else if (!["committed", "released", "settled"].includes(durableState)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }

  return Object.freeze({
    ownerUserId: text(row, "ownerUserId", "owner_user_id"),
    workspaceId: text(row, "workspaceId", "workspace_id") as "personal",
    observedAt,
    publicPlanKey,
    publicBatchKey: envelope.batchId,
    publicSlotKey,
    publicQuoteKey,
    publicRenderSpecKey,
    slotAttempt: attempt,
    idempotencyKey: text(row, "idempotencyKey", "idempotency_key"),
    reservationId,
    maximumQuoteMicroUsd: amount,
    currency: "USD",
    expiresAt,
    state,
  });
}

function assertExactHeldTuple(row: Row, reservationId: string, slotId: string, attempt: number, snapshotId: string): void {
  const renderId = text(row, "renderJobId", "render_job_id");
  const outboxId = text(row, "dispatchOutboxId", "dispatch_outbox_id");
  const handoff = text(row, "workHandoffDigest", "work_handoff_digest");
  const sealed = text(row, "jobSealedDigest", "job_sealed_digest");
  const exact = UUID.test(renderId) && UUID.test(outboxId) && SHA256.test(handoff) && SHA256.test(sealed)
    && text(row, "slotStatus", "slot_status") === "reserved"
    && text(row, "jobId", "job_id") === renderId
    && text(row, "jobStatus", "job_status") === "pending"
    && text(row, "jobStage", "job_stage") === "admission_held"
    && number(row, "jobProgress", "job_progress") === 0
    && number(row, "jobAttempts", "job_attempts") === 0
    && nullable(row, "jobProviderJobId", "job_provider_job_id") === null
    && nullable(row, "jobLeaseOwner", "job_lease_owner") === null
    && text(row, "jobReservationId", "job_reservation_id") === reservationId
    && text(row, "jobSlotId", "job_slot_id") === slotId
    && number(row, "jobSlotAttempt", "job_slot_attempt") === attempt
    && text(row, "jobSnapshotId", "job_snapshot_id") === snapshotId
    && text(row, "jobAuthorityDigest", "job_authority_digest") === text(row, "authorityDigest", "authority_digest")
    && text(row, "jobAdmissionDigest", "job_admission_digest") === text(row, "admissionDigest", "admission_digest")
    && text(row, "jobHandoffDigest", "job_handoff_digest") === handoff
    && text(row, "outboxId", "outbox_id") === outboxId
    && text(row, "outboxStatus", "outbox_status") === "held"
    && number(row, "outboxAttempts", "outbox_attempts") === 0
    && nullable(row, "outboxLeaseOwner", "outbox_lease_owner") === null
    && nullable(row, "outboxProcessedAt", "outbox_processed_at") === null
    && text(row, "outboxReservationId", "outbox_reservation_id") === reservationId
    && text(row, "outboxRenderId", "outbox_render_id") === renderId
    && text(row, "outboxHandoffDigest", "outbox_handoff_digest") === handoff
    && text(row, "outboxSealedDigest", "outbox_sealed_digest") === sealed;
  if (!exact) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
}

function assertScopeAndPath(scope: TenantScope, plan: string, slot: string): void {
  if (!scope || typeof scope.ownerUserId !== "string" || scope.ownerUserId !== scope.ownerUserId.trim()
    || scope.ownerUserId.length < 1 || scope.ownerUserId.length > 255 || scope.workspaceId !== "personal"
    || !PUBLIC_KEY("plan").test(plan) || !PUBLIC_KEY("slot").test(slot)) {
    throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
  }
}

function assertScopeAndCas(scope: TenantScope, cas: Readonly<OneVideoHeldAdmissionPublicCas>): void {
  assertScopeAndPath(scope, cas?.publicPlanKey, cas?.publicSlotKey);
  if (!PUBLIC_KEY("batch").test(cas.expectedBatchId) || !PUBLIC_KEY("quote").test(cas.expectedQuoteKey)
    || !PUBLIC_KEY("render_spec").test(cas.expectedRenderSpecKey)
    || !Number.isSafeInteger(cas.expectedSlotAttempt) || cas.expectedSlotAttempt < 1
    || typeof cas.idempotencyKey !== "string" || cas.idempotencyKey !== cas.idempotencyKey.trim()
    || cas.idempotencyKey.length < 8 || cas.idempotencyKey.length > 200) {
    throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
  }
}
