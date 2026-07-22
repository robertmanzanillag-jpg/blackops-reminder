import {
  oneVideoHeldAdmissionReadinessReasonCodes,
  oneVideoHeldAdmissionReadinessSchema,
  type OneVideoHeldAdmissionReadiness,
} from "../../../shared/ai-media-studio-one-video-held-admission-readiness";
import type { TenantScope } from "../core/resource-domain";
import {
  OneVideoHeldAdmissionError,
  deriveOneVideoHeldAdmissionReservationKey,
  type OneVideoHeldAdmissionContext,
  type OneVideoHeldAdmissionContextLoader,
  type OneVideoHeldAdmissionExistingAttempt,
  type OneVideoHeldAdmissionReplayRepository,
  type OneVideoHeldAdmissionSnapshotRepository,
} from "./one-video-held-admission-contracts";

export type OneVideoHeldAdmissionGateObservation = "ready" | "missing" | "stale" | "blocked" | "unknown";

export interface OneVideoHeldAdmissionReadinessGates {
  readonly batch: OneVideoHeldAdmissionGateObservation;
  readonly slot: OneVideoHeldAdmissionGateObservation;
  readonly launchIntent: OneVideoHeldAdmissionGateObservation;
  readonly contentApproval: OneVideoHeldAdmissionGateObservation;
  readonly sandboxProof: OneVideoHeldAdmissionGateObservation;
  readonly policy: OneVideoHeldAdmissionGateObservation;
  readonly killSwitch: OneVideoHeldAdmissionGateObservation;
  readonly governance: OneVideoHeldAdmissionGateObservation;
  readonly credential: OneVideoHeldAdmissionGateObservation;
  readonly source: OneVideoHeldAdmissionGateObservation;
  readonly providerVerification: OneVideoHeldAdmissionGateObservation;
  readonly maximumQuote: OneVideoHeldAdmissionGateObservation;
  readonly humanApproval: OneVideoHeldAdmissionGateObservation;
  readonly budget: OneVideoHeldAdmissionGateObservation;
  readonly concurrency: OneVideoHeldAdmissionGateObservation;
}

export interface OneVideoHeldAdmissionObservedReservation {
  readonly reservationId: string;
  readonly dailyPlanSlotId: string;
  readonly budgetBucketId: string;
  readonly slotAttempt: number;
  readonly amountMicroUsd: string;
  readonly currency: "USD";
  readonly state: "reserved" | "committed" | "released" | "expired" | "settled";
  readonly submissionState: "not_started" | "dispatching" | "confirmed" | "ambiguous" | "reconciled_no_submit";
  readonly expiresAt: string;
}

export interface OneVideoHeldAdmissionReadinessObservation {
  /** PostgreSQL clock sampled by the same read-only observation query. */
  readonly observedAt: string;
  readonly gates: Readonly<OneVideoHeldAdmissionReadinessGates>;
  /** Zero or one is valid; more than one is an ambiguous durable attempt. */
  readonly reservations: readonly OneVideoHeldAdmissionObservedReservation[];
}

/**
 * Read-only DB observation. `budget` and `concurrency` are advisory snapshots;
 * the mutating admission transaction must lock and revalidate both.
 */
export interface OneVideoHeldAdmissionReadinessObservationRepository {
  observe(input: Readonly<{
    scope: TenantScope;
    context: OneVideoHeldAdmissionContext;
  }>): Promise<OneVideoHeldAdmissionReadinessObservation>;
}

type ReasonCode = (typeof oneVideoHeldAdmissionReadinessReasonCodes)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_KEY = (prefix: string) => new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u");
const EFFECTS = Object.freeze({
  providerCalled: false,
  secretResolved: false,
  externalSpendCommitted: false,
  renderArtifactCreated: false,
  publishingCreated: false,
} as const);

/**
 * Produces an authenticated read-only readiness projection. `available` means
 * only that every gate was observable at `observedAt`; it is never authority
 * and never bypasses the POST transaction's locks/CAS checks.
 */
