import type {
  ClaimedRenderWork,
  ClaimDueWorkOptions,
  EnqueueRenderWork,
  LeaseRecovery,
  RenderFailureResult,
  RenderWorkItem,
  RenderWorkRepository,
  RenderWorkState,
} from "./contracts";

function copy<TPayload>(item: RenderWorkItem<TPayload>): RenderWorkItem<TPayload> {
  return { ...item };
}

function quotaLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Deterministic process-local reference implementation of the atomic repository contract. */
export class InMemoryRenderWorkRepository<TPayload = unknown> implements RenderWorkRepository<TPayload> {
  private readonly items = new Map<string, RenderWorkItem<TPayload>>();
  private leaseSequence = 0;

  async enqueue(input: EnqueueRenderWork<TPayload>, nowMs: number): Promise<RenderWorkItem<TPayload>> {
    const existing = this.items.get(input.id);
    if (existing) return copy(existing);
    if (!input.id || !input.tenantId || !input.providerKey) throw new Error("Render work identity is required");
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
    const maxLeaseRecoveries = input.maxLeaseRecoveries ?? input.maxAttempts;
    if (!Number.isInteger(maxLeaseRecoveries) || maxLeaseRecoveries < 1) throw new Error("maxLeaseRecoveries must be a positive integer");
    const item: RenderWorkItem<TPayload> = {
      id: input.id,
      tenantId: input.tenantId,
      providerKey: input.providerKey,
      payload: input.payload,
      state: "queued",
      attempt: 1,
      maxAttempts: input.maxAttempts,
      leaseRecoveries: 0,
      maxLeaseRecoveries,
      availableAtMs: input.availableAtMs ?? nowMs,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    this.items.set(item.id, item);
    return copy(item);
  }

  async get(id: string): Promise<RenderWorkItem<TPayload> | undefined> {
    const item = this.items.get(id);
    return item ? copy(item) : undefined;
  }

  async claimDue(options: ClaimDueWorkOptions): Promise<ClaimedRenderWork<TPayload> | undefined> {
    if (!options.workerId || options.leaseDurationMs <= 0) throw new Error("A worker and positive lease duration are required");
    const leased = [...this.items.values()].filter((item) => item.state === "leased" && (item.leaseExpiresAtMs ?? 0) > options.nowMs);
    const totalLimit = quotaLimit(options.quotas.maxConcurrentTotal, Number.POSITIVE_INFINITY);
    if (leased.length >= totalLimit) return undefined;

    const due = [...this.items.values()]
      .filter((item) => (item.state === "queued" || item.state === "retry_wait") && item.availableAtMs <= options.nowMs)
      .sort((a, b) => a.availableAtMs - b.availableAtMs || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));

    const candidate = due.find((item) => {
      const providerCount = leased.filter((lease) => lease.providerKey === item.providerKey).length;
      const tenantCount = leased.filter((lease) => lease.tenantId === item.tenantId).length;
      const providerLimit = quotaLimit(options.quotas.providerLimits?.[item.providerKey], quotaLimit(options.quotas.maxConcurrentPerProvider, 0));
      const tenantLimit = quotaLimit(options.quotas.tenantLimits?.[item.tenantId], quotaLimit(options.quotas.maxConcurrentPerTenant, 0));
      return providerCount < providerLimit && tenantCount < tenantLimit;
    });
    if (!candidate) return undefined;

    const leaseToken = `${options.workerId}:lease:${++this.leaseSequence}`;
    candidate.state = "leased";
    candidate.leaseOwner = options.workerId;
    candidate.leaseToken = leaseToken;
    candidate.leaseExpiresAtMs = options.nowMs + options.leaseDurationMs;
    candidate.updatedAtMs = options.nowMs;
    return { item: copy(candidate), leaseToken };
  }

  async markSubmitted(input: {
    workId: string;
    leaseToken: string;
    providerSubmissionId: string;
    providerAccountId: string;
    nowMs: number;
  }): Promise<RenderWorkItem<TPayload> | undefined> {
    const item = this.activeLease(input.workId, input.leaseToken, input.nowMs);
    if (!item) return undefined;
    item.state = "submitted";
    item.providerSubmissionId = input.providerSubmissionId;
    item.providerAccountId = input.providerAccountId;
    item.updatedAtMs = input.nowMs;
    this.clearLease(item);
    return copy(item);
  }

  async recordFailure(input: {
    workId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAtMs: number;
    nowMs: number;
  }): Promise<RenderFailureResult<TPayload> | undefined> {
    const item = this.activeLease(input.workId, input.leaseToken, input.nowMs);
    if (!item) return undefined;
    item.lastError = input.error;
    item.updatedAtMs = input.nowMs;
    const deadLettered = !input.retryable || item.attempt >= item.maxAttempts;
    if (deadLettered) {
      item.state = "dead_letter";
      item.deadLetteredAtMs = input.nowMs;
    } else {
      item.state = "retry_wait";
      item.attempt += 1;
      item.availableAtMs = Math.max(input.nowMs, input.retryAtMs);
    }
    this.clearLease(item);
    return { item: copy(item), deadLettered };
  }

  async reconcileExpiredLeases(nowMs: number): Promise<LeaseRecovery[]> {
    const recoveries: LeaseRecovery[] = [];
    for (const item of this.items.values()) {
      if (item.state !== "leased" || (item.leaseExpiresAtMs ?? Number.POSITIVE_INFINITY) > nowMs) continue;
      item.leaseRecoveries += 1;
      const deadLettered = item.leaseRecoveries >= item.maxLeaseRecoveries;
      recoveries.push({ workId: item.id, previousOwner: item.leaseOwner ?? "unknown", attempt: item.attempt, deadLettered });
      item.state = deadLettered ? "dead_letter" : item.attempt > 1 ? "retry_wait" : "queued";
      if (deadLettered) {
        item.deadLetteredAtMs = nowMs;
        item.lastError = "Render lease recovery budget exhausted";
      } else {
        item.availableAtMs = nowMs;
      }
      item.updatedAtMs = nowMs;
      this.clearLease(item);
    }
    return recoveries;
  }

  async listDeadLetters(): Promise<RenderWorkItem<TPayload>[]> {
    return [...this.items.values()].filter((item) => item.state === "dead_letter").map(copy);
  }

  async counts(): Promise<Record<RenderWorkState, number>> {
    const result: Record<RenderWorkState, number> = { queued: 0, leased: 0, retry_wait: 0, submitted: 0, dead_letter: 0 };
    for (const item of this.items.values()) result[item.state] += 1;
    return result;
  }

  private activeLease(id: string, token: string, nowMs: number): RenderWorkItem<TPayload> | undefined {
    const item = this.items.get(id);
    return item?.state === "leased" && item.leaseToken === token && (item.leaseExpiresAtMs ?? 0) > nowMs ? item : undefined;
  }

  private clearLease(item: RenderWorkItem<TPayload>): void {
    delete item.leaseOwner;
    delete item.leaseToken;
    delete item.leaseExpiresAtMs;
  }
}
