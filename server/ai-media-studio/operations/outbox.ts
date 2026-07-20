export type OutboxState = "pending" | "leased" | "retry_wait" | "dispatched" | "dead_letter";

export interface OutboxMessage<TPayload = unknown> {
  id: string;
  topic: string;
  payload: TPayload;
  state: OutboxState;
  attempt: number;
  maxAttempts: number;
  availableAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAtMs?: number;
  lastError?: string;
  dispatchedAtMs?: number;
  deadLetteredAtMs?: number;
}

export interface ClaimedOutboxMessage<TPayload = unknown> {
  message: OutboxMessage<TPayload>;
  leaseToken: string;
}

export interface OutboxRepository<TPayload = unknown> {
  add(input: { id: string; topic: string; payload: TPayload; maxAttempts: number; availableAtMs?: number }, nowMs: number): Promise<OutboxMessage<TPayload>>;
  claim(input: { workerId: string; limit: number; leaseDurationMs: number; nowMs: number }): Promise<ClaimedOutboxMessage<TPayload>[]>;
  markDispatched(input: { id: string; leaseToken: string; nowMs: number }): Promise<boolean>;
  recordFailure(input: { id: string; leaseToken: string; error: string; retryAtMs: number; retryable: boolean; nowMs: number }): Promise<OutboxMessage<TPayload> | undefined>;
  reconcileExpiredLeases(nowMs: number): Promise<number>;
  listDeadLetters(): Promise<OutboxMessage<TPayload>[]>;
  counts(): Promise<Record<OutboxState, number>>;
}

export interface OutboxTransport<TPayload = unknown> {
  dispatch(message: Pick<OutboxMessage<TPayload>, "id" | "topic" | "payload" | "attempt">): Promise<void>;
}

function copy<T>(message: OutboxMessage<T>): OutboxMessage<T> { return { ...message }; }

/** Process-local reference only. Durable stores must implement claim and fencing atomically. */
export class InMemoryOutboxRepository<TPayload = unknown> implements OutboxRepository<TPayload> {
  private readonly messages = new Map<string, OutboxMessage<TPayload>>();
  private leaseSequence = 0;

  async add(input: { id: string; topic: string; payload: TPayload; maxAttempts: number; availableAtMs?: number }, nowMs: number) {
    const existing = this.messages.get(input.id);
    if (existing) return copy(existing);
    if (!input.id.trim() || !input.topic.trim() || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("Outbox identity, topic, and positive maxAttempts are required");
    }
    const message: OutboxMessage<TPayload> = {
      id: input.id, topic: input.topic, payload: input.payload, state: "pending", attempt: 0,
      maxAttempts: input.maxAttempts, availableAtMs: input.availableAtMs ?? nowMs, createdAtMs: nowMs, updatedAtMs: nowMs,
    };
    this.messages.set(message.id, message);
    return copy(message);
  }

