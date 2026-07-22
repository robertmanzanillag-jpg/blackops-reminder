import {
  DailyAdmissionPersistenceError,
  type DrizzleDailyAdmissionRepository,
  type ReserveAndAdmitResult,
  type UnsignedReserveAndAdmitRequest,
} from "./drizzle-daily-admission-repository";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionPersistenceRequest,
  type OneVideoHeldAdmissionPersistenceResult,
  type OneVideoHeldAdmissionRepository,
} from "./one-video-held-admission-contracts";

type DailyAdmissionRepositoryPort = Pick<
  DrizzleDailyAdmissionRepository,
  "inputDigest" | "reserveAndAdmit"
>;

/**
 * Narrow adapter over the reviewed atomic daily-admission repository. It can
 * reserve budget and create immutable held work only; it has no provider,
 * secret, fetch, activation, submission, publishing or external-spend port.
 */
export class DrizzleOneVideoHeldAdmissionRepository implements OneVideoHeldAdmissionRepository {
  constructor(private readonly repository: DailyAdmissionRepositoryPort) {
    if (!repository
      || typeof repository.inputDigest !== "function"
      || typeof repository.reserveAndAdmit !== "function") {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
  }

  async reserveHeld(
    input: Readonly<OneVideoHeldAdmissionPersistenceRequest>,
  ): Promise<OneVideoHeldAdmissionPersistenceResult> {
    try {
      const unsigned: UnsignedReserveAndAdmitRequest = Object.freeze({
        scope: Object.freeze({
          ownerUserId: input.scope.ownerUserId,
          workspaceId: input.scope.workspaceId,
        }),
        planId: input.planId,
        slotId: input.dailyPlanSlotId,
        budgetBucketId: input.budgetBucketId,
        authoritySnapshotId: input.authoritySnapshotId,
        authorityDigest: input.authorityDigest,
        expectedSlotStateVersion: input.expectedSlotStateVersion,
        expectedBucketStateVersion: input.expectedBucketStateVersion,
        reservationExpiresAt: input.reservationExpiresAt,
        idempotencyKey: input.idempotencyKey,
      });
      const inputDigest = this.repository.inputDigest(unsigned);
      const result = await this.repository.reserveAndAdmit(Object.freeze({ ...unsigned, inputDigest }));
      assertExactHeldResult(result, unsigned, inputDigest);
      const created = !result.replayed;
      return Object.freeze({
        reservationId: result.reservation.id,
        amountMicroUsd: result.reservation.amountMicroUsd,
        expiresAt: result.reservation.expiresAt,
        state: "held",
        replayed: result.replayed,
        effects: Object.freeze({
          internalBudgetReserved: created,
          heldRenderCreated: result.effects.renderJobCreated,
          heldOutboxCreated: result.effects.outboxCreated,
          externalSpendCommitted: false,
          providerCalled: false,
        }),
      });
    } catch (error) {
      if (error instanceof OneVideoHeldAdmissionError) throw error;
      if (error instanceof DailyAdmissionPersistenceError) {
        throw new OneVideoHeldAdmissionError(
          error.code === "ADMISSION_DENIED" ? "ADMISSION_DENIED"
            : error.code === "IDEMPOTENCY_CONFLICT" ? "STALE_OR_CONFLICT"
              : error.code === "INVALID_INPUT" ? "INVALID_REQUEST"
                : "UNAVAILABLE",
        );
      }
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
  }
}

function assertExactHeldResult(
  result: ReserveAndAdmitResult,
  request: UnsignedReserveAndAdmitRequest,
  inputDigest: `sha256:${string}`,
): void {
  const reservation = result?.reservation;
  const created = result?.replayed === false;
  const replayed = result?.replayed === true;
  if ((!created && !replayed)
    || !validDigest(inputDigest)
    || !reservation
    || reservation.state !== "reserved"
    || reservation.submissionState !== "not_started"
    || reservation.slotId !== request.slotId
    || reservation.bucketId !== request.budgetBucketId
    || reservation.expiresAt !== request.reservationExpiresAt
    || reservation.idempotencyKey !== request.idempotencyKey
    || reservation.inputDigest !== inputDigest
    || !validUuid(reservation.id)
    || !validUuid(reservation.renderJobId)
    || !validUuid(reservation.dispatchOutboxId)
    || !validDigest(reservation.admissionDigest)
    || !validDigest(reservation.workHandoffDigest)
    || !Number.isInteger(reservation.attempt)
    || reservation.attempt < 1
    || !validPositiveMicroUsd(reservation.amountMicroUsd)
    || typeof result.effects !== "object"
    || result.effects === null
    || result.effects.providerCalled !== false
    || result.effects.eventCreated !== false
    || result.effects.renderJobCreated !== created
    || result.effects.outboxCreated !== created) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
}

function validPositiveMicroUsd(value: unknown): value is string {
  return typeof value === "string"
    && /^[1-9]\d{0,15}$/u.test(value)
    && BigInt(value) <= 9_000_000_000_000_000n;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function validDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
