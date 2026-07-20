export interface QueueHealthInput {
  nowMs: number;
  oldestReadyAtMs?: number;
  ready: number;
  leased: number;
  retrying: number;
  deadLetters: number;
  completedLastWindow: number;
  failedLastWindow: number;
  windowMs: number;
  target: { maxReadyAgeMs: number; maxDeadLetters: number; minSuccessRate: number };
}

export interface QueueHealthSnapshot {
  status: "healthy" | "degraded" | "breached";
  readyAgeMs: number;
  throughputPerMinute: number;
  successRate: number;
  counts: Pick<QueueHealthInput, "ready" | "leased" | "retrying" | "deadLetters">;
  breaches: string[];
}

export function queueHealthSnapshot(input: QueueHealthInput): QueueHealthSnapshot {
  const readyAgeMs = input.oldestReadyAtMs === undefined ? 0 : Math.max(0, input.nowMs - input.oldestReadyAtMs);
  const attempted = input.completedLastWindow + input.failedLastWindow;
  const successRate = attempted === 0 ? 1 : input.completedLastWindow / attempted;
  const throughputPerMinute = input.windowMs > 0 ? input.completedLastWindow * 60_000 / input.windowMs : 0;
  const breaches: string[] = [];
  if (readyAgeMs > input.target.maxReadyAgeMs) breaches.push("ready_age_slo");
  if (input.deadLetters > input.target.maxDeadLetters) breaches.push("dead_letter_slo");
  if (successRate < input.target.minSuccessRate) breaches.push("success_rate_slo");
  const status = breaches.length > 0 ? "breached" : input.retrying > 0 || input.ready > 0 ? "degraded" : "healthy";
  return { status, readyAgeMs, throughputPerMinute, successRate, counts: { ready: input.ready, leased: input.leased, retrying: input.retrying, deadLetters: input.deadLetters }, breaches };
}
