export interface CapacityRehearsalOptions {
  jobs?: number;
  concurrency?: number;
  latencyMs?: number;
  failureEvery?: number;
}

export interface CapacityRehearsalResult {
  disclaimer: "DETERMINISTIC_REHEARSAL_ONLY_NOT_PRODUCTION_PROOF";
  jobs: number;
  succeeded: number;
  failed: number;
  concurrency: number;
  simulatedDurationMs: number;
  simulatedThroughputPerSecond: number;
  maxObservedInFlight: number;
}

/** Fake provider model used only by the arithmetic rehearsal below. */
export class DeterministicFakeCapacityProvider {
  constructor(readonly latencyMs: number, readonly failureEvery: number) {}

  succeeds(sequence: number): boolean {
    return this.failureEvery === 0 || sequence % this.failureEvery !== 0;
  }
}

/** Deterministic arithmetic harness: no network, clocks, timers, or real provider calls. */
export function rehearseCapacity(options: CapacityRehearsalOptions = {}): CapacityRehearsalResult {
  const jobs = options.jobs ?? 10_000;
  const concurrency = options.concurrency ?? 25;
  const latencyMs = options.latencyMs ?? 2_000;
  const failureEvery = options.failureEvery ?? 0;
  if (!Number.isInteger(jobs) || jobs < 0 || !Number.isInteger(concurrency) || concurrency < 1
    || !Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isInteger(failureEvery) || failureEvery < 0) {
    throw new Error("Rehearsal inputs must be bounded non-negative values and positive integer concurrency");
  }
  const provider = new DeterministicFakeCapacityProvider(latencyMs, failureEvery);
  let failed = 0;
  for (let sequence = 1; sequence <= jobs; sequence += 1) {
    if (!provider.succeeds(sequence)) failed += 1;
  }
  const succeeded = jobs - failed;
  const batches = Math.ceil(jobs / concurrency);
  const simulatedDurationMs = batches * provider.latencyMs;
  return {
    disclaimer: "DETERMINISTIC_REHEARSAL_ONLY_NOT_PRODUCTION_PROOF",
    jobs, succeeded, failed, concurrency, simulatedDurationMs,
    simulatedThroughputPerSecond: simulatedDurationMs === 0 ? 0 : jobs * 1_000 / simulatedDurationMs,
    maxObservedInFlight: Math.min(jobs, concurrency),
  };
}
