import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedReconciliationClaim,
  ExactNegativeSubmissionFinality,
} from "./admitted-render-contracts";
import type {
  AdmittedCompletedTerminalFinality,
  AdmittedFailedTerminalFinality,
  AdmittedTerminalClaim,
  AdmittedTerminalFinalizeResult,
  AdmittedTerminalRetryReason,
} from "./admitted-render-terminal-worker";
import type {
  ExactOneVideoStageContext,
  OneVideoRunOnceAction,
} from "./one-video-run-once-executor";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface ExactReconcileTerminalDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}
export interface ExactReconcileTerminalTransactionalDatabase
  extends ExactReconcileTerminalDatabase {
  /** Resolves only after COMMIT; rejection includes deferred/commit-time failures. */
  transaction<T>(
    callback: (tx: ExactReconcileTerminalDatabase) => Promise<T>,
  ): Promise<T>;
}

export interface ExactReconciliationClaim extends AdmittedReconciliationClaim {
  /** Exact PR34 lease expiry; every finalizer is also rechecked against DB time. */
  reconciliationLeaseExpiresAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const RECONCILIATION_GUARD: unique symbol = Symbol("ai-media-exact-reconciliation-claim");
const TERMINAL_GUARD: unique symbol = Symbol("ai-media-exact-terminal-claim");

interface ExactContextIdentity {
  executionId: string;
  runLeaseToken: string;
  runFencingToken: bigint;
  commandDigest: Sha256Digest;
  actorUserId: string;
  scope: Readonly<TenantScope>;
  budgetReservationId: string;
  renderJobId: string;
  dailyPlanSlotId: string;
  slotAttempt: number;
  workHandoffDigest: Sha256Digest;
}

type GuardedReconciliationClaim = ExactReconciliationClaim & {
  readonly [RECONCILIATION_GUARD]: object;
};
type GuardedTerminalClaim = AdmittedTerminalClaim & {
  readonly [TERMINAL_GUARD]: object;
};

/**
 * Function-only adapter for the exact reconciliation and terminal-observation
 * stages. It cannot drain a tenant queue, submit to a provider, publish, or
 * mutate a table directly.
 */
export class DrizzleExactReconcileTerminalRepository {
  private readonly guard = Object.freeze({});
  private readonly reconciliationContexts =
    new WeakMap<object, ExactContextIdentity>();
  private readonly terminalContexts = new WeakMap<object, ExactContextIdentity>();

  constructor(
    private readonly db: ExactReconcileTerminalTransactionalDatabase,
    private readonly scope: TenantScope,
  ) {
    assertScope(scope);
  }

