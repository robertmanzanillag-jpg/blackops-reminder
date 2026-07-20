export type RenderWorkState = "queued" | "leased" | "retry_wait" | "submitted" | "dead_letter";

export interface RenderWorkItem<TPayload = unknown> {
  id: string;
  tenantId: string;
  providerKey: string;
  payload: TPayload;
  state: RenderWorkState;
  attempt: number;
  maxAttempts: number;
  leaseRecoveries: number;
  maxLeaseRecoveries: number;
  availableAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAtMs?: number;
  providerSubmissionId?: string;
  lastError?: string;
  deadLetteredAtMs?: number;
}

export interface EnqueueRenderWork<TPayload> {
  id: string;
  tenantId: string;
  providerKey: string;
  payload: TPayload;
  maxAttempts: number;
  maxLeaseRecoveries?: number;
  availableAtMs?: number;
}

export interface RenderQuotaPolicy {
  maxConcurrentTotal?: number;
  maxConcurrentPerProvider: number;
  maxConcurrentPerTenant: number;
  providerLimits?: Readonly<Record<string, number>>;
  tenantLimits?: Readonly<Record<string, number>>;
}

export interface ClaimDueWorkOptions {
  workerId: string;
  nowMs: number;
  leaseDurationMs: number;
  quotas: RenderQuotaPolicy;
}

export interface ClaimedRenderWork<TPayload = unknown> {
  item: RenderWorkItem<TPayload>;
  leaseToken: string;
}

export interface LeaseRecovery {
  workId: string;
  previousOwner: string;
  attempt: number;
  deadLettered: boolean;
}

export interface RenderFailureResult<TPayload = unknown> {
  item: RenderWorkItem<TPayload>;
  deadLettered: boolean;
}

/**
 * Durable implementations must make claimDue and all lease-token mutations atomic.
 * The lease token is a fencing token: a stale worker must never be able to mutate
 * a work item after another worker has recovered its expired lease.
 */
export interface RenderWorkRepository<TPayload = unknown> {
  enqueue(input: EnqueueRenderWork<TPayload>, nowMs: number): Promise<RenderWorkItem<TPayload>>;
  get(id: string): Promise<RenderWorkItem<TPayload> | undefined>;
  claimDue(options: ClaimDueWorkOptions): Promise<ClaimedRenderWork<TPayload> | undefined>;
  markSubmitted(input: {
    workId: string;
    leaseToken: string;
    providerSubmissionId: string;
    nowMs: number;
  }): Promise<RenderWorkItem<TPayload> | undefined>;
  recordFailure(input: {
    workId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAtMs: number;
    nowMs: number;
  }): Promise<RenderFailureResult<TPayload> | undefined>;
  reconcileExpiredLeases(nowMs: number): Promise<LeaseRecovery[]>;
  listDeadLetters(): Promise<RenderWorkItem<TPayload>[]>;
  counts(): Promise<Record<RenderWorkState, number>>;
}

export interface ProviderSubmission {
  providerSubmissionId: string;
}

export interface RenderSubmissionProvider<TPayload = unknown> {
  readonly key: string;
  submit(payload: TPayload, context: {
    workId: string;
    tenantId: string;
    attempt: number;
    idempotencyKey: string;
  }): Promise<ProviderSubmission>;
}

export interface RenderWorkerHooks<TPayload = unknown> {
  onLeaseRecovered?(recovery: LeaseRecovery): void | Promise<void>;
  onSubmitted?(item: RenderWorkItem<TPayload>): void | Promise<void>;
  onRetryScheduled?(item: RenderWorkItem<TPayload>): void | Promise<void>;
  onDeadLetter?(item: RenderWorkItem<TPayload>): void | Promise<void>;
  onLeaseLost?(item: RenderWorkItem<TPayload>): void | Promise<void>;
}

export interface RenderClock {
  now(): number;
}

export type RenderRandom = () => number;
