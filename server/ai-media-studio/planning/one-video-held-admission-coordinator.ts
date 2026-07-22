import { createHash } from "node:crypto";
import {
  oneVideoHeldAdmissionPathSchema,
  oneVideoHeldAdmissionRequestSchema,
  oneVideoHeldAdmissionResponseSchema,
} from "../../../shared/ai-media-studio-one-video-held-admission";
import {
  ONE_VIDEO_HELD_ADMISSION_OPERATION,
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionAuthorizer,
  type OneVideoHeldAdmissionCommand,
  type OneVideoHeldAdmissionContext,
  type OneVideoHeldAdmissionContextLoader,
  type OneVideoHeldAdmissionPrincipalAuthenticator,
  type OneVideoHeldAdmissionPublicCas,
  type OneVideoHeldAdmissionReceipt,
  type OneVideoHeldAdmissionRepository,
  type OneVideoHeldAdmissionSnapshotRepository,
} from "./one-video-held-admission-contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_MICRO_USD = /^[1-9][0-9]{0,15}$/u;
const MAXIMUM_MICRO_USD = 9_000_000_000_000_000n;

/**
 * Creates one durable reservation and immutable held work only after the
 * browser CAS has crossed both halves of the server-owned authorization
 * boundary. This coordinator has no provider, secret, fetch, activation,
 * worker, publishing, or external-spend dependency.
 */
export class OneVideoHeldAdmissionCoordinator {
  constructor(private readonly dependencies: Readonly<{
    authorizer: OneVideoHeldAdmissionAuthorizer;
    authenticator: OneVideoHeldAdmissionPrincipalAuthenticator;
    contextLoader: OneVideoHeldAdmissionContextLoader;
    snapshotRepository: OneVideoHeldAdmissionSnapshotRepository;
    admissionRepository: OneVideoHeldAdmissionRepository;
  }>) {
    if (!dependencies?.authorizer || !dependencies.authenticator || !dependencies.contextLoader
      || !dependencies.snapshotRepository || !dependencies.admissionRepository) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
  }