  async claimReconciliation(
    context: ExactOneVideoStageContext,
    input: { workerId: string; leaseDurationMs: number },
  ): Promise<ExactReconciliationClaim | undefined> {
    const identity = exactContextIdentity(context, this.scope, "reconcile_submission");
    assertWorkerLease(input);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${input.workerId}::text,${input.leaseDurationMs}::integer
    )`, row => {
      if (!row) return undefined;
      assertReturnedContext(row, identity, "reconciliation");
      const claim = brand(
        reconciliationClaimFrom(row),
        RECONCILIATION_GUARD,
        this.guard,
      );
      this.reconciliationContexts.set(claim, identity);
      return claim;
    });
  }

  async releaseReconciliationUnknown(
    context: ExactOneVideoStageContext,
    claim: ExactReconciliationClaim,
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "reconcile_submission");
    if (!this.isIssuedReconciliation(claim, identity)) {
      throw new Error("Exact reconciliation claim was not issued for this run");
    }
    assertReconciliationClaim(claim);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.id}::uuid,${claim.fencingToken}::bigint,
      ${claim.authorizationDigest}::text,${claim.reconciliationLeaseToken}::uuid,
      ${claim.reconciliationFencingToken}::bigint
    )`, row => exactBooleanMutation(row, identity, "reconciliation"));
  }

  async finalizeReconciliationConfirmed(
    context: ExactOneVideoStageContext,
    claim: ExactReconciliationClaim,
    outcome: {
      providerJobId: string;
      providerRequestId?: string;
      evidenceDigest: Sha256Digest;
    },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "reconcile_submission");
    if (!this.isIssuedReconciliation(claim, identity)) {
      throw new Error("Exact reconciliation claim was not issued for this run");
    }
    assertReconciliationClaim(claim);
    if (!boundedProviderId(outcome.providerJobId)
      || !optionalProviderId(outcome.providerRequestId)
      || !DIGEST.test(outcome.evidenceDigest)) {
      throw new Error("Invalid exact reconciled-confirmed outcome");
    }
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.id}::uuid,${claim.fencingToken}::bigint,
      ${claim.authorizationDigest}::text,${claim.reconciliationLeaseToken}::uuid,
      ${claim.reconciliationFencingToken}::bigint,${outcome.providerJobId}::text,
      ${outcome.providerRequestId ?? null}::text,${outcome.evidenceDigest}::text
    )`, row => exactBooleanMutation(row, identity, "reconciliation"));
  }

  async finalizeReconciledNoSubmit(
    context: ExactOneVideoStageContext,
    claim: ExactReconciliationClaim,
    finality: ExactNegativeSubmissionFinality,
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "reconcile_submission");
    if (!this.isIssuedReconciliation(claim, identity)) {
      throw new Error("Exact reconciliation claim was not issued for this run");
    }
    assertReconciliationClaim(claim);
    assertNegativeFinality(claim, finality);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.id}::uuid,${claim.fencingToken}::bigint,
      ${claim.authorizationDigest}::text,${claim.reconciliationLeaseToken}::uuid,
      ${claim.reconciliationFencingToken}::bigint,${finality.guarantee}::text,
      ${finality.providerAccountId}::uuid,${finality.providerKey}::text,
      ${finality.providerCredentialVersion}::integer,
      ${finality.providerIdempotencyKey}::text,
      ${new Date(finality.observedAt)}::timestamptz,${finality.evidenceDigest}::text
    )`, row => exactBooleanMutation(row, identity, "reconciliation"));
  }

  async claimTerminal(
    context: ExactOneVideoStageContext,
    input: { workerId: string; leaseDurationMs: number },
  ): Promise<AdmittedTerminalClaim | undefined> {
    const identity = exactContextIdentity(context, this.scope, "observe_terminal");
    assertWorkerLease(input);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${input.workerId}::text,${input.leaseDurationMs}::integer
    )`, row => {
      if (!row) return undefined;
      assertReturnedContext(row, identity, "terminal");
      const claim = brand(terminalClaimFrom(row), TERMINAL_GUARD, this.guard);
      this.terminalContexts.set(claim, identity);
      return claim;
    });
  }

  async releaseTerminalUnknown(
    context: ExactOneVideoStageContext,
    claim: AdmittedTerminalClaim,
    outcome: {
      reason: AdmittedTerminalRetryReason;
      observedAt: string;
      evidenceDigest: Sha256Digest;
    },
  ): Promise<boolean> {
    const identity = exactContextIdentity(context, this.scope, "observe_terminal");
    if (!this.isIssuedTerminal(claim, identity)) {
      throw new Error("Exact terminal claim was not issued for this run");
    }
    assertTerminalClaim(claim);
    assertTerminalRelease(outcome);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.terminalCheckId}::uuid,${claim.terminalLeaseToken}::uuid,
      ${claim.terminalFencingToken}::bigint,${outcome.reason}::text,
      ${new Date(outcome.observedAt)}::timestamptz,${outcome.evidenceDigest}::text
    )`, row => exactBooleanMutation(row, identity, "terminal"));
  }

  async finalizeTerminalCompleted(
    context: ExactOneVideoStageContext,
    claim: AdmittedTerminalClaim,
    finality: AdmittedCompletedTerminalFinality,
  ): Promise<AdmittedTerminalFinalizeResult> {
    return this.finalizeTerminal(context, claim, finality);
  }

  async finalizeTerminalFailed(
    context: ExactOneVideoStageContext,
    claim: AdmittedTerminalClaim,
    finality: AdmittedFailedTerminalFinality,
  ): Promise<AdmittedTerminalFinalizeResult> {
    return this.finalizeTerminal(context, claim, finality);
  }

  private async finalizeTerminal(
    context: ExactOneVideoStageContext,
    claim: AdmittedTerminalClaim,
    finality: AdmittedCompletedTerminalFinality | AdmittedFailedTerminalFinality,
  ): Promise<AdmittedTerminalFinalizeResult> {
    const identity = exactContextIdentity(context, this.scope, "observe_terminal");
    if (!this.isIssuedTerminal(claim, identity)) {
      throw new Error("Exact terminal claim was not issued for this run");
    }
    assertTerminalClaim(claim);
    assertTerminalFinality(finality);
    const completed = finality.kind === "completed";
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
      ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
      ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
      ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
      ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
      ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
      ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
      ${claim.terminalCheckId}::uuid,${claim.id}::uuid,
      ${claim.fencingToken}::bigint,${claim.terminalLeaseToken}::uuid,
      ${claim.terminalFencingToken}::bigint,${claim.authorizationDigest}::text,
      ${claim.providerAccountId}::uuid,${claim.providerKey}::text,
      ${claim.providerCredentialVersion}::integer,${claim.providerJobId}::text,
      ${finality.kind}::text,
      ${completed ? finality.remoteArtifactRef : null}::text,
      ${completed ? finality.ephemeralSourceUrl : null}::text,
      ${new Date(finality.observedAt)}::timestamptz,${finality.evidenceDigest}::text
    )`, row => exactTerminalMutation(row, identity));
  }

  private isIssuedReconciliation(
    claim: ExactReconciliationClaim,
    identity: ExactContextIdentity,
  ): claim is GuardedReconciliationClaim {
    return Boolean(claim
      && (claim as Partial<GuardedReconciliationClaim>)[RECONCILIATION_GUARD] === this.guard
      && sameContext(this.reconciliationContexts.get(claim as object), identity));
  }

  private isIssuedTerminal(
    claim: AdmittedTerminalClaim,
    identity: ExactContextIdentity,
  ): claim is GuardedTerminalClaim {
    return Boolean(claim
      && (claim as Partial<GuardedTerminalClaim>)[TERMINAL_GUARD] === this.guard
      && sameContext(this.terminalContexts.get(claim as object), identity));
  }
}

async function committedCall<T>(
  db: ExactReconcileTerminalTransactionalDatabase,
  query: SQL,
  decode: (row: Record<string, unknown> | undefined) => T,
): Promise<T> {
  return db.transaction(async tx => decode(exactOptionalRow(await tx.execute(query))));
}

function exactContextIdentity(
  context: ExactOneVideoStageContext,
  scope: TenantScope,
  action: Extract<OneVideoRunOnceAction, "reconcile_submission" | "observe_terminal">,
): ExactContextIdentity {
  if (!context || context.action !== action || !context.target
    || context.target.scope.ownerUserId !== scope.ownerUserId
    || context.target.scope.workspaceId !== scope.workspaceId
    || !UUID.test(context.lease?.executionId) || !UUID.test(context.lease?.leaseToken)
    || typeof context.lease?.fencingToken !== "bigint" || context.lease.fencingToken < 1n
    || context.lease.commandId !== context.commandId
    || context.lease.commandDigest !== context.commandDigest
    || !DIGEST.test(context.commandDigest) || !safePart(context.commandId, 160)
    || !safePart(context.actorUserId, 160)
    || !UUID.test(context.target.budgetReservationId)
    || !UUID.test(context.target.renderJobId)
    || !UUID.test(context.target.dailyPlanSlotId)
    || !Number.isSafeInteger(context.target.slotAttempt) || context.target.slotAttempt < 1
    || !DIGEST.test(context.target.workHandoffDigest)) {
    throw new Error(`Invalid ${action} exact run context`);
  }
  return Object.freeze({
    executionId: context.lease.executionId,
    runLeaseToken: context.lease.leaseToken,
    runFencingToken: context.lease.fencingToken,
    commandDigest: context.commandDigest,
    actorUserId: context.actorUserId,
    scope: Object.freeze({ ...scope }),
    budgetReservationId: context.target.budgetReservationId,
    renderJobId: context.target.renderJobId,
    dailyPlanSlotId: context.target.dailyPlanSlotId,
    slotAttempt: context.target.slotAttempt,
    workHandoffDigest: context.target.workHandoffDigest,
  });
}

function assertReturnedContext(
  row: Record<string, unknown>,
  expected: ExactContextIdentity,
  lane: "reconciliation" | "terminal",
): void {
  const actual: ExactContextIdentity = {
    executionId: dbUuid(row, "execution_id"),
    runLeaseToken: dbUuid(row, "run_lease_token"),
    runFencingToken: positiveBigInt(row.run_fencing_token, "run_fencing_token"),
    commandDigest: dbDigest(row, "command_digest"),
    actorUserId: boundedText(row.actor_user_id, 160, "actor_user_id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    dailyPlanSlotId: dbUuid(row, "daily_plan_slot_id"),
    slotAttempt: positive(row.slot_attempt),
    workHandoffDigest: dbDigest(row, "work_handoff_digest"),
  };
  if (!sameContext(actual, expected)) {
    throw new Error(`Exact ${lane} function returned another run target`);
  }
}

function sameContext(
  left: ExactContextIdentity | undefined,
  right: ExactContextIdentity,
): boolean {
  return Boolean(left
    && left.executionId === right.executionId
    && left.runLeaseToken === right.runLeaseToken
    && left.runFencingToken === right.runFencingToken
    && left.commandDigest === right.commandDigest
    && left.actorUserId === right.actorUserId
    && left.scope.ownerUserId === right.scope.ownerUserId
    && left.scope.workspaceId === right.scope.workspaceId
    && left.budgetReservationId === right.budgetReservationId
    && left.renderJobId === right.renderJobId
    && left.dailyPlanSlotId === right.dailyPlanSlotId
    && left.slotAttempt === right.slotAttempt
    && left.workHandoffDigest === right.workHandoffDigest);
}

function reconciliationClaimFrom(
  row: Record<string, unknown>,
): ExactReconciliationClaim {
  return {
    id: dbUuid(row, "id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    providerAccountId: dbUuid(row, "provider_account_id"),
    providerKey: boundedText(row.provider_key, 80, "provider_key"),
    providerCredentialVersion: positive(row.provider_credential_version),
    providerIdempotencyKey: boundedText(
      row.provider_idempotency_key,
      500,
      "provider_idempotency_key",
    ),
    avatarExternalResourceId: boundedText(
      row.avatar_external_resource_id,
      500,
      "avatar_external_resource_id",
    ),
    voiceExternalResourceId: boundedText(
      row.voice_external_resource_id,
      500,
      "voice_external_resource_id",
    ),
    sealedRequest: deepFreezeJsonObject(plainJsonObject(row.request_json)),
    sealedRequestDigest: dbDigest(row, "sealed_request_digest"),
    fencingToken: positiveBigInt(row.fencing_token, "submission_fencing_token"),
    authorizationDigest: dbDigest(row, "send_authorization_digest"),
    commitEvidenceDigest: dbDigest(row, "commit_evidence_digest"),
    authorizedAt: iso(row.authorized_at, "authorized_at"),
    reconciliationLeaseToken: dbUuid(row, "reconciliation_lease_token"),
    reconciliationLeaseOwner: boundedText(
      row.reconciliation_lease_owner,
      160,
      "reconciliation_lease_owner",
    ),
    reconciliationFencingToken: positiveBigInt(
      row.reconciliation_fencing_token,
      "reconciliation_fencing_token",
    ),
    reconciliationLeaseExpiresAt: iso(
      row.reconciliation_lease_expires_at,
      "reconciliation_lease_expires_at",
    ),
  };
}

function terminalClaimFrom(row: Record<string, unknown>): AdmittedTerminalClaim {
  return {
    terminalCheckId: dbUuid(row, "id"),
    id: dbUuid(row, "submission_attempt_id"),
    scope: returnedScope(row),
    budgetReservationId: dbUuid(row, "budget_reservation_id"),
    renderJobId: dbUuid(row, "render_job_id"),
    providerAccountId: dbUuid(row, "provider_account_id"),
    providerKey: boundedText(row.provider_key, 80, "provider_key"),
    providerCredentialVersion: positive(row.provider_credential_version),
    authorizationDigest: dbDigest(row, "send_authorization_digest"),
    fencingToken: positiveBigInt(row.submission_fencing_token, "submission_fencing_token"),
    providerJobId: boundedText(row.provider_job_id, 500, "provider_job_id"),
    terminalLeaseToken: dbUuid(row, "lease_token"),
    terminalLeaseExpiresAt: iso(row.lease_expires_at, "lease_expires_at"),
    terminalFencingToken: positiveBigInt(row.fencing_token, "terminal_fencing_token"),
  };
}

function assertReconciliationClaim(claim: ExactReconciliationClaim): void {
  assertScope(claim.scope);
  for (const [label, value] of [
    ["claim.id", claim.id],
    ["claim.budgetReservationId", claim.budgetReservationId],
    ["claim.renderJobId", claim.renderJobId],
    ["claim.providerAccountId", claim.providerAccountId],
    ["claim.reconciliationLeaseToken", claim.reconciliationLeaseToken],
  ] as const) assertUuid(value, label);
  if (!boundedString(claim.providerKey, 80)
    || !boundedString(claim.providerIdempotencyKey, 500)
    || !boundedString(claim.avatarExternalResourceId, 500)
    || !boundedString(claim.voiceExternalResourceId, 500)
    || !boundedString(claim.reconciliationLeaseOwner, 160)
    || !DIGEST.test(claim.sealedRequestDigest)
    || !DIGEST.test(claim.authorizationDigest)
    || !DIGEST.test(claim.commitEvidenceDigest)
    || claim.fencingToken < 1n
    || claim.reconciliationFencingToken < 1n
    || Number.isNaN(Date.parse(claim.authorizedAt))
    || Number.isNaN(Date.parse(claim.reconciliationLeaseExpiresAt))) {
    throw new Error("Invalid exact reconciliation claim");
  }
  plainJsonObject(claim.sealedRequest);
}

function assertNegativeFinality(
  claim: ExactReconciliationClaim,
  finality: ExactNegativeSubmissionFinality,
): void {
  if (!finality
    || finality.guarantee !== "linearizable_not_accepted_and_cannot_later_accept"
    || finality.scope.ownerUserId !== claim.scope.ownerUserId
    || finality.scope.workspaceId !== claim.scope.workspaceId
    || finality.providerAccountId !== claim.providerAccountId
    || finality.providerKey !== claim.providerKey
    || finality.providerCredentialVersion !== claim.providerCredentialVersion
    || finality.authorizationDigest !== claim.authorizationDigest
    || finality.providerIdempotencyKey !== claim.providerIdempotencyKey
    || !DIGEST.test(finality.evidenceDigest)
    || Number.isNaN(Date.parse(finality.observedAt))) {
    throw new Error("Negative finality does not match the exact reconciliation claim");
  }
}

function assertTerminalClaim(claim: AdmittedTerminalClaim): void {
  assertScope(claim.scope);
  for (const [label, value] of [
    ["claim.terminalCheckId", claim.terminalCheckId],
    ["claim.id", claim.id],
    ["claim.budgetReservationId", claim.budgetReservationId],
    ["claim.renderJobId", claim.renderJobId],
    ["claim.providerAccountId", claim.providerAccountId],
    ["claim.terminalLeaseToken", claim.terminalLeaseToken],
  ] as const) assertUuid(value, label);
  if (!boundedString(claim.providerKey, 80)
    || !boundedProviderId(claim.providerJobId)
    || !DIGEST.test(claim.authorizationDigest)
    || claim.fencingToken < 1n
    || claim.terminalFencingToken < 1n
    || Number.isNaN(Date.parse(claim.terminalLeaseExpiresAt))) {
    throw new Error("Invalid exact terminal claim");
  }
}

function assertTerminalRelease(input: {
  reason: AdmittedTerminalRetryReason;
  observedAt: string;
  evidenceDigest: Sha256Digest;
}): void {
  const reasons = new Set<AdmittedTerminalRetryReason>([
    "processing",
    "unknown",
    "provider_retryable_error",
    "invalid_terminal_observation",
    "capability_mismatch",
  ]);
  if (!reasons.has(input.reason)
    || Number.isNaN(Date.parse(input.observedAt))
    || !DIGEST.test(input.evidenceDigest)) {
    throw new Error("Invalid exact terminal release");
  }
}

function assertTerminalFinality(
  finality: AdmittedCompletedTerminalFinality | AdmittedFailedTerminalFinality,
): void {
  if (!finality || !DIGEST.test(finality.evidenceDigest)
    || Number.isNaN(Date.parse(finality.observedAt))
    || finality.releaseCapacity !== true) {
    throw new Error("Invalid exact terminal finality");
  }
  if (finality.kind === "completed") {
    if (finality.enqueueIngest !== true || finality.mediaType !== "video/mp4"
      || !boundedString(finality.remoteArtifactRef, 1_000)
      || !safeHttpsUrl(finality.ephemeralSourceUrl)) {
      throw new Error("Invalid exact completed terminal finality");
    }
    return;
  }
  if (finality.kind !== "failed" || finality.enqueueIngest !== false
    || (finality.failureMessageDigest !== undefined
      && !DIGEST.test(finality.failureMessageDigest))) {
    throw new Error("Invalid exact failed terminal finality");
  }
}

function exactBooleanMutation(
  row: Record<string, unknown> | undefined,
  identity: ExactContextIdentity,
  lane: "reconciliation" | "terminal",
): boolean {
  if (!row) return false;
  assertReturnedContext(row, identity, lane);
  if (typeof row.applied !== "boolean") {
    throw new Error(`Invalid exact ${lane} mutation result`);
  }
  return row.applied;
}

function exactTerminalMutation(
  row: Record<string, unknown> | undefined,
  identity: ExactContextIdentity,
): AdmittedTerminalFinalizeResult {
  if (!row) throw new Error("Invalid exact terminal mutation result");
  assertReturnedContext(row, identity, "terminal");
  if (row.outcome === "applied") return "applied";
  if (row.outcome === "replayed") return "duplicate";
  if (row.outcome === "conflict" || row.outcome === "rejected") return "conflict";
  throw new Error("Unknown exact terminal mutation outcome");
}

function exactOptionalRow(result: ExecuteResult): Record<string, unknown> | undefined {
  const value = Array.isArray(result)
    ? result
    : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(value) || value.length > 1
    || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Invalid exact reconcile/terminal capability function result");
  }
  return value[0] as Record<string, unknown> | undefined;
}

function brand<T extends object, K extends symbol>(
  value: T,
  key: K,
  guard: object,
): T & { readonly [P in K]: object } {
  Object.defineProperty(value, key, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: guard,
  });
  return Object.freeze(value) as T & { readonly [P in K]: object };
}

function returnedScope(row: Record<string, unknown>): TenantScope {
  const scope = {
    ownerUserId: boundedText(row.owner_user_id, 160, "owner_user_id"),
    workspaceId: boundedText(row.workspace_id, 160, "workspace_id"),
  };
  assertScope(scope);
  return scope;
}
function dbUuid(row: Record<string, unknown>, key: string): string {
  const value = boundedText(row[key], 36, key);
  assertUuid(value, key);
  return value;
}
function dbDigest(row: Record<string, unknown>, key: string): Sha256Digest {
  const value = boundedText(row[key], 71, key);
  if (!DIGEST.test(value)) throw new Error(`Invalid ${key}`);
  return value as Sha256Digest;
}
function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}`);
}
function assertScope(scope: TenantScope): void {
  if (!safePart(scope.ownerUserId, 160) || !safePart(scope.workspaceId, 160)) {
    throw new Error("Exact tenant scope is required");
  }
}
function assertWorkerLease(input: {
  workerId: string;
  leaseDurationMs: number;
}): void {
  if (!safePart(input.workerId, 120)
    || !Number.isInteger(input.leaseDurationMs)
    || input.leaseDurationMs < 1
    || input.leaseDurationMs > 300_000) {
    throw new Error("Invalid exact reconcile/terminal lease");
  }
}
function safePart(value: unknown, max: number): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= max
    && value === value.trim()
    && SAFE.test(value);
}
function boundedText(value: unknown, max: number, label: string): string {
  if (!boundedString(value, max) || value !== value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}
function boundedProviderId(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length >= 1
    && value.length <= 500;
}
function optionalProviderId(value: unknown): boolean {
  return value === undefined || boundedProviderId(value);
}
function positive(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Invalid positive integer");
  }
  return parsed;
}
function positiveBigInt(value: unknown, label: string): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 1n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}
function iso(value: unknown, label: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${label}`);
  return parsed.toISOString();
}
function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8_000 || /\s/u.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.hash;
  } catch {
    return false;
  }
}
function plainJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
    || !isJsonValue(value)) {
    throw new Error("Invalid sealed request JSON");
  }
  return value as Readonly<Record<string, unknown>>;
}
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every(isJsonValue);
}
function deepFreezeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  for (const item of Object.values(value)) {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      deepFreezeJson(item);
    }
  }
  return Object.freeze(value);
}
function deepFreezeJson(value: object): void {
  for (const item of Object.values(value)) {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      deepFreezeJson(item);
    }
  }
  Object.freeze(value);
}
