import { createHash } from "node:crypto";
import type { OneVideoHeldAdmissionResponse } from "../../../shared/ai-media-studio-one-video-held-admission";
import type { TenantScope } from "../core/resource-domain";

export const ONE_VIDEO_HELD_ADMISSION_OPERATION = "one_video_held_admission:create" as const;
export type OneVideoHeldAdmissionOperation = typeof ONE_VIDEO_HELD_ADMISSION_OPERATION;

export type OneVideoHeldAdmissionErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE_OR_CONFLICT"
  | "ADMISSION_DENIED"
  | "UNAVAILABLE";

export class OneVideoHeldAdmissionError extends Error {
  readonly statusCode: number;

  constructor(readonly code: OneVideoHeldAdmissionErrorCode) {
    super("One-video held admission request could not be completed");
    this.name = "OneVideoHeldAdmissionError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "UNAUTHENTICATED" ? 401
        : code === "FORBIDDEN" ? 403
          : code === "NOT_FOUND" ? 404
            : code === "STALE_OR_CONFLICT" ? 409
              : code === "ADMISSION_DENIED" ? 422
                : 503;
  }
}

export interface OneVideoHeldAdmissionPublicCas {
  readonly publicPlanKey: string;
  readonly publicSlotKey: string;
  readonly expectedBatchId: string;
  readonly expectedQuoteKey: string;
  readonly expectedRenderSpecKey: string;
  readonly expectedSlotAttempt: number;
  readonly idempotencyKey: string;
}

declare const trustedOneVideoHeldAdmissionPrincipalBrand: unique symbol;

/** Minted only by the paired server-owned authenticator. */
export interface TrustedOneVideoHeldAdmissionPrincipal {
  readonly operation: OneVideoHeldAdmissionOperation;
  readonly subjectId: string;
  readonly scope: TenantScope;
  readonly cas: Readonly<OneVideoHeldAdmissionPublicCas>;
  readonly [trustedOneVideoHeldAdmissionPrincipalBrand]: true;
}

export type OneVideoHeldAdmissionAuthenticationContext = unknown;

/**
 * The HTTP request can be inspected only by this server-owned boundary. It is
 * never itself accepted as an admission principal or persistence command.
 */
export interface OneVideoHeldAdmissionAuthorizer {
  authorize(input: Readonly<{
    authorizationContext: unknown;
    operation: OneVideoHeldAdmissionOperation;
    scope: TenantScope;
    cas: Readonly<OneVideoHeldAdmissionPublicCas>;
  }>): Promise<Readonly<{
    heldAdmissionAuthenticationContext: OneVideoHeldAdmissionAuthenticationContext;
  }> | undefined>;
}

export interface OneVideoHeldAdmissionPrincipalAuthenticator {
  authenticate(input: Readonly<{
    context: OneVideoHeldAdmissionAuthenticationContext;
    operation: OneVideoHeldAdmissionOperation;
    scope: TenantScope;
    cas: Readonly<OneVideoHeldAdmissionPublicCas>;
  }>): Promise<TrustedOneVideoHeldAdmissionPrincipal | undefined>;
}

/**
 * Server-owned subject resolved from the public plan/slot keys. Internal IDs,
 * money, expiry and state versions must never come from the browser command.
 */
export interface OneVideoHeldAdmissionContext {
  readonly scope: TenantScope;
  readonly planId: string;
  readonly dailyPlanSlotId: string;
  readonly budgetBucketId: string;
  readonly publicPlanKey: string;
  readonly publicBatchKey: string;
  readonly publicSlotKey: string;
  readonly publicQuoteKey: string;
  readonly publicRenderSpecKey: string;
  readonly slotAttempt: number;
  readonly expectedSlotStateVersion: number;
  readonly expectedBucketStateVersion: number;
  readonly maximumQuoteMicroUsd: string;
  readonly currency: "USD";
  readonly quoteExpiresAt: string;
  readonly reservationExpiresAt: string;
}