  async admit(command: OneVideoHeldAdmissionCommand): Promise<OneVideoHeldAdmissionReceipt> {
    const cas = parsePublicCas(command);
    const scope = command?.scope;
    if (!scope || scope.workspaceId !== "personal" || typeof scope.ownerUserId !== "string"
      || scope.ownerUserId.length < 1 || scope.ownerUserId.length > 255
      || scope.ownerUserId !== scope.ownerUserId.trim()) {
      throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
    }

    let authorization: Awaited<ReturnType<OneVideoHeldAdmissionAuthorizer["authorize"]>>;
    try {
      authorization = await this.dependencies.authorizer.authorize({
        authorizationContext: command.authorizationContext,
        operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
        scope,
        cas,
      });
    } catch {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    if (!authorization) throw new OneVideoHeldAdmissionError("FORBIDDEN");

    let principal;
    try {
      principal = await this.dependencies.authenticator.authenticate({
        context: authorization.heldAdmissionAuthenticationContext,
        operation: ONE_VIDEO_HELD_ADMISSION_OPERATION,
        scope,
        cas,
      });
    } catch {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    if (!principal || principal.operation !== ONE_VIDEO_HELD_ADMISSION_OPERATION
      || principal.subjectId !== scope.ownerUserId || !sameScope(principal.scope, scope)
      || !sameCas(principal.cas, cas)) {
      throw new OneVideoHeldAdmissionError("FORBIDDEN");
    }

    let context: OneVideoHeldAdmissionContext | undefined;
    try {
      context = await this.dependencies.contextLoader.load(scope, cas.publicPlanKey, cas.publicSlotKey);
    } catch (error) {
      throw safeDependencyError(error);
    }
    if (!context) throw new OneVideoHeldAdmissionError("NOT_FOUND");
    assertExactContext(context, scope, cas);

    let snapshot;
    try {
      snapshot = await this.dependencies.snapshotRepository.loadCurrent({ scope, context });
    } catch (error) {
      throw safeDependencyError(error);
    }
    if (!snapshot) throw new OneVideoHeldAdmissionError("ADMISSION_DENIED");
    if (!UUID.test(snapshot.authoritySnapshotId) || !SHA256.test(snapshot.authorityDigest)
      || !SHA256.test(snapshot.admissionDigest)
      || snapshot.dailyPlanSlotId !== context.dailyPlanSlotId
      || snapshot.slotAttempt !== context.slotAttempt) {
      throw new OneVideoHeldAdmissionError("STALE_OR_CONFLICT");
    }

    let result;
    try {
      result = await this.dependencies.admissionRepository.reserveHeld({
        scope,
        planId: context.planId,
        dailyPlanSlotId: context.dailyPlanSlotId,
        budgetBucketId: context.budgetBucketId,
        authoritySnapshotId: snapshot.authoritySnapshotId,
        authorityDigest: snapshot.authorityDigest,
        expectedSlotStateVersion: context.expectedSlotStateVersion,
        expectedBucketStateVersion: context.expectedBucketStateVersion,
        reservationExpiresAt: context.reservationExpiresAt,
        idempotencyKey: cas.idempotencyKey,
      });
    } catch (error) {
      throw safeDependencyError(error);
    }

    const created = !result.replayed;
    if (!UUID.test(result.reservationId)
      || result.amountMicroUsd !== context.maximumQuoteMicroUsd
      || canonicalInstant(result.expiresAt) !== context.reservationExpiresAt
      || result.state !== "held"
      || result.effects.externalSpendCommitted !== false
      || result.effects.providerCalled !== false
      || result.effects.internalBudgetReserved !== created
      || result.effects.heldRenderCreated !== created
      || result.effects.heldOutboxCreated !== created) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }

    return oneVideoHeldAdmissionResponseSchema.parse({
      outcome: result.replayed ? "replayed" : "admitted",
      admission: {
        planId: context.publicPlanKey,
        batchId: context.publicBatchKey,
        slotId: context.publicSlotKey,
        slotAttempt: context.slotAttempt,
        quoteKey: context.publicQuoteKey,
        renderSpecKey: context.publicRenderSpecKey,
        reservationKey: publicReservationKey(result.reservationId),
        maximumQuoteMicroUsd: context.maximumQuoteMicroUsd,
        currency: "USD",
        reservationExpiresAt: context.reservationExpiresAt,
        state: "held",
      },
      effects: {
        internal: {
          internalBudgetReserved: result.effects.internalBudgetReserved,
          heldRenderCreated: result.effects.heldRenderCreated,
          heldOutboxCreated: result.effects.heldOutboxCreated,
        },
        external: {
          secretResolved: false,
          providerCalled: false,
          verificationPerformed: false,
          quoteRequested: false,
          activationAuthorized: false,
          externalSpendCommitted: false,
          providerSubmissionStarted: false,
          renderSubmitted: false,
          renderArtifactCreated: false,
          publishingCreated: false,
        },
      },
      canGenerate: false,
      spendAuthorized: false,
    });
  }
}

function parsePublicCas(command: OneVideoHeldAdmissionCommand): Readonly<OneVideoHeldAdmissionPublicCas> {
  const path = oneVideoHeldAdmissionPathSchema.safeParse({
    planId: command?.publicPlanKey,
    slotId: command?.publicSlotKey,
  });
  const body = oneVideoHeldAdmissionRequestSchema.safeParse({
    expectedBatchId: command?.expectedBatchId,
    expectedQuoteKey: command?.expectedQuoteKey,
    expectedRenderSpecKey: command?.expectedRenderSpecKey,
    expectedSlotAttempt: command?.expectedSlotAttempt,
    idempotencyKey: command?.idempotencyKey,
  });
  if (!path.success || !body.success) throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
  return Object.freeze({
    publicPlanKey: path.data.planId,
    publicSlotKey: path.data.slotId,
    ...body.data,
  });
}

function assertExactContext(context: OneVideoHeldAdmissionContext, scope: OneVideoHeldAdmissionCommand["scope"],
  cas: Readonly<OneVideoHeldAdmissionPublicCas>): void {
  const quoteExpiry = canonicalInstant(context.quoteExpiresAt);
  const reservationExpiry = canonicalInstant(context.reservationExpiresAt);
  const validMoney = POSITIVE_MICRO_USD.test(context.maximumQuoteMicroUsd)
    && BigInt(context.maximumQuoteMicroUsd) <= MAXIMUM_MICRO_USD;
  if (!sameScope(context.scope, scope)
    || context.publicPlanKey !== cas.publicPlanKey || context.publicSlotKey !== cas.publicSlotKey
    || context.publicBatchKey !== cas.expectedBatchId || context.publicQuoteKey !== cas.expectedQuoteKey
    || context.publicRenderSpecKey !== cas.expectedRenderSpecKey || context.slotAttempt !== cas.expectedSlotAttempt
    || !UUID.test(context.planId) || !UUID.test(context.dailyPlanSlotId) || !UUID.test(context.budgetBucketId)
    || !Number.isSafeInteger(context.expectedSlotStateVersion) || context.expectedSlotStateVersion < 1
    || !Number.isSafeInteger(context.expectedBucketStateVersion) || context.expectedBucketStateVersion < 1
    || context.currency !== "USD" || !validMoney || !quoteExpiry || !reservationExpiry
    || Date.parse(reservationExpiry) > Date.parse(quoteExpiry)) {
    throw new OneVideoHeldAdmissionError("STALE_OR_CONFLICT");
  }
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : "";
}

function sameScope(left: OneVideoHeldAdmissionCommand["scope"], right: OneVideoHeldAdmissionCommand["scope"]): boolean {
  return Boolean(left && right && left.ownerUserId === right.ownerUserId && left.workspaceId === right.workspaceId);
}

function sameCas(left: Readonly<OneVideoHeldAdmissionPublicCas>, right: Readonly<OneVideoHeldAdmissionPublicCas>): boolean {
  return left.publicPlanKey === right.publicPlanKey && left.publicSlotKey === right.publicSlotKey
    && left.expectedBatchId === right.expectedBatchId && left.expectedQuoteKey === right.expectedQuoteKey
    && left.expectedRenderSpecKey === right.expectedRenderSpecKey
    && left.expectedSlotAttempt === right.expectedSlotAttempt && left.idempotencyKey === right.idempotencyKey;
}

function publicReservationKey(reservationId: string): string {
  return `reservation_${createHash("sha256").update(`ai-media-held-reservation-v1\0${reservationId}`)
    .digest("hex").slice(0, 24)}`;
}

function safeDependencyError(error: unknown): OneVideoHeldAdmissionError {
  if (error instanceof OneVideoHeldAdmissionError
    && ["NOT_FOUND", "STALE_OR_CONFLICT", "ADMISSION_DENIED"].includes(error.code)) return error;
  return new OneVideoHeldAdmissionError("UNAVAILABLE");
}
