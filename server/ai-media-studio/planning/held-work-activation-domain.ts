import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "./contracts";

declare const trustedActivationPrincipal: unique symbol;

/**
 * Capability issued by the caller's authorization boundary. The activation
 * repository validates and consumes this capability; it does not authenticate
 * an arbitrary actor identifier on its own.
 */
export interface TrustedActivationPrincipal {
  readonly capability: "activate-held-work";
  readonly actorUserId: string;
  readonly [trustedActivationPrincipal]: true;
}

export interface ActivateHeldWorkRequest {
  scope: TenantScope;
  budgetReservationId: string;
  workHandoffDigest: Sha256Digest;
  requestedBy: string;
  idempotencyKey: string;
  inputDigest: Sha256Digest;
  principal: TrustedActivationPrincipal;
}

export type UnsignedActivateHeldWorkRequest = Omit<ActivateHeldWorkRequest, "inputDigest" | "principal">;

export interface DurableWorkActivation {
  id: string;
  budgetReservationId: string;
  renderJobId: string;
  dispatchOutboxId: string;
  dailyPlanSlotId: string;
  slotAttempt: number;
  workHandoffDigest: Sha256Digest;
  sealedRequestDigest: Sha256Digest;
  activationDigest: Sha256Digest;
  activatedAt: string;
  slotStateVersionBefore: number;
  slotStateVersionAfter: number;
}

export interface ActivateHeldWorkResult {
  activation: DurableWorkActivation;
  replayed: boolean;
  effects: {
    renderQueued: boolean;
    outboxPending: boolean;
    slotQueued: boolean;
    budgetCommitted: false;
    providerCalled: false;
  };
}

export type HeldWorkActivationErrorCode =
  | "ACTIVATION_DENIED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVARIANT_VIOLATION"
  | "INVALID_INPUT";

export class HeldWorkActivationError extends Error {
  constructor(readonly code: HeldWorkActivationErrorCode, message: string) {
    super(message);
    this.name = "HeldWorkActivationError";
  }
}

export function heldWorkActivationInputDigest(input: UnsignedActivateHeldWorkRequest): Sha256Digest {
  return sha256(JSON.stringify(canonicalJson({ version: 1, ...input })));
}

export function heldWorkActivationEvidenceDigest(input: {
  request: ActivateHeldWorkRequest;
  activationId: string;
  renderJobId: string;
  dispatchOutboxId: string;
  dailyPlanSlotId: string;
  slotAttempt: number;
  authoritySnapshotId: string;
  authorityDigest: string;
  launchIntentId: string;
  launchIntentDigest: string;
  admissionDigest: string;
  sealedRequestDigest: string;
  providerIdempotencyKey: string;
  slotStateVersionBefore: number;
  slotStateVersionAfter: number;
  activatedAt: string;
}): Sha256Digest {
  return sha256(JSON.stringify(canonicalJson({ version: 1, ...input })));
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