export interface OneVideoHeldAdmissionContextLoader {
  load(
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
  ): Promise<OneVideoHeldAdmissionContext | undefined>;
}

/**
 * A server-validated projection of one durable attempt. Internal identifiers
 * remain inside the planning layer and are converted to opaque public keys at
 * the response boundary.
 */
export interface OneVideoHeldAdmissionExistingAttempt {
  readonly ownerUserId: string;
  readonly workspaceId: "personal";
  readonly observedAt: string;
  readonly publicPlanKey: string;
  readonly publicBatchKey: string;
  readonly publicSlotKey: string;
  readonly publicQuoteKey: string;
  readonly publicRenderSpecKey: string;
  readonly slotAttempt: number;
  readonly idempotencyKey: string;
  readonly reservationId: string;
  readonly maximumQuoteMicroUsd: string;
  readonly currency: "USD";
  readonly expiresAt: string;
  readonly state: "held" | "expired" | "blocked";
}

/** Read-only replay/existing-attempt boundary; it never creates or activates work. */
export interface OneVideoHeldAdmissionReplayRepository {
  observeExisting(
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
  ): Promise<OneVideoHeldAdmissionExistingAttempt | undefined>;
  loadExactReplay(
    scope: TenantScope,
    cas: Readonly<OneVideoHeldAdmissionPublicCas>,
  ): Promise<OneVideoHeldAdmissionExistingAttempt | undefined>;
}

/** Exact, current authority snapshot selected under server ownership. */
export interface OneVideoHeldAdmissionAuthoritySnapshot {
  readonly authoritySnapshotId: string;
  readonly authorityDigest: `sha256:${string}`;
  readonly admissionDigest: `sha256:${string}`;
  readonly dailyPlanSlotId: string;
  readonly slotAttempt: number;
}

export interface OneVideoHeldAdmissionSnapshotRepository {
  loadCurrent(input: Readonly<{
    scope: TenantScope;
    context: OneVideoHeldAdmissionContext;
  }>): Promise<OneVideoHeldAdmissionAuthoritySnapshot | undefined>;
}

export interface OneVideoHeldAdmissionPersistenceRequest {
  readonly scope: TenantScope;
  readonly planId: string;
  readonly dailyPlanSlotId: string;
  readonly budgetBucketId: string;
  readonly authoritySnapshotId: string;
  readonly authorityDigest: `sha256:${string}`;
  readonly expectedSlotStateVersion: number;
  readonly expectedBucketStateVersion: number;
  readonly reservationExpiresAt: string;
  readonly idempotencyKey: string;
}

export interface OneVideoHeldAdmissionPersistenceResult {
  readonly reservationId: string;
  readonly amountMicroUsd: string;
  readonly expiresAt: string;
  readonly state: "held";
  readonly replayed: boolean;
  readonly effects: Readonly<{
    internalBudgetReserved: boolean;
    heldRenderCreated: boolean;
    heldOutboxCreated: boolean;
    externalSpendCommitted: false;
    providerCalled: false;
  }>;
}

/** Adapter boundary around the durable atomic reservation plus held work. */
export interface OneVideoHeldAdmissionRepository {
  reserveHeld(
    input: Readonly<OneVideoHeldAdmissionPersistenceRequest>,
  ): Promise<OneVideoHeldAdmissionPersistenceResult>;
}

export interface OneVideoHeldAdmissionCommand extends OneVideoHeldAdmissionPublicCas {
  readonly scope: TenantScope;
  readonly authorizationContext: unknown;
}

export type OneVideoHeldAdmissionReceipt = OneVideoHeldAdmissionResponse;

/** One canonical opaque reservation key shared by POST replay and GET readiness. */
export function deriveOneVideoHeldAdmissionReservationKey(reservationId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(reservationId)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
  return `reservation_${createHash("sha256").update(`ai-media-held-reservation-v1\0${reservationId}`)
    .digest("hex").slice(0, 24)}`;
}