export class OneVideoHeldAdmissionReadinessService {
  constructor(private readonly dependencies: Readonly<{
    contextLoader: OneVideoHeldAdmissionContextLoader;
    replayRepository: OneVideoHeldAdmissionReplayRepository;
    snapshotRepository: OneVideoHeldAdmissionSnapshotRepository;
    observationRepository: OneVideoHeldAdmissionReadinessObservationRepository;
  }>) {
    if (!dependencies?.contextLoader || !dependencies.replayRepository
      || !dependencies.snapshotRepository || !dependencies.observationRepository) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
  }

  async observe(
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
  ): Promise<OneVideoHeldAdmissionReadiness | undefined> {
    assertPublicInput(scope, publicPlanKey, publicSlotKey);
    let durableAttempt: OneVideoHeldAdmissionExistingAttempt | undefined;
    try {
      durableAttempt = await this.dependencies.replayRepository.observeExisting(scope, publicPlanKey, publicSlotKey);
    } catch (error) {
      throw safeError(error);
    }
    if (durableAttempt) return projectDurableAttempt(durableAttempt, scope, publicPlanKey, publicSlotKey);

    let context: OneVideoHeldAdmissionContext | undefined;
    try {
      context = await this.dependencies.contextLoader.load(scope, publicPlanKey, publicSlotKey);
    } catch (error) {
      throw safeError(error);
    }
    if (!context) return undefined;
    assertContext(context, scope, publicPlanKey, publicSlotKey);

    let observation: OneVideoHeldAdmissionReadinessObservation;
    try {
      observation = await this.dependencies.observationRepository.observe({ scope, context });
    } catch {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    const observedAt = canonicalInstant(observation?.observedAt);
    if (!observedAt || !observation?.gates || !Array.isArray(observation.reservations)) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }

    const subject = Object.freeze({
      planId: context.publicPlanKey,
      batchId: context.publicBatchKey,
      slotId: context.publicSlotKey,
      slotAttempt: context.slotAttempt,
    });
    if (observation.reservations.length > 1) {
      return blocked(subject, observedAt, ["existing_attempt", "observation_unavailable"]);
    }
    const existing = observation.reservations[0];
    if (existing) {
      const projected = projectExistingReservation(context, existing, observedAt);
      if (projected) {
        return oneVideoHeldAdmissionReadinessSchema.parse({
          version: 1,
          source: "postgresql_read_only",
          subject,
          observedAt,
          state: projected.state,
          postAvailable: false,
          reasonCodes: [],
          currentReservation: projected,
          effects: EFFECTS,
          canGenerate: false,
          spendAuthorized: false,
        });
      }
      return blocked(subject, observedAt, ["existing_attempt"]);
    }

    let snapshot;
    try {
      snapshot = await this.dependencies.snapshotRepository.loadCurrent({ scope, context });
    } catch (error) {
      throw safeError(error);
    }
    const reasons = gateReasons(observation.gates);
    if (!snapshot) reasons.push("authority_snapshot_missing");
    else if (snapshot.dailyPlanSlotId !== context.dailyPlanSlotId
      || snapshot.slotAttempt !== context.slotAttempt
      || !UUID.test(snapshot.authoritySnapshotId)
      || !/^sha256:[a-f0-9]{64}$/u.test(snapshot.authorityDigest)
      || !/^sha256:[a-f0-9]{64}$/u.test(snapshot.admissionDigest)) {
      reasons.push("authority_snapshot_stale");
    }

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length > 0) return blocked(subject, observedAt, uniqueReasons);
    return oneVideoHeldAdmissionReadinessSchema.parse({
      version: 1,
      source: "postgresql_read_only",
      subject,
      observedAt,
      state: "available",
      postAvailable: true,
      reasonCodes: [],
      cas: {
        expectedBatchId: context.publicBatchKey,
        expectedQuoteKey: context.publicQuoteKey,
        expectedRenderSpecKey: context.publicRenderSpecKey,
        expectedSlotAttempt: context.slotAttempt,
      },
      effects: EFFECTS,
      canGenerate: false,
      spendAuthorized: false,
    });
  }
}