  async claim(input: { workerId: string; limit: number; leaseDurationMs: number; nowMs: number }) {
    if (!input.workerId.trim() || !Number.isInteger(input.limit) || input.limit < 1 || input.leaseDurationMs <= 0) {
      throw new Error("A worker, positive integer limit, and positive lease duration are required");
    }
    const due = [...this.messages.values()]
      .filter((message) => (message.state === "pending" || message.state === "retry_wait") && message.availableAtMs <= input.nowMs)
      .sort((a, b) => a.availableAtMs - b.availableAtMs || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))
      .slice(0, input.limit);
    return due.map((message) => {
      const leaseToken = `${input.workerId}:outbox:${++this.leaseSequence}`;
      Object.assign(message, {
        state: "leased" as const,
        attempt: message.attempt + 1,
        leaseOwner: input.workerId,
        leaseToken,
        leaseExpiresAtMs: input.nowMs + input.leaseDurationMs,
        updatedAtMs: input.nowMs,
      });
      return { message: copy(message), leaseToken };
    });
  }

  async markDispatched(input: { id: string; leaseToken: string; nowMs: number }) {
    const message = this.activeLease(input.id, input.leaseToken, input.nowMs);
    if (!message) return false;
    message.state = "dispatched";
    message.dispatchedAtMs = input.nowMs;
    message.updatedAtMs = input.nowMs;
    this.clearLease(message);
    return true;
  }

  async recordFailure(input: { id: string; leaseToken: string; error: string; retryAtMs: number; retryable: boolean; nowMs: number }) {
    const message = this.activeLease(input.id, input.leaseToken, input.nowMs);
    if (!message) return undefined;
    message.lastError = input.error.slice(0, 1_000);
    message.updatedAtMs = input.nowMs;
    if (!input.retryable || message.attempt >= message.maxAttempts) {
      message.state = "dead_letter";
      message.deadLetteredAtMs = input.nowMs;
    } else {
      message.state = "retry_wait";
      message.availableAtMs = Math.max(input.nowMs, input.retryAtMs);
    }
    this.clearLease(message);
    return copy(message);
  }

  async reconcileExpiredLeases(nowMs: number) {
    let recovered = 0;
    for (const message of this.messages.values()) {
      if (message.state !== "leased" || (message.leaseExpiresAtMs ?? Number.POSITIVE_INFINITY) > nowMs) continue;
      recovered += 1;
      message.updatedAtMs = nowMs;
      if (message.attempt >= message.maxAttempts) {
        message.state = "dead_letter";
        message.deadLetteredAtMs = nowMs;
        message.lastError = "Outbox lease recovery attempt budget exhausted";
      } else {
        message.state = "retry_wait";
        message.availableAtMs = nowMs;
      }
      this.clearLease(message);
    }
    return recovered;
  }

  async listDeadLetters() { return [...this.messages.values()].filter((message) => message.state === "dead_letter").map(copy); }
  async counts() {
    const result: Record<OutboxState, number> = { pending: 0, leased: 0, retry_wait: 0, dispatched: 0, dead_letter: 0 };
    for (const message of this.messages.values()) result[message.state] += 1;
    return result;
  }

  private activeLease(id: string, token: string, nowMs: number) {
    const message = this.messages.get(id);
    return message?.state === "leased" && message.leaseToken === token && (message.leaseExpiresAtMs ?? 0) > nowMs ? message : undefined;
  }
  private clearLease(message: OutboxMessage<TPayload>) {
    delete message.leaseOwner; delete message.leaseToken; delete message.leaseExpiresAtMs;
  }
}

export interface OutboxDispatcherOptions<TPayload> {
  workerId: string;
  repository: OutboxRepository<TPayload>;
  transport: OutboxTransport<TPayload>;
  batchSize: number;
  leaseDurationMs: number;
  retryDelayMs(attempt: number): number;
  now(): number;
  isRetryable?(error: unknown): boolean;
}

export class OutboxDispatcher<TPayload = unknown> {
  constructor(private readonly options: OutboxDispatcherOptions<TPayload>) {}

  async runOnce(): Promise<{ claimed: number; dispatched: number; retried: number; deadLettered: number; leaseLost: number }> {
    const claims = await this.options.repository.claim({ workerId: this.options.workerId, limit: this.options.batchSize, leaseDurationMs: this.options.leaseDurationMs, nowMs: this.options.now() });
    const result = { claimed: claims.length, dispatched: 0, retried: 0, deadLettered: 0, leaseLost: 0 };
    await Promise.all(claims.map(async ({ message, leaseToken }) => {
      try {
        await this.options.transport.dispatch(message);
        if (await this.options.repository.markDispatched({ id: message.id, leaseToken, nowMs: this.options.now() })) result.dispatched += 1;
        else result.leaseLost += 1;
      } catch (error) {
        const failed = await this.options.repository.recordFailure({
          id: message.id, leaseToken, error: error instanceof Error ? error.message : "Outbox dispatch failed",
          retryAtMs: this.options.now() + this.options.retryDelayMs(message.attempt),
          retryable: this.options.isRetryable?.(error) ?? true, nowMs: this.options.now(),
        });
        if (!failed) result.leaseLost += 1;
        else if (failed.state === "dead_letter") result.deadLettered += 1;
        else result.retried += 1;
      }
    }));
    return result;
  }
}