function gateReasons(gates: Readonly<OneVideoHeldAdmissionReadinessGates>): ReasonCode[] {
  const definitions: readonly [keyof OneVideoHeldAdmissionReadinessGates, ReasonCode, ReasonCode][] = [
    ["batch", "batch_not_approved", "batch_changed"],
    ["slot", "slot_not_approved", "slot_attempt_changed"],
    ["launchIntent", "launch_intent_missing", "launch_intent_stale"],
    ["contentApproval", "content_approval_missing", "content_approval_stale"],
    ["sandboxProof", "sandbox_proof_missing", "sandbox_proof_stale"],
    ["policy", "policy_inactive", "policy_stale"],
    ["killSwitch", "kill_switch_active", "kill_switch_active"],
    ["governance", "governance_stale", "governance_stale"],
    ["credential", "credential_stale", "credential_stale"],
    ["source", "source_stale", "source_stale"],
    ["providerVerification", "provider_verification_missing", "provider_verification_stale"],
    ["maximumQuote", "maximum_quote_missing", "maximum_quote_stale"],
    ["humanApproval", "human_approval_missing", "human_approval_stale"],
    ["budget", "budget_unavailable", "budget_unavailable"],
    ["concurrency", "concurrency_unavailable", "concurrency_unavailable"],
  ];
  const reasons: ReasonCode[] = [];
  for (const [name, missing, stale] of definitions) {
    const state = gates[name];
    if (state === "ready") continue;
    if (state === "unknown" || !["missing", "stale", "blocked"].includes(state)) {
      reasons.push("observation_unavailable");
    } else {
      reasons.push(state === "stale" ? stale : missing);
    }
  }
  return reasons;
}

function projectExistingReservation(
  context: OneVideoHeldAdmissionContext,
  reservation: OneVideoHeldAdmissionObservedReservation,
  observedAt: string,
): Readonly<{
  reservationKey: string;
  maximumQuoteMicroUsd: string;
  currency: "USD";
  expiresAt: string;
  state: "held" | "expired";
}> | undefined {
  const expiresAt = canonicalInstant(reservation.expiresAt);
  if (!UUID.test(reservation.reservationId)
    || reservation.dailyPlanSlotId !== context.dailyPlanSlotId
    || reservation.budgetBucketId !== context.budgetBucketId
    || reservation.slotAttempt !== context.slotAttempt
    || reservation.amountMicroUsd !== context.maximumQuoteMicroUsd
    || reservation.currency !== "USD"
    || !expiresAt) return undefined;
  const expired = Date.parse(expiresAt) <= Date.parse(observedAt);
  const state = reservation.state === "expired" || (reservation.state === "reserved" && expired)
    ? "expired"
    : reservation.state === "reserved" && reservation.submissionState === "not_started" && !expired
      ? "held"
      : undefined;
  if (!state) return undefined;
  return Object.freeze({
    reservationKey: deriveOneVideoHeldAdmissionReservationKey(reservation.reservationId),
    maximumQuoteMicroUsd: reservation.amountMicroUsd,
    currency: "USD",
    expiresAt,
    state,
  });
}

function blocked(
  subject: Readonly<{ planId: string; batchId: string; slotId: string; slotAttempt: number }>,
  observedAt: string,
  reasonCodes: readonly ReasonCode[],
): OneVideoHeldAdmissionReadiness {
  return oneVideoHeldAdmissionReadinessSchema.parse({
    version: 1,
    source: "postgresql_read_only",
    subject,
    observedAt,
    state: "blocked",
    postAvailable: false,
    reasonCodes: [...new Set(reasonCodes)],
    effects: EFFECTS,
    canGenerate: false,
    spendAuthorized: false,
  });
}

function assertPublicInput(scope: TenantScope, planId: string, slotId: string): void {
  if (!scope || typeof scope.ownerUserId !== "string" || scope.ownerUserId !== scope.ownerUserId.trim()
    || scope.ownerUserId.length < 1 || scope.ownerUserId.length > 255
    || scope.workspaceId !== "personal"
    || !PUBLIC_KEY("plan").test(planId) || !PUBLIC_KEY("slot").test(slotId)) {
    throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
  }
}

function assertContext(context: OneVideoHeldAdmissionContext, scope: TenantScope, planId: string, slotId: string): void {
  if (context.scope.ownerUserId !== scope.ownerUserId || context.scope.workspaceId !== scope.workspaceId
    || context.publicPlanKey !== planId || context.publicSlotKey !== slotId
    || !PUBLIC_KEY("batch").test(context.publicBatchKey)
    || !PUBLIC_KEY("quote").test(context.publicQuoteKey)
    || !PUBLIC_KEY("render_spec").test(context.publicRenderSpecKey)
    || !UUID.test(context.planId) || !UUID.test(context.dailyPlanSlotId) || !UUID.test(context.budgetBucketId)
    || !Number.isSafeInteger(context.slotAttempt) || context.slotAttempt < 1
    || !/^[1-9]\d{0,15}$/u.test(context.maximumQuoteMicroUsd)
    || BigInt(context.maximumQuoteMicroUsd) > 9_000_000_000_000_000n
    || context.currency !== "USD" || !canonicalInstant(context.quoteExpiresAt)
    || !canonicalInstant(context.reservationExpiresAt)
    || Date.parse(context.reservationExpiresAt) > Date.parse(context.quoteExpiresAt)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : "";
}

function projectDurableAttempt(
  attempt: OneVideoHeldAdmissionExistingAttempt,
  scope: TenantScope,
  publicPlanKey: string,
  publicSlotKey: string,
): OneVideoHeldAdmissionReadiness {
  const observedAt = canonicalInstant(attempt.observedAt);
  const expiresAt = canonicalInstant(attempt.expiresAt);
  const subject = Object.freeze({
    planId: attempt.publicPlanKey,
    batchId: attempt.publicBatchKey,
    slotId: attempt.publicSlotKey,
    slotAttempt: attempt.slotAttempt,
  });
  if (scope.workspaceId !== "personal" || attempt.ownerUserId !== scope.ownerUserId
    || attempt.workspaceId !== scope.workspaceId || attempt.publicPlanKey !== publicPlanKey
    || attempt.publicSlotKey !== publicSlotKey || !PUBLIC_KEY("batch").test(attempt.publicBatchKey)
    || !PUBLIC_KEY("quote").test(attempt.publicQuoteKey)
    || !PUBLIC_KEY("render_spec").test(attempt.publicRenderSpecKey)
    || !Number.isSafeInteger(attempt.slotAttempt) || attempt.slotAttempt < 1
    || !UUID.test(attempt.reservationId) || !observedAt || !expiresAt
    || !/^[1-9]\d{0,15}$/u.test(attempt.maximumQuoteMicroUsd)
    || BigInt(attempt.maximumQuoteMicroUsd) > 9_000_000_000_000_000n
    || attempt.currency !== "USD" || !["held", "expired", "blocked"].includes(attempt.state)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
  if (attempt.state === "blocked") return blocked(subject, observedAt, ["existing_attempt"]);
  if ((attempt.state === "held") !== (Date.parse(expiresAt) > Date.parse(observedAt))) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
  return oneVideoHeldAdmissionReadinessSchema.parse({
    version: 1,
    source: "postgresql_read_only",
    subject,
    observedAt,
    state: attempt.state,
    postAvailable: false,
    reasonCodes: [],
    currentReservation: {
      reservationKey: deriveOneVideoHeldAdmissionReservationKey(attempt.reservationId),
      maximumQuoteMicroUsd: attempt.maximumQuoteMicroUsd,
      currency: "USD",
      expiresAt,
      state: attempt.state,
    },
    effects: EFFECTS,
    canGenerate: false,
    spendAuthorized: false,
  });
}

function safeError(error: unknown): OneVideoHeldAdmissionError {
  return error instanceof OneVideoHeldAdmissionError
    && ["INVALID_REQUEST", "NOT_FOUND", "STALE_OR_CONFLICT"].includes(error.code)
    ? error : new OneVideoHeldAdmissionError("UNAVAILABLE");
}
